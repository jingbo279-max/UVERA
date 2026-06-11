---
title: "Loud-fail pattern: 所有 service_role 写操作必须检查 r.ok"
type: decision
status: active
owner: Leon
created: 2026-05-15
updated: 2026-05-15
tags: [decision, adr]
---

# Loud-fail pattern: 所有 service_role 写操作必须检查 r.ok

**日期**: 2026-05-15
**决策**: fei + Claude（基于今天 Phase 1.5 stuck-rows 事故）
**状态**: 规则生效 + 关键路径已修
**关联代码**: `public/_worker.js` 内全部 service_role `fetch()`
**事故关联**:
- [2026-05-13 commit `6d1a8d7`] Phase 1.5 dual-write code deploy
- [2026-05-15 ~06:04 UTC] migration apply 修了 schema
- [2026-05-15] 发现 62 条 stuck `generation_logs` 行，根因不是"忘调用"

## 事故复盘

### 表面现象
05/14 ~28 条新 `generation_logs` 行（`random_ideas` / `concept_image` / `asset_describe` / `optimize_prompt`）卡在 `status='started'`，再也没有 advance 到 succeeded/failed。

### 错诊（早期）
"非视频 gen_type 的 code path 漏调了 `logApiFinish`"

### 真诊
代码 **正确调了 `logApiFinish`**，但函数本身**吞错了**：

```js
// public/_worker.js 旧 logApiFinish
async function logApiFinish(env, logId, fields = {}) {
  if (!logId) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/generation_logs?id=eq.${logId}`, {
      method: 'PATCH',
      headers: { ... },
      body: JSON.stringify({
        ...
        tokens_charged: ...,  // ← 列在 PROD 不存在（Phase 1.5 migration 没 apply）
      }),
    });
    // ⚠️ 没有 if (!r.ok) — 4xx/5xx 不会进 catch
  } catch (err) {
    console.warn('[logApiFinish] failed:', err.message);
    // ↑ 只有网络层 throw 才到这；HTTP 400 不算
  }
}
```

JavaScript `fetch()` **resolve 任何 HTTP 响应**——只有 DNS / 网络断才 throw。所以 PostgREST 返回 400 PGRST204（unknown column `tokens_charged`），fetch resolve 正常，函数静默返回，**行永远停在 started**，**日志里没有任何痕迹**。

bug 存在了几天没人察觉就是因为这个。

### 为什么只有非视频 gen 受影响

视频 gen 用**独立**的更新路径（`/api/volcengine/video/status` 的 PATCH，在 `_worker.js:1940` 附近），**不带** `tokens_charged` 字段——所以即使 schema 不匹配也不撞 400。

## 决策：所有 service_role 写操作必须 "loud fail"

### 规则

**`fetch()` 写操作（POST/PATCH/PUT/DELETE）到 service_role 端点的，必须检查 `r.ok` 并 `console.error()` 失败原因**。

适用范围：
- ✅ Supabase PostgREST（`/rest/v1/*`）service_role 调用
- ✅ Supabase Auth Admin（`/auth/v1/admin/*`）调用
- ✅ Stripe API（`api.stripe.com/v1/*`）写操作
- ✅ Resend / 第三方 API 调用
- ❌ 用户端 fetch 不需要——它们抛错会自然冒泡到 catch

### 实现：用 `assertOk()` 辅助函数

```js
/**
 * Wraps a fetch promise. If the response is non-OK, logs a structured
 * error AND throws. Callers can choose to:
 *   - let the throw propagate (default for endpoint handlers — they have
 *     a top-level try/catch that returns 500 to the client)
 *   - wrap in their own try/catch if the operation is optional (e.g.
 *     fire-and-forget email send where downstream user payment matters
 *     more than the email)
 *
 * The console.error is the critical part: it lands in Cloudflare Worker
 * Logs where alerting tools (Sentry / Grafana / wrangler tail) can pick
 * it up. Previously these failures were invisible.
 */
async function assertOk(r, context) {
  if (r.ok) return r;
  const errBody = await r.text().catch(() => '(unreadable)');
  const msg = `[${context}] HTTP ${r.status}: ${errBody.slice(0, 300)}`;
  console.error(msg);
  throw new Error(msg);
}
```

### 何时**不**用 `assertOk`（fail-open by intention）

某些写操作可以在失败时继续：
- **Receipt email** — payment 已 confirm，email 失败不该回退 payment
- **Audit log INSERT** — 主操作已成功，audit 失败只丢日志
- **isInvoiceAlreadyProcessed** — fail-open 比 fail-closed 安全（宁可双重发币，不要漏掉真实付款）

这些点必须**显式注释**说明 fail-open 原因 + 仍然 `console.error` 失败：

```js
try {
  const r = await fetch(...);
  if (!r.ok) {
    console.error('[receipt-email] HTTP ' + r.status + ' — continuing, payment already confirmed');
  }
} catch (e) {
  console.error('[receipt-email] exception:', e.message, '— continuing, payment already confirmed');
}
```

## 已应用范围（v1.1.4）

### 第一波（关键路径，治本）

| 函数 | 模式 | 状态 |
|---|---|---|
| `logApiFinish` | PATCH generation_logs | ✅ `assertOk` |
| `updateSupabaseMeta` | PUT auth.users user_metadata | ✅ 已有 throw（早期修过）|
| `fetchSupabaseUser` | GET auth.users | ✅ 已有 throw（早期修过）|
| `isInvoiceAlreadyProcessed` | GET orders | 🟡 fail-open by design — 加 `console.error` |

### 第二波（v1.1.5+，渐进推广）

剩 ~30 个 service_role fetch 在 webhook handler / admin endpoints / reconcile flow 里。**新代码**必须用 `assertOk`，**老代码**借后续 PR 顺手改。

不一次性大改的原因：
- 多数 endpoint 已经在自己的 try/catch 里返回 500 给 client
- 全量 refactor 引入回归风险大于收益
- 借平时的 PR 顺手改更稳

## 防止未来重演

### 流程层（v1.2.0 checklist）

1. ✅ **Migration apply 必须先于 worker code deploy**（写入 CHANGELOG release process）
2. ✅ **新加 service_role fetch 必须用 `assertOk` 或显式注释 fail-open 原因**（PR review checklist）
3. ⏳ **加 admin /api/admin/system-health endpoint**：probe 各表 schema、cross-ref worker 期望的列，不匹配时报警

### 工具层

- Cloudflare Worker Logs 抓 `^\[.+\] HTTP [45]\d{2}:` 关键字 → 推 Slack / 邮件
- 每周自动跑 `node scripts/audit-stuck-logs.mjs`（待写）—— 找 `status='started' AND started_at < now() - interval '30 min'`，超过阈值报警

## 教训摘要

1. **`fetch().ok` 不是默认行为**——必须显式检查
2. **`console.warn` vs `console.error`**——alerting 看 ERROR 级别，WARN 默默淹没
3. **静默失败 = 没 bug? 错**——bug 只是没暴露
4. **错诊 vs 真诊**——下次先 grep code path 确认 fact，不要从症状跳结论（我早期猜"忘调用"就是这种错误）

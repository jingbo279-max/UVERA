---
title: 致费 · generation_logs 3 个 endpoint 漏写 user_id → Wallet Token Activity 不完整
type: ask
status: resolved
owner: Leon
created: 2026-05-13
updated: 2026-05-13
tags: [ask, bug, logging]
---

# 致费 · generation_logs 3 个 endpoint 漏写 user_id → Wallet Token Activity 不完整

> ✅ **已解决（2026-05-13 commit `fb91896`）** — 真正的 root cause 是**前端**漏传 Authorization header（不是 backend logApiStart bug）。已在 `src/api/neoaiService.js` 给 4 个 endpoint 加 Bearer token。Worker 不需要改。
>
> 发起人：Leon · 日期：2026-05-13
> 状态：**Resolved (frontend fix)**
> 紧迫度：~~中~~（已修）

## 甲方反馈

"wallet/Token 没有消耗明细查询" — 实际上 Token Activity section 已实装（你 commit `b3f16da`），但因 backend logging bug，用户消耗 token 后 Activity 显示不全。

## Root cause

**`public.generation_logs` 表 96 条 NULL user_id 行**（占总数 88%），按 endpoint 分布：

| Endpoint | generation_type | NULL user_id 行数 |
|---|---|---|
| `/api/generate-ideas` | random_ideas | **50** |
| `/api/generate-concept-image` | concept_image | **40** |
| `/api/describe-image` | asset_describe | **6** |
| `/api/volcengine/video/*` | video | **0** ✅ 正确归属 |

只有 video gen endpoint 在 INSERT generation_logs 时正确传 user_id。其他 3 个 AI 调用都丢失归属。

**结果**：
- Token Activity section 通过 RLS `generation_logs_self_read (auth.uid() = user_id)` filter，user_id NULL 的行被屏蔽
- 用户看到的 Activity 只有 video 部分
- 比如甲方用户 `bachbanana@gmail.com` (creator tier) 看到 0 条
- 其他付费用户也大量缺失，与扣的 token 数对不上

## 你需要修

3 个 endpoint handler 在 `public/_worker.js` 里，找到对应的 `INSERT INTO generation_logs` 或 supabase.from('generation_logs').insert(...)，加上 user_id 字段。

**典型 fix pattern**：

```js
// 在 endpoint handler 开头取 user_id
const authHeader = request.headers.get('Authorization');
const token = authHeader?.replace('Bearer ', '');
const { data: { user } } = await supabaseAdmin.auth.getUser(token);
const userId = user?.id || null;  // 仍然允许 anonymous,但 logs 走 unauthed 路径

// INSERT log 时带 user_id
await supabase.from('generation_logs').insert({
  user_id: userId,        // ← 新加
  user_email: user?.email || null,  // ← 顺手也加
  generation_type: 'random_ideas',
  // ... existing fields
});
```

## 历史 96 条孤儿数据

无法 backfill（没有 auth token 关联）。建议：

- **方案 A（推荐）**：保留作历史 telemetry（admin 视图可见，用户不可见）。新 logs 走对的归属。
- **方案 B**：删除（DELETE WHERE user_id IS NULL），干净起步。

我倾向 A — 这些 log 有 client_ip / user_agent 可做 cohort 分析，admin 价值大于干净。

## 验证

修完后跑一遍 generate ideas → 检查：

```sql
SELECT user_id, generation_type, credits_charged, created_at
FROM public.generation_logs
WHERE generation_type IN ('random_ideas', 'concept_image', 'asset_describe')
  AND created_at > '2026-05-13 09:00'
ORDER BY created_at DESC
LIMIT 5;
```

user_id 应该都不为 NULL。

## 联动

- 此 bug 与 [credits → tokens rename refactor](2026-05-13-naming-consolidation-refactor.md) 同期处理也可：rename `credits_charged` → `tokens_charged` 时顺手把 user_id 写入加上。
- 前端无需改动。

## TL;DR

3 个 endpoint 加 user_id 写入即可，frontend 已 ready。

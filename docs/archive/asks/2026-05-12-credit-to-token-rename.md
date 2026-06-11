---
title: 致费 · Credit → Token 命名迁移
type: ask
status: superseded
owner: Leon
created: 2026-05-12
updated: 2026-05-13
tags: [ask, naming, tokens]
superseded_by: archive/asks/2026-05-13-naming-consolidation-refactor.md
---

# 致费 · Credit → Token 命名迁移

> ⚠️ **已被 [2026-05-13-naming-consolidation-refactor.md](2026-05-13-naming-consolidation-refactor.md) 取代** — 那份扩展了 scope 包含 source_character_id / isContinuation rename + 完整 4 阶段迁移计划。本文件保留作历史记录,不再单独跟进。
>
> 发起人：Leon（前端团队） · 日期：2026-05-12
> 状态：**已 merge 入综合 refactor doc**
> 紧迫度：中（不阻断 Phase A 前端 enforce，但越早做越好，避免双轨命名长期共存）

## 背景

Plan 文档（`docs/product/PLANS.md`）落地后明确：
- 计费单位统一命名 **"Tokens"**
- ❌ 不再用 "Credits"（与 Web3 / 推荐积分等概念混淆）

但当前代码 + DB 仍用 "credits"。这是 v1 期遗留命名（你最初实装时与"Token economy"概念还没分化）。

## 影响范围（搜替清单）

### DB schema

| 表 | 字段 | 当前 | 目标 |
|---|---|---|---|
| `auth.users.raw_user_meta_data` | `credits` (JSONB key) | `{ "credits": 20 }` | `{ "tokens": 20 }` |
| `auth.users.raw_user_meta_data` | `lastShareDate` / `dailyShareCount` | 保留（与 credits 分离） | — |
| `public.orders` | `credits_deducted` (column) | `int` | rename → `tokens_deducted` |
| `public.credit_grants` | 表名 + 含义 | "credit grant" | rename → `token_grants` |
| `public.credit_grants.amount` | column | int (是 token 数) | rename → `tokens` 或保留 amount |

> ⚠️ 这 4 处是 schema rename，需要 migration + down migration（rollback 用）。

### Backend code (`/api`, `_worker.js`, Stripe webhook handlers)

- `/api/credits/claim-daily` 路由 → 建议 alias `/api/tokens/claim-daily`，保留 `/credits/` 一段时间过渡（旧 client cache 不会立刻 fail）
- Stripe webhook 字段（custom metadata, line items）→ 大概率写 `credits` 字段名，需要 dual-read 过渡
- Email receipt templates（Resend HTTP API） → 文案改 "tokens"，但变量名 dual-supports

### Frontend (`src/`)

搜替 (case-insensitive `credits` → `tokens`)：

| 文件 | 函数 / 标识符 |
|---|---|
| `src/api/supabaseClient.js` | `getUserProfile()` 返回字段 `{ credits, tier }`、`updateCredits()`、`updateTierAndCredits()`、`claimDailyCredits()`、`handleShareCredits()` |
| `src/design-system/composites/NavigationBar.jsx` | `credits` state，`profile.credits ?? 0` |
| `src/pages/StoryGeneratorPage.jsx` | "credits" 文案、token 消耗预览 ("cost ~ X credits") |
| `src/pages/SubscriptionPage.jsx`（如存在） | "credits" 文案 |
| `src/pages/admin/*` | 管理后台 credit grant UI |
| 其他 hardcoded "credits" 文案 | UI strings |

预估 grep 命中 **80-150 处**（文案居多）。

## 迁移策略建议

### 方案 A（推荐）：渐进 dual-name，避免 big-bang

**Phase 1 — Frontend 文案层先改（无 schema 影响）**
- 所有 UI 显示 "Tokens"，代码内部仍用 `credits` 标识符
- 用户感知一致："Tokens"
- 0 风险，1 个 commit 就能搞定（一个 i18n 字典或直接 search/replace UI strings）

**Phase 2 — API alias（新旧并存）**
- 后端加 `/api/tokens/*` route alias 同 `/api/credits/*` 同实现
- API response 返回 `{ credits: X, tokens: X }` 双字段
- 前端逐步切到 `tokens` 字段引用，但 fallback `credits`

**Phase 3 — DB schema rename（最后一步）**
- Migration: `ALTER COLUMN credits_deducted RENAME TO tokens_deducted`（and analog）
- Trigger / RLS policy 跟改
- 同步删除旧字段 alias

### 方案 B：一次性 big-bang

不推荐。生产已有付费用户（commit `4c237d4` 的 LITE 实装、$25 Starter 已落账），任何字段 rename 失败都会导致 token 显示异常 / 扣费异常 / Stripe webhook 失败。

## Phase A 不阻塞这件事

我（Leon / 前端 team）现在做 Phase A（plans frontend hardcode + UI enforce）会：
- ✅ 文案上统一用 "Tokens"（属于方案 A 的 Phase 1）
- ✅ 代码标识符仍叫 `credits`（不动你的 API contract）
- ⚠️ 等你 ack 后续 schema rename 方案 + 时机

## 请你回复 / 决定

1. 同意按方案 A 走？还是有更好建议？
2. 时机建议：v1.1.x 之内 OK 还是 v1.2 再统一？
3. 你的 Claude Code session 知会一下，避免独立 commit 触发命名分歧

## 顺手 ping 一下：相关清理

数据库测试期 cleanup（2026-05-12 Leon 跑了）：
- 删除 65 个超 β tier limit 的 records（4 Actors + 59 Characters + 2 orphan）
- 详见 [`docs/product/PLANS.md` Change Log](../../product/PLANS.md#change-log)

**孤儿存储清理**（你的范畴）：
- 上述 65 records 删除后，`photo_url` 指向的 OSS/R2 图片成 orphan 文件
- 建议你跑一个 storage GC job 清理 → 节省存储

**Orphan character root cause**（也是你的范畴）：
- 删除前发现 user `8790915a` 有 2 个 character 但 `source_character_id` 是空字符串而非 valid UUID
- 怀疑某个 gen flow（concept gen）在 source actor 删除后没级联清，或写入时漏写 source_character_id
- 建议补一个 NOT NULL check 或 CHECK constraint 防止再发生

---

## 完整 Plan 文档

参考 [`docs/product/PLANS.md`](../../product/PLANS.md)，里面有：
- 4 tier × β 限制矩阵
- LITE top-up SKU 定义（与你 v1.1.1 实装一致）
- Token 经济（含你已定的 480p=4 / 720p=6 / 1080p=12）
- Phase B schema 草案（subscription_plans 表是否要建 / `users.current_tier` 是否要从 metadata 提取到 public.users）

这些后续也需要和你 sync 决策。

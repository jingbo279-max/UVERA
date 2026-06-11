---
title: 致费 · 命名一致性整改（综合 rename refactor）
type: ask
status: resolved
owner: Leon
created: 2026-05-13
updated: 2026-05-13
tags: [ask, naming, refactor]
---

# 致费 · 命名一致性整改（综合 rename refactor）

> 发起人：Leon · 日期：2026-05-13
> 状态：**Group C ✓ done / Group B ✓ done / Group A ⏸ 等费 Phase 1 PR**
> Release window：**v1.2.0**（费已确认；不进 v1.1.x patch）
> 紧迫度：中（不阻断业务，但越早做迁移成本越低）
> 超集：本文件并入并扩展 [`2026-05-12-credit-to-token-rename.md`](2026-05-12-credit-to-token-rename.md)，那份 deprecated
> 同窗口待办：[`2026-05-12-profile-picture-jwt-bloat.md`](2026-05-12-profile-picture-jwt-bloat.md)（费要求并入 v1.2.0）

## 当前执行状态（2026-05-13）

| Group | 状态 | 实施细节 |
|---|---|---|
| **C. Continuation → Sequel** | ✅ **DONE** (commit `00b7f30`) | Frontend rename + localStorage dual-read fallback (`draft.isSequel ?? draft.isContinuation`)。无 DB schema 改动 (Sequel 走 localStorage)。 |
| **B. source_character_id → source_actor_id** | ✅ **DONE** (commit `601196b` + DB migration 已跑 34 rows) | Frontend dual-read + dual-write (写两个 key 1-2 周观察期)。SQL UPDATE 加 `source_actor_id` JSONB key on existing rows,保留旧 key 备 rollback。Phase 4 cleanup (删旧 key) 待后续。 |
| **A. credits → tokens** | 🔄 **费 Phase 1 已起 (commit `98c17f7`)**, 等 schema PR | 费侧已开始 backend dual-write + API alias。我等他 schema PR 看 dual-write 字段配对再切前端 271 处搜替。 |

---

## 协调状态（2026-05-13 费 ack）

**费 ack 决议**：
1. ✅ 整体方向同意，3 组一起做（不拆 patch）
2. ✅ Release tag：**v1.2.0**（不进 v1.1.x patch）
3. 🔄 费起 Phase 1 后端 dual-write + API alias（in progress，commit `98c17f7`）
4. 🔄 费写 metadata migration 为**一次性 admin endpoint** `/api/admin/migrate-credits-key`，触发一次跑完即删
5. ✅ JSONB 单 migration（行数小不分批）
6. ✅ Tier 统一 / `selectedCharacterId` 不动 / `creditsCharged` 跟 §A 走

**费提出的 4 点风险（已接受）**：

| # | 风险点 | 对策 |
|---|---|---|
| 1 | **Stripe webhook 必须双写 credits + tokens** | 费 Phase 1 dual-write 时连同 Stripe webhook handler 一起改；否则付款 grant 失效，用户付钱看不到 token。 |
| 2 | **Wallet history (SettingsPage) 读 `generation_logs.credits_charged`** | 我前端切到 `tokens_charged` 必须等费 dual-write 已部署 + DB 已加 `tokens_charged` 列 + 写入两列至少 1 个完整 generation cycle。否则历史显示 NULL/0。 |
| 3 | **271 处 search-replace 强烈建议 PR review 双人过** | 前端切换我会开独立 PR，**不盲目 sed**。@ 费做 reviewer，至少 1 round comments。涉及 `_worker.js` 调用的 frontend service 文件单独单元覆盖。 |
| 4 | **要 `profile-picture-jwt-bloat.md`** | ✅ 已在 repo: [`docs/archive/asks/2026-05-12-profile-picture-jwt-bloat.md`](2026-05-12-profile-picture-jwt-bloat.md)。一并进 v1.2.0 窗口。 |

---

## v1.2.0 下一步（节奏明确化）

### 费侧（本周内）
- [ ] 写完 §A §B §C 三套 migration（不 apply），打 PR 给 Leon 看
- [ ] schema PR 包含 dual-write 字段配对清单（让 Leon 前端 expected 字段名匹配）
- [ ] 开 `/api/admin/migrate-credits-key` admin endpoint（一次性，跑完删）
- [ ] Stripe webhook 改造（dual-write credits + tokens）

### Leon 侧（等费 PR 后）
- [ ] Review 费的 schema PR，确认字段配对符合前端预期
- [ ] 开始 271 处 frontend 搜替（独立 PR，@ 费 review）
- [ ] 节奏控制：dual-write 部署 + dual-read 跑稳后再切

### v1.2.0 tag 时（同步）
- [ ] 两端共同 DROP 旧字段（`credits_*`、`isContinuation`、`source_character_id`）
- [ ] 触发 `/api/admin/migrate-credits-key` 一次清掉 user_metadata 残留旧 key
- [ ] 删 admin endpoint
- [ ] 同步 profile-picture-jwt-bloat fix 进窗口

**Group A 阻塞点（vintage 记录）**: 我需要 `_worker.js` 改 API response 返回 `{tokens: X, credits: X}` 双字段 + 新 `token_grants` 表 + `/api/tokens/*` route alias 后,才能切 frontend 读取到 `tokens` 字段。否则 frontend 改了找不到字段 → 用户余额显示 0 → 支付链断。

---

## 背景

最近 plan/term 文档（`docs/product/PLANS.md`）落地后，发现 codebase 有 3 类命名 inconsistencies。一起处理可降迁移成本（共用 migration window + 同步前后端）。

## 三组 rename 目标

### A. `credits` → `tokens`（计费单位术语统一）

**DB（2 column + 1 table）：**

| 当前 | 目标 |
|---|---|
| `public.credit_grants` (table) | `public.token_grants` |
| `public.credit_grants.amount` | 保留 `amount`（值是 token 数，列名不必带单位） |
| `public.orders.credits_deducted` | `tokens_deducted` |
| `public.generation_logs.credits_charged` | `tokens_charged` |

**Supabase auth metadata（JSONB key）：**

| 当前 | 目标 |
|---|---|
| `auth.users.raw_user_meta_data.credits` (JSONB key) | `tokens` |

**API endpoints：**

| 当前 | 目标 |
|---|---|
| `/api/credits/claim-daily` | `/api/tokens/claim-daily` |
| `/api/admin/grant-credits` | `/api/admin/grant-tokens` |

**Frontend code（搜替）：**

- 271 处 `credits` / `Credits` 跨 10 个文件
- 关键 identifier：`updateCredits()` / `claimDailyCredits()` / `handleShareCredits()` / `updateTierAndCredits()` / `credits` state / `freeModeCost` / `RESOLUTION_CREDITS_PER_SEC` 等
- UI 文案已 partial migrated（最新 UI 显示 "Tokens"），但内部 identifier 仍 credits

### B. `source_character_id` → `source_actor_id`（Actor/Character 关系澄清）

`characters` 表 `identity_features` JSONB 字段内的 `source_character_id` key，实际指向**root Actor**（不是 source Character）。命名 misleading。

**DB（JSONB inner key）：**

| 当前 | 目标 |
|---|---|
| `characters.identity_features.source_character_id` (JSONB key) | `source_actor_id` |

**Frontend code：**

- `src/components/LibraryPage.jsx`
- `src/pages/StoryGeneratorPage.jsx` (line 1047 INSERT, line 3601/3613/3632 filters)

**Migration（更新现有 row）：**

```sql
UPDATE public.characters
SET identity_features = (
  (identity_features::text::jsonb - 'source_character_id') 
  || jsonb_build_object('source_actor_id', identity_features::text::jsonb->>'source_character_id')
)::text::jsonb  -- 保持 JSONB-string-wrap (费的存储 quirk)
WHERE (identity_features::text::jsonb->>'source_character_id') IS NOT NULL;
```

⚠️ 注意 `identity_features` 是 JSONB 但 value 是 JSON 字符串嵌套（费的特殊存法），需要 `#>>'{}'` 或 `::text::jsonb` cast 才能访问 inner key。

### C. `isContinuation` / `continuationTitle` → `isSequel` / `sequelTitle`（衍生作品概念对齐）

PLANS.md 衍生作品章节已敲定术语：Sequel / Branch / Recast。代码内 Sequel 仍用 "Continuation" 旧名。

**Frontend code：**

| 当前 | 目标 |
|---|---|
| `isContinuation` (state in StoryGeneratorPage) | `isSequel` |
| `continuationTitle` | `sequelTitle` |
| `localStorage.uvera_story_draft.isContinuation` | `isSequel` |
| `localStorage.uvera_story_draft.continuationTitle` | `sequelTitle` |
| transcript prefix `"[Continuation] Previously on ..."` | `"[Sequel] Previously on ..."` |

**DB：** 无字段（Sequel 走 localStorage flow）。未来如加 `sequel_of_id` 字段直接用此名。

### D. 顺手 audit（备查，本次可不动）

| 项 | 状态 | 建议 |
|---|---|---|
| `characters` 表名 | 同时存 Actor + Character 两类（靠 `identity_features.createdVia` 区分） | 不动；如重构可拆 `actors` + `characters` 两表（大改） |
| `selectedCharacterId` (frontend var) | 可指 Actor 或 Character | 不动；逻辑上确实是泛指"selected entity" |
| `userTier` vs `tier` (frontend var) | 同义但两种写法 | 二选一，建议 `tier` 统一 |
| `creditsCharged` (camelCase 在 API response) | DB rename 后跟随 | 同 A 一起做 |

## 迁移策略（分 4 阶段，零中断）

### Phase 1 — 后端 dual-write / dual-read（费）

1. 加新 column / table（不删旧）：
   ```sql
   ALTER TABLE public.orders ADD COLUMN tokens_deducted int;
   ALTER TABLE public.generation_logs ADD COLUMN tokens_charged int;
   CREATE TABLE public.token_grants (LIKE public.credit_grants INCLUDING ALL);
   ```

2. 写入时同时写新旧 column（trigger 或 application-level）。

3. 读取优先新 column，fallback 旧 column。

4. API endpoint alias：保留 `/api/credits/*`，新增 `/api/tokens/*` 走同 handler。

### Phase 2 — 前端切到新字段（Leon 前端组）

1. 全局搜替 `credits` → `tokens`（在 identifier 和 API path 层）
2. `source_character_id` → `source_actor_id`（仅 2 文件）
3. `isContinuation` → `isSequel`（StoryGeneratorPage state）
4. `localStorage.uvera_story_draft` key 改名（旧 key 读 fallback 30 天后删）
5. UI 文案再次 audit，确保用 "Tokens" 不漏 "credits"
6. Test：Discover / Wallet / Generate flow 全跑一遍

### Phase 3 — 数据 backfill + JSONB migration（费）

1. 已有 rows 把旧 column 值 copy 到新 column：
   ```sql
   UPDATE public.orders SET tokens_deducted = credits_deducted WHERE tokens_deducted IS NULL;
   ```

2. `auth.users.user_metadata.credits` → `tokens` JSONB key migrate：
   ```sql
   -- (admin script,不能在 SQL 里写跨 auth schema,需 service_role 跑)
   ```

3. `characters.identity_features` JSONB rename（见 §B SQL）

### Phase 4 — 删旧字段 / endpoint（费，1-2 周观察后）

1. 监控旧 column / endpoint 无新写入 + 无读取错误
2. DROP COLUMN credits_deducted, credits_charged
3. DROP TABLE credit_grants
4. 删除 `/api/credits/*` route
5. 清 `user_metadata.credits` 残留 key

## 风险评估

| 风险 | 影响 | 缓解 |
|---|---|---|
| 前端 cache 老 access_token，新字段读不到 | 用户登陆后看到 0 token | 强制 refreshSession on focus（已实装 commit `b3c2ac7`） |
| Stripe webhook payload 字段名硬编码 | 支付 grant 写错字段 | Phase 1 dual-write 期内同步两套 |
| 第三方集成（如有）依赖旧 API | 外部失败 | 保留 `/api/credits/*` alias 6 个月 deprecation period |
| `identity_features` JSONB-as-string 存法的 quirk | rename SQL 易出错 | Migration 写好后小心 review，先在 dev 跑 |

## 决策点（请费 ack）

1. **同意整体方向？** 三组 rename 一起做。
2. **时机？** v1.2 还是 v1.1.x 内做？
3. **谁起步 Phase 1（dual-write）？** 费做后端 schema + API alias；Leon 前端等 alias 后切。
4. **`auth.users.user_metadata.credits` migration script** 谁写？需要 service_role。建议费用 supabase admin SDK 写一次性脚本。
5. **`characters.identity_features` JSONB rename** 是单 migration（费跑）还是分批（前端旧/新 key 都读 1-2 周再 cleanup）？建议单 migration（数据量小，<200 rows）。

## 联动

- [`2026-05-12-profile-picture-jwt-bloat.md`](2026-05-12-profile-picture-jwt-bloat.md) — 也是 metadata cleanup，建议一起做（trips together）
- 重新发的 JWT 应该剔除大字段 + 用 tokens 而非 credits key

## 完整文件清单（rename 影响）

**Frontend (搜替):**
- `index.jsx`
- `src/api/supabaseClient.js`
- `src/api/adminService.js` (credit_grants references)
- `src/api/neoaiService.js`
- `src/api/interactionService.js`
- `src/components/Header.jsx` / `NavigationBar.jsx`
- `src/components/LibraryPage.jsx` (source_character_id)
- `src/components/LightboxPlayer.jsx`
- `src/components/SparkMode.jsx`
- `src/pages/StoryGeneratorPage.jsx` (主要重灾区)
- `src/pages/SettingsPage.jsx` (Wallet view, credits state)
- `src/pages/admin/AdminDashboard.jsx` (credits grants UI)
- `src/data/plans.js` (VIDEO_TOKEN_COST 已用 token,但 helper functions ref 待 audit)

**Backend (费 territory):**
- `public/_worker.js` (API routes / Stripe webhook / Resend templates)
- Migration files in `migrations/` (新建 `20260513_credits_to_tokens.up.sql` 等)

---

回完上面 5 个决策点，我 + 费 split work 推进。

---
title: Uvera Backend ↔ Frontend Contract Style Guide
type: doc
status: active
owner: fei
created: 2026-04-20
updated: 2026-04-20
tags: [engineering, backend, style-guide]
---

# Uvera Backend ↔ Frontend Contract Style Guide

> **适用对象**：Uvera 后端/DB/部署团队（乙方 feifeixp 等）与前端团队（甲方）共同遵循的 **跨层契约规范**。
> **不涵盖**：视觉设计、Design Tokens、图标库、CSS / Tailwind 约定 — 这些由前端 Design System（`src/design-system/`）单独规范。
> **版本**：v1.0（2026-04-20 初版，基于 `recommended_content v2` migration 实践提炼）
> **状态**：**草案**，待乙方确认后进入正式版。

---

## 0. 为什么需要这份文档

截至 2026-04-20，Uvera 数据库与 API 层在若干细节上存在不一致，例如：

- `recommended_content.createdAt` 是 **camelCase** 列，而 `aspect_ratio` 是 **snake_case** 列 — 同一张表内混用。
- `type` enum 使用 **UPPERCASE**（`VIDEO` / `IMAGE` / ...），而新加的 `media_kind` 使用 **Title Case**（`Video` / `Image` / `Live`）。
- 既有 API 函数返回 shape 部分包含 UI 视觉字段（`color` / `bgColor` / `badgeHex`），部分不含 — 分工边界不清。

这些不一致不会立即引发 bug，但会：
1. 让新人（含 Claude / Copilot）猜错命名 → 回归成本上升；
2. 每次新列都要"到底随既有 camelCase 还是 snake_case"讨论一次；
3. normalize 层（`src/utils/normalizeRecommended.js`）持续变厚，成为垃圾抽屉。

本规范的目的是 **冻结方向**：新列、新枚举、新 API 按此文档落地；既有存量保持原样（不做破坏性重构），通过 normalize 层兜底。

---

## 1. Naming Casing — 数据流三层约定

| 层 | 命名风格 | 示例 | 谁负责 |
|---|---|---|---|
| DB 列（Postgres） | `snake_case` | `aspect_ratio`, `media_kind`, `cta_url`, `published_at` | 后端 |
| API 返回 shape（JSON） | 保持 DB 原样 | `{ aspect_ratio: '16/9', media_kind: 'Video' }` | 后端 |
| 前端暴露（JSX props / state） | `camelCase` | `aspectRatio`, `mediaKind`, `ctaUrl`, `publishedAt` | 前端 normalize 层 |

**规则**：
- 后端不做视觉/UI 字段映射；前端不对后端 shape 提要求（让 normalize 层处理）。
- 既有 camelCase 列（`createdAt`）**不改**；未来新列一律 snake_case。
- normalize 层（`src/utils/normalizeRecommended.js`）是唯一转换点，双向都走它。

**反例（禁止）**：
```sql
-- ❌ 后端别做这个
ALTER TABLE recommended_content ADD COLUMN ctaUrl text;  -- camelCase 列

-- ❌ 后端别做这个
SELECT cover_url AS coverUrl FROM ...;  -- 返回层改名
```

> **改进空间**：长远应 deprecate `createdAt` 列，迁至 `created_at`，但这是 breaking change，需要前端同步改 normalize + API 调用处，应单独规划一次性迁移。

---

## 2. Enum Casing — 新枚举一律 Title Case

| 类型 | 风格 | 状态 |
|---|---|---|
| Legacy `type`（`VIDEO`/`IMAGE`/`MUSIC`/`DESIGN`/`LIVE`/`STORY`） | UPPERCASE | 保留不动，`media_kind` 成为权威字段后逐步淘汰 |
| 新增枚举（本次 `media_kind`） | **Title Case**（`Video` / `Image` / `Live`） | 默认 |
| 极少数 case-sensitive 外部协议字段（如 HTTP method `GET`/`POST`） | 依协议 | 例外 |

**理由**：Title Case 对 JSON 接口友好，对 UI 直接显示友好（`{item.mediaKind}` 无需 `capitalize`），对 `media_kind IN ('Video','Image','Live')` CHECK 约束可读性好。

**规则**：
- 新增 enum / varchar 约束列，默认 Title Case。
- 若和 legacy UPPERCASE 字段共存于同一张表，**不做大小写统一重构** — 保持两层并存，前端用 `mapLegacyType` helper 兜底。

**反例（禁止）**：
```sql
-- ❌ 不要"顺便统一一下" legacy 字段
UPDATE recommended_content SET type = LOWER(type);  -- 破坏既有前端 dropdown / filter
```

> **改进空间**：未来可在 Uvera v3 milestone 引入 `recommended_content.type_v2`，代替 `type`，彻底去 UPPERCASE。但当前不做。

---

## 3. Additive-only Rule — 变更非破坏性原则

**核心原则**：任何 schema / API 变更默认走 additive 路径，破坏性变更必须书面对齐。

| 动作 | 默认策略 | 例外场景 |
|---|---|---|
| 新增列 | ✅ `ADD COLUMN IF NOT EXISTS` + 安全 default | — |
| 新增 index | ✅ `CREATE INDEX IF NOT EXISTS`，partial index 首选（小而专） | — |
| 新增 enum 值 | ✅ 追加到末尾 | — |
| 改列类型 | ❌ 默认禁止 | 仅当 backfill 可验证零损失，且双方书面对齐 |
| DROP 列 | ❌ 默认禁止 | 灰度两期后（第一期标记 deprecated，第二期 drop） |
| RENAME 列 | ❌ 默认禁止 | 同上，或通过 view 做 alias 过渡 |
| 改列 default | ⚠️ 允许但需对齐 | default 变动会影响未来 INSERT 默认行为 |
| 改既有约束（NOT NULL / UNIQUE） | ❌ 默认禁止 | 必须 backfill 验证 + 双方书面对齐 |
| DROP / 改 RLS policy | ❌ 默认禁止 | 安全相关，需专项 review |

**规则**：
- 破坏性变更必须先在前端团队对齐，确认无 consumer 依赖后才能动。
- 破坏性变更必须成对写 `up.sql` + `down.sql`，**且 `down.sql` 能真正回滚**（不是空语句）。

**本次实践验证**：`recommended_content v2` 9 个新列全部 additive、安全 default、partial index、backfill 幂等，完全合规。

---

## 4. Migration 文件模式

**文件命名**：`migrations/YYYYMMDD_<topic>.up.sql` + `migrations/YYYYMMDD_<topic>.down.sql`

**示例**：
```
migrations/
  20260420_recommended_content_v2.up.sql    ← ADD COLUMN + INDEX + backfill
  20260420_recommended_content_v2.down.sql  ← DROP INDEX + DROP COLUMN（反序）
```

**每个 up.sql 必须包含**（按顺序）：

1. **Header 注释**：Date / Purpose / Execution method / Safety 声明 / Rationale 链接
2. **Pre-flight probe SQL**（注释状态，可手动取消注释跑）：schema check + 数据分布 check
3. **Schema 变更**：ALTER / CREATE INDEX，全部 `IF NOT EXISTS`
4. **Backfill**：幂等 UPDATE（`WHERE col IS NULL`），可重复运行
5. **Post-migration verification**（注释状态）：check 结果 SQL

**每个 down.sql 必须**：
- 真正能回滚，不是空壳
- 使用 `IF EXISTS` 以支持重复运行
- 如果某字段回滚会造成数据丢失，在注释中明确说明（例：本次 `type` 列不需回滚，因为从未动过）

**执行方式**：目前无 migration 框架，手工贴进 Supabase Dashboard → SQL Editor → Run。新脚本加入时，文件放到 `migrations/` 目录，PR 描述中贴执行结果截图。

> **改进空间**：长远可引入 `supabase migrations` CLI 或 `dbmate`。当前项目体量小，手工管理可接受。

---

## 5. Timestamp

| 项 | 规范 |
|---|---|
| 列类型 | `timestamptz`（timestamp with time zone），**不用** `timestamp without time zone` |
| 默认值 | `DEFAULT now()` 或 NULL（由业务决定） |
| 回填 | `COALESCE("createdAt", now())` — 优先沿用现有时间戳，缺失才用 now |
| 前端序列化 | ISO 8601（`new Date().toISOString()`），不用 Unix timestamp |
| 比较 | 数据库侧用 `<` / `>=`，不在应用层做时区转换 |

**反例（禁止）**：
```sql
-- ❌ 不带时区
ALTER TABLE foo ADD COLUMN bar_time timestamp;

-- ❌ 用 text 存时间
ALTER TABLE foo ADD COLUMN bar_time text;
```

---

## 6. Array 列

| 项 | 规范 |
|---|---|
| 列类型 | `text[]`（tags）/ `uuid[]`（id 列表）/ `jsonb` 若需结构化 |
| 默认值 | `DEFAULT '{}'`（空数组，非 NULL） |
| 前端兜底 | normalize 层用 `Array.isArray(x) ? x : []` 防御 |
| 插入 | 前端传 JS 数组，Supabase JS client 自动序列化 |

**本次实践**：`tags text[] DEFAULT '{}'`，`normalizeRecommended` 用 `Array.isArray(dbItem.tags) ? dbItem.tags : []` ✓

---

## 7. Safe Default + Backfill

**规则**：新增 NOT NULL 约束的列，必须：

1. 第一步 ADD COLUMN 允许 NULL（或带安全 default）
2. 第二步 UPDATE 回填历史数据
3. 第三步（可选，下期）ALTER TABLE ... SET NOT NULL

**反例（禁止）**：
```sql
-- ❌ 一步到位，历史数据必炸
ALTER TABLE recommended_content
  ADD COLUMN published boolean NOT NULL DEFAULT true;
-- 问题：若表已有 100 万行，此语句会长时间锁表，且 DEFAULT 值可能不符合业务语义
```

**正例（本次实践）**：
```sql
-- 1. 允许 NULL 的初始 ADD
ALTER TABLE recommended_content ADD COLUMN IF NOT EXISTS published boolean;

-- 2. 幂等 backfill（把既有记录当已发布）
UPDATE recommended_content SET published = true WHERE published IS NULL;

-- 3. 下期（若需要）再加 NOT NULL
-- ALTER TABLE recommended_content ALTER COLUMN published SET NOT NULL;
```

---

## 8. API Signature — 函数签名稳定性

**核心原则**：既有 `src/api/*` 函数签名 **永远不可改**，扩展只能通过：

1. 函数内部追加 payload 字段（可选、带 default）
2. 返回 shape 追加字段（additive）
3. 新增函数（如本次 `fetchRecommendedContentAdmin`）

**反例（禁止）**：
```js
// ❌ 改既有函数签名
export const addRecommendedContent = async (title, artist, cover) => ...  // 原来是 newItem object
// 破坏所有调用方
```

**正例（本次实践）**：
```js
// ✓ payload 追加可选字段，签名不变
export const addRecommendedContent = async (newItem) => {
  const payload = {
    ...existing_fields,
    // v2 additions — all optional
    cta_label: newItem.cta_label || null,
    pinned:    newItem.pinned    ?? false,
    // ...
  };
};
```

**新增函数而非改签名**：
- ✓ `fetchRecommendedContent()` — 公开 feed（`.eq('published', true)`）
- ✓ `fetchRecommendedContentAdmin()` — admin feed（含 drafts）— **新增函数**，不 override 旧的

---

## 9. RLS / Policy

| 项 | 规范 |
|---|---|
| 改 policy | 必须走 migration（up.sql + down.sql 配对） |
| 测试 | dev 环境先跑，production 前前端团队联调 |
| 开放 policy（`FOR ALL USING (true)`） | 仅限内部测试阶段，上线前必须收紧（待专项规划） |

**当前状态**：Uvera 所有表使用 `FOR ALL USING (true)` 开放 policy — 不碰，上线前由专项议题统一规划。

---

## 10. 法定对齐点（跨层决策清单）

以下决策一旦本规范签发即生效，后续变更需双方书面对齐：

| # | 决策 | 本次是否对齐 |
|---|---|---|
| 1 | DB 列 snake_case（新列），既有 camelCase 保留 | ✅ 本次 migration 验证 |
| 2 | 新 enum Title Case（`Video`/`Image`/`Live`） | ✅ `media_kind` |
| 3 | `media_kind` 权威、`type` legacy 状态 | ✅ 前端 normalize 已 fallback |
| 4 | Additive-only DB 变更原则 | ✅ 本次 9 列全 additive |
| 5 | `migrations/` 目录 + `up.sql` + `down.sql` 配对 | ✅ 本次建立 |
| 6 | 本次"前端跨越边界"为 **一次性临时协作**，非常态 | ✅ 双方共识 |
| 7 | `type` 列 deprecate 时间表 | ⏳ 待后续 milestone 规划 |
| 8 | `createdAt` → `created_at` 迁移时间表 | ⏳ 待后续 milestone 规划 |
| 9 | RLS policy 正式化时间表 | ⏳ 待专项 |
| 10 | API 错误响应 shape 统一（当前 `console.error` + throw 混用） | ⏳ 待专项 |

---

## Appendix A：合规样本 — `recommended_content v2` migration

本次 migration（`migrations/20260420_recommended_content_v2.up.sql` / `.down.sql`）作为 **本规范的参考实现**，后续类似变更可对照。

### 合规点

| 项 | 落实 |
|---|---|
| § 1 Naming | 9 个新列全部 snake_case（`cta_label`, `cta_url`, `cta_target`, `pinned`, `pin_order`, `published`, `published_at`, `media_kind`, `tags`） |
| § 2 Enum Casing | `media_kind` Title Case（`Video` / `Image` / `Live`）；legacy `type` UPPERCASE 保留 |
| § 3 Additive-only | 全部 `ADD COLUMN IF NOT EXISTS` + 安全 default；既有 `type` 列不动 |
| § 4 Migration 文件 | `20260420_recommended_content_v2.up.sql` + `.down.sql` 配对，含 header / pre-flight / backfill / verification |
| § 5 Timestamp | `published_at timestamptz`；backfill `COALESCE("createdAt", now())` |
| § 6 Array | `tags text[] DEFAULT '{}'` |
| § 7 Safe Default | `pinned DEFAULT false`；`published` 初始 NULL + backfill `true` |
| § 8 API Signature | `addRecommendedContent(newItem)` 签名不变，内部 payload 追加；新增 `fetchRecommendedContentAdmin()` 函数 |
| § 9 RLS | 未动 |

### 可改进空间（非阻断，未来同类变更可优化）

| # | 观察 | 建议 |
|---|---|---|
| 1 | `cta_target` 使用 `varchar(8)`，实际只存 `_self` / `_blank` | 可改用 CHECK 约束（`CHECK (cta_target IN ('_self','_blank'))`）或单独的 enum 类型；当前在 app 层校验也可接受 |
| 2 | `media_kind` 用 `varchar(16)` + 应用层校验值 | 同上，可升级为 CHECK 约束增强数据库层保证 |
| 3 | `pin_order` 无唯一约束 | 如业务要求 pin 顺序唯一，可加 `UNIQUE (pin_order) WHERE pinned = true` partial unique index |
| 4 | `published` 初始 NULL，backfill 后也仍然允许 NULL | 下期可加 `SET NOT NULL`，但需确保 insert 路径都传值 |
| 5 | backfill UPDATE 对大表会长事务 | 本表行数小（< 100），无影响；若未来行数 > 10k，应分批次 `WHERE id IN (batch)` |
| 6 | down.sql 未在 dev 实跑验证 | 建议上线前在 dev Supabase 实跑一次，确认无报错 |
| 7 | `tags` 无 GIN 索引 | 如 tags 过滤查询增多，可加 `CREATE INDEX ON recommended_content USING gin(tags)` |

### 执行记录

| 步骤 | 状态 | 链接 |
|---|---|---|
| Pre-flight probe | ⏳ 待执行（由后端贴执行结果） | — |
| up.sql 在 Supabase Dashboard 执行 | ⏳ 待执行 | — |
| 前端 build 验证 | ✅ `✓ built in 3.41s`（2026-04-20） | — |
| Dev server 手工验证 | ⏳ 待执行 | `http://127.0.0.1:5176/admin/dashboard` |
| down.sql dev 演练 | ⏳ 待执行 | — |

---

## Appendix B：后续规范化议题（排期待定）

这些议题超出本规范首版范围，列入 backlog：

1. **`type` 列正式 deprecate** — 引入 `type_v2` Title Case 或直接升级 `media_kind` 覆盖所有场景。
2. **`createdAt` → `created_at` 迁移** — 一次性 breaking migration，前后端同步。
3. **RLS policy 正式化** — 从 `FOR ALL USING (true)` 收紧到按 role / user scope。
4. **API 错误响应统一** — 所有 `src/api/*` 返回 `{ ok: true, data }` / `{ ok: false, error }` shape。
5. **Migration 框架引入** — 评估 `supabase migrations` CLI / `dbmate`。
6. **DB schema 单一事实源（SoT）** — 当前 `supabase_init_schema.sql` + `alter_table.sql` + `migrations/*.sql` 三处散布，需合并或规范化。

---

## 联络

- **甲方（frontend）**：Leon（leonsuen@gmail.com）
- **乙方（backend）**：feifeixp

规范解释权暂由甲方维护，正式版签发后由双方共管。


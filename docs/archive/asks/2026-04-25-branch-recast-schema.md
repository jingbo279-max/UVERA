---
title: 致费 · Branch 接龙 / Recast 出镜 授权字段 schema 对齐
type: ask
status: resolved
owner: Leon
created: 2026-04-25
updated: 2026-04-25
tags: [ask, schema, branch, recast]
---

# 致费 · Branch 接龙 / Recast 出镜 授权字段 schema 对齐

> 发起人：Leon（前端团队） · 日期：2026-04-25
> 状态：**✅ 已落地（2026-04-25）** — 费授权我们直接做，按 Leon 倾向方案 1A + 2A 落地
> 紧迫度：低

## ✅ 落地清单（2026-04-25）

- Migration：[`migrations/20260425_branch_recast_authorization.up.sql`](../../../migrations/20260425_branch_recast_authorization.up.sql) +
  对应 down（4 列 ADD + 2 partial index）
- 前端规范化：[`src/utils/normalizeRecommended.js`](../../../src/utils/normalizeRecommended.js) 透传 `allowBranch` / `allowRecast` / `branchOfId` / `recastOfId` / `branchCount` / `recastCount`
- Publish handler：[`src/pages/StoryGeneratorPage.jsx`](../../../src/pages/StoryGeneratorPage.jsx) `handlePublishToFeed` 写入 `allow_branch` / `allow_recast`
- 待费补：**Branch / Recast 创建接口的 RLS 或后端校验**（详见本文 §3）— 不 block 当前发布流，但 block 后续 Branch / Recast 提交流落地

**剩下需要 Leon 在 Supabase Dashboard 跑一次：**
```sql
-- 直接 paste migrations/20260425_branch_recast_authorization.up.sql 整个文件到 SQL Editor
```

---

## 历史记录（仅供日后回溯，已被上方 ✅ 覆盖）

## 背景

两个新产品 feature 2026-04-25 定稿了英文术语和权限边界（详见 `docs/legal/COMPLIANCE.md`）：

| 术语 | 中文 | 定义 | 触发位置 |
|---|---|---|---|
| **Branch** | 接龙 | 他人基于我的作品续拍分支剧情（cross-author fork，可有多个并行） | 视频播放结束 overlay CTA |
| **Recast** | 出镜 | owner 本人用自己的 Avatar 替代别人作品里的角色（self-service） | Library 四象限之一 |

两者都需要作者在发布时 **opt-in 授权**（默认 OFF）。

## 现状

前端已落地：

1. `StoryGeneratorPage.jsx` 发布成功页新增"Publishing Settings"卡片，含 `Allow Branch` + `Allow Recast` 双 checkbox（默认 OFF）
2. SparkMode 视频播完 overlay 改为"Branch this story" CTA + social proof 行
3. 用户勾选状态目前只 `console.info`，**不写 DB**；`handlePublishToFeed` 还是老的 `update({ published, published_at })`

localStorage Branch draft schema（`uvera_story_draft`）已新增前端字段，不影响后端：
```json
{
  "transcript": "[Branch] Based on \"...\" by ...",
  "isContinuation": true,
  "isBranch": true,
  "sourceWorkId": "<原作品 id>"
}
```

## Schema 缺口

`recommended_content` 现有列里没有授权字段：
```
artist, aspect_ratio, audio, cover, createdAt, cta_label, cta_target, cta_url,
id, likes_count, media_kind, pin_order, pinned, published, published_at,
saves_count, tags, title, type, video, eyebrow(?)
```

Branch / Recast 的源作品追溯也没有字段（`branch_of_id` / `recast_of_id`）。

## 想讨论的 3 件事

### 1. 授权字段（核心）

#### 方案 A — 两列 boolean（推荐）

```sql
ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS allow_branch BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_recast BOOLEAN NOT NULL DEFAULT false;
```

- 语义清晰、查询简单（`WHERE allow_branch = true`）
- 加 partial index 方便 feed 筛选："可被 Branch 的作品"
- 回滚：`ALTER TABLE ... DROP COLUMN`

#### 方案 B — 一列 permissions JSONB

```sql
ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
-- { "branch": true, "recast": false }
```

- 未来扩展授权类型（比如 Allow Download / Allow Comment）不用再加列
- 代价：查询需 `permissions->>'branch' = 'true'`，索引相对麻烦

**Leon 倾向 A**：未来授权类型增加也就 2-3 个，加列开销不大，换来查询和索引的简洁。但你拍板。

### 2. 源作品追溯字段（用于 Branch / Recast 反查 + social proof 计数）

#### 方案 A — 源列放作品表（加列）

```sql
ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS branch_of_id UUID REFERENCES recommended_content(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recast_of_id UUID REFERENCES recommended_content(id) ON DELETE SET NULL;
```

- 反查容易：`SELECT count(*) FROM recommended_content WHERE branch_of_id = $1`
- SparkMode 的 `branchCount` 直接 aggregate

#### 方案 B — 独立关系表

```sql
CREATE TABLE branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_work_id UUID NOT NULL REFERENCES recommended_content(id) ON DELETE CASCADE,
  branch_work_id UUID NOT NULL REFERENCES recommended_content(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- 同构建 recasts 表
```

- Normalization 更干净，适合未来加授权元数据（like 时间戳 / License 版本）
- 代价：每条 Branch 多一次写入

**Leon 倾向 A（先用列反查，简单够用）**，如果未来需要带元数据再重构成表。

### 3. Backend 校验逻辑（non-negotiable）

**前端隐藏 CTA 不充分**。Branch / Recast 的创建接口必须服务端校验：

**Branch 创建时**：
```
源作品.allow_branch === true
```

**Recast 创建时**（两条都要过）：
```
源作品.allow_recast === true
AND
recaster 使用的 avatar.owner === current_user.id OR avatar.is_official === true
```

Avatar 归属校验对应 `docs/legal/COMPLIANCE.md` §1 红线（私有 Avatar 只能 owner 调用）。

## 前端接线计划（DB 拍板后）

**publishHandler 扩展**（即改即上，无 feature flag）：
```diff
  .from('recommended_content')
- .update({ published: true, published_at: new Date().toISOString() })
+ .update({
+   published: true,
+   published_at: new Date().toISOString(),
+   allow_branch: allowBranch,
+   allow_recast: allowRecast,
+ })
  .eq('id', insertedWorkId);
```

**SparkMode 的 `branchCount`** 从 `item.branchCount` 读（目前默认 0）。源字段建议方案 1-A 后：
```
branchCount = SELECT count(*) FROM recommended_content WHERE branch_of_id = $1
```

## 具体想让你回复的内容

- **方案 1（授权字段）**：A 两列 boolean / B permissions JSONB / 其他？
- **方案 2（追溯字段）**：A 源列加在作品表 / B 独立关系表 / 其他？
- **校验逻辑 (3)**：是否认可 backend 校验是必须？是否需要我们帮忙写 RLS policy 草案？
- **如果选方案 1-A**：方便的时候跑这条 SQL 在 Supabase Dashboard（不急）：
  ```sql
  ALTER TABLE public.recommended_content
    ADD COLUMN IF NOT EXISTS allow_branch BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS allow_recast BOOLEAN NOT NULL DEFAULT false;
  ```

## 关联

- 合规基准：`docs/legal/COMPLIANCE.md` §2 Branch / §3 Recast / §4 AI 训练边界
- Avatar 形象权红线：`docs/legal/COMPLIANCE.md` §1
- 已上线前端 UI：commit `33eb9ba`（frontend-only，值不入库）
- 上一个 schema 对齐案：`docs/collaboration/asks/2026-04-21-eyebrow-column.md`（已确定加列，供参考格式）

---

*@费 看到后回方案 1 / 方案 2 / (3) 的偏好即可。不赶，拍板后前端我们接线，无需你等。*

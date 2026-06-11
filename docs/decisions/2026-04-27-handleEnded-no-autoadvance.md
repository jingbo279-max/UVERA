---
title: handleEnded 去除 auto-advance — 保留 random branch + end-of-video CTA fallback
type: decision
status: active
owner: Leon
created: 2026-04-27
updated: 2026-04-27
tags: [decision, adr]
---

# handleEnded 去除 auto-advance — 保留 random branch + end-of-video CTA fallback

> **决策日期**：2026-04-27
> **触发 session**：主 session（Spark/Discover）
> **决策方**：Leon（产品决策）+ 费（代码执行）
> **状态**：⏳ 进行中（费在做 SparkMode.jsx 改动）

## 触发场景

Leon 真机反馈：
- 视频播完应停止
- 当前 [SparkMode.jsx:348-422](../../src/components/SparkMode.jsx) `handleEnded` 自动跳到 feed[index+1]，end-of-video CTA（Replay + Branch this story + "X branches so far"）永远没机会显示，整套 UX 等于废 UI
- Branch CTA 是 Spark 区别于普通 feed 的 hero feature，必须保留

## 决策

`handleEnded` 行为分支：

| 视频播完 | 行为 |
|---|---|
| 当前作品有 branch（DB 里有 `branch_of_id == current.id` 的子作品）| **随机播一个 branch**（费现有 random branch 逻辑保留） |
| 当前作品无 branch | **停止 + 显示 end-of-video CTA**（Replay 圆形按钮 + "Branch this story" pill + "Be the first to branch" 社交证明）|

**砍掉**：feed[index+1] 自动 advance（无关 branch 的纯顺序跳）。

## Branch 类型澄清（产品语义升级）

之前 memory `project_terminology_branch_continue.md`（2026-04-25）把 Branch 严格定义为"cross-author 续拍"，Continue 为"same-author 下一集"。

**Leon 2026-04-27 升级**：Branch 是**统一数据结构**（DB 字段 `branch_of_id`），按访问权限分 2 类：

| 类型 | 作者侧 | 谁能创建 | 心智模型 |
|---|---|---|---|
| **Type 1** | `allow_branch = false`（默认）| **仅作者本人** | "剧集模式" / serial — artist 自己的系列 |
| **Type 2** | `allow_branch = true`（作者主动开放）| **任意用户** | "分支剧情" — community fork |

两种在 DB 都用 `branch_of_id` 指针 + `allow_branch` 控制权限，技术统一。

随机播 branch 时，应**两种都进**池子（artist 自己的 + community 的，都当下一段视频）。

## 待 Leon 确认（UX 文案）

⚠️ Type 1 和 Type 2 在 UI 文案上是否区分？候选：

- **A. 统一**：所有 branch 都用 `Branch this story` / `Branches`
- **B. 区分**：
  - 作者看自己作品：`Continue this story` / `Episodes`（Type 1 语义）
  - 观众看作品（且 `allow_branch=true`）：`Branch this story` / `Branches`（Type 2 语义）

旧 memory 用 B 思路（Continue / Branch 分开）。Leon 新框架支持 A 或 B 都行，等 Leon 拍板。

## 实施细节

### 费侧改动（SparkMode.jsx 348-422）

砍掉 `if (feed[index + 1])` 那段（line 351-371，feed 内顺序 advance）。

保留：
- 后面的 supabase 查 branches + 随机播逻辑（line 373-415）— 适配 Type 1 + Type 2 都进池
- fallback 的 `setEndedIds + markAsWatched + setIsPlaying(false)`（line 418-421）— 无 branch 时显示 CTA

### 前端无需新代码

End-of-video CTA UI 已在 [SparkMode.jsx:725-794](../../src/components/SparkMode.jsx)（mobile）+ [:1019-1067](../../src/components/SparkMode.jsx)（desktop）有，由 `endedIds.has(item?.id)` 触发。费的改动只是让这个分支真的有机会进入。

## Branch 池子查询（费 confirm）

费当前查询 `tags @> ['#Parent:item.id']` 命中所有"基于此作品"的子作品。这应该自然包含 Type 1 + Type 2（不区分 allow_branch，只看父子关系）。Leon 决策"两种都进池"与现有查询逻辑一致，无需 SQL 改动。

## 关联

- 旧 memory：`~/.claude/memory/project_terminology_branch_continue.md`（2026-04-25 严格分 Branch / Continue，本决策修订为 Branch 双类型框架）
- 合规：`docs/legal/COMPLIANCE.md` §2 Branch 授权（仍适用，`allow_branch` 区分 Type 1/2）
- DB schema：`migrations/20260425_branch_recast_authorization.up.sql`（`recommended_content.allow_branch` + `branch_of_id` 已落地）

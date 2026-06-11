---
title: 跨 session 决策记录
type: decision
status: active
owner: Claude
created: 2026-04-26
updated: 2026-04-26
tags: [decisions, adr, index]
---

# 跨 session 决策记录

> 每条费授权 / 重大产品决策落到一份 markdown，文件名 `YYYY-MM-DD-<topic>.md`。
> 用于多 session 并发协作时的"广播信道"，session restart 后翻文件就能 catch up。

## 文件格式模板

```markdown
# <Topic 标题> — <决策结论一句话>

> **决策日期**：YYYY-MM-DD
> **触发 session**：Session N（哪个 session 暂停问的）
> **授权方**：费 / Leon / 法务 / ...
> **状态**：✅ 已落地 / ⏳ 进行中 / ⏸ 阻塞

## 触发 ask
原始征询：`docs/collaboration/asks/YYYY-MM-DD-<topic>.md`（已解决的归 `docs/archive/asks/`）

## 授权范围
费 / Leon 同意我们做什么、不做什么。明确 scope 边界。

## 实施细节
- 改动文件清单
- 关键 commit hash
- migration 文件（如有）
- API contract 变化（如有）

## 风险 / 待办
- 同步前后端契约：xxx
- 后续观察项：xxx

## 相关 memory / 文档
- ~/.claude/memory/xxx.md
- docs/legal/COMPLIANCE.md §x
```

## 历史记录

（按时间倒序，最新的在最上面）

### 2026-04-25 — Branch / Recast 授权字段 schema 落地（费授权直接做）
费回"授权我们直接做"，按 Leon 倾向方案 1A + 2A 落地。
- Migration: `migrations/20260425_branch_recast_authorization.up.sql`
- 通过 Supabase Management API 跑入 prod
- Frontend wiring: commit `a2a4c77`
- 详见 `docs/archive/asks/2026-04-25-branch-recast-schema.md`（顶部 ✅）+ `docs/legal/COMPLIANCE.md` §2 §3

> 此条决策日期早于本 directory 创建，未单独写 decision file，直接 link 到 ask 文档。
> 后续决策都按上面的模板单独建 file。

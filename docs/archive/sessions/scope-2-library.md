---
title: Session 2 — LibraryPage 全英化 + 视觉打磨
type: doc
status: archived
owner: Leon
created: 2026-04-26
updated: 2026-04-26
tags: [session, archive]
---

# Session 2 — LibraryPage 全英化 + 视觉打磨

> **角色**：子 session
> **职责**：Library 模块所有改动
> **不要写**：MEMORY.md / 设计 token / 共享组件 / API / DB

## 你的范围

### ✅ 你可以改
- src/components/LibraryPage.jsx（主战场）
- src/components/library/**（如需新建子组件）
- docs/library-*.md（如需新建文档）

### ❌ 你禁动
- index.jsx / src/main.jsx
- src/components/SparkMode.jsx / MasonryGrid.jsx / Hero.jsx / LightboxPlayer.jsx / GridPlayer.jsx
- src/pages/MobileProfilePage.jsx（Session 3）
- src/pages/StoryGeneratorPage.jsx（Session 4）
- src/pages/AuthPage.jsx
- src/design-system/tokens/**（含 iOS 16.7 fallback，不动）
- src/design-system/composites/**（共享组件，主 session 维护）
- ~/.claude/memory/**（只主 session 写）
- migrations/** + src/api/**（高危区，绝对不写）

### ⚠️ 谨慎
- src/api/avatarService.js / supabaseClient.js / interactionService.js — 只读，不改函数签名

## 当前状态（2026-04-26）

### Library 4 tab 已定稿
- Avatars / Works / Recasts（出镜）/ Drafts
- Recasts tab 用 VideoCamera icon
- LibraryPage.jsx ~540 行

### 出镜术语
- 英文：`Recasts`（noun plural）/ `Recast`（verb CTA）
- 禁用：`Cast as` / `Starring` / `Appearances`
- 详见 ~/.claude/memory/project_terminology_chujing.md

### 设计系统
- Tailwind v4 + 自定义 @theme tokens
- iPhone X iOS 16.7 兼容性 fallback 已在 src/design-system/tokens/index.css，**不动**
- 用 Tailwind 工具类即可（不需要 inline style 绕开），fallback 已让所有工具类正常工作

### 语言政策（重要）
- UI 默认英文，禁止中英混用
- 模块定稿前所有 JSX 字符串字面量改英文
- 代码注释 / commit message 用中文 OK
- 详见 ~/.claude/memory/feedback_language_policy.md

## 本 session 任务

### 第一阶段：模块全英化
LibraryPage.jsx 至少 5 处中文 JSX 字面量需要改英文：
- L235 `尚无上传底模` → `No base avatars yet`
- L272 `新建形象` → `Create Avatar`
- L288 `尚无视频作品` → `No video works yet`
- L340 `尚无出镜作品 (No Recasts yet)` → `No Recasts yet`（去掉中文括号部分）
- L378 `尚无草稿` → `No drafts yet`
- L404 `风格: {draft.styleName}` → `Style: {draft.styleName}`

每改一处，先 `grep '[一-龥]' src/components/LibraryPage.jsx` 查残留。

### 第二阶段：视觉打磨（如果第一阶段顺手做完）
- 4 tab 切换的 hover / active 视觉一致性
- Empty state 排版（icon + title + subtitle 间距）
- Card grid layout（与 MasonryGrid 风格一致 — 但不改 MasonryGrid）

### 不要做
- 不要新增 Library backend API
- 不要改 DB schema
- 不要动术语（Recasts 已定稿）
- 不要改 ImageGen / VideoGen 流程（Create session 的事）
- 不要改 src/design-system/tokens/index.css 的 iOS 16.7 fallback

## 协作协议

### push 前必跑
```bash
git pull --rebase --autostash origin main
```

### MEMORY.md 不写
需沉淀的规则告诉 Leon "请 relay 给主 session"。

### 跨模块决策
- "这个按钮叫 X 还是 Y" / "这个 tab 应该叫什么" / 产品策略变化
- 暂停问 Leon 拍板，**不自作主张**

### 高危变更（DB / API / wrangler / RLS）
按 MEMORY.md "⚠️ 高危变更提醒规则"模板：

> ⚠️ **需要后端配合 — 暂停执行**
> 该需求需要 [描述]，属于 [DB schema / API signature / xxx]。
> 建议先与费（feifeixp）对齐，确认后再落地。是否继续？

Library 一般不会触发，但若需要新增 recast_meta / avatar_status 等字段，必须暂停。

## Session 启动检查

第一条消息你应该做：

1. `git status` 确认 main 干净
2. `lsof -i :5176 | grep LISTEN` 确认 dev server 起着
3. `grep -n '[一-龥]' src/components/LibraryPage.jsx | head -20`
   列出所有中文残留行，确认你的工作清单
4. 读 ~/.claude/memory/feedback_language_policy.md + project_terminology_chujing.md
5. 开始改第一处，每改完一处 build + commit + push（小步快跑，避免大冲突）

不要做出本 scope 之外的任何文件更改。如果发现需要跨 scope 改动，停下来告诉 Leon。

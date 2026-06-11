---
title: Session 4 — Create 模块（⚠️ 最敏感）
type: doc
status: archived
owner: Leon
created: 2026-04-26
updated: 2026-04-26
tags: [session, archive]
---

# Session 4 — Create 模块（⚠️ 最敏感）

> **角色**：子 session
> **职责**：Create 模块所有改动
> **特殊性**：依赖费的 Neodomain backend（src/api/neoaiService.js），费阶段性持续修改
> **不要写**：MEMORY.md / 设计 token / 共享组件 / API / DB / migrations

⚠️ 本 session 是所有 session 中**最敏感**的。任何 API signature / payload shape /
DB 字段 / localStorage key 变动都可能与费的 backend 不同步。MEMORY.md 高危变更
规则**严格适用**。

## 你的范围

### ✅ 你可以改
- src/pages/StoryGeneratorPage.jsx（主战场，~1280 行）
- src/components/InlineCharacterCreator.jsx
- src/data/styles.js（视频风格预设，前端常量）
- src/data/videoTags.js
- src/components/create/**（如需新建子组件）
- docs/create-*.md（如需新建文档）

### ❌ 你禁动
- src/api/neoaiService.js — **费的 backend 接口定义，绝对只读**
- src/api/supabaseClient.js — 只读 supabase / handleShareCredits / updateCredits
- index.jsx / src/main.jsx
- src/components/SparkMode.jsx / LibraryPage.jsx / MasonryGrid.jsx
- src/pages/MobileProfilePage.jsx
- src/pages/AuthPage.jsx
- src/design-system/tokens/**
- src/design-system/composites/**
- ~/.claude/memory/**
- migrations/**

### ⚠️ 改前必须暂停 + 告诉 Leon + 等费 align（高危规则触发）
- generateNeoAIScript / generateConceptDesign / generateVolcengineVideo /
  pollVolcengineVideoStatus / uploadUrlToCloudflareStream / uploadToSecureOSS /
  generateRandomIdeas 的调用 payload 形状变动
- recommended_content 表的字段读写变动
- 任何新增 backend endpoint 调用
- 任何写 localStorage 的 key 命名变动（uvera_story_draft / uvera_pending_video_task）

## 当前状态（2026-04-26）

### 已落地的关键功能

#### Branch / Recast 授权字段 schema 已入 prod
**commit a2a4c77 / migrations/20260425_branch_recast_authorization.up.sql**
- recommended_content 加了 4 列：allow_branch / allow_recast / branch_of_id / recast_of_id
- handlePublishToFeed 已写入 allow_branch + allow_recast（line ~641-668）
- Publishing Settings 双 checkbox UI 已在 line 1183-1240（renderProgress === 4 block）
- 详见 docs/legal/COMPLIANCE.md §2 §3

⏳ 待费完成的 backend：
- /api/branch/create 接口的 RLS / 校验
- /api/recast/create 接口的 RLS + Avatar 归属校验
- 这些是费的工作，**你不写**

#### Continue / Branch 术语
**commit 33eb9ba**
- StoryGeneratorPage 的"What's next?"按钮（line ~1142-1163）现在写"Continue
  this story"（same-author 续集，写到 localStorage 的 uvera_story_draft 触发
  页面 reload + isContinuation flag）
- Branch（cross-author 续拍）用在 SparkMode 视频结束态，不在 Create 流程里

#### renderProgress === 4 done state 全英化
**commit 33eb9ba**
- Generation complete / Publish to World Feed / Start a new creation /
  Publishing… / Continue this story 等
- step 0-3 仍有大量中文 JSX 字面量待清理

### iOS 16.7 兼容性
- Tailwind v4 spacing/color/radius token 已通过 unlayered :root fallback
  在 src/design-system/tokens/index.css 注入（commits 90d7ea5 / 7c04abd / 017bf5b）
- **不要碰 design-system 这个 fallback 块**

## 本 session 任务

### 第一阶段：现状审计
1. `git status` + `lsof -i :5176 | grep LISTEN`
2. 读 src/pages/StoryGeneratorPage.jsx 全文，理解当前 6 步流程：
   - Character Select（step 0）
   - Transcript Input（step 1）
   - Style Selection（step 2）
   - Concept Preview（step 3 / renderProgress 1.5）
   - Render（renderProgress 2-3.5）
   - Done with Publishing Settings（renderProgress === 4）
3. `grep '[一-龥]' src/pages/StoryGeneratorPage.jsx` 列出所有中文字面量
   （应该还有几十处，集中在前面几步的 UI label）
4. 读 src/api/neoaiService.js（只读，建立 backend 接口契约的认知）

### 第二阶段：模块逐步全英化
按 step 顺序，从 step 0 开始往后清理中文 JSX 字面量。每个 step 一次 commit。

### 第三阶段：UI 打磨（如时间允许，与 Leon 对齐优先级）
- 进度指示器视觉
- Style 选择卡片排版
- Concept Preview 容器
- Video model selector UI

### 不要做
- ⚠️ **不要改 API 调用形状**（generateNeoAIScript() 接受什么参数、返回什么
  结构都不动）
- ⚠️ **不要改 supabase update 字段**（除非已存在的字段）
- ⚠️ **不要新增 localStorage key**（uvera_story_draft / uvera_pending_video_task
  contract 不动）
- 不要重写整个 step machine（费在 Neodomain 那边可能依赖某些状态时序）
- 不要改 sharing flow（handleShare / handleShareCredits）

## 协作协议

### push 前必跑
```bash
git pull --rebase --autostash origin main
```
**特别重要**：费可能在我们工作期间往 main push backend 改动，rebase 必须。

### 触及 src/api/* 的任何想法
**立即停下来用 MEMORY.md 模板提醒 Leon**：

> ⚠️ **需要后端配合 — 暂停执行**
> 该需求需要 [描述具体改动]，属于 [DB schema / API signature / xxx]。
> 建议先与费（feifeixp）对齐，确认后再落地。是否继续？

Leon 会决定怎么走（参考 docs/archive/sessions/README.md 路径 A/B/C）。

### MEMORY.md 不写
需沉淀的规则告诉 Leon relay。

### 跨模块决策
- 产品流程 / 术语 / 文案变动 → 暂停问 Leon
- Create 涉及视频生成、AI 模型、积分扣费等业务逻辑，跨边界变动很常见，**宁可问**

### 发现 bug 涉及 backend
写到 docs/asks/2026-04-XX-create-bug-<topic>.md 报给 Leon，由 Leon 决定 relay
给费。**不要直接动 src/api/***。

## Session 启动检查

第一条消息你应该做：

1. `git status` + `lsof -i :5176 | grep LISTEN` 确认环境
2. 读 src/pages/StoryGeneratorPage.jsx 全文 + src/api/neoaiService.js 读懂
   API contract
3. 读 ~/.claude/memory/feedback_language_policy.md +
   project_terminology_branch_continue.md +
   docs/legal/COMPLIANCE.md §2 §3（Branch / Recast 授权契约）
4. 列出本 session 想做的 3-5 件事 + 优先级排序，等 Leon 拍板先做哪件
5. **不要直接动手改任何代码** —— 等 Leon 给具体指令。Create 是高敏感 session，
   主动改容易踩雷

不要做出本 scope 之外的任何文件更改。如果发现需要跨 scope 改动，停下来告诉 Leon。
特别提醒：API 调用形状 / DB 字段 / localStorage key — 任何怀疑都暂停问 Leon。

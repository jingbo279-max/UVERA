---
title: Session 3 — Profile + Subscription
type: doc
status: archived
owner: Leon
created: 2026-04-26
updated: 2026-04-29
tags: [session, archive]
---

# Session 3 — Profile + Subscription

> **角色**：子 session
> **职责**：Profile 模块 + Subscription / Upgrade Plan 模块所有改动
> **不要写**：MEMORY.md / 设计 token / 共享组件 / API / DB
>
> **2026-04-29 scope 扩展**：Subscription 模块（SubscriptionPage 本体 + 相关
> Upgrade Plan UI）从主 session 兜底状态正式归入 Session 3。Profile 内的
> Upgrade CTA 与 Subscription 页本体属于同一产品线（用户的账户设置 / 计划
> 管理），归一处维护更连贯。

## 你的范围

### ✅ 你可以改
- src/pages/MobileProfilePage.jsx（主战场，~207 行）
- src/pages/SettingsPage.jsx（profile 二级页）
- src/pages/profile/**（如需新建子文件）
- **src/pages/SubscriptionPage.jsx**（2026-04-29 加入 Session 3 scope）
- src/pages/subscription/**（如需 Subscription 页拆子组件 / 多级路由）
- docs/profile-*.md / docs/subscription-*.md（如需新建文档）

### ❌ 你禁动
- index.jsx（除非 BottomTabBar profile tab routing 有 bug；改前先告诉 Leon）
- src/main.jsx（路由）
- src/components/SparkMode.jsx / LibraryPage.jsx / MasonryGrid.jsx
- src/pages/StoryGeneratorPage.jsx（Session 4）
- src/pages/AuthPage.jsx
- src/design-system/tokens/**
- src/design-system/composites/**
- ~/.claude/memory/**（只主 session 写）
- migrations/** + src/api/**（高危区，绝对不写）

### ⚠️ 谨慎
- src/api/supabaseClient.js — 只读 user info / interactions，不改函数签名
- src/api/interactionService.js — likedItems / savedItems 接口稳定，不动

## 当前状态（2026-04-26）

### Profile 是 mobile BottomTabBar 4 tab 之一
- pill 形态：Discover / Library / Create + Profile（独立 pill）
- MobileProfilePage 当前结构：
  - Header：Avatar + username + email + stats（Following / Followers / Likes）
  - Tabs：Works / Liked
  - 内容区：MasonryGrid 渲染对应作品列表

### 最近修复（不要回退）
**commit e5d56c6**：profile section 加进 GridPlayer 渲染负面列表，避免 mini player
空 shell 漏出。这个修复在 index.jsx，**不要回退**也不要在 MobileProfilePage 里
重新挂载 GridPlayer。

### iPhone X iOS 16.7 兼容性
- 设计 token / 字体 / 色板都通过 src/design-system/tokens/index.css unlayered :root 注入
- MasonryGrid title overlay 用 inline style 绕开 min-w-0 calc bug（commit 691cd0f）
- 不要把 inline style 改回 Tailwind class
- Profile 调用 MasonryGrid 渲染作品列表，享受同样 fallback

### 术语
- Recasts（出镜）/ Avatars / Works / Drafts 是 Library 4 象限
- Profile 和 Library 共享这些术语
- Profile 用户卡片显示的"作品"也叫 Works
- 详见 ~/.claude/memory/project_terminology_chujing.md

### 语言政策
- UI 默认英文，禁止中英混用
- MobileProfilePage 现状已基本全英（Edit Profile / Following / Followers / Likes /
  Works / Liked / No works yet 等），需要扫一遍确认无残留中文
- 详见 ~/.claude/memory/feedback_language_policy.md

### Avatar 形象权红线（关键）
**docs/legal/COMPLIANCE.md §1**：私有 Avatar 只能 owner 本人调用，不可被他人使用 / 训练。
官方公共 Avatar 是唯一例外（平台持 license）。

任何涉及"展示他人 Avatar / 提取他人形象 / Avatar 训练"的功能必须**暂停 + 告诉 Leon**，
确保不越红线。

## Subscription / Upgrade Plan 模块（2026-04-29 加入 scope）

### 涉及文件
- `src/pages/SubscriptionPage.jsx` — Subscription 页本体（plan / 价格 / 支付）
- `src/pages/subscription/**` — 如需子组件 / 多级路由
- 入口 CTA：Profile 内的 "Upgrade plan" / Settings 内 "Manage subscription" /
  MasonryGrid 内 `UpgradePromoCard`（**注意**：UpgradePromoCard 在
  `src/components/MasonryGrid.jsx` 里，**属主 session scope**，你**不动**它的
  视觉/位置；但它点击的目标 navigate('/subscription') 是你的页面）

### 上下文
- Subscription 页之前无 owner，主 session 兜底但未深动
- Profile 内已有 Upgrade CTA 占位（点击跳 /subscription）
- 现整合：Profile session 同时维护 Subscription 页 — 用户账户 / 计划是同一
  心智模型

### 关键约束
- ⚠️ **支付相关**：任何接入支付服务（Stripe / Apple IAP / 微信支付等）都
  涉及 backend + 合规，触发"高危变更暂停规则"（见 MEMORY.md），必须 Leon
  + 费 + 法务对齐后再动
- ⚠️ **DB schema**：subscription / billing 表 schema 变动同样高危，暂停
- ✅ **纯前端展示 / 静态 plan UI**：你可以做（plan 卡片 / pricing tier /
  feature 对比表 / 假按钮占位），不接真正的支付
- ⚠️ Subscription 状态读写（`users.subscription_tier`, `subscription_expires_at`
  等字段）：先确认这些 DB 列是否已存在；不存在就先做静态 UI，等 DB 落地
  再接

## 本 session 任务

### 第一阶段：现状审计
1. `grep '[一-龥]' src/pages/MobileProfilePage.jsx src/pages/SubscriptionPage.jsx` 确认无中文残留
2. 在 5176 端口（dev server）打开 profile + /subscription 看现状视觉
3. 列出待优化点

### 第二阶段：可能的功能增强（与 Leon 对齐后再做）
- Edit Profile 真实编辑（目前点击跳 settings 占位）
- 关注 / 粉丝列表二级页
- 自己作品 vs 喜欢的作品 切换交互细节
- Avatar 上传 / 切换（注意：私有 Avatar 涉及 §1 红线，必须读完 docs/legal/COMPLIANCE.md §1 §3 再设计）
- Subscription 页 plan 卡片视觉 / pricing tier 对比表
- Subscription 当前状态展示（仅 UI；接 DB 等 schema 确定）
- Upgrade flow UI（按钮 / 跳转 / 占位 modal — 真正支付不接）

### 不要做
- 不要新增 Profile / Subscription backend table（除非和 Leon 对齐）
- 不要接真正的支付服务（Stripe / IAP / 微信支付）— 高危
- 不要改 BottomTabBar（共享组件，主 session 管）
- 不要改 `src/components/MasonryGrid.jsx` 的 UpgradePromoCard（主 session scope）
- 不要把 GridPlayer 加回 profile 渲染列表
- 不要触及他人 Avatar 形象（红线）

## 协作协议

### push 前必跑
```bash
git pull --rebase --autostash origin main
```

### MEMORY.md 不写
需沉淀的规则告诉 Leon relay。

### 触及他人 Avatar / 作品 的功能
必须先读 docs/legal/COMPLIANCE.md §1 §3 再设计。私有 Avatar 红线不可越。

### 跨模块决策
"profile 应该展示 X 还是 Y" → 暂停问 Leon。

### 高危变更
按 MEMORY.md "⚠️ 高危变更提醒规则"模板暂停 + 提醒 Leon + 等费 align。

## Session 启动检查

第一条消息你应该做：

1. `git status` + `lsof -i :5176 | grep LISTEN` 确认环境
2. 读 src/pages/MobileProfilePage.jsx 全文（约 207 行）建立模型
3. 读 docs/legal/COMPLIANCE.md §1 §3（Avatar 形象权红线 + Recast 出镜契约）
4. 读 ~/.claude/memory/feedback_language_policy.md + project_avatar_rights.md
5. 跑 `grep '[一-龥]' src/pages/MobileProfilePage.jsx` 看有无残留中文
6. 列出当前 profile 页面的 visual + functional 待优化点（不超过 8 项），等
   Leon 决定先做哪个

不要做出本 scope 之外的任何文件更改。如果发现需要跨 scope 改动，停下来告诉 Leon。

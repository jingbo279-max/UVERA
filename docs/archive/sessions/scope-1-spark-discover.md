---
title: Session 1 — Spark / Discover / 用户主体验 + 中央协调
type: doc
status: archived
owner: Leon
created: 2026-04-26
updated: 2026-04-26
tags: [session, archive]
---

# Session 1 — Spark / Discover / 用户主体验 + 中央协调

> **角色**：主 session（master）
> **职责**：iPhone X 兼容性收尾 + Spark/Discover/用户主体验 + 中央协调
> **唯一写权**：MEMORY.md / 设计系统 token / index.jsx / 跨 session 决策

## 你的范围

### ✅ 你可以改
- src/components/SparkMode.jsx
- src/components/MasonryGrid.jsx（Discover 主组件）
- src/components/Hero.jsx
- src/components/LightboxPlayer.jsx
- src/components/GridPlayer.jsx
- src/components/Header.jsx / Sidebar.jsx
- src/design-system/**（设计 token / 玻璃 / 按钮 / 动画 / 主题）
- src/design-system/tokens/index.css（含 iOS 16.7 unlayered :root fallback）
- src/design-system/composites/**（NavigationBar / BottomTabBar / SegmentedControl 等）
- index.jsx / src/main.jsx（root layout / 路由）
- docs/legal/COMPLIANCE.md / docs/sessions/** / docs/decisions/**
- ~/.claude/memory/**（**唯一写权**）

### ⚠️ 协调写
- src/api/*（任何变动需触发"⚠️ 需要后端配合"模板，与费对齐）
- migrations/*（同上）

### ❌ 子 session 的 scope（除非主动协调，否则不动）
- src/components/LibraryPage.jsx → Session 2
- src/pages/MobileProfilePage.jsx → Session 3
- src/pages/StoryGeneratorPage.jsx → Session 4

## 当前状态（2026-04-26）

### iPhone X iOS 16.7 兼容性已落地
位于 src/design-system/tokens/index.css 顶部的 unlayered `:root { ... }` block：
- `--spacing: 0.25rem`
- `--font-family-sans`（覆盖 Tailwind v4 @theme silent-drop）
- `--color-label-*` / `--color-background-*` / `--color-accent` / `--color-fill-*` / `--color-channel-*`
- `--color-white / --color-black` + Tailwind palette 50+ shade（red / amber / blue / emerald / indigo / violet / pink / slate / gray / stone）
- `--radius-sm/md/lg/xl/2xl/pill/glass`

**任何 design-system 改动都要确保不破坏这块 fallback**。

### Spark/Discover IA-v2 已落地
- Spark 合并到 Discover immerse 态（不再独立 nav item）
- Mobile 默认 immerse，Desktop 默认 browse
- BottomTabBar 3 + 1：Discover / Library / Create + Profile pill
- SparkMode fullscreen 状态机：playing→全藏 chrome / paused→显 Header+Sound+Full+视频控件 panel
- 视频控件 panel：title / 进度条（可拖拽）/ time / 倍速 / 横屏 hint

### Branch / Recast 授权字段已入库
- recommended_content 加了 allow_branch / allow_recast / branch_of_id / recast_of_id
- frontend handlePublishToFeed 已写入授权字段
- ⏳ 待费完成 RLS / Branch/Recast 创建接口的服务端校验

## 本 session 优先任务

### 持续任务（优先级最高）
1. **iPhone X 真机回归**：每次有大改动前后，让 Leon 真机看一眼，确保 fallback 没破
2. **跨 session 决策仲裁**：其他 session 暂停问的产品 / 术语 / 后端契约决策
3. **MEMORY.md 维护**：吸收其他 session relay 的规则沉淀，写入 topic 文件 + 索引

### 当前积压
- LightboxPlayer 类似 SparkMode 的 fullscreen 状态机改造（可暂缓，等 SparkMode 真机验证稳定）
- DEFERRED-DECISIONS 中条目的触发条件检查（D-001 ~ D-007）
- 检查 SparkMode 信息栏是否有残留中文（语言政策）
- iPhone 16 Pro 真机测试 Branch overlay + Publishing Settings UI

### 不要做
- 不要去碰 LibraryPage / MobileProfilePage / StoryGeneratorPage 的代码（除非全局 refactor 必须）
- 不要替子 session 做事（让它们自己做，主 session 只协调）

## 协作协议

### 接收子 session 的 relay
当 Leon 转 message 说"Session N 触发了 ⚠️ 暂停"，按 docs/archive/sessions/README.md 的
路径 A/B/C 分流：

**A. 费授权直接做**：
1. 写 docs/decisions/YYYY-MM-DD-<topic>.md
2. 判断改动归属：中央性 → 自己做；子 session scope → relay 回去
3. 更新对应 docs/asks/<file>.md ✅ 状态
4. 写 MEMORY.md（如有新规则）

**B. 费已 push backend**：
1. 拉 main 看 commit
2. 看是否影响子 session 当前任务
3. 必要时 relay 子 session 注意点

**C. 费要做但未做**：
1. 写 docs/governance/DEFERRED-DECISIONS.md 新增 D-XXX
2. relay 子 session 跳过

### 处理 git 冲突
若两 session push 同文件：
- `git log --all --oneline` 查时间线
- 决定 revert 后写 / merge / 手动协调
- 必要时让 Leon 介入

## Session 启动检查（每次主 session 启动）

```bash
git status
git log --oneline -10
lsof -i :5176 | grep LISTEN || echo "DEV SERVER DOWN"
ls docs/decisions/ | tail -5    # 最近的决策
ls docs/asks/ | tail -5         # 最近的征询状态
```

读 docs/archive/sessions/README.md 确认协议。

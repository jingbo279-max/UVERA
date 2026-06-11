---
title: Immersive Playback 强制 Dark — 不参与 theme switching
type: decision
status: active
owner: Leon
created: 2026-05-06
updated: 2026-05-06
tags: [decision, adr]
---

# Immersive Playback 强制 Dark — 不参与 theme switching

> **决策日期**：2026-05-06
> **触发**：Leon 询问 desktop SparkMode 是否需要做 light/dark mode
> **决策方**：Leon
> **状态**：✅ Dark only（不参与全局 theme switching）

## 背景

2026-04-29 项目确立了 dual-track design system：iOS+iPadOS 体系（< 1312px）vs Desktop visionOS 体系（≥ 1312px），各支持 light / dark 两个 mode（详见 `2026-04-29-dual-track-design-system.md`）。

SparkMode（沉浸式视频播放）作为产品里的独立模态体验，是否同样应该跟随全局 theme 切换？需要单独决策。

## 决策

**SparkMode 在 desktop 和 mobile 上**都**强制 dark mode**，**不响应**全局 light/dark 切换。在用户开启 light theme 时，SparkMode 仍走 dark 视觉栈。

## 论据

### 1. 行业 cinema 约定（核心理由）

immersive video playback 的所有主流实现都是 force dark：

| 平台                   | 模式       |
| ---------------------- | ---------- |
| TikTok（mobile + web） | Force dark |
| Instagram Reels        | Force dark |
| YouTube Shorts         | Force dark |
| Apple Music immersive  | Force dark |
| visionOS 视频 app      | Force dark |
| Netflix / Disney+ etc. | Force dark |

Immersive video 心智 = 影院。影院只有暗的。用户对此已有强 prior。

### 2. 视觉减负

视频是主角。Dark UI 不抢视频色彩；Light UI 周围都是亮的反而干扰视频画面感知（白屏让视频显得灰）。

### 3. 现有视觉栈基于 dark 设计

Desktop SparkMode 当前视觉栈都为 dark backdrop 调过：

- Modal halo `#131726`（暗 ambient）
- Glass tier T0 / T-1a / T-1b 的 specular gradient stops、inset shadow alpha、ambient drop shadow alpha — 全部基于 dark backdrop 平衡
- Right pane Figma node 139:23912 `#808080` luminosity glass — 在亮 backdrop 下 mix-blend luminosity 失效
- Bottom control bar `rgba(255,255,255,0.10)` light frosted — 配 dark 视频底色出 frost 感；light backdrop 下会变成"白盖白"

光是把这些 spec 翻译成 light variant 就需要：6 条独立 spec × 2 主题 = 12 条 spec，每条都要 Q&A 调到位。投入大，用户感知模糊（用户期望 cinema 就是 dark）。

### 4. 跨端一致

Mobile SparkMode 同样 force dark — 全屏视频铺满，BottomTabBar 都让位。Desktop 给 light 选项而 mobile 不给会导致跨端不一致。

### 5. dual-track 决策的真实意图

2026-04-29 dual-track 决策针对的是**应用 UI 区**（账户 / 创作 / 浏览 / Profile / Subscription / Settings 等），不是 immersive playback。Immersive 是产品里独立的"模态体验层"，行业惯例就是 cinema dark。

## 边界

### 适用本决策（强制 dark）

- `SparkMode.jsx`（desktop + mobile）
- 未来可能新增的 immersive playback overlay（Lightbox 全屏态 / Cinema mode / 全屏视频预览 等）

判断标准：**模态铺满 viewport + 视频是 hero focal**，即归 immersive，强制 dark。

### **不**适用本决策（按 dual-track 走 light/dark）

- `MasonryGrid` browse 态（Discover 瀑布流）
- `MobileProfilePage` / `SettingsPage` / `SubscriptionPage`
- `LibraryPage` / `StoryGeneratorPage`（Create 流）
- `Header` / `BottomTabBar` / `Sidebar` / `NavigationBar`
- 任何应用 UI / 账户区 / 浏览 feed

判断标准：**应用 UI / 账户 / 浏览 / 创作**，按 dual-track 双主题。

### 灰色地带

`LightboxPlayer.jsx` — 桌面端图片 / 视频 lightbox。如果是全屏铺满 + 关 back 才退出 → immersive 走 dark；如果只是个 modal 卡片在原页面上 → 跟全局 theme（dual-track）。当前实现是后者，所以**不在本决策范围**。未来如果改成全屏 cinema 风，自动归入本决策。

## 影响 / 不影响

### 不影响

- 当前 SparkMode 所有视觉 spec — 已经是 dark，无需改
- dual-track design system 主线 — 应用 UI 区继续按 light/dark 双轨

### 影响

- 未来在 SparkMode 内部实现"自动跟随系统 theme"的诉求 → 该诉求**不予实现**，按本决策回绝
- 任何在 immersive scope 内引入 light variant 的提案 → 触发本决策评估

## 关联

- `docs/decisions/2026-04-29-dual-track-design-system.md` — 双轨主体决策（本决策是其例外说明）
- `docs/decisions/2026-05-03-glass-tier-system.md` — Glass tier 系统（T0 / T-1a / T-1b 全部基于 dark immersive 上下文设计）
- `src/components/SparkMode.jsx` — desktop + mobile immersive 实现
- `index.jsx` — modal wrapper（dark `#0B0E15` halo bg + radial gradient）

## 后续 action

无立即 action。本决策为"现状沉淀 + 例外明确"，无代码改动。后续如有人提"SparkMode 加 light mode" 需求，引用本文件回绝；如要重审，新起决策文档。
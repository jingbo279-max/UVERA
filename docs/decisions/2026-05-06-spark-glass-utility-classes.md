---
title: Spark Desktop Glass — Utility Class 系统化（Phase 1）
type: decision
status: active
owner: Leon
created: 2026-05-06
updated: 2026-05-06
tags: [decision, adr]
---

# Spark Desktop Glass — Utility Class 系统化（Phase 1）

> **决策日期**：2026-05-06
> **触发**：Leon "整理规范化 style / token / 组件"
> **决策方**：Leon
> **状态**：✅ Phase 1 已落地（CSS class 抽离）

## 背景

Desktop SparkMode 在多轮视觉打磨（A1–B2、Tier 系统、visionOS Text、Right
pane Phase A、user photo / follow / share 真实化）后样式基本稳定。
SparkMode.jsx 累积了大量 inline `rgba()` 数值（64 处）+ 7 处 inline
multi-layer `boxShadow`，重复模式明显，需要系统化抽离让其他模块（Profile /
Subscription / Comments / 未来 desktop dark glass 场景）能复用同一套语言。

## Phase 1 决策

仅做 **CSS class 抽离 + 命名规范化**，不动组件 API、不拆分文件。优先级
最高的 4 个 utility classes 落地，每个对应一类反复出现的视觉模式。

### 已抽 4 类 utility classes（写入 `src/design-system/tokens/glass.css`）

| Class | 用途 | Spark 应用 | 视觉特征 |
|---|---|---|---|
| `.glass-liquid-hero` | T0 hero（80x80 圆形 primary CTA） | Center Play / Replay | 4-layer bg gradient + 5-shadow recipe（meniscus ring + 双高光点 + crisp rim + ambient float） |
| `.glass-frosted-no-edge-light` | T-1b 浅色无边变体（panel 锚定） | Bottom control bar | Figma spec: `Fill #fff 10% + Background Blur Uniform 92` (CSS = blur 46) |
| `.surface-sunken` | 输入框/文本域下沉（visionOS carved-in） | Comment input pill + textarea | bg black@18 + inset 顶部内阴影 + 底部微高光 |
| `.glass-pane-container` | 大 panel 容器（specular gradient + 浅灰 bg + blur） | Right info pane | 170° specular border + ::before 伪元素 bg fill (rgba(128,128,128,0.3) blur 50px) + drop shadow + inset edges |

### 已存在 utility classes（保留）

| Class | Tier | Spark 应用 |
|---|---|---|
| `.glass-frosted-edge` | T-1a | Close / Prev / Next / Speed popup |
| `.glass-frosted-no-edge` | T-1b dark | （SparkMode 暂无 dark 应用，留作未来 panel-tier 复用） |

### 已用 token（视觉语义）

- **Vision text**: `--color-vision-{primary,secondary,tertiary,quaternary}` —
  visionOS Text vibrancy palette
- **Radius scale**: `--radius-{sm,md,lg,xl,2xl,pill,glass}` (复用项目已
  定义)

## 命名规范

格式：`{system-prefix}-{category}-{variant}`

| Prefix | 分类 |
|---|---|
| `glass-` | 玻璃效果（带或不带 backdrop-filter） |
| `surface-` | 表面状态（如 sunken / raised — 视觉立体感）|
| `text-vision-*` | visionOS 文字层级 |
| `--radius-*` | 圆角尺度 |

子分类：
- `glass-liquid-*` — T0 Liquid Glass family
- `glass-frosted-{edge,no-edge}-{light?}` — T-1a / T-1b family
- `glass-pane-*` — 大面板容器
- `surface-{sunken,raised}` — 表面深度

## Tier 系统（更新汇总）

| Tier | 角色 | Class / 实现 | 应用 |
|---|---|---|---|
| **T0 Liquid Glass hero** | Primary CTA | `.glass-liquid-hero` | Center Play / Replay (80x80) |
| **T-1a Frosted with edge** | Supporting floating control | `.glass-frosted-edge` | Close (40) / Prev (64×40) / Next (64×40) / Speed popup |
| **T-1b dark Frosted no edge** | Future panel use | `.glass-frosted-no-edge` | （reserved） |
| **T-1b light Frosted no edge** | Anchored panel light tint | `.glass-frosted-no-edge-light` | Bottom control bar |
| **Container glass** | 独立面板容器 | `.glass-pane-container` | Right info pane |
| **Surface sunken** | 输入框 / 凹陷面 | `.surface-sunken` | Comment input |

## 不在 Phase 1 范围

| 项 | 原因 / 时机 |
|---|---|
| Phase 2 — 组件抽离（`<OverlayCtrlBtn>` / `<TagChip>` / `<CountActionBtn>` 等） | 等其他 session（UserProfilePage / Comments）需要复用时一起做，避免"为组件化而组件化"|
| Phase 3 — 拆分 SparkMode.jsx 文件 | 单文件 2400 行可读性问题真实，但移动/桌面共享大量 state；拆分需重新设计 props，工作量大、回报率不明显 |
| Mobile-side inline cleanup | 34 处 inline rgba 中大部分是 mobile track view 动态样式（gesture/animation/state-driven），不适合静态 class 化 |
| `--color-fill-*` family 规范化 | iOS systemFill 系列已有，未观察到与 vision-* 冲突 |

## 量化收益

| 指标 | Before | After | Δ |
|---|---|---|---|
| `SparkMode.jsx` inline `rgba()` 出现 | 64 | **34** | **-47%** |
| `SparkMode.jsx` inline multi-layer `boxShadow` | 7 | 1 (mobile floating indicator) | **-86%** |
| 重复"4 层 bg gradient + 5 shadow"内联块 | 2 (Center Play, Replay) | 0 (`.glass-liquid-hero`) | -2 |
| 重复"sunken inset shadow"内联块 | 2 (collapsed input, expanded textarea) | 0 (`.surface-sunken`) | -2 |

## Accessibility

新 classes 都加入 `glass.css` 的两个 media query block：
- `@media (pointer: coarse)` — 移动端降 blur 节省 GPU
- `@media (prefers-reduced-transparency)` — 退回不透明 fallback

## 关联文档

- `docs/decisions/2026-04-29-dual-track-design-system.md` — 双轨设计系统
  方向（mobile iOS / desktop visionOS）
- `docs/decisions/2026-05-03-glass-tier-system.md` — Tier 系统初版
- `docs/decisions/2026-05-03-liquid-glass-fidelity-deferral.md` — T0 CSS
  天花板讨论 + T3 canvas 触发条件
- `src/design-system/tokens/glass.css` — 全部 utility class 定义
- `src/design-system/tokens/index.css` — vision text + radius tokens

## 后续 action

- **Phase 2（按需）**：当 UserProfilePage / Comments / Subscription 需要复用
  Spark 同款视觉时启动组件抽离
- **Phase 3（暂不）**：拆 SparkMode.jsx 文件留待长期
- **跨 session 复用**：Profile / Subscription / 未来 desktop dark 场景应
  consume `.glass-pane-container` / `.glass-liquid-hero` / `.surface-sunken`
  等 utility class，避免 inline 复制

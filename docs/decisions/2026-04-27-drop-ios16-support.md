---
title: 放弃 iOS 16 / iPhone X 兼容性 — 测试基线变更
type: decision
status: active
owner: Leon
created: 2026-04-27
updated: 2026-04-27
tags: [decision, adr]
---

# 放弃 iOS 16 / iPhone X 兼容性 — 测试基线变更

> **决策日期**：2026-04-27
> **决策方**：Leon + 费 商议确定
> **状态**：✅ 已生效

## 背景

之前几天为修 iPhone X iOS 16.7 Safari 全站样式失效（Tailwind v4 `@layer theme`
silent-drop 导致 `--spacing` / `--color-*` / `--font-family-sans` / `--radius-*`
全部 fallback invalid，layout/字体/颜色/圆角全崩），加了多层 unlayered `:root`
fallback（commits 90d7ea5 / 7c04abd / 017bf5b / 691cd0f），CSS bundle 增量 ~2KB。

费和 Leon 商议后决定：**放弃 iOS 16 / iPhone X 支持**。新的支持基线见下。

## 新的浏览器支持基线

| 设备 / 平台 | 支持 |
|---|---|
| iPhone 16 Pro（iOS 18+，Safari 18+）| ✅ 主要真机测试目标，**费**用其测大改动 |
| 其他 iOS 17+ 设备 | ✅ |
| iOS 16 及更早（含 iPhone X iOS 16.7）| ❌ **不再支持** |
| Desktop 浏览器（Chrome/Edge/Safari/Firefox 当前版本）| ✅ |
| Desktop Chrome DevTools mobile emulator | ✅ Leon 主测环境（DevTools 模拟手机分辨率视口）|
| Android Chrome（最新版）| ✅ |

## 测试流程

| 测试场景 | 谁执行 | 工具 |
|---|---|---|
| 日常 visual / interaction（pre-commit） | Leon | Desktop Chrome DevTools mobile emulation @ 390×844（iPhone 14 标尺）|
| 大改动 / 特性发布前真机验收 | 费 | iPhone 16 Pro Safari |
| Desktop layout | Leon | Desktop Chrome 当前版本 |

## 对代码 / 现有 fallback 的处理

### 当前已有的 iOS 16.7 fallback 代码

**保留，不主动 rollback**。理由：
- 这些 fallback 在新 Safari 下**无害**（unlayered `:root` 重复定义 token，新浏览器
  cascade 仍按 layered 优先解析 `@layer theme`，fallback 充当无副作用兜底）
- 主动 rollback 会引入 churn，且若清理不完整反而引入 regression
- bundle 增量 ~2KB 可接受
- 等下一次 design-system 重构（迁移 Tailwind / 重构 token 体系）时一并清理

涉及的 fallback 代码（**不删**）：
- `src/design-system/tokens/index.css` 顶部 unlayered `:root` block
  （`--spacing` / `--color-label-*` / `--color-background-*` / `--color-accent` /
  Tailwind palette 50+ shade / `--radius-*` / `--font-family-sans`）
- `src/pages/AuthPage.jsx` 顶层 fixed/absolute 容器的 inline `top/right/bottom/left`
  替代 `inset: 0` 处（commit 5c0c013）
- `src/components/MasonryGrid.jsx` title overlay 的 inline `minWidth: 0` /
  `flex: '1 1 0%'`（commit 691cd0f）

### 未来代码

- **不**为 iOS 16 / 老 Safari 主动写新 fallback / inline-style 绕开
- **可以**直接用 Tailwind v4 工具类、`inset` 简写、`@layer theme` 等现代特性
- **可以**用 `oklch()` 颜色空间（Safari 16.4+ 支持，新基线满足）
- **可以**用 CSS Cascade Layers、`:has()` 选择器、`color-mix()` 等

## 涉及的文件 / 入口更新

### Memory 索引（`~/.claude/memory/MEMORY.md`）

加一条 reminder：iOS 16 / iPhone X 不再支持，未来代码不需绕开 Safari 16.x 特定
bug。详见本 decision file。

### CLAUDE.md

考虑加一行明确目标设备 / 浏览器支持基线（实际更新由 Leon 决定）。

## 影响范围

- ✅ Modal / 沉浸态 layout 后续迭代不再受 nested `position: fixed` iOS 16
  bug 困扰
- ✅ 设计系统 token 后续可大胆用 Tailwind v4 默认 oklch palette + 现代 CSS
- ✅ 进度条 / 视频控件等 UI 不再为 calc(var(--spacing) * N) 兜底操心
- ⚠️ 老用户（仍在用 iPhone X 等）打开站点会看到 layout 错乱 — 接受作为成本

## 关联

- 旧 fallback commits：`90d7ea5` / `7c04abd` / `017bf5b` / `691cd0f` / `5c0c013`
- 旧 troubleshoot 链路：`docs/archive/sessions/scope-1-spark-discover.md` 顶部 iPhone X
  fallback 守护责任 → 本决策后该责任**移除**
- Memory：`~/.claude/memory/feedback_*` / `~/.claude/memory/MEMORY.md`

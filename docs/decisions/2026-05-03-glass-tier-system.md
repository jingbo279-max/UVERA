---
title: Glass Tier System — Liquid Glass / Frosted 三级体系
type: decision
status: active
owner: Leon
created: 2026-05-03
updated: 2026-05-18
tags: [decision, adr]
---

# Glass Tier System — Liquid Glass / Frosted 三级体系

> **决策日期**：2026-05-03
> **触发**：Leon 反馈 SparkMode desktop 多个浮动控件都用 LG 级 spec，导致
> hero Play btn 注意力被分散。提出 tier 分级让 supporting 控件视觉降级。
> **决策方**：Leon
> **状态**：✅ 已落地（Q4 边缘样式留待最终）

## 背景

之前所有 SparkMode desktop 浮动控件（Close / Prev / Next / Replay / Speed
popup）都套 T1 LG dark spec — 都有 specular gradient border + 多层 inset
+ ambient shadow，视觉上"都很亮"，Play btn 作为 hero 反而不突出。

视觉等级缺位：所有控件都"同等亮"，没有主从关系。

## 决策

### 三级 tier 系统

| Tier | 名 | 视觉特征 | CSS 实现 | 应用 |
|---|---|---|---|---|
| **T0** | Liquid Glass (hero) | 多层 highlight + meniscus ring + specular 165° gradient stroke + crisp rim + multi-layer shadows，blur 弱 | inline T2 v3 spec（CSS 天花板，详见 `2026-05-03-liquid-glass-fidelity-deferral.md`）| Center Play (80) + Replay (80) |
| **T-1a** | Frosted with edge | dark frost bg + 中等 blur + simple 1px border + 弱 inset + 弱 ambient shadow，**无 specular gradient** | `.glass-frosted-edge` utility class | Close (40) + Prev (64×40) + Speed popup |
| **T-1b** | Frosted no edge | dark frost bg + 较强 blur + **无 border + 无 inset**，靠 blur 提供 frost identity | `.glass-frosted-no-edge` utility class | Next (64×40) — A/B vs Prev |

### Q1-Q3 Leon 拍板

- **Q1**: Replay 升 T0 与 Center Play 同步 — primary action 视觉一致
- **Q2**: Close 用 T-1a；**Prev → T-1a，Next → T-1b** 做 A/B 对比测试
- **Q3**: Speed popup 用 T-1a（归 supporting tier，不再 LG 级）

### Q4 留待

T-1a 的 edge 样式 placeholder = solid 1px white@22。最终决策三选一：

- (A) **simple linear gradient border**（如 `linear-gradient(180deg, white@30 0%, white@10 100%)`，比 T0 specular 简单）
- (B) **fade-to-transparent edge**（边缘由 inset shadow 营造）
- (C) **solid 1px** white@25-30（最简）

Q1-Q3 落地后 Leon 单独决定 Q4。

## 实现细节

### `glass-frosted-edge` (T-1a) spec

```css
.glass-frosted-edge {
  --_glass-bg:       rgba(0, 0, 0, 0.40);
  --_glass-blur:     18px;
  --_glass-saturate: 1.2;
  --_glass-border:   rgba(255, 255, 255, 0.22);  /* Q4 placeholder */
  background: var(--_glass-bg);
  backdrop-filter: blur(18px) saturate(1.2);
  border: 1px solid var(--_glass-border);
  box-shadow: 0 2px 6px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.12);
}
```

### `glass-frosted-no-edge` (T-1b) spec

```css
.glass-frosted-no-edge {
  --_glass-bg:       rgba(0, 0, 0, 0.40);
  --_glass-blur:     28px;  /* 比 T-1a 重，靠 blur 给 frost identity */
  --_glass-saturate: 1.1;
  background: var(--_glass-bg);
  backdrop-filter: blur(28px) saturate(1.1);
  border: none;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
}
```

### Dark mode + accessibility

两个新 class 都附带：
- `.dark` override — 加深 bg + 调 saturate
- `@media (pointer: coarse)` — 把 blur 降到 12-16px（移动设备性能）
- `@media (prefers-reduced-transparency)` — fallback 到不透明 dark bg

与现有 `.glass-regular-*` 系列同 convention。

### Bottom control bar（特殊）

不归这套 tier 系统，保持其 **Figma 自定 light frosted spec**（`rgba(255,255,255,0.10) + blur(46px)`）。原因：
- Bottom bar 是横贯视频底部的 panel，定位 + role 与 floating control 不同
- Figma 直接给了它特定 spec
- 无 edge 但 light tint，与 T-1b 的 dark tint 不同应用场景

未来如果要纳入 tier 系统，需扩展 `.glass-frosted-no-edge` 为 light/dark 双色变体或新增 `.glass-frosted-no-edge-light`。

## 视觉收益

### 之前
所有 5 控件都套 T1 LG → 全部"亮闪闪"，Play btn (80, T2 v3 hero) 不突出
特别。

### 之后
- 视频暂停 → Center Play (T0 hero) 单独亮，其他控件都是 muted T-1
- 视频结束 → Replay (T0 hero) 同样突出
- Close / Prev / Next / Speed popup 都 muted T-1，让 hero 当 focal point

主从关系建立。

## 关联

- `src/design-system/tokens/glass.css` — 新增 `.glass-frosted-edge` /
  `.glass-frosted-no-edge` + dark mode + accessibility
- `src/components/SparkMode.jsx` — 5 处控件改 className：
  - Center Play (line ~1645) — 保 T0 inline T2 v3
  - Replay (line ~1689) — 升 T0 inline T2 v3
  - Close (line ~1601) — 改 `.glass-frosted-edge`
  - Prev (in IIFE ~1745) — 改 `.glass-frosted-edge`
  - Next (in IIFE ~1745) — 改 `.glass-frosted-no-edge`
  - Speed popup (line ~1900) — 改 `.glass-frosted-edge`
- `docs/decisions/2026-05-03-liquid-glass-fidelity-deferral.md` — T0 实现
  天花板分析 + T3 暂缓
- `docs/decisions/2026-04-29-dual-track-design-system.md` — 双轨 design
  system 上下文（控件层 spec）
- `~/.claude/memory/MEMORY.md` — design system tier 应该沉淀到 memory（待 Leon
  授权）

## 后续 action

- **Q4**：Leon 决定 T-1a edge 最终样式（A/B/C 三选一）→ 改一处
  `.glass-frosted-edge` 的 border 即可全 instance 同步生效
- **A/B 测试**：Prev 看 T-1a，Next 看 T-1b，Leon 看哪个更适合，再统一
- **bottom control bar tier 化**：可选，未来扩展 light frosted variant

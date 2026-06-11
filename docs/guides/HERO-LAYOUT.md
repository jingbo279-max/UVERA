---
title: Hero 卡片布局规范
type: doc
status: active
owner: Claude
created: 2026-04-21
updated: 2026-04-21
tags: [guide, hero, layout]
---

# Hero 卡片布局规范

> Pinned Hero card 视觉定位标准 · 2026-04-21 落地
> 组件：`src/components/MasonryGrid.jsx` `HeroCard`

---

## 问题背景

Pinned Hero card 在不同屏幕尺寸下高度差异极大：
- iPhone X（390×812）：`aspect-video` → 高约 220px
- Desktop：`h-[min(52vh,480px)]` → 480px 上限

若把 title 和 CTA 都塞进一个 flex container 垂直居中，title 位置会随 Hero 高度漂移，在小屏上与 CTA 视觉挤压，在大屏上又显得空旷。

## 设计决策

**Title 的垂直中心永远锚定在 Hero 高度的上黄金分割线（38.2%）**，CTA 锚定底部。两者各自定位，不互相挤压。

```
┌─────────────────────────────┐  ─┐
│                             │   │
│                             │   │ 38.2%
│                             │   │
│      ── Title center ──    ─┼── ┘
│                             │
│                             │
│                             │
│       [ CTA button ]        │
│                             │   ↕ bottom: 24px (小屏) / 40px (桌面)
└─────────────────────────────┘
```

**理论依据**：
- 上黄金分割点（38.2%）是视觉重心的经典构图位置，比几何中心（50%）更符合"主体位于上半部分"的阅读直觉
- Apple HIG、平面设计三分法、摄影黄金构图均采用类似比例
- 百分比定位让 title 位置随 Hero 高度等比缩放，而不是被 flex 重分布挤压

## 实现

```jsx
{/* Title — 垂直中心锚定在 Hero 高度的上黄金分割点 (38.2%) */}
<div
  className="absolute left-0 right-0 text-center pointer-events-none flex justify-center"
  style={{
    top: '38.2%',
    transform: 'translateY(-50%)',   // 关键：让 top 指代中心而非上边缘
    padding: isSmallScreen ? '0 16px' : '0 48px',
  }}
>
  <h2 style={{ fontSize: isSmallScreen ? '1.5rem' : '2.5rem', ... }}>
    {item.title}
  </h2>
</div>

{/* CTA — 锚定底部中间 */}
<button
  className="absolute left-1/2 -translate-x-1/2 ..."
  style={{
    bottom: isSmallScreen ? '24px' : '40px',
    ...
  }}
>
  {item.ctaLabel}
</button>
```

### 关键点

| 项 | 值 | 原因 |
|---|---|---|
| `top` | `38.2%` | 上黄金分割比例 `1 - 1/φ ≈ 0.382` |
| `transform` | `translateY(-50%)` | 让 `top` 指代**中心**，元素自身高度无关 |
| CTA `bottom` | 24px / 40px | 绝对像素，不随 Hero 高度漂移 |
| Title `maxWidth` | `16ch`（小屏） | 超长 title 在均衡点换行，避免末字单独成行 |
| Title `textShadow` | `0 2px 16px rgba(0,0,0,0.35)` | 叠在 video/image 上的可读性保障 |

### 为什么不用 flex 容器

```jsx
// ❌ 不推荐：title + CTA 都在 flex container 里居中
<div className="absolute inset-0 flex flex-col items-center justify-center">
  <h2>{title}</h2>
  <button>{cta}</button>   {/* 两者互相推挤，title 位置随 CTA 存在与否漂移 */}
</div>
```

上面写法的问题：
- Hero 高度变化时，title 和 CTA 同步漂移，视觉锚点不稳
- title 的"上黄金分割"位置会被 CTA 的存在打破
- 小屏上 title + CTA 组合高度容易溢出或挤压

本方案：两者**各自独立定位**，Hero 高度变化时 title 始终在 38.2%，CTA 始终离底部固定像素。

## 响应式参数

| 断点 | Hero 高度 | Title font | Padding | CTA bottom | CTA padding |
|---|---|---|---|---|---|
| 小屏（< 792px） | `aspect-video`（16:9） | 24px | `0 16px` | 24px | `10px 16px` |
| 桌面（≥ 792px） | `min(52vh, 480px)` | 40px | `0 48px` | 40px | `12px 22px` |

## 相关决策记录

- **D-002**（`docs/governance/DEFERRED-DECISIONS.md`）：21:9 紧凑备选 AR — 当前 Hero 锁定 16:9，若运营反馈占屏过大再启用
- **D-004**：Hero eyebrow 列 — 等费批准 `eyebrow text` 列后，eyebrow 应渲染在 title 上方（`top: 38.2%` 之上约 32px），与 title 共用垂直中心锚

## 不在本规范范围

- 卡片 CTA（非 Hero 的普通卡片）：用独立 CTA 按钮组件，不走黄金分割
- Hero 视频/图片本身：`object-position: center 30%`（让人脸/主体落在视觉焦点区），这是独立决策

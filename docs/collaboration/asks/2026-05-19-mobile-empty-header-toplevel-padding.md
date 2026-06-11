---
title: 致 Main session · Mobile non-discover section 顶部 ~60px 错误留白
type: ask
status: active
owner: Leon
created: 2026-05-19
updated: 2026-05-19
tags: [ask, layout, mobile]
---

# 致 Main session · Mobile non-discover section 顶部 ~60px 错误留白

> 发起人：Create scope (Session 4 → Leon relay) · 日期：2026-05-19
> 状态：🟡 cross-section layout bug — 需 Main session 接手（涉及 index.jsx 路由 wrapper + NavigationBar.jsx，跨 Create scope）
> 紧迫度：中（影响体验但不阻塞任何功能）
> 用户反馈：「mobile 下，页面内容没有到顶部，错误留出了很大空间」（附 Create 页 Short/Series pills 截图）

---

## 1. 问题现象

Mobile viewport（≤ 791px，`isSmallScreen=true`）下进入 Create 页面（`/create` 或 `/create/short` 等子路径），页面 mode picker pills（Short / Series / Flow）**起始位置距 viewport 顶部 ~60px**，且这 60px 完全空白 — 没有 logo、没有 segment control、没有任何可见内容。视觉上像顶部多塞了一段灰色 mat。

**用户重点**：不是想加内容填充，而是**这块空白本来就不应该存在** — mobile NavigationBar 在 Create section 没有任何要显示的东西，没必要给它留 52px 头。

## 2. Layout 链分析（mobile + Create section）

```
[viewport top y=0]
↓
[<Header> position: absolute top:0, z-40]
  └─ NavigationBar (composites/NavigationBar.jsx:216-351)
     mobile branch (isSmallScreen=true):
       <header height: 52px>
         Left  slot = isImmerse ? <CaretLeft> : <div />       ← create 永远空
         Centre slot = showSeg ? <SegmentedControl> : (none)  ← showSeg = (activeSection==='discover' && !isImmerse && !!discoverSegments) → create 永远 false
         Right slot = (activeSection==='discover' && !isImmerse) ? <Search> : <div />  ← create 永远空
       </header>
↓ NavigationBar 总高度 52px,但 mobile + create 时三 slot 全空
[y=52px]
↓
[<main wrapper> index.jsx:1158-1170]
  className="flex-1 min-h-0 overflow-y-auto overscroll-y-none pt-[56px] ..."
  注释 (2026-05-09 Leon): "mobile pt-[56px] (NavigationBar ~52 + 4 breathing)"
↓ pt-[56px] 把 child 起始 y push 到 56
[y=56px]
↓
[<StoryGeneratorPage root> src/pages/StoryGeneratorPage.jsx:2427-2430]
  className="flex flex-col h-full overflow-hidden"
↓
[Pills bar src/pages/StoryGeneratorPage.jsx:2434-2492]
  isSmallScreen && !(isSequel || isRecast) → 渲染
  className="shrink-0 px-4 pt-1 animate-fade-in"  ← pt-1 = 4px
↓
[y=60px ← Short pill 顶部实际位置]
```

**结论**：viewport 0-60px 完全空白（NavigationBar 占 52px 但内容为空 + main wrapper pt-4 breathing + StoryGeneratorPage pt-1）。在 mobile Create section 视觉上就是"上方一大段灰色"。

## 3. 受影响的其他 section（不只是 Create）

`grep "isSmallScreen.*pt-\[56px\]" index.jsx` 显示 mobile pt-[56px] 在 main wrapper 出现 2 处：

| Section | Line | 说明 |
|---|---|---|
| Create (`/create`) | 1159 | 本 bug 报告主战场 |
| Profile (`/profile`) | 1179 | 同样 mobile non-discover，疑似同样空白问题 |

另外 mobile 上其他 section 也很可疑（按 `index.jsx` 路由 wrapper 抽样）：
- Subscription (line 1067): `pt-20` desktop only，mobile 走啥还要验
- Library (line 1142): `<LibraryPage>` 自管 layout
- Studio (line 1133): `pt-20` 同上
- Wallet / Help / Search 等次级 section 没复查

**建议**：Main session 先扫一遍 `isSmallScreen + main wrapper pt` 全局，确认哪些 section 受影响。本 bug 至少 Create + Profile 中招。

## 4. NavigationBar 在 mobile non-discover section 的有效作用

[`composites/NavigationBar.jsx:216-351`](../../../src/design-system/composites/NavigationBar.jsx) mobile branch 当前只在以下场景有可见内容：

| activeSection | discoverView | Search 开关 | 渲染内容 |
|---|---|---|---|
| `discover` | `browse` | closed | SegmentedControl (Follow/Discover) + Search 按钮 |
| `discover` | `browse` | open | Search input + Back |
| `discover` | `immerse` | — | CaretLeft 返回按钮 |
| **其他任何 section** | — | — | **3 个空 div slot — 整个 header 视觉为空** |

所以 mobile + `activeSection !== 'discover'` 时 NavigationBar 实际是个 52px 占位但视觉为空的 element。

## 5. Fix 候选方案

### 方案 A — Mobile non-discover hide NavigationBar (推荐)
**改 index.jsx**：mobile + non-discover section 时不渲染 Header wrapper（line 1039-1062），或加 `isSmallScreen && activeSection !== 'discover'` 短路。
**改 main wrapper pt**：non-discover mobile section 把 `pt-[56px]` 降到 `pt-1`（4px breathing）或直接去掉。

优点：根治。NavigationBar 没东西就不渲染，不浪费 52px。
风险：需要保证 mobile 主导航靠 BottomTabBar 提供（目前已有，2026-04-18 MEMORY.md 已确认）。Logo / 品牌入口在 mobile non-discover section 也消失 — Leon 决定是否接受（目前 mobile NavigationBar 在 non-discover 本来就没渲染 Logo，所以体验无变化）。

### 方案 B — NavigationBar 在 mobile create section 渲染 pills（pills 上移到 header）
**改 NavigationBar.jsx**：mobile + create section 时 Center slot 渲染 CreateChannelPills（类似 desktop NavigationBar.jsx:399-401 已经做的）。
**改 StoryGeneratorPage.jsx**：删 page-level pills bar（line 2434-2492），避免重复。

优点：mobile + create 时 NavigationBar 有意义，pills 跟 desktop 同位。
风险：mobile 52px header 装不下当前 3 个 pill cards（每个高 ~52px）— 需要重设计 pills 为更紧凑形态（比如 SegmentedControl 风格的三选一，而非现在的 stacked cards）。这是设计变更，工作量约半天，需要 Leon 出 Figma spec。

### 方案 C — 简单缩小 pt（最小动作）
**改 index.jsx 1159 & 1179**：mobile `pt-[56px]` → `pt-1`（4px）。
**保留 NavigationBar mobile 渲染**：浮在 page content 上层（z-40），content 从 y=4 起。

优点：1 行改动。
风险：⚠️ **NavigationBar position:absolute 浮在 main wrapper 上层，z-40。若 page 顶部内容（如 Pills bar 的 glass-clear cards）在 mobile NavigationBar 区域（y=0~52）也有渲染，会被 NavigationBar wrapper 的 pointerEvents:none 上层叠盖**。需测试点击事件是否穿透。Discover mobile + immerse 走的是同样路径，已经过验证，所以理论可行 — 但 Create / Profile 等 section 是首次让 page content 顶到 viewport top 下方。

## 6. 我推荐 Main session 走方案 A

**理由**：
- Mobile non-discover section 的 NavigationBar 当前就是个 ghost — 隐藏它没有视觉损失
- 改动范围有界：1 处 index.jsx 条件 + 几处 main wrapper pt 调整
- 不需要新设计 spec
- 修完顺手解决 Profile / Library / Studio 等所有 mobile section 同类问题（一举多得）

**Main session 实施步骤建议**：

1. `index.jsx:1039-1062` Header wrapper 加条件：
   ```jsx
   {immerseChromeVisible && !(isSmallScreen && activeSection !== 'discover') && (
     <div style={{ position: 'absolute', ... }}>
       <Header ... />
     </div>
   )}
   ```
2. mobile main wrapper pt 调整（line 1159 + 1179 + 其他类似处）：
   ```jsx
   `${isSmallScreen ? 'pt-1' : 'pt-24'}` // pt-[56px] → pt-1
   ```
3. 真机验证 mobile Discover（NavigationBar 仍渲染） + mobile Create（NavigationBar 隐藏） + mobile Profile（同隐藏） — 至少 Chrome DevTools mobile emulator @ 390×844
4. 跑一遍 `npm run build` 确认编译

## 7. Create scope 已知不能做的部分

按 [`docs/archive/sessions/scope-4-create.md`](../../archive/sessions/scope-4-create.md) Session 4 禁动：
- `index.jsx` — 路由 wrapper / Header mounting，Main session 范围
- `src/design-system/composites/NavigationBar.jsx` — design system 共享组件，Main session 范围
- `src/design-system/composites/TabBar.jsx` — 同上

所以方案 A / B / C 全部出 Create scope，必须 Main session 接手。

## 8. 验证 checklist

修完后请验证：

- [ ] Mobile Chrome DevTools @ 390×844 进 `/create`：pills 顶部贴近 viewport top（≤ 8px gap）
- [ ] Mobile Chrome DevTools @ 390×844 进 `/profile`：avatar / page header 同样贴顶
- [ ] Mobile Chrome DevTools @ 390×844 进 `/discover`：NavigationBar 正常显示（SegmentedControl + Search 按钮）
- [ ] Mobile Chrome DevTools @ 390×844 进 `/discover` immerse 态：CaretLeft 返回按钮可见可点
- [ ] iPhone Safari 真机（Leon 主测设备）：所有 mobile section 顶部对齐一致
- [ ] Desktop @ 1440×900：完全无视觉变化（pt-24 / Header 80px 都是 desktop 分支，不受影响）

---

**Leon: 请把本文档 link 给 Main session 接手。Create scope 这边已停手等 Main 处理结果。**

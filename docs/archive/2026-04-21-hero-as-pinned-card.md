---
title: "Plan · Hero → 瀑布流首张 Pinned Card（16:9）"
type: plan
status: archived
owner: Leon
created: 2026-04-21
updated: 2026-04-21
tags: [plan, hero, landed]
---

# Plan · Hero → 瀑布流首张 Pinned Card（16:9）

> 发起：Leon · 日期：2026-04-21 · 状态：待实施  
> 前置讨论：`docs/archive/asks/2026-04-21-legacy-type-column.md`（无关） + 本次 `/test/hero-ar` 视觉实测

## 决策回顾（已锁定）

| 项 | 决策 |
|---|---|
| Hero AR | **16:9**（唯一档，不给运营挑选） |
| 紧凑 AR 备选 21:9 | ❌ 本次不做 → 归档为 **D-002** |
| Hero 识别规则 | `pinned = true AND pin_order = 1` 的那一张 |
| CTA 数量 | **1 个**（简化自现有 2 CTA） |
| CTA 内容 | `Start Creating → /create`（mobile 默认已是 Spark，原 "Explore Spark" 冗余） |
| 文案形态 | **Phase 1：仅 title + CTA**（Hero 不显示 tags badge）；eyebrow 走 Phase 2 |
| eyebrow 策略 | ✅ 方案 A 解耦 — Phase 1 不带 eyebrow，Ask 已发费（`docs/collaboration/asks/2026-04-21-eyebrow-column.md`），待费批准 `ALTER TABLE ADD COLUMN eyebrow text` 后 Phase 2 上 → 登记为 **D-004** |
| Schema 变动 | ❌ Phase 1 无，Phase 2 需费批一列 |
| 后端协作 | Phase 1 无；Phase 2 需费批 ADD COLUMN |
| CTA 路由优化 | ✅ SPA-safe navigate + **prefetch /create** 预加载 route chunk |
| 测试页去留 | ✅ `/test/hero-ar` 保留 → 登记为 **D-003**（甲方演示用途，完成后删） |

## 变更范围硬边界

| 禁止 | 允许 |
|---|---|
| ❌ DB ALTER/DROP | ✅ 1 条 UPSERT 种子数据 |
| ❌ `src/api/*` 签名改动 | ✅ MasonryGrid 新增 hero-variant 渲染路径 |
| ❌ 增加 AR 枚举值 | ✅ 复用 `16:9` |
| ❌ 改 `_worker.js` / `wrangler.jsonc` | ✅ 删除 `ExploreHero.jsx` + index.jsx 里的引用 |

## 文件影响

| 文件 | 动作 |
|---|---|
| `src/components/ExploreHero.jsx` | **DELETE**（改由 MasonryGrid 渲染） |
| `src/components/MasonryGrid.jsx` | 新增 hero-variant 分支：跨全宽 16:9 + 中央 overlay + ambient autoplay + stopPropagation CTA |
| `index.jsx` line 804-812 | 移除 `<ExploreHero ...>` 及 import |
| `src/pages/admin/AdminDashboard.jsx` | `pin_order === 1` 时 AR 下拉锁定 16:9（`disabled` + helper text） |
| `src/utils/normalizeRecommended.js` | 无改动 |
| `src/api/adminService.js` | 无改动 |
| Supabase `recommended_content` 表 | 插入/更新 1 行（见 § 种子数据） |
| `docs/governance/DEFERRED-DECISIONS.md` | 新增 D-002（21:9 紧凑 hero） |
| `src/pages/HeroARTest.jsx` + route | **保留到 ship 后 +1 周**，然后 D-003 归档或删除 |

## 种子数据（1 行 INSERT）

```sql
-- 在 Supabase Dashboard SQL Editor 执行
-- 说明：tags 为空数组，因为 Hero 不显示 tag badge
INSERT INTO public.recommended_content
  (title, artist, video, type, aspect_ratio,
   pinned, pin_order, published, published_at,
   media_kind, tags,
   cta_label, cta_url, cta_target)
VALUES
  ('Parallel Worlds, Second Life',
   'Uvera',
   '/videos/hero-bg.mp4',
   'VIDEO', '16:9',
   true, 1, true, now(),
   'Video', ARRAY[]::text[],
   'Start Creating', '/create', '_self');
```

注：
- `tags = []` 因 Hero 卡不渲染 tag badge（与普通卡区分的视觉标识）
- `eyebrow` 列 Phase 1 不写入（列也还不存在，Phase 2 加列后补回填）
- 若未来 Leon 想通过 admin 改 hero 内容，直接编辑该行即可
- 删除或切 `pinned=false` = Hero 消失，首页瀑布流从第一行开始

## 关键实现点

### 1. MasonryGrid 的 hero-variant 渲染（增量 ~60 行）

```jsx
// 在 MasonryGrid 顶部，columns 开始之前：
const heroItem = filteredMediaItems.find(
  x => x.pinned === true && x.pinOrder === 1
);
const gridItems = heroItem
  ? filteredMediaItems.filter(x => x.id !== heroItem.id)
  : filteredMediaItems;

return (
  <section ...>
    {heroItem && <HeroCard item={heroItem} isSmallScreen={...} onNavigate={...} />}
    <div className="columns-...">
      {gridItems.map(...)}
    </div>
  </section>
);
```

**HeroCard 子组件**（新增，复用自 `/test/hero-ar` 的 HeroCard 骨架）：
- 容器：`w-full aspect-video rounded-3xl overflow-hidden`
- 视频：`autoPlay muted loop playsInline` + `prefers-reduced-motion` → 仅 poster
- Overlay：`title`（大号，居中）→ CTA（capsule）
- **无 eyebrow**（Phase 1；Phase 2 加列后补）
- **无 tag badge**（Hero 专属视觉，区分普通瀑布流卡）
- **无 description**（schema 无此列，接受）
- CTA 点击：`stopPropagation` + SPA-safe navigate（见 § 2）
- CTA mount 时 prefetch `/create` route chunk（见 § 2.1）

### 2. SPA-safe CTA 导航（通用化，适用所有瀑布流卡）

当前 `cta_url` 的消费是 `window.open(url, target)`，对 `/create` 这类 SPA 内部路由会**全页刷新**。需要修正为：

```jsx
import { useNavigate } from 'react-router-dom';

function handleCtaClick(e, ctaUrl, ctaTarget = '_self') {
  e.stopPropagation();
  // 内部路由（以 / 开头且不是 //CDN 协议相对）→ SPA navigate
  if (ctaUrl.startsWith('/') && !ctaUrl.startsWith('//')) {
    navigate(ctaUrl);
  } else {
    window.open(ctaUrl, ctaTarget);
  }
}
```

此改动同时修复了**普通瀑布流卡** CTA 的内部链接行为，非 hero 专属。

### 2.1 Prefetch `/create` route chunk

首次点击 CTA 到 `/create` 会触发 SPA bundle 按需加载，有肉眼可见延迟（300-800ms）。HeroCard mount 时预取 chunk：

```jsx
import { useEffect } from 'react';

// HeroCard 内部
useEffect(() => {
  // 仅在 ctaUrl 指向内部路由时预取
  if (item.ctaUrl?.startsWith('/create')) {
    // Vite 的 dynamic import 会被 prefetch 成 <link rel="prefetch">
    import('./pages/...create-route-module');
  }
}, [item.ctaUrl]);
```

**实施时再确认**：`/create` 路由实际对应的 lazy chunk 路径。若当前代码没做 route-level code splitting，此优化可延后（整个 app 就一个 bundle，跳转本来就零延迟）。

### 3. Admin AR 条件化锁定

```jsx
// 在 AR select 渲染处
const isHeroSlot = formData.pinned && formData.pin_order === 1;
<select
  value={isHeroSlot ? '16:9' : formData.aspect_ratio}
  disabled={isHeroSlot}
  onChange={...}
>
  {AR_OPTIONS.map(...)}
</select>
{isHeroSlot && (
  <p className="text-xs text-amber-400/70 mt-1">
    Hero slot（pin_order=1）AR 锁定为 16:9。如需其它比例请先改 pin_order。
  </p>
)}
```

### 4. Autoplay 策略

| 平台 / 条件 | 行为 |
|---|---|
| Desktop | `autoPlay muted loop` 生效 |
| Mobile Safari / Chrome | `playsInline muted autoPlay` 生效（三者缺一不可） |
| `prefers-reduced-motion: reduce` | ❌ 不播放，只显 poster |
| `videoError` fallback | 渐变背景 + poster + 文案仍可见 |

## 实施阶段（Phase 1，按风险递增）

| 阶段 | 动作 | 文件 | 耗时 |
|---|---|---|---|
| 1 | 文档归档：D-002/D-003/D-004 + eyebrow ask 发费 | `docs/governance/DEFERRED-DECISIONS.md` + `docs/asks/*.md` | ✅ 已完成 |
| 2 | DB 种子数据 INSERT（Supabase Dashboard 手工） | 1 条 SQL | 5min |
| 3 | MasonryGrid 增 hero-variant 渲染（ExploreHero 仍在） | MasonryGrid.jsx | 1h |
| 4 | SPA-safe CTA 导航（通用化，非 hero 专属） | MasonryGrid.jsx | 20min |
| 4.1 | Prefetch `/create` route chunk（视 code-splitting 现状而定） | MasonryGrid.jsx or skip | 10-30min |
| 5 | **验证并行期**：首页应同时看到两个 hero（老 + 新），对比无异常 | 手测 | 20min |
| 6 | 切换：移除 ExploreHero 引用 + 删 ExploreHero.jsx | index.jsx + ExploreHero.jsx | 20min |
| 7 | Admin AR 条件锁定（hero-slot 禁用非 16:9） | AdminDashboard.jsx | 30min |
| 8 | 回归测试（published=false hero / 无 pinned 记录 / 视频 404 / 移动 iOS Safari autoplay） | 手测 | 30min |
| 9 | Commit + push | git | 10min |
| **Phase 1 合计** | | | **~3-4h** |

## 实施阶段（Phase 2，等费批 eyebrow 列后）

| 阶段 | 动作 | 文件 | 耗时 |
|---|---|---|---|
| P2.1 | 费跑 `ALTER TABLE ADD COLUMN eyebrow text` | Supabase Dashboard | 1min（费的动作） |
| P2.2 | normalize 层透传 eyebrow 字段 | `normalizeRecommended.js` | 5min |
| P2.3 | Admin 加 Eyebrow text input（hero-slot 专属，`pin_order !== 1` 时隐藏） | AdminDashboard.jsx | 30min |
| P2.4 | HeroCard 渲染 eyebrow（uppercase 小号 letter-spaced） | MasonryGrid.jsx | 15min |
| P2.5 | 回填老 hero：`UPDATE recommended_content SET eyebrow='AI-NATIVE WORLDBUILDING' WHERE pin_order=1` | Supabase SQL | 1min |
| P2.6 | 验证 + commit | 全部 | 20min |
| **Phase 2 合计** | | | **~1.5h** |

## 回滚方案

| 触发 | 动作 |
|---|---|
| 渲染异常 | `git revert <hero-cutover commit>` → ExploreHero 复活 |
| Hero 数据问题 | admin 把该行 `pinned=false`，首页回到无 hero 状态（其余瀑布流正常） |
| CTA 导航问题 | 该改动通用，回退只需还原 handleCtaClick 分支 |

## 验证清单

### Desktop（`http://127.0.0.1:5176/`）
- [ ] 首页顶部出现 hero 卡，16:9 全宽，高度 ~619px（content width ~1100px）
- [ ] Hero 下方瀑布流 5 列正常排列，不含 hero 条目
- [ ] Hero 视频 muted autoplay
- [ ] Hero 「Start Creating」点击 → 路由到 /create（无整页刷新）
- [ ] Hero 卡其他区域点击 → 无行为（或按设计触发）
- [ ] DevTools Console 无 error/warning

### Mobile（DevTools iPhone 或实机 192.168.31.235:5176）
- [ ] 首页顶部出现 hero 卡，16:9 全宽（~358x201px）
- [ ] Hero 下方瀑布流 2 列
- [ ] Hero 「Start Creating」在 Safari/Chrome 都 autoplay
- [ ] `prefers-reduced-motion` 开启 → 只显 poster

### Admin（`http://127.0.0.1:5176/admin/dashboard`）
- [ ] Hero 行在 Frontend Feed Content 列表显示 `#Hero` tag + `Video` media_kind badge
- [ ] 编辑 hero 行 → AR 下拉是 disabled 状态 + 琥珀色提示文案
- [ ] 把 pin_order 改为 2 → AR 下拉解锁，5 档可选
- [ ] 改回 pin_order=1 → AR 自动回 16:9

### 边界情况
- [ ] 无任何 pinned 记录 → 首页不显示 hero，瀑布流从第一行开始
- [ ] Hero published=false → 首页不显示 hero（admin 仍见）
- [ ] Hero 视频 404 → fallback 到 poster + gradient，不白屏

## 开放问题（实施时再决）

1. **Vite route-level code splitting 现状**：若整个 app 是单 bundle（当前 src/main.jsx 看起来就是这样），prefetch /create 无意义，阶段 4.1 跳过。实施时先查 `dist/` 构建产物确认。
2. **Hero 视频缓存策略**：`/videos/hero-bg.mp4` 是固定资源，首页首刷必加载。是否加 `<link rel="preload" as="video">`？优化项，非阻塞。

## 关联

- 前置工作：`docs/governance/DEFERRED-DECISIONS.md`（D-001 tag badge clickable，无关）
- 延期决策：D-002（21:9）/ D-003（/test/hero-ar 删）/ D-004（eyebrow 列）
- Ask 文档：`docs/collaboration/asks/2026-04-21-eyebrow-column.md`（待费回复）
- 实测页：`/test/hero-ar`（ship 后保留直到甲方演示结束，D-003 触发时删）
- Backend Style Guide：`docs/engineering/BACKEND-STYLE-GUIDE.md`（无直接关联）
- MEMORY 红线规则：
  - Phase 1 **无触发项**（纯前端 + 1 条种子数据）
  - Phase 2 触发 DB schema 变动（ADD COLUMN），由费本人执行 ALTER TABLE，前端工作待批复后继续

---
title: 播放器 Transport + 播放逻辑统一模型
type: decision
status: active
owner: Leon
created: 2026-05-30
updated: 2026-05-30
tags: [decision, adr]
---

# 播放器 Transport + 播放逻辑统一模型

> **决策日期**:2026-05-29
> **触发 session**:Leon round-105/106(Recast 取消 + Branch 暂停后,重新定义"播完该怎样")
> **决策方**:Leon(产品 + 设计)
> **状态**:✅ 模型锁定,待实施(PlayerActionBar transport + SparkMode handleEnded + VideoPlayer contentType)

---

## 触发背景

1. **Recast 出镜功能完全取消**(round-105):action row 的 Recast 按钮已删。
2. **拍摄分支 Branch 暂停隐藏**(round-105):End-of-playback Branch CTA 已删,只剩 Replay。
3. 现存 `handleEnded`([SparkMode.jsx:747](../../src/components/SparkMode.jsx))是 **branch-or-stop** 逻辑:有 branch → 自动播 branch,否则停 + Replay。Branch 隐藏后,`prefetchedBranch` / `#Parent` 查询全变 **dead code**,所有视频落到"停 + Replay"。
4. → "播完该怎样"成为一张白纸,需要按内容类型重新定义。

---

## 核心模型:两个正交控件(Apple Music 模式)

| 控件 | 含义 | 状态 |
|---|---|---|
| **🔁 Repeat** | 当前队列的循环范围 | OFF → ALL(循环列表)→ ONE(单曲循环),单按钮循环切 |
| **∞ Autoplay** | 队列自然播完后是否继续 | ON = 接下一项/推荐;OFF = 停 |

两者**正交**:Repeat 管"循环范围",Autoplay 管"播完是否越过队列继续"。组合覆盖全部播放语义(单曲循环 / 循环专辑 / 自动下一集 / 播完停)。

---

## Action Row 布局(Row 2)

```
[🔁][⏮  ▶/⏸(大)  ⏭][∞]   ···········   [🔊][Res][Speed][⬇][PiP][⛶]
└──── transport 簇 ────┘                  └──── 右 media 簇 ────┘
```

- **transport 簇(左)**:🔁 Repeat 最左 / ⏮ ▶ ⏭ 中间 / ∞ Autoplay 最右,对称夹住三连
- **Play 放大**:32–36px filled,`⏮ ⏭ 🔁 ∞` 等保持 28px,建立视觉主次
- **无 Shuffle 🔀**:short-feed 已乱序、series 不能打乱、mv-album 氛围 session 常有序编排(瑜伽 flow)→ shuffle 边际收益低且可能破坏编排,不做
- **⏮⏭ 所有 contentType 都显示**(含 short-feed / mv-single)—— Spark 里 short-feed 跟 mv-single 混合推送,切换主动权交还用户
- **右 media 簇**保持现有:Volume / Resolution / Speed / Download / PiP / Fullscreen

---

## 各 contentType 默认值 + 启用矩阵

| contentType | 来源(tags 推导) | ⏮⏭ 指代 | 🔁 默认 | ∞ 默认 | 自然播完 |
|---|---|---|---|---|---|
| **short-feed** | 其余(#Vlog / #Trailer / 无 tag) | feed 上/下条 | ONE 循环自身 | OFF | 循环自身 |
| **mv-single** | `#MV`(未在 playlist 中) | feed 上/下条 | ONE 循环自身 | OFF | 循环自身 |
| **mv-album** | `#MV`(在 playlist / 收藏列表中) | 专辑内上/下首 | ALL 循环专辑 | OFF | 循环专辑 |
| **series** | `#Short Drama` / `#Series:` tag | 上/下一集 | OFF | ON 下一集 | 末集 → 下一部 |

**关键**:短视频默认 **loop self**(swipe 才前进),对齐 TikTok / Reels / Shorts 短视频范式;剧集默认 **autoplay 下一集**,末集进下一部(不循环)。

---

## contentType 推导(从 tags,不是 media_kind)

⚠️ **重要前提**:`media_kind` ∈ `{ Video, Image, Live }`,**MV 不是 media_kind**。
MV = `media_kind: 'Video'` + `tags[0]: '#MV'`。内容细分全在 `tags`(见 `VIDEO_TAGS`)。

```js
function deriveContentType(item) {
  const tags = item.tags || [];
  if (tags.includes('#Short Drama') || tags.some(t => t.startsWith('#Series:'))) return 'series';
  if (tags.includes('#MV')) return item.inPlaylist ? 'mv-album' : 'mv-single';
  return 'short-feed';
}
```

(mv-album 的判定取决于"是否在播放列表上下文",见下方 playlist 预留。)

---

## "我喜欢的 MV" / Queue 按钮(预留,暂不实装)

Leon 预想:save 的氛围/宗教/瑜伽 MV 单独进一个"我喜欢的 MV" Playlist。

拆清两个功能(不混到一个 slot):

| 功能 | 方案 |
|---|---|
| **Save MV 进收藏** | 复用 Spark 右侧**已有 Save(bookmark)**,不新造按钮 |
| **"我喜欢的 MV" 视图** | Library 里 saved items 按 `tags.includes('#MV')` 过滤的视图(**不是** media_kind 过滤) |
| **替换 ∞ 的 playlist 按钮**(mv-album / saved-MV context)| = "看/跳当前列表 up-next" = **Queue 语义** |

**icon 决策:用 `Queue`(☰),不用 list-heart**:
- 该按钮跟随当前播放列表(可能是专辑,也可能是"我喜欢的 MV")→ 不专属 favorites,list-heart 会误导
- Queue 是 Apple Music / Spotify 通用 up-next 语义
- Phosphor 有现成 `Queue`;list-heart 无标准 icon 要拼 composite

**当前不实装**:先把"我喜欢的 MV"做成 Library 的 `saved + #MV` 过滤视图;等真有 playlist 需求,再让 ∞ slot 在 mv context 切成 Queue 按钮。避免为未确定 feature 投入。

---

## 命名:`contentType` prop(不是 contentKind)

VideoPlayer 需要新 prop 管播放逻辑,跟现有概念区分:
- `kind`(round-102 已占用)= chrome preset(primary / thumbnail / decorative / admin-preview)= **显哪些控件**
- `media_kind`(DB 字段)= Video / Image / Live
- `contentType`(新)= short-feed / mv-single / mv-album / series = **播放逻辑**(🔁∞ 默认 + 播完行为)

用 `contentType`:跟 `kind` 一眼区分;避免 `contentKind` 跟 `kind` / `media_kind` 视觉撞车。

---

## 实施 scope

1. **删 dead Branch 机制** — `handleEnded` 的 `prefetchedBranch` + `#Parent` DB 查询 + `prefetchedBranch` state + 两处隐藏 prefetch `<UnifiedVideoPlayer>` + `handleQuickBranch` / `onBranchClick`(确认无其他 caller 后)
2. **重写 `handleEnded`** — 按 `contentType` + Repeat/Autoplay 状态决定:loop self / next feed item / next episode / next series / stop
3. **PlayerActionBar transport 簇** — 加 `⏮ ⏭` + `🔁`(off/all/one cycling)+ Play 放大;接 `onPrev` / `onNext` / `onRepeatChange` / `repeatMode` callback;`∞` Autoplay 从右簇移到 transport 簇右端
4. **VideoPlayer** — 加 `contentType` prop + 默认值表 + 透传 transport callback
5. **SeriesDetailPage** — 传 `contentType="series"` + `onNext`(下一集,已有 handleEpisodeEnded 逻辑可接)

---

## 实施进度(2026-05-30 round-106 续 — 各 callsite 应用规则)

> session Main 把工作切成增量 A/B/C/D;A/B/D 已落地,本次补 C + 扩展到其他 callsite。
> Leon 定:**Library / StoryGenerator 按 Spark 短视频一致**(short-feed loop-self)。

| 增量 | 内容 | 状态 |
|---|---|---|
| A | PlayerActionBar transport 簇(🔁⏮▶⏭∞ + Play 放大)| ✅ Main 完成 |
| B | VideoPlayer composite 加 contentType + 默认值表 | ✅ 本 session(`80d5185`)|
| D | SeriesDetailPage 传 contentType="series" + onNext/onPrev | ✅ 本 session(`80d5185`)|
| **C** | **SparkMode handleEnded loop-self + 删 dead Branch 触发** | ✅ `3169ab6` |

**各 callsite 应用规则(2026-05-30 锁定):**
- **`deriveContentType` 抽到 `src/utils/contentType.js`**(单一源,三处共用)+ `isLoopSelf()`。
- **SparkMode(Create 沉浸)**:mobile swipe feed + desktop 两个 active callsite 加原生 `loop={active && contentType!=='series'}`;删 handleUnifiedTimeUpdate 的 dead `#Parent` prefetch 触发。短视频播完无缝循环。
- **LibraryPage**:作品播放器加 `loop={isLoopSelf(selectedWork)}`(series 作品不循环)。
- **StoryGenerator**:lightbox 预览 + 段落预览(实际播放的)加 `loop`(单条生成短视频,无 tags → loop);w-28 缩略图(只显首帧)**skip**(对齐 round-102 thumbnail bare 原则)。

**仍待续(本次未做,风险/范围考量):**
- **dead Branch 代码彻底清理**:loop=true 后 `handleEnded`/`handleQuickBranch`/`handleViewBranchTree`/`prefetchedBranch` state/2 个 hidden prefetch player/`isLoadingBranch` UI 均已**不可达但仍在**;清理需连带 `index.jsx`(1207/1588)的 `onBranchClick`/`setActiveSeriesTree` → 单独一轮做。
- **完整 transport bar 上这些 callsite**:它们目前**未用 customControls**,所以 ⏮⏭🔁∞ bar 不显示;要显示需迁到 VideoPlayer composite(kind + contentType)。本次先交付 loop-self 行为。

---

## Deferred / 待后续

- **mv-album playlist 容器** — DB 是否有"专辑/播放列表"结构?当前 `#Series:` tag 是剧集分组,MV 无对应。mv-album contentType 暂时 fall back 到 mv-single,等 playlist 数据结构定了再启用
- **D-017 mobile PlayerActionBar mini variant** — transport 在 mobile(pointer:coarse)的形态,本模型先覆盖 desktop
- **决策 5 / 6 / 7**(LibraryPage segment chooser slot / mobile / bar 位置)— B2 迁移时回头

---

## 相关

- round-105:Recast 删除 + Branch 隐藏(`refactor: 删 Recast 出镜 UI + 隐藏拍摄分支 CTA`)
- round-93:中心 Play / Replay overlay
- round-102:VideoPlayer composite + kind 体系
- `docs/decisions/2026-04-27-handleEnded-no-autoadvance.md`(被本 doc 取代的旧 end-of-playback 设计)

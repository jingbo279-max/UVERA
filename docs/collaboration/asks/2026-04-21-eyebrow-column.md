---
title: 致费 · recommended_content 新增 eyebrow 列征询
type: ask
status: active
owner: Leon
created: 2026-04-21
updated: 2026-04-21
tags: [ask, schema, hero]
---

# 致费 · recommended_content 新增 eyebrow 列征询

> 发起人：Leon（前端团队） · 日期：2026-04-21  
> 状态：**征询中，等你拍板**  
> 紧迫度：低（不 block 当前工作，Hero 先以 Phase 1 形态上线 = title + CTA + video）

## 背景

v2 milestone 之后，homepage Hero 被重构为"瀑布流首张 pinned card"（`pinned=true AND pin_order=1`）。旧的硬编码 `ExploreHero.jsx` 里有一行小字 eyebrow：

> AI-NATIVE WORLDBUILDING

这是小号 uppercase letter-spaced 的辅助文案，独立于 title 和 description。运营希望 **eyebrow 可编辑**，因为它承担的是"系列名 / 主题 / 产品线"这一维度的分类信息（比如换成 `PARALLEL WORLDS` / `CINEMATIC AI` / `SPARK SEASON 2` 等），跟 title 不同也跟 tags 不同。

## 现状 Schema 缺口

跑 `SELECT * FROM recommended_content LIMIT 1` 拿到的 20 列里没有任何适合的落脚点：

```
artist, aspect_ratio, audio, cover, createdAt,
cta_label, cta_target, cta_url, id, likes_count,
media_kind, pin_order, pinned, published, published_at,
saves_count, tags, title, type, video
```

（MEMORY.md 里记的 `metadata` 列实际**不存在** — 试了 `supabase.from('recommended_content').select('metadata')` 返回 `column does not exist`）

所以没法像"tag 塞 JSONB" 那样白嫖一个字段。

## 我们准备的 3 条路径

### A. 加一列 `eyebrow text`（1 个 ALTER，additive）

```sql
ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS eyebrow text;
```

- 列可空，老记录 NULL
- 前端仅 hero 卡消费（`pin_order=1`），普通瀑布流卡忽略
- 不改既有列，可独立回滚
- 工作量：你一条 SQL，前端我们自己接

### B. 不加列，复用 `tags[0]` 语义劫持

- 约定："hero 卡的 tags[0] 实际是 eyebrow 文案（不是分类标签）"
- 0 schema 变动
- 代价：tag 字段双重语义，未来做 tag aggregation / filter 时需特判 `pinned=hero`

### C. Hero 永不显示 eyebrow

- Hero 卡 = title + CTA + video，无小字
- 视觉比现在的硬编码 Hero 朴素
- 0 任何改动

## Leon 的倾向

**A**。理由：
1. eyebrow 和 tag、title、description 是 4 个不同维度的信息，复用会在未来长出更多边界 case
2. ALTER TABLE ADD COLUMN 是 additive 零风险操作（和 v2 migration 一样的模式）
3. 运营反馈 eyebrow 是 hero 视觉张力的关键元素

**但不急**。我们已经启动 Hero Phase 1（title + CTA + video + 16:9 AR），不带 eyebrow 也能交付核心 hero 功能。你批准 A 之后 Phase 2 再加 eyebrow，工时 ~1h（含 admin UI + 渲染 + migration）。

## 具体想让你回复的内容

- **A / B / C 选哪个**（或"保持现状不管了"也 ok）
- 如果选 A：帮忙跑一下这条 SQL 在 Supabase Dashboard，完事我们就继续推 Phase 2
  ```sql
  ALTER TABLE public.recommended_content
    ADD COLUMN IF NOT EXISTS eyebrow text;
  ```
- 如果选 B 或 C 我们走相应路径，不再打扰

## 关联

- Plan：`docs/archive/2026-04-21-hero-as-pinned-card.md`
- 延期决策登记：`docs/governance/DEFERRED-DECISIONS.md` D-004
- 相关前置：v2 migration（`migrations/20260420_recommended_content_v2.up.sql`）

---

*@费 看到后回 A / B / C 即可。不赶，A 批了以后批我们自己安排 Phase 2。*

---
title: 致费 · recommended_content.type 列清理征询
type: ask
status: resolved
owner: Leon
created: 2026-04-21
updated: 2026-04-21
tags: [ask, schema]
---

# 致费 · recommended_content.type 列清理征询

> 发起人：Leon（前端团队） · 日期：2026-04-21  
> 状态：**✅ 已落地（C' 变体 — 前端派生，零 DB/后端改动）**  
> 紧迫度：低（不 block 当前工作，现状可无限期保持）

## 落地记录（2026-04-21）

费同意 C 方案后，Leon + Claude 一起跑完 3 问验证，全部 clean：

| # | 验证项 | SQL | 结果 |
|---|---|---|---|
| Q1.1 | `type` 列约束 | `information_schema.columns` | `text` / `NOT NULL` / 无 default |
| Q1.2 | CHECK 约束 | `pg_constraint WHERE contype='c'` | 0 行 — 无 CHECK |
| Q2.1 | 后端 function 消费 | `information_schema.routines` | 0 行 — 无 function 读 `type` |
| Q2.2 | 表上 trigger | `information_schema.triggers` | 0 行 — 无 trigger |

**结论**：`type` 列全系统仅被前端 `normalizeRecommended.js` 消费，前端派生方案零风险。

### 最终选择：**C' 变体（前端派生）**

| 维度 | C 原版（trigger） | C' 变体（前端派生 — 已落地） |
|---|---|---|
| DDL | 需加 BEFORE INSERT trigger | 零 DDL |
| 后端依赖 | 需费参与 | 零依赖 |
| 可逆性 | 拆 trigger | 删 `deriveLegacyType()` |
| admin UI | 干净 | 干净（等价） |

Trigger 方案作为 future optimization 记到 `docs/governance/DEFERRED-DECISIONS.md`。

### 派生映射表

**`deriveLegacyType(mediaKind, firstTag) → legacyType`**（实现在 `src/utils/normalizeRecommended.js`）

| media_kind | firstTag | → legacy type | normalize 得到 |
|---|---|---|---|
| `Live` | (任意) | `LIVE` | live / 9:16 |
| `Image` | (任意) | `IMAGE` | parallel / 3:4 |
| `Video` | `#MV` | `MUSIC` | mv / 16:9 |
| `Video` | `#Trailer` | `FILM` | film / 16:9 |
| `Video` | `#Vlog` | `STORY` | story / 9:16 |
| `Video` | `#ShortDrama` | `STORY` | story / 9:16 |
| `Video` | `#TVC` | `VIDEO` | clip / 9:16 |
| `Video` | `#Promo` | `VIDEO` | clip / 9:16 |
| `Video` | 无 tag | `VIDEO` | clip / 9:16 |
| (兜底) | — | `VIDEO` | clip / 9:16 |

### 舍弃的 legacy 值（新建不再产生，历史数据保留）

- `AUDIO` → 由 `MUSIC`（#MV）替代，零差异（normalize 里两者都走 mv slug）
- `DESIGN` → 由 `IMAGE` 替代，AR 差异可用"Display AR"下拉覆盖
- `ALBUM` → 由 `IMAGE` 替代，AR 差异可用"Display AR"下拉覆盖

### 落地的 commit

- `feat: land Plan C' — derive recommended_content.type from media_kind + tags`
- 改动文件：
  - `src/utils/normalizeRecommended.js` — 新增 `deriveLegacyType`
  - `src/api/adminService.js` — INSERT/UPDATE 自动派生
  - `src/pages/admin/AdminDashboard.jsx` — 移除 type dropdown + `formData.type`

---

<details>
<summary>原征询内容（2026-04-21 发起时存档）</summary>

## 背景

上周落地的 recommended_content v2 给表加了 `media_kind`（Video / Image / Live）+ `tags text[]`（#MV / #Trailer / #Vlog / #TVC / #Promo / #ShortDrama）之后，旧的 `type` 列（enum：`VIDEO / IMAGE / MUSIC / AUDIO / DESIGN / LIVE / STORY / ALBUM / FILM`）在内容分类维度上已经和新体系**功能重叠**。

admin `/admin/dashboard` 编辑器里当前的 **Classification Type** 下拉（`legacy — also fill Classification below`）正是 `type` 列的写入入口。运营反馈：双填一次内容要点两个下拉，冗余感明显。

## 但 `type` 不是纯 legacy —— 它还在活跃消费中

代码调研结果（前端侧）：

| 位置 | 消费 `type` 做什么 | 迁移到 media_kind 的阻力 |
|---|---|---|
| `src/utils/normalizeRecommended.js` DB_TYPE_MAP | 派生 slug / category label / **aspectRatio 默认值**（9 档各异） | 9 → 3 失粒度，AR 会默认错 |
| `src/components/MasonryGrid.jsx:305` TypeIcon | 9 个 slug 各对应独立 Phosphor 图标 | 失粒度，所有 Video 变同一个图标 |
| `src/components/MasonryGrid.jsx:625` on-chain 徽章 | `['clip','story','film','parallel'].includes(type)` 过滤 | 条件需要显式迁移到 media_kind + tags |
| `src/api/adminService.js:87` INSERT payload | 写 `type` 到 DB | 需你确认 DB 约束 |

结论：**`type` 不能无条件删**，它在视觉层（图标 + 默认 AR）和业务层（上链条件）都还有真实价值。

## 我们准备的 3 条路径

### A. 改名（零风险，前端独立做）
- 下拉保留 9 档不变，标签从 **"Classification Type (legacy — also fill Classification below)"** 改为 **"Visual Preset (icon + default AR)"**
- 向运营明确：这是"视觉预设"，不是"内容类型"
- 内容分类权威明确是 `media_kind` + `tags`
- **无 DB / API 改动，无需你审阅**

### B. 改名 + 折叠（小风险，前端独立做）
- A 基础上，把该下拉放进 `<details>Advanced</details>` 默认折叠
- 默认值根据 `media_kind` 自动推（Video→VIDEO / Image→IMAGE / Live→LIVE），运营要精调才展开
- 主表单视觉干净

### C. 真删掉（需你拍板）
- 删除 admin UI + 服务端自动派生 `type`
- 需要你回答三个问题才能落地：

  1. **`recommended_content.type` 在 schema 上是否 NOT NULL？是否有 CHECK 约束或 enum？**
     - 若 NOT NULL，前端继续写入；若可空，可 INSERT 时省略
  2. **后端（worker / 分析脚本 / 推荐算法 / 同步任务）有没有读 `type`？**
     - 若有，得先迁移读端到 `media_kind`
  3. **是否可以加一个 BEFORE INSERT trigger，按 `media_kind` + `tags[0]` 自动派生 `type`？**
     - 例如：`media_kind=Video + tags[0]=#MV → type=MUSIC`
     - 这样 admin UI 删干净，DB 数据仍保留 `type` 兼容存量消费方

## 我们的倾向

Leon 暂时倾向 **B**（视觉干净 + 保全功能 + 给 C 预留路径），但**没有时间压力**。你现在忙其他事的话 **A 或现状**都 fine，你有空拍板 C 的时候我们再动。

**不动 = 不会有任何负面影响**，只是运营每次创建内容多点一个下拉。

## 关联

- 落地计划：`/Users/sunjingbo/.claude/plans/polished-bubbling-yao.md`
- 延期决策记录：`docs/governance/DEFERRED-DECISIONS.md`
- 现场列表数据：12 条 recommended_content 均已通过新体系标注 `media_kind` + `tags`（6 种 tag 全覆盖）

---

*@费 看到后回复 A / B / C + 三问答即可，或者说"保持现状"都行。不用赶。*

</details>

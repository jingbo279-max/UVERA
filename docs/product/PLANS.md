---
title: Uvera Subscription Plans & Token Top-ups — Source of Truth
type: doc
status: active
owner: Leon
created: 2026-05-12
updated: 2026-05-13
tags: [product, plans, pricing]
---

# Uvera Subscription Plans & Token Top-ups — Source of Truth

> **2026-05-12 Leon 建立**。Plan tier 配置、限制、特权矩阵 + token 补充包的 single source of truth。
> 任何 plan 相关变动必须先更新此文档，前端/后端代码再 sync。

## 目录

- [产品结构](#产品结构)
- [Subscription Tiers 总览](#subscription-tiers-总览)
- [Tier 详解](#tier-详解)
- [Token Top-up 产品](#token-top-up-产品)
- [Token 经济](#token-经济)
- [衍生作品 (Sequel / Branch / Recast)](#衍生作品-sequel--branch--recast)
- [实现层](#实现层)
- [Change Log](#change-log)

---

## 产品结构

Uvera 的付费体系分**两个并行轨道**：

1. **Subscription Tiers**（订阅层级 — 决定 feature gates）
   - 4 个层级：FREE / STARTER / CREATOR / STUDIO
   - 控制 Actor 数、Character/Actor、分辨率、Series/Flow 准入、月 token 配额、水印

2. **Token Top-up**（一次性 token 补充包 — 不影响 tier）
   - LITE = $3.99 / 100 tokens
   - 任何 tier 的用户都可购买，token 累加到余额
   - 不改变用户的 tier 或 feature gate

> ⚠️ **LITE 不是 tier**，是 top-up SKU。FREE 用户买 LITE 后仍是 FREE tier（feature gate 不变），只是 token 余额 +100。

---

## Subscription Tiers 总览

| Tier | Actors | Char/Actor | Total Char | 分辨率 | 水印 | Series | Flow | 月 Tokens | 价格 |
|---|---|---|---|---|---|---|---|---|---|
| **FREE** | 1 | 3 | 3 | 480p | ✓ | ✗ | ✗ | [TBD/月] | $0 |
| **STARTER** | 2 | 5 | 10 | 720p | ✗ | ✗ | ✗ | [TBD/月] | [TBD] |
| **CREATOR** | 3 | 8 | 24 | 1080p | ✗ | ✓ | ✗ | [TBD/月] | [TBD] |
| **STUDIO** | 4 | 12 | 48 | 4K* | ✗ | ✓ | ✓ | [TBD/月] | [TBD] |

\* 4K 是否落地待 neodomain 后端确认；如无，STUDIO 兜底 1080p 高码率或 2K。

**字段说明：**
- "Char/Actor" = 每个 Actor 下可生成的 Character 数（不同 style 下的同一人）
- "Tokens" 是单一计费单位（不再使用 "Credits" 避免与 Web3 概念混淆）
- 月 Tokens / 价格 / Token 单价 / 视频生成消耗均待甲方确认

---

## Tier 详解

### 🎬 FREE（免费）

**定位**：第一次试水，体验 AI 把自己 cast 成不同风格的角色

| 维度 | 配置 |
|---|---|
| Actor 上限 | **1** |
| Character / Actor | **3** |
| 总 Character 数 | 3 |
| 视频分辨率 | 480p |
| 水印 | ✓ Uvera watermark |
| Series 模式 | ✗ 不可用 |
| Flow 模式 | ✗ 不可用 |
| 月 Tokens | TBD（甲方提供） |
| 价格 | $0 |

---

### 🚀 STARTER（入门订阅）

**定位**：定期创作者、社媒玩家，按月续 Token

| 维度 | 配置 |
|---|---|
| Actor 上限 | **2** |
| Character / Actor | **5** |
| 总 Character 数 | 10 |
| 视频分辨率 | 720p |
| 水印 | ✗ |
| Series 模式 | ✗ |
| Flow 模式 | ✗ |
| 月 Tokens | TBD/月 |
| 价格 | TBD/月 |

---

### ✨ CREATOR（专业创作者）

**定位**：IP 经营、剧集化输出、专业创作者

| 维度 | 配置 |
|---|---|
| Actor 上限 | **3** |
| Character / Actor | **8** |
| 总 Character 数 | 24 |
| 视频分辨率 | 1080p |
| 水印 | ✗ |
| Series 模式 | ✓ 解锁 |
| Flow 模式 | ✗ |
| 月 Tokens | TBD/月 |
| 价格 | TBD/月 |

---

### 🎞 STUDIO（工作室）

**定位**：工作室、品牌、agency、商业批量生产

| 维度 | 配置 |
|---|---|
| Actor 上限 | **4** |
| Character / Actor | **12** |
| 总 Character 数 | 48 |
| 视频分辨率 | 4K（待 neodomain 确认；fallback 1080p / 2K） |
| 水印 | ✗ |
| Series 模式 | ✓ |
| Flow 模式 | ✓ 解锁（Beta） |
| 月 Tokens | TBD/月 |
| 价格 | TBD/月 |

---

## Token Top-up 产品

一次性付费的 token 补充包，与订阅 tier **正交**。任何 tier 的用户都可购买，token 直接累加到账户余额，**不影响 feature gate**。

### ⚡ LITE — Token Top-up

| 维度 | 配置 |
|---|---|
| 价格 | **$3.99** |
| Tokens | **100**（一次性 grant 到余额） |
| 续费 | ✗ 无（pay-as-you-go） |
| 自动转订阅 | ✗ 无（user 主动决定是否升级） |
| 适合 | 不想订阅的轻度用户；订阅用户临时加量 |

**官方描述**（保留 verbatim 用于 UI）：
> A simple $3.99 top-up: 100 tokens added to your account, no recurring charge, no auto-conversion. Buy it again whenever you need more, or upgrade to a monthly plan for ongoing token allowance.

**关键设计意图：**
- FREE 用户买 LITE → 仍是 FREE tier，仍受 1 Actor / 5 Char / 480p / watermark 限制，只是 token +100
- STARTER 用户买 LITE → 当月 Token 配额 + 100
- 可以重复购买（无次数限制）
- 不触发 tier 变化（不自动升级 / 不强制订阅转化）

**未来可能扩展**（TBD，等甲方决策）：
- LITE+ / LITE++ 等更大 token 包
- 或保持 LITE 单一 SKU，依赖用户多次购买

---

## Token 经济

### 已知（费已实装，2026-05-11 同步）

**Short 视频生成 token 消耗**（commit `9b0ac4c`）：

| 分辨率 | Token 消耗 / video |
|---|---|
| 480p | **4** |
| 720p | **6** |
| 1080p | **12** |
| 4K | TBD（费未定，待 neodomain 支持） |

**比例**：2:3:6 阶梯。

**LITE 单 token 价上限**：$3.99 / 100 = **$0.0399/token**（top-up 通道）。订阅通道单 token 价应 < $0.0399 鼓励订阅。

**新用户 welcome gift**：20 credits（`getUserProfile()` 内 init，需 rename token）。

### 等甲方给出

- 各 tier 月 Token 配额（FREE / STARTER / CREATOR / STUDIO）
- LITE 价格之外的其他 top-up 是否存在
- 单条 Series episode 消耗（每集 = 多少 Short 等价？）
- Flow workflow 消耗

### 术语约定

**计费单位：**
- ❌ 不使用 "Credits"（与 Web3 credits 概念混淆）
- ✅ 统一使用 "Tokens"
- ⚠️ **当前代码仍用 credits**（`updateCredits()`, `claimDailyCredits()`, `orders.credits_deducted` 字段）。需规划 rename migration：DB column 改名 + API alias + 前端字段。短期前后端可并行 alias。

**Actor / Character（产品术语，2026-05-12 敲定）：**

| 术语 | 定义 | DB 存储 |
|---|---|---|
| **Actor** | 用户通过摄像头拍摄的**真人形象照片**，作为身份源 | `characters.identity_features.createdVia = 'upload'`（或 null） |
| **Character** | 基于某一 Actor，通过 AIgen 生成的**风格化角色**（不同 Style） | `characters.identity_features.createdVia = 'generated_concept'`，`source_character_id` 指向 Actor |

关系：
- 1 Actor → N Character（一对多，每 Style 一个 Character）
- Cast = 集合术语，指一组 Actors（影视惯用 collective noun，例如 Series 的 cast）
- Tier limits 计数：`actors` = upload 类，`charactersPerActor` = 该 Actor 下 generated_concept 数

⚠️ 历史代码命名：`characters` 表同时存 Actor + Character 两类，靠 identity_features.createdVia 区分。`source_character_id` 字段名 misleading（实际应叫 `source_actor_id`，待 rename）。前端 `selectedCharacterId` 变量可能指 Actor 或 Character。

### Tier / Token 数据存储现状（2026-05-12 同步）

**位置：`auth.users.raw_user_meta_data` JSONB**（Supabase 管理的 schema，不在 `public.users`）

```js
// 读取
const { credits, tier } = user.user_metadata || {};
// tier ∈ {'free', 'starter', 'creator', 'studio'}（'lite' 不是 tier — see Token Top-up）
// 默认 tier='free', credits=20 (welcome gift)

// 写入
await supabase.auth.updateUser({ data: { tier, credits } });
```

**没有 public 表存 tier / credits 字段**——即`subscription_plans` 表、`users.current_tier` 字段、`token_packages` 表都**未建**。Phase B schema 草案需要相应调整。

---

## 衍生作品 (Sequel / Branch / Recast)

Uvera 支持三种从已有作品派生新作品的方式。三者**视觉风格统一**（圆角胶囊 + glass material），但**语义不同**，分别对应三种创作意图。

### 定义

| 概念 (Noun) | 含义 | 时间线 | 角色 | 剧情 |
|---|---|---|---|---|
| **Sequel** | 续集 — 故事时间线向前推进 | **延续** (Episode 2, 3...) | 同 Actor | 续写 |
| **Branch** | 分支 — "如果..." 平行版本 | **分叉** (from a node) | 同 Actor | 不同走向 |
| **Recast** | 换角 — 同剧情换演员 | 同 | **不同 Actor** | 同 |

**关系图：**

```
        原片 (Original)
           │
   ┌───────┼───────────┐
   │       │           │
 Sequel  Branch     Recast
 (续集)  (分支)     (换角)
   ▼       ▼           ▼
 同 Actor 同 Actor   不同 Actor
 时间→    时间分叉    剧情同
```

### CTA (动词) vs Noun 用法

| 场景 | Sequel | Branch | Recast |
|---|---|---|---|
| **按钮 CTA**（用户动作） | "Continue this story" | "Branch this story" | "Recast this story" |
| **Badge / Metadata** | "Sequel of \<title\>" | "Branch of \<title\>" | "Recast of \<title\>" |
| **Filter / Tab** | "Sequels" | "Branches" | "Recasts" |
| **Tooltip / 说明** | "续集，时间向前" | "分支，平行剧情" | "换角，同剧情" |

CTA 用动词遵循 Apple HIG（按钮告诉用户「点了会做什么」），Noun 用于描述结果。

### UI 入口

| 位置 | 出现的 CTA |
|---|---|
| **StoryGeneratorPage 生成完成卡片** | Continue this story |
| **LightboxPlayer**（看自己/他人作品 finished 后） | Branch this story / Recast this story |
| **SparkMode** end-of-play（沉浸观看完） | Branch this story |

视觉：圆角 pill + glass material（`rgba(255,255,255,0.14) + backdrop-blur` 浅色版 / `rgba(255,255,255,0.20)` 强调版），iconography 用 `TreeStructure` (Branch) / `VideoCamera` (Recast) / 文字 only (Continue)。

### 数据库支持

**`recommended_content` 表字段**（migration `20260425_branch_recast_authorization.up.sql`）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `branch_of_id` | uuid FK self | 该作品是 `branch_of_id` 的 Branch |
| `recast_of_id` | uuid FK self | 该作品是 `recast_of_id` 的 Recast |
| `allow_branch` | bool | 原作者允许他人 Branch（发布时勾选） |
| `allow_recast` | bool | 原作者允许他人 Recast |
| `branch_count` | int | 已被 Branch 次数（缓存计数）|
| `recast_count` | int | 已被 Recast 次数 |

**Sequel 单独走 client-side flow**（无 FK，无授权字段）：
- 在 `localStorage.uvera_story_draft` 存 `isContinuation: true` + `continuationTitle` + `referenceVideoUrl`
- 刷新进 Quick mode 自动填 `[Continuation] Previously on "<title>"...` transcript
- 不写 DB FK（因为只能续自己的，无需"授权"概念）
- 未来如要"被他人续"功能再加 `sequel_of_id` 字段

### 授权 model

| 衍生类型 | 谁能创建 | 原作者授权字段 |
|---|---|---|
| **Sequel** | 仅原作者本人 | 无（自己续自己，不需要授权） |
| **Branch** | 原作 `allow_branch=true` 时，任何用户可 Branch | `allow_branch` 在 publish 时勾选 |
| **Recast** | 原作 `allow_recast=true` 时，任何用户可 Recast | `allow_recast` 在 publish 时勾选 |

⚠️ **Recast 隐含约束**：如果原作的 Actor 是某个用户的私有 Actor（未授权他人使用），即使作品 `allow_recast=true`，他人 Recast 时也得用**自己的 Actor**（替换）。这是 Recast 的本质——用自己的脸演别人的剧。

### Tier gates

衍生作品**不区分 tier**，任何 tier 用户都可创建。但每次衍生本质上是一次新 video gen，**消耗 token 按 resolution 价格**（480p=4 / 720p=6 / 1080p=12，per费 commit `9b0ac4c`）。

| Tier | Sequel 上限 | Branch 上限 | Recast 上限 |
|---|---|---|---|
| FREE | 受 token 余额限 | 受 token 余额限 | 受 token 余额限 |
| STARTER+ | 同上 | 同上 | 同上 |

未来如有 tier-specific 限制（如"FREE 不能 Branch 他人作品"），在此表加 row。

### 代码状态命名审计（待 Phase B rename）

完整 rename refactor 计划见独立 handoff：[`docs/archive/asks/2026-05-13-naming-consolidation-refactor.md`](../archive/asks/2026-05-13-naming-consolidation-refactor.md)

涵盖三组 rename：
- **A. `credits` → `tokens`** — DB columns + table + auth metadata key + API endpoints + 271 处前端 identifier
- **B. `source_character_id` → `source_actor_id`** — JSONB inner key（指 root Actor，原名 misleading）
- **C. `isContinuation` → `isSequel`** — frontend state + localStorage key + transcript prefix

4 阶段零中断迁移：dual-write → 前端切换 → backfill → 删旧。等费 ack 5 个决策点后启动。

---

## 实现层

### Phase A（前端 hardcode，2026-05-12 Leon）

**Source of truth (frontend)**：`src/data/plans.js`

```js
// Subscription tiers — control feature gates (β config 2026-05-12)
export const PLAN_LIMITS = {
  free:    { actors: 1, charactersPerActor: 3,  resolution: '480p',  watermark: true,  series: false, flow: false },
  starter: { actors: 2, charactersPerActor: 5,  resolution: '720p',  watermark: false, series: false, flow: false },
  creator: { actors: 3, charactersPerActor: 8,  resolution: '1080p', watermark: false, series: true,  flow: false },
  studio:  { actors: 4, charactersPerActor: 12, resolution: '4K',    watermark: false, series: true,  flow: true  },
};

// Token top-ups — orthogonal to tiers (don't change feature gates)
export const TOKEN_TOPUPS = {
  lite: {
    priceUsdCents: 399,
    tokens: 100,
    sku: 'LITE',
    oneTimePerUser: false,  // TODO 2026-05-12: 等费确认是否限购一次
  },
};
```

**Enforce 点**（client-side，可绕过，等 B 阶段补 server）：
- Actor 创建：`count(actors) < PLAN_LIMITS[tier].actors`，否则显示锁定 slot + upgrade CTA
- Character 创建：`count(characters where source_actor=X) < PLAN_LIMITS[tier].charactersPerActor`
- 进入 Series mode：`PLAN_LIMITS[tier].series === true`
- 进入 Flow mode：`PLAN_LIMITS[tier].flow === true`
- 视频生成 resolution 选项：按 `PLAN_LIMITS[tier].resolution` cap
- 视频水印：`PLAN_LIMITS[tier].watermark`

**当前 tier 来源（A 阶段）**：
- 短期：默认 `currentTier = 'free'`；从 `credit_grants` 最新 grant 的 `tier` 字段读 latest subscription tier
- 长期（B 阶段）：从 `users.current_tier` 字段读

---

### Phase B（后端落地，2026-05-12 Leon 已获费授权直接执行）

**Schema 改动**：

1. `users` 加 `current_tier` 字段：
   ```sql
   ALTER TABLE public.users
     ADD COLUMN current_tier text NOT NULL DEFAULT 'free'
     CHECK (current_tier IN ('free', 'starter', 'creator', 'studio'));
   ```

2. 建 `subscription_plans` 表（4 tiers，不含 LITE）：
   ```sql
   CREATE TABLE public.subscription_plans (
     tier text PRIMARY KEY,  -- 'free' | 'starter' | 'creator' | 'studio'
     actor_limit int NOT NULL,
     characters_per_actor int NOT NULL,
     max_resolution text NOT NULL,
     watermark boolean NOT NULL,
     series_access boolean NOT NULL,
     flow_access boolean NOT NULL,
     monthly_tokens int,
     price_usd_cents int,
     active boolean DEFAULT true,
     updated_at timestamptz DEFAULT now()
   );
   ```

3. 建 `token_packages` 表（一次性 top-up SKU，独立于 tier）：
   ```sql
   CREATE TABLE public.token_packages (
     sku text PRIMARY KEY,  -- 'LITE' | future 'LITE_PLUS' ...
     name text NOT NULL,
     price_usd_cents int NOT NULL,
     tokens int NOT NULL,
     active boolean DEFAULT true,
     updated_at timestamptz DEFAULT now()
   );
   INSERT INTO public.token_packages VALUES
     ('LITE', 'Lite Top-up', 399, 100, true, now());
   ```

4. `users` 加 `token_balance` 字段（如尚不存在）：
   ```sql
   ALTER TABLE public.users
     ADD COLUMN IF NOT EXISTS token_balance int NOT NULL DEFAULT 0;
   ```

5. RLS policy 在 `characters` INSERT 时 enforce limits（同时区分 Actor `createdVia='upload'` 与 Character `createdVia='generated_concept'`）

6. API 返回 `getMe()` 时附带：
   ```json
   { "currentTier": "starter", "tokenBalance": 350, "limits": { ... } }
   ```

**Migration 数据（2026-05-12 决策）**：
- 已付费用户（`credit_grants.tier IN ('starter','creator','studio')`）→ 保留对应 tier，**不重置**
  - 当前已识别：`839413c4` = STARTER（来自 $25 Stripe 已落账）
- 其他用户 → `current_tier = 'free'`
- **Grandfathering 策略**：超 tier 限的 Actor / Character 数据**清理删除**（保留按 createdAt 最早的 N 条，删除其余），全员从合规起步。已付费 STARTER 用户 `839413c4` 当前无数据，无需清理。

---

## Change Log

| 日期 | 变动 | 决策人 |
|---|---|---|
| 2026-05-12 | 文档建立。术语 Actor / Character 敲定。5 tier 命名 + Char/Actor 推荐版 + 特权矩阵敲定。Token/价格待甲方。LITE 定位推测为"配置同 STARTER 一次性付费"。 | Leon |
| 2026-05-12 | **LITE 重新定位**：从"STARTER 体验版 tier"修正为"$3.99 / 100 tokens 一次性 top-up SKU"，与订阅 tier 解耦。Tier 缩减为 4 个：FREE / STARTER / CREATOR / STUDIO。LITE 移入新 [Token Top-up 产品](#token-top-up-产品) 章节。 | Leon |
| 2026-05-12 | **Char/Actor 收紧 β 档**：FREE 5→3 / STARTER 10→5 / CREATOR 20→8 / STUDIO 40→12（UI friendly，总数 ≤ 48 单页可展）。Migration 决策：保留已付费 tier，不重置；仅清理超限 Actor/Character 数据。 | Leon |
| 2026-05-12 | **同步费 backend 已实装**：LITE = $3.99 / 100 tokens 可重复购买（commit `4c237d4` 与 verbatim 描述一致）。Short video token cost 已定：480p=4 / 720p=6 / 1080p=12（commit `9b0ac4c`）。tier 实际存 `auth.users.user_metadata`，非 public 表字段。代码命名仍是 credits，待 rename token。 | Leon |
| 2026-05-13 | **衍生作品体系章节落地**：Sequel / Branch / Recast 三类语义 + CTA verb form + DB schema 映射 + 授权 model 全部文档化。CTA 按钮统一动词式 "X this story"。`isContinuation` → `isSequel` rename 列入 Phase B。 | Leon |
| 2026-05-13 | **综合 rename refactor handoff 落地**：[docs/archive/asks/2026-05-13-naming-consolidation-refactor.md](../archive/asks/2026-05-13-naming-consolidation-refactor.md) 整合 credits→tokens + source_character_id→source_actor_id + isContinuation→isSequel 三组 rename，4 阶段零中断迁移计划。等费 ack 启动 Phase 1。 | Leon |

---

## 待办

- [ ] **甲方提供**：FREE / STARTER / CREATOR / STUDIO 各自月 Token 配额
- [ ] **甲方提供**：STARTER / CREATOR / STUDIO 价格点（LITE 已敲定 $3.99）
- [ ] **甲方提供**：单条 Short / Series episode / Flow 各自 token 消耗规则（含不同分辨率档差）
- [ ] **甲方决定**：LITE 之外是否有 LITE+ / LITE++ 等更大 token 包
- [ ] **neodomain 后端确认**：4K 是否支持，不支持时 STUDIO fallback
- [x] **Grandfathering 策略**（2026-05-12 决策）：保留已付费 tier、清理超限 Actor/Char 数据。预览见下。
- [ ] **执行清理 DELETE SQL**（待 Leon 确认）：β 收紧后会删除 4 Actors + 59 Characters，仅影响 FREE 用户测试数据
- [ ] Phase A 实现：`src/data/plans.js` + 前端 enforce + UI 升级提示
- [ ] Phase B 实现：schema migration（4 tier subscription_plans + token_packages + users.current_tier）+ RLS + API

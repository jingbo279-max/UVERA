---
title: UVERA 产品设计文档（GA 版）
type: doc
status: active
owner: Leon
created: 2026-05-08
updated: 2026-05-08
tags: [product, design]
source_of_truth: true
---

# UVERA 产品设计文档（GA 版）

> **版本**：对应产品 v1.0.6 / GA 2026-05-08
> **维护**：费（前后端通管）+ Leon（产品主导）
> **定位**：本文件是 **UVERA 产品设计的 single source of truth**。任何关于"为什么是这样设计"的问题先看这里。
> **配套文件**：交付清单见 `docs/product/GA-DELIVERABLES.md`、技术栈见 `docs/engineering/TECH-STACK.md`、合规见 `docs/legal/COMPLIANCE.md`。

---

## 0. 30 秒电梯简介

> UVERA 是一个**让独立创作者用 AI 把脑子里的画面变成 10–30 秒短视频**的平台。
>
> 用户上传一张脸的照片就能创建可复用的角色，用一句话写故事就能拿到 AI 编剧 + 概念图 + 渲染好的视频，订阅会员获得每月持续生成额度。GA 后还可以上传自有视频公开发布。
>
> 我们做的不是另一个"输入 prompt 出视频"的工具——我们做的是**降低短片创作门槛，让有故事的人不被技术挡住**。

---

## 1. 产品愿景与边界

### 1.1 Vision

> **每个人都应该能把脑子里的画面拍出来。**

工具让人变强大。30 年前要拍一段广告片，需要导演 + 剪辑 + 灯光 + 后期 + 几十万预算。今天，一个独立创作者用 UVERA 一杯咖啡的时间，可以拿到一段镜头清晰、风格可控、角色一致的成片。这不是替代专业制作——是把"我有一个 idea 但拍不出来"的人解锁出来。

### 1.2 Mission

帮助 **不擅长制作但擅长讲故事**的人，用 AI 完成从"想法 → 成片"的最短路径，并保留商业化的可能性。

### 1.3 我们做什么

- ✅ **AI 视频生成**（10–30 秒为主）
- ✅ **角色一致性**（一张照片复用到所有作品）
- ✅ **风格化**（Animation / Traditional / Avant-garde / Modern 四类基础风格 + 持续扩展）
- ✅ **作品发布**（Discover 公开 feed）
- ✅ **创作者订阅**（Free / $25 / $69 / $189 四档）

### 1.4 我们不做什么（GA 阶段明确边界）

| 不做 | 原因 |
|---|---|
| 长视频（≥ 5 分钟）| 模型成本、用户体验、审核压力都不匹配 |
| 用户社区 / 评论 | UGC 反垃圾工程量太大，先做内容质量 |
| 中国大陆主战场 | 备案 / 内容审查 / 支付通道全部要重做，先海外验证 |
| 直播 / 实时流 | 不是当前的差异化点 |
| 完全自由的图生图（无角色锁定） | 风格漂移严重，体验差 |

---

## 2. 用户画像

### 2.1 P1 —— 独立短视频创作者（占比预期 60%）

**典型人物**：Maya，27 岁，纽约自由职业，靠 TikTok / IG 短视频接广告。
- **痛点**：每月需要产出 8–12 条素材，但拍摄成本高 + 概念视觉化能力弱
- **使用场景**：用 UVERA 做开头 5 秒的"片头" / trailer / 概念视觉化
- **付费意愿**：$25–$69/月（Starter / Creator）
- **关键判断**：渲染速度 + 角色一致性

### 2.2 P2 —— 概念设计师 / 美术（占比预期 20%）

**典型人物**：Akira，35 岁，东京游戏公司外包美术。
- **痛点**：客户要"动起来的概念"，自己不会动画
- **使用场景**：把 keyframe 概念图变成 5–10 秒动态预览
- **付费意愿**：$69–$189/月（Creator / Studio，看商业项目数）
- **关键判断**：图像保真度 + 商用授权

### 2.3 P3 —— 营销 / 内容运营（占比预期 15%）

**典型人物**：Sarah，30 岁，美国电商公司社媒经理。
- **痛点**：要求每周产出 3 条产品社媒视频，预算紧
- **使用场景**：产品场景化短片
- **付费意愿**：公司报销 $189/月（Studio）
- **关键判断**：批量产出能力 + 风格一致性

### 2.4 P4 —— 重度玩家 / 探索者（占比预期 5%）

**典型人物**：Dan，22 岁，美国大学生，AI 工具早期采用者。
- **痛点**：想试遍所有可能的风格组合
- **使用场景**：探索性创作 + 社交分享
- **付费意愿**：$25/月（Starter）+ 高每日活跃
- **关键判断**：风格广度 + 社区氛围（v1.1 增）

---

## 3. 核心交互流程

### 3.1 创作主流程（Quick Mode 5 步）

```
┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
│ 选/创  │ ─→ │ 写故事 │ ─→ │ 选风格 │ ─→ │ AI编剧 │ ─→ │ 渲染   │
│ 角色   │    │ 1句话  │    │ 4分类  │    │ 自动语 │    │ 概念→  │
└────────┘    └────────┘    └────────┘    │ 言匹配 │    │ 视频   │
                                           └────────┘    └────┬───┘
                                                              │
                                                              ▼
                                                         ┌─────────┐
                                                         │ 发布到  │
                                                         │ Discover│
                                                         └─────────┘
```

**关键设计决策**：

1. **角色作为第一公民**。不是"输入 prompt 出视频"，而是"基于一个具体的角色/人物去生成"。这给了用户**作品系列化**的能力——同一个角色可以演不同剧情，作品有了延续性。

2. **AI 编剧降低写作门槛**。用户写"一只橘猫推倒了花盆"，AI 输出标题 + 旁白 + 镜头列表（且语言匹配输入）。**避免新手卡在"prompt 工程"**——让人写故事，机器写技术 prompt。

3. **风格分类而非一字排开**。9 页分页器的旧版本被改成 4 个分类 tab（v1.0.5），用户决策成本从 30 秒降到 5 秒。

4. **真实经过时间 + 进度条**。视频渲染中位 90 秒，**不可以用假进度条**（用户会觉得"卡住了"），必须显示真实经过秒数 + ETA 估算。

5. **发布 success card 不是 alert**。alert 强迫确认且无法 styling；success card 给"继续创作 / 回首页"双 CTA，引导留存。

### 3.2 Free Mode（自由模式）

**目标用户**：知道自己想要什么的进阶用户。

```
┌─────────────────────────────────────────────────────┐
│  prompt 输入框（含 @ 引用）                          │
│  ┌──────────────────────────────────────────┐       │
│  │ 一只 [@Image1:橘猫] 在 [@Image2:厨房]    │       │
│  │ 推倒了 [@Image3:花盆]                    │       │
│  └──────────────────────────────────────────┘       │
│                                                     │
│  素材区: [@1] [@2] [@3]  + 上传 / 从库 / AI生成     │
│                                                     │
│  时长 [5s ▼]  分辨率 [720p ▼]   信用点: 15         │
│                                                     │
│             [生成 Segment]  [合并 Segments]         │
└─────────────────────────────────────────────────────┘
```

**关键设计决策**：

1. **Atomic Tag**。`@Image1:橘猫` 是单原子 token，删除时整体消失，不可逐字符删除。用 `onKeyDown` + `onBeforeInput` 拦截实现，避免用户误删半个引用导致 LLM 解析错误。

2. **多 Segment 拼接**。每段 ≤ 15s（Seedance 模型限制），用户可以拼成更长视频。**FFmpeg.wasm 客户端合成**（自托管避免 unpkg cross-origin 问题），不耗服务器资源。

3. **参考视频也限 15s**。AI 模型对参考视频长度有硬限。v1.0.6 在客户端 `<video>` 元素本地探测 duration，**上传前**拒绝过长视频，省带宽 + 错误信息清晰。

### 3.3 Upload Video（v1.0.6 新增）

**目标用户**：有现成视频，希望发布到 Discover 的用户（如 vlogger 把成片放上来）。

```
┌──────────────────────────────────────────────┐
│  📹 标题（必填）                              │
│  📝 描述（选填）                              │
│  📂 文件（≤ 2 GB）                            │
│                                              │
│  ☐ 我确认拥有版权或获得授权...               │
│     （签 v1-2026-05-07 版本号）              │
│                                              │
│  [Submit for Review]  ← 不勾 checkbox 禁用   │
│                                              │
│  ───────                                     │
│                                              │
│  审核 48h 内完成，approve 后自动上 Discover │
└──────────────────────────────────────────────┘
```

**为什么强制审核**：用户自由上传 = UGC 平台。法务底线是宁可慢也不能让侵权 / 不当内容直接公开，否则平台连带责任。

**为什么用 Cloudflare Stream**：
- 浏览器**直接**上传到 Stream（绕开 Worker 100MB body 限制）
- Stream 自动转 HLS 自适应码率（移动端流畅）
- 单视频上限 30 GB（远超用户实际需求）
- 转码 + CDN 一站式（自己做要部署 transcoder + 多 region 节点）

---

## 4. 信息架构（页面树）

```
/
├─ /auth                      Auth gate（OAuth + magic link）
├─ /                          Discover home（Hero + 推荐 feed）
├─ /create                    Quick Create（3 mode）
│   ├─ Quick Mode             5 步引导式向导
│   ├─ Free Mode              prompt + segments
│   └─ Upload Video           v1.0.6 新加
├─ /library                   个人作品库
├─ /wallet                    钱包 / 信用点 / 每日领取
├─ /subscription              三档定价 + 当前订阅
├─ /settings                  Profile / Tier / 法律链接 / 登出
├─ /legal/
│   ├─ /terms                 用户协议
│   ├─ /privacy               隐私政策
│   └─ /content-license       内容许可
└─ /admin/
    ├─ /admin                 admin 登录
    └─ /admin/dashboard       8 个 tab（详见 §6）
```

---

## 5. 设计语言（Leon 主导）

> 详细规范见 `docs/design/system/COLOR-SYSTEM.md`、`docs/engineering/DESIGN-SYSTEM-MIGRATION.md`、`docs/guides/HERO-LAYOUT.md`。

### 5.1 字体

- **H2 / 标题**：Crimson Pro 衬线（serif）—— 暗示"作品 / 文学性"
- **正文 / UI**：默认 sans-serif

### 5.2 颜色

- 背景多层（`bg-background`、`bg-background-secondary`、`bg-background-tertiary`）
- 强调色 `bg-accent`（紫色调，按钮 + 链接）
- 标签 `text-label` / `text-label-secondary` / `text-label-tertiary` / `text-label-quaternary`

### 5.3 卡片 / 按钮

- 卡片：`bg-background-secondary rounded-2xl`（圆角偏大，柔和感）
- 按钮：`bg-accent text-white rounded-xl py-3`
- 主图标库：`@phosphor-icons/react`（线性风格统一）

### 5.4 微交互

- **Eyebrow chip**：每个主区块顶部一个小写英文短语（uppercase tracking-wide），引导阅读
- **Atomic asset tag**：@-mention 整体高亮 + 整体删除
- **Progress bar 真实数据**：经过时间 + 进度，避免假进度

---

## 6. 商业模式

> **命名约定（2026-05-08 起）**：用户可见的"信用点"统一称作 **Tokens**（Leon 在 commit `8b4826e` 决定）。代码内部的字段名 / 函数名 / 数据库列保留 `credits`：`user_metadata.credits`、`credit_grants` 表、`/api/admin/grant-credits` 端点等。**用户文案 = Tokens，工程实现 = credits**。这种 split 是常见做法（类似 "Like" UI vs `favorite` 数据库表），避免重命名后端的痛苦。

### 6.1 订阅四档

| 档位 | 价格（USD/月）| 信用点 | 解锁能力 |
|---|---|---|---|
| **Free** | $0 | 6/天（每日主动领）| Quick Mode、Free Mode 480p / 720p |
| **Starter** | $25 | 500/月 | + 1080p 渲染（部分模型）|
| **Creator** | $69 | 1500/月 | + 优先队列 + 多 segment |
| **Studio** | $189 | 5000/月 | + 商用授权 + 高优先级支持 |

### 6.2 信用点消耗

```
RESOLUTION_CREDITS_PER_SEC = {
  '480p':  2,
  '720p':  3,
  '1080p': 7,
}
```

例：`5s × 1080p = 35 tokens`、`10s × 720p = 30 tokens`。
（用户可见文案统一为 Tokens；DB 内部列名 `credits` 保留。）

### 6.3 转化漏斗设计

**Free 用户每日 6 tokens = 一段 3 秒 480p 或 2 秒 720p**：
- 够"试一下"，**不够"做一个完整作品"**
- 用户每天回来领免费额度 → 留存
- 当用户感受到"想做更长 / 更高清的"时，自然引导付费

### 6.4 支付架构

```
用户 → /subscription → Stripe Checkout → ✅ 付款
                                          │
                                          ▼
                          Stripe Webhook → /api/stripe/webhook
                                          │
              ┌───────────────────────────┴──────────────────┐
              ▼                                              ▼
     auth.users.user_metadata               public.orders（财务对账）
       .credits  +=  N                       (userId, amount, status,
       .tier     =   "creator"                stripe_invoice_id)
```

**双写**：业务层快读用 `user_metadata`，财务对账靠 `orders`。webhook 失败时管理员可手动补发（写 `credit_grants` 同步审计），并自动 reconcile。

---

## 7. 数据模型（精简）

> 完整 schema 见 `migrations/*.sql`，列表见 `docs/product/GA-DELIVERABLES.md` §D。

```
                       ┌──────────────┐
                       │ auth.users   │  Supabase 内置
                       │ (.metadata: │
                       │  credits,    │
                       │  tier,       │
                       │  is_admin,   │
                       │  is_super)   │
                       └──────┬───────┘
                              │
       ┌──────────┬───────────┼──────────────┬────────────┐
       ▼          ▼           ▼              ▼            ▼
  ┌────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐
  │ orders │ │characters│ │credit_   │ │user_video│ │beta_       │
  │(Stripe)│ │ (角色) │   │  grants  │ │_uploads  │ │  requests  │
  └────────┘ └─────────┘ └──────────┘ │(v1.0.6)  │ └────────────┘
                                      └────┬─────┘
                                           │  approved 后插入
                                           ▼
                                   ┌─────────────────────┐
                                   │recommended_content  │
                                   │   (Discover feed)   │
                                   └─────────────────────┘
```

**RLS 一条铁律**：每张用户私有表强制 `auth.uid() = user_id OR public.is_admin()`。

---

## 8. 关键技术决策（why this way）

### 8.1 为什么 Cloudflare Workers + Supabase 双栈

- **Workers**：边缘部署，全球低延迟，单文件 Worker 简单维护
- **Supabase**：开箱即用 Auth + Postgres + RLS，省了一个团队的后端工作量
- **痛点**：Worker 100MB body 限制 → 大文件走 Stream / R2 直传

### 8.2 为什么 BytePlus / Volcengine 而非 Runway / Sora

- 价格更亲民（成本控制）
- API 稳定性 OK（实测中位生成时间 90s）
- Seedance 2.0 角色一致性表现优秀
- **风险**：单一 vendor 依赖，备选 plan = Replicate 多模型路由（v1.1 候选）

### 8.3 为什么 Stripe（不自建支付）

- 全球合规一站式（PCI DSS）
- Customer Portal 省了"自助升降级"工程量
- Webhook 模式与我们的事件驱动架构匹配
- 2.9% + $0.30 / 笔的费率可接受

### 8.4 为什么用户视频要审核（不让自动发布）

- 法务底线 —— UGC 平台连带责任
- 内容质量底线 —— Discover 是品牌门面
- 48h SLA 是"用户可接受"和"平台可承受"的平衡点

### 8.5 为什么 React 19 / Vite 7（不是 Next.js）

- SPA 简单，Cloudflare Static Assets 直接出
- 不需要 SSR（创作工具型产品，SEO 不是核心）
- Vite 构建速度快，开发体验好

---

## 9. 路线图

### 9.1 v1.0.6 → 5/8 GA（本版本）✅

- 双层管理员（super_admin / admin）
- 用户视频上传 + 审核
- 上传体验大幅优化

### 9.2 v1.0.7 候选（GA 后第一个迭代窗口，2 周内）

| 优先级 | 项 |
|---|---|
| P0 | Discover 视频卡片 **举报按钮**（DMCA 入口）|
| P0 | Cookie Banner（GDPR）|
| P1 | 用户视频 approved/rejected **邮件通知** |
| P1 | `orders.userId` FK 修正（指向 auth.users）|
| P2 | 用户侧"我的上传"状态查看 |
| P3 | 上传中断恢复（tus 协议）|

### 9.3 v1.1 候选（6 月）

| 优先级 | 项 |
|---|---|
| P0 | **Series（连载）功能** —— 多集一组、跨集角色复用 |
| P0 | Creative Canvas 正式上线（高级编辑器）|
| P1 | 多模型路由（Replicate 备选）|
| P1 | 用户行为分析（PostHog）|
| P2 | 多人协作（团队订阅）|

### 9.4 v2 候选（远期）

- 国内合规版本（如果决定开拓国内市场）
- 直播 / 实时流
- 用户社区 / 评论
- 创作者收益分成

---

## 10. 衡量指标（OKR）

### 10.1 北极星指标

> **Weekly Active Creators with at least 1 published video**

衡量"用户**真的在创作**而不是只注册看看"。

### 10.2 GA 后 30 天目标

| 指标 | 目标 |
|---|---|
| 累计注册用户 | 5,000 |
| WAU | 1,000 |
| Weekly Active Creators | 300 |
| 付费转化率 | ≥ 3% |
| MRR | ≥ $5,000 |
| Discover 总作品数 | ≥ 1,500 |
| 用户视频上传 + approved | ≥ 100 |
| 平均渲染成功率 | ≥ 92% |
| Sentry 错误率（unique error / DAU）| ≤ 0.5% |

### 10.3 GA 后 90 天目标

| 指标 | 目标 |
|---|---|
| MAU | 5,000 |
| MRR | ≥ $25,000 |
| 累计付费用户 | ≥ 800 |
| 平均 LTV | ≥ $80 |
| 退订率（churn）| ≤ 8%/月 |

---

## 11. 团队与责任分工

| 角色 | 人 | 主要负责 |
|---|---|---|
| 产品 / 甲方接口 | Leon | 需求 + 设计语言定调 + 用户访谈 |
| 工程 CEO（前后端通管）| Fei & H. Zheng | 全栈实现、数据库、部署、CI、合规 |
| 后端开发 | Yan Shao | 模型集成、Worker 优化 |
| Ops 管理员（v1.0.6 新增 6 位）| yazhongliu186 / tuaiai20260304 / jessiehuang9215 / hquanbin662 / jingbo279 / bachbanana | 内容审核（48h SLA）、用户支持 |
| 法务 | 外部律师 | TOS/Privacy/Content License 终审 |

---

## 12. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| AI 模型 vendor 单一依赖（Volcengine）| 🔴 高 | v1.1 接入 Replicate 多模型路由 |
| Stripe live mode webhook 偶发不触发 | 🟡 中 | 已有 email fallback + 手动补发对账 |
| 用户上传侵权内容 | 🔴 高 | 强制版权 checkbox + IP/UA 留痕 + 48h 审核 + DMCA 邮箱 |
| 国内访问 CF 慢 | 🟡 中 | 主战场海外，国内不是首要市场 |
| 6 位 Ops 审核能力不足应对增长 | 🟡 中 | 监控 pending_review 队列长度，> 50 时启动招聘 |
| AI 生成内容版权争议 | 🟡 中 | TOS 明确"用户拥有使用权，UVERA 保留训练许可" |
| Free tier 用户烧 API 不付费 | 🟢 低 | 6 tokens/天 = $0.10 成本，可控 |
| GA 当天 traffic spike | 🟡 中 | CF Workers 自动扩容，Supabase 已升至 Pro tier |

---

## 13. 文档索引

| 文件 | 用途 |
|---|---|
| `docs/product/PRODUCT-DESIGN.md` | **本文件** —— 整体产品设计 |
| `docs/product/GA-DELIVERABLES.md` | GA 完整交付清单 |
| `docs/releases/RELEASE-v1.0.6.md` | v1.0.6 增量发布说明 |
| `docs/guides/pre-launch-checklist.md` | GA 上线冒烟清单 |
| `docs/engineering/TECH-STACK.md` | 技术栈细节 |
| `docs/legal/COMPLIANCE.md` | 合规策略 |
| `docs/legal/TERMS-OF-SERVICE.md` | 用户协议 |
| `docs/legal/PRIVACY.md` | 隐私政策 |
| `docs/legal/CONTENT-LICENSE.md` | 内容许可 |
| `docs/governance/DEFERRED-DECISIONS.md` | 延后决策 |

---

**文档维护**：费 (feifeixp)
**最后更新**：GA 当天
**评审节奏**：每个 minor 版本（1.x.0）发布前更新一次

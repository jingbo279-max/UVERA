---
title: Uvera Compliance Baseline
type: legal
status: active
owner: 律师
created: 2026-04-25
updated: 2026-05-18
tags: [legal, compliance]
---

# Uvera Compliance Baseline

> **本文件为合规基准文档（Compliance Baseline）。**
> 所有关键合规红线、授权契约、跨甲乙法律边界条款必须沉淀在此。
> **修改需经 Leon 确认并签字。** 其他 memory（Claude 私有）与本文件冲突时，以本文件为准。

**Last updated**: 2026-04-25
**Maintainer**: Leon（产品主导） + 费（乙方 CEO，后端/法务对接）
**Purpose**: 供甲方验收、法务审查、团队交接、版本回溯使用

---

## Table of Contents

1. [Avatar 形象权（Personality Rights + Copyright）](#1-avatar-形象权)
2. [Branch 接龙授权契约](#2-branch-接龙授权契约)
3. [Recast 出镜授权契约](#3-recast-出镜授权契约)
4. [AI 训练数据边界](#4-ai-训练数据边界)
5. [版权 & 用户协议文本（待法务定稿）](#5-版权--用户协议文本待法务定稿)
6. [用户数据收集 & 隐私（待系统性整理）](#6-用户数据收集--隐私)

---

## 1. Avatar 形象权

**决策日期**: 2026-04-25
**决策人**: Leon

### 1.1 红线

**私有 Avatar**（用户自建的数字分身）**只能由 owner 本人调用**。其他用户不可使用、不可用于 AI 训练。属于 **形象权 (personality rights) + 版权 (copyright)** 层面的合规要求，**不是**产品 UX 偏好。

### 1.2 权限矩阵

| Avatar 类型 | 归属 | 他人可复用 | 可用于训练 |
|---|---|:---:|:---:|
| 私有 Avatar（用户自建） | owner | ❌ | ❌ |
| 官方公共 Avatar（Uvera 发布） | 平台 | ✅ | ✅ |

### 1.3 唯一例外：官方公共 Avatar 库

由 Uvera 官方发布的公共 Avatar 可被任意用户复用、可用于训练。合规基座：
- 平台持有 **model release**（被拍摄者肖像授权）
- 平台持有 **IP agreement**（内容与衍生使用权利）
- 发布流程由官方/法务线负责审核

### 1.4 Why（动机与风险）

- Avatar 是用户个人形象的数字化载体
- 未经 owner 授权使用私有 Avatar 构成 **侵权**（人格权 + 肖像权 + 版权）
- 平台若放任，面临 **法律风险 + 品牌声誉崩塌** 双重打击
- 官方库是主动策划 + 契约兜底的单独赛道

### 1.5 How to apply（产品层落点）

所有涉及 Avatar 的 feature / API / UI **必须**过此筛：

1. **Recast（出镜）流程**：owner 本人发起的 self-service 动作 — 选别人的模板/剧本 → 把**自己的** Avatar（或官方公共 Avatar）放进去。**禁止**提供"用他人私有 Avatar 套我的脚本"的入口
2. **Avatar 库分层**：
   - `My Avatars` 标签只显示 owner 自己的 Avatar
   - `Public / Official` 标签只列出 `is_official=true` 的官方 Avatar
   - **禁止**任何"浏览他人私有 Avatar → 拖入模板"的 UX
3. **API 层**：任何 `useAvatar(avatarId, userId)` 类函数签名，后端校验条件为 `avatar.owner === userId OR avatar.is_official === true`。**不依赖前端 UI 屏蔽**
4. **分享/下载**：他人观看/下载含我（私有）Avatar 的作品时，不得有"一键提取该人物形象"的功能
5. **术语**：涉及出镜的英文禁止用 `Cast as`（暗示被别人选角）；使用 owner-agency 主动语态（`Recast`）

### 1.6 触发高危提醒的变更

以下变更需暂停并与 Leon + 费 + 法务对齐：
- 新增 `avatar_usage` / `avatar_shared` / `is_official` / `public_avatars` 等 DB 字段/表
- API 新增接受"非 owner 调用**私有** avatar"的接口
- UI 出现"他人私有 Avatar 库 / 推荐他人私有 Avatar / 未标记官方身份的公共形象池"等入口
- 与 AI 训练 / 分发相关的 avatar 素材流向（尤其私有与官方混流）
- 官方 Avatar 发布流程（admin UI / license 录入）

### 1.7 安全区（不触发提醒）

- 官方 Avatar 库的**前端消费侧 UI**（浏览 / 筛选 / 应用到模板）
- `My Avatars` 本人 CRUD（前提：不跨用户）

---

## 2. Branch 接龙授权契约

**决策日期**: 2026-04-25
**决策人**: Leon

### 2.1 定义

**Branch（接龙）**：其他用户基于**我发布的作品**，继承风格 / 场景 / 角色 / 剧情设定，续拍**分支剧情**的动作。多个用户可并行发起多个分支；观众播放时可能随机播其中一个分支。

**Cross-author** 动作 — 涉及作者间的授权让渡。

### 2.2 核心契约

用户发布作品时**主动勾选** `Allow Branch` checkbox，才允许他人基于该作品发起 Branch。

- **默认 OFF**（opt-in 原则，不预设授权）
- 发布后允许随时关闭（已创建的 Branch 不回溯删除，但禁止新建）

### 2.3 权利让渡范围

勾选 `Allow Branch` 视为 **原作者授权他人基于本作品的以下元素进行二次创作**：
- 风格（style）
- 场景（scene / setting）
- 角色设定（character archetype — **不含 Avatar 身份**）
- 故事发展方向（story arc / plot seeds）

**不授权**：
- 原作者的 Avatar 形象身份（属 §1 红线，单独授权）
- 原音频 / 原视频资产的直接复制（Branch 是续拍，不是 re-post）

### 2.4 DB 落点（✅ 已落地 2026-04-25）

| 列 | 类型 | 默认 | Migration |
|---|---|---|---|
| `recommended_content.allow_branch` | BOOLEAN NOT NULL | false | [`20260425_branch_recast_authorization.up.sql`](../../migrations/20260425_branch_recast_authorization.up.sql) |
| `recommended_content.branch_of_id` | UUID NULLABLE FK→recommended_content(id) ON DELETE SET NULL | NULL | 同上 |
| Partial index `idx_recommended_content_branch_of_id` | `WHERE branch_of_id IS NOT NULL` | — | 同上 |

派生关系表（`branches` { source_work_id, branch_work_id, author_id, created_at }）暂未建 — 当前用 `branch_of_id` 反查列实现 social proof。如未来需要带元数据再升级。

### 2.5 API 校验

所有创建 Branch 的接口必须校验源作品 `allow_branch === true`。**前端隐藏 CTA 不充分**，后端是 source of truth。

### 2.6 UI 落点

- 发布流 action 按钮上方"授权区"卡片包含 `Allow Branch` checkbox（详见 §2.7 下方 UI spec）
- End-of-video overlay CTA（mobile）显示 `Branch this story` 入口，仅当源作品 `allow_branch === true`

### 2.7 UI Spec（待实施）

**落点**: `src/pages/StoryGeneratorPage.jsx:1177` action 按钮组上方
**容器**: `glass-regular` + `rounded-2xl` + `p-5`
**结构**:
```
Publishing Settings
─────────────────────
☐  Allow Branch
   Let others continue your story in new directions.

☐  Allow Recast
   Let others use their own Avatar in place of characters.
   (Disabled if this work contains others' private Avatars.)

By publishing, you agree to the [Content License Terms ↗]
```

**默认**：两项均 OFF
**Recast 受限态**：若作品包含他人私有 Avatar，`Allow Recast` **直接灰字 + disabled**（不使用 tooltip）

---

## 3. Recast 出镜授权契约

**决策日期**: 2026-04-25
**决策人**: Leon

### 3.1 定义

**Recast（出镜）**：owner 本人使用自己的 Avatar 出演别人的短视频（模板/剧本），**替换其中的角色**。Self-service 动作（主语 = owner，不是别人）。

### 3.2 核心契约

与 Branch 不同，Recast 的授权结构分两条：

**A. 源作品作者侧**（被 Recast 的作品）：
- 发布时勾选 `Allow Recast` 允许他人把自己的 Avatar 替换到该作品的角色
- **约束**：若作品包含**他人私有 Avatar**（源作品作者拿别人的私有 Avatar 生成），`Allow Recast` **强制禁用**（不能让渡不属于自己的形象权）

**B. Recaster 侧**（发起 Recast 的用户）：
- 只能使用**自己的私有 Avatar** 或**官方公共 Avatar**（§1 红线）
- 不能使用他人私有 Avatar（UI 层面不提供入口，API 层强制校验）

### 3.3 DB 落点（✅ 已落地 2026-04-25）

| 列 | 类型 | 默认 | Migration |
|---|---|---|---|
| `recommended_content.allow_recast` | BOOLEAN NOT NULL | false | [`20260425_branch_recast_authorization.up.sql`](../../migrations/20260425_branch_recast_authorization.up.sql) |
| `recommended_content.recast_of_id` | UUID NULLABLE FK→recommended_content(id) ON DELETE SET NULL | NULL | 同上 |
| Partial index `idx_recommended_content_recast_of_id` | `WHERE recast_of_id IS NOT NULL` | — | 同上 |

派生关系表（`recasts` { source_work_id, recast_work_id, recaster_id, avatar_id }）暂未建。`avatar_id` 与作品的关联未来需要单独设计（Avatar 溯源是 §1 Avatar 形象权红线的一部分）。

**校验**：`allow_recast === true` **AND** 源作品不含他人私有 Avatar — 仍待后端实现。

### 3.4 UI 受限态（Leon 2026-04-25 明确）

源作品含他人私有 Avatar 时，发布流 `Allow Recast` checkbox **直接灰字 + disabled**，不使用 tooltip。

---

## 4. AI 训练数据边界

**决策日期**: 2026-04-25
**决策人**: Leon

| 素材类型 | 可用于模型 / LoRA 训练 |
|---|:---:|
| 私有 Avatar 影像 | ❌ |
| 官方公共 Avatar 影像 | ✅ |
| 用户生成作品（不含他人私有 Avatar） | 待法务条款明确（§5） |
| 用户生成作品（含他人私有 Avatar） | ❌ |

训练管道的 ingestion 脚本必须按此矩阵过滤素材。

---

## 5. 版权 & 用户协议文本（v0.1 draft 已落地，待律师定稿）

**状态**: 🟡 v0.1 草稿完成（2026-05-05），待外部律师终审

**已落地输出物**：
- [`docs/legal/TERMS-OF-SERVICE.md`](./TERMS-OF-SERVICE.md) — 用户协议 v0.1（含管辖、仲裁、退款、订阅、责任限制）
- [`docs/legal/PRIVACY.md`](./PRIVACY.md) — 隐私政策 v0.1（GDPR + CCPA 双覆盖，含第三方处理者列表与 cookie 清单）
- [`docs/legal/CONTENT-LICENSE.md`](./CONTENT-LICENSE.md) — 内容授权条款 v0.1（Branch / Recast / Avatar / AI 训练边界）

**草稿决策原则**（费 2026-05-05 定）：
- 主体：longVV Ltd（美国，默认 Delaware 注册，待律师确认）
- 地理范围：c — 全球开放，**不含中国大陆**
- AI 训练：d — 仅训练 Official Avatar 库，绝不训练用户内容
- 退款：a — 7 天无理由全退（首次购买）
- 最低年龄：16（GDPR-friendly）
- 联系邮箱：legal@uvera.ai

**律师 review checklist** 写在每份文档顶部（`[REVIEW NEEDED]` 标记）。涉及：
- Delaware 注册状态确认 / 物理地址 / DMCA agent designation
- 强制仲裁 + class waiver 在美国与 EU 的执行边界
- SCC / DPF 数据跨境传输机制
- 第三方处理者 DPA 是否齐备
- 部分 EU 成员国的儿童同意年龄差异（13/14/15 vs 我们的 16）

**未完成项**（律师终审前不上线生产 UI）：
- 法律实体真实地址
- DMCA 指定代理（向美国版权局登记）
- EU representative 任命（如 EU 用户量触发 GDPR Art. 27）

**输出物原始要求**（保留作历史记录）：
- 用户发布作品时的默认权利归属 ✓ Content License §1-2
- Branch / Recast 勾选时让渡的权利边界 ✓ Content License §5-6
- 平台使用用户内容（展示 / 推荐 / 训练）的范围 ✓ Content License §2 + §4
- 官方公共 Avatar 的 model release / IP agreement 模板 ⏳ 需另外起草（不属本期）
- CC-BY-SA 或自定义条款的选择 → 选择自定义（更贴合 Branch / Recast 的精细授权结构）

---

## 6. 用户数据收集 & 隐私

**状态**: 🟡 待系统性整理

待整理项：
- 用户注册收集字段（email / OAuth / profile）的用途说明
- Avatar 训练素材的收集 / 存储 / 删除流程
- Cookie 使用声明
- 第三方 SDK（Cloudflare / Supabase / AI 推理服务）的数据流向
- GDPR / CCPA / 中国个人信息保护法的合规对齐

---

## Appendix A — 变更日志

| Date | Author | Change |
|---|---|---|
| 2026-04-25 | Leon + Claude | 初稿：§1 Avatar 形象权 / §2 Branch / §3 Recast / §4 训练边界落位 |
| 2026-04-25 | Leon + Claude | §2/§3 DB schema 落地（4 列 + 2 partial index）via Supabase Management API；publishHandler 接线；normalizer 透传新字段 |

---

## Appendix B — 相关 Memory 文件（Claude 私有上下文）

以下 memory 文件与本文档内容同步，用于 Claude 工作引导：

- `project_avatar_rights.md` — §1 对应
- `project_terminology_branch_continue.md` — §2 / §3 术语与触发时机
- `project_terminology_chujing.md` — §3 Recast 术语定稿
- `feedback_compliance_documentation.md` — 本文档的维护规则
- `feedback_language_policy.md` — 本文档与 UI 文案语言约束

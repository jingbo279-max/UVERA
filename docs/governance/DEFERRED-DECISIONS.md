---
title: 延期决策记录（Deferred Decisions Log）
type: doc
status: active
owner: Claude
created: 2026-04-21
updated: 2026-05-30
tags: [governance, deferred, todo]
---

# 延期决策记录（Deferred Decisions Log）

> 每一条都是**当前不做、但将来可能做**的设计决策。  
> 包含触发条件、所在文件、恢复成本，避免后续遗忘或重复讨论。  
>
> **查看方式**：Leon 询问「TODO」「待办」「有啥没做」「延期决策」等任一时，Claude 列出此文件条目 + 触发条件状态。  
> 不主动 session 开头扫描（避免噪音）。

---

## D-001 · 卡片 #tag 徽章变可点击

**记录日期**：2026-04-21  
**当前状态**：徽章纯展示，`rounded` (4px) 矩形，display-only  
**触发条件**（同时满足 3 条）：
- [ ] 内容量 > **50 条**（filter 后结果有意义）
- [ ] IA 里存在「标签聚合页」或「过滤态 feed」（如 `/tag/:tag`）或搜索复用可用
- [ ] 运营明确要求 tag-driven discovery（而非算法推荐主导）

**触发后的动作**（按 "Shape = Function" 规则）：
1. `src/components/MasonryGrid.jsx` 徽章 `rounded` → `rounded-full`（capsule）
2. 加 hover 态 + tap 态视觉反馈
3. 徽章热区扩至 ≥44×44pt（Apple HIG 点按最小值）
4. 整卡 tap 路径保持，tag 区域 `stopPropagation`
5. 实现点击行为（3 档可选）：
   - **A. 轻量**：复用顶部 search，点击 → 自动填入 tag 值 + 触发搜索（~30 行）
   - **B. 中等**：bottom sheet 弹出同 tag 的 6 条卡片（~100 行 + 新组件）
   - **C. 完整**：建 `/tag/:tag` 页面（~200 行 + 新路由 + SEO）

**相关讨论原文**：2026-04-21 recommended_content v2 milestone 收尾  
**相关规则**：`docs/DESIGN-SHAPE-RULES.md`（Shape = Function）

---

## D-002 · Hero 紧凑备选 AR（21:9）

**记录日期**：2026-04-21  
**当前状态**：Hero AR 固定 16:9，不给运营挑选  
**触发条件**（任一满足）：
- [ ] 运营反馈 "hero 占屏过大 / 压掉首屏瀑布流入口" ≥ 2 次
- [ ] 产品需要同时展示 ≥ 2 张 hero（hero 轮播或 hero stack）
- [ ] 甲方明确要求"更电影级"的紧凑横幅形态

**触发后的动作**：
1. 前端 `AR_OPTIONS` 枚举加 `21:9`
2. `src/pages/admin/AdminDashboard.jsx` 的 hero-slot AR 下拉从锁定 → 允许 `16:9 / 21:9` 二选一
3. 不需要 DB schema 变动（`aspect_ratio` 是 text 列，无约束）
4. 预计 ~30min 工时

**相关讨论**：2026-04-21 Hero → Pinned Card 决策链  
**相关文档**：`docs/archive/2026-04-21-hero-as-pinned-card.md`

---

## D-003 · `/test/hero-ar` 视觉实测页删除

**记录日期**：2026-04-21  
**当前状态**：保留，route `/test/hero-ar` 可访问  
**保留原因**：Leon 需要与甲方沟通解释 Hero 设计决策时演示对比效果（Current vs 16:9 vs 4:3 vs 21:9）

**触发条件**（任一满足）：
- [ ] 甲方沟通演示全部完成 + Leon 确认不再需要演示
- [ ] Hero 上线 6 周后（运营与甲方都已熟悉新 Hero）

**触发后的动作**：
1. `src/main.jsx` 移除 `/test/hero-ar` route + import
2. 删除 `src/pages/HeroARTest.jsx`
3. 预计 ~10min 工时

**相关文档**：`docs/archive/2026-04-21-hero-as-pinned-card.md`

---

## D-004 · Hero eyebrow 列（`eyebrow text`）

**记录日期**：2026-04-21  
**当前状态**：Hero Phase 1 仅 title + CTA，无 eyebrow。Ask 文档已发费等待答复。  
**触发条件**：
- [ ] 费批准 `recommended_content.eyebrow text` 列的 ALTER TABLE

**触发后的动作**：
1. 执行 `ALTER TABLE recommended_content ADD COLUMN IF NOT EXISTS eyebrow text`
2. `src/pages/admin/AdminDashboard.jsx` 加 Eyebrow text input（hero-slot 专属，`pin_order !== 1` 时隐藏）
3. `src/utils/normalizeRecommended.js` 透传 eyebrow 字段
4. `src/components/MasonryGrid.jsx` HeroCard 渲染 eyebrow（uppercase 小号 letter-spaced）
5. 预计 ~1h 工时

**相关文档**：
- Ask：`docs/collaboration/asks/2026-04-21-eyebrow-column.md`
- Plan：`docs/archive/2026-04-21-hero-as-pinned-card.md`

---

## D-005 · `recommended_content.type` DB trigger 派生（替代前端派生）

**记录日期**：2026-04-21
**当前状态**：`type` 列由前端 `deriveLegacyType(media_kind, tags[0])` 在 INSERT/UPDATE 时派生并写入（C' 变体已落地）。
**触发条件**（任一满足）：
- [ ] 前端派生出现数据一致性问题（DB 行里 `type` 与 `media_kind + tags` 派生结果不符，例：seed 脚本绕过前端、或外部写入）
- [ ] 新增后端消费方需要 `type` 稳定派生（如推荐算法、分析脚本）
- [ ] 费有空并明确倾向 DDL 方案

**触发后的动作**：
1. Supabase Dashboard SQL Editor 跑：
   ```sql
   CREATE OR REPLACE FUNCTION derive_recommended_content_type()
   RETURNS TRIGGER AS $$
   BEGIN
     IF NEW.media_kind = 'Live'  THEN NEW.type := 'LIVE';
     ELSIF NEW.media_kind = 'Image' THEN NEW.type := 'IMAGE';
     ELSE
       NEW.type := CASE COALESCE(NEW.tags[1], '')
         WHEN '#MV'         THEN 'MUSIC'
         WHEN '#Trailer'    THEN 'FILM'
         WHEN '#Vlog'       THEN 'STORY'
         WHEN '#ShortDrama' THEN 'STORY'
         ELSE 'VIDEO'
       END;
     END IF;
     RETURN NEW;
   END; $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_recommended_content_derive_type
     BEFORE INSERT OR UPDATE OF media_kind, tags ON recommended_content
     FOR EACH ROW EXECUTE FUNCTION derive_recommended_content_type();
   ```
2. 删除 `src/utils/normalizeRecommended.js` 的 `deriveLegacyType` export
3. `src/api/adminService.js` 移除 `addRecommendedContent` / `updateRecommendedContent` 的派生分支
4. 预计 ~20min 工时（含 trigger 验证）

**相关文档**：
- Ask：`docs/archive/asks/2026-04-21-legacy-type-column.md`
- C 方案原版 trigger SQL 见上 ↑

---

## D-006 · Upgrade Promo 卡接入 admin 后台管理

**记录日期**：2026-04-21
**当前状态**：`UpgradePromoCard`（`src/components/MasonryGrid.jsx` L148-272）hardcoded — title/subtitle/CTA 文案、视觉、出现条件（`isSmallScreen && activeSection === 'explore'`）、点击目标（`setActiveSection('subscription')`）全部写死。mobile explore 首页 `gridItems[0]` 置顶生效。
**触发条件**（任一满足）：
- [ ] 运营要求 A/B 测试不同 Upgrade 文案
- [ ] 需要按订阅层级（Free/Plus/Pro）条件化展示 Promo
- [ ] 需要 Promo 定时上下线（例如活动期）
- [ ] D-004 feed 字段全部稳定 ≥ 2 周无回归，且运营确认希望直接建 promo 卡

**推荐路径（路径 A — 零 schema 变动）**：
1. admin 后台新建一条 `recommended_content` 记录：
   - `tags = ['#upgrade-promo']`（业务标记）
   - `cta_label = 'Upgrade'` / `cta_url = '/subscription'` / `cta_target = '_self'`
   - `pinned = true` / `pin_order = 0`
   - `title = 'Upgrade Plan'` / `artist` 留空或存 subtitle
   - `media_kind = 'Image'`（兜底，因 Promo 无 enum 值，避免加新 enum）
2. 前端 `MasonryGrid.jsx` 渲染循环加识别分支：
   ```js
   if (item.tags?.includes('#upgrade-promo')) {
     return <UpgradePromoCard ... title={item.title} subtitle={item.artist} cta={item.ctaLabel} onUpgrade={() => navigate(item.ctaUrl)} />
   }
   ```
3. `UpgradePromoCard` props 从 `onUpgrade/isSmallScreen` 扩展到 `title/subtitle/ctaLabel/ctaUrl`，视觉保持不变
4. 移除 `index.jsx` 中 `showUpgradePromo` prop 和 `gridItems[0]` 硬编码注入逻辑
5. 预计 ~2h 工时（含 admin 建卡验证 + mobile 回归）

**拒绝路径 B**（独立 `promo_cards` 表）原因：改动后端 schema + 新 RLS + 新 CRUD 面板，跨越边界，本期不值得。

**相关讨论**：2026-04-21 "目前能用挂起来" 共识
**相关文件**：`src/components/MasonryGrid.jsx` L148 / `index.jsx` L894

---

## D-007 · StudioPage Icon Gallery 色彩搭配

**记录日期**：2026-04-23
**当前状态**：NAV_ICONS 已刷新为当前 app 生产导航（explore / library / create / spark / profile / studio），但 `fillColor` / `glowCls` / `indicatorColor` 仍沿用旧 4 频道遗留色（amber / rose / violet / red / slate）

**触发条件**（任一满足）：
- [ ] Design system 定义了语义化频道色 token（e.g. `--color-nav-explore / library / create`），Studio 应消费 token 而非硬编码 hex
- [ ] 品牌梳理后确定 `spark` / `library` 等的统一强调色（当前 BottomTabBar 用 indigo-600 `rgb(99,102,241)` 作单一 active 色，与 Studio demo 不一致）
- [ ] 运营/设计反馈 Icon Animation Gallery 的色彩不再反映真实 app 视觉

**触发后的动作**：
1. 在 `src/design-system/tokens/index.css` 增 nav-per-item color tokens（或者统一 accent token）
2. `src/pages/StudioPage.jsx:10-18` `NAV_ICONS` 数组 `fillColor` / `indicatorColor` 改读 CSS var
3. `fx-glow-amber / rose / violet / red` CSS 类（定义在同文件 L147-157）同步改读 token 或改名为语义化（e.g. `fx-glow-library`）
4. 预计 ~30-45min（要视 token 命名决策是否完成）

**相关讨论**：2026-04-23 path C full collapse 收尾 · 用户提示"色彩搭配挂进 TODO，后续调整"
**相关文件**：`src/pages/StudioPage.jsx`（图标 + glow CSS）

---

## D-008 · Publish to YouTube / TikTok / Bilibili（视频分发）

**记录日期**：2026-05-06
**当前状态**：Spark Share 按钮（commit `227a745`）走 `navigator.share` +
clipboard fallback，仅"分享链接"，**没有**"发布到外部视频平台"功能。
讨论由 Leon 提出"作为 AI 视频平台 YouTube 是否要放" 引发；澄清：YouTube /
TikTok / Bilibili 不是 share target（无 web intent URL），只能作为
**Publish destination**（用户授权后从 Uvera 上传作品到外部平台）。

**触发条件**（任一满足）：
- [ ] 用户调研显示"想把 Uvera 生成视频转发到 YouTube / TikTok / Bilibili"
      是高频诉求
- [ ] 平台进入流量增长期，distribution 成为 KPI（用户主动外部分发增加平台
      品牌曝光）
- [ ] 现有 Library / Studio 完整后，需要"完整作品工作流"闭环（生成 →
      预览 → 发布到外部）
- [ ] 商业化阶段，distribution funnel 是 retention / conversion 关键

**触发后的动作**（按 publish target 排优先级）：

| 平台 | API 状态 | OAuth | 工作量 |
|---|---|---|---|
| YouTube | ✅ Data API v3（quota 申请） | Google OAuth 2.0 | 中（~2-3 天） |
| TikTok | ⚠️ Content Posting API（需企业开发者） | TikTok Developer Portal | 大（~1 周，需审核） |
| Bilibili | ⚠️ 个人开发者门槛 | Bilibili Open Platform | 大（合规 + 审核） |
| Vimeo | ✅ API v3.4 | Vimeo OAuth | 中 |

**前置工作**：
1. **Google Cloud Console** 申请 YouTube Data API v3 quota（默认 10K
   units/day，上传 ~6 次/天，需提交 quota increase 申请到 1M unit/day）
2. **OAuth client** 配置（client_id / client_secret 存 `wrangler.jsonc`
   secrets）
3. **DB schema**：`user_oauth_tokens` 表存用户 access_token + refresh_token
   per platform（高危 — 触发 MEMORY.md 高危规则，必须费 align）
4. **后端 endpoint**：上传 endpoint 需要 stream video file 到 platform
   API（受限于 CF Workers timeout，可能需 Workers Durable Object 或
   外部 worker job queue）
5. **前端 UI**：Library / Studio 加 "Publish to ..." 按钮 + 平台 picker +
   metadata 编辑（标题/描述/tags，每个平台格式略不同）+ 进度反馈

**风险点**：
- 各平台**频繁改 API + 政策**（特别是 TikTok / Bilibili），维护成本持续
- 上传配额限制（YouTube 默认每天 6 次，超出需申请；TikTok 限制更严）
- **内容审核**：发布到外部 = 平台合规由我们承担一部分（用户名义但走我们
  系统）— 法律 / 内容审核策略需 align
- **Token 安全**：长期存外部平台 access_token 需妥善加密存储（高危区）

**位置（功能存放位置 vs Share button）**：
- Share button（当前）→ "分享链接给朋友看"（read-side）
- "Publish to ..."（未来）→ "把作品发到外部平台让全网看到"（write-side）
- 两者**不应混淆** — Publish 应在 Library / Studio 的作品详情页，独立按钮

**相关讨论原文**：2026-05-06 Leon 询问 Share menu 是否含 YouTube
**相关规则**：MEMORY.md "⚠️ 高危变更提醒规则"（OAuth tokens / 外部 API
contract / 上传流程）

---

## D-009 · 法律主体名称从 longVV Ltd 批量替换为甲方提供的正式名称

**记录日期**：2026-05-08
**当前状态**：所有用户面向 + 内部文档仍写 `longVV Ltd`（约 35 处），其中
- `docs/legal/TERMS-OF-SERVICE.md:10` 自带 `[REVIEW NEEDED — Delaware]` 标注，说明法律主体本身就还没最终确认
- 用户实际能看到的位置：Footer / LegalPage 渲染的 3 个 markdown
**触发条件**（任一满足即可执行）：
- [ ] 甲方提供正式公司名 + 注册州（如 "Uvera Inc, Delaware"）
- [ ] 律师确认主体名称定稿

**触发后的动作**（一次 sed 批量替换）：

1. **用户面向（LegalPage 渲染，3 文件，~23 处）**：
   - `public/legal/terms.md` — 12 处 `longVV Ltd` / `longVV LTD` / `longVV` 单独
   - `public/legal/privacy.md` — 3 处
   - `public/legal/content-license.md` — 8 处

2. **Footer（全站可见）**：
   - `src/components/Footer.jsx:13` — `© {year} longVV Ltd`

3. **内部文档源稿（团队参考用，~10 处）**：
   - `docs/legal/TERMS-OF-SERVICE.md` — 同 public 镜像
   - `docs/legal/PRIVACY.md` — 同 public 镜像
   - `docs/legal/CONTENT-LICENSE.md` — 同 public 镜像
   - `docs/legal/COMPLIANCE.md:220` — `主体：longVV Ltd（美国，默认 Delaware...）`
   - `docs/product/GA-DELIVERABLES.md:362` — `主体：美国 longVV ltd`
   - `docs/product/PRODUCT-NARRATIVE.md:14, 475` — 项目叙述里 2 处

4. **变更记录**：
   - `changes.md:156` — 历史记录里 1 处（也可保留作历史档案）

5. **同步更新 [REVIEW NEEDED] 标注**：
   - `docs/legal/TERMS-OF-SERVICE.md:10` `public/legal/terms.md:10` 删除 `[REVIEW NEEDED — Delaware]` 标注
   - `docs/{TERMS,PRIVACY,CONTENT-LICENSE}.md` 顶部 metadata 改 v0.1 draft → v1.0

**保留不动**（基础设施 / 后端 API 真实名，与公司主体无关）：
- `vite.config.js` `/neodomain-api` proxy
- `public/_worker.js` `dev.neodomain.cn` / `ga.neodomain.cn` / `story.neodomain.cn`
- `src/api/neoaiService.js` 注释 + log + error msg
- `src/api/adminService.js:290` admin 历史 seed filter

**估算成本**：单次 grep + sed 批量替换 + 1 次 build verify + 1 次 commit + 1 次 push，~10 分钟

**相关讨论原文**：2026-05-08 Leon 在 Profile session 看 LegalPage 时发现 `Longvv ltd` 文本，提议替换为 UVERA.ai。Claude 警告"域名不是法律实体不能签合同"，Leon 决定保留待甲方提供正式名称
**相关规则**：MEMORY.md "品牌更名记录"（longvv → Uvera 2026-04-18，公司主体未跟随）

---

## D-010 · LibraryPage work-detail 视频末帧加轻 dim/blur 视觉提示

**记录日期**：2026-05-16
**当前状态**：视频结束 → end-overlay (Replay + Continue this story) 直接渲染在末帧上，**无任何 dim 或 blur**。chrome (back/badge/control bar) 在 z-10 与 Replay/Continue (z-20) 共存清晰。

**当前选择不加的理由**：
- chrome 自带深色 glass，readability 已经足够
- Replay 圆 (black/52 + blur8) + Continue pill (white/20 + blur12) 自带 glass 视觉对比，不需要额外 dim 衬托
- 视觉极简「自然就可以解决」哲学（Leon 5/16 决策原话）

**触发条件**（任一满足即可重启讨论）：
- [ ] 甲方/用户测试反馈「视频结束没注意到，以为只是暂停」(state 不够明显)
- [ ] 出现视频末帧是 near-white 过曝帧的实际案例,Continue this story (white/20 pill) 在亮帧上对比度不足读不清
- [ ] 用户调研显示「期待 YouTube/Netflix 式 end-screen dim」是高频抱怨

**触发后的动作**：
1. 加 `<div className="absolute inset-0 bg-black/6 pointer-events-none" />` 进 end-overlay 容器(在 Replay/Continue button 之前)
2. 数值起点 `bg-black/6` (6% black,无 blur),无明显 visual cost,但足够区分 mode shift
3. 实测 (zoom + Leon 主观判断) 决定是否升 `/8` 或 `/10`
4. **不要再回到 15% 以上** — 那个数值会把 chrome 重新洗掉(5/15/16 三轮调试得出的教训)

**估算成本**：5 分钟,2 行 JSX

**相关讨论原文**：2026-05-16 work-detail end-overlay UX 收尾,Leon 决定「不加但记入待观察」
**相关 commit**：`346d9eb`(删 dim 的实现)

---

## D-012 — Checkbox light mode Hover Gaze Glow 视觉稍弱

**当前状态**:light mode 下 Hover Unchecked Gaze Glow(opacity 0.15 + plus-lighter blend)在白色 panel backdrop 上视觉显弱。Dark mode 完美。Leon 2026-05-19 round-45 接受现状,未来微调。

**所在文件**:`src/design-system/primitives/Checkbox.jsx` Gaze Glow span(`{!checked && (<span ...>)}`)

**重启条件**:
- [ ] light mode 实际 use(Settings / Auth)实测视觉明显不足
- [ ] Figma 上有 light-mode-specific Gaze Glow spec(node 暴露)

**触发后的动作**:
1. light mode opacity 提到 0.25–0.30(dark mode 维持 0.15)
2. 或 swap mix-blend-mode 在 light mode → `multiply` 让 glow 反而暗化
3. 通过 CSS `.dark .checkbox-glow / :not(.dark) .checkbox-glow` 切换

**估算成本**:10 分钟(加 1 个 CSS class + 改 Checkbox.jsx)

**相关讨论**:2026-05-19 round-45,Leon 验收 4 状态后反馈

---

## D-013 — Actor 创建挪 Library / Character 取消(IA 重组)

**决策(已定 — Leon 2026-05-22 round-72):**
- **Actor 创建从 Create 频道挪到 Library 频道** — Actor 本质是 asset/素材,跟 photos/videos library 同语义,归属 Library;Create 频道纯化为创作流程(选 Actor + 创作 story/video)
- **Character 概念取消** — derived character(`createdVia='generated_concept'`)废弃,只保留 base Actor(`createdVia='upload'`)

**当前矛盾点(本决策动机)**:
- `LibraryPage.jsx:832` Actor empty state CTA "Go to Create" — 用户要建 Actor 被推去 Create,绕一圈
- `LibraryPage.jsx:897` 限额下的 "New Actor" 卡也 `navigate('/create/short')`
- `StoryGeneratorPage.jsx:4054` Create 内 "Open camera to create Actor" — Create 既做创作又做 asset 创建,职能混淆

**Phase 分工(2026-05-22 Leon × 费 同步):**
- **Phase B(费 / 后端先行):** DB schema 改动(`source_character_id` 字段废弃)+ API contract 调整(Actor 创建/查询端点 caller / filter 改 actor-only)
- **Phase A(Claude / 前端配合,等 Phase B 完成):** UI 重构,清 deprecated 字段引用

**重启条件**:
- [ ] 费完成 Phase B 后端改动(schema migration + API contract)
- [ ] 费通知 frontend 可以开始 Phase A

**Phase A frontend 待办(等触发):**
1. **`LibraryPage.jsx`**
   - "+ New Actor" 卡:`navigate('/create/short')` → inline 创建(modal / drawer / sub-page)
   - 删 Character grid section(line 744 附近)+ `handleDeleteCharacter`
   - empty state CTA "Go to Create" → 改为 inline create button
2. **`StoryGeneratorPage.jsx`**
   - 删 "Open camera to create Actor" empty state(line 4054 附近)
   - Actor empty 时 CTA 改为 "Go to Library to create your first Actor"
   - 删 `canCreateCharacter` import + 调用(line 13, 1106)
   - 清 `source_character_id` 引用(line 1103, 1223 等)
3. **`data/plans.js`**
   - 删 `canCreateCharacter` export
4. **FTUE / onboarding flow**
   - 新用户引导路径:landing → Library(建 Actor) → Create(创作)
   - 替换原 landing → Create(同时建 Actor + 创作)

**估算成本**:Phase A frontend 约 3-5h(取决于 inline create UI 复杂度,modal vs sub-page)。Phase B 后端由费估。

**相关讨论**:2026-05-22 round-72,Leon × 费 IA 决策对齐

---

## D-014 — Tooltip animation 在 Safari 上 z-index / paint order race

**当前状态**(Leon 2026-05-27 round-78 反馈):`<Tooltip>` primitive (`src/design-system/primitives/Tooltip.jsx`) 用 React Portal 渲染到 `document.body` + `position:fixed + z-index:9999`,Chrome / Firefox 正常,**Safari** 上首次 hover 显示动画 (`tooltip-emerge` keyframe:opacity+translateY+scale,180ms cubic-bezier) 开始时 tooltip 先被其下方页面内容**短暂覆盖**,然后才完整 paint 到顶层。视觉是 "tooltip 闪一下被挡 → 完整露出"。

**所在文件**:`src/design-system/primitives/Tooltip.jsx`

**Leon 评价**:接受现状作 R78 v4 commit 范围,Safari 用户少且不影响功能(tooltip 仍可读),后续单独修。

**可能根因 hypotheses(待验)**:
1. Safari 18 上 `position:fixed + animation` 元素在 animation 开始的 first frame 临时降到 lower compositing layer(`will-change` 缺失导致 compositor 没提前 promote layer)
2. `backdrop-filter: blur(20px)` 跟 `clip-path: path()` + `filter: drop-shadow` 三者组合在 Safari 上有 paint order race condition(Safari 18 known bugs around backdrop-filter + animations)
3. React Portal 渲染时机晚于 ancestor scroll 引起的 paint,Safari 处理 portal mount 不同
4. `transform: translateY(2px) scale(0.92)` initial 状态让 Safari 把 element 跟 mid-layer composite(Chrome 处理 zIndex priority 更严)

**重启条件**:
- [ ] Safari 用户量增加 / 反馈 tooltip 视觉劣化
- [ ] Safari 26 更新修复 backdrop-filter + animation 问题(等 Apple)
- [ ] 我们要 wire Tooltip 到更多 chip / icon button(visual flicker 频次上升 user-perceived)

**触发后的动作**(候选 fix):
1. 加 `willChange: 'transform, opacity'` on tooltip fixed wrapper,提前 promote 到 compositor layer
2. 拆 `filter: drop-shadow` 跟 `clip-path` — 改用 SVG `<filter>` `<feDropShadow>` inline (避免 CSS filter + clip-path 在 Safari 互动)
3. animation initial 状态用 `transform: translateZ(0)` 强制 GPU layer,避免 mid-frame composite
4. Safari-specific:使用 `@supports (-webkit-backdrop-filter)` block 给 Safari 单独 path(减 backdrop-filter blur radius 或换 simple bg-color)
5. 改用第三方库(Floating UI / Radix Popover)— 已 production-grade Safari 兼容

**估算成本**:1-2h 实验 + verify(诊断 + 试 1-3 个 fix candidates)

**相关讨论**:2026-05-27 round-78,Leon 视觉验收 + 反馈

---

## D-015 — Ratio dropdown 视觉跟 macOS Sequoia 720P 参考截图仍不一致

**当前状态**(Leon 2026-05-27 round-79 反馈):Free mode Settings row Ratio chip 自实现 dropdown menu(`StoryGeneratorPage.jsx` line ~5253 portal block)— v5 多轮调整后(`p-2`,`min-w-180`,`max-w-220`,`rounded-xl`,selected pill `bg-accent text-white` + Check icon absolute left,unselected hover `bg-white/10`,viewport-clamp left)仍跟 macOS Sequoia 720P 参考截图视觉**明显不一致**。Leon 接受当前作 R77/R78 commit 范围,**等 Free mode 整体布局调整完成再回头调 dropdown 细节**。

**所在文件**:`src/pages/StoryGeneratorPage.jsx` (line ~5253 ratio dropdown portal block)

**Leon 评价**:整体布局优先,dropdown 视觉是细节,布局定型后再 nail 细节。

**已尝试 v1-v5 fix(都未完全 match)**:
1. v1:bg-accent/15 text-accent highlight + 左对齐 → 跟 macOS 习惯不同
2. v2:macOS native style:Check absolute left + text-center + 无 bg highlight → Leon 反馈"没 highlight 不是 selected 状态"
3. v3:selected pill `bg-accent text-white` + Check + items mx-1 → pill inset 不明显
4. v4:p-1.5 + min-w-150 max-w-200 → pill 右边贴 menu container border
5. v5(current):p-2 + min-w-180 max-w-220 + rounded-xl → 仍不一致

**疑似 root cause(待调查)**:
- macOS Sequoia menu 实际 inner padding 跟 inner items spacing 比例特殊,需要 element inspector 实测系统 menu 算具体 px
- Items 之间 vertical gap 可能要(currently 0 stack)
- menu container shadow / border 跟 macOS native NSPopover 风格不同
- Items text font weight / line-height 跟 macOS native 不一致
- Items 高度跟 macOS 24pt 标准不一致

**重启条件**:
- [ ] Free mode 整体布局(R77-a-4 / R77-b / R77-c)完成定型
- [ ] Leon 拿 macOS native menu 截图 + 标 spec(padding / gap / corner / shadow 具体数值)
- [ ] 或者直接 import macOS native style library(如 Floating UI + Apple-style theme)替我们手 nail

**触发后的动作**:
1. 用 Chrome DevTools / Safari inspector 测 macOS native NSPopover menu 各项 spec
2. 在 verify-blend.html 做 isolated comparison(参考截图 + 我们 dropdown 并排)
3. iter 到 100% match
4. 抽 `<DropdownMenu>` primitive(跟 `<Tooltip>` `<TextField>` 同等级 design system primitive)统一所有 menu 用法

**估算成本**:2-4h spec audit + iter + abstract to primitive

**相关讨论**:2026-05-27 round-79,Leon 提"完全相同元素视觉风格统一"

---

## D-016 — Free mode draft 自动 save server stale(localStorage vs server 3s debounce window)

**当前状态**(Leon 2026-05-27 round-79 确认):Free mode user 删 asset(点卡片右上角 X)/ 改 prompt / 改 settings 后立即 reload,被删的 asset 仍重新出现。

**Root cause**(2026-05-27 audit StoryGeneratorPage.jsx):
- localStorage 立即 update(`line 1304`)— 任何 state mutation 立刻 local 落地
- Server upsert **debounced 3s**(`line 1316`)— user 没等 3s 就 reload 时,server `story_drafts` row 仍是旧 draft 含已删 asset
- Load 时 **server draft 优先**(`line 1022` "server wins when both exist")→ 恢复 server 旧 draft → 删除的 asset 重现

**Leon 决策**:fix 方案 B(load 时比较 server.updated_at vs local.timestamp,取较新),跟 D-013/D-014/D-015 一组 deferred,等 Free mode 整体布局调整完成后批量做。

**所在文件**:`src/pages/StoryGeneratorPage.jsx` line ~1020-1067 (draft load logic) + line ~1259-1326 (draft save logic)

**Fix 实施细节(等触发后)**:
1. localStorage save 写 `draft.timestamp` 已有(`line 1263`)
2. server fetch 拿 `row.updated_at`(ISO timestamp)+ `row.data` jsonb
3. load 比较:
   ```js
   const serverTs = matchingRow ? new Date(matchingRow.updated_at).getTime() : 0;
   const localTs = localDraft?.timestamp ?? 0;
   draft = (localTs > serverTs) ? localDraft : matchingRow.data;
   ```
4. verify:删 asset → reload → 应恢复 local (不含已删 asset)
5. 同时:确认 server-side `story_drafts` table 已 deployed (D-013 Phase B 跟费同步 migration apply)

**重启条件**:
- [ ] R77-a-4 / R77-b / R77-c 整体 layout 调整完成
- [ ] 同 batch 处理 D-013(Phase A frontend 重构)/ D-014(Tooltip Safari)/ D-015(Ratio dropdown 视觉一致)

**估算成本**:30min(load logic timestamp 比较 + verify)

**相关讨论**:2026-05-27 round-79,Leon 反馈"删除 asset 刷新仍出现"

---

## D-017 — Mobile resolution picker (PlayerActionBar mini variant)

**状态**:Deferred(等 mobile drama 用户实际反馈 / 整体 mobile player UX 第二轮迭代)

**触发条件**:
- 任一条满足即可启动重启:
  - 甲方 / 用户反馈 mobile 上选不了视频清晰度(尤其 SeriesDetail 长剧场景)
  - Mobile drama 用户流失数据(分辨率切换是手机用户保流量的关键)
  - 整体 mobile player UX 第二轮迭代(全 mobile UI 系统盘点时一并)

**背景**:Leon round-81 phase 1 删了 fei popover UI(bottom-12 right-2 pill + 弹层菜单),resolution picker 视觉统一到 PlayerActionBar 内 Speed 左侧 dropdown。但 PlayerActionBar 当前只在 desktop(`pointer:fine` media query)渲染,mobile 走 `<video controls>` 走 native HTML5 controls。

**Mobile 上的现状**:
- iOS Safari native HLS 解码,但**不暴露 levels 也不让 JS 切 level**(浏览器限制)
- Android Chrome 用 hls.js,理论上能切但当前没有 UI
- 删 fei popover 后,mobile 用户完全没有 resolution picker(D-017 之前 fei popover 给 Android Chrome 用户提供过)

**Trade-off**:
- 短期接受 regression(admin / SeriesDetail mobile 失 picker),换设计统一性
- Desktop 用户 (绝大多数 admin + dramaq 桌面阅读用户) 已得 PlayerActionBar 完整体验

**Fix Plan (启动时)**:

**Option A:PlayerActionBar mobile mini variant**(推荐)
- 当 `pointer:coarse` 时不再 return null,改 render 简化版:仅 resolution chip(右上角小 pill,点开 dropdown 同 desktop)
- 不渲染 Volume / Speed / Autoplay / Fullscreen(让 native controls 处理)
- 优势:统一一个 component,视觉/逻辑一致

**Option B:复活 fei popover 仅 mobile**
- mobile 还原 fei 原 pill,desktop 走 PlayerActionBar
- 双 component 维护,视觉不统一

**Option C:不做**
- Mobile 用户接受不能选清晰度
- 后端通过 ABR 自动选(对 4G/5G 切换够用,但 wifi 慢 / 流量节省场景不友好)

**估算成本**:Option A 约 60min(mini variant 渲染 + 触屏 dropdown 触发 logic)

**相关讨论**:2026-05-27 round-81 phase 2,Leon: "费做的 showQualitySelector 取其值,样式位置按照我的来"

---

## D-018 — 视频进度条 buffered 中间灰平滑过渡

**记录日期**:2026-05-29
**当前状态**:[src/design-system/primitives/PlayerActionBar.jsx](../../src/design-system/primitives/PlayerActionBar.jsx) line 472 用 inline 3-stop gradient(`played 0.85 / buffered 0.42 / empty 0.20`)反映 buffer 增长。buffer 本质离散(HLS segment ~4s 一段、mp4 byte-range chunk ~1-2s 一跳),UI 上每次 `progress` event 直接跳到新 stop 位置。

**触发条件**(任一满足):
- [ ] 甲方反馈进度条 buffered 中间档"一跳一跳不舒服"
- [ ] 用户测试中 ≥ 2 次提到 buffered indicator 跳变
- [ ] 大屏视频(≥ 1080p)上离散感更明显,产品决定 polish

**为什么不做(当前判断)**:
- CSS `background` gradient **不能 transition**(浏览器无法插值 gradient color stops)
- 要平滑只能重构成 absolute overlay 3 层叠放(static empty track + width-transition buffered overlay + static played fill + transparent input on top)
- ~15 行 JSX + 几行 CSS,但 layout 复杂度上升
- 多数视频上离散跳并不明显(HLS 4s segment + 60Hz UI,跳一次后 4s 才再跳)

**触发后的动作**:
1. [PlayerActionBar.jsx](../../src/design-system/primitives/PlayerActionBar.jsx) Seek slider 行(line 519+)重构:
   ```jsx
   <div className="relative flex-1 h-1">
     <div className="absolute inset-0 rounded-full bg-white/20" />
     <div className="absolute inset-y-0 left-0 rounded-full bg-white/42 transition-[width] duration-300 ease-out"
          style={{ width: `${bufferedPct}%` }} />
     <div className="absolute inset-y-0 left-0 rounded-full bg-white/85"
          style={{ width: `${seekPct}%` }} />
     <input type="range" className="absolute inset-0 opacity-0 cursor-pointer" ... />
   </div>
   ```
2. 把 thumb 单独显示需要 CSS 调整(input 透明后默认 thumb 看不见)— 用 absolute thumb dot 跟 seekPct width 同步,或保留 input visibility 只改 background
3. Volume slider 不动(无 buffered 概念,继续走 2-stop trackBg)

**估算成本**:30-45min(JSX 重构 + thumb 显示 + 跨浏览器验证 input opacity:0 仍能 click/drag)

**相关讨论**:2026-05-29 round-99(buffered 指示器加上后)→ Leon 反馈"分段离散是否能平滑变化",Leon 拍板"先不做,如果甲方和用户有强反馈再做"

**诊断脚本**(浏览器 console 跑,看 buffer 实际增长频率):
```js
const v = document.querySelector('video');
setInterval(() => console.log('buffered:', Array.from({length: v.buffered.length}, (_, i) => `${v.buffered.start(i).toFixed(1)}→${v.buffered.end(i).toFixed(1)}`), 'net:', v.networkState), 1000);
```

---

## D-019 — MV 专辑 / 播放列表 (mv-album contentType)

**记录日期**:2026-05-29
**当前状态**:VideoPlayer 播放逻辑只支持 short-feed / mv-single / series 三种 contentType。
mv-album(循环专辑 + 专辑内 ⏮⏭ 切换)在 [playback-transport-model](../decisions/2026-05-29-playback-transport-model.md) 矩阵里定义了,但**暂时 fall back 到 mv-single**。

**为什么不做**:DB 目前**没有"MV 专辑 / 播放列表"数据结构**。现有 `#Series:<id>` tag 只用于剧集分组,MV 无对应容器。`media_kind` 是 Video/Image/Live,MV = Video + `#MV` tag,也无专辑概念。

**触发条件**(任一):
- [ ] 产品确认要做"我喜欢的 MV"Playlist(saved + `#MV` 过滤的持久列表)
- [ ] 运营要策划"多段连播 session"(如"45min 晨间瑜伽 = 5 段有序")
- [ ] 用户反馈想把氛围 MV 串成连续播放列表

**触发后的动作**:
1. **DB**(⚠️ schema,fei):新增 playlist 容器表 or 复用 tag 模式(`#Playlist:<id>` + 顺序字段);"我喜欢的 MV" = saved items 视图
2. **contentType 推导**:`deriveContentType` 加 `item.inPlaylist` 判定 → 'mv-album'
3. **VideoPlayer**:mv-album 默认 Repeat ALL + 启用专辑内 ⏮⏭ + ∞ slot 换成 Queue 按钮(icon = Phosphor `Queue`,非 list-heart — 见 transport-model doc)
4. **Library**:"我喜欢的 MV" 过滤视图(saved + `#MV`)

**相关**:`docs/decisions/2026-05-29-playback-transport-model.md`("我喜欢的 MV / Queue 按钮"section)

---

## OPS-001 · 清理 Google Drive 迁移遗留(兼容软链接 + 旧 Claude 目录)

**记录日期**:2026-05-30
**当前状态**:项目 2026-05-30 从 Google Drive 迁出到 `/Users/sunjingbo/Developer/uvera`。迁移已完成的部分:
- launchd agent 已从 `com.longvv.devserver` **改名为 `com.uvera.devserver`**,`WorkingDirectory` 指向真实路径(不再依赖软链接),日志改 `/tmp/uvera-dev.*`。
- Claude memory(`~/.claude/projects/-...-uvera/memory/`)已从旧 GD 路径的 project 目录全量迁移并更新。

**保留观察、待清理的遗留**:
1. 兼容软链接 `/Users/sunjingbo/longvv` → `/Users/sunjingbo/Developer/uvera`(给可能残存的旧脚本 / 历史命令兜底)。
2. 旧 Claude project 目录 `~/.claude/projects/-Users-sunjingbo-Library-CloudStorage-GoogleDrive-leonsuen-gmail-com-My-Drive-longvv/`(含已迁移的 memory 副本 + 历史会话 transcript `.jsonl`)——作为迁移前备份暂留。

**触发条件**(同时满足):
- [ ] 到达 **2026-06-09**(保留 10 天观察期)
- [ ] 期间没有任何因路径迁移导致的问题(dev server / build / 脚本引用 `/longvv` 失败等)

**触发后的动作**:
1. `rm /Users/sunjingbo/longvv`(删软链接)
2. `rm -rf ~/.claude/projects/-Users-sunjingbo-Library-CloudStorage-GoogleDrive-leonsuen-gmail-com-My-Drive-longvv/`(删旧 Claude 备份目录)
3. grep 全仓 + `~/Library/LaunchAgents/` 确认无残留 `/Users/sunjingbo/longvv` / `com.longvv.devserver` 硬编码引用
4. 删除本条 OPS-001

**相关**:新 MEMORY.md「项目路径」section(迁出 + memory 迁移 + agent 改名记录)

---

## D-020 — 通知系统(@提及 / 回复 / 点赞 触发)

**记录日期**:2026-06-10
**当前状态**:评论功能已上线(发评论 / 一层回复 / 评论点赞 / 软硬删 / 折叠分页 / 结构化 @提及链接 / 长正文折叠)。但 **@ 了某人、回复了某人、赞了某人评论后,被动作的一方收不到任何通知**——体验是半残的(社交回路没闭环)。

**为什么不做**:项目目前**没有任何通知系统**(无 `notifications` 表、无站内信、无 unread badge、无推送/邮件)。这是独立的横切大件,不应捆进评论功能里;且评论的 @ / 回复只是通知的**触发源之一**,follow / 解锁 / 结算等也会想接,值得单独设计一次做对。

**触发条件**(任一):
- [ ] @提及 / 回复自动补全上线后,用户反馈"被回复/被@了却不知道"
- [ ] 产品要做站内 unread badge / 通知中心
- [ ] follow / 钱包 / 结算等其他场景也需要通知,凑够批量价值

**触发后的动作**(预估,需与费对齐 — ⚠️ DB + 后端):
1. **DB**(schema,fei):`notifications` 表(recipient_id / actor_id / type[comment_reply|comment_mention|comment_like|follow|...] / target_ref / read_at / created_at)+ RLS(仅 recipient 可读自己)+ 计数/未读 unread。
2. **写入触发**:评论 reply / @mention(`reply_to_author_id` + 未来 `comment_mentions`)/ comment_like 发生时插 notification(trigger 或 service/RPC 内写)。
3. **前端**:通知中心页 + Header unread badge + 实时(Supabase Realtime 或轮询)。
4. **(可选)** 邮件/Web Push 渠道。

**相关**:评论功能(`src/components/comments/`、`src/api/commentService.js`、`comments.reply_to_author_id`);@提及自动补全(本期接入,见 commit / `comment_mentions`)。

---

## 未来条目占位

<!-- 新的延期决策按 D-00X 格式加在下面 -->

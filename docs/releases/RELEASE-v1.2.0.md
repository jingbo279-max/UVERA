---
title: UVERA v1.2.0 交付清单
type: release
status: active
owner: Claude
created: 2026-05-25
updated: 2026-05-25
tags: [release]
---

# UVERA v1.2.0 交付清单

> **版本号**：1.2.0
> **发布日**：2026-05-25
> **基础版本**：v1.1.4
> **本版本主线**：短剧付费体系 (Phase 1-3) + 多分段叙事 + 角色设定图 + 错误体验全面升级
> **提交量**：196 commits since v1.1.4

---

## 0. TL;DR

这是 v1.x 系列最大的一次 minor 升级。三件主线:

1. **短剧付费体系全栈** — 6 张新表 + 13 个 worker endpoint + 用户钱包页 + 付费墙 modal + 5 个 admin tab (剧集收益 / 剧集管理 / 分成结算 / 付费流水 / 投流 ROI) + 创作者自助后台。从用户充值到月度分成对账全闭环。
2. **多分段叙事 + 角色设定图** — Quick Mode 支持 1-5 段分割渲染再用 ffmpeg.wasm 合并;Storyboard 旁额外生成 CHARACTER IDENTITY BOARD 作为角色一致性参考。
3. **错误体验全面 inline 化** — 12 处 alert() 替换成可重试的内嵌错误条 (`<InlineErrorBanner>`),不再阻断浏览器。

---

## 1. 短剧付费体系 (Phase 1-3)

### 1.1 Schema (5 张 migration)

| 表 | 用途 |
|---|---|
| `wallet_balance` | 每用户 U-Coins 余额 (1:1)。RLS: 自己可读,前端不可写,写入只走 worker service-role |
| `wallet_tx` | U-Coins 流水账 (purchase / first_charge / unlock_episode / bundle_purchase / refund / admin_grant / admin_revoke) |
| `episodes` | 单集独立表 (从 series.episodes JSONB 提升)。带 episode_no / video_url / stream_uid / is_free_override / ucoins_price_override |
| `episode_unlocks` | 用户 × 集解锁记录,UNIQUE (user_id, episode_id)。unlock_type: ucoins / bundle / member / admin_grant |
| `series_purchases` | 整剧买断 Stripe Checkout 订单。partial unique index 保证一个 user × series 只能 succeeded 一次 |
| `ucoins_orders` | U-Coins 充值订单。is_first_charge 字段 + `pkg_099_first` 一次性限购校验 |
| `settlements` | 月度分成结算单 (PDF §4 公式),per (period × series_id) 唯一,upsert 支持重算 |
| `series_acquisition_costs` | 每剧 × 每月 × 每渠道 (facebook/google/tiktok/influencer/other) 投流花费 |

`series` 表扩展字段:`free_episodes_count` / `ucoins_per_episode` / `bundle_price_usd_cents` / `member_free` / `is_premiere` / `is_recommended` / `revenue_share_pct` / `scheduled_publish_at` / `lifecycle_status`。

`system_settings` 新键:`ucoins_packages` / `default_revenue_share_pct` / `default_channel_fee_pct_web` / `default_platform_service_pct` / `default_include_acquisition_cost` / `ucoins_to_usd_cents` / `drama_member_tiers` / `drama_lite_counts_as_member` / `seedance_fast_cost_multiplier` / `seedance_standard_cost_multiplier`。

### 1.2 Worker endpoints

**用户侧**

- `GET  /api/wallet/balance` — 余额 + lifetime + 近 20 条 tx
- `POST /api/wallet/checkout` `{ package_id }` — Stripe Session for U-Coins pack (first-charge 限购校验)
- `POST /api/series/:id/checkout-bundle` — Stripe Session for whole-series buyout
- `POST /api/episodes/:id/unlock` — 原子 U-Coins 扣 + 插 unlock 行 (race 时 refund)
- `GET  /api/episodes/:id/access` — 决定播放 vs 付费墙 (reason ∈ free|unlocked|bundle|member|locked)

**Stripe webhook**

`checkout.session.completed` 加 `metadata.product_type` dispatch:
- `'ucoins'` → 扣 ucoins_orders + 增 wallet_balance + 插 wallet_tx
- `'bundle'` → 标 series_purchases.status='succeeded'
- 否则走原有 tier-upgrade 路径不变

**Admin 侧**

- `POST /api/admin/settlements/generate { period }` — 按 PDF §4 公式 upsert 每个 series 的结算单
- `GET  /api/admin/settlements?period=YYYY-MM` — 列出 + 总结 + 创作者邮箱 hydration
- `PATCH /api/admin/settlements/:id` — 状态机推进 (pending_confirm → creator_confirmed → paid)
- `GET/POST/PATCH/DELETE /api/admin/acquisition-costs` — 每剧每月每渠道投流花费 CRUD (UNIQUE on series,period,channel 支持广告报表幂等导入)

**创作者侧**

- `POST /api/creator/settlements/:id/confirm` — 创作者自己确认结算 (只允许 pending_confirm → creator_confirmed,服务端校验 content_creator_id=auth.uid())

### 1.3 用户 UI

- `src/pages/WalletPage.jsx` (/wallet) — 6 个充值档卡 + 余额 + 近 20 tx + Stripe 返回 polling
- `src/components/PaywallModal.jsx` — 三入口 (解锁本集 / 充值再解锁 / 整剧买断),402 自动切到 topup 模式
- `src/pages/SeriesDetailPage.jsx` — 集卡加锁定徽章 (🪙 N) / 已解锁徽章 (✓) / 首发推荐 pill;按 episodes 表读 (legacy JSONB 兜底)
- `src/pages/CreatorEarningsPage.jsx` (/creator/earnings) — 创作者自助结算单 + 确认按钮 + CSV 导出
- `src/components/InlineErrorBanner.jsx` — 通用错误条
- `src/api/dramaPayService.js` — 5 个 worker endpoint 的 client wrapper

### 1.4 Admin Dashboard 新增 5 个 tab

| Tab | 关键内容 |
|---|---|
| **剧集收益** (DramaRevenueView) | 8 个 metric 卡 (GMV/净收入/付费用户数/订单数/ARPU/U-Coins 充值/整剧买断/退款率) + 日趋势 SVG 堆叠条形图 + 收入构成 SVG donut + Top 10 排行 |
| **剧集管理** (DramaSeriesView) | 全 series 表 + 编辑弹层 (免费集数 / 单集价 / 买断价 / 分成比例 / member_free / is_premiere / is_recommended / scheduled_publish_at / lifecycle_status) |
| **分成结算** (SettlementsView) | 月度选择 + 一键"生成本月结算" + 结算单表 + 详情弹层 (完整 PDF §4.3 breakdown + 状态流转 + 标记打款) |
| **付费流水** (PaymentLedgerView) | 跨表 ledger (ucoins_orders + series_purchases + episode_unlocks) + 多过滤 + 单用户付费抽屉 (LTV + 全部活动) |
| **投流 ROI** (AcquisitionCostsView) | 投流录入弹层 + 按剧 ROI 表 (color-coded ≥2× 绿 / ≥1× 蓝 / <1× 红) + 渠道分布 + 编辑/删除 |

---

## 2. 多分段叙事 (Multi-Segment Story)

PDF Phase 2 用户体验:Quick Mode Step 1 选段数 1-5,LLM 一次性输出 N 段脚本,Storyboard 一张总图,Seedance 分别渲染每段,完成后 ffmpeg.wasm 客户端 concat 为单 mp4。

**新增**

- `/api/generate-multi-segment-script` — 专门的 Gemini-driven 端点 (绕开 aiscreenwriter 的空 shots bug)
- `normalizeMultiSegmentScript()` 前端规范化 (空 shot 补 fallback + 强制 user 选的段数)
- 每段独立 render 状态 + 失败可重试不影响其他段
- ffmpeg.wasm 集成:ESM core (UMD 在 Vite module worker 下 dynamic import 失败) + R2-primary unpkg-fallback (`X-FFmpeg-Source` header 可辨认)

---

## 3. CHARACTER IDENTITY BOARD

`POST /api/generate-character-board` — 与 storyboard 并行调一次 OpenAI gpt-image-2 出一张角色设定图:全身英姿 + 正面/三视脸部 + 服饰色板 + 顶部手写角色名。

Prompt 模板用 fei 提供的中文模板,角色脸特征**"灵感参考"**而非"复制" Actor 照片 — 避开 OpenAI real-person-likeness moderation。

Step 3 review 页两栏展示:左 storyboard 右 character board,设定图加载中显示 skeleton,失败显示"未生成(不影响视频渲染)"。

---

## 4. Free Mode 多项改进

- **资产认证**:每张参考图可上传到 BytePlus Private Asset Library,绕过 real-person safety filter,UI 状态 amber/blue/emerald/red 四态徽章 + 大按钮 below card
- **+4 比例**:21:9 / 9:21 / 4:3 / 3:4 (原 16:9 / 9:16 / 1:1 之外)
- **videoType 选择器** + DB 写入 `[VIDEO_TYPE_TAG[videoType], '#FreeSegment']`,让 Free Mode 作品也进 Discover 分类
- **@-mention picker** 重写:CSS `top-full` 定位替代 getCaretCoordinates 反射 — 修了 "焦点跳到首位" + "picker 抖动" 两个 bug
- **per-segment save 状态** 字段 dbSaveStatus / dbId / dbSaveError,失败可手动重试不烧 credits
- **audio safety auto-retry** — BytePlus output-audio safety filter 拒绝时自动重新生成无声版本

---

## 5. 错误体验全面升级

新组件 `<InlineErrorBanner>` (`src/components/InlineErrorBanner.jsx`):
- 3 种 kind (error / warning / info) 配色
- 可关闭 X + 可选 retry 按钮
- warning/info 12 秒自动关,error 留到手动关
- Error / string / object 自动 normalize

4 个独立 state 桶 (并行不互相覆盖):`renderError` / `freeSegmentError` / `mergeError` / `uploadError`。

12 处 alert() 已替换:
- Video generation / Render pipeline failed
- Per-segment render failed
- Multi-segment combine / Free Mode merge
- Real-person likeness safety reject
- Invalid video_url (有素材 / 无素材两种)
- 通用 Generation failed
- Upload failed × 3 (series episode / Free Mode asset / character ref)

---

## 6. 视频播放统一化

`<UnifiedVideoPlayer>` 全站铺平 (此前不同入口用 raw `<video>` 或 `<iframe>` 各种 mix):

- Hero / MasonryGrid / LightboxPlayer / SeriesDetailPage / Library work modal / Free Mode lightbox / Free Mode segment cards / Spark / 多个 admin 预览页

Safari 走 native HLS,其他走 lazy hls.js;统一 poster 处理、ref forwarding、autoplay-with-mute-fallback、TikTok-style 10-deep lookahead prefetch、iOS Safari 多 fix (5-swipes-stuck, unmuted-autoplay-after-swipe, frame-then-black resilience)。

---

## 7. 报价单 (Render Confirm Modal) 动态计价

modal 内的 resolution + model 选择器现在实时驱动总价:

- `computeFreeModeCredits(dur, res, modelId?)` 第三参可选,factor in model 的 `cost_multiplier` (1.0× Fast / 1.5× Standard,admin 可调)
- rate display 在 multiplier > 1 时展开为 `6 × 1.5× (Standard) ≈ 9 tokens/sec`
- 4 个计费点 (quickModeVideoCost / freeModeCost / costForSegment / handleDeductCredits) 全部 wired

---

## 8. 草稿持久化跨设备

新表 `story_drafts` (per user × generation_mode 唯一,JSONB data 列)。`src/api/draftService.js` 提供 listDrafts / upsertDraft / deleteDraft。

- StoryGeneratorPage 自动保存现在双写:localStorage 立即写 + Supabase 防抖 3s 写
- 恢复优先级:服务器匹配 URL 模式 → 服务器最近 → localStorage
- resetWorkflowState / publish / "Start new" 都同时清服务器副本
- LibraryPage Drafts tab 从服务器拉,每模式独立显示一张卡

---

## 9. 其他可见改动

| 模块 | 改动 |
|---|---|
| 风格库 | 全面重写 — 21 个 GPT-image-2 优化风格分 5 类 (替代原零散 grab-bag);per-videoType 6-style curation |
| Storyboard prompt | 改为 multi-panel sheet (替代单 key visual);CHARACTER SEED 5 字段块;videoType-aware pace + directorial language |
| OpenAI geo-block | 3× retry with 600ms backoff;给用户友好中文提示 "等 1-2 分钟,CF 换路由后通常 ok" |
| Library Works | bulk delete 模式 / Private 作品可删 / Free Mode 草稿+作品可见 |
| Library work modal | UnifiedVideoPlayer 替代 raw video,Stream URL 正确播放 |
| Library refresh | Works tab 加手动刷新按钮 |
| 直接下载视频 | `src/utils/downloadVideo.js` + worker `/api/stream/enable-download` (Stream 预处理后 blob trigger),替代之前"跳新页"行为 |
| PWA | Chrome 弃用的 apple-mobile-web-app-capable meta 加 W3C 标准等价 |
| Spark | 排序按 recency × popularity 加权,exclude 已看 |
| Stripe 计价 | 视频 4 / 6 / 12 tokens/sec @ 480p / 720p / 1080p |
| Lite tiered pricing | $3.99 → $5.99 → $7.99 (随购买次数升档) |
| Admin Orders | refund / void / restore + 详细 Stripe payment intent drawer |
| Help Articles | admin 可编辑 markdown 帮助文章 |

---

## 10. Migration 部署清单

按时序跑 (CLI 用 `supabase db push --yes`,文件在 `supabase/migrations/`):

1. `20260525000001_story_drafts.sql` — 草稿持久化表
2. `20260525000002_drama_payments.sql` — 短剧付费 Phase 1 (6 张表)
3. `20260525000003_drama_settlements.sql` — Phase 2 结算表
4. `20260525000004_drama_member_config.sql` — Phase 2 会员 tier 配置
5. `20260525000005_drama_acquisition_costs.sql` — Phase 3 投流成本表

所有 migration 已在 prod Supabase 跑过 (`8f5781e`,5/25)。

---

## 11. 配置 / 部署确认清单

- [x] 5 个 Supabase migration 已在 prod 跑过
- [x] R2 wasm 已上传到 `uvrera/ffmpeg/ffmpeg-core.wasm` (Worker 同时配了 unpkg fallback)
- [x] Stripe webhook 复用 `checkout.session.completed` (无需新加 event subscription)
- [x] SW cache v68
- [ ] **Stripe Dashboard 价格冻结**:已确认 $25/$69/$189 不变;U-Coins 走 inline price_data (不需要预先创建 Stripe Product)
- [ ] **生产试跑 (TODO 上线后)**:Free Mode 单段 → Library 出现 / Quick Mode 多段 → 合并成功 / 充值 $0.99 → 200 U-Coins 到账 / 解锁 1 集 → 扣 40 / 整剧买断 → 全集解锁

---

## 12. Phase 4 候选 (下一轮 minor)

- Discover 公共 feed 用 is_premiere / is_recommended 排序 (现在只 my-series / library series tab 用上)
- 独立短剧会员 SKU (PDF §2.3 的周/月/年/Premium 价格档,跟现有 $25/$69/$189 创作者订阅分开)
- A/B 测试付费墙卡点 (免费集数实验)
- 内容方自助上下架 (创作者自己改 lifecycle_status)
- 自动月结算 cron (目前需要 admin 手动点)
- Email 通知 (打款完成后给 creator 发邮件 + 月度对账提醒)
- 真正的 Stripe Connect 接入 (目前打款是 admin 手动 + 流水号备注)

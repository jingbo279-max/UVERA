# 部署变更记录

**说明**：记录每次部署的变更内容，用于同步到 Notion 发布记录 Database
**Notion Database**: https://www.notion.so/U-Wiki-30dbdcea5b3680deb681c7c81a1b72b4

---

## 📝 待部署

### 2026-05-05 - Stripe 支付接入（Checkout + Customer Portal + 用户主动领取 daily credits）

**总结**：
取代 [SubscriptionPage](src/pages/SubscriptionPage.jsx) 里的假 `handleSimulatePayment`。完整接入 Stripe Checkout + Customer Portal + Webhook，加用户主动触发的 daily credits 领取机制（不是 cron）。**5/8 走 test mode**，5/9-10 切 live。

**主要变更（代码）**：

- [x] `public/_worker.js` — 4 个新端点：
  - `POST /api/stripe/checkout` — 创建 Checkout Session（接受 `tier` + `billing`，映射到 Price ID）
  - `POST /api/stripe/customer-portal` — 跳到 Stripe 托管的"我的订阅"页
  - `POST /api/stripe/webhook` — 处理 `invoice.payment_succeeded`（首次 + 续费统一入口）/ `customer.subscription.deleted`，HMAC-SHA256 签名验证，更新 user_metadata.tier + 累加月度积分
  - `POST /api/credits/claim-daily` — **所有用户**（free + 付费）每日 +6 credits，UTC 日内幂等
- [x] [src/api/supabaseClient.js](src/api/supabaseClient.js) — 加 `claimDailyCredits()` helper
- [x] [src/pages/SubscriptionPage.jsx](src/pages/SubscriptionPage.jsx) — `handleSimulatePayment` → `handleCheckout`（重定向 Stripe）；新增 `handleManageSubscription` → Customer Portal；`/subscription?checkout=success` 回跳后等 webhook 处理 + 刷新 tier
- [x] [src/pages/SettingsPage.jsx](src/pages/SettingsPage.jsx) WalletView — 加 "Claim today's credits" 按钮（仅付费用户、当日未领时显示）；"Manage Subscription" 接 Customer Portal；"Top up tokens" / "Change plan" 跳 /subscription

**部署前 checklist（费必做）**：

#### 1. Stripe Dashboard 配置（test mode，~15 分钟）
1. [Stripe Dashboard](https://dashboard.stripe.com) **右上角切到 Test mode**
2. **Products** → 建 3 个产品：
   - Starter — Price: $25/mo + $240/yr (=$20/mo)
   - Creator — Price: $69/mo + $660/yr (=$55/mo)
   - Studio — Price: $189/mo + $1812/yr (=$151/mo)
3. 复制 6 个 Price ID（`price_...`）
4. **Developers → API keys** → 复制 test mode **Secret key**（`sk_test_...`）
5. **Developers → Webhooks → Add endpoint**：
   - URL: `https://uvera.ai/api/stripe/webhook`
   - Events: `invoice.payment_succeeded` + `customer.subscription.deleted`
     （前者覆盖首次付款 + 后续续费，是 source of truth）
   - 复制 **Signing secret**（`whsec_...`）

#### 2. Supabase Service Role Key（2 分钟）
Supabase Dashboard → **Settings** → **API** → 复制 **service_role secret**（**别**用 anon）

⚠️ 这个 key 绕过 RLS，只能在 Worker（服务端）用，**绝不**进 frontend bundle

#### 3. Cloudflare Worker secrets（5 分钟）
Cloudflare Dashboard → Workers & Pages → uvera Worker → **Settings → Variables and Secrets**，加 9 条（全部 Encrypt）：

| Name | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role |
| `STRIPE_PRICE_STARTER_MONTHLY` | `price_...` |
| `STRIPE_PRICE_STARTER_YEARLY` | `price_...` |
| `STRIPE_PRICE_CREATOR_MONTHLY` | `price_...` |
| `STRIPE_PRICE_CREATOR_YEARLY` | `price_...` |
| `STRIPE_PRICE_STUDIO_MONTHLY` | `price_...` |
| `STRIPE_PRICE_STUDIO_YEARLY` | `price_...` |

#### 4. 部署 + 测试
```bash
cd /Users/ff/longVV/uvera
git pull --ff-only feifeixp main
npm install
npm run deploy
```

Stripe test 卡：`4242 4242 4242 4242` 任意未来日期任意 CVC 任意邮编。

测试流程：注册→`/subscription`→选 Creator→Upgrade→Stripe 页 4242 卡支付→跳回 `/subscription?checkout=success`→等 ~3s webhook→tier 显示 Creator→Settings→Wallet→"Claim today's credits" 按钮可点→1000 credits 加上→"Manage Subscription" 跳 Stripe 托管页。

**影响范围**：支付链路 / 订阅管理 / credits 系统
**类型**：✨ 新功能（核心商业化）
**积分模型（费 2026-05-05 定）**：
- **每日登录奖励**（universal）：所有用户每天领 +6 credits，UI 上一键领取
- **订阅积分**（仅付费）：首次付款 + 每次续费时自动 +N 月度积分（Starter 500 / Creator 1500 / Studio 5000），通过 `invoice.payment_succeeded` webhook 触发
- 两者**叠加**：付费用户每日还能领 +6 当登录奖励
- 积分**不重置** — 月底用不完累积到下月（除非数值需要其他规则可后续调整）

**已知 limitation（推后）**：
- 用户当天不登录就领不到当日 +6（设计如此，UX trade-off）
- Plan 升级/降级（`customer.subscription.updated`）暂未处理 — 当前续费逻辑是简单"加月度积分"，升级时可能短期发多份
- Refund 走 Stripe Dashboard 手动（per TOS §8）

### 2026-05-05 - Sentry 错误监控 + Footer 法务链接

**总结**：
GA 5/8 上线前的最后两件 P1 配套：
- 接 [Sentry](https://sentry.io) 错误监控，所有未捕获 JS 错误 + ErrorBoundary 拦下的 React render 错误自动上报
- Footer 加 Terms / Privacy / Content License 三个 legal 链接 + `/terms` `/privacy` `/content-license` 三个路由页（懒加载，react-markdown 渲染 docs/ 里的 v0.1 草稿）
- `npm run build` 自动同步 `docs/` → `public/legal/`（避免手动 copy 漏更新）

**主要变更**：

- [x] [src/sentry.js](src/sentry.js) — Sentry init 模块；读 `VITE_SENTRY_DSN` env，未设则 no-op；过滤 chunk reload 错误
- [x] [src/components/ErrorBoundary.jsx](src/components/ErrorBoundary.jsx) — `componentDidCatch` 加 `Sentry.captureException` 上报
- [x] [src/main.jsx](src/main.jsx) — `import './sentry.js'` 置最前；`/terms` `/privacy` `/content-license` 路由（懒加载 LegalPage）
- [x] [src/pages/LegalPage.jsx](src/pages/LegalPage.jsx) — fetch markdown + react-markdown 渲染（自带 footer + 简易 header）
- [x] [src/components/Footer.jsx](src/components/Footer.jsx) — 简版 footer，3 个 legal 链接 + copyright
- [x] [index.jsx](index.jsx) — 主页底部挂 Footer（Spark fullscreen 与 lightbox 时不渲染）
- [x] [scripts/sync-legal-docs.mjs](scripts/sync-legal-docs.mjs) — 新建；`npm run build` 自动跑，把 `docs/TERMS-OF-SERVICE.md` 等复制到 `public/legal/{slug}.md`
- [x] [package.json](package.json) — `build` 改为 `node scripts/sync-legal-docs.mjs && node scripts/generate-version.mjs && vite build`
- [x] 新增依赖：`@sentry/react ^10.51.0`, `react-markdown ^10.1.0`

**Bundle 影响**：
- LegalPage 懒加载，单独 chunk 120KB（gzip 37KB），只在用户点 footer 链接时下载
- 主 bundle 增加 ~13KB（Sentry 核心）
- 总成本可接受

**部署前 checklist**：
- [ ] 注册 Sentry 账号 → 创建 React 项目 → 复制 DSN
- [ ] Cloudflare Pages 加环境变量 `VITE_SENTRY_DSN`（Production + Preview）
- [ ] 触发重新部署（push 或 dashboard 重跑）

**影响范围**：错误监控 / 法务页面 / 主入口
**类型**：✨ 新功能（监控） + ✨ 新功能（合规 UI）

### 2026-05-05 - CI 改 build-only check（auto-deploy 推迟到上线后）

**总结**：
原计划用 GitHub Actions 替换坏掉的 Cloudflare Workers Build 集成，做 push-to-main 自动部署。**经过约 2 小时排查**（详见下方决策日志），始终卡在 wrangler 4.87 + 自定义 API token 调 `/workers/services/uvera` 返 `code: 10000` 的鉴权错误，curl 用同 token 同 URL 又能 200。属于 wrangler / CI runner / token 之间的深层不兼容，5/8 窗口内不再深挖。

**5/8 救火方案**：
- CI 只跑 `npm run build` + `node --check public/_worker.js` 验证代码能编译
- 实际 deploy 走本地 `npm run deploy`（`wrangler login` OAuth 已验证可用）
- auto-deploy 进 [docs/DEFERRED-DECISIONS.md](docs/DEFERRED-DECISIONS.md) 等上线后再追

**主要变更**：
- [x] `.github/workflows/build-check.yml`（rename from `deploy.yml`）— 移除 wrangler deploy step，加 build + worker syntax check
- [x] [scripts/create-cf-token.sh](scripts/create-cf-token.sh) 保留 — 排查过程中写的工具，未来重启 CI 修复时可复用
- [x] [wrangler.jsonc](wrangler.jsonc) 保留 `account_id` 字段 — 本地 `npm run deploy` 也用得上

**决策日志**（CI 排查时间线，留作记录）：
- 改 GitHub Actions 用 `cloudflare/wrangler-action@v3` → action 吞错误
- 改成 `npx wrangler deploy` 直接调用 → 暴露 `CLOUDFLARE_API_TOKEN missing`
- secrets 加上 → 暴露 `Account tag in access policy must match tag in request uri` →
  发现 secrets 加成了 Environment secrets 不是 Repo secrets
- 搬到 Repo secrets → 暴露 `7003 object identifier is invalid` → 发现 token scope 不够
- 用 Global API Key 脚本生成 token（7 → 11 → 14 → 20 个 permission groups 逐次扩） → 还是 10000
- wrangler 4.83 → 4.87 升级 → 还是 10000
- account_id 写进 wrangler.jsonc 而非 secret → 还是 10000（说明 secret 不是问题）
- curl 同 URL 同 token 验证 → **本地 200，CI 10000**（关键差异）
- 决定止损，5/8 上线后再追

**影响范围**：CI/CD
**类型**：🔧 重构（务实降级）

### 2026-05-05 - 法务三件套 v0.1 草稿（TOS / Privacy / Content License）

**总结**：
GA 上线（5/8）合规前置。起草 [docs/TERMS-OF-SERVICE.md](docs/TERMS-OF-SERVICE.md) / [docs/PRIVACY.md](docs/PRIVACY.md) / [docs/CONTENT-LICENSE.md](docs/CONTENT-LICENSE.md) v0.1，每份 ~300-500 行，覆盖产品当前合规边界。**待外部律师终审后上线 UI 链接**。

**关键决策**（费 2026-05-05 定，记录在 [COMPLIANCE.md §5](docs/COMPLIANCE.md)）：
- 法律主体：longVV Ltd，美国（默认 Delaware）
- 地理范围：全球开放，**不含中国大陆**（合同条款排除 + 待评估 IP geo-blocking）
- AI 训练：仅训练 Official Avatar 库，绝不训练用户内容（与 [COMPLIANCE.md §1, §4](docs/COMPLIANCE.md) 红线一致）
- 退款：7 天无理由全退（首次购买）
- 最低年龄：16
- 法务联系：legal@uvera.ai

**主要变更**：
- [x] [docs/TERMS-OF-SERVICE.md](docs/TERMS-OF-SERVICE.md) — 17 节，含资格 / 注册 / 订阅 / 退款 / 禁止行为 / 免责 / 责任限制 / 管辖 / 仲裁 / EU 消费者保留
- [x] [docs/PRIVACY.md](docs/PRIVACY.md) — 15 节，含数据收集 / 第三方处理者列表（Supabase / Cloudflare / Stripe / Gemini / BytePlus / Neodomain）/ GDPR 法律基础 / CCPA 权利 / 跨境传输 / Cookie 清单
- [x] [docs/CONTENT-LICENSE.md](docs/CONTENT-LICENSE.md) — 12 节，含限制性 license / Avatar 形象权 / AI 训练边界 / Branch & Recast 权利让渡 / DMCA / 账号删除
- [x] [docs/COMPLIANCE.md §5](docs/COMPLIANCE.md) — 状态 🔴 → 🟡，记录决策与未完成项

**Lawyer review checklist**（每份文档顶部）：
- Delaware 注册地确认
- 强制仲裁 + class waiver 在美 / EU 的执行边界
- SCC / DPF 跨境传输机制
- DMCA 代理登记（需物理地址）
- EU representative 任命（如 EU 用户量触发 Art. 27）
- 部分 EU 成员国儿童同意年龄（13/14/15 vs 16）

**影响范围**：法务文档 | 合规
**类型**：📋 文档（非代码变更）
**下一步**：费转外部律师终审 → 律师改后回 v0.2 → 上线时挂 Footer + 注册流 + Publish 流

### 2026-05-05 - 严格 RLS policies（修复 P0 数据安全漏洞）

**总结**：
RLS 审计发现 `users` / `orders` / `recommended_content` / `system_configs` / `characters` 5 张表都是 `using (true)` 全开 ALL 权限。任何匿名访客拿 bundle 里的 Supabase anon key 即可读取所有 PII / 删除所有用户 / 篡改首页 feed / 改系统配置。这是比 admin 密码更严重的 P0 漏洞。修复：替换为按行授权策略（owner-only / admin-full / public-read-published）。

**主要变更**：

- [x] [migrations/20260505_strict_rls_policies.up.sql](migrations/20260505_strict_rls_policies.up.sql) — 替换 5 张表的 "allow public all access" policy；新增 `is_admin()` helper（读 JWT user_metadata.is_admin flag）
- [x] [migrations/20260505_strict_rls_policies.down.sql](migrations/20260505_strict_rls_policies.down.sql) — 配套 rollback（紧急用）
- [x] Pre-flight 安全：UPDATE `auth.users` 给 `longvv.dev@gmail.com` / `feifeixp@gmail.com` 打 `is_admin=true` flag，跑前自检至少 1 个 admin 存在，否则整事务 abort 防止锁死

**Policy 设计**：
- `users` — 自己 + admin
- `orders` — 自己 read，admin 全控（真支付应走 service_role）
- `recommended_content` — public 读 published，作者管自己（artist=uid），admin 全控
- `system_configs` — admin 唯一
- `characters` — owner only + admin
- `user_likes` / `user_saves` — 已是 own-only，未改动

**部署方式**：手动粘贴到 Supabase Dashboard → SQL Editor → Run（项目无自动迁移框架）

**影响范围**：数据库授权层 | 安全
**类型**：🔒🔒 P0 安全修复

### 2026-05-05 - Admin 登录改造（Supabase auth + 白名单）

**总结**：
移除硬编码密码 `123456` / `admin` 与 localStorage mock token，改用 Supabase auth + email 白名单（`VITE_ADMIN_EMAILS` env var）或 `user_metadata.is_admin` 双 gate。这是 GA 上线前 P0 安全修复。

**主要变更**：

- [x] `src/api/adminService.js` — 重写 `adminLogin(email, password)` / `checkAdminAuth()` / `logoutAdmin()`，全部走 Supabase；新增 `isAdminUser()` 私有 helper
- [x] `src/pages/admin/AdminLogin.jsx` — 加 email 输入框；async session check 加 loading state
- [x] `src/pages/admin/AdminDashboard.jsx` — `loadData` / `handleLogout` 改 await
- [x] `index.jsx` — 兜底 `AdminPortal` 包装器改用 useEffect + checking 状态
- [x] build 通过验证

**部署前 checklist（费必做）**：

1. **Cloudflare Pages 加环境变量** `VITE_ADMIN_EMAILS`
   - 值例：`admin@uvera.ai,feifeixp@xxx.com`（逗号分隔，大小写不敏感）
   - 设在 Production + Preview 两个环境
2. **创建 admin Supabase user** — 走 `/auth` 注册或 Supabase Dashboard 直接建
3. （可选）**用 SQL 直接打 admin flag** 替代 env 白名单：
   ```sql
   UPDATE auth.users
   SET raw_user_meta_data = raw_user_meta_data || '{"is_admin": true}'::jsonb
   WHERE email = 'admin@uvera.ai';
   ```
4. **RLS 审计** — admin UI 现在只是 UX 屏蔽，**真正护栏在 RLS**。在 Supabase SQL Editor 跑：
   ```sql
   SELECT tablename, policyname, cmd, qual
   FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('recommended_content','users','orders','characters','system_configs')
   ORDER BY tablename, cmd;
   ```
   重点确认 INSERT/UPDATE/DELETE 都要求 `auth.role() = 'service_role'` 或
   `(auth.jwt() -> 'user_metadata' ->> 'is_admin')::bool = true`。
   **如果 RLS 是 `using (true)` 之类的全开策略，前端这次修复保护不了任何东西**。

**影响范围**：admin 后台登录 / 鉴权 | 安全 | 部署流程
**类型**：🔒 安全修复
**关联**：
- [docs/COMPLIANCE.md](docs/COMPLIANCE.md) GA 前 P0
- 移除前的攻击面：任何人 Console 跑 `localStorage.setItem('admin_token','x')` 即可进 dashboard

### 2026-05-05 - 修复 _worker.js 语法错误（恢复 Cloudflare 部署）

**总结**：
修复 `public/_worker.js:610` 的少缺 `}`。该 bug 在 commit `704307c` 引入，导致 5/3 起所有 Cloudflare Pages 部署在 `wrangler deploy` 阶段失败（esbuild 报 `Expected "}" but found ";"` at line 912）。该 commit 添加 `/api/proxy-asset` handler 时，`optimize-prompt` route 的 catch 关闭后，外层 `if` 缺一个闭合 brace，导致后续所有路由意外嵌套在它内部，文件末尾的 `};` 关错了块。

**主要变更**：

- [x] `public/_worker.js:610` — 在 `} catch (err) { ... }` 之后补回 `      }` 关闭 `if (optimize-prompt)` 外层
- [x] `node --check` 通过；`wrangler deploy --dry-run` 通过

**影响范围**：Cloudflare Pages 部署
**类型**：🐛 严重修复（unblock 上线）



---

## ✅ 已部署

### 2026-05-03 - Create 流程移除 NeoAI / Neo-Video 品牌词

**部署时间**：2026-05-03 CST（push 即触发 Cloudflare auto-deploy）
**部署链接**：https://uvera.ai
**负责人**：Leon + Claude
**Notion 记录**：⏳ 待下次有意义部署节点一起同步
**Commit**：8bc1354

**总结**：
Create 流程（StoryGeneratorPage）4 处 user-facing UI 字面量去掉 NeoAI / Neo-Video 品牌词，保持中文文案不变。内部 API 函数名 / CustomEvent 名 / import path 等程序标识符全部保留。

**主要变更**：

- [x] `src/pages/StoryGeneratorPage.jsx`
  - line 2128: `"NeoAI 渲染总控 (Render Station)"` → `"渲染总控 (Render Station)"`
  - line 2272: `NeoAI 需要您的基础概念来召唤我们的编剧大模型。` → `我们需要您的基础概念来召唤编剧大模型。`
  - line 2406: `NeoAI 编剧模型正在生成剧本...` → `编剧模型正在生成剧本...`
  - line 2467: `Neo-Video 2.0 引擎正在接管任务，请耐心等待。` → `视频引擎正在接管任务，请耐心等待。`

**保留不动**（内部标识符 / API 契约）：
- `generateNeoAIScript` 函数名 + `'../api/neoaiService'` import path（API 模块）
- `'NEOAI_UPGRADE_MODAL'` CustomEvent 名（跨组件事件契约）

**影响范围**：Create 流程 UI（Wizard 标题、step 1 副标题、剧本生成 loading、Render Station 副标题）

---

### 2026-04-18 - 品牌更名 UVERA + Header 交互优化

**部署时间**：2026-04-18 CST
**部署链接**：https://uvera.ai
**负责人**：Leon + Claude
**Notion 记录**：https://www.notion.so/2026-04-18-UVERA-Header-345bdcea5b3681c395c2d74074f714dc

**总结**：
将产品品牌从 longvv 全面更名为 UVERA，替换 Logo 图标（uvera-logo.png），并修复语言切换下拉位置、Globe 图标隐藏 bug、UPGRADE 按钮高度统一为 32px，以及 Back-to-Top FAB 滚动检测去除 rAF 改为同步计算。

**主要变更**：

- [x] `index.html` — `<title>` 改为 UVERA
- [x] `package.json` — `name` 改为 uvera
- [x] `public/brand/uvera-logo.png` — 新增 UVERA Logo 图标
- [x] `src/design-system/composites/NavigationBar.jsx`
  - Logo src 改为 `/brand/uvera-logo.png`，alt 改为 UVERA
  - 语言下拉菜单改为正下方（`top: calc(100% + 4px)`，居中），修复 Globe 图标 open 时消失的 bug
  - UPGRADE Plan 按钮高度统一为 32px
- [x] `src/pages/StudioPage.jsx` — "UVERA platform"
- [x] `index.jsx` — Back-to-Top FAB 滚动检测同步化（移除 rAF）

**影响范围**：全局品牌、NavigationBar、Back-to-Top FAB

---

### 2026-04-18 - Explore IA-v2 重构 + Hero 轮播 + Spark 模式 + Library + Profile 菜单升级

**部署时间**：2026-04-18 CST
**部署链接**：https://uvera.ai
**负责人**：Leon + Claude
**Notion 记录**：https://www.notion.so/Explore-IA-v2-Hero-Spark-Library-Profile-345bdcea5b3681729c80c4c21cb19b9b

**总结**：
完成 Explore 页面 IA-v2 完整重构，包含 Follow/Discover/Spark 三标签、Hero 三屏轮播背景（Spline + 视频 + 渐变）+ Page Control、全屏 Spark 视频浏览模式、Library 页面骨架；同时升级 Profile 菜单布局，修复所有中英文字符串，并新增 Back-to-Top FAB 及 Spline 工具栏隐藏。

**主要变更**：

- [x] `index.jsx`
  - Explore 三标签：Follow / Discover / Spark，切换时自动对齐 SegmentedControl 到 Header CTA 中心
  - SegmentedControl 点击穿透修复（Header wrapper `pointerEvents: none`）
  - Hero 轮播 state (`heroSlide`)，section 切换重置到 slide 0
  - Back-to-Top FAB：`ArrowLineUp 18px`，32px 圆形按钮，滚动超过 pivot+viewport 后出现，点击复用 scrollToTabs 管道
  - `ArrowLineUp` 按钮样式与 PageControl 下方 chevron 一致（`rgba(255,255,255,0.1)` + border）
- [x] `src/components/Hero.jsx`
  - `HeroBackdrop`：三 slide 背景层（Spline / 视频 / 渐变）固定在 scroll container 外，随滚动淡出
  - `HeroContent`：透明 69vh 窗口保留文字视差淡出，含 `PageControl` 组件（Figma 51:5275 规格）
  - 自动轮播 8 秒，点击 dot 重置计时器
- [x] `src/components/SparkMode.jsx`（新建）
  - 全屏沉浸式视频浏览，6:4 左右分栏，视频 + 作者/标题/标签/CTA/交互按钮
  - 所有文案英文化（Cast Me / Remix / Like / Save / Share / Follow 等）
- [x] `src/components/LibraryPage.jsx`（新建）
  - IA-v2 §3.2 四标签骨架：Avatars / Works / Appearances / Drafts
  - SegmentedControl 内标签，空态占位
- [x] `src/design-system/composites/TabBar.jsx`
  - Profile 菜单重构：头像 + 姓名/handle 横排，Token + Pro Plan 合并胶囊行
  - Sign Out 移至底部右对齐独立胶囊，默认透明，hover 显背景
  - 分隔线换用 Figma `Separators/Separator`（white/7 lighten + #5E5E5E/15 color-dodge）
  - 菜单 bottom avatar 区 hover 时折叠为 0 高度消除空白
  - 菜单文案全英文化
- [x] `src/components/LibraryPage.jsx`
  - 标签及描述文案全英文化
- [x] `src/components/SparkMode.jsx`
  - 所有可见文案英文化
- [x] `src/design-system/tokens/backgrounds.css`
  - 隐藏 Spline 第三方工具栏水印（`[class*="styles-module__toolbar"]`）

**影响范围**：Explore 页、Library 页、Spark 模式、Profile 菜单、Hero 区域

---

## ✅ 已部署

### 2026-03-28 - Sidebar visionOS 升级 + Subscription 页面 + 频道更名 + 瀑布流 5 列

**部署时间**：2026-03-28 00:37 CST
**部署链接**：https://uvera.ai
**负责人**：Leon + Claude
**Notion 记录**：https://www.notion.so/Sidebar-visionOS-Subscription-5-330bdcea5b368173a55cc64062ca489b

**总结**：
Sidebar 全面应用 Figma visionOS Tab Bar 规格（44px 按钮、底部径向发光 hover）；新增 Subscription 定价页面（Free/Starter/Creator/Studio/Business 五档），从 Header UPGRADE 按钮直达；频道 Clips 更名为 Spark，Hero 标题更新为 "Universal Gateway"；MasonryGrid 统一改为 5 列布局。

**主要变更**：

- [x] `src/components/Sidebar.jsx`
  - 按 Figma 139:14646 规格重构：h-11 (44px) 按钮、w-[68px] pill、gap-3 (12px)、text-[19px] 标签
  - 去除分割线
  - GlassOverlay 组件：2 层玻璃叠加（white/7 + gray/18 color-dodge）
  - Hover 底部径向发光：white/6 + gray/16 mix-blend-color-dodge，精确匹配 Figma SVG data URI 参数
  - Light/Dark Mode 自适应：液态玻璃 `liquid-glass` 变体 + semantic text tokens
  - Explore 选中态使用 `violet-600` 品牌色
- [x] `src/pages/SubscriptionPage.jsx`（新建）
  - 5 档定价：Free / Starter ($24) / Creator ($59) / Studio ($129) / Business (Enterprise)
  - 月付/年付切换（年付约 20% 折扣）
  - Credits 状态卡、Plan 选择网格、动态 CTA 区域
  - 全部使用 semantic tokens + Phosphor Icons，Dark Mode 自适应
- [x] `src/design-system/composites/NavigationBar.jsx`
  - UPGRADE_LABEL 更新：Free/Starter/Creator/Studio/Business 对应文案
- [x] `index.jsx`
  - 新增 `subscription` 路由分支
  - GridPlayer 排除 subscription 页面
- [x] `src/components/Hero.jsx`
  - 标题 "U MAKES THE WORLD" → "Universal Gateway"
- [x] `src/data/channels.js` + 多组件
  - "Clips" 频道全局更名为 "Spark"
- [x] `src/components/MasonryGrid.jsx`
  - 桌面端列数统一为 5 列（flex 手动分列，替代 CSS columns）
  - 间距 gap-2 统一
- [x] `src/design-system/tokens/backgrounds.css`
  - 新增频道色渐变背景系统（Violet 左侧主导）

**影响范围**：Sidebar、Header、Hero、MasonryGrid、Subscription 页面、频道数据层、背景系统
**类型**：功能新增 + UI 升级

### 2026-03-10 - Liquid Glass 视觉系统升级 + Header 自适应 + 局域网开发支持

**总结**：
基于 Apple Liquid Glass 设计规范，全面升级玻璃效果系统：Clear 变体实现 80px 高斯模糊 + 饱和度增强近似 Luminance Mask；Header 圆形按钮和下拉菜单均实现 `overDarkBg` 自适应——深色 Hero 区域自动切换 Prominent 变体和白色图标/文字，滚动至浅色区域平滑过渡回 Clear 变体。同时开放 Vite 局域网监听，支持 iPad 等设备实时预览。

**主要变更**：

- [x] `src/index.css`
  - 所有 6 个 `liquid-glass-*` 变体添加共享 `transition: background 0.5s ease, box-shadow 0.5s ease, border-color 0.5s ease`（实现滚动时玻璃效果平滑过渡）
  - `liquid-glass-clear`：blur 40→80px，新增 `saturate(2.0) brightness(1.05)`（近似 Apple Luminance Mask），背景色调整为冷灰中性 `rgba(245,245,250,0.08)`，新增 `0.5px rgba(0,0,0,0.04)` 细描边
  - `liquid-glass`（Regular）：背景 alpha 0.14→0.18
  - Dark mode `liquid-glass-clear`：blur 40→80px，新增 `saturate(1.6) brightness(0.85)`
  - Dark mode `liquid-glass`：背景 alpha 0.06→0.08
- [x] `src/components/Header.jsx`
  - 新增 `glassBtn` 自适应：`overDarkBg → liquid-glass-prominent`（白色 28%，深色背景上清晰可见）/ 默认 `liquid-glass-clear`
  - 新增 `btnIcon` 颜色：`overDarkBg || isDark → rgba(255,255,255,0.70)` / 默认 `rgba(0,0,0,0.40)`，应用于搜索、主题、静音共 6 个图标
  - 新增 `dc`（dropdown colors）颜色组：使用 `dd = overDarkBg || isDark` 判断，解决 light 模式深色 Hero 上方下拉菜单内容不可见问题
  - 主题下拉菜单（Sun/Moon/CircleHalf）：activeBg / hoverBg / 图标颜色全部改用 `dc.*`
  - 搜索筛选下拉菜单（All/Clips/Sound/Live/Story）：文字颜色 / chipBg / hoverBg / radio 按钮全部改用 `dc.*`
  - Filter 下拉和 Theme 下拉容器：硬编码 `backgroundColor`/`backdropFilter` → 统一使用 `liquid-glass` CSS 类
- [x] `src/components/Sidebar.jsx`
  - 导航激活 pill：`liquid-glass` → `liquid-glass-clear`（Apple Clear 规格，更通透）
  - `pt-2` → `pt-3`（左/右/上间距统一为 12px）
- [x] `vite.config.js`
  - `host: '127.0.0.1'` → `host: '0.0.0.0'`（server + preview），开放局域网访问
  - iPad 等局域网设备可通过 `http://192.168.31.113:5176/` 访问开发服务器

**影响范围**：UI 组件 | 视觉设计 | 开发环境
**类型**：✨ 优化
**部署时间**：2026-03-10
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/2026-03-10-Liquid-Glass-Header-Dropdown-31fbdcea5b3681368101c8a0401cb1c8

---

### 2026-03-09 - 交互细节优化 II：主题图标状态 / 导航修复 / 收藏功能 / 弹簧动画

**总结**：
本次以交互品质为核心，完成五项独立优化：主题切换图标激活态视觉统一（参照 Apple 规范）；修复 LightboxPlayer 页面 Brand Logo 无法返回首页及 Back 按钮被 Header 遮挡的问题；为媒体卡片新增书签收藏（Save）功能；为 Sidebar 频道图标添加 CSS 弹簧回弹（Spring Bounce）动画，提升点击反馈质感。

**主要变更**：

- [x] `src/components/Header.jsx`
  - 主题菜单触发按钮：Moon / Sun / CircleHalf 统一使用 `weight="fill"`（collapsed 状态下填充图标更易辨识）
  - 主题菜单展开项：Moon / Sun 使用 `weight="regular"`（颜色变化作为激活态指示，更接近参考设计），CircleHalf 保持 `weight="fill"`
  - 新增 `onLogoClick` prop：Logo 点击时除跳回首页外，同时清除 `lightboxItem` 与 `isPlaying` 状态（原 `setActiveSection('home')` 无法关闭 Lightbox）
- [x] `index.jsx`
  - `onLogoClick` 回调：`() => { setLightboxItem(null); setIsPlaying(false); setActiveSection('home'); }`
  - 新增 `savedItems`（`useState(new Set())`）及 `toggleSave` 函数（与 `toggleLike` 同模式，不可变 Set 操作）
  - `MasonryGrid` 新增 `savedItems` / `toggleSave` props 传入
- [x] `src/components/LightboxPlayer.jsx`
  - Back 按钮由 `top-4`（16px）下移至 `top: 80px`（清过 72px Header），`left: 29px`（水平中心 49px 与 Brand Logo 对齐）
  - 改为 `style` 内联定位，移除 responsive Tailwind 类
- [x] `src/components/MasonryGrid.jsx`
  - 新增 `BookmarkSimple` import（`@phosphor-icons/react`）
  - 新增 `savedItems` / `toggleSave` props
  - 媒体卡片右上角 Like 与 Save 按钮排布为垂直 `flex-col gap-1`
  - Save 按钮：已收藏 `weight="fill"` + `text-amber-400`，未收藏 `weight="regular"` + `text-white`
- [x] `src/index.css`
  - 新增 `@keyframes navIconSpring`（多段 scale 模拟弹簧物理：1 → 1.32 → 0.88 → 1.16 → 0.97 → 1）
  - 新增 `.animate-nav-spring { animation: navIconSpring 0.45s ease-out forwards; }`
- [x] `src/components/Sidebar.jsx`
  - 新增 `bouncingId` state（`useState(null)`）
  - 导航按钮 `onMouseEnter` 时设置 `bouncingId(item.id)`，图标 `<span>` 挂载 `animate-nav-spring` 类
  - `onAnimationEnd` 重置 `bouncingId(null)`，确保下次 hover 可重新触发
  - 非动画态通过 `style` prop 维持激活 `scale(1.1)` / 默认 `scale(1)` 状态

**影响范围**：UI 组件 | 交互 | 视觉设计
**类型**：✨ 优化 + 🐛 修复
**部署时间**：2026-03-10
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/2026-03-09-II-31ebdcea5b368198932ede1ea932503e

---

### 2026-03-09 - 图标库全量迁移 Lucide → Phosphor + UI 细节优化

**总结**：
将项目中所有 `lucide-react` 图标全量替换为 `@phosphor-icons/react`，统一图标语言，修复 Heart 图标 fill 动画失效问题。同步完成 Sidebar 导航按钮 Liquid Glass 视觉升级、Profile Pill 形状修正、品牌 Logo 链接至首页、及 Chips 过滤器顺序调整等 UI 细节优化。

**主要变更**：

- [x] `src/components/Hero.jsx`：`Play` 从 `lucide-react` → `@phosphor-icons/react`，使用 `weight="fill"` + `color="white"` 替代 SVG fill 属性
- [x] `src/components/MasonryGrid.jsx`：合并 Phosphor import，TypeIcon 函数全量更新（`Music2→MusicNote`, `Disc3→Disc`, `CirclePlay→PlayCircle`, `Film→FilmStrip`），Play FAB 改用 `MonitorPlay`
- [x] `src/components/Sidebar.jsx`：图标全量替换（`Settings→GearSix`, `HelpCircle→Question`, `LogOut→SignOut`, `ChevronRight→CaretRight`）；Sidebar 导航活跃 pill 改用 `liquid-glass` CSS 类，升级为 Apple 规格 Liquid Glass 质感
- [x] `src/components/GridPlayer.jsx`：全量替换（`LayoutGrid→SquaresFour`, `TvMinimal→MonitorPlay`, `ListMusic→Queue`, `Volume2→SpeakerHigh`, `VolumeX→SpeakerSlash`, `Share2→ShareNetwork`, `MoreVertical→DotsThreeVertical`）
- [x] `src/components/LightboxPlayer.jsx`：同 GridPlayer，视图切换按钮图标对调（Lightbox 为当前激活视图时 MonitorPlay 高亮，SquaresFour 半透明）
- [x] `src/components/Remote.jsx`：全量替换，同步为 Phosphor 统一标准
- [x] `src/components/CreateMusicPage.jsx`：全量替换（`Search→MagnifyingGlass`, `RefreshCw→ArrowCounterClockwise`, `Loader2→CircleNotch`），动画 spin 保留
- [x] `src/components/StudioPage.jsx`：合并 Phosphor import，ICON_GROUPS 数据层全量更新，颜色提取器 JSX 更新
- [x] `src/components/MediaUploader.jsx`：全量替换（`Upload→UploadSimple`, `Loader→CircleNotch`, `Film→FilmStrip`, `Image` 同名保留）
- [x] `src/components/Header.jsx`：Profile Pill 垂直内边距 `py-2` → `py-[13px]`，修正胶囊形状为正圆端帽；品牌 Logo 点击跳转至 `/`（首页）；搜索过滤 chips 包含 `Clips`（与频道命名一致）
- [x] `src/data/channels.js`：`CHANNELS['clip-flow'].label` 由 `'Clip Flow'` → `'Clips'`；`TYPE_LABEL.clip` 同步更新为 `'Clips'`
- [x] `src/data/mediaItems.js`：全部 `"category": "Clip Flow"` → `"category": "Clips"`（共 6 条，修复卡片标签显示不一致问题）
- [x] `index.jsx`（项目根）：`HOME_CHIPS` 已包含 `'Clips'`（替代旧 `'Clip Flow'`），当前值为 `['All', 'Clips', 'Story', 'Single', 'Album', 'MV', 'Live']`
- [x] **Heart 图标 fill 修复**：Lucide `fill-red-500` 因 SVG presentation attribute 优先级问题无法级联；Phosphor `weight="fill"` 正确控制路径填充，心型图标点赞动画恢复正常

**影响范围**：UI 组件 | 视觉设计 | 交互
**类型**：🔧 重构 + ✨ 优化
**部署时间**：2026-03-10
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/2026-03-09-Lucide-Phosphor-UI-31dbdcea5b368116a9c3fb4d4e335cf4

---

### 2026-02-22 - 按钮设计系统 + Create Music 页 + Lightbox Sidebar 修复

**总结**：
建立全站按钮设计 Token 体系，新增 AI 辅助音乐创作页（CreateMusicPage），修复 Lightbox 与 Create Music 页面中 Sidebar 无法通过汉堡包以 Overlay 模式打开的问题。

**主要变更**：
- [x] `src/index.css`：新增 `@layer components` 按钮 Token 类（`btn-icon-ghost` / `btn-pill` / `btn-tag` / `btn-tag-active` / `btn-segment` / `btn-segment-active` / `btn-choice` / `btn-choice-active` / `btn-ai` / `btn-primary`），统一全站按钮 Layout 与样式
- [x] `src/components/CreateMusicPage.jsx`（新文件）：AI 辅助音乐创作页，Basic / Custom 双模式，历史记录面板，全部按钮使用 Token 类名
- [x] `src/components/Hero.jsx`：新增 `onCtaClick` 回调，Sound 频道 CTA 跳转至 Create Music 页
- [x] `src/components/LightboxPlayer.jsx`：`Make Yours` 按钮仅对 `type === 'single'` 显示，新增 `onMakeYours` 回调
- [x] `src/components/GridPlayer.jsx`：移除 Make Yours 按钮
- [x] `index.jsx`：新增 Create Music 路由；`effectiveSidebar` 引入独立 `forcedOverlayOpen` 状态，修复桌面端 Lightbox / Create Music 页汉堡包点击后 Sidebar 无法以 Overlay 模式打开的问题（根因：`useSidebarState` 在非移动端自动重置 `isOpen`）
- [x] `src/data/channels.js`：Sound 频道 CTA 改为内部导航；新增 Film、Parallel World Hero 文案（B方案）；所有频道 description 精简至 ≤2 行

**影响范围**：UI 组件 | 音乐创作 | 交互修复
**类型**：✨ 新功能 + 🐛 修复
**部署时间**：2026-02-22
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/Create-Music-Lightbox-Sidebar-30fbdcea5b368160a2bcdc483a93a26a

### 2026-02-21 - Claude Code 自动化测试

**总结**：
测试 Claude Code 与 Notion 的自动化集成，验证从 changes.md 到 Notion Database 的完整工作流。

**主要变更**：
- [x] 连接 Claude Code 到 Notion
- [x] 读取 Notion 页面和 Database
- [x] 自动创建 Notion 记录
- [x] 自动更新 changes.md

**影响范围**：文档 | 开发
**类型**：🔧 重构
**部署时间**：2026-02-21 01:30
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/2026-02-21-Claude-Code-30dbdcea5b36813280a7c9ec1c579e53

### 2026-02-21 - Notion 工作流测试

**总结**：
测试 changes.md 到 Notion 发布记录 Database 的同步流程，验证工作流程完整性。

**主要变更**：
- [x] 验证文档链接可访问性
- [x] 测试 Notion 同步流程
- [x] 确认工作流程完整性

**影响范围**：文档
**类型**：📝 文档
**部署时间**：2026-02-21 00:30
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：[https://www.notion.so/2026-02-21-Notion-30dbdcea5b3680deaaffe8f17780f60d?source=copy_link]

### 2026-02-20 - 项目重组与首次部署

**总结**：
完成项目从 UWorld 到 U 的重组，建立8级目录结构，创建完整的品牌、设计、开发文档体系，首次部署到生产环境，建立 Notion 协作中心。

**主要变更**：
- [x] 品牌重命名（UWorld → U）
- [x] 目录重组（8个逻辑分类）
- [x] 品牌体系建立（10个文档）
- [x] Figma 集成（5个文件）
- [x] 模板系统（9个模板）
- [x] 术语标准化（Voice/Tone/调性）
- [x] Notion 工作区建立
- [x] 发布记录 Database 创建
- [x] 部署脚本优化
- [x] 生产环境部署

**影响范围**：品牌 | 设计 | 产品 | 开发 | 文档
**类型**：✨ 功能
**部署时间**：2026-02-20 23:30
**部署链接**：https://uvera.ai
**负责人**：Sun Jingbo
**Notion 记录**：https://www.notion.so/U-Wiki-30dbdcea5b3680deb681c7c81a1b72b4

---

## 📋 使用说明

### 部署前
1. 在"待部署"部分创建新记录
2. 填写总结和变更清单
3. 完成开发和测试

### 部署中
```bash
cd "$U_PATH/04-Development"
npm run build
./deploy/deploy.sh
```

### 部署后
1. 验证网站：https://uvera.ai
2. 将记录从"待部署"移到"已部署"
3. 勾选所有完成的变更
4. 添加部署时间和链接
5. 同步到 Notion 发布记录 Database

---

**最后更新**：2026-03-10（3 批变更合并部署完成）

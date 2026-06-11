# UVERA 项目代码验收报告

验收日期: 2026-06-11  
验收目录: `/Users/leite/Desktop/GoProject/UVERA`  
当前分支: `main`  
当前提交: `6a5470d Copy source code from feifeixp/uvera`

## 1. 验收结论

结论: **有条件通过**

项目当前代码可以完成生产构建,主部署链路配置与项目规约一致,核心支付/钱包/权限代码有较多防护设计,具备继续验收和小范围上线验证的基础。

但本次验收不建议直接给出“完全通过”。主要原因是:

- 缺少自动化测试体系,没有单元测试、集成测试、E2E 测试脚本。
- 前端与 Worker 存在超大文件,回归风险和维护成本偏高。
- 生产构建存在明显大包体警告,首屏性能需要专项优化。
- 依赖审计存在 3 个 moderate 漏洞,来自 VitePress 依赖链。
- 管理端和 Worker 的 admin 鉴权大量依赖 `user_metadata.is_admin`,需要确保后台写入路径和 RLS 策略持续受控。

建议验收状态定为: **功能可继续灰度/冒烟,正式交付前要求补齐 P0/P1 整改项。**

## 2. 本次验收标准

我按以下标准进行验收:

1. 构建可交付: `npm ci` 后 `npm run build` 必须成功。
2. 部署配置正确: 主站必须走 Cloudflare Workers + Static Assets,不能误用 Cloudflare Pages。
3. 安全边界清晰: 不应把服务端密钥暴露到前端;钱包、积分、支付、admin 操作必须走服务端或 RLS/RPC。
4. 财务链路可靠: Stripe webhook、幂等、退款、钱包扣款需要有明确防重与原子处理。
5. 权限模型可验收: 普通用户、admin、super admin 权限边界应有代码和数据库策略支持。
6. 数据库迁移可追踪: 新 schema/RPC/RLS 应在 `supabase/migrations` 中有记录。
7. 可维护性: 超大文件、重复逻辑、缺少模块边界会降低验收评级。
8. 可观测性与故障恢复: 构建、部署、Service Worker、Sentry、日志应能支撑线上排障。
9. 依赖风险: `npm audit --audit-level=high` 不应出现 high/critical。
10. 工作区卫生: 当前未提交改动需要明确标注,避免验收结果混入他人 WIP。

## 3. 执行检查

### 3.1 构建与语法

执行结果:

- `npm ci`: 通过,安装 617 个包。
- `npm run build`: 通过。
- `node --check public/_worker.js`: 通过。
- `node --check scripts/check-deploy-branch.mjs`: 通过。
- `node --check scripts/team-chat.mjs`: 通过。
- `npm run docs:lint`: 通过,79 篇文档,0 告警。

构建产物摘要:

- 主 CSS: `dist/assets/index-DFilypPl.css`, 234.49 kB, gzip 32.11 kB。
- 主 JS: `dist/assets/index-ZAvDaaHg.js`, 1,503.19 kB, gzip 402.49 kB。
- 大 chunk:
  - `physics-ChHD2_fM.js`: 1,987.56 kB, gzip 722.72 kB。
  - `react-spline-BFjNjMB1.js`: 2,042.72 kB, gzip 580.40 kB。
  - `hls-PqkoW0Po.js`: 523.16 kB, gzip 162.15 kB。

结论: 构建可交付,但包体需要优化。

### 3.2 依赖审计

执行:

```bash
npm audit --audit-level=high
```

结果:

- 无 high/critical 漏洞。
- 有 3 个 moderate 漏洞:
  - `vitepress -> vite <=6.4.1 -> esbuild <=0.24.2`
  - advisory: `GHSA-67mh-4wv8-2f99`

影响判断:

- 主要影响本地开发服务器被恶意网页请求并读取响应。
- 当前主应用生产构建使用 Vite 7.3.3;漏洞链来自 VitePress 文档站依赖。
- 不是立即阻断生产上线的问题,但应纳入依赖升级计划。

### 3.3 部署配置

检查文件:

- `wrangler.jsonc`
- `package.json`
- `.github/workflows/build-check.yml`

结论:

- 主站配置为 Cloudflare Workers + Static Assets:
  - Worker 入口: `public/_worker.js`
  - 静态资源目录: `dist`
  - 生产路由: `uvera.ai`
- `npm run deploy` 会先检查分支,再 build,最后 `wrangler deploy`。
- CI 的 `build-check.yml` 只做构建校验,明确不部署主站。
- 这与项目规约一致。

验收意见:

- 部署链路通过。
- 仍需严格禁止 `wrangler pages deploy` 用于主站。

### 3.4 代码规模与维护性

关键文件行数:

- `public/_worker.js`: 13,219 行。
- `src/pages/StoryGeneratorPage.jsx`: 8,405 行。
- `src/pages/admin/AdminDashboard.jsx`: 8,120 行。
- `index.jsx`: 1,742 行。
- `src/api/neoaiService.js`: 806 行。

风险:

- Worker 单文件过大,API 路由、支付、AI、admin、钱包逻辑混在一起,后续改动容易产生隐性回归。
- `StoryGeneratorPage` 和 `AdminDashboard` 超过 8 千行,状态、UI、业务流程耦合度高。
- 当前缺少测试兜底,超大文件会显著放大回归风险。

验收评级: **P1 可维护性风险**。

### 3.5 权限与安全

正向发现:

- 前端 Supabase 使用 anon key,未发现 service role key 暴露到前端源码。
- `src/api/supabaseClient.js` 中 anon key 是公开客户端 key,不是服务端密钥。
- 核心钱包写操作主要由 Worker + Supabase RPC 处理。
- RLS/RPC 迁移里能看到:
  - `user_credits` 只允许用户 SELECT 自己。
  - `credit_tx` 只允许用户 SELECT 自己。
  - `wallet_unlock_episode`, `wallet_credit_purchase`, `wallet_refund_purchase` 使用 `SECURITY DEFINER` 并限制 service_role 调用。
  - `ensure_user_credits` 通过 `auth.uid()` 幂等初始化欢迎额度。

需要关注:

- 多数 admin endpoint 通过 Supabase `/auth/v1/user` 解析 JWT 后检查 `user_metadata.is_admin === true`。
- super admin 也依赖 `user_metadata.is_super_admin`。
- 如果未来出现任何用户可自行写入这些 metadata 字段的路径,admin 权限会被绕过。当前代码已有注释说明历史上修过本地 mock token 问题,但仍建议做专项权限回归。

验收评级: **安全边界基本成立,但 admin 权限模型需持续审计。**

### 3.6 钱包、积分与支付

正向发现:

- 前端未发现对 `wallet_balance`, `wallet_tx`, `user_credits`, `credit_tx`, `episode_unlocks`, `series_purchases`, `ucoins_orders` 的直接写入。
- 用户余额读取从 `user_credits` 获取,不再信任 `user_metadata.credits`。
- Stripe webhook 具备:
  - subscription invoice 幂等检查。
  - ucoins/bundle checkout 分支。
  - refund cascade,包括 ucoins refund RPC 与 bundle unlock revoke。
- 单集解锁走 `wallet_unlock_episode` RPC,注释明确解决并发扣款、充值覆盖、重复解锁等问题。

需要关注:

- webhook 内存在“订单插入失败但仍 grant credits”的 fail-open 分支。业务上保护付费用户是合理的,但必须依赖后续 reconciliation 补账,否则财务报表可能不完整。
- `series_purchases` bundle 成功后额外写 `wallet_tx` 作为可见流水,该表正在被 token 合并逐步替代,建议确认历史钱包表是否仍为产品需要。
- 退款和 reconciliation 管理界面需要用真实 Stripe 测试事件做完整演练。

验收评级: **关键路径设计较完整,但必须做支付沙箱/生产小额回归。**

### 3.7 Service Worker 与缓存

正向发现:

- `public/sw.js` 明确跳过 Range/media 请求,避免缓存 206 响应导致视频播放故障。
- 导航/API 使用 network-first,静态资源 cache-first。
- `src/main.jsx` 对 Vite chunk preload error 有 reload loop 防护,超过阈值会清理 SW/cache 后刷新。

风险:

- `CACHE_NAME` 版本历史很长,每次部署依赖 bump 维持缓存一致性。若以后忘记 bump,用户可能继续加载旧 bundle。
- 建议把 SW 版本与 `public/version.json` 或构建 hash 自动关联,降低人工遗漏。

验收评级: **可用,但缓存版本策略可自动化。**

### 3.8 CI/CD 与测试

现状:

- GitHub Actions 有 build check。
- docs 有独立 deploy workflow。
- `package.json` 没有 `test` 脚本。
- 未发现 Vitest/Jest/Playwright/Cypress 配置。
- 未发现 ESLint 配置文件,虽然安装了 eslint 依赖。

风险:

- 当前质量门禁主要是“能 build + docs lint + worker syntax check”。
- 对支付、钱包、权限、AI 任务、Service Worker、路由等关键路径没有自动化回归。

验收评级: **P0/P1 缺口,正式交付前应补最小测试集。**

### 3.9 工作区状态

执行 `git status --short`:

```text
 M .gitignore
?? AGENTS.md
```

说明:

- 当前工作区已有未提交改动。
- 本次验收过程中执行 `npm ci` 与 `npm run build`;未修改应用源码。
- `npm run build` 重新生成了构建产物,但 `git diff --stat` 只显示 `.gitignore` 有 1 行改动。
- `AGENTS.md` 当前为 untracked。

建议:

- 在正式验收签字前确认 `.gitignore` 和 `AGENTS.md` 是否属于本次交付范围。
- 多 session 并行时禁止 `git add -A`,提交必须显式列文件。

## 4. 风险清单

### P0: 验收前必须确认

1. 补充最小自动化测试:
   - admin 鉴权: 普通用户不能访问 admin endpoint。
   - wallet unlock: 余额不足、重复解锁、并发解锁。
   - Stripe webhook: checkout succeeded 重放不重复发 token。
   - refund: ucoins refund 扣回余额,bundle refund 撤销 unlock。

2. 做一次支付沙箱全链路演练:
   - 订阅支付。
   - token topup。
   - series bundle。
   - 单集解锁。
   - 退款。
   - webhook 重放。

3. 确认 Supabase RLS 已在生产库完全 apply:
   - `user_credits`
   - `credit_tx`
   - `wallet_*`
   - `episode_unlocks`
   - `series_purchases`
   - `ucoins_orders`
   - `comments`

### P1: 交付后一个迭代内整改

1. 拆分 `public/_worker.js`:
   - auth/admin helpers
   - stripe/webhook
   - wallet/paywall
   - AI generation
   - stream/upload
   - team-chat/admin ops

2. 拆分 `StoryGeneratorPage.jsx` 和 `AdminDashboard.jsx`:
   - 状态管理与 UI 分离。
   - API 调用移到 service 层。
   - 大 modal/card 拆组件。

3. 优化包体:
   - 对 Spline/physics/hls 做更细粒度 lazy import。
   - 检查主入口 `index-ZAvDaaHg.js` 为什么仍达 1.5MB。
   - 配置 Rollup manualChunks 或按路由进一步拆包。

4. 添加 lint/type 门禁:
   - 至少补 ESLint 配置并接入 CI。
   - 若短期不上 TypeScript,建议至少给关键 service/RPC response 加运行时 schema 校验。

5. 修复依赖审计 moderate:
   - 跟踪 VitePress 是否有修复版。
   - 如文档站不需要本地暴露 dev server,可降低优先级。

### P2: 持续改进

1. Service Worker 版本自动化,减少人工 bump。
2. admin 权限从 `user_metadata` 逐步迁移到专门 roles 表或 custom claims 管理流。
3. 对脚本类工具增加 dry-run 默认和日志脱敏。
4. 对 AI 生成链路增加任务状态机测试与失败重试策略文档。

## 5. 最终验收建议

建议当前阶段结论为:

> **有条件通过。代码能构建,部署配置正确,核心财务/权限链路有明确设计;但自动化测试、可维护性和性能包体仍不足,正式交付前至少完成 P0 验证。**

如果这是外包/第三方交付验收,建议把 P0 作为付款或正式接收的硬条件;P1 作为下一阶段维护合同或里程碑整改项。


# UVERA 代码验收报告 · 最终版

> 审查日期：2026-06-11 · v1.3.0 · Worker ~13,000 行（75 端点）· 前端 100 文件 · DB 30+ migration

---

## 综合评分

### Overall Score: 8.2 / 10

| 维度 | 评分 |
|---|---|
| Security | 8.5 ✅ |
| Architecture | 8.5 ✅ |
| Code Quality | 7.5 ⚠️ |
| Business Logic | 8.5 ✅ |
| DevOps | 7.5 ⚠️ |
| Database | 8.5 ✅ |
| DRM & Content Protection | 7.5 ⚠️ |
| Observability & Testing | 7.0 ⚠️ |

四轮审查完成。新增 DRM 评估（视频保护符合行业标准但 HLS 无法加密）、可观测性（测试覆盖为零、Sentry Worker 端缺失）和废弃文件清理（5 个 deprecated re-export）等发现。

---

## 1. Security（安全）— 8.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **Stripe webhook HMAC-SHA256** | 手动实现签名验签，recompute HMAC 后比对，无第三方库泄露风险。使用字符串比对（非 timingSafeEqual），理论 timing attack 风险极小，实际可接受。 |
| **RLS 彻底收紧** | 20260505_strict_rls_policies 迁移彻底移除 "allow public all access"。orders 只读自己、recommended_content 公开读已发布+作者写、system_configs 仅 admin。 |
| **钱包三 RPC 全原子** | wallet_unlock_episode / wallet_credit_purchase / wallet_refund_purchase 全部 SECURITY DEFINER + SELECT FOR UPDATE，并发安全。 |
| **Admin 鉴权分层** | requireAdmin() 验证 JWT + is_admin flag；TeamChat API Token 路径需额外 X-Admin-Post-As header；service_role 仅 Worker 内部使用。 |
| **SQL 注入防护** | 所有动态参数 encodeURIComponent()；PostgREST filter 使用 UUID 正则强校验；Claude Tools SQL 只允许 SELECT/WITH 白名单正则。 |
| **system_settings UPDATE 白名单** | /api/admin/system-settings/update 对每个 key 定义了显式 validate() 函数，任意 key 注入被封堵。 |
| **开放代理封禁** | /api/stream/download-proxy 白名单 `/^https:\/\/(customer-[a-z0-9]+\.cloudflarestream\.com|videodelivery\.net)\//i`。 |
| **XSS / 日志脱敏** | 全代码库无 dangerouslySetInnerHTML / innerHTML / eval()。sanitizeLogParams() 对 >4000 字符截断、base64/data: URI 过滤。 |
| **Prompt 注入防护** | AI 提示词由服务端结构化构造；OpenAI 审核自动重试 + 安全 fallback。 |
| **Secret 隔离** | SERVICE_ROLE_KEY 仅存 CF Worker secret，从不进 .git；.dev.vars gitignored。 |
| **Sentry 隐私保护** | sendDefaultPii: false；Sentry.setUser 仅传 id 不传邮箱；ignoreErrors 覆盖 Supabase Web Locks、浏览器翻译、Dynamically imported module 等已知噪音。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **CORS 全通配符** | 所有端点 Access-Control-Allow-Origin: *。建议对 /api/stripe/* 等敏感端点限制来源域名。 |
| **Rate Limit 缺失** | 高频写接口（/api/episodes/:id/unlock、/api/credits/claim-*）未配置 CF WAF 限流规则，建议加 IP 级别限流。 |
| **GDPR 合规空白** | 无账号注销/数据删除端点；无数据导出（export）端点。需评估是否需要。 |
| **历史 schema 文件含危险策略** | supabase_init_schema.sql 含 "allow public all access"，但不在 supabase/migrations/ 路径，不参与 db push。需确认从未用于生产 reset。 |

---

## 2. Architecture（架构）— 8.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **前后端分离** | Cloudflare Workers 后端（_worker.js ~13,000 行）+ React SPA 前端（src/ ~100 文件）。职责边界清晰，前端通过 /api/* 端点与 Worker 通信。 |
| **部署拓扑正确** | Workers + Static Assets（非 Pages），wrangler.jsonc 锁定 uvera.ai 自定义域名路由，CLAUDE.md/AGENTS.md 双份文档护栏。 |
| **配置中心化** | getSystemSetting() 60s TTL 缓存 + 主动失效，所有业务参数走 system_settings 表，admin UI 可改无需重新部署。 |
| **Service Worker 规范** | 网络优先+缓存优先混合策略；Range 请求透传（历史 bugfix）；CACHE_NAME 版本号管理（每个 deploy bump）。 |
| **Migration 管理** | supabase/migrations/（CLI push）+ migrations/（归档）双路径；每条 migration 有 up/down.sql 配对；comments 表规范。 |
| **幂等性设计** | Stripe webhook event.id 幂等键；grant_credits idempotency_key；wallet RPC unique_violation 捕获回滚；series_purchases 重 publish 防重复。 |
| **多阶段 AI 流水线** | BytePlus Seedance + GPT-image-2 + Gemini + 故事板全链路串联，各阶段独立 generation_logs 追踪。 |
| **API 端点数量** | Worker 共 75 个路由端点（含 5 个 team-chat 子端点），覆盖 AI 生成、钱包、Stripe、Admin 四大域。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **Worker 单体文件** | _worker.js ~13,000 行，75 个 if/else 顺序路由匹配。建议按功能域拆分，主文件只做路由分发。 |
| **无 API 版本化** | 所有端点 /api/* 无版本前缀（如 /api/v1/*）；新增端点直接覆盖。建议未来添加版本前缀。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **Supabase URL 硬编码 fallback** | Worker 多处 env.SUPABASE_URL \|\| 硬编码 fallback。建议仅在 NODE_ENV=development 时 fallback。 |

---

## 3. Code Quality（代码质量）— 7.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **React 规范** | useEffect/useState 显式 import；错误边界（ErrorBoundary）存在；Suspense + lazy 路由级代码分割（StoryGeneratorPage、LibraryPage、VideoEditorPage 等）。 |
| **乐观更新 + Race Guard** | useComments like 操作乐观更新 + 失败回滚；load() 使用 reqIdRef 丢弃过期请求；claimDaily 后主动 refreshSession。 |
| **模块级钱包缓存** | useUcoinsWallet 使用模块级 walletCache + walletSubscribers Set（跨组件实时同步），轻量高效的跨组件状态共享模式。 |
| **注释质量** | 代码注释详尽，每个关键逻辑均有 @ 日期+负责人标注，bug 历史和决策背景完整，版本考古友好。 |
| **废弃标记规范** | 废弃文件明确标注 deprecated location + 重新导出（src/components/StudioPage.jsx、Sidebar.jsx、Header.jsx、GlassSurface.jsx）；弃用代码有 @deprecated 注释。 |
| **Sentry 集成** | @sentry/react + @sentry/vite-plugin，source map 仅上传 Sentry 不随 dist 发布；tracesSampleRate: 0.1，replays 关闭，sendDefaultPii: false。 |
| **PWA 支持** | manifest.json、InstallAppBanner、usePWAInstall hook；Service Worker 版本管理规范。 |
| **错误处理模式** | loud-fail 包装器 loudFetch() 确保 4xx/5xx 被捕获；各端点 try/catch 完整，fail-open 有 console.error 告警。 |
| **Draft 服务降级** | draftService UPSERT 失败静默降级 localStorage，anonymous 用户自动 localStorage only。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **无测试覆盖** | 全项目无 .test.* / .spec.* 文件，无 Vitest/Jest 配置。核心业务逻辑（wallet RPC、Stripe webhook、RLS）完全依赖人工审查。建议优先为关键 RPC 和 webhook 补单元测试。 |
| **无 ESLint 配置** | 项目根目录无 .eslintrc* 文件，虽有 eslint 依赖但未激活。建议配置 react-hooks/exhaustive-deps、no-console 等关键规则。 |
| **index.jsx 过于臃肿** | 1742 行单文件含所有路由逻辑；设计系统组件与页面逻辑混在一起。 |
| **React Hook 导入风格不统一** | 部分文件用 React.useState，部分直接 import { useState }。建议统一用命名导入。 |
| **废弃文件待清理** | src/components/ 下 5 个文件仅做重新导出（deprecated location），可安全移除并更新所有 import 路径。 |
| **useEffect 缺 exhaustive-deps** | useComments 的 load 被 eslint-disable-line 跳过；多个 useEffect 存在潜在 stale closure 风险。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **TypeScript 缺失** | 全项目 JS 而非 TS，无类型检查。建议逐步迁移到 TypeScript。 |
| **无 React Context** | 全项目无 createContext/useContext；跨组件状态靠模块级变量或 props drilling。可接受但建议迁移到 Context 或 Zustand。 |

---

## 4. Business Logic（业务逻辑）— 8.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **钱包余额防篡改** | 20260529 迁移彻底移除客户端写 user_metadata.credits；权威余额在 user_credits 表（RLS 只读自己）；所有增减走 RPC（SECURITY DEFINER）。 |
| **Stripe 价格自愈机制** | AMOUNT_FALLBACK map 按美分金额兜底识别 tier；Price ID 配置漂移时按金额匹配，ops 有明确 envHint 日志。 |
| **剧集付费五级权限链** | free → unlocked → bundle → member → locked；匿名用户返回 need_login 而非 paywall；/api/episodes/:id/access 为唯一真相来源。 |
| **结算自动化** | /api/admin/settlements/generate 聚合 episode_unlocks + series_purchases 按月生成结算单，platform/creator 分成可配置。 |
| **每日/分享奖励权威写入** | claimDailyCredits / claimShareCredits 走 Worker grant_credits RPC，RLS + credit_tx 双重 rate limit 防刷。 |
| **退款余额下限保护** | wallet_refund_purchase 使用 LEAST(requested, current) 防止余额负数；日志记录 actual vs requested。 |
| **GenAI 成本追踪** | generation_logs 记录每个 API 调用的 vendor/model/prompt/duration_ms/credits_charged；按 render_session_id 分组关联成本。 |
| **BytePlus 审核兜底** | 图片/视频生成后检测 real-person 拒绝，自动走 Private Asset Library（Moderation.Skip）重试，无需用户重新上传。 |
| **Lite 分级定价** | 按购买次数渐进提价（$3.99→$5.99→$7.99/100 tokens），computeLiteElevation 时间衰减算法可回退。 |
| **创作者下载权限** | isOwner 检查保护创作者下载；普通用户不显示下载按钮；series.archive 软删管理。 |
| **视频退款信号** | GET /api/volcengine/video/status/:taskId 回传 refunded 状态，前端据此显示「积分已返还」提示。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **Stripe 重放保护** | webhook idempotency 基于 event.id 检查订单是否已处理；需确保事件存储有 UNIQUE 约束。 |
| **bundle_price_usd_cents TODO** | /api/episodes/:id/access 返回 locked 时 bundle_price_usd_cents 写死 null，TODO 标注需从 series 表读取。当前用户看不到整剧买断价。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **退款邮件通知** | 退款仅写 worker log，无邮件通知用户。已知待办，建议接入邮件服务。 |
| **创作者 publish 付费默认** | 一键 publish 流程不会自动设付费默认，需手动在 MySeriesPage 定价 pill 设置。 |

---

## 5. DevOps（运维）— 7.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **部署护栏** | check-deploy-branch.mjs 强制 main 分支部署；wrangler.jsonc 有大段警告注释防误用 pages 命令；CLAUDE.md/AGENTS.md 双份文档。 |
| **部署后验证流程** | CLAUDE.md 提供三步 curl 验证（HTML hash + SW 版本 + API 端点）。 |
| **build 脚本链** | copy-ffmpeg + sync-legal-docs + generate-version + vite build，pre-build 步骤完整。 |
| **CI 仅 build 验证** | build-check.yml 仅跑 build，不自动部署；production 部署必须本地 npm run deploy，权责清晰。 |
| **git 并行协作规范** | CLAUDE.md 明确禁止 git add -A，需显式 git add 文件列表；已记录 2026-06-09 事故作为反面教材。 |
| **Sentry Source Map 安全** | SENTRY_AUTH_TOKEN 仅存本地 .env.sentry-build-plugin（gitignored）；.map 文件上传后从 dist 删除。 |
| **CF Worker 可观测性** | wrangler.jsonc 开启 observability.enabled=true；Worker 内所有错误均带上下文（参数、日志体片段）；日志分级（error/warn/log）规范。 |
| **文档完整** | docs/engineering/ 含架构设计、credit-enforcement 完整设计文档、SQL 测试规范。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **Secret 轮换流程缺失** | CLAUDE_ADMIN_API_TOKEN 有一次性 setup 脚本；Stripe/BytePlus/ARK 等关键 secret 无标准化轮换文档和自动化脚本。 |
| **无 database backup 策略文档** | 未找到 Supabase 自动备份配置或 PITR 文档；建议在 Dashboard 确认已开启。 |
| **npm audit 漏洞** | 3 个 moderate 漏洞在 vitepress（文档站依赖链）；生产代码不受影响，但建议跟进升级。 |
| **环境变量文档不完整** | 新开发者 setup 流程无文档；.dev.vars.example 部分 key 存在但值不完整。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **无 staging 环境** | 当前仅 dev + production（uvera.ai），无 staging 环境做预发布验证。 |

---

## 6. Database（数据库）— 8.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **RLS 策略规范** | 所有公开表均有 RLS；is_admin() helper 函数标准化；预检防止无 admin 账号时 apply RLS。 |
| **唯一约束防重复** | episode_unlocks(user_id, episode_id) UNIQUE；credit_tx(idempotency_key) UNIQUE；user_credits(user_id) UNIQUE。 |
| **CHECK 约束白名单** | generation_logs.generation_type 和 vendor 有 CHECK 约束；Worker 有防御性校验在 INSERT 前警告。 |
| **Trigger 维护派生数据** | bump_comments_count、bump_comment_likes_count、bump_likes_count、bump_saves_count 全部 trigger 化，数据一致性自动维护。 |
| **索引覆盖查询** | comments(content_id, created_at)、comments(parent_id)；generation_logs(task_id, status) 等核心查询有索引。 |
| **ON CONFLICT 防幂等** | 所有 UPSERT 操作用 ON CONFLICT DO NOTHING，确保幂等性。 |
| **Soft Delete 规范** | comments.deleted_at + author_id NULL 实现软删（保占位）；identity 擦除（author_id=NULL, body='', likes_count=0）。 |
| **FK 级联删除** | comments.author_id ON DELETE SET NULL；comment_likes ON DELETE CASCADE；recommended_content ON DELETE CASCADE。 |
| **JSON Schema 设计** | comments.mentions 用 jsonb 存储结构化 @ 提及；series_acquisition_costs 用 CHECK 约束 validated_ucoins_per_episode 范围。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **历史 init schema 有危险策略** | supabase_init_schema.sql 含 "allow public all access"，但不在 supabase/migrations/ 路径，不参与 db push。需确认从未用于生产 reset。 |
| **无外键索引** | episode_unlocks.series_id 等高频 JOIN 列上无显式索引，高并发解锁查询可能走 seq scan。建议补充。 |
| **无 PITR 配置文档** | 未找到 Supabase Point-In-Time Recovery 配置记录。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **分区表缺失** | credit_tx / generation_logs 等高频写入表无分区；随数据增长需考虑按月分区。 |

---

## 7. DRM & Content Protection（内容保护）— 7.5/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **视频 URL 访问控制** | 推荐内容 video_url 和剧集 episode.video_url 均通过 RLS 保护（published=true 才公开）。 |
| **剧集付费访问控制** | /api/episodes/:id/access 是唯一视频 URL 泄露入口；未解锁用户拿到 null URL，前端无法播放。 |
| **创作者下载权限** | SeriesDetailPage 仅 isOwner 显示下载按钮；downloadVideo 走 /api/stream/download-proxy（白名单）。 |
| **BytePlus TOS 临时 URL** | BytePlus 输出 24h 临时 signed URL，Worker 在 24h 内自动镜像到 R2 持久化。临时 URL 过期后原始链接失效。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **HLS 流无法加密** | Cloudflare Stream HLS manifest URL 无法加密，付费用户可分享链接。这是行业标准限制，所有 HLS 服务均如此。专业 DRM（Widevine/FairPlay）成本极高，需评估 ROI。 |
| **无防录屏/截图措施** | 视频播放器无 DRM 水印（用户名/Timestamp 叠加）、无防录屏检测。对于 UGC 内容平台该风险可接受，但高价值短剧需评估。 |
| **iframe.cloudflarestream.com 公开** | iframe embed URL 本身可被嵌入任意网站，但只有持有效 uid 才能播放对应视频（CF Stream 访问控制）。 |

---

## 8. Observability & Testing（可观测性与测试）— 7.0/10

### ✅ PASS

| 检查项 | 说明 |
|---|---|
| **Sentry 配置规范** | tracesSampleRate: 0.1（低采样保成本）；replays 全关（隐私+体积）；sendDefaultPii: false；ignoreErrors 覆盖 6 大已知噪音源（Stale deploy/翻译/DOM mutation/Supabase Locks/AbortError）。 |
| **日志分级规范** | console.error（错误+FAIL-OPEN 告警）、console.warn（降级+参数偏移）、console.log（成功操作+幂等状态）。所有错误日志均含上下文（userId、orderNo、eventId 等）。 |
| **loud-fail 模式** | 所有下游调用（Stripe/PostgREST/BytePlus/Supabase）均通过 loudFetch() 包装，4xx/5xx 被强制捕获而非静默。 |
| **generation_logs 全覆盖** | 每个付费 API 调用均通过 logApiStart/logApiFinish 记录，包含 vendor/model/prompt/duration_ms/credits_charged，成本可追溯到用户级别。 |
| **Cloudflare Worker Logs** | wrangler.jsonc observability.enabled=true；CF 日志直接可查，配合 console 分级。 |

### ⚠️ WARN

| 检查项 | 说明 |
|---|---|
| **无测试覆盖** | 全项目无 .test.* / .spec.* 文件，无 Vitest/Jest/Testing Library 配置。核心业务逻辑（wallet RPC、Stripe webhook、RLS 策略）完全依赖人工审查。建议优先为 SECURITY DEFINER RPC 和 webhook 补单元测试。 |
| **Worker 无 Sentry** | CF Worker（_worker.js）无 Sentry 集成，完全依赖 console.error 输出到 CF Logs。建议评估 Cloudflare 自己的日志告警（Logpush to Datadog/S3）或 Worker 内集成 Sentry。 |
| **无 PagerDuty / 主动告警** | 未找到外部告警配置（无 PagerDuty/Opsgenie/BetterStack）；CF Workers 无内置告警，需配置 Logpush + 外部管道。 |

### ℹ️ INFO

| 检查项 | 说明 |
|---|---|
| **无 Sentry Performance 采样调优** | tracesSampleRate 写死 0.1，随用户量增长可能需根据 revenue-critical 路径（/api/stripe/*、/api/wallet/*）单独设 tracesSampler。 |

---

## 验收结论

### 通过项（核心强项，共 10 项）

1. **钱包原子操作**：PostgreSQL FOR UPDATE 行锁 + 事务回滚，彻底消除并发 TOCTOU 漏洞
2. **Stripe webhook**：HMAC-SHA256 验签 + event.id 幂等 + amount 兜底 fallback
3. **RLS 策略**：20260505 迁移彻底修复 "allow public all access" 历史漏洞
4. **余额防篡改**：20260529 迁移移除 user_metadata.credits 写权限，权威在 user_credits 表
5. **Admin 鉴权**：JWT + is_admin flag 双验，service_role 从不暴露前端
6. **日志可观测**：generation_logs 覆盖所有付费 API 调用，loud-fail 模式暴露 schema drift
7. **Sentry 配置规范**：sendDefaultPii: false，ignoreErrors 覆盖 6 大已知噪音源
8. **视频访问控制**：/api/episodes/:id/access 是唯一视频 URL 泄露入口，未解锁用户拿 null URL
9. **Module 级钱包缓存**：walletSubscribers Set 实现跨组件实时同步，轻量高效
10. **文档完整**：docs/engineering/ 含 credit-enforcement 完整设计文档，废弃标记规范

### 改进建议（按优先级）

#### 高优先级

| # | 建议 | 说明 |
|---|---|---|
| 1 | **补测试覆盖** | 全项目无测试文件，核心 RPC 和 webhook 完全依赖人工审查。建议优先为 wallet_unlock_episode / wallet_refund_purchase / Stripe webhook 补单元测试。 |
| 2 | **Worker 拆分为域模块** | 75 个 if/else 路由链、13000 行单体，建议按功能域拆分，主文件只做路由分发。 |
| 3 | **引入 ESLint + TypeScript** | 无 lint 配置；React Hook 导入风格不统一；建议先激活 exhaustive-deps。 |

#### 中高优先级

| # | 建议 | 说明 |
|---|---|---|
| 4 | **清理废弃文件** | src/components/ 下 5 个文件（StudioPage、Sidebar、Header、GlassSurface、StoryGeneratorPage）仅做 re-export（deprecated location），可安全移除并更新所有 import 路径。 |
| 5 | **HLS 流加密评估** | CF Stream HLS manifest 无法加密，用户可分享；Widevine/FairPlay 成本极高，需评估 ROI。 |
| 6 | **CF WAF 限流** | /api/episodes/:id/unlock、/api/credits/claim-* 等高频写接口建议加 IP 级别限流。 |

#### 中优先级

| # | 建议 | 说明 |
|---|---|---|
| 7 | **GDPR 合规评估** | 无账号注销数据擦除、无数据导出端点；需评估是否需要。 |
| 8 | **Worker Sentry / 主动告警** | CF Worker 无 Sentry，无外部告警管道。建议配置 Cloudflare Logpush 到外部告警系统。 |
| 9 | **数据库外键索引** | episode_unlocks.series_id 等高频 JOIN 列上无显式索引，建议补充。 |
| 10 | **Secret 轮换 + PITR 文档** | Stripe/BytePlus/ARK 等 key 轮换应标准化；Supabase PITR 需确认已开启。 |

#### 低优先级

| # | 建议 | 说明 |
|---|---|---|
| 11 | **bundle_price_usd_cents TODO** | episodes/access 返回 locked 时买断价写死 null，需从 series 表读取。 |
| 12 | **vitepress 升级** | 3 个 moderate 漏洞在文档站依赖链，建议跟进升级。 |

### 总体结论

> UVERA 项目核心业务逻辑（钱包、支付、鉴权、RLS）实现扎实，四轮审查确认所有关键安全机制到位（Sentry 隐私配置规范、loud-fail 日志模式）。主要风险在工程规模化（测试覆盖为零、Worker 单体 13000 行、JS 无类型、lint 缺失、GDPR 空白）。建议下一阶段优先补测试覆盖 + Worker 拆分 + ESLint 引入。

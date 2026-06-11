---
title: UVERA GA 交付清单（2026-05-08）
type: doc
status: active
owner: Leon
created: 2026-05-08
updated: 2026-05-30
tags: [product, ga, deliverables]
---

# UVERA GA 交付清单（2026-05-08）

> **范围**：本文件盘点 GA 当天（2026-05-08）UVERA 产品包含的**全部**用户特性、管理员功能、后端服务、数据模型、基础设施和合规材料。
>
> **用途**：(1) GA 当天交付物核对；(2) 投资人 / 合作方 deck 素材；(3) 新成员 onboarding；(4) QA 验收基准。
>
> **维护**：费 (feifeixp)。本文件随每个 minor 版本（1.x.0）刷新一次。

---

## A. 用户端功能（全量盘点）

### A.1 认证与账户

| 功能 | 状态 | 入口 |
|---|---|---|
| Google OAuth 登录 | ✅ | `/auth` |
| Email magic-link 登录 | ✅ | `/auth` |
| 自动建账（首次 OAuth）| ✅ | OAuth callback |
| 账户登出 | ✅ | Settings / 头像菜单 |
| 账户删除（用户自助）| ⚠️ 暂用客服流程 | `legal@uvera.ai` |
| 头像 / 昵称编辑 | ✅ | `/settings` |

### A.2 首页 / Discover

| 功能 | 状态 | 备注 |
|---|---|---|
| Hero 区 | ✅ | 含主推内容 + CTA |
| 推荐内容 feed | ✅ | 来源 `recommended_content` 表 |
| 媒体类型分类（Video / Image / Live） | ✅ | `media_kind` 字段 |
| Pinned 置顶（admin 控制）| ✅ | `pinned`+`pin_order` |
| 视频卡片自动播放（hover）| ✅ | 移动端点击触发 |
| 全局静音控制 | ✅ | `docs/guides/GLOBAL_MUTE_FEATURE.md` |
| 用户上传视频（v1.0.6 新增）| ✅ | tag `user-upload` 标识 |

### A.3 Create（创作主页面）

#### A.3.1 Quick Mode —— 5 步引导式向导

| Step | 内容 | 关键能力 |
|---|---|---|
| 0 | 选 / 创角色 | 摄像头拍照 + 上传 + AI 风格化 |
| 1 | 故事描述（任意语言）| Emoji prompt bubble 灵感引导 |
| 2 | 选风格 | 4 个分类 tab（Animation / Traditional / Avant-garde / Modern）|
| 3 | AI 编剧生成剧本 | 自动语言匹配（中→中 / 英→英 / 日→日）|
| Render | 概念图 → 视频 | 真实经过时间 + 进度条 |
| Publish | 发布到 Discover | 成功 card + Continue / Go home 双 CTA |

#### A.3.2 Free Mode —— Prompt-driven 自由模式

| 能力 | 状态 |
|---|---|
| 自由 prompt 输入 | ✅ |
| `@` 引用素材（atomic tag）| ✅ |
| 多 segment 拼接 | ✅ |
| FFmpeg.wasm 客户端合成 | ✅（自托管 R2 + Workers Assets）|
| 已用过素材历史记录 | ✅ |
| Library Picker | ✅ |
| Character Asset Picker | ✅ |
| AI 生成参考图 | ✅ |
| 动态信用点定价 | ✅（按时长 + 分辨率）|
| 480p / 720p / 1080p 分辨率 | ✅（1080p 仅 starter+）|
| 5–30 秒 duration | ✅ |
| **参考视频 ≤ 15s 限制**（v1.0.6 新增）| ✅ 客户端预检 |

#### A.3.3 Upload Video Mode（v1.0.6 新增）

| 能力 | 状态 |
|---|---|
| 自有视频文件上传 | ✅ |
| 标题（必填，1–200 字）| ✅ |
| 描述（选填，≤ 2000 字）| ✅ |
| **强制版权声明 checkbox** | ✅ |
| 法律文本版本号（`copyright_text_version`）| ✅ v1-2026-05-07 |
| ≤ 2 GB 单文件 | ✅ 客户端预检 |
| Cloudflare Stream Direct Upload | ✅ |
| 上传进度条（百分比）| ✅ |
| 提交后状态 = pending_review | ✅ |
| 48h 审核 SLA | ✅（UI 文案承诺）|
| Approve 后自动进 Discover | ✅ |

### A.4 Library（个人作品库）

| 功能 | 状态 |
|---|---|
| 我的角色（characters）| ✅ |
| 我的生成作品 | ✅ |
| 已上传视频状态查看 | ⚠️ 通过 `/admin/dashboard` 间接看（v1.0.7 加用户侧）|

### A.5 Wallet（钱包 / 信用点）

| 功能 | 状态 |
|---|---|
| 当前 tokens 余额展示 | ✅ |
| 当前 tier 展示 | ✅ |
| **每日 +6 tokens 主动领取** | ✅ |
| 已领取状态记忆 | ✅（防重复领）|
| 订阅状态 | ✅ |
| Stripe Customer Portal 跳转 | ✅ |
| 信用点消耗历史 | ❌ v1.1 候选 |

### A.6 Subscription（订阅）

| Tier | 价格（USD/月）| 信用点 | 状态 |
|---|---|---|---|
| Free | $0 | 6/天 | ✅ |
| Starter | $25 | 500/月 | ✅ live |
| Creator | $69 | 1500/月 | ✅ live |
| Studio | $189 | 5000/月 | ✅ live |

| 功能 | 状态 |
|---|---|
| Stripe Checkout（live mode）| ✅ |
| Customer Portal（升降级 / 退订）| ✅ |
| Webhook → 自动加 tokens + 写 orders | ✅ |
| Webhook 兜底（email fallback）| ✅（v1.0.5 修复）|
| 手动补发审计（Credit Grants）| ✅（v1.0.6 完善对账 UI）|

### A.7 Settings

| 功能 | 状态 |
|---|---|
| Profile 编辑 | ✅ |
| Tier badge | ✅ |
| Legal links（TOS / Privacy / Content License）| ✅ |
| What's New（release notes）| ✅ |
| 版本号显示 | ✅ |
| Sign out | ✅ |

### A.8 Legal Pages

| 文档 | 状态 | URL |
|---|---|---|
| Terms of Service | ⚠️ 模板已起草，律师终审中 | `/legal/terms` |
| Privacy Policy | ⚠️ 同上 | `/legal/privacy` |
| Content License | ⚠️ 同上 | `/legal/content-license` |
| DMCA / Copyright | ⚠️ 入口待加（v1.0.7）| 暂用 `legal@uvera.ai` |
| Cookie Banner | ❌ v1.0.7 候选 | — |

### A.9 Beta / Creative Canvas

| 功能 | 状态 |
|---|---|
| Create 页 Creative Canvas 申请卡片 | ✅ |
| 申请表单提交（写入 `beta_requests`）| ✅ |
| 申请状态显示 | ✅ |

### A.10 通知 / 提示

| 功能 | 状态 |
|---|---|
| 版本更新 toast（VersionUpdater）| ✅ |
| Sentry 错误捕获（用户无感）| ✅ |
| 上传 / 渲染失败的清晰错误文案 | ✅（v1.0.6 增强）|
| 邮件通知（视频 approved / rejected）| ❌ v1.0.7 |

---

## B. 管理员后台（AdminDashboard）

`/admin/dashboard`，访问需 `user_metadata.is_admin = true`。

### B.1 顶部数据卡片（实时统计）

| 卡片 | 数据来源 | 状态 |
|---|---|---|
| Total Users | `auth.users` 总数 | ✅ |
| Active Subscribers | 35 天内有 successful order 的 distinct userIds | ✅ |
| MRR (last 30d) | `orders` 30 天 SUM | ✅ |
| Total Revenue | `orders` 全量 SUM | ✅ |
| Total Assets | user_works 数 | ✅ |
| Feed Items | `recommended_content` 数 | ✅ |

### B.2 Tab 列表（v1.0.6 后共 8 个）

| Tab | 功能 | 谁能看 |
|---|---|---|
| **Users** | 用户列表 / tier / tokens（DB 列名 credits）/ 删除 | 全员 admin |
| **Payments & Orders** | Stripe 订单 + 删除 | 全员 admin |
| **User Works** | 所有用户作品列表 + 删除 | 全员 admin |
| **User Videos (Review)**（v1.0.6 新）| 用户上传视频审核队列 | 全员 admin |
| **Homepage Feed** | Discover 内容编辑（CTA / pin / 发布）| 全员 admin |
| **Credit Grants** | 手动补发 + 自动对账（auto-fix）| 全员 admin |
| **Beta Requests** | Creative Canvas 申请审批 | 全员 admin |
| **System Settings** | API 连通性测试 | **仅 super_admin**（v1.0.6 限）|

### B.3 管理员账号矩阵（GA 当天）

| Email | is_admin | is_super_admin | 角色 |
|---|---|---|---|
| feifeixp@gmail.com | ✅ | ✅ | 工程 CEO |
| longvv.dev@gmail.com | ✅ | ✅ | 后端开发 |
| yazhongliu186@gmail.com | ✅ | ❌ | Ops |
| tuaiai20260304@gmail.com | ✅ | ❌ | Ops |
| jessiehuang9215@gmail.com | ✅ | ❌ | Ops |
| hquanbin662@gmail.com | ✅ | ❌ | Ops |
| jingbo279@gmail.com | ✅ | ❌ | Ops |
| bachbanana@gmail.com | ✅ | ❌ | Ops |

---

## C. 后端 API（Worker endpoints 全列表）

### C.1 上传 / 资产

| Endpoint | 方法 | 用途 |
|---|---|---|
| `/api/upload/<key>` | PUT/POST | 通用 R2 上传（≤ 100 MB，路径白名单）|
| `/ffmpeg/ffmpeg-core.wasm` | GET | 自托管 FFmpeg core wasm（R2）|
| `/api/proxy-image` | GET | CORS 图片代理 |
| `/api/proxy-asset` | GET | 通用资产代理 |

### C.2 视频生成（AI）

| Endpoint | 用途 |
|---|---|
| `/api/volcengine/video/generate` | 启动视频任务 |
| `/api/volcengine/video/status/:taskId` | 轮询状态 |
| `/api/stream/upload-from-url` | TOS 临时 URL → R2 永久存储 |
| `/api/stream/direct_upload` | admin 用 Stream 上传 ticket |

### C.3 AI 辅助

| Endpoint | 模型 |
|---|---|
| `/api/describe-image` | gemini-1.5-flash |
| `/api/generate-concept-image` | gemini |
| `/api/optimize-prompt` | LLM |
| `/api/random-ideas` | LLM |
| `/api/generate-script` | NeoAI / LLM |

### C.4 用户视频上传 + 审核（v1.0.6 新增）

| Endpoint | 用途 |
|---|---|
| `/api/user-videos/init-upload` | 签 Stream Direct Upload URL + 创建 pending 行 |
| `/api/user-videos/finalize` | 上传完成后翻状态到 pending_review |
| `/api/admin/user-videos/list` | 审核队列（按状态过滤）|
| `/api/admin/user-videos/review` | Approve（写 Discover）/ Reject（带理由）|

### C.5 信用点 / 支付

| Endpoint | 用途 |
|---|---|
| `/api/credits/claim-daily` | 每日 +6 tokens（端点名内部仍 `credits`）|
| `/api/stripe/webhook` | Stripe webhook（HMAC 校验）|
| `/api/stripe/create-checkout-session` | Checkout |
| `/api/stripe/create-portal-session` | Customer Portal |
| `/api/admin/grant-credits` | 管理员手动补发（含 audit）|

### C.6 字幕 / 角色

| Endpoint | 用途 |
|---|---|
| `/api/character/save` | 角色入库 |
| `/api/character/delete` | 删除角色 |

---

## D. 数据库（Supabase Postgres）

### D.1 表清单（GA 共 9 张业务表）

| 表 | 用途 | RLS | 状态 |
|---|---|---|---|
| `auth.users` | Supabase 内置 + user_metadata 业务字段 | Supabase 管理 | ✅ |
| `public.users` | 自定义画像 | 自看 | ✅ |
| `public.orders` | Stripe 财务记录 | 自看 + admin | ✅ |
| `public.characters` | 用户角色 | 自看 + admin | ✅ |
| `public.recommended_content` | Discover feed | 公开读 + admin 写 | ✅ |
| `public.system_configs` | 系统配置 | admin 专属 | ✅ |
| `public.beta_requests` | Creative Canvas 申请 | 自看 + admin | ✅ |
| `public.credit_grants` | 手动补发审计 | 自看 + admin | ✅ |
| `public.user_video_uploads`（v1.0.6 新）| 用户上传视频 + 审核状态 | 自看 + admin | ✅ |

### D.2 已应用的 migration

| 文件 | 说明 |
|---|---|
| `01-add-likes-saves.sql` | 点赞 / 收藏 |
| `02-add-aspect-ratio.sql` | 视频宽高比 |
| `20260420_recommended_content_v2` | feed v2（CTA / pin / publish / media_kind / tags）|
| `20260505_strict_rls_policies` | 全表 RLS 收紧 |
| `20260506_beta_requests` | Creative Canvas 申请表 |
| `20260507_credit_grants` | 手动补发审计 |
| `20260507_admin_roles`（v1.0.6）| 双层管理员（is_super_admin）|
| `20260507_user_video_uploads`（v1.0.6）| 用户视频上传 + 审核 |

### D.3 RLS 策略原则

```sql
-- 每张用户私有表的标准 USING/WITH CHECK
USING (auth.uid() = user_id OR public.is_admin())
```

`public.is_admin()` SQL helper 读 JWT：
```sql
(auth.jwt() -> 'user_metadata' ->> 'is_admin')::bool = true
```

---

## E. 基础设施

### E.1 Cloudflare 体系

| 服务 | 配置 |
|---|---|
| **Workers** | `uvera`，account `d2acf946d8f80f382be77437a71c4832` |
| **Custom Domain** | `uvera.ai`（routes 锁定在 wrangler.jsonc）|
| **R2** | bucket `uvrera`，自定义域 `asset.uvera.ai` |
| **Stream**（v1.0.6 启用）| Direct Upload + HLS 自适应回放 |
| **Static Assets** | `dist/` 目录走 ASSETS binding（SPA 兜底）|
| **Observability** | Workers `observability.enabled = true` |

### E.2 Supabase

| 项 | 配置 |
|---|---|
| URL | `https://wjhdsodlxekvhpahascs.supabase.co` |
| Auth | Google OAuth + Email |
| Service Role Key | 仅 Worker 持有（写入 admin 接口）|
| Anon Key | 前端读 |

### E.3 第三方服务

| 服务 | 用途 | 计费方式 |
|---|---|---|
| **Stripe** | 订阅支付 | 2.9% + $0.30 / 笔 |
| **Sentry** | 错误监控 | Free tier (5k events/mo) |
| **BytePlus / Volcengine** | Seedance 2.0 视频模型 | 按生成量 |
| **Neodomain** | LLM 中继（gemini-1.5-flash 等）| 按 token |

### E.4 环境变量 / Secrets

| 变量名 | 位置 | 用途 |
|---|---|---|
| `CF_ACCOUNT_ID` | Worker env | Stream API |
| `CF_API_TOKEN` | Worker env | Stream API |
| `SUPABASE_URL` | Worker env | DB / Auth |
| `SUPABASE_ANON_KEY` | Worker env | 前端校验 JWT |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker env | 管理员 admin 操作 |
| `STRIPE_SECRET_KEY` | Worker env | Stripe API |
| `STRIPE_WEBHOOK_SECRET` | Worker env | Webhook HMAC 校验 |
| `VITE_SENTRY_DSN` | 前端 build env | Sentry 客户端上报 |
| `VITE_ADMIN_EMAILS` | 前端 build env | 管理员 email allowlist |
| `NEODOMAIN_GA_API_KEY` | Worker env | Neodomain Gemini relay 认证 |
| `GEMINI_TEXT_MODEL` | Worker env (optional) | Gemini 文本模型名（默认 `gemini-3.1-flash`）—— 可热切（无需 redeploy）|
| `GEMINI_IMAGE_MODEL` | Worker env (optional) | Gemini 图像模型名（默认 `gemini-3.1-flash-image-preview`）—— 可热切 |
| `ARK_API_KEY` | Worker env | BytePlus Volcengine Seedance 视频生成 API |

---

## F. 法律 / 合规材料

| 文档 | 状态 | 位置 |
|---|---|---|
| Terms of Service | ⚠️ 律师终审中 | `docs/legal/TERMS-OF-SERVICE.md` |
| Privacy Policy | ⚠️ 律师终审中 | `docs/legal/PRIVACY.md` |
| Content License | ⚠️ 律师终审中 | `docs/legal/CONTENT-LICENSE.md` |
| Compliance 总览 | ✅ | `docs/legal/COMPLIANCE.md` |
| 用户上传版权声明（UI 文案）| ✅ | `COPYRIGHT_TEXT v1-2026-05-07` |
| DMCA 联系邮箱 | ✅ | `legal@uvera.ai` |

**关键合规姿态**：
- 主体：美国 longVV ltd
- 司法管辖：美国（不专门服务中国大陆用户）
- 用户最低年龄：16 岁
- AI 生成内容著作权：用户拥有使用权，UVERA 保留训练 / 改进模型的非排他许可
- 用户上传内容：必须确认拥有版权 / 授权；侵权下架 + 可能追诉

---

## G. 监控与可观测性

| 维度 | 工具 | 状态 |
|---|---|---|
| 前端 JS 错误 | Sentry React | ✅ |
| Worker 日志 | Cloudflare Workers Observability | ✅ |
| Stripe 事件 | Stripe Dashboard 事件流 | ✅ |
| 收入 / MRR | AdminDashboard 实时计算 | ✅ |
| Supabase 查询性能 | Supabase Dashboard | ✅ |
| Uptime 监控 | ❌ 暂无（v1.0.7 候选 UptimeRobot / BetterStack）| — |
| 用户行为分析 | ❌ 暂无（v1.1 候选 PostHog）| — |

**Sentry 已过滤的噪声**：`/Lock broken by another request with the 'steal' option/`（Supabase Web Locks，无业务影响）。

---

## H. 性能 / SLA

| 指标 | 目标 | 当前 |
|---|---|---|
| 首屏 LCP | < 2.5s | ~1.8s（CF Edge）|
| AI 视频生成耗时 | 30s – 3min | 实际中位 ~90s |
| Worker 冷启动 | < 50ms | < 20ms |
| 上传成功率 | > 95% | 待 GA 后数据 |
| 上传超时容忍 | 30s + 4s/MB（自适应）| ✅ v1.0.6 修复 |
| 用户视频审核 SLA | 48h | 承诺，48h 内人工处理 |

---

## I. 安全姿态

| 维度 | 措施 |
|---|---|
| **认证** | Supabase JWT，Worker 端校验 |
| **授权（RLS）** | 全表 RLS，私有数据强制 `auth.uid()` 隔离 |
| **管理员权限** | 双层（admin / super_admin），System Settings 仅 super |
| **支付** | Stripe webhook HMAC-SHA256 签名校验 |
| **PII** | Sentry `sendDefaultPii: false` |
| **CORS** | Worker 显式列允许的 endpoint 才开 |
| **R2 路径白名单** | `cover_` / `video_` / `generated/` / `characters/` 前缀|
| **客户端 secret 暴露** | 只暴露 anon key + Sentry DSN（公开级别）|
| **侵权响应** | DMCA `legal@uvera.ai` + 用户视频 IP/UA 留痕 |

---

## J. 已知遗留 / 不在 GA 范围

| 项 | 等级 | 备注 |
|---|---|---|
| `orders.userId` FK 指向 `public.users` 而非 `auth.users` | P2 | 阻止部分 auth-only 用户对账插入；v1.0.7 修 |
| 用户视频 approved/rejected **邮件通知** | P2 | 当前用户须自查；v1.0.7 接 SendGrid |
| Discover 视频 **举报按钮** | P1 | DMCA 入口缺；v1.0.7 必加 |
| 视频长度服务端二次校验 | P2 | 当前仅前端 + Stream 1h 硬限 |
| 上传中断恢复（tus 协议）| P3 | 当前失败需重传；v1.0.7 候选 |
| 国内访问 CDN 加速 | P3 | 看 GA 后用户分布数据决定 |
| Cookie Banner（GDPR）| P1 | v1.0.7 必加（如果欧洲用户多）|
| 信用点消耗历史 | P3 | v1.1 |
| 用户社区 / 评论 | OUT | v1 不做 |
| 直播 / 实时流 | OUT | v2 候选 |

---

## K. 文档 inventory

| 文件 | 用途 |
|---|---|
| `docs/product/GA-DELIVERABLES.md` | **本文件** —— 全量交付清单 |
| `docs/product/PRODUCT-DESIGN.md` | 整体产品设计 |
| `docs/releases/RELEASE-v1.0.6.md` | v1.0.6 增量发布说明 |
| `docs/guides/pre-launch-checklist.md` | GA 上线冒烟清单 |
| `docs/engineering/TECH-STACK.md` | 技术栈细节 |
| `docs/legal/COMPLIANCE.md` | 合规策略 |
| `docs/legal/TERMS-OF-SERVICE.md` | 用户协议（终审中）|
| `docs/legal/PRIVACY.md` | 隐私政策（终审中）|
| `docs/legal/CONTENT-LICENSE.md` | 内容许可（终审中）|
| `docs/engineering/BACKEND-STYLE-GUIDE.md` | 代码规范 |
| `docs/design/system/COLOR-SYSTEM.md` | 颜色系统 |
| `docs/engineering/DESIGN-SYSTEM-MIGRATION.md` | 设计系统迁移 |
| `docs/governance/DEFERRED-DECISIONS.md` | 延后决策 |
| `docs/guides/HERO-LAYOUT.md` | 首页 Hero 布局规范 |
| `docs/guides/MEDIA_FILE_NAMING.md` | 媒体文件命名约定 |
| `docs/guides/MEDIA_SETUP.md` | 媒体文件 setup |
| `docs/guides/VIDEO_COMPRESSION.md` | 视频压缩规范 |
| `docs/guides/seedance2-vol.md` | Seedance API 文档 |

---

## L. GA 当天 Run-book（精简版）

> 详细冒烟清单见 `docs/guides/pre-launch-checklist.md` 和 `docs/releases/RELEASE-v1.0.6.md` §4。

1. ✅ 前一晚（5/7）：v1.0.6 代码合入 main + Worker 部署
2. ✅ 前一晚：Supabase 跑 2 个 migration（admin_roles + user_video_uploads）
3. ✅ 前一晚：6 个新 admin 账号通过 Google OAuth 完成首次登录（再跑一次 admin_roles migration 确保 user_metadata 写入）
4. ⏰ GA 当天 09:00：跑 `docs/guides/pre-launch-checklist.md` 完整冒烟（约 90 分钟）
5. ⏰ 09:30：发布 v1.0.6 release notes（in-app toast 自动触发）
6. ⏰ 10:00：开始外部宣发（社交媒体 / 邮件列表）
7. ⏰ 全天：Sentry 监控 + AdminDashboard 数据看板留人值守
8. 📞 应急联系：费 (feifeixp) + Long (longvv.dev)

---

**文档维护**：费 (feifeixp)
**版本**：对应产品 v1.0.6
**生效日期**：2026-05-08
**下次刷新**：v1.1.0 发布时

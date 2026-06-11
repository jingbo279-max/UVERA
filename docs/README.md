# 📚 文档索引

> 🤖 本文件由 `npm run docs:index` 自动生成,**请勿手改**。标准见 [CONVENTIONS.md](./CONVENTIONS.md)。
> 最后生成:2026-05-30

## 🎬 Product — 产品

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [UVERA GA 交付清单（2026-05-08）](./product/GA-DELIVERABLES.md) | 🟢 active | Leon | 2026-05-30 |
| [Uvera Subscription Plans & Token Top-ups — Source of Truth](./product/PLANS.md) | 🟢 active | Leon | 2026-05-13 |
| [UVERA 产品设计文档（GA 版）](./product/PRODUCT-DESIGN.md) | 🟢 active | Leon | 2026-05-08 |
| [UVERA 产品详细描述](./product/PRODUCT-NARRATIVE.md) | 🟢 active | Leon | 2026-05-08 |

## 🎨 Design — 设计

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [Material × Depth Reference — Uvera Design System](./design/system/material-depth-reference.md) | 🟢 active | Leon | 2026-05-27 |
| [Controls / Fills State Machine + Selected-state Visual Feedback Pattern](./design/system/controls-fills-state-machine.md) | 🟢 active | Leon | 2026-05-21 |
| [Concentric Corner Radii — Panel × Sub-card Pattern](./design/system/concentric-radii-pattern.md) | 🟢 active | Leon | 2026-05-19 |
| [Uvera Design System Context — Claude.ai Design Tool 协作包](./design/iterations/DESIGN_SYSTEM_CONTEXT.md) | 🟢 active | Leon | 2026-05-18 |
| [双轨 Design System Spec（Living Doc）](./design/system/dual-track-spec.md) | 🟢 active | Leon | 2026-05-18 |
| [Design System Rules](./design/system/rules.md) | 🟢 active | Leon | 2026-05-18 |
| [Reference Images](./design/iterations/refs/README.md) | 🟢 active | Leon | 2026-05-09 |
| [Color System（颜色系统）](./design/system/COLOR-SYSTEM.md) | 🟢 active | Leon | 2026-04-18 |

## ⚙️ Engineering — 技术

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [Tech Stack（技术栈）](./engineering/TECH-STACK.md) | 🟢 active | fei | 2026-05-30 |
| [生成积分服务端化 + 鉴权 — Design Spec](./engineering/credit-enforcement-design.md) | 🟢 active | fei | 2026-05-30 |
| [生成积分服务端化 + 鉴权 Implementation Plan](./engineering/credit-enforcement-plan.md) | 🟢 active | fei | 2026-05-30 |
| [已知问题 / Bug 临时记录](./engineering/known-issues.md) | 🟢 active | Claude | 2026-05-30 |
| [Deploy Policy](./engineering/DEPLOY-POLICY.md) | 🟢 active | fei | 2026-05-22 |
| [Uvera Backend ↔ Frontend Contract Style Guide](./engineering/BACKEND-STYLE-GUIDE.md) | 🟢 active | fei | 2026-04-20 |
| [Design System — 迁移待办清单](./engineering/DESIGN-SYSTEM-MIGRATION.md) | 🟢 active | Leon | 2026-04-18 |

## 📘 Guides — 操作/功能

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [媒体文件处理环境配置指南](./guides/MEDIA_SETUP.md) | 🟢 active | Claude | 2026-05-30 |
| [UVERA Pre-Launch Smoke Test Checklist](./guides/pre-launch-checklist.md) | 🟢 active | Claude | 2026-05-06 |
| [模型能力](./guides/seedance2-vol.md) | 🟢 active | Claude | 2026-04-22 |
| [全局静音按钮功能](./guides/GLOBAL_MUTE_FEATURE.md) | 🟢 active | Claude | 2026-04-21 |
| [Hero 卡片布局规范](./guides/HERO-LAYOUT.md) | 🟢 active | Claude | 2026-04-21 |
| [视频压缩优化记录](./guides/VIDEO_COMPRESSION.md) | 🟢 active | Claude | 2026-04-21 |
| [媒体文件命名规范](./guides/MEDIA_FILE_NAMING.md) | 🟢 active | Claude | 2026-04-18 |

## 🧭 Decisions — 决策(ADR)

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [播放器 Transport + 播放逻辑统一模型](./decisions/2026-05-29-playback-transport-model.md) | 🟢 active | Leon | 2026-05-30 |
| [Replay 时 buffer eviction — by-design,HTTP cache 兜底,不主动改](./decisions/2026-05-29-replay-buffer-eviction-behavior.md) | 🟢 active | Leon | 2026-05-29 |
| [Storyboard Pipeline — GPT-image-2 取代 Gemini concept design](./decisions/2026-05-21-storyboard-pipeline.md) | 🟢 active | Leon | 2026-05-22 |
| [双轨 Design System：iOS 26 (Phone+iPad) + visionOS 26 (Web Desktop)](./decisions/2026-04-29-dual-track-design-system.md) | 🟢 active | Leon | 2026-05-18 |
| [Glass Tier System — Liquid Glass / Frosted 三级体系](./decisions/2026-05-03-glass-tier-system.md) | 🟢 active | Leon | 2026-05-18 |
| [Free / Lite tier 视频走 Cloudflare Stream + watermark UID burn-in](./decisions/2026-05-15-stream-watermark.md) | 🟢 active | Leon | 2026-05-16 |
| [Lite 二档/三档保持 ad-hoc pricing，不建独立 Stripe Price 对象](./decisions/2026-05-15-lite-tier2-tier3-stays-adhoc.md) | 🟢 active | Leon | 2026-05-15 |
| [Loud-fail pattern: 所有 service_role 写操作必须检查 r.ok](./decisions/2026-05-15-loud-fail-pattern.md) | 🟢 active | Leon | 2026-05-15 |
| [Free/Lite tier 视频 watermark — server-side 强制 + uvera.ai 文字水印](./decisions/2026-05-15-watermark-enforcement.md) | 🟢 active | Leon | 2026-05-15 |
| [Lite Plan — 后端协作清单（费）](./decisions/2026-05-08-lite-trial-plan.md) | 🟢 active | Leon | 2026-05-14 |
| [不接入 Stripe Connect 决定](./decisions/2026-05-14-no-stripe-connect.md) | 🟢 active | Leon | 2026-05-14 |
| [订阅切换走 Customer Portal（不走 Checkout）](./decisions/2026-05-14-subscription-switch-via-portal.md) | 🟢 active | Leon | 2026-05-14 |
| [Admin Recommendation / Targeted Push Strategy](./decisions/2026-05-12-recommendation-strategy.md) | 🟢 active | Leon | 2026-05-12 |
| [Refund Abuse Defenses](./decisions/2026-05-09-refund-abuse-defenses.md) | 🟢 active | Leon | 2026-05-09 |
| [Resend Transactional Email — Setup & Wiring](./decisions/2026-05-09-resend-transactional-email.md) | 🟢 active | Leon | 2026-05-09 |
| [Immersive Playback 强制 Dark — 不参与 theme switching](./decisions/2026-05-06-immersive-force-dark.md) | 🟢 active | Leon | 2026-05-06 |
| [Spark Desktop Glass — Utility Class 系统化（Phase 1）](./decisions/2026-05-06-spark-glass-utility-classes.md) | 🟢 active | Leon | 2026-05-06 |
| [Multi-quality 切换暴露：取消 + 触发条件（CF Stream 迁移）](./decisions/2026-05-03-cf-stream-multi-quality-pending.md) | 🟢 active | Leon | 2026-05-03 |
| [Liquid Glass 高保真打磨：暂缓 + 触发条件](./decisions/2026-05-03-liquid-glass-fidelity-deferral.md) | 🟢 active | Leon | 2026-05-03 |
| [Subscription / Upgrade Plan 模块归入 Session 3 scope](./decisions/2026-04-29-subscription-into-session-3.md) | 🟢 active | Leon | 2026-04-29 |
| [Tokens Studio 切换决策：暂缓 + 触发条件](./decisions/2026-04-29-tokens-studio-deferral.md) | 🟢 active | Leon | 2026-04-29 |
| [放弃 iOS 16 / iPhone X 兼容性 — 测试基线变更](./decisions/2026-04-27-drop-ios16-support.md) | 🟢 active | Leon | 2026-04-27 |
| [handleEnded 去除 auto-advance — 保留 random branch + end-of-video CTA fallback](./decisions/2026-04-27-handleEnded-no-autoadvance.md) | 🟢 active | Leon | 2026-04-27 |
| [跨 session 决策记录](./decisions/README.md) | 🟢 active | Claude | 2026-04-26 |

## 🏛 Governance — 制度

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [延期决策记录（Deferred Decisions Log）](./governance/DEFERRED-DECISIONS.md) | 🟢 active | Claude | 2026-05-30 |
| [决策授权制度](./governance/DECISION-OWNERSHIP.md) | 🟢 active | Leon | 2026-05-13 |
| [开发日志制度](./governance/DEV-LOG-POLICY.md) | 🟢 active | Claude | 2026-05-13 |

## ⚖️ Legal — 法务合规

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [Uvera Compliance Baseline](./legal/COMPLIANCE.md) | 🟢 active | 律师 | 2026-05-18 |
| [UVERA Content License Terms](./legal/CONTENT-LICENSE.md) | 🟢 active | 律师 | 2026-05-05 |
| [UVERA Privacy Policy](./legal/PRIVACY.md) | 🟢 active | 律师 | 2026-05-05 |
| [UVERA Terms of Service](./legal/TERMS-OF-SERVICE.md) | 🟢 active | 律师 | 2026-05-05 |

## 🚀 Releases — 发布

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [UVERA v1.2.0 交付清单](./releases/RELEASE-v1.2.0.md) | 🟢 active | Claude | 2026-05-25 |
| [UVERA v1.0.6 交付清单](./releases/RELEASE-v1.0.6.md) | 🟢 active | Claude | 2026-05-08 |

## 🤝 Collaboration — 协作

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [致 Main session · Mobile non-discover section 顶部 ~60px 错误留白](./collaboration/asks/2026-05-19-mobile-empty-header-toplevel-padding.md) | 🟢 active | Leon | 2026-05-19 |
| [致费 · recommended_content 新增 eyebrow 列征询](./collaboration/asks/2026-04-21-eyebrow-column.md) | 🟢 active | Leon | 2026-04-21 |

## 🗄 Archive — 归档

| 文档 | 状态 | 负责人 | 更新 |
|------|------|--------|------|
| [v1.2.0 安全 + 加固清单](./archive/asks/2026-05-15-v1.2-security-hardening.md) | ✅ resolved | Leon | 2026-05-16 |
| [致费 · Credit → Token 命名迁移](./archive/asks/2026-05-12-credit-to-token-rename.md) | ⤵️ superseded | Leon | 2026-05-13 |
| [致费 · generation_logs 3 个 endpoint 漏写 user_id → Wallet Token Activity 不完整](./archive/asks/2026-05-13-generation-logs-missing-user-id.md) | ✅ resolved | Leon | 2026-05-13 |
| [致费 · 命名一致性整改（综合 rename refactor）](./archive/asks/2026-05-13-naming-consolidation-refactor.md) | ✅ resolved | Leon | 2026-05-13 |
| [致费 · Profile picture data URL 撑爆 JWT header → HTTP 431](./archive/asks/2026-05-12-profile-picture-jwt-bloat.md) | ✅ resolved | Leon | 2026-05-12 |
| [致费 · Create / Free Mode 上传报错 "signal is aborted without reason](./archive/asks/2026-05-03-create-bug-upload-signal-aborted.md) | ✅ resolved | Leon | 2026-05-07 |
| [请帮跑一次部署 — 5/7 累积 commits 卡住](./archive/asks/2026-05-07-deploy-pending.md) | ✅ resolved | Leon | 2026-05-07 |
| [Session 3 — Profile + Subscription](./archive/sessions/scope-3-profile.md) | 🗄 archived | Leon | 2026-04-29 |
| [并发 Session 协作协议](./archive/sessions/README.md) | 🗄 archived | Leon | 2026-04-28 |
| [Session 1 — Spark / Discover / 用户主体验 + 中央协调](./archive/sessions/scope-1-spark-discover.md) | 🗄 archived | Leon | 2026-04-26 |
| [Session 2 — LibraryPage 全英化 + 视觉打磨](./archive/sessions/scope-2-library.md) | 🗄 archived | Leon | 2026-04-26 |
| [Session 4 — Create 模块（⚠️ 最敏感）](./archive/sessions/scope-4-create.md) | 🗄 archived | Leon | 2026-04-26 |
| [致费 · Branch 接龙 / Recast 出镜 授权字段 schema 对齐](./archive/asks/2026-04-25-branch-recast-schema.md) | ✅ resolved | Leon | 2026-04-25 |
| [OSS STS令牌接口文档](./archive/fei-api/OSS-STS令牌接口文档.md) | 🗄 archived | fei | 2026-04-22 |
| [Plan · Hero → 瀑布流首张 Pinned Card（16:9）](./archive/2026-04-21-hero-as-pinned-card.md) | 🗄 archived | Leon | 2026-04-21 |
| [致费 · recommended_content.type 列清理征询](./archive/asks/2026-04-21-legacy-type-column.md) | ✅ resolved | Leon | 2026-04-21 |
| [AI图片生成接口文档](./archive/fei-api/AI图片生成接口文档.md) | 🗄 archived | fei | 2026-04-20 |
| [提交视频生成任务 API 接口文档](./archive/fei-api/API接口文档-视频生成.md) | 🗄 archived | fei | 2026-04-20 |
| [用户认证接口文档](./archive/fei-api/(旧）用户认证接口文档.md) | 🗄 archived | fei | 2026-04-19 |
| [「然后呢？」功能实现详档](./archive/fei-api/NeoAI_然后呢_功能实现详档.md) | 🗄 archived | fei | 2026-04-19 |
| [统一登录及多身份选择接口文档](./archive/fei-api/登录和加入企业api.md) | 🗄 archived | fei | 2026-04-19 |


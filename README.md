# Uvera

> 面向独立创作者的 **AI 短视频生成与发布平台** —— 让"会讲故事但不会拍"的人，用一句话故事换来一段镜头清晰、角色一致、风格可控的短视频，并能作为**短剧 / 系列**发布、付费解锁。
>
> 生产环境：[uvera.ai](https://uvera.ai)（纯 Web，无 iOS / Android 客户端）。公司主体：美国 longVV ltd。

---

## Uvera 是什么

独立创作者里"会写剧本"的人远多于"会拍 / 会剪 / 会后期"的人。Uvera 把"想法 → 成片"这条路压到最短：

- **AI 视频生成** —— 文生视频 / 图生视频 / 参考素材生视频，10–30 秒为主
- **角色一致性** —— 一张照片创建可复用的"人物"，跨作品保留五官 / 风格 / 气质
- **AI 编剧** —— 一句话故事 → 标题 + 旁白 + 镜头脚本（语言匹配输入）
- **风格化** —— 4 个基础分类（动画经典 / 传统工艺 / 先锋艺术 / 现代摄影），持续扩展
- **自有视频上传** —— 审核后发布到 Discover
- **短剧 / 系列 + 付费解锁** —— 创作者把作品组织成 series / episodes，按集付费（U-Coin）或会员解锁
- **创作者订阅** —— Free / $25 / $69 / $189 四档，依次解锁分辨率、生成额度、商用授权
- **管理员后台** —— 双层权限，覆盖用户 / 订单 / 内容 / 对账 / 审核

> 完整产品叙事见 [docs/product/PRODUCT-NARRATIVE.md](./docs/product/PRODUCT-NARRATIVE.md)，设计决策见 [docs/product/PRODUCT-DESIGN.md](./docs/product/PRODUCT-DESIGN.md)。

---

## 团队约定（必读）

- 📕 **[CLAUDE.md](./CLAUDE.md)** —— 协作 / 部署 / 项目结构的 source-of-truth，任何 session 第一件事读它
- 🎯 **[决策授权制度](./docs/governance/DECISION-OWNERSHIP.md)** —— 哪些 Claude / Leon 可直接拍板，哪些必须先 propose，哪些只能费决定
- 📝 **[开发日志制度](./docs/governance/DEV-LOG-POLICY.md)** —— 当天 ship 过代码 / 做过运维的人在 Admin → Dev Log 写一条
- ⚖️ **[合规唯一来源](./docs/legal/COMPLIANCE.md)** —— 任何法律 / 隐私内容上线前先来对一遍
- 📁 **[决策档案](./docs/decisions/)** —— 非琐碎的产品 / 技术决策按日期归档

---

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | **React 19** + **Vite 7** + **Tailwind CSS 4** |
| 图标 | **Phosphor Icons**（`@phosphor-icons/react`） |
| 视频处理 | **FFmpeg**（`@ffmpeg/ffmpeg` wasm，浏览器内） |
| 后端 / 边缘 | **Cloudflare Workers + Static Assets**（`public/_worker.js`，所有后端逻辑） |
| 数据库 / Auth | **Supabase**（Postgres + RLS + RPC） |
| 支付 | **Stripe**（订阅 + U-Coin 充值） |
| 视频分发 | **Cloudflare Stream**（HLS + watermark） |

详见 [docs/engineering/TECH-STACK.md](./docs/engineering/TECH-STACK.md)。

---

## 项目结构

```
uvera/
├── public/                  # Cloudflare Workers static assets
│   ├── _worker.js           # CF Worker 主文件（所有后端逻辑）
│   ├── sw.js                # Service Worker（PWA + cache，每次部署 bump 版本）
│   ├── _headers             # CF assets cache 头
│   ├── brand/ · fonts/      # 品牌资源、字体
│   └── ffmpeg/              # ffmpeg.wasm（构建时拷入，gitignored）
├── src/
│   ├── pages/               # 路由级页面（SeriesDetailPage / LibraryPage / admin/… 共 18）
│   ├── components/          # 共用组件（Header / MasonryGrid / Hero / PaywallModal… 共 27）
│   ├── design-system/       # 设计系统：primitives / composites / tokens
│   ├── api/                 # Supabase / Worker 客户端封装（共 8）
│   ├── hooks/               # useMediaQuery / useSidebarState / usePWAInstall / useAutoColorExtraction
│   ├── data/                # mediaItems / plans / styles / videoTags
│   ├── utils/               # mediaParser / downloadVideo / colorExtractor / streamUrl…
│   └── main.jsx             # Router 注册（BrowserRouter + Routes）
├── scripts/                 # 构建/运维脚本（copy-ffmpeg / generate-version / sync-legal-docs / release…）
├── supabase/migrations/     # Supabase CLI migrations（db push --linked）
├── migrations/              # 历史 migrations（归档）
├── docs/                    # 项目文档（决策记录 / 设计系统 / 合规…）
├── tokens/                  # Figma 设计 token 导出
├── upload-worker/           # 独立上传 Worker
├── index.jsx                # App 根（Auth gate + IndexPage）
├── wrangler.jsonc           # Cloudflare Workers 部署配置
├── vite.config.js
└── package.json
```

---

## 快速开始

```bash
npm install
npm run dev       # 开发服务器 → http://localhost:5176（strictPort，固定）
npm run preview   # 本地起 Worker（vite build + wrangler dev）→ 4173
npm run build     # 生产构建（copy-ffmpeg + sync-legal-docs + generate-version + vite build）
```

| 用途 | 端口 | 说明 |
|------|------|------|
| Dev | **5176** | `npm run dev`，strictPort，端口硬编码禁改 |
| Preview | **4173** | `npm run preview`（wrangler dev） |

> 本机由 launchd `com.uvera.devserver` 常驻保活 dev server（5176）。

---

## 部署

⚠️ **本项目用 Cloudflare Workers + Static Assets，不是 Pages。**

```bash
npm run deploy            # 强制 main 分支 → build → wrangler deploy 到 uvera.ai
FORCE_DEPLOY=1 npm run deploy   # 紧急：从非 main 分支强制部署
```

- `npm run deploy` 链路：`check-deploy-branch.mjs`（护栏，仅 main）→ `npm run build` → `wrangler deploy`
- CI（`.github/workflows/build-check.yml`）只做 build 验证，**不部署**
- ⛔ 绝对不要用 `wrangler pages ...`（uvera.ai 走 Workers 路由，收不到）

部署细节、Cloudflare zone 配置、踩坑警告全在 [CLAUDE.md](./CLAUDE.md)。

---

## 核心业务概念

| 概念 | 说明 |
|------|------|
| **短剧付费** | 核心表 `series` / `episodes` / `episode_unlocks` / `series_purchases` / `wallet_balance` / `wallet_tx` |
| **U-Coin** | 平台代币，默认 100 U-Coins ≈ $1 |
| **会员等级** | `free` / `lite` / `starter` / `creator` / `studio`（starter+ 为 drama 会员白名单） |
| **结算** | 月度周期，平台 / 创作者默认 50 / 50 分成（per-series 可 override） |
| **钱包写操作** | 必须走 RPC（`wallet_unlock_episode` 等，SECURITY DEFINER + 行锁），禁止直接 PATCH 表 |

---

## 设计系统

- **Token 三层**：Primitive → Semantic → Component，定义在 `src/design-system/tokens/`；Dark Mode 走 `.dark` class 覆盖 semantic 变量
- **Glass 系统**：`.glass-*` 家族（regular / clear / dark / tinted / prominent / morphing），visionOS / iOS 材质规格；`<GlassPane>` 用于 panel
- **品牌强调色**：`--color-accent` = `#5B53FF`（Uvera purple），所有 interactive state 统一用它
- **字体**：Inter（Latin）+ Noto Sans SC/TC（中文）
- **图标**：Phosphor，`weight="fill"` 表示 fill 态

设计系统权威文档见 [docs/design/system/](./docs/design/system/)，Figma 同步见 `tokens/`。

---

## 文档导航

| 主题 | 文档 |
|------|------|
| 协作 / 部署 / 结构 SoT | [CLAUDE.md](./CLAUDE.md) |
| 产品叙事 | [docs/product/PRODUCT-NARRATIVE.md](./docs/product/PRODUCT-NARRATIVE.md) |
| 产品设计 SoT | [docs/product/PRODUCT-DESIGN.md](./docs/product/PRODUCT-DESIGN.md) |
| GA 交付清单 | [docs/product/GA-DELIVERABLES.md](./docs/product/GA-DELIVERABLES.md) |
| 技术栈 | [docs/engineering/TECH-STACK.md](./docs/engineering/TECH-STACK.md) |
| 后端契约 | [docs/engineering/BACKEND-STYLE-GUIDE.md](./docs/engineering/BACKEND-STYLE-GUIDE.md) |
| 合规 | [docs/legal/COMPLIANCE.md](./docs/legal/COMPLIANCE.md) |
| 延期决策 / TODO | [docs/governance/DEFERRED-DECISIONS.md](./docs/governance/DEFERRED-DECISIONS.md) |
| 决策档案 | [docs/decisions/](./docs/decisions/) |

---

© longVV ltd. 私有代码库，保留所有权利。

# AGENTS.md — UVERA 项目协作规约

> 给未来 session 看的 source-of-truth。任何 Codex 进来第一件事就读这个文件。
> Last updated: 2026-05-26

---

## 🚨 部署 — 最高优先级,**永远不能搞错**

### TL;DR

```bash
# 正式部署 (production, uvera.ai)
npm run deploy

# 紧急: 从非 main 分支强制部署
FORCE_DEPLOY=1 npm run deploy
```

### 详细说明

本项目用 **Cloudflare Workers + Static Assets**(不是 Pages!)。配置在 `wrangler.jsonc`:
- `"main": "./public/_worker.js"` — Worker 入口
- `"assets": { "directory": "./dist" }` — Vite 产物
- `"routes": [{ pattern: "uvera.ai", custom_domain: true }]` — production 域名

`npm run deploy` 链路:
```
scripts/check-deploy-branch.mjs  ← 强制 main 分支 (5/22 Leon 误删 fei 139 commits 后加的护栏)
  → npm run build                ← copy-ffmpeg + sync-legal-docs + generate-version + vite build
  → wrangler deploy              ← 部署 Worker + assets 到 uvera.ai
```

### ⛔ 绝对不要用的命令

| 错误命令 | 实际效果 | 为什么错 |
|---|---|---|
| `wrangler pages deploy dist --project-name uvera ...` | 部署到 CF Pages (`uvera.pages.dev`) | **uvera.ai 走 Workers 路由,根本收不到** |
| `wrangler pages deployment list` | 列 CF Pages 部署 | 跟 uvera.ai 无关 |
| 任何 `wrangler pages ...` | CF Pages 操作 | 项目不是 Pages |

**5/26 fei 实例:** 我连续跑了 8+ 次 `wrangler pages deploy`,每次都 "Deployment complete!" 但 uvera.ai 一直跑老代码 5 个小时,直到用户报错才发现。**所有 fix 都白部署**,得重新跑一次 `wrangler deploy` 才真正生效。

### CI 不部署

`.github/workflows/build-check.yml` 只做 build 验证(注释明确 "Does NOT deploy")。**production deploy 必须本地 `npm run deploy`**(`wrangler login` 已 OAuth 到 `longvv.dev@gmail.com` 账户)。

如果以后启用 auto-deploy:`secrets.CLOUDFLARE_API_TOKEN` 范围需要 `Workers Scripts:Edit` + `User Details:Read`(不是 Pages 权限)。

### 部署后验证

```bash
# 1. HTML hash 匹配本地 dist
curl -sL https://uvera.ai/ | grep -oE 'index-[A-Za-z0-9_]+\.js'
ls dist/assets/index-*.js
# ↑ 两者应一致

# 2. SW 版本
curl -sL https://uvera.ai/sw.js | grep "CACHE_NAME"
# ↑ 应是最新 v号

# 3. 关键端点存在(返回 4xx/500/200,不是 404)
curl -sI https://uvera.ai/api/wallet
```

---

## 🔀 GitHub PR 工作流 — **用 gh CLI,不开浏览器**

### TL;DR

```bash
# Feature branch 开发完成:
git push feifeixp <branch>                           # 推 branch
gh pr create --repo feifeixp/uvera --base main \
  --head <branch> --title "..." --body "..."         # 开 PR
gh pr merge --repo feifeixp/uvera --squash \
  --delete-branch <branch>                           # 直接 merge

# 然后(从 main):
git checkout main && git pull
npm run deploy                                       # 走规范部署链路
```

### 5/27 fei 实例

之前每次都让 fei 去 GitHub 网页点 "Merge pull request",pop 浏览器 → 找 PR → 点按钮 → 等 → 切回 terminal。**没必要**。`gh pr merge` 一行命令完成,留 PR 历史 + diff + audit trail(merge commit、PR 编号、commits 列表全在 GitHub 上能看)。

### 三个选项对比

| 方式 | 命令 | 优点 | 缺点 |
|---|---|---|---|
| ✅ `gh pr merge`(推荐) | `gh pr merge --squash --delete-branch <branch>` | 不开浏览器、留完整 PR 历史、可被 review、CI 跑、auto-cleanup branch | 需要 `gh` CLI 已安装 + 认证(`gh auth login` 一次性) |
| ⚡ 直接 push main(紧急) | `git push feifeixp HEAD:main` | 最快、零步骤 | 没 PR 历史、跳过 review、`check-deploy-branch.mjs` 仍能挡(必须在 main 上跑 npm run deploy) |
| 🐢 GitHub 网页点 Merge | 浏览器 → PR → Merge 按钮 | 可视 diff review | 上下文切换费时,Codex 没法自动化 |

### 标准生命周期

```
Codex commit/push → gh pr create + gh pr merge
  (worktree, gh CLI 全自动)         (CI auto-run, branch auto-delete)
     ↓
切到 main repo dir → git pull → npm run deploy
  (AGENTS.md 部署协议)            (Worker + Static Assets → uvera.ai)
     ↓
curl 验证(curl https://uvera.ai/ | grep index-...js)
```

紧急 hotfix(main 已有这次 fix 之前的 broken state):**worktree 直接 `FORCE_DEPLOY=1 npm run deploy`** 跳过分支检查 + 跳过 PR。fix 上线后再补 PR。

### ⚠️ 多 session 并行 — `git add` 卫生(2026-06-09,血泪规则)

本仓库**经常多条 Codex session 并行改动**,working tree 里随时可能混着**别的 session 未提交的 WIP**(尤其 `index.jsx` 这种高频共享文件)。

- **⛔ 禁止 `git add -A` / `git add .` / `git commit -a`** —— 会把别人的 WIP 一锅端进你的 commit,造成 attribution 混乱 + 无关改动塞进你的功能 commit。
- **✅ 永远显式列你这次真正改的文件**:`git add src/pages/SettingsPage.jsx src/components/TokenBalanceCard.jsx`。提交前先 `git status` + `git diff --cached` 复核,只含你的改动再 commit。
- **改 `index.jsx`**:只 `git add index.jsx` 且确认 staged diff **只含你的段**;别带走别人的 import / ref / 段落。

> 活标本:2026-06-09 wallet 样式线的 `cf1eed9` / `b379b87` 用 `git add -A`,把另一条 session 的 `index.jsx` immerse 导航 WIP 扫了进去(对方补 audit `7ca11c2` 记录)。功能无损但 attribution 乱了。

---

## 💬 TeamChat 自动化 — **fei / Leon 来回不走浏览器**

### TL;DR

```bash
# 读
node scripts/team-chat.mjs --author leon --status open   # Leon open 队列
node scripts/team-chat.mjs --tail 50 --json              # 最新 50 raw

# 发(以任意人身份)
node scripts/team-chat-post.mjs --as fei --file <md path> --thread <tag>
node scripts/team-chat-post.mjs --as fei --body "text"
node scripts/team-chat-post.mjs --as Codex --body "auto-deploy ok ✅"

# 改状态(open|in_progress|done|wont_do)
node scripts/team-chat-status.mjs --id <uuid> --status done
node scripts/team-chat-status.mjs --author leon --search "kw" --status done --dry
```

任何「@Codex 看下 Leon 啥情况」「@Codex 帮我回他一句」「@Codex 把 XX 标 done」 — 直接说,**0 浏览器粘贴**。

### 鉴权架构(为什么不用 service_role)

走的是 `CLAUDE_ADMIN_API_TOKEN` 路径,**不是** Supabase service_role:

| 维度 | `CLAUDE_ADMIN_API_TOKEN` | `SUPABASE_SERVICE_ROLE_KEY` |
|---|---|---|
| 显示次数 | 任意 — 你存哪都行 | **新版 Supabase 只显示 1 次**,过后只能 rotate |
| Rotate 影响 | 仅本地脚本(重 setup 一次) | **prod 全挂**(Stripe/TeamChat/Reconcile 等都靠它) |
| 权限范围 | 仅我开的 admin endpoint | 全 DB SELECT/INSERT/UPDATE/DELETE |
| 存放位置 | CF Worker secret + 本地 `.dev.vars` | 仅 CF Worker secret(不进本地) |

脚本 → Worker `/api/admin/team-chat/*` endpoint(X-Admin-API-Token header)→ Worker 内部用自己的 service_role 写 DB。本地永远不接触 service_role。

### 一次性 setup(已完成,记录给将来换机/新人)

```bash
TOK=$(openssl rand -hex 32) && \
  echo "$TOK" | wrangler secret put CLAUDE_ADMIN_API_TOKEN && \
  sed -i.bak "s|^CLAUDE_ADMIN_API_TOKEN=$|CLAUDE_ADMIN_API_TOKEN=$TOK|" .dev.vars && \
  rm .dev.vars.bak && unset TOK
```

`.dev.vars` 是 gitignored,token 永不进 git。

### Worker endpoint 契约

| Endpoint | Auth | 说明 |
|---|---|---|
| `GET /api/admin/team-chat/filter?author=&status=&limit=` | Bearer JWT 或 `X-Admin-API-Token` | 列消息,支持 author ilike + status 精确 |
| `POST /api/admin/team-chat/send` | Bearer JWT 或 `X-Admin-API-Token` + **`X-Admin-Post-As: fei\|leon\|Codex`** | Token 路径必须带 Post-As(决定 author_id) |
| `POST /api/admin/team-chat/set-status` | Bearer JWT 或 `X-Admin-API-Token` | Body `{message_id, status}` |
| `POST /api/admin/team-chat/mark-read` | Bearer JWT | (浏览器 UI 自动调,脚本一般不需要) |

### `--as` 身份解析

| `--as` 参数 | 解析为 | author_kind | 说明 |
|---|---|---|---|
| `fei` | lookup `longvv.dev@gmail.com` → 真实 auth.users.id | `human` | 显示 `name` 字段(若未设,fall back 到 email 前缀) |
| `leon` | lookup `leonkkkk7@gmail.com` → 真实 auth.users.id | `human` | 同上 |
| `Codex` | author_id=NULL,author_kind=`Codex` | `Codex` | 蓝色头像 |

### 安全 / 操作守则

- ⛔ **不要替别人发尖锐内容/承诺/决策** — `--as leon` 能发,但等于冒名。仅在你明确得到对方授权(或代替自动化场景如部署通知)时用
- ✅ 标 `done` 安全 — 状态只是 metadata,翻错了用 `--status open` 翻回来
- ⛔ **超 5 条 match 直接拒绝**改状态(脚本内置防呆) — 要批量改,用 `--id` 一条条改
- ✅ `--dry` 永远先跑预览,确认 ID 对再去掉 `--dry`

### 文件清单

```
scripts/team-chat.mjs           # 读
scripts/team-chat-post.mjs      # 发
scripts/team-chat-status.mjs    # 改 status
.dev.vars                       # CLAUDE_ADMIN_API_TOKEN 存这(gitignored)
.dev.vars.example               # 模板(进 git,无敏感值)
.Codex/drafts/*.md             # 起草中的回复(本地 scratch,.Codex/ 已 gitignored)
```

回复起草建议:长 markdown 写到 `.Codex/drafts/YYYY-MM-DD-<topic>.md` (本地暂存,**不进 git**),通过 `--file` 传给 post 脚本。发出去后那条 TeamChat 消息本身是 canonical 记录 — 决策 docs 落 `docs/decisions/` 里(进 git)。

---

## 💬 用户协作规约

- **永远用中文回复 fei**(他原话:"记住永远和我说中文")
- **决策点用 AskUserQuestion**,而不是替他决定
- 长任务用 TaskCreate / TaskUpdate 追踪进度
- 部署前 build 跑成功才 commit

---

## 🏗️ 项目结构速览

```
public/
  _worker.js          ← CF Worker 主文件 (~12000 行,所有后端逻辑)
  sw.js               ← Service Worker (PWA + cache,每次部署需 bump CACHE_NAME 版本号)
  _headers            ← CF assets cache 头 (HTML no-cache, /assets/* 长 cache)
src/
  pages/              ← 路由级页面 (SeriesDetailPage, LibraryPage, AdminDashboard 等)
  components/         ← 共用组件
  api/                ← Supabase/Worker 客户端封装
  design-system/      ← Leon 主导的设计令牌 + 组件
index.jsx             ← App 根 (Auth gate + IndexPage)
src/main.jsx          ← Router 注册 (BrowserRouter + Routes)
supabase/migrations/  ← Supabase CLI 用的 migrations (`supabase db push --linked`)
migrations/           ← 历史 migrations (老路径,新的放 supabase/migrations/)
```

### 重要约定

- **新 worker 端点**:加在 `public/_worker.js` 的 `else if (url.pathname === '/api/...' && ...)` 链里
- **新 React 页面**:`src/pages/` 下创建,在 `src/main.jsx` 注册 lazy import + Route
- **新 DB migration**:**两份** —— 一份在 `supabase/migrations/<timestamp>_<name>.sql` (CLI push 用),另一份在 `migrations/<date>_<name>.up.sql` (历史归档)
- **任何 React.useEffect / React.useState 写法**必须先 `import React, ... from 'react'`,否则 Vite automatic JSX runtime 不会暴露 React 全局 → runtime ReferenceError(5/26 fei 实例:踩了两次)

---

## 🔐 凭据 / 账户

- **Cloudflare**:`wrangler login` OAuth 到 `longvv.dev@gmail.com`(account ID `d2acf946d8f80f382be77437a71c4832`)
- **Supabase**:`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 在 `.dev.vars` 文件里(永远不要 commit;`.gitignore` 已挡)
- **Stripe**:webhook secret + API key 在 Worker env(`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- **OpenAI / Gemini / BytePlus**:在 `system_settings` 表(admin UI 可改)+ CF env fallback

---

## ☁️ Cloudflare zone 配置 — 踩坑警告

zone:`uvera.ai`(ID `081bbc40356aa028d8344e3c22b2c734`,Free plan)
覆盖子域:`uvera.ai`(Worker)+ `asset.uvera.ai`(R2 bucket public domain)

### ⛔ "I'm Under Attack" 模式 — **绝对不能随便开**

5/26 fei 实例:为找 Bot Fight Mode toggle,误开了 "I'm Under Attack"。后果:
- 整个 zone(包括 `asset.uvera.ai` 静态图)被强制 JS challenge
- **BytePlus 下不到角色设定图 / 分镜图** → 视频生成全失败(`resource download failed` 错误)
- **Stripe webhook / 任何 API client 全挂**(它们都没浏览器跑不了 JS)
- **中国 IP 用户进 uvera.ai 困难**(challenge 通过率低)
- 浏览器用户能用(JS challenge 自动通过 + 30 分钟 cookie),所以 fei 自己以为没事

**症状识别:**
```bash
curl -sI https://uvera.ai/ | grep -iE "cf-mitigated|HTTP"
# 看到: HTTP/2 403 + cf-mitigated: challenge → Under Attack 开着
# 看到: HTTP/2 200 → 正常
```

**修复方式:**

UI 路径:dash.cloudflare.com → uvera.ai zone → **Security → Settings → Security Level → Medium**(不是 High,不是 Under Attack)

API 路径(需要 `Zone Settings:Edit` 权限的 token):
```bash
curl -X PATCH "https://api.cloudflare.com/client/v4/zones/081bbc40356aa028d8344e3c22b2c734/settings/security_level" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"value":"medium"}'
```

### 真要防 bot 攻击:用 WAF Custom Rules 针对路径

不要全 zone 拉 Security Level。正确做法:
- **Security → WAF → Custom Rules**
- 针对具体高危路径(`/api/wallet`、`/api/stripe/*`)加 rate limit
- 或针对 ASN / 国家加 challenge,不影响其他流量

### 排查工具

```bash
# 看当前 security level
curl -sH "Authorization: Bearer <token>" \
  https://api.cloudflare.com/client/v4/zones/081bbc40356aa028d8344e3c22b2c734/settings/security_level

# 最近 firewall events(找谁拦了谁)
curl -sH "Authorization: Bearer <token>" \
  "https://api.cloudflare.com/client/v4/zones/081bbc40356aa028d8344e3c22b2c734/security/events?limit=20"
```

---

## 📦 常见操作 cheat sheet

```bash
# 开发
npm run dev                          # vite dev server (5173)
npm run preview                      # vite build + wrangler dev (本地跑 Worker)

# DB migration
supabase db push --linked            # push 新 migration 到 production Supabase

# Deploy production
npm run deploy                       # build + wrangler deploy 到 uvera.ai

# Release ceremony (bump version + release notes)
npm run release                      # 走 scripts/release.mjs 交互流程
```

---

## 🎯 关键 schema / 业务规则

- **drama paywall**(短剧付费):核心表 `series` / `episodes` / `episode_unlocks` / `series_purchases` / `ucoins_orders` / `wallet_balance` / `wallet_tx` / `settlements`
- **U-Coin 汇率**:默认 100 U-Coins ≈ $1 (`system_settings.ucoins_to_usd_cents = 1`)
- **会员等级**:`free` / `lite` / `starter` / `creator` / `studio`,starter+ 是 "drama 会员" 白名单(`system_settings.drama_member_tiers`)
- **结算周期**:月度 (`YYYY-MM`),通过 `/api/admin/settlements/generate?period=2026-05` 触发
- **分成默认**:平台 50% / 创作者 50% (`default_revenue_share_pct`),per-series 可 override
- **钱包写操作必须走 RPC**:`wallet_unlock_episode` / `wallet_credit_purchase` / `wallet_refund_purchase`(SECURITY DEFINER + FOR UPDATE 锁,防 race condition)。**永远不要直接 PATCH `wallet_balance` 表** — 见 audit #5

---

## 📞 团队

- **fei (费,longvv.dev@gmail.com / feifeixp@gmail.com)** — 项目负责人,前 backend CEO,现全栈;接 Codex 的甲方
- **Leon** — 产品主导(甲方接口),负责设计 + 产品决策
- **律师** — 外部,TOS / Privacy / Content License 终审
- **Codex (我)** — 工程主力,接 fei 的指令执行

---

## 🗓️ 重要节点

- **2026-05-08** GA 上线 (已过,核心功能稳定)
- **2026-05-26** drama paywall 完整 audit + 收尾(56 个 task 全部 completed)

---

## 🚧 已知未做 / 待办

(随发现更新,目前 audit 全部 closed)

- 创作者一键 publish 流程目前不会自动设付费默认 → 在 `MySeriesPage` 「定价」pill 手动设
- Refund 退款通知邮件还没接(只在 worker log 里)
- Stripe webhook 重放 / 缺失检测 admin UI 存在但 drama 部分 (`ucoins_orders` / `series_purchases`) 没接入 reconciliation

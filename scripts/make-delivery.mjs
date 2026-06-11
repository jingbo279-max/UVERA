#!/usr/bin/env node
/**
 * make-delivery.mjs — 给甲方的交付包。两种模式,都推到 private repo
 *   feifeixp/uvera-delivery(push 前硬检查 private,防 token 泄露)。
 *
 *   (默认) 源码快照:从 HEAD `git archive` → 剔内部资产 → 零-history 单 commit。
 *   --built 可部署编译包(决策 fei 2026-06-11,甲方自己部署跑):
 *     npm run build → minified dist(删 .map)+ scrub&minify 后的 worker +
 *     scrub 后的 wrangler.jsonc + migrations/supabase SQL + .env.example + DEPLOY.md。
 *     甲方拿到的是编译/压缩产物 + 配置占位(无你的 secret),`wrangler deploy` 即可跑。
 *
 * 用法:
 *   node scripts/make-delivery.mjs                  # 源码快照 dry-run
 *   node scripts/make-delivery.mjs --push           # 源码快照推送
 *   node scripts/make-delivery.mjs --built          # 编译包 dry-run(本地构建+扫描,不推)
 *   node scripts/make-delivery.mjs --built --push   # 编译包推送(覆盖 uvera-delivery)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const PUSH = args.includes('--push');
const BUILT = args.includes('--built');
const repoArg = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'feifeixp/uvera-delivery';
const ROOT = process.cwd();

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();

// ── 源码快照模式:剔除清单 ──────────────────────────────────────────────
const EXCLUDE = [
  'CLAUDE.md',
  // 内部 docs:决策/协作/制度/归档。其余 docs(engineering/guides/legal/product/releases/
  //   CONVENTIONS)保留给甲方;design 体系 docs 已迁私有库 leonsuen/design-system,不在此库。
  'docs/decisions', 'docs/collaboration', 'docs/governance', 'docs/archive',
  'scripts/make-delivery.mjs',
  'scripts/team-chat.mjs', 'scripts/team-chat-post.mjs', 'scripts/team-chat-status.mjs',
  '.github', '.claude', '.dev.vars', '.dev.vars.example',
  'System-Arch-TODO.md', 'changes.md', 'docs.wrangler.jsonc',
];

// ── 编译包模式:secret 洗白规则(→ 占位)+ 洗后残留扫描 ──────────────────
const SCRUB = [
  [/wjhdsodlxekvhpahascs\.supabase\.co/g, 'YOUR_PROJECT.supabase.co'],
  [/d2acf946d8f80f382be77437a71c4832/g, 'YOUR_CF_ACCOUNT_ID'],
  [/081bbc40356aa028d8344e3c22b2c734/g, 'YOUR_CF_ZONE_ID'],
  [/'cfut'\s*\+\s*'_[A-Za-z0-9]+'\s*\+\s*'[A-Za-z0-9]+'/g, "'YOUR_CF_API_TOKEN'"],
];
// 只扫「真 secret」:CF token / account / zone。Supabase URL+anon key 在前端 bundle
//   本就公开(任何站点都这样,RLS 保护),不当泄露扫;它指向哪个库是部署配置问题,见 DEPLOY.md。
const SECRET_SCAN = [/cfut['"\s+]*_[A-Za-z0-9]{6}/, /d2acf946d8f80f382be77437a71c4832/, /081bbc40356aa028d8344e3c22b2c734/];

const scrub = (s) => SCRUB.reduce((acc, [re, rep]) => acc.replace(re, rep), s);

// 前置:只挡「已跟踪文件的未提交改动」;未跟踪本地草稿不进 git archive,忽略。
const dirty = sh('git status --porcelain --untracked-files=no');
if (dirty) { console.error('✗ 有已跟踪文件的未提交改动,先提交再交付:\n' + dirty); process.exit(1); }
const sha = sh('git rev-parse --short HEAD');
const today = sh('git show -s --format=%cs HEAD'); // commit date,避开脚本环境 Date 限制

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uvera-delivery-'));

function rmGlobBySuffix(dir, suffix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) rmGlobBySuffix(p, suffix);
    else if (e.name.endsWith(suffix)) fs.rmSync(p);
  }
}
function scanSecrets(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.git') walk(p); continue; }
      let txt; try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
      for (const re of SECRET_SCAN) if (re.test(txt)) { hits.push(`${path.relative(dir, p)} ~ ${re}`); break; }
    }
  };
  walk(dir);
  return hits;
}

// ── 模式 A:源码快照 ────────────────────────────────────────────────────
function buildSourceSnapshot() {
  console.log(`▸ 源码快照:从 HEAD(${sha})git archive → ${tmp}`);
  sh(`git archive HEAD | tar -x -C "${tmp}"`);
  const removed = [];
  for (const rel of EXCLUDE) { const p = path.join(tmp, rel); if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); removed.push(rel); } }
  console.log('\n── 剔除(内部资产)──'); removed.forEach((r) => console.log('  ✗ ' + r));
}

// ── 模式 B:可部署编译包 ────────────────────────────────────────────────
function buildCompiledPackage() {
  console.log('▸ 编译包:npm run build …');
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  // 1. 前端:dist(删 .map)
  fs.cpSync(path.join(ROOT, 'dist'), path.join(tmp, 'dist'), { recursive: true });
  rmGlobBySuffix(path.join(tmp, 'dist'), '.map');
  // Vite 把 public/_worker.js 原样复制进 dist/(未 scrub、含 token + 冗余:wrangler main
  //   另指 public/_worker.js)。删掉它,worker 用下面单独 scrub+minify 的版本。
  { const p = path.join(tmp, 'dist', '_worker.js'); if (fs.existsSync(p)) fs.rmSync(p); }

  // 2. worker:scrub secret → esbuild minify
  fs.mkdirSync(path.join(tmp, 'public'), { recursive: true });
  const workerScrubbed = path.join(tmp, '_worker.src.js');
  fs.writeFileSync(workerScrubbed, scrub(fs.readFileSync(path.join(ROOT, 'public/_worker.js'), 'utf8')));
  sh(`npx --yes esbuild "${workerScrubbed}" --minify --format=esm --target=es2022 --legal-comments=none --outfile="${path.join(tmp, 'public/_worker.js')}"`);
  fs.rmSync(workerScrubbed);
  // sw.js 原样(它本就是给浏览器的 SW,无 secret;scrub 一遍保险)
  fs.writeFileSync(path.join(tmp, 'public/sw.js'), scrub(fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8')));
  for (const f of ['_headers', '_redirects', 'robots.txt']) {
    const src = path.join(ROOT, 'public', f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, 'public', f));
  }

  // 3. wrangler.jsonc:scrub(account 占位)
  fs.writeFileSync(path.join(tmp, 'wrangler.jsonc'), scrub(fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')));

  // 4. DB:migrations + supabase
  fs.cpSync(path.join(ROOT, 'migrations'), path.join(tmp, 'migrations'), { recursive: true });
  // 只取 supabase/migrations + config.toml;排除 supabase/.temp(CLI 本地状态,含你的 project ref)
  if (fs.existsSync(path.join(ROOT, 'supabase/migrations'))) {
    fs.mkdirSync(path.join(tmp, 'supabase'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'supabase/migrations'), path.join(tmp, 'supabase/migrations'), { recursive: true });
    const cfg = path.join(ROOT, 'supabase/config.toml');
    if (fs.existsSync(cfg)) fs.copyFileSync(cfg, path.join(tmp, 'supabase/config.toml'));
  }

  // 5. 精简 package.json(只为 wrangler deploy)
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const wranglerVer = (pkg.devDependencies?.wrangler || pkg.dependencies?.wrangler || '^4');
  fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
    name: 'uvera', private: true, type: pkg.type || 'module',
    scripts: { deploy: 'wrangler deploy' },
    devDependencies: { wrangler: wranglerVer },
  }, null, 2) + '\n');

  // 6. .env.example(worker 用到的 env 名,占位)
  const envNames = [...new Set((fs.readFileSync(path.join(ROOT, 'public/_worker.js'), 'utf8').match(/env\.[A-Z][A-Z0-9_]+/g) || []).map((s) => s.slice(4)))]
    .filter((n) => !['ASSETS', 'BUCKET'].includes(n)).sort();
  fs.writeFileSync(path.join(tmp, '.env.example'),
    '# UVERA worker 所需 env / secret —— 用 `wrangler secret put <NAME>` 配置(敏感),\n' +
    '# 或在 wrangler.jsonc 的 vars 里配(非敏感,如模型名)。\n' +
    envNames.map((n) => `${n}=`).join('\n') + '\n');

  // 7. README.md(项目介绍 + 部署 + 使用)+ DEPLOY.md(详细部署步骤)
  fs.writeFileSync(path.join(tmp, 'README.md'), README_MD(today, sha));
  fs.writeFileSync(path.join(tmp, 'DEPLOY.md'), DEPLOY_MD(today, sha));

  console.log('\n── 编译产物(顶层)──');
  fs.readdirSync(tmp).sort().forEach((f) => console.log('  ✓ ' + f));

  // 8. secret 残留扫描(防漏)
  const leaks = scanSecrets(tmp);
  if (leaks.length) { console.error('\n✗ 编译包仍含疑似 secret,已 abort:\n  ' + leaks.join('\n  ')); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); }
  console.log('\n✅ secret 残留扫描通过(无你的 token/account/supabase URL)。');
}

function DEPLOY_MD(date, srcSha) {
  return `# UVERA 部署说明(编译交付包)

> 本包为**编译后成品**:前端已构建(\`dist/\`,压缩混淆)、worker 已压缩(\`public/_worker.js\`),
> 你的 production secret 已替换为占位 \`YOUR_*\`。来源:uvera@${srcSha}(${date})。

## 1. Supabase
1. 新建一个 Supabase 项目。
2. 建表:把 \`migrations/\` 与 \`supabase/migrations/\` 下的 SQL 按文件名顺序执行
   (或在已 link 的项目里 \`supabase db push\`)。
3. 记下:Project URL、anon key、service_role key。

## 2. Cloudflare Workers(+ Static Assets)
1. \`npm install\`(只装 wrangler)、\`npx wrangler login\`。
2. 编辑 \`wrangler.jsonc\`:把 \`account_id\` 换成你的;\`routes\` 换成你自己的域名(或先删 routes 用 *.workers.dev 测)。
3. 配 secret(逐个):\`npx wrangler secret put <NAME>\` —— 名单见 \`.env.example\`。
   关键必配:\`SUPABASE_URL\`、\`SUPABASE_SERVICE_ROLE_KEY\`、\`SUPABASE_ANON_KEY\`、
   \`STRIPE_SECRET_KEY\`、\`STRIPE_WEBHOOK_SECRET\`、各 \`STRIPE_PRICE_*\`、\`CF_ACCOUNT_ID\`、
   \`CF_API_TOKEN\`、AI 相关(\`ARK_*\`/\`NEODOMAIN_GA_API_KEY\`/\`GEMINI_*\`)。
4. 部署:\`npx wrangler deploy\`。

## 3. 说明
- **半独立部署**:前端 bundle 内置了原项目的 Supabase URL/anon key(公开,RLS 保护)。worker 的
  \`SUPABASE_URL\`/\`SUPABASE_ANON_KEY\`/\`SUPABASE_SERVICE_ROLE_KEY\` 须配成**同一个** Supabase
  (即原项目的;service_role key 向交付方索取),前后端才一致、能跑。若要前端连你自己的库,需把前端
  重构成运行时读配置(不在本包内)。
- 前端是已构建的静态资源,worker 是压缩代码;DB schema 在 SQL 里(可见)。
- 代码内若有硬编码 \`https://uvera.ai\`(CORS/跳转),按你的域名自行替换后重新部署。
- 本包不含源码 \`src/\`、不含内部文档与 git history。
`;
}

function README_MD(date, srcSha) {
  return `# UVERA — AI 短视频生成与发布平台

> 面向独立创作者的 **AI 短视频生成与发布平台**:用一句话故事换来一段镜头清晰、角色一致、
> 风格可控的短视频,并能作为短剧 / 系列发布、按集付费解锁。生产环境 https://uvera.ai(纯 Web,无 App)。
>
> **本仓库是「编译交付包」**(成品代码,非源码):前端已构建为 \`dist/\`、后端 Worker 已压缩为
> \`public/_worker.js\`,供检验与自部署。来源:uvera@${srcSha}(${date})。

---

## 一、产品能力

- **AI 视频生成** —— 文生 / 图生 / 参考素材生视频(10–30 秒为主)
- **角色一致性** —— 一张照片建可复用的"人物",跨作品保留五官 / 风格 / 气质
- **AI 编剧** —— 一句话故事 → 标题 + 旁白 + 镜头脚本(语言跟随输入)
- **风格化** —— 4 大分类(动画经典 / 传统工艺 / 先锋艺术 / 现代摄影),持续扩展
- **自有视频上传** —— 审核后发布到 Discover
- **短剧 / 系列 + 付费解锁** —— 作品组织成 series / episodes,按集付费(U-Coin)或会员解锁
- **创作者订阅** —— Free / $25 / $69 / $189 四档,依次解锁分辨率 / 生成额度 / 商用授权
- **管理员后台** —— 用户 / 订单 / 内容 / 对账 / 审核

## 二、技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 19 + Vite 7 + Tailwind 4(已构建为 \`dist/\`) |
| 后端 | Cloudflare Workers(\`public/_worker.js\`,单文件,已压缩) |
| 数据库 | Supabase(Postgres + RLS);建表 SQL 见 \`migrations/\`、\`supabase/migrations/\` |
| 媒体 | Cloudflare Stream(视频)/ R2(对象存储) |
| AI | BytePlus Seedance(视频)、Gemini / OpenAI(图像 / 文本) |
| 支付 | Stripe(订阅 + U-Coin 充值) |

## 三、本包目录

| 路径 | 说明 |
|---|---|
| \`dist/\` | 前端构建产物(静态资源,部署为 CF Static Assets) |
| \`public/_worker.js\` | 后端 Worker(已压缩) |
| \`public/sw.js\` \`public/_headers\` | PWA Service Worker / 缓存头 |
| \`wrangler.jsonc\` | Cloudflare 部署配置(account / 域名为占位,需替换) |
| \`migrations/\` \`supabase/\` | 数据库 schema(SQL) |
| \`.env.example\` | 需配置的 env / secret 名单 |
| \`DEPLOY.md\` | **详细部署步骤** |

## 四、部署

完整步骤见 **[DEPLOY.md](./DEPLOY.md)**。概括:
1. **Supabase**:建项目 → 执行 \`migrations/\` 与 \`supabase/migrations/\` 下的 SQL(按文件名顺序)。
2. **Cloudflare**:改 \`wrangler.jsonc\`(account / 域名)→ \`npx wrangler secret put <NAME>\` 配 \`.env.example\` 里的 secret → \`npx wrangler deploy\`。

## 五、使用(主要界面)

- **Discover** —— AIGC 短视频 / 短剧信息流(沉浸式上下滑播放)。
- **Create** —— 创作:Free Mode(文 / 图 → 视频、AI 出图)、Story 生成(一句话 → 分镜 → 成片)。
- **Library / Works** —— 我的作品、上传的视频、可复用的角色("人物")。
- **Series** —— 短剧详情,按集付费解锁(U-Coin)或会员解锁。
- **Subscription / Wallet** —— 订阅四档、U-Coin 充值、交易记录。
- **Admin** —— 管理员后台(用户 / 内容 / 订单 / 对账 / 审核)。

## 六、本包说明

- **编译产物,不含源码**(\`src/\` 未提供);worker 为压缩代码。
- **半独立部署**:前端内置了原项目的 Supabase 配置(公开 anon key + RLS 保护);部署时 worker 的
  \`SUPABASE_*\` 须配成**同一个** Supabase 库,前后端才一致。要前端连你自己的库需把前端改成运行时读
  配置(不在本包)。详见 \`DEPLOY.md\`。
- 不含内部文档与 git history。
`;
}

// ── 共用:推送(零-history 单 commit,private 硬检查)──────────────────────
function summaryAndMaybePush() {
  if (!PUSH) {
    console.log(`\n✅ dry-run 完成(${BUILT ? '编译包' : '源码快照'})。构建目录:${tmp}`);
    console.log('   确认无误后加 --push 推送(目标 repo 须 private)。');
    return;
  }
  let vis;
  try { vis = sh(`gh repo view ${repoArg} --json visibility -q .visibility`); }
  catch { console.error(`✗ ${repoArg} 不存在或无权限。先建:gh repo create ${repoArg} --private`); process.exit(1); }
  if (vis.toLowerCase() !== 'private') { console.error(`✗ ${repoArg} 可见性=${vis} —— 交付 repo 必须 private,已 abort。`); process.exit(1); }

  console.log(`\n▸ 推送零-history ${BUILT ? '编译包' : '源码快照'} → ${repoArg}(private ✓)`);
  sh('git init -q -b main', { cwd: tmp });
  sh('git add -A', { cwd: tmp });
  sh(`git commit -q -m "Delivery ${BUILT ? 'build' : 'snapshot'} ${today} (uvera@${sha})"`, { cwd: tmp });
  sh(`git remote add origin https://github.com/${repoArg}.git`, { cwd: tmp });
  sh('git push -f -q origin main', { cwd: tmp });
  console.log(`✅ 已交付:${repoArg} ← uvera@${sha}(${BUILT ? '编译包' : '源码快照'},${today})`);
}

// ── main ───────────────────────────────────────────────────────────────
try {
  if (BUILT) buildCompiledPackage(); else buildSourceSnapshot();
  summaryAndMaybePush();
} finally {
  if (PUSH) fs.rmSync(tmp, { recursive: true, force: true });
}

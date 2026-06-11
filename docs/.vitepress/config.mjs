import { defineConfig } from 'vitepress';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* taxonomy 顺序 + 显示名(对齐 docs/CONVENTIONS.md)
   §2026-06-10 (Leon)— 「🎨 Design」区已整体迁出本仓库 → 私有库 leonsuen/design-system
   (防甲方 / AI 直接复用设计体系生成其他项目)。本仓库不再有 design 文档,故无 design section。 */
const SECTIONS = [
  ['product', '🎬 Product — 产品'],
  ['engineering', '⚙️ Engineering — 技术'],
  ['guides', '📘 Guides — 操作/功能'],
  ['decisions', '🧭 Decisions — 决策'],
  ['governance', '🏛 Governance — 制度'],
  ['legal', '⚖️ Legal — 法务合规'],
  ['releases', '🚀 Releases — 发布'],
  ['collaboration', '🤝 Collaboration — 协作'],
  ['archive', '🗄 Archive — 归档'],
];

/* §2026-06-10 (Leon)— design 文档已迁出到私有库(见上),本仓库已无 design 文件,
   无需再从站点排除任何内容。保留空表 + isHidden/srcExclude 机制以备将来。 */
const HIDE_FROM_SITE = [];
const isHidden = (relPath) => {
  const p = relPath.split(path.sep).join('/');
  return HIDE_FROM_SITE.some((g) => (g.endsWith('**') ? p.startsWith(g.slice(0, -2)) : p === g));
};

/* 从 frontmatter title(退化到首个 H1 / 文件名)取显示名 */
function titleOf(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) return t[1].trim().replace(/^["']|["']$/g, '');
  }
  const h = raw.match(/^#\s+(.+)$/m);
  return h ? h[1].trim() : path.basename(file, '.md');
}

/* 取文档时间(用于侧边栏倒序):frontmatter updated > created > 文件名
   YYYY-MM-DD 前缀 > 文件 mtime。返回 ms 时间戳。 */
function dateOf(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const u = fm[1].match(/^updated:\s*(.+)$/m);
    const c = fm[1].match(/^created:\s*(.+)$/m);
    const d = (u && u[1]) || (c && c[1]);
    if (d) {
      const t = Date.parse(d.trim().replace(/^["']|["']$/g, ''));
      if (!Number.isNaN(t)) return t;
    }
  }
  const m = path.basename(file).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}`);
    if (!Number.isNaN(t)) return t;
  }
  try { return fs.statSync(file).mtimeMs; } catch { return 0; }
}

function walkMd(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(full));
    else if (e.name.endsWith('.md') && e.name !== 'index.md' && e.name !== 'README.md') out.push(full);
  }
  return out;
}

/* 侧边栏:每个 taxonomy 目录一组,自动列出其下所有 .md(自维护,加文档即出现) */
function sidebar() {
  return SECTIONS.map(([key, text]) => {
    const dir = path.join(DOCS, key);
    if (!fs.existsSync(dir)) return null;
    const items = walkMd(dir)
      .filter((f) => !isHidden(path.relative(DOCS, f)))   // §2026-06-10 下架的 design 文件不入侧边栏
      .map((f) => ({ text: titleOf(f), link: '/' + path.relative(DOCS, f).replace(/\.md$/, ''), _date: dateOf(f) }))
      .sort((a, b) => b._date - a._date) // 时间倒序:最新在上
      .map(({ text, link }) => ({ text, link }));
    return items.length ? { text, collapsed: true, items } : null;
  }).filter(Boolean);
}

export default defineConfig({
  title: 'Uvera Docs',
  description: 'Uvera 项目文档 — 产品 / 设计 / 技术 / 决策 / 合规,一处检索',
  lang: 'zh-CN',
  cleanUrls: true,
  /* §2026-06-10 (Leon)— 下架可复用 design system/token 提炼:这些 .md 不构建成页
     (直链也 404),防甲方从公开站直接取去生成其他项目。文件仍留 repo。 */
  srcExclude: HIDE_FROM_SITE,
  /* 链接由我们的 docs:lint 把关(含到 src/ 的代码链接,不属本站);
     VitePress 自带死链检查太严会卡构建,关掉。 */
  ignoreDeadLinks: true,
  /* §2026-05-31 — 关闭 markdown 内裸 HTML:技术文档里常有裸尖括号
     (`<Component>` / `<topic>` 等),VitePress 把 md 当 Vue 模板会报"未闭合标签"。
     我们文档是纯 markdown(不写裸 HTML),关掉后裸 `<...>` 转义成文本,一次解决。 */
  markdown: { html: false },
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '文档约定', link: '/CONVENTIONS' },
    ],
    sidebar: sidebar(),
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/feifeixp/uvera/edit/main/docs/:path',
      text: '在 GitHub 编辑此页',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/feifeixp/uvera' }],
    outline: { label: '本页大纲', level: [2, 3] },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新' },
  },
});

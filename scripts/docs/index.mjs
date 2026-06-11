#!/usr/bin/env node
/**
 * docs:index — 从 frontmatter 自动生成 docs/README.md 索引(勿手改生成区)。
 * 按顶层目录分组,每篇列 标题 / 状态 / 负责人 / 更新日期。`--today YYYY-MM-DD` 注入时间戳。
 */
import fs from 'fs';
import path from 'path';
import { listDocs, readDoc, DOCS_DIR } from './frontmatter.mjs';

const todayArg = process.argv.includes('--today') ? process.argv[process.argv.indexOf('--today') + 1] : null;
const stamp = todayArg || '(未注入日期)';

// 顶层目录顺序 + 标题(对齐 CONVENTIONS.md taxonomy)
const SECTIONS = [
  ['product', '🎬 Product — 产品'],
  ['design', '🎨 Design — 设计'],
  ['engineering', '⚙️ Engineering — 技术'],
  ['guides', '📘 Guides — 操作/功能'],
  ['decisions', '🧭 Decisions — 决策(ADR)'],
  ['governance', '🏛 Governance — 制度'],
  ['legal', '⚖️ Legal — 法务合规'],
  ['releases', '🚀 Releases — 发布'],
  ['collaboration', '🤝 Collaboration — 协作'],
  ['archive', '🗄 Archive — 归档'],
];

const STATUS_BADGE = { active: '🟢', draft: '✏️', superseded: '⤵️', resolved: '✅', archived: '🗄' };

const bySection = {};
for (const file of listDocs()) {
  const doc = readDoc(file);
  if (doc.rel === 'README.md' || doc.rel === 'CONVENTIONS.md' || doc.rel === 'index.md') continue;
  const top = doc.rel.split(path.sep)[0];
  (bySection[top] ||= []).push(doc);
}

let md = `# 📚 文档索引\n\n`;
md += `> 🤖 本文件由 \`npm run docs:index\` 自动生成,**请勿手改**。标准见 [CONVENTIONS.md](./CONVENTIONS.md)。\n`;
md += `> 最后生成:${stamp}\n\n`;

for (const [key, title] of SECTIONS) {
  const docs = (bySection[key] || []).sort((a, b) => (b.data?.updated || '').localeCompare(a.data?.updated || ''));
  if (!docs.length) continue;
  md += `## ${title}\n\n`;
  md += `| 文档 | 状态 | 负责人 | 更新 |\n|------|------|--------|------|\n`;
  for (const d of docs) {
    const t = d.data?.title || d.rel;
    const badge = STATUS_BADGE[d.data?.status] || '';
    md += `| [${t}](./${d.rel}) | ${badge} ${d.data?.status || ''} | ${d.data?.owner || ''} | ${d.data?.updated || ''} |\n`;
  }
  md += `\n`;
}

// 未归入已知 section 的(迁移未完成时会出现)
const known = new Set(SECTIONS.map(([k]) => k));
const orphans = Object.keys(bySection).filter((k) => !known.has(k) && !k.endsWith('.md'));
if (orphans.length) {
  md += `## ⚠️ 未归类(待迁移)\n\n`;
  for (const k of orphans) for (const d of bySection[k]) md += `- \`${d.rel}\`\n`;
  md += `\n`;
}

fs.writeFileSync(path.join(DOCS_DIR, 'README.md'), md, 'utf-8');
console.log(`✅ 生成 docs/README.md(${Object.values(bySection).flat().length} 篇)`);

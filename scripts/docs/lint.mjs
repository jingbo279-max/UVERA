#!/usr/bin/env node
/**
 * docs:lint — 校验文档系统(接 CI = 自动门禁)
 *   1. frontmatter 必填字段齐全 + type/status 合法
 *   2. 所有相对链接零 broken
 *   3. status:active 且 updated > STALE_DAYS 天 → 告警(不致失败)
 * 退出码非 0 = 有 error(CI 失败)。`--today YYYY-MM-DD` 注入当天(脚本环境禁 Date.now)。
 */
import fs from 'fs';
import path from 'path';
import { listDocs, readDoc, relLinks, DOCS_DIR, TYPES, STATUSES, REQUIRED } from './frontmatter.mjs';

const STALE_DAYS = 180;
const todayArg = process.argv.includes('--today') ? process.argv[process.argv.indexOf('--today') + 1] : null;
const today = todayArg ? new Date(todayArg) : new Date();

const errors = [];
const warnings = [];

for (const file of listDocs()) {
  const doc = readDoc(file);
  const rel = doc.rel;
  if (rel === 'README.md' || rel === 'index.md') continue; // README=自动生成索引;index=VitePress home

  if (!doc.data) { errors.push(`${rel}: 缺 frontmatter`); continue; }

  for (const f of REQUIRED) if (!doc.data[f]) errors.push(`${rel}: 缺必填字段 \`${f}\``);
  if (doc.data.type && !TYPES.includes(doc.data.type)) errors.push(`${rel}: type=\`${doc.data.type}\` 非法`);
  if (doc.data.status && !STATUSES.includes(doc.data.status)) errors.push(`${rel}: status=\`${doc.data.status}\` 非法`);

  // 链接校验(相对路径基于文件所在目录解析)
  for (const link of relLinks(doc.body)) {
    const target = path.resolve(path.dirname(file), link);
    if (!fs.existsSync(target)) errors.push(`${rel}: broken link → ${link}`);
  }

  // 过期告警
  if (doc.data.status === 'active' && doc.data.updated) {
    const age = (today - new Date(doc.data.updated)) / 86400000;
    if (age > STALE_DAYS) warnings.push(`${rel}: active 但 ${Math.round(age)} 天未更新(updated=${doc.data.updated})`);
  }
}

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 条过期告警:`);
  warnings.forEach((w) => console.log(`   ${w}`));
}
if (errors.length) {
  console.error(`\n❌ ${errors.length} 个错误:`);
  errors.forEach((e) => console.error(`   ${e}`));
  process.exit(1);
}
console.log(`\n✅ docs lint 通过(${listDocs().length} 篇,${warnings.length} 告警)`);

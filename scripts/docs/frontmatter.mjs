/**
 * frontmatter.mjs — 文档系统共享工具(无第三方依赖)
 * 解析 .md 顶部 YAML frontmatter + 遍历 docs/。
 * Schema 见 docs/CONVENTIONS.md。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const DOCS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs');

export const TYPES = ['doc', 'decision', 'spec', 'plan', 'ask', 'release', 'legal', 'reference'];
export const STATUSES = ['active', 'draft', 'superseded', 'resolved', 'archived'];
export const REQUIRED = ['title', 'type', 'status', 'owner', 'created', 'updated'];

/** 递归列出 docs/ 下所有 .md(返回绝对路径) */
export function listDocs(dir = DOCS_DIR) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue; // 跳 .vitepress 等
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listDocs(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** 极简 frontmatter 解析:支持 `key: value` / `key: [a, b]` / 引号。返回 {data, body} 或 {data:null} */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: null, body: raw };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    let [, key, val] = kv;
    val = val.trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      data[key] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { data, body: m[2] };
}

export function readDoc(file) {
  const raw = fs.readFileSync(file, 'utf-8');
  return { file, rel: path.relative(DOCS_DIR, file), ...parseFrontmatter(raw), raw };
}

/** 提取 markdown 里的相对链接路径(./ ../ 或裸 .md),忽略 http/锚点 */
export function relLinks(body) {
  const links = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(body))) {
    const url = m[1].split(/\s+/)[0].replace(/[#?].*$/, '');
    if (!url || /^(https?:|mailto:|#)/.test(url)) continue;
    links.push(url);
  }
  return links;
}

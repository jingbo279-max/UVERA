#!/usr/bin/env node
/**
 * team-chat-status.mjs — flip team_messages.status via Worker endpoint
 *   (no service_role needed). Auth: CLAUDE_ADMIN_API_TOKEN.
 *
 * Usage:
 *   node scripts/team-chat-status.mjs --id <uuid> --status done
 *   node scripts/team-chat-status.mjs --author leon --search "avatar" --status done
 *   node scripts/team-chat-status.mjs --author leon --status done --dry
 *
 * Two modes:
 *   --id <uuid>        → directly PATCH that one row
 *   --author/--search  → first GET filter to find IDs, then PATCH each
 *
 * Max 5 matches via filter path (safety — won't mass-flip on accident).
 * Use --dry to preview.
 *
 * §2026-05-31 fei — Worker-side path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function loadDevVars() {
  const p = path.join(PROJECT_ROOT, '.dev.vars');
  if (!fs.existsSync(p)) {
    console.error('❌ .dev.vars not found at', p);
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = loadDevVars();
const TOKEN = env.CLAUDE_ADMIN_API_TOKEN || process.env.CLAUDE_ADMIN_API_TOKEN;
const BASE = env.TEAM_CHAT_BASE || process.env.TEAM_CHAT_BASE || 'https://uvera.ai';
if (!TOKEN) {
  console.error('❌ CLAUDE_ADMIN_API_TOKEN not set in .dev.vars');
  process.exit(1);
}

const VALID = new Set(['open', 'in_progress', 'done', 'wont_do']);

function parseArgs(argv) {
  const a = { id: null, author: null, search: null, status: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--id') a.id = argv[++i];
    else if (v === '--author') a.author = argv[++i];
    else if (v === '--search') a.search = argv[++i];
    else if (v === '--status') a.status = argv[++i];
    else if (v === '--dry') a.dry = true;
    else if (v === '--help' || v === '-h') {
      console.log(`Usage:
  node scripts/team-chat-status.mjs --id <uuid> --status done
  node scripts/team-chat-status.mjs --author leon --search "avatar" --status done

--id <uuid>      Direct row (skips search)
--author <sub>   author_display_name ilike *sub*
--search <text>  body ilike *text* — combined with --author if both set
--status <v>     open | in_progress | done | wont_do
--dry            Preview only`);
      process.exit(0);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.status || !VALID.has(args.status)) {
  console.error('❌ --status must be one of: open | in_progress | done | wont_do');
  process.exit(1);
}

async function setStatus(id) {
  const r = await fetch(`${BASE}/api/admin/team-chat/set-status`, {
    method: 'POST',
    headers: {
      'X-Admin-API-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message_id: id, status: args.status }),
  });
  const data = await r.json();
  if (!data.success) {
    console.error(`  ❌ ${id.slice(0, 8)}…  failed: ${data.errMessage || JSON.stringify(data)}`);
    return false;
  }
  console.log(`  ✓ ${id.slice(0, 8)}…  → ${args.status}`);
  return true;
}

// Mode A: direct ID
if (args.id) {
  if (args.dry) {
    console.log(`(dry) would set ${args.id} → ${args.status}`);
    process.exit(0);
  }
  const ok = await setStatus(args.id);
  process.exit(ok ? 0 : 1);
}

// Mode B: filter then PATCH each
if (!args.author && !args.search) {
  console.error('❌ Provide --id OR (--author and/or --search)');
  process.exit(1);
}

// Worker filter endpoint supports author + status (not search yet — we
// filter the body client-side after pulling the author's recent messages).
const params = new URLSearchParams();
if (args.author) params.set('author', args.author);
params.set('limit', '50');
const filterRes = await fetch(`${BASE}/api/admin/team-chat/filter?${params.toString()}`, {
  headers: { 'X-Admin-API-Token': TOKEN },
});
const filterData = await filterRes.json();
if (!filterData.success) {
  console.error('❌ filter failed:', filterData.errMessage || JSON.stringify(filterData));
  process.exit(1);
}

let rows = filterData.messages || [];
if (args.search) {
  const needle = args.search.toLowerCase();
  rows = rows.filter(m => (m.body || '').toLowerCase().includes(needle));
}

if (rows.length === 0) {
  console.log('(no matches)');
  process.exit(0);
}

console.log(`\nFound ${rows.length} message${rows.length === 1 ? '' : 's'} → status=${args.status}:\n`);
for (const r of rows) {
  const preview = (r.body || '').replace(/\n/g, ' ').slice(0, 80);
  console.log(`  ${r.id.slice(0, 8)}…  ${r.author_display_name || '(?)'}  [${r.status}→${args.status}]  ${preview}`);
}

if (rows.length > 5) {
  console.error(`\n⚠️ ${rows.length} matches is a lot — narrow with --id or more specific --search to avoid mass-flip.`);
  process.exit(1);
}

if (args.dry) {
  console.log('\n(dry run, no changes written)');
  process.exit(0);
}

console.log('\nUpdating…');
let ok = 0;
for (const r of rows) {
  if (await setStatus(r.id)) ok++;
}
console.log(`\n✅ ${ok}/${rows.length} updated to status=${args.status}`);

#!/usr/bin/env node
/**
 * team-chat.mjs — read team_messages via the Worker admin endpoint
 *   (no service_role key required locally — service_role stays in CF env).
 *
 * Auth: X-Admin-API-Token header → CLAUDE_ADMIN_API_TOKEN from .dev.vars.
 *
 * Usage:
 *   node scripts/team-chat.mjs                       # last 50 messages
 *   node scripts/team-chat.mjs --tail 200
 *   node scripts/team-chat.mjs --author leon --status open
 *   node scripts/team-chat.mjs --status open
 *   node scripts/team-chat.mjs --json                # raw JSON
 *
 * §2026-05-31 fei — rewritten to use Worker endpoint instead of direct
 *   Supabase service_role access (which the user can't easily re-fetch
 *   from Supabase Dashboard after first reveal).
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
    console.error('   Copy .dev.vars.example and fill in CLAUDE_ADMIN_API_TOKEN.');
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = loadDevVars();
const TOKEN = env.CLAUDE_ADMIN_API_TOKEN || process.env.CLAUDE_ADMIN_API_TOKEN;
const BASE = env.TEAM_CHAT_BASE || process.env.TEAM_CHAT_BASE || 'https://uvera.ai';

if (!TOKEN) {
  console.error('❌ CLAUDE_ADMIN_API_TOKEN not set in .dev.vars or env');
  console.error('   Setup (one-time):');
  console.error('     1. Generate: openssl rand -hex 32');
  console.error('     2. wrangler secret put CLAUDE_ADMIN_API_TOKEN  (paste it)');
  console.error('     3. Add to .dev.vars: CLAUDE_ADMIN_API_TOKEN=<same value>');
  process.exit(1);
}

function parseArgs(argv) {
  const a = { tail: 50, author: null, status: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--tail') a.tail = parseInt(argv[++i], 10) || 50;
    else if (v === '--author') a.author = argv[++i];
    else if (v === '--status') a.status = argv[++i];
    else if (v === '--json') a.json = true;
    else if (v === '--help' || v === '-h') {
      console.log(`Usage:
  node scripts/team-chat.mjs                       # last 50 messages
  node scripts/team-chat.mjs --tail 200            # tail size 1..200
  node scripts/team-chat.mjs --author leon         # author_display_name ilike
  node scripts/team-chat.mjs --status open         # open|in_progress|done|wont_do
  node scripts/team-chat.mjs --json                # raw JSON output

Compose: --author leon --status open --tail 50    # Leon's 50 latest open issues`);
      process.exit(0);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

const params = new URLSearchParams();
if (args.author) params.set('author', args.author);
if (args.status) params.set('status', args.status);
params.set('limit', String(args.tail));

const url = `${BASE}/api/admin/team-chat/filter?${params.toString()}`;
const res = await fetch(url, { headers: { 'X-Admin-API-Token': TOKEN } });
const data = await res.json();
if (!data.success) {
  console.error(`❌ API error (${res.status}): ${data.errMessage || JSON.stringify(data)}`);
  process.exit(2);
}

if (args.json) {
  console.log(JSON.stringify(data.messages, null, 2));
  process.exit(0);
}

const STATUS_GLYPHS = {
  open:        '🟢 OPEN ',
  in_progress: '🟡 WIP  ',
  done:        '✅ DONE ',
  wont_do:     '⚪ SKIP ',
};
const fmtTime = (iso) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 3600_000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)}d ago`;
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

console.log(`\n📨 ${data.count} message${data.count === 1 ? '' : 's'}` +
  (args.author ? ` · author~"${args.author}"` : '') +
  (args.status ? ` · status=${args.status}` : '') +
  ` (limit ${args.tail})\n`);

if (data.count === 0) {
  console.log('  (no matches)\n');
  process.exit(0);
}

for (const m of data.messages) {
  const time = fmtTime(m.created_at);
  const status = STATUS_GLYPHS[m.status] || `?${m.status || 'null'}?`;
  const who = (m.author_display_name || '(unknown)').padEnd(14);
  const thread = m.thread_id ? ` #${m.thread_id}` : '';
  console.log(`────────────────────────────────────────────────`);
  console.log(`[${time.padStart(7)}] ${status} ${who}${thread}`);
  console.log(`  id: ${m.id}`);
  console.log(m.body.split('\n').map(l => '  ' + l).join('\n'));
}
console.log('');

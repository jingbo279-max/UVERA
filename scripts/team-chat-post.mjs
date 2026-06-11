#!/usr/bin/env node
/**
 * team-chat-post.mjs — post a message to TeamChat via Worker endpoint
 *   (no service_role required locally). Auth via CLAUDE_ADMIN_API_TOKEN.
 *
 * Usage:
 *   node scripts/team-chat-post.mjs --as fei --file /tmp/reply.md
 *   node scripts/team-chat-post.mjs --as fei --body "got it, ship it"
 *   node scripts/team-chat-post.mjs --as fei --body "..." --thread avatar-cf
 *   node scripts/team-chat-post.mjs --as claude --body "Auto-deploy OK ✅"
 *
 * Authors:
 *   fei    → resolved by Worker to longvv.dev@gmail.com
 *   leon   → resolved by Worker to leonkkkk7@gmail.com
 *   claude → synthetic Claude post (author_kind='claude')
 *
 * §2026-05-31 fei — Worker-side path. Replaces previous service_role
 *   direct-DB approach to avoid local service_role exposure.
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
  console.error('   Setup:');
  console.error('     openssl rand -hex 32                              # generate');
  console.error('     wrangler secret put CLAUDE_ADMIN_API_TOKEN        # paste it');
  console.error('     echo "CLAUDE_ADMIN_API_TOKEN=<same>" >> .dev.vars # same value');
  process.exit(1);
}

function parseArgs(argv) {
  const a = { as: null, body: null, file: null, thread: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--as') a.as = argv[++i];
    else if (v === '--body') a.body = argv[++i];
    else if (v === '--file') a.file = argv[++i];
    else if (v === '--thread') a.thread = argv[++i];
    else if (v === '--help' || v === '-h') {
      console.log(`Usage:
  node scripts/team-chat-post.mjs --as fei --file /tmp/reply.md
  node scripts/team-chat-post.mjs --as fei --body "text" [--thread tag]

--as <fei|leon|claude>      REQUIRED: who appears as author (Worker resolves)
--body <text>               Inline body (or --file)
--file <path>               Read body from file (preferred for markdown)
--thread <tag>              Optional thread_id`);
      process.exit(0);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (!args.as) {
  console.error('❌ --as required (fei | leon | claude)');
  process.exit(1);
}

let body = args.body;
if (args.file) {
  if (!fs.existsSync(args.file)) {
    console.error('❌ --file not found:', args.file);
    process.exit(1);
  }
  body = fs.readFileSync(args.file, 'utf-8').trim();
}
if (!body) {
  console.error('❌ Need --body or --file');
  process.exit(1);
}

const res = await fetch(`${BASE}/api/admin/team-chat/send`, {
  method: 'POST',
  headers: {
    'X-Admin-API-Token': TOKEN,
    'X-Admin-Post-As': args.as,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ body, thread_id: args.thread || null }),
});

const data = await res.json();
if (!data.success) {
  console.error(`❌ Worker rejected (HTTP ${res.status}): ${data.errMessage || JSON.stringify(data)}`);
  process.exit(2);
}

const human = data.messages?.[0];
const claude = data.messages?.[1];

console.log(`✅ Posted as ${human?.author_display_name || args.as}`);
console.log(`   id        : ${human?.id}`);
console.log(`   created_at: ${human?.created_at}`);
if (args.thread) console.log(`   thread    : ${args.thread}`);
if (human?.mentions?.length) console.log(`   mentions  : ${human.mentions.join(' ')}`);
console.log(`   body      : ${body.length} chars`);
if (claude) {
  console.log(`\n💬 Claude replied:`);
  console.log(`   id   : ${claude.id}`);
  console.log(`   body : ${(claude.body || '').slice(0, 200)}${(claude.body || '').length > 200 ? '…' : ''}`);
}

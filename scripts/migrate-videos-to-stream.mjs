#!/usr/bin/env node
/**
 * scripts/migrate-videos-to-stream.mjs
 *
 * §2026-05-22 fei: bulk migrate legacy non-Stream videos in
 * recommended_content to Cloudflare Stream. Idempotent, safe to re-run.
 *
 * How it works:
 *   1. Fetches your admin Supabase JWT from a session you must already
 *      be logged into (paste it as the SUPABASE_JWT env var below).
 *   2. Calls the worker endpoint POST /api/admin/migrate-videos-to-stream
 *      with paginated batches.
 *   3. The worker does the CF Stream copy-from-URL + DB PATCH per row.
 *      No bandwidth flows through the worker (Stream pulls the source URL
 *      directly), so each batch is fast.
 *   4. Loops until all candidates exhausted OR --limit-total reached.
 *
 * Usage:
 *
 *   Step 1: get your admin JWT (in browser devtools on uvera.ai, console):
 *     copy(await window.supabase.auth.getSession().then(r=>r.data.session.access_token))
 *   Then paste it:
 *     export SUPABASE_JWT="ey..."
 *
 *   Step 2: dry-run to see candidates (DOES NOT MUTATE):
 *     node scripts/migrate-videos-to-stream.mjs --dry-run --limit 10
 *
 *   Step 3: real migration in batches:
 *     node scripts/migrate-videos-to-stream.mjs --limit 10
 *
 *   Migrate just specific IDs:
 *     node scripts/migrate-videos-to-stream.mjs --ids id1,id2,id3
 *
 * Notes:
 *   · CF Stream transcodes async (1-3min per video). The DB row is
 *     updated immediately with the new iframe.cloudflarestream.com URL.
 *     Users hitting the URL during transcode see a "processing" placeholder,
 *     then real video. Acceptable for old/published works.
 *   · Volces.com TOS URLs that are >24h old are likely expired — CF Stream
 *     copy will fail with a per-row error (logged, doesn't stop the batch).
 *   · Rate-limited internally by `limit` per call (default 10).
 */

const API_BASE = process.env.UVERA_API_BASE || 'https://uvera.ai';
const JWT = process.env.SUPABASE_JWT;

if (!JWT) {
  console.error('\n❌ SUPABASE_JWT env var required.\n');
  console.error('   Get it from browser console on uvera.ai (logged in as admin):');
  console.error('     copy(await window.supabase.auth.getSession().then(r=>r.data.session.access_token))');
  console.error('   Then: export SUPABASE_JWT="ey..."\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : 10;
const idsArg = args.indexOf('--ids');
const ids = idsArg >= 0 ? args[idsArg + 1].split(',') : null;
const limitTotalArg = args.indexOf('--limit-total');
const limitTotal = limitTotalArg >= 0 ? parseInt(args[limitTotalArg + 1], 10) : Infinity;

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

async function callBatch() {
  const res = await fetch(`${API_BASE}/api/admin/migrate-videos-to-stream`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${JWT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dryRun, limit, ...(ids ? { ids } : {}) }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`HTTP ${res.status}: ${json?.errMessage || res.statusText}`);
  }
  return json;
}

(async () => {
  console.log();
  console.log(`Mode:   ${dryRun ? YELLOW + 'DRY-RUN (no changes)' : GREEN + 'LIVE MIGRATION'}${RESET}`);
  console.log(`Limit per batch: ${limit}`);
  console.log(`Limit total:     ${limitTotal === Infinity ? 'all' : limitTotal}`);
  if (ids) console.log(`IDs filter:      ${ids.length} specific rows`);
  console.log(`API:    ${API_BASE}`);
  console.log();

  let totalProcessed = 0;
  let totalMigrated = 0;
  let totalFailed = 0;
  let batch = 0;

  while (totalProcessed < limitTotal) {
    batch++;
    process.stdout.write(`${DIM}Batch ${batch}…${RESET}`);
    let json;
    try {
      json = await callBatch();
    } catch (err) {
      console.log(` ${RED}✘ ${err.message}${RESET}`);
      break;
    }
    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    if (!json.items || json.items.length === 0) {
      console.log(`${GREEN}✓ No more candidates. Done.${RESET}`);
      break;
    }

    for (const item of json.items) {
      const tag = item.status === 'migrated' ? `${GREEN}✓` : item.status === 'failed' ? `${RED}✘` : `${YELLOW}·`;
      const title = (item.title || '(no title)').padEnd(42).slice(0, 42);
      const detail = item.status === 'migrated' ? `→ ${item.uid}` : item.status === 'failed' ? `${item.error || ''}` : 'would migrate';
      console.log(`  ${tag} ${item.id.slice(0, 8)} ${title} ${DIM}${detail}${RESET}`);
    }

    totalProcessed += json.processed;
    totalMigrated += json.migrated;
    totalFailed += json.failed;

    if (dryRun) break;  // dryRun: just one batch, then stop
    if (json.migrated === 0 && json.failed === 0) break;  // nothing left to do
    if (totalProcessed >= limitTotal) break;
  }

  console.log();
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`  ${GREEN}migrated: ${totalMigrated}${RESET}`);
  if (totalFailed > 0) console.log(`  ${RED}failed:   ${totalFailed}${RESET}`);
  console.log();
})();

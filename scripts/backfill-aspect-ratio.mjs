#!/usr/bin/env node
/**
 * One-shot backfill: 给 recommended_content 表中 aspect_ratio IS NULL 的行
 * 自动 probe cover 图片自然尺寸，UPDATE 进 DB。
 *
 * 背景：Create flow 历史 commit 没在 supabase.from('recommended_content').insert
 * payload 里写 aspect_ratio。a830c6a 已修 forward path。本脚本回填遗留 50+ 行。
 *
 * 用法：
 *   node scripts/backfill-aspect-ratio.mjs           # 预览（不写库）
 *   node scripts/backfill-aspect-ratio.mjs --apply   # 实际 UPDATE
 *
 * AR 来源：cover 图片自然尺寸。Create flow 的 cover 是 captureVideoFrame 从视频
 * 提取的关键帧（src/pages/StoryGeneratorPage.jsx），AR === 视频 AR，复用。
 *
 * 依赖：sharp（已装，用于读图像 metadata）+ Node 18+ 内置 fetch。
 * 走 Supabase Management API（PAT 鉴权），不用 service_role。
 */

import sharp from 'sharp';

const SUPABASE_PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'wjhdsodlxekvhpahascs';
// §2026-06-11 fei — 只读 env,移除硬编码 Supabase 管理 PAT(账户级,曾硬编码在此,见 git history → 需 rotate)。
const SUPABASE_PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!SUPABASE_PAT) {
  console.error('✗ 缺 SUPABASE_ACCESS_TOKEN(Supabase Management PAT)。先 `export SUPABASE_ACCESS_TOKEN=sbp_…` 再跑。');
  process.exit(1);
}
const MGMT_API = `https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`;

const APPLY = process.argv.includes('--apply');

async function runSQL(query) {
  const res = await fetch(MGMT_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function probeCoverAR(coverUrl) {
  const res = await fetch(coverUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error('No dimensions in metadata');
  return { ar: `${meta.width}/${meta.height}`, w: meta.width, h: meta.height };
}

async function main() {
  console.log(`🔍 Mode: ${APPLY ? '✅ APPLY (writes DB)' : '👁️  DRY-RUN (no writes)'}\n`);

  // 1. SELECT rows missing aspect_ratio
  console.log('📋 Querying recommended_content WHERE aspect_ratio IS NULL...');
  const rows = await runSQL(
    `SELECT id, title, video, cover, aspect_ratio
     FROM recommended_content
     WHERE aspect_ratio IS NULL OR aspect_ratio = ''
     ORDER BY "createdAt" DESC;`
  );
  console.log(`📋 Found ${rows.length} rows to backfill\n`);
  if (rows.length === 0) { console.log('✨ Nothing to do.'); return; }

  // 2. For each row, probe + (maybe) UPDATE
  let success = 0;
  let skipped = 0;
  let failed = 0;
  const arHistogram = {};

  for (const [i, row] of rows.entries()) {
    const idx = `[${i + 1}/${rows.length}]`;
    const titleSnippet = (row.title || '').slice(0, 40);

    if (!row.cover) {
      console.log(`${idx} ⏭️  ${row.id} no cover → skip — "${titleSnippet}"`);
      skipped++;
      continue;
    }

    try {
      const { ar, w, h } = await probeCoverAR(row.cover);
      arHistogram[ar] = (arHistogram[ar] || 0) + 1;

      if (APPLY) {
        // Escape single quotes by SQL convention
        const escAR = ar.replace(/'/g, "''");
        const escId = row.id.replace(/'/g, "''");
        await runSQL(
          `UPDATE recommended_content SET aspect_ratio = '${escAR}' WHERE id = '${escId}';`
        );
        console.log(`${idx} ✅ ${row.id} → ${ar} (${w}×${h}) — "${titleSnippet}"`);
      } else {
        console.log(`${idx} 👁️  ${row.id} → would set ${ar} (${w}×${h}) — "${titleSnippet}"`);
      }
      success++;
    } catch (e) {
      console.log(`${idx} ❌ ${row.id} probe failed: ${e.message} — "${titleSnippet}"`);
      failed++;
    }
  }

  // 3. Summary
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📊 Summary`);
  console.log(`   Success: ${success}`);
  console.log(`   Skipped (no cover): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log(`\n📊 AR distribution:`);
  Object.entries(arHistogram)
    .sort(([, a], [, b]) => b - a)
    .forEach(([ar, count]) => {
      console.log(`   ${ar.padEnd(10)} ${count}`);
    });

  if (!APPLY) {
    console.log(`\n💡 Re-run with --apply to actually UPDATE the DB.`);
  }
}

main().catch((e) => { console.error('💥 Fatal:', e); process.exit(1); });

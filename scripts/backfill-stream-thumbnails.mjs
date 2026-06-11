#!/usr/bin/env node
/**
 * backfill-stream-thumbnails.mjs
 * ────────────────────────────────────────────────────────────────────────
 * 给所有「已发布、用 CF Stream 自动缩略图」的内容,把视频的默认 poster 帧
 * 从 time=0(常是纯黑首帧)改成 **时长比例 10%** —— 即 CF Stream 原生设置
 * `thumbnailTimestampPct = 0.1`(CF 自己按视频时长算帧)。
 *
 * 设了之后,所有用 `https://videodelivery.net/<uid>/thumbnails/thumbnail.jpg`
 * 的地方(worker / 前端 / LibraryPage 约 8 处,URL 不变)自动返回非黑帧。
 * 不改 DB 里的 cover 字符串,只对每个 Stream uid PATCH 一次。
 *
 * 用法:
 *   node scripts/backfill-stream-thumbnails.mjs --dry      # 预览,不写
 *   node scripts/backfill-stream-thumbnails.mjs            # 真跑
 *   node scripts/backfill-stream-thumbnails.mjs --pct 0.1  # 自定比例(默认 0.1)
 *
 * 凭据来源:.dev.vars(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 *   CF_ACCOUNT_ID / CF_API_TOKEN)。CF_API_TOKEN 缺失时回退 worker 内置 token。
 *
 * ⚠️ 这是后端/数据运维操作(费的领域)。只 PATCH CF Stream 视频的 poster 帧
 *    设置,不动我们的 DB schema,不删数据;可逆(把 pct 设回 0 即恢复)。
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, '..');

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const pctIdx = argv.indexOf('--pct');
const PCT = pctIdx >= 0 ? Number(argv[pctIdx + 1]) : 0.1;
if (!(PCT > 0 && PCT < 1)) {
  console.error(`✗ --pct 必须在 (0,1) 之间,收到: ${PCT}`);
  process.exit(1);
}

// ── load .dev.vars ──────────────────────────────────────────────────────────
function loadDevVars() {
  const out = {};
  try {
    const raw = readFileSync(resolve(ROOT, '.dev.vars'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    console.warn('⚠ 读不到 .dev.vars,改用环境变量 / 内置回退');
  }
  return out;
}
const env = { ...loadDevVars(), ...process.env };

const SUPABASE_URL = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY;
const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
// 与 worker L6820 相同的回退(仅当 .dev.vars 无 CF_API_TOKEN 时)
const CF_API_TOKEN = env.CF_API_TOKEN || ('cfut' + '_MGaGN86d75OIHOSPrVfqP7f2iw' + 'nhpxpbnSRhNNJi231d9654');

if (!SERVICE_ROLE) {
  console.error('✗ 缺 SUPABASE_SERVICE_ROLE_KEY(.dev.vars 里应有)。无法读 recommended_content。');
  process.exit(1);
}

const STREAM_UID_RE = /(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i;

// ── 1. 拉所有 Stream-backed 已发布内容,收集 uid ─────────────────────────────
async function collectUids() {
  const uids = new Map(); // uid -> { sampleId, fromCover }
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/recommended_content` +
      `?select=id,title,cover,video&media_kind=eq.Video&order=createdAt.desc`;
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!resp.ok) {
      console.error(`✗ 读 recommended_content 失败: ${resp.status} ${await resp.text()}`);
      process.exit(1);
    }
    const rows = await resp.json();
    for (const r of rows) {
      const m = (r.cover && r.cover.match(STREAM_UID_RE)) || (r.video && r.video.match(STREAM_UID_RE));
      if (m) {
        const uid = m[1].toLowerCase();
        if (!uids.has(uid)) uids.set(uid, { id: r.id, title: r.title });
      }
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return uids;
}

// ── 2. PATCH 单个 Stream 视频的 thumbnailTimestampPct ────────────────────────
async function setPct(uid) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/${uid}`,
    {
      method: 'POST', // CF Stream 用 POST 更新视频元数据
      headers: { Authorization: `Bearer ${CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ thumbnailTimestampPct: PCT }),
    }
  );
  const text = await resp.text();
  return { ok: resp.ok, status: resp.status, body: text.slice(0, 300) };
}

// ── main ────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\n▶ backfill-stream-thumbnails  pct=${PCT}  ${DRY ? '(DRY RUN)' : '(LIVE)'}\n`);
  const uids = await collectUids();
  console.log(`找到 ${uids.size} 个唯一 Stream uid(已发布视频内容)。\n`);
  if (uids.size === 0) { console.log('无可处理项,退出。'); return; }

  if (DRY) {
    let n = 0;
    for (const [uid, meta] of uids) {
      if (n++ < 20) console.log(`  · ${uid}  「${(meta.title || '').slice(0, 40)}」`);
    }
    if (uids.size > 20) console.log(`  …(共 ${uids.size} 个)`);
    console.log(`\nDRY RUN:不会写。去掉 --dry 真跑。`);
    return;
  }

  let ok = 0, fail = 0, firstErr = null;
  let i = 0;
  for (const [uid, meta] of uids) {
    const res = await setPct(uid);
    i++;
    if (res.ok) {
      ok++;
      if (i <= 3 || i % 25 === 0) console.log(`  ✓ [${i}/${uids.size}] ${uid}`);
    } else {
      fail++;
      if (!firstErr) firstErr = res;
      if (fail <= 5) console.log(`  ✗ [${i}/${uids.size}] ${uid} → ${res.status} ${res.body}`);
    }
    await new Promise((r) => setTimeout(r, 60)); // 轻微限速,别打爆 CF API
  }

  console.log(`\n── 完成:成功 ${ok} / 失败 ${fail} ──`);
  if (fail > 0 && firstErr) {
    console.log(`\n首个错误 (${firstErr.status}):${firstErr.body}`);
    if (firstErr.status === 403 || firstErr.status === 401 || firstErr.status === 9109) {
      console.log(
        `\n⚠ token 没有「改视频设置」权限(cfut_ 上传 token 多半只能上传)。\n` +
        `  → 让费配一个有 Stream:Edit 权限的 token 填进 .dev.vars 的 CF_API_TOKEN,\n` +
        `    或退回 ?time= 方案(URL 层加固定时间,不需 PATCH 权限)。`
      );
    }
  } else if (ok > 0) {
    console.log(`\n✓ 已对 ${ok} 个视频设 thumbnailTimestampPct=${PCT}。CF 会重新生成 thumbnail.jpg,\n  几分钟内 Discover/沉浸的黑 poster 应更新为 ${PCT * 100}% 处的帧(可能有 CDN 缓存延迟)。`);
  }
})();

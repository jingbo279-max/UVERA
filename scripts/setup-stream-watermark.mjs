#!/usr/bin/env node
/**
 * setup-stream-watermark.mjs — one-time setup to create a Cloudflare
 * Stream watermark profile for "uvera.ai" branding.
 *
 * Stream's watermark API takes an image file (JPEG/PNG/GIF) and returns
 * a UID. Once you have the UID, attach it to videos via the `watermark`
 * field on the Stream copy/upload call — Stream burns the watermark
 * onto the video during encoding (one-time CPU cost, not per-view).
 *
 * Defaults to fetching a placeholder text PNG from placehold.co — fine
 * for v1 ship. Once Leon designs a real branded watermark image, swap
 * the URL or pass --image=<local-path> to use a local PNG.
 *
 * Usage:
 *   # Setup with defaults (placeholder)
 *   node scripts/setup-stream-watermark.mjs
 *
 *   # Setup with custom local image
 *   node scripts/setup-stream-watermark.mjs --image=./watermark.png
 *
 *   # Setup with custom URL
 *   node scripts/setup-stream-watermark.mjs --url=https://example.com/wm.png
 *
 * What this script DOES NOT do:
 *   - Persist the UID for you. Take the UID it outputs and either:
 *     a) Set Cloudflare env var STREAM_WATERMARK_UID via `wrangler secret put`
 *     b) Insert into public.system_settings (preferred — admin-editable later):
 *        INSERT INTO system_settings (key, value, description) VALUES
 *          ('stream_watermark_uid', '<UID>', 'CF Stream watermark UID for free/lite video burn-in');
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Load .dev.vars ────────────────────────────────────────────────────
function loadDevVars() {
  const p = path.join(PROJECT_ROOT, '.dev.vars');
  if (!fs.existsSync(p)) {
    console.error('❌ .dev.vars not found at', p);
    console.error('   Need CF_ACCOUNT_ID + CF_API_TOKEN set there to call Stream API.');
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
const CF_ACCOUNT_ID = env.CF_ACCOUNT_ID || 'd2acf946d8f80f382be77437a71c4832';
const CF_API_TOKEN = env.CF_API_TOKEN;
if (!CF_API_TOKEN) {
  console.error('❌ Missing CF_API_TOKEN in .dev.vars');
  console.error('   Create one at: https://dash.cloudflare.com/profile/api-tokens');
  console.error('   Required permissions: Stream:Edit');
  process.exit(1);
}

// ─── Parse args ────────────────────────────────────────────────────────
// §2026-05-15 fei: 默认放右上角避开 BytePlus 默认 "AI 生成" 水印
// (BytePlus 通常烧在右下),双水印不重叠。
const args = {
  image: null,
  url: 'https://placehold.co/400x100/000000/FFFFFF/png?text=uvera.ai',
  name: 'uvera-ai-branded-watermark',
  position: 'upperRight',  // upperLeft | upperRight | lowerLeft | lowerRight | center
  scale: 0.10,             // 10% of video width
  opacity: 0.65,
  padding: 0.02,           // 2% padding from edge
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--image=')) args.image = a.slice(8);
  else if (a.startsWith('--url=')) args.url = a.slice(6);
  else if (a.startsWith('--name=')) args.name = a.slice(7);
  else if (a.startsWith('--position=')) args.position = a.slice(11);
  else if (a === '--help' || a === '-h') {
    console.log(`Usage:
  node scripts/setup-stream-watermark.mjs [options]

Options:
  --image=<path>    Local image file (PNG/JPEG/GIF)
  --url=<url>       Image URL (default: placehold.co with "uvera.ai" text)
  --name=<string>   Watermark profile name (default: uvera-ai-branded-watermark)
  --position=<pos>  upperLeft | upperRight | lowerLeft | lowerRight | center
                    (default: lowerRight)`);
    process.exit(0);
  }
}

// ─── Load image bytes ──────────────────────────────────────────────────
async function loadImageBytes() {
  if (args.image) {
    const p = path.resolve(args.image);
    if (!fs.existsSync(p)) {
      console.error('❌ Image file not found:', p);
      process.exit(1);
    }
    const buf = fs.readFileSync(p);
    const filename = path.basename(p);
    const ext = path.extname(p).toLowerCase().slice(1);
    const contentType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    return { bytes: buf, filename, contentType };
  }
  // Fetch from URL
  console.log('⬇️  Fetching watermark image from:', args.url);
  const r = await fetch(args.url);
  if (!r.ok) {
    console.error('❌ Image fetch failed:', r.status);
    process.exit(1);
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const contentType = r.headers.get('content-type') || 'image/png';
  const filename = 'uvera-ai-watermark.png';
  return { bytes: buf, filename, contentType };
}

// ─── Upload to CF Stream watermarks API ────────────────────────────────
// POST https://api.cloudflare.com/client/v4/accounts/{id}/stream/watermarks
// multipart/form-data: file + name + opacity + padding + scale + position
async function uploadWatermark({ bytes, filename, contentType }) {
  const form = new FormData();
  const blob = new Blob([bytes], { type: contentType });
  form.append('file', blob, filename);
  form.append('name', args.name);
  form.append('opacity', String(args.opacity));
  form.append('padding', String(args.padding));
  form.append('scale', String(args.scale));
  form.append('position', args.position);

  console.log('⬆️  Uploading to Cloudflare Stream watermarks API…');
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/stream/watermarks`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${CF_API_TOKEN}` },
      body: form,
    }
  );
  const data = await r.json();
  if (!r.ok || !data.success) {
    console.error('❌ Watermark upload failed:', r.status, JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data.result;
}

// ─── Main ──────────────────────────────────────────────────────────────
(async () => {
  const img = await loadImageBytes();
  console.log(`✓ Image loaded: ${img.bytes.length} bytes, ${img.contentType}`);

  const result = await uploadWatermark(img);
  console.log('\n✅ Watermark created successfully!\n');
  console.log('   UID:           ', result.uid);
  console.log('   Name:          ', result.name);
  console.log('   Size:          ', result.size, 'bytes');
  console.log('   Position:      ', result.position);
  console.log('   Scale:         ', result.scale);
  console.log('   Opacity:       ', result.opacity);
  console.log('   Padding:       ', result.padding);
  console.log('   Download URL:  ', result.downloadedFrom || '(uploaded)');
  console.log('\n📋 Next steps:');
  console.log('   1. Persist this UID. Recommended (admin-editable later):');
  console.log('      INSERT INTO public.system_settings (key, value, description) VALUES');
  console.log(`        ('stream_watermark_uid', '${result.uid}',`);
  console.log("         'CF Stream watermark UID applied to free/lite tier video output')");
  console.log("      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;\n");
  console.log('   2. Worker /api/stream/upload-from-url reads it via getSystemSetting');
  console.log('      and includes { watermark: { uid: <UID> } } in CF Stream upload body');
  console.log('      when caller_tier is free or lite.\n');
})();

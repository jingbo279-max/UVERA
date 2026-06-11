/**
 * Copy @ffmpeg/core's ESM build (ffmpeg-core.js + ffmpeg-core.wasm) from
 * node_modules into public/ffmpeg/ so vite picks them up as static assets
 * served from our own origin. Without this, the lazy-load in StoryGenerator's
 * Free Mode / Quick Mode "Combine into one video" merge step fetches from
 * unpkg.com cross-origin, which fails intermittently with "failed to
 * import ffmpeg-core.js".
 *
 * §2026-05-25 fei: switched UMD → ESM.
 *   Vite bundles @ffmpeg/ffmpeg as a MODULE worker (worker.js uses
 *   `import` statements). In a module worker, `importScripts()` throws
 *   unconditionally, so the lib falls back to `await import(coreURL)` and
 *   reads `.default`. The UMD ffmpeg-core attaches createFFmpegCore as
 *   a `self.createFFmpegCore = ...` global with NO ES default export —
 *   so `.default` is undefined → worker throws ERROR_IMPORT_FAILURE
 *   ("failed to import ffmpeg-core.js"). Users hit this on the Combine
 *   button in Quick Mode for ≥2-segment stories.
 *   The ESM build ends with `export default createFFmpegCore` which
 *   satisfies the dynamic-import path. The .wasm payload is byte-identical
 *   between UMD and ESM, so the existing R2 upload doesn't need to change.
 *
 * Run by `npm run build` before vite. The 32MB .wasm is gitignored under
 * public/ffmpeg/* so we don't bloat the repo; the build always reproduces
 * it from node_modules.
 */
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const SRC_DIR = path.resolve(cwd, 'node_modules/@ffmpeg/core/dist/esm');
const DST_DIR = path.resolve(cwd, 'public/ffmpeg');

if (!fs.existsSync(SRC_DIR)) {
  console.warn(`[copy-ffmpeg] @ffmpeg/core not installed; skipping. Run \`npm install\` first.`);
  process.exit(0);
}

fs.mkdirSync(DST_DIR, { recursive: true });

// Remove any leftover ffmpeg-core.wasm from a prior build run. The wasm is
// served from R2, NOT bundled into dist/ (it's larger than the 25 MiB
// Workers Assets limit). If a stale copy is in public/, Vite copies it into
// dist/ and wrangler refuses to deploy.
const stalewasm = path.resolve(DST_DIR, 'ffmpeg-core.wasm');
if (fs.existsSync(stalewasm)) {
  fs.unlinkSync(stalewasm);
  console.log('[copy-ffmpeg] removed stale ffmpeg-core.wasm from public/ffmpeg/ (served from R2 instead)');
}

// Only copy the .js into public/ffmpeg/ for Vite static-asset packaging.
// The .wasm is 32 MB — larger than Cloudflare Workers Assets' 25 MiB
// per-file limit — so we serve it from R2 via a Worker route instead
// (see /ffmpeg/ffmpeg-core.wasm handler in public/_worker.js, and
// scripts/upload-ffmpeg-wasm.sh for the one-time R2 upload step).
const files = ['ffmpeg-core.js'];
for (const f of files) {
  const src = path.resolve(SRC_DIR, f);
  const dst = path.resolve(DST_DIR, f);
  if (!fs.existsSync(src)) {
    console.warn(`[copy-ffmpeg] missing ${f} at ${src}; skipping`);
    continue;
  }
  fs.copyFileSync(src, dst);
  const size = (fs.statSync(dst).size / 1024 / 1024).toFixed(2);
  console.log(`[copy-ffmpeg] ${f} → public/ffmpeg/ (${size} MB)`);
}

// Sanity-check that the .wasm exists in node_modules — operator needs
// to upload it to R2 separately. Surface a friendly reminder if it's
// missing so the build doesn't silently produce a broken merge step.
const wasmPath = path.resolve(SRC_DIR, 'ffmpeg-core.wasm');
if (fs.existsSync(wasmPath)) {
  const size = (fs.statSync(wasmPath).size / 1024 / 1024).toFixed(1);
  console.log(`[copy-ffmpeg] ffmpeg-core.wasm (${size} MB) — served from R2 via Worker, NOT copied to public/. See scripts/upload-ffmpeg-wasm.sh.`);
}

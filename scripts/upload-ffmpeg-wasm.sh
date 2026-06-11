#!/usr/bin/env bash
# One-time upload of @ffmpeg/core's wasm binary (32 MB) to R2.
#
# Why R2: Cloudflare Workers Assets refuses files > 25 MiB. The wasm is
# bigger than that, so we serve it from R2 via a Worker route at
# /ffmpeg/ffmpeg-core.wasm (handler in public/_worker.js).
#
# Run this once after `npm install` so the file lands in the bucket. The
# Worker route then serves it on every request, edge-cached.
#
# Usage:
#   bash scripts/upload-ffmpeg-wasm.sh
#
# Re-run only if @ffmpeg/core gets bumped to a different major/minor — the
# .wasm content changes between releases and clients downloading the new .js
# need the matching .wasm.

set -euo pipefail

WASM_PATH="node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm"

if [ ! -f "$WASM_PATH" ]; then
  echo "❌ $WASM_PATH not found. Run \`npm install\` first."
  exit 1
fi

echo "→ Uploading $WASM_PATH (~32 MB) to R2 bucket 'uvrera' as 'ffmpeg/ffmpeg-core.wasm'..."
npx wrangler r2 object put "uvrera/ffmpeg/ffmpeg-core.wasm" \
  --file "$WASM_PATH" \
  --content-type "application/wasm"

echo "✅ Upload complete. The Worker route /ffmpeg/ffmpeg-core.wasm now serves this file."

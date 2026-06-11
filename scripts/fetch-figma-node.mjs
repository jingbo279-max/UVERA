#!/usr/bin/env node
/**
 * fetch-figma-node.mjs — pull resolved style data for any Figma node.
 *
 * Usage:
 *   node scripts/fetch-figma-node.mjs <node-id>
 *   node scripts/fetch-figma-node.mjs 865:1172
 *
 * What you get (per node):
 *   - bounding box (size)
 *   - fills        — each layer with type / blendMode / opacity / color (resolved)
 *   - strokes      — same; for GRADIENT_LINEAR includes handle positions + stops
 *   - strokeWeight
 *   - effects      — BACKGROUND_BLUR / DROP_SHADOW / INNER_SHADOW with resolved values
 *   - cssGradient  — computed `linear-gradient(...)` snippet (best-effort; trust
 *                    Figma's Code panel angle if discrepancy)
 *
 * Why this exists: Figma MCP's `get_variable_defs` returns var refs as empty
 * strings — gradient internals never expose. REST API `/v1/files/:key/nodes`
 * returns the RESOLVED values inline (post variable dereference). This script
 * is the bridge so we stop eyeballing 168×168 swatches to guess gradient stops.
 *
 * Token: reads FIGMA_TOKEN from .env.local (gitignored). Never echo the token.
 *
 * Token scopes required: file_content:read (variables endpoint and a higher
 * file_variables:read scope are NOT needed — node fills/strokes return resolved
 * gradient data inline).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FILE_KEY = 'lKatfXIfgAii0NHTXenM71'; // UVERA.ai Design

// ── Load token from .env.local (gitignored) ──
function loadToken() {
  const envPath = path.join(ROOT, '.env.local');
  const text = readFileSync(envPath, 'utf8');
  const m = text.match(/^FIGMA_TOKEN=(\S+)/m);
  if (!m) throw new Error('FIGMA_TOKEN not found in .env.local');
  return m[1];
}

// ── Pretty-print a fill / stroke paint ──
function paintToString(p) {
  const blend = p.blendMode || 'NORMAL';
  if (p.type === 'SOLID') {
    const c = p.color;
    const a = (p.opacity != null ? p.opacity : c.a).toFixed(3);
    return `SOLID  rgba(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}, ${a})  blend=${blend}`;
  }
  if (p.type === 'GRADIENT_LINEAR') {
    const stops = p.gradientStops
      .map(s => {
        const c = s.color;
        const a = c.a.toFixed(4);
        const pos = (s.position * 100).toFixed(2);
        return `    ${pos}% → rgba(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}, ${a})`;
      })
      .join('\n');
    const handles = p.gradientHandlePositions
      .map((h, i) => `    handle${i}: (${h.x.toFixed(4)}, ${h.y.toFixed(4)})`)
      .join('\n');
    // Compute approximate CSS angle (best-effort; Figma's 3-handle representation
    // may diverge from this — verify against Code panel display).
    const [h0, h1] = p.gradientHandlePositions;
    const dx = h1.x - h0.x;
    const dy = h1.y - h0.y;
    const angleCss = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    return `GRADIENT_LINEAR  blend=${blend}

  ╔════════════════════════════════════════════════════════════════════╗
  ║  ⛔ STOP — DO NOT COPY POSITIONS BELOW DIRECTLY INTO CSS.          ║
  ║                                                                    ║
  ║  3-way data audit (Leon 5/19 round-25 verified):                   ║
  ║    Design Mode UI    = REST API raw    = axis-internal coords      ║
  ║    Code Mode CSS     = box-visible coords (post-reprojection)      ║
  ║                                                                    ║
  ║  REST/Design positions DO NOT visually match CSS rendering because ║
  ║  gradient handles can extend beyond the box (handle.y > 1).        ║
  ║                                                                    ║
  ║  ✅ ONLY authoritative-for-CSS source: Figma Code Mode panel.       ║
  ║     Ask Leon (or yourself in Figma) for the linear-gradient(...)   ║
  ║     CSS string. 5-second paste. Use that verbatim.                 ║
  ║                                                                    ║
  ║  Round-24 evidence: REST gave (0/40.57/57.44/100); real CSS was    ║
  ║  (2.12/39/54.33/93.02). Visual mismatch ~5-7% — looks wrong.       ║
  ╚════════════════════════════════════════════════════════════════════╝

  approx CSS angle: ${angleCss.toFixed(1)}deg (⚠ also unreliable — Code panel says 157° for this node, REST computes 177°)
  handles:
${handles}
  stops (axis-internal — for ALPHA reference only, NOT positions):
${stops}`;
  }
  return `${p.type}  ${JSON.stringify(p).slice(0, 120)}`;
}

function effectToString(e) {
  const c = e.color;
  // 2026-05-19 round-46 — Figma REST API blur radius → CSS uses 2:1 conversion
  // (Figma model "radius" = 2 × SVG feGaussianBlur stdDeviation = 2 × CSS blur).
  // Round-43 verified: BACKGROUND_BLUR radius=40 → CSS backdrop-filter: blur(20px).
  if (e.type === 'BACKGROUND_BLUR') {
    const cssVal = (e.radius / 2).toFixed(1).replace(/\.0$/, '');
    return `BACKGROUND_BLUR  radius=${e.radius}  →  CSS backdrop-filter: blur(${cssVal}px)`;
  }
  if (e.type === 'LAYER_BLUR') {
    const cssVal = (e.radius / 2).toFixed(1).replace(/\.0$/, '');
    return `LAYER_BLUR  radius=${e.radius}  →  CSS filter: blur(${cssVal}px)  (SVG feGaussianBlur stdDeviation=${cssVal})`;
  }
  if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
    const a = c ? c.a.toFixed(3) : '?';
    const rgb = c ? `${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0}` : '?';
    return `${e.type}  offset=(${e.offset.x},${e.offset.y}) radius=${e.radius}  rgba(${rgb}, ${a})  blend=${e.blendMode || 'NORMAL'}`;
  }
  return `${e.type}  ${JSON.stringify(e).slice(0, 120)}`;
}

// 2026-05-19 round-46 — recursive dump for Component Set variants & nested
// children. Default depth=5 hits typical 4-state component sets + filter
// chains (filter > children > effects).
function dumpNode(n, indent = 0) {
  const pad = '  '.repeat(indent);
  const bb = n.absoluteBoundingBox;
  console.log(`${pad}┌─ [${n.name}] (${n.type})${bb ? ` ${bb.width}×${bb.height}` : ''}`);
  if (n.fills?.length) {
    n.fills.forEach((p, i) => {
      if (p.visible === false) return;
      const s = paintToString(p).split('\n').map(l => `${pad}│   ${l}`).join('\n');
      console.log(`${pad}│ fill[${i}] ${paintToString(p).split('\n')[0]}`);
      const rest = paintToString(p).split('\n').slice(1);
      if (rest.length) rest.forEach(l => console.log(`${pad}│   ${l}`));
    });
  }
  if (n.strokes?.length) {
    n.strokes.forEach((p, i) => {
      if (p.visible === false) return;
      console.log(`${pad}│ stroke[${i}] ${paintToString(p).split('\n')[0]}`);
      const rest = paintToString(p).split('\n').slice(1);
      if (rest.length) rest.forEach(l => console.log(`${pad}│   ${l}`));
    });
    if (n.strokeWeight != null) console.log(`${pad}│   weight=${n.strokeWeight} align=${n.strokeAlign}`);
  }
  if (n.effects?.length) {
    n.effects.forEach((e, i) => {
      if (e.visible === false) return;
      console.log(`${pad}│ effect[${i}] ${effectToString(e)}`);
    });
  }
  if (n.cornerRadius != null) console.log(`${pad}│ corner: ${n.cornerRadius}`);
  if (n.children?.length) {
    for (const c of n.children) dumpNode(c, indent + 1);
  }
  console.log(`${pad}└────`);
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const depthFlag = args.findIndex(a => a === '--depth' || a === '-d');
  const depth = depthFlag >= 0 ? parseInt(args[depthFlag + 1], 10) : 5;
  const nodeIds = args.filter((a, i) => {
    if (depthFlag >= 0 && (i === depthFlag || i === depthFlag + 1)) return false;
    return !a.startsWith('-');
  });
  if (!nodeIds.length) {
    console.error('Usage: node scripts/fetch-figma-node.mjs <node-id> [<node-id> ...] [--depth N]');
    console.error('Default: depth=5, single or multiple node IDs');
    console.error('Example: node scripts/fetch-figma-node.mjs 865:1172');
    console.error('Example: node scripts/fetch-figma-node.mjs 137:9574 137:9572 --depth 3');
    process.exit(1);
  }
  const token = loadToken();
  const url = `https://api.figma.com/v1/files/${FILE_KEY}/nodes?ids=${nodeIds.map(encodeURIComponent).join(',')}&depth=${depth}&geometry=paths`;
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  for (const nodeId of nodeIds) {
    const entry = json.nodes?.[nodeId];
    if (!entry || !entry.document) {
      console.error(`Node ${nodeId} not found. (REST API may see different state than MCP — try canvas-deep-fetch first.)`);
      continue;
    }
    console.log(`\n========== ${nodeId} ==========`);
    dumpNode(entry.document);
  }
  console.log(`\n💡 Reminder: For visual-critical CSS (blur, blend mode, gradient stops):`);
  console.log(`   ALSO ask user to paste Figma Code panel CSS (5-sec paste).`);
  console.log(`   Figma CSS panel applies 2:1 blur conversion + WebKit-specific keywords`);
  console.log(`   (plus-darker, etc.) that REST API doesn't translate.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

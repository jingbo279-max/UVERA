#!/usr/bin/env node

/**
 * sync-design-tokens.js
 *
 * Parses CSS @theme tokens from design-system/tokens/index.css
 * and outputs a Figma-compatible Variables JSON structure.
 *
 * Usage:
 *   node scripts/sync-design-tokens.js              # Output JSON to stdout
 *   node scripts/sync-design-tokens.js --out tokens  # Write to tokens/ directory
 *   node scripts/sync-design-tokens.js --summary     # Print human-readable summary
 *
 * Output structure matches Figma Variable Collections:
 *   - Primitives  (raw-stone-*, raw-violet-*)
 *   - Semantic    (label, background, accent, ...)
 *   - Channel     (channel-home, channel-clips, ...)
 *   - Typography  (font-size-*, font-family-*)
 *   - Spacing     (spacing-*)
 *   - Radius      (radius-*)
 *   - Glass       (glass variant parameters from glass.css)
 *
 * Code → Figma naming: --color-label-secondary → color/label-secondary
 */

import { readFileSync } from 'fs';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOKENS_DIR = join(__dirname, '..', 'src', 'design-system', 'tokens');
const INDEX_CSS = join(TOKENS_DIR, 'index.css');
const GLASS_CSS = join(TOKENS_DIR, 'glass.css');

// ── Parse @theme block ──────────────────────────────────────────────────────

function parseThemeBlock(css) {
  const themeMatch = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!themeMatch) throw new Error('@theme block not found in index.css');

  const tokens = {};
  const varRegex = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = varRegex.exec(themeMatch[1])) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

// ── Parse .dark overrides ───────────────────────────────────────────────────

function parseDarkOverrides(css) {
  const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
  if (!darkMatch) return {};

  const tokens = {};
  const varRegex = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = varRegex.exec(darkMatch[1])) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

// ── Parse glass.css variant variables ───────────────────────────────────────

function parseGlassVariants(css) {
  const variants = {};
  // Match each .liquid-glass-* or .glass-ctrl-* block with --_glass-* variables
  const blockRegex = /\.(liquid-glass[\w-]*|glass-ctrl[\w-]*)\s*\{([^}]*--_glass[^}]*)\}/g;
  let block;
  while ((block = blockRegex.exec(css)) !== null) {
    const name = block[1];
    const vars = {};
    const varRegex = /--_glass-([\w-]+):\s*([^;]+);/g;
    let v;
    while ((v = varRegex.exec(block[2])) !== null) {
      vars[v[1]] = v[2].trim();
    }
    if (Object.keys(vars).length > 0) {
      variants[name] = vars;
    }
  }

  // Parse .dark overrides for glass
  const darkBlocks = css.matchAll(/\.dark\s+\.(liquid-glass[\w-]*|glass-ctrl[\w-]*)\s*\{([^}]*)\}/g);
  const darkOverrides = {};
  for (const db of darkBlocks) {
    const name = db[1];
    const vars = {};
    const varRegex = /--_glass-([\w-]+):\s*([^;]+);/g;
    let v;
    while ((v = varRegex.exec(db[2])) !== null) {
      vars[v[1]] = v[2].trim();
    }
    if (Object.keys(vars).length > 0) {
      darkOverrides[name] = vars;
    }
  }

  return { variants, darkOverrides };
}

// ── Classify tokens into Figma collections ──────────────────────────────────

function classifyTokens(tokens) {
  const collections = {
    Primitives: {},
    Semantic: {},
    Channel: {},
    Typography: {},
    Spacing: {},
    Radius: {},
  };

  for (const [key, value] of Object.entries(tokens)) {
    if (key.startsWith('color-raw-')) {
      collections.Primitives[key] = value;
    } else if (key.startsWith('color-channel-')) {
      collections.Channel[key] = value;
    } else if (key.startsWith('color-')) {
      collections.Semantic[key] = value;
    } else if (key.startsWith('font-')) {
      collections.Typography[key] = value;
    } else if (key.startsWith('spacing-')) {
      collections.Spacing[key] = value;
    } else if (key.startsWith('radius-')) {
      collections.Radius[key] = value;
    }
  }

  return collections;
}

// ── Convert CSS var name to Figma variable path ─────────────────────────────

function toFigmaPath(cssVar) {
  // --color-label-secondary → color/label-secondary
  // --font-size-body → typography/body/size
  // --spacing-lg → spacing/lg
  // --radius-glass → radius/glass
  return cssVar.replace(/-/g, '/').replace(/^\/+/, '');
}

// ── Resolve var() references to final values ────────────────────────────────

function resolveValue(value, allTokens, depth = 0) {
  if (depth > 10) return value; // prevent infinite recursion
  const varMatch = value.match(/var\(--(.+?)\)/);
  if (varMatch && allTokens[varMatch[1]]) {
    return resolveValue(allTokens[varMatch[1]], allTokens, depth + 1);
  }
  return value;
}

// ── Build Figma-compatible output ───────────────────────────────────────────

function buildFigmaJSON(lightTokens, darkTokens, glassData) {
  const collections = classifyTokens(lightTokens);
  const darkCollections = classifyTokens(darkTokens);

  const output = {};

  for (const [collectionName, tokens] of Object.entries(collections)) {
    const variables = {};
    for (const [key, value] of Object.entries(tokens)) {
      const figmaPath = toFigmaPath(key);
      const resolved = resolveValue(value, lightTokens);
      const entry = { light: resolved };

      // Add dark mode value if it exists
      const darkKey = key;
      if (darkCollections[collectionName]?.[darkKey]) {
        entry.dark = resolveValue(darkCollections[collectionName][darkKey], { ...lightTokens, ...darkTokens });
      }

      variables[figmaPath] = entry;
    }
    output[collectionName] = variables;
  }

  // Glass collection
  if (glassData.variants && Object.keys(glassData.variants).length > 0) {
    const glassVars = {};
    for (const [variant, params] of Object.entries(glassData.variants)) {
      for (const [param, value] of Object.entries(params)) {
        const path = `glass/${variant.replace('liquid-glass-', '').replace('liquid-glass', 'regular').replace('glass-ctrl-', 'ctrl-')}/${param}`;
        const entry = { light: value };

        if (glassData.darkOverrides[variant]?.[param]) {
          entry.dark = glassData.darkOverrides[variant][param];
        }

        glassVars[path] = entry;
      }
    }
    output.Glass = glassVars;
  }

  return output;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const summaryMode = args.includes('--summary');
  const outIdx = args.indexOf('--out');
  const outDir = outIdx >= 0 ? args[outIdx + 1] : null;

  // Parse CSS files
  const indexCSS = readFileSync(INDEX_CSS, 'utf-8');
  const glassCSS = readFileSync(GLASS_CSS, 'utf-8');

  const lightTokens = parseThemeBlock(indexCSS);
  const darkTokens = parseDarkOverrides(indexCSS);
  const glassData = parseGlassVariants(glassCSS);

  const figmaJSON = buildFigmaJSON(lightTokens, darkTokens, glassData);

  if (summaryMode) {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║         longvv Design Token → Figma Summary                ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    let total = 0;
    for (const [collection, vars] of Object.entries(figmaJSON)) {
      const count = Object.keys(vars).length;
      total += count;
      const darkCount = Object.values(vars).filter(v => v.dark).length;
      console.log(`  ${collection.padEnd(14)} ${String(count).padStart(3)} variables (${darkCount} with dark mode)`);
    }
    console.log(`  ${'─'.repeat(40)}`);
    console.log(`  ${'Total'.padEnd(14)} ${String(total).padStart(3)} variables\n`);

    // Code ↔ Figma naming examples
    console.log('  Code → Figma 命名映射示例:');
    console.log('  --color-label          → color/label');
    console.log('  --color-label-secondary→ color/label/secondary');
    console.log('  --font-size-body       → font/size/body');
    console.log('  --spacing-lg           → spacing/lg');
    console.log('  --radius-glass         → radius/glass');
    console.log('  liquid-glass-clear bg  → glass/clear/bg\n');
    return;
  }

  if (outDir) {
    const outputPath = join(__dirname, '..', outDir);
    mkdirSync(outputPath, { recursive: true });

    for (const [collection, vars] of Object.entries(figmaJSON)) {
      const filePath = join(outputPath, `${collection.toLowerCase()}.json`);
      writeFileSync(filePath, JSON.stringify(vars, null, 2) + '\n');
      console.log(`  ✓ ${filePath}`);
    }
    console.log(`\n  共 ${Object.keys(figmaJSON).length} 个 collection 已写入 ${outDir}/`);
  } else {
    console.log(JSON.stringify(figmaJSON, null, 2));
  }
}

main();

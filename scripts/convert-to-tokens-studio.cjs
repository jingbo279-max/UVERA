#!/usr/bin/env node
/**
 * convert-to-tokens-studio.js
 * 将 7 个自定义 token JSON 合并为 Tokens Studio (DTCG) 兼容格式
 */

const fs = require('fs');
const path = require('path');

const TOKENS_DIR = path.join(__dirname, '..', 'tokens');

// 源文件 → 顶层 collection 名称
const SOURCES = {
  'primitives.json': 'Primitives',
  'semantic.json': 'Semantic',
  'channel.json': 'Channel',
  'typography.json': 'Typography',
  'spacing.json': 'Spacing',
  'radius.json': 'Radius',
  'glass.json': 'Glass',
};

// 根据 key 前缀和值判断 $type
function inferType(key, value) {
  if (key.startsWith('color/') || key.startsWith('glass/')) {
    return 'color';
  }
  if (key.startsWith('font/family')) {
    return 'fontFamily';
  }
  if (key.startsWith('font/size')) {
    return 'dimension';
  }
  if (key.startsWith('spacing/') || key.startsWith('radius/')) {
    return 'dimension';
  }
  // fallback: check value
  if (typeof value === 'string') {
    if (value.startsWith('#') || value.startsWith('rgba') || value.startsWith('rgb')) {
      return 'color';
    }
    if (/^\d/.test(value) && (value.endsWith('px') || value.endsWith('rem') || value.endsWith('em'))) {
      return 'dimension';
    }
  }
  return 'color'; // safe default
}

// 将 "a/b/c" 路径设置到嵌套对象中
function setNested(obj, segments, tokenNode) {
  let current = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (!current[seg]) current[seg] = {};
    // If current[seg] already has $type (is a leaf), we need to nest it
    // e.g., "color/label" then "color/label/secondary"
    // The leaf "label" needs to stay as-is since DTCG allows groups to also be tokens
    current = current[seg];
  }
  const leaf = segments[segments.length - 1];
  if (current[leaf] && typeof current[leaf] === 'object' && !current[leaf].$type) {
    // merge into existing group
    Object.assign(current[leaf], tokenNode);
  } else {
    current[leaf] = tokenNode;
  }
}

function processFile(filename, collectionName) {
  const filePath = path.join(TOKENS_DIR, filename);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const collection = {};

  for (const [key, modes] of Object.entries(data)) {
    const segments = key.split('/');
    const lightValue = modes.light;
    const darkValue = modes.dark;
    const type = inferType(key, lightValue);

    const tokenNode = {
      $type: type,
      $value: lightValue,
    };

    if (darkValue !== undefined) {
      tokenNode.$extensions = {
        mode: {
          dark: darkValue,
        },
      };
    }

    setNested(collection, segments, tokenNode);
  }

  return collection;
}

// Main
const output = {};
for (const [filename, collectionName] of Object.entries(SOURCES)) {
  output[collectionName] = processFile(filename, collectionName);
}

const outPath = path.join(TOKENS_DIR, 'tokens-studio.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n', 'utf-8');
console.log(`✓ Written to ${outPath}`);
console.log(`  ${Object.keys(output).length} collections, total keys: ${
  Object.values(SOURCES).reduce((sum, name) => {
    return sum + JSON.stringify(output[name]).split('"$type"').length - 1;
  }, 0)
}`);

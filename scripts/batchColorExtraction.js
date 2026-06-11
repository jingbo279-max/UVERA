#!/usr/bin/env node

/**
 * 批量为现有媒体项提取颜色
 * 读取 public/assets/covers 中的所有封面图，自动提取颜色并更新 mediaItems.js
 *
 * 使用方法:
 * node scripts/batchColorExtraction.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'public');
const mediaItemsPath = path.join(projectRoot, 'src/data/mediaItems.js');

// Tailwind 100 级别颜色
const TAILWIND_COLORS_100 = {
  'slate-100': { r: 241, g: 245, b: 249 },
  'gray-100': { r: 243, g: 244, b: 246 },
  'red-100': { r: 254, g: 226, b: 226 },
  'orange-100': { r: 255, g: 237, b: 213 },
  'amber-100': { r: 254, g: 243, b: 199 },
  'yellow-100': { r: 254, g: 249, b: 195 },
  'lime-100': { r: 236, g: 252, b: 203 },
  'green-100': { r: 220, g: 252, b: 231 },
  'emerald-100': { r: 209, g: 250, b: 229 },
  'teal-100': { r: 204, g: 251, b: 241 },
  'cyan-100': { r: 207, g: 250, b: 254 },
  'sky-100': { r: 224, g: 242, b: 254 },
  'blue-100': { r: 219, g: 234, b: 254 },
  'indigo-100': { r: 224, g: 231, b: 255 },
  'violet-100': { r: 237, g: 233, b: 254 },
  'purple-100': { r: 243, g: 232, b: 255 },
  'fuchsia-100': { r: 250, g: 232, b: 255 },
  'pink-100': { r: 252, g: 231, b: 243 },
  'rose-100': { r: 255, g: 228, b: 230 },
};

const BADGE_COLORS = {
  'slate': '#94A3B8',
  'gray': '#9CA3AF',
  'red': '#F87171',
  'orange': '#FB923C',
  'amber': '#FCD34D',
  'yellow': '#FACC15',
  'lime': '#A3E635',
  'green': '#4ADE80',
  'emerald': '#34D399',
  'teal': '#2DD4BF',
  'cyan': '#22D3EE',
  'sky': '#38BDF8',
  'blue': '#60A5FA',
  'indigo': '#818CF8',
  'violet': '#A78BFA',
  'purple': '#A78BFA',
  'fuchsia': '#E879F9',
  'pink': '#F472B6',
  'rose': '#FB7185',
};

function colorDistance(c1, c2) {
  const rDiff = c1.r - c2.r;
  const gDiff = c1.g - c2.g;
  const bDiff = c1.b - c2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

function findClosestColor(rgb) {
  let closest = 'gray-100';
  let minDist = Infinity;

  for (const [name, color] of Object.entries(TAILWIND_COLORS_100)) {
    const dist = colorDistance(rgb, color);
    if (dist < minDist) {
      minDist = dist;
      closest = name;
    }
  }

  return closest;
}

function generateColorProps(colorName) {
  const baseColor = colorName.replace('-100', '');
  return {
    colorName,
    bgColor: `bg-${colorName}`,
    color: `from-${baseColor}-100 to-${baseColor}-300`,
    badgeHex: BADGE_COLORS[baseColor] || '#9CA3AF'
  };
}

// 使用浏览器方式读取图片
console.log('📌 此脚本需要在浏览器环境中运行');
console.log('请改用以下方式批量提取颜色：\n');
console.log('1. 启动开发服务器：npm run dev');
console.log('2. 访问：http://localhost:5173/color-extractor.html');
console.log('3. 批量拖入所有封面图');
console.log('4. 复制生成的代码');
console.log('5. 更新 mediaItems.js\n');
console.log('或者使用页面上的"测试颜色提取"浮动按钮进行单个测试。');

process.exit(0);

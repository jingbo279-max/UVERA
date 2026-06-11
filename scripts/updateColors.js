#!/usr/bin/env node

/**
 * Script to automatically extract colors from cover images
 * and update mediaItems.js with Tailwind 100-level background colors
 *
 * Usage: node scripts/updateColors.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, loadImage } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tailwind CSS color palette (100-level colors only)
const TAILWIND_COLORS_100 = {
  'slate-100': { r: 241, g: 245, b: 249 },
  'gray-100': { r: 243, g: 244, b: 246 },
  'zinc-100': { r: 244, g: 244, b: 245 },
  'neutral-100': { r: 245, g: 245, b: 245 },
  'stone-100': { r: 245, g: 245, b: 244 },
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
  'zinc': '#A1A1AA',
  'neutral': '#A3A3A3',
  'stone': '#A8A29E',
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

function colorDistance(color1, color2) {
  const rDiff = color1.r - color2.r;
  const gDiff = color1.g - color2.g;
  const bDiff = color1.b - color2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

function findClosestTailwindColor(rgb) {
  let closestColor = 'gray-100';
  let minDistance = Infinity;

  for (const [colorName, colorRgb] of Object.entries(TAILWIND_COLORS_100)) {
    const distance = colorDistance(rgb, colorRgb);
    if (distance < minDistance) {
      minDistance = distance;
      closestColor = colorName;
    }
  }

  return closestColor;
}

async function extractDominantColor(imagePath) {
  const img = await loadImage(imagePath);

  const maxSize = 100;
  const scale = Math.min(maxSize / img.width, maxSize / img.height);
  const canvas = createCanvas(Math.floor(img.width * scale), Math.floor(img.height * scale));
  const ctx = canvas.getContext('2d');

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  let r = 0, g = 0, b = 0, count = 0;

  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }

  const avgColor = {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count)
  };

  return findClosestTailwindColor(avgColor);
}

function generateColorProperties(colorName) {
  const baseColor = colorName.replace('-100', '');
  return {
    colorName,
    bgColor: `bg-${colorName}`,
    color: `from-${baseColor}-100 to-${baseColor}-300`,
    badgeHex: BADGE_COLORS[baseColor] || '#9CA3AF'
  };
}

async function processMediaItem(item, publicDir) {
  const coverPath = path.join(publicDir, item.cover);

  if (!fs.existsSync(coverPath)) {
    console.warn(`⚠️  Cover not found: ${coverPath}`);
    return item;
  }

  try {
    const colorName = await extractDominantColor(coverPath);
    const colorProps = generateColorProperties(colorName);

    console.log(`✅ ${item.title}: ${colorName}`);

    return {
      ...item,
      color: colorProps.color,
      badgeHex: colorProps.badgeHex,
      bgColor: colorProps.bgColor
    };
  } catch (error) {
    console.error(`❌ Error processing ${item.title}:`, error.message);
    return item;
  }
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const mediaItemsPath = path.join(projectRoot, 'src/data/mediaItems.js');
  const publicDir = path.join(projectRoot, 'public');

  console.log('🎨 Starting color extraction...\n');

  // Import mediaItems
  const mediaItemsModule = await import(mediaItemsPath);
  const mediaItems = mediaItemsModule.mediaItems;

  // Process each item
  const updatedItems = [];
  for (const item of mediaItems) {
    const updatedItem = await processMediaItem(item, publicDir);
    updatedItems.push(updatedItem);
  }

  // Generate new file content
  const fileContent = `// Media items data with cover images
// Items are mixed by aspect ratio for better visual flow
// Colors automatically extracted from cover images
export const mediaItems = ${JSON.stringify(updatedItems, null, 2)};
`;

  // Write back to file
  fs.writeFileSync(mediaItemsPath, fileContent, 'utf-8');

  console.log('\n✨ Color extraction complete!');
  console.log(`📝 Updated ${updatedItems.length} media items in ${mediaItemsPath}`);
}

main().catch(console.error);

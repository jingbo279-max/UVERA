#!/usr/bin/env node

/**
 * Auto-generate media items configuration from media files
 *
 * Usage:
 *   node scripts/generateMediaConfig.js
 */

const fs = require('fs');
const path = require('path');

// Color schemes for different media types
const COLOR_SCHEMES = {
  single: [
    { color: 'from-purple-100 to-purple-300', badgeHex: '#A78BFA', bgColor: 'bg-purple-100' },
    { color: 'from-blue-100 to-blue-300', badgeHex: '#60A5FA', bgColor: 'bg-blue-100' },
    { color: 'from-pink-100 to-pink-300', badgeHex: '#F472B6', bgColor: 'bg-pink-100' },
  ],
  album: [
    { color: 'from-emerald-100 to-teal-300', badgeHex: '#34D399', bgColor: 'bg-emerald-100' },
    { color: 'from-amber-100 to-orange-300', badgeHex: '#FCD34D', bgColor: 'bg-amber-100' },
  ],
  mv: [
    { color: 'from-cyan-100 to-cyan-300', badgeHex: '#22D3EE', bgColor: 'bg-cyan-100' },
    { color: 'from-fuchsia-100 to-fuchsia-300', badgeHex: '#E879F9', bgColor: 'bg-fuchsia-100' },
  ],
  clip: [
    { color: 'from-amber-100 to-orange-300', badgeHex: '#FCD34D', bgColor: 'bg-amber-100' },
    { color: 'from-lime-100 to-lime-300', badgeHex: '#A3E635', bgColor: 'bg-lime-100' },
  ],
  film: [
    { color: 'from-rose-100 to-rose-300', badgeHex: '#FB7185', bgColor: 'bg-rose-100' },
    { color: 'from-gray-100 to-gray-400', badgeHex: '#9CA3AF', bgColor: 'bg-gray-100' },
  ],
  story: [
    { color: 'from-slate-100 to-slate-400', badgeHex: '#94A3B8', bgColor: 'bg-slate-100' },
    { color: 'from-indigo-100 to-indigo-300', badgeHex: '#818CF8', bgColor: 'bg-indigo-100' },
  ],
  live: [
    { color: 'from-red-100 to-red-300', badgeHex: '#F87171', bgColor: 'bg-red-100' },
    { color: 'from-yellow-100 to-yellow-300', badgeHex: '#FDE047', bgColor: 'bg-yellow-100' },
  ],
  parallel: [
    { color: 'from-violet-100 to-violet-300', badgeHex: '#A78BFA', bgColor: 'bg-violet-100' },
    { color: 'from-teal-100 to-teal-300', badgeHex: '#2DD4BF', bgColor: 'bg-teal-100' },
  ],
};

// Default aspect ratios for each type
const DEFAULT_ASPECT_RATIOS = {
  single: '1/1',
  album: '1/1',
  mv: '9/16',  // Can be 9/16 or 16/9, needs manual check
  clip: '9/16',
  film: '16/9',
  story: '9/16',
  live: '4/3',
  parallel: '1/1',
};

const CATEGORIES = {
  single: 'Single',
  album: 'Album',
  mv: 'MV',
  clip: 'Clips',
  film: 'Film',
  story: 'Story',
  live: 'Live',
  parallel: 'Parallel World',
};

function parseMediaFileName(filename) {
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');
  const hyphenMatch = nameWithoutExt.match(/^(.+?)\s*-\s*(.+)$/);

  if (hyphenMatch) {
    const [, part1, part2] = hyphenMatch;
    return {
      title: part1.trim(),
      artist: part2.trim()
    };
  }

  return {
    title: nameWithoutExt.trim(),
    artist: 'Unknown Artist'
  };
}

function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/['\"""]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function scanMediaFolder(type) {
  const mediaPath = path.join(__dirname, '..', 'public', 'assets', 'media', type);

  if (!fs.existsSync(mediaPath)) {
    return [];
  }

  const files = fs.readdirSync(mediaPath);
  return files.filter(f => /\.(mp4|mp3|mov|avi|webm)$/i.test(f));
}

function generateMediaItems() {
  const types = Object.keys(CATEGORIES);
  const allItems = [];
  let currentId = 1;

  types.forEach(type => {
    const files = scanMediaFolder(type);
    const colorSchemes = COLOR_SCHEMES[type];

    files.forEach((filename, index) => {
      const { title, artist } = parseMediaFileName(filename);
      const coverName = toKebabCase(title);
      const colorScheme = colorSchemes[index % colorSchemes.length];

      allItems.push({
        id: currentId++,
        type,
        category: CATEGORIES[type],
        title,
        artist,
        cover: `/assets/covers/${type}/${coverName}.jpg`,
        ...colorScheme,
        aspectRatio: DEFAULT_ASPECT_RATIOS[type]
      });
    });
  });

  return allItems;
}

// Main execution
const items = generateMediaItems();

console.log('Generated media items:');
console.log(JSON.stringify(items, null, 2));

console.log('\n📊 Summary:');
console.log(`Total items: ${items.length}`);

const typeCount = items.reduce((acc, item) => {
  acc[item.type] = (acc[item.type] || 0) + 1;
  return acc;
}, {});

Object.entries(typeCount).forEach(([type, count]) => {
  console.log(`  ${type}: ${count}`);
});

// Optionally write to file
const outputPath = path.join(__dirname, '..', 'src', 'data', 'mediaItems.generated.js');
const output = `// Auto-generated media items
export const mediaItems = ${JSON.stringify(items, null, 2)};
`;

fs.writeFileSync(outputPath, output);
console.log(`\n✅ Written to: ${outputPath}`);

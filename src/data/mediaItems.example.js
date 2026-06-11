// Example: How to use mediaParser to generate media items from file names

import { generateMediaItem } from '../utils/mediaParser';

// Example 1: Parse from file name "Don't Start Now-Dua Lipa.mp4"
const mvItem = generateMediaItem({
  id: 13,
  type: 'mv',
  category: 'MV',
  filename: "Don't Start Now-Dua Lipa.mp4",
  color: 'from-cyan-100 to-cyan-300',
  badgeHex: '#22D3EE',
  bgColor: 'bg-cyan-100',
  aspectRatio: '9/16'
});

console.log(mvItem);
// Output:
// {
//   id: 13,
//   type: 'mv',
//   category: 'MV',
//   title: "Don't Start Now",
//   artist: 'Dua Lipa',
//   cover: '/assets/covers/mv/dont-start-now.jpg',
//   color: 'from-cyan-100 to-cyan-300',
//   badgeHex: '#22D3EE',
//   bgColor: 'bg-cyan-100',
//   aspectRatio: '9/16'
// }

// Example 2: Batch generate from file list
const mvFiles = [
  { filename: "Don't Start Now-Dua Lipa.mp4", aspectRatio: '16/9' },
  { filename: "Blinding Lights-The Weeknd.mp4", aspectRatio: '9/16' },
  { filename: "Levitating-Dua Lipa.mp4", aspectRatio: '16/9' },
];

const mvItems = mvFiles.map((file, index) =>
  generateMediaItem({
    id: 100 + index,
    type: 'mv',
    category: 'MV',
    filename: file.filename,
    color: 'from-cyan-100 to-cyan-300',
    badgeHex: '#22D3EE',
    bgColor: 'bg-cyan-100',
    aspectRatio: file.aspectRatio
  })
);

console.log(mvItems);

// Example 3: Manual parsing
import { parseMediaFileName, toKebabCase } from '../utils/mediaParser';

const filename = "Crystal Waves-Echo Dreams.mp4";
const { title, artist } = parseMediaFileName(filename);
const coverPath = `/assets/covers/mv/${toKebabCase(title)}.jpg`;

console.log({ title, artist, coverPath });
// Output: { title: 'Crystal Waves', artist: 'Echo Dreams', coverPath: '/assets/covers/mv/crystal-waves.jpg' }

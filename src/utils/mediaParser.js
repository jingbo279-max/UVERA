/**
 * Parse media file name to extract title and artist
 *
 * Supported formats:
 * - "Title-Artist.ext" → { title: "Title", artist: "Artist" }
 * - "Artist - Title.ext" → { title: "Title", artist: "Artist" }
 * - "Title.ext" → { title: "Title", artist: "Unknown Artist" }
 *
 * @param {string} filename - The media file name
 * @returns {Object} - { title: string, artist: string }
 */
export function parseMediaFileName(filename) {
  // Remove file extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  // Try to split by hyphen (with optional spaces)
  // Pattern 1: "Title-Artist" or "Title - Artist"
  const hyphenMatch = nameWithoutExt.match(/^(.+?)\s*-\s*(.+)$/);

  if (hyphenMatch) {
    const [, part1, part2] = hyphenMatch;

    // Check if first part looks like an artist (common pattern: Artist - Title)
    // We'll assume format is "Title-Artist" by default
    return {
      title: part1.trim(),
      artist: part2.trim()
    };
  }

  // If no hyphen found, return the whole name as title
  return {
    title: nameWithoutExt.trim(),
    artist: 'Unknown Artist'
  };
}

/**
 * Convert title to kebab-case for file paths
 * "Don't Start Now" → "dont-start-now"
 *
 * @param {string} title - The title string
 * @returns {string} - Kebab-case string
 */
export function toKebabCase(str) {
  return str
    .toLowerCase()
    .replace(/['\"""]/g, '') // Remove quotes and apostrophes
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Generate media item from file name
 *
 * @param {Object} config - Configuration object
 * @param {number} config.id - Item ID
 * @param {string} config.type - Media type (single, mv, album, etc.)
 * @param {string} config.category - Display category
 * @param {string} config.filename - File name
 * @param {string} config.color - Gradient color
 * @param {string} config.badgeHex - Badge color hex
 * @param {string} config.bgColor - Background color class
 * @param {string} config.aspectRatio - Aspect ratio
 * @returns {Object} - Media item object
 */
export function generateMediaItem({
  id,
  type,
  category,
  filename,
  color,
  badgeHex,
  bgColor,
  aspectRatio
}) {
  const { title, artist } = parseMediaFileName(filename);
  const coverName = toKebabCase(title);

  return {
    id,
    type,
    category,
    title,
    artist,
    cover: `/assets/covers/${type}/${coverName}.jpg`,
    color,
    badgeHex,
    bgColor,
    aspectRatio
  };
}

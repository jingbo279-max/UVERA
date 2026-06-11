/**
 * Color extraction utility to generate background colors from cover images
 * Matches extracted colors to Tailwind CSS 100-level colors
 */

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

/**
 * Calculate Euclidean distance between two RGB colors
 */
function colorDistance(color1, color2) {
  const rDiff = color1.r - color2.r;
  const gDiff = color1.g - color2.g;
  const bDiff = color1.b - color2.b;
  return Math.sqrt(rDiff * rDiff + gDiff * gDiff + bDiff * bDiff);
}

/**
 * Convert RGB to HSL (Hue, Saturation, Lightness)
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Find the closest Tailwind 100-level color to the given RGB color
 * Uses HSL color space for better hue matching
 */
function findClosestTailwindColor(rgb) {
  // Convert input color to HSL
  const inputHsl = rgbToHsl(rgb.r, rgb.g, rgb.b);

  let closestColor = 'gray-100';
  let minDistance = Infinity;

  // For each Tailwind color, compare hue (ignore lightness since all are 100-level)
  for (const [colorName, colorRgb] of Object.entries(TAILWIND_COLORS_100)) {
    const tailwindHsl = rgbToHsl(colorRgb.r, colorRgb.g, colorRgb.b);

    // Calculate hue distance (circular, 0-360)
    let hueDiff = Math.abs(inputHsl.h - tailwindHsl.h);
    if (hueDiff > 180) hueDiff = 360 - hueDiff;

    // Weight hue heavily, saturation moderately
    const distance = hueDiff * 2 + Math.abs(inputHsl.s - tailwindHsl.s) * 0.5;

    if (distance < minDistance) {
      minDistance = distance;
      closestColor = colorName;
    }
  }

  return closestColor;
}

/**
 * Extract dominant color from an image using Canvas API
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<{colorName: string, rgb: object}>} - Tailwind color name and RGB values
 */
export async function extractDominantColor(imagePath) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      try {
        // Create canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Use moderate size for good balance
        const maxSize = 150;
        const scale = Math.min(maxSize / img.width, maxSize / img.height);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;

        // Draw image
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Get full image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // Collect color samples with proper filtering
        const colorSamples = [];

        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          // Skip transparent pixels
          if (a < 10) continue;

          // Skip very dark colors (black background/hair)
          const brightness = (r + g + b) / 3;
          if (brightness < 30) continue;

          // Skip very light colors (overexposed/white)
          if (brightness > 240) continue;

          // Calculate HSL saturation
          const hsl = rgbToHsl(r, g, b);

          // Skip low saturation (gray tones)
          if (hsl.s < 8) continue;

          colorSamples.push({ r, g, b, hsl, brightness });
        }

        // If too few samples, relax filters
        if (colorSamples.length < 100) {
          colorSamples.length = 0;
          for (let i = 0; i < data.length; i += 16) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const a = data[i + 3];

            if (a < 10) continue;

            const brightness = (r + g + b) / 3;
            if (brightness < 20 || brightness > 245) continue;

            const hsl = rgbToHsl(r, g, b);
            colorSamples.push({ r, g, b, hsl, brightness });
          }
        }

        // Sort by saturation (most colorful first)
        colorSamples.sort((a, b) => b.hsl.s - a.hsl.s);

        // Take top 30% most saturated colors
        const topColors = colorSamples.slice(0, Math.ceil(colorSamples.length * 0.3));

        // Calculate average
        let r = 0, g = 0, b = 0;
        for (const sample of topColors) {
          r += sample.r;
          g += sample.g;
          b += sample.b;
        }

        const avgColor = {
          r: Math.round(r / topColors.length),
          g: Math.round(g / topColors.length),
          b: Math.round(b / topColors.length)
        };

        // Find closest Tailwind color
        const colorName = findClosestTailwindColor(avgColor);

        resolve({
          colorName,
          rgb: avgColor,
          tailwindRgb: TAILWIND_COLORS_100[colorName]
        });
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${imagePath}`));
    };

    img.src = imagePath;
  });
}

/**
 * Generate bgColor class name from Tailwind color name
 * @param {string} colorName - e.g., "cyan-100"
 * @returns {string} - e.g., "bg-cyan-100"
 */
export function generateBgColorClass(colorName) {
  return `bg-${colorName}`;
}

/**
 * Generate gradient color classes for card backgrounds
 * Pairs the 100-level color with a 300-level color of the same hue
 * @param {string} colorName - e.g., "cyan-100"
 * @returns {string} - e.g., "from-cyan-100 to-cyan-300"
 */
export function generateGradientClass(colorName) {
  const baseColor = colorName.replace('-100', '');
  return `from-${baseColor}-100 to-${baseColor}-300`;
}

/**
 * Extract badge hex color (approximate from Tailwind color)
 * Uses the 400-level color for badges for better visibility
 * @param {string} colorName - e.g., "cyan-100"
 * @returns {string} - Hex color for badge
 */
export function generateBadgeHex(colorName) {
  const badgeColors = {
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

  const baseColor = colorName.replace('-100', '');
  return badgeColors[baseColor] || '#9CA3AF';
}

/**
 * Process a cover image and generate all color-related properties
 * @param {string} coverPath - Path to cover image
 * @returns {Promise<object>} - Object with color, bgColor, badgeHex, gradientClass
 */
export async function processImageColors(coverPath) {
  const { colorName } = await extractDominantColor(coverPath);

  return {
    colorName,
    bgColor: generateBgColorClass(colorName),
    color: generateGradientClass(colorName),
    badgeHex: generateBadgeHex(colorName)
  };
}

export default {
  extractDominantColor,
  generateBgColorClass,
  generateGradientClass,
  generateBadgeHex,
  processImageColors,
  TAILWIND_COLORS_100
};

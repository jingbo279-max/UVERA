import { useEffect, useRef } from 'react';

/**
 * CreateSpotlightCanvas — Dark mode only spotlight via Canvas 2D + Floyd-Steinberg
 * error diffusion dithering. Renders the radial gradient that .bg-mesh would
 * have rendered via CSS, but with proper dithering that completely eliminates
 * 8-bit quantization banding (which CSS radial-gradient on macOS Chrome cannot do).
 *
 * Why Floyd-Steinberg and not white noise:
 *   Floyd-Steinberg distributes per-pixel quantization error to 4 neighbors
 *   (7/16 right, 3/16 below-left, 5/16 below, 1/16 below-right). Result: 8-bit
 *   output where LOCAL AVERAGE matches float source exactly — visually
 *   indistinguishable from 16-bit precision gradient. This is the industry
 *   standard (Photoshop, ImageMagick all use this).
 *
 *   White noise dithering (Math.random) sometimes leaves "fuzz" in dark gradients
 *   because random per-pixel doesn't guarantee local averages match the source.
 *   Floyd-Steinberg guarantees this mathematically.
 *
 * Reads CSS vars from `[data-channel="create"]`:
 *   --create-spotlight-y         center Y (% of viewport)
 *   --create-spotlight-w/-h      ellipse semi-axes (% of viewport)
 *   --create-spotlight-alpha     peak alpha
 *   --create-spotlight-color     RGB triplet (e.g., "20, 42, 48")
 *
 * Re-paints on: viewport resize (rAF debounced) + theme class change.
 *
 * Mounted only when BG_CHANNEL[activeSection] === 'create' && dark in index.jsx.
 * Cost: ~1.1M pixels at viewport 1440×780 → ~30-50ms paint, one-shot per
 * resize/theme change.
 */
export default function CreateSpotlightCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let rafId = null;

    const paint = () => {
      const root = document.querySelector('[data-channel="create"]');
      if (!root) return;
      const css = getComputedStyle(root);

      // Spotlight params
      const y     = (parseFloat(css.getPropertyValue('--create-spotlight-y')) || 51) / 100;
      const w     = (parseFloat(css.getPropertyValue('--create-spotlight-w')) || 102) / 100;
      const h     = (parseFloat(css.getPropertyValue('--create-spotlight-h')) || 41) / 100;
      const alpha = parseFloat(css.getPropertyValue('--create-spotlight-alpha')) || 0.80;
      const colorStr = (css.getPropertyValue('--create-spotlight-color').trim() || '20, 42, 48');
      const [R, G, B] = colorStr.split(',').map(s => parseInt(s.trim(), 10));

      // Top-light cone params (trapezoid + feathered edges)
      const coneY     = (parseFloat(css.getPropertyValue('--create-top-light-y')) || 0) / 100;
      const coneH     = (parseFloat(css.getPropertyValue('--create-top-light-h')) || 41) / 100;
      const coneTopW  = (parseFloat(css.getPropertyValue('--create-top-light-top-w')) || 21) / 100;
      const coneBotW  = (parseFloat(css.getPropertyValue('--create-top-light-bottom-w')) || 60) / 100;
      const coneAlpha = parseFloat(css.getPropertyValue('--create-top-light-alpha')) || 0.50;
      const coneBlur  = parseFloat(css.getPropertyValue('--create-top-light-blur')) || 3.5;
      const coneColorStr = (css.getPropertyValue('--create-top-light-color').trim() || '20, 42, 48');
      const [coneR, coneG, coneB] = coneColorStr.split(',').map(s => parseInt(s.trim(), 10));

      // Read bg color so we can pre-composite ourselves at float precision
      // (避开 browser 8-bit alpha compositing 把 dither 吃掉)
      const bgStr = (css.getPropertyValue('--create-bg').trim() || '#131516');
      const bgHex = bgStr.replace('#', '');
      const bgR = parseInt(bgHex.substring(0, 2), 16);
      const bgG = parseInt(bgHex.substring(2, 4), 16);
      const bgB = parseInt(bgHex.substring(4, 6), 16);

      // Cap DPR at 1 — high-DPI loops too slow (4M+ pixels JS-side).
      // 8-bit dithering visually invisible at viewport resolution.
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      const W = cssW;
      const H = cssH;
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';

      const ctx = canvas.getContext('2d');

      // 11-stop linear curve alpha = (1-t)^1 — maximum spread without going
      // to sqrt territory。比 quad 在 t=0.5 处 alpha 高 2x (0.5 vs 0.25),
      // 亮度从中心到边缘均匀衰减,漫射范围最大。
      const stops = [
        [0.00, 1.000],
        [0.10, 0.900],
        [0.20, 0.800],
        [0.30, 0.700],
        [0.40, 0.600],
        [0.50, 0.500],
        [0.60, 0.400],
        [0.70, 0.300],
        [0.80, 0.200],
        [0.90, 0.100],
        [1.00, 0.000],
      ];

      const cx = W * 0.5;
      const cy = H * y;
      const rx = W * (w / 2);
      const ry = H * (h / 2);

      // Cone trapezoid edges (in % of viewport, then scaled to pixels)
      // SVG feGaussianBlur stdDev=3.5 in viewBox 100 → ~50px feather at W=1440
      const coneTopY = coneY * H;
      const coneBotY = (coneY + coneH) * H;
      const featherPx = coneBlur * W / 100;  // ~50px at W=1440
      // smoothstep helper: 0→1 transition over [0, 1]
      const smoothstep = (t) => {
        if (t <= 0) return 0;
        if (t >= 1) return 1;
        return t * t * (3 - 2 * t);
      };

      // Pass 1: compute FINAL composited RGB at each pixel (float64).
      // Composite stack: bg → spotlight → cone (top-light)。
      // All blending in float精度,避开 browser 8-bit alpha compositing。
      // 写 OPAQUE (alpha=255) Canvas 像素绕过 browser compositing。
      const rChan = new Float32Array(W * H);
      const gChan = new Float32Array(W * H);
      const bChan = new Float32Array(W * H);
      for (let py = 0; py < H; py++) {
        const ndy = (py - cy) / ry;
        const ndy2 = ndy * ndy;
        // Cone vertical position normalize (0 at top of cone, 1 at bottom)
        const coneTRaw = (py - coneTopY) / (coneBotY - coneTopY);
        for (let px = 0; px < W; px++) {
          // --- Spotlight contribution ---
          const ndx = (px - cx) / rx;
          const dist = Math.sqrt(ndx * ndx + ndy2);
          let spotMult;
          if (dist >= 1) {
            spotMult = 0;
          } else {
            let i = 0;
            while (i < stops.length - 1 && dist > stops[i + 1][0]) i++;
            const t = (dist - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
            spotMult = stops[i][1] + t * (stops[i + 1][1] - stops[i][1]);
          }
          const spotA = spotMult * alpha;

          // bg + spotlight composite
          let r = bgR + (R - bgR) * spotA;
          let g = bgG + (G - bgG) * spotA;
          let b = bgB + (B - bgB) * spotA;

          // --- Cone contribution (only if inside vertical range) ---
          if (coneTRaw >= 0 && coneTRaw <= 1) {
            // Trapezoid half-width at this y (lerps top → bottom)
            const halfW = (coneTopW + (coneBotW - coneTopW) * coneTRaw) / 2;
            const leftX = W * (0.5 - halfW);
            const rightX = W * (0.5 + halfW);
            // Smoothstep horizontal feather
            let hAlpha;
            if (px <= leftX - featherPx || px >= rightX + featherPx) {
              hAlpha = 0;
            } else if (px >= leftX + featherPx && px <= rightX - featherPx) {
              hAlpha = 1;
            } else if (px < leftX + featherPx) {
              hAlpha = smoothstep((px - (leftX - featherPx)) / (2 * featherPx));
            } else {
              hAlpha = smoothstep(((rightX + featherPx) - px) / (2 * featherPx));
            }
            // Vertical alpha gradient: peak at top, easeOutQuad fade to 0
            // at bottom (1-t)^2 → 比 linear 平滑融入,底部边界不可见
            const oneMinusT = 1 - coneTRaw;
            const vAlpha = oneMinusT * oneMinusT * coneAlpha;
            const coneA = vAlpha * hAlpha;

            r = r + (coneR - r) * coneA;
            g = g + (coneG - g) * coneA;
            b = b + (coneB - b) * coneA;
          }

          const idx = py * W + px;
          rChan[idx] = r;
          gChan[idx] = g;
          bChan[idx] = b;
        }
      }

      // Pass 2: Floyd-Steinberg + white noise dither on EACH RGB channel.
      // Per-pixel ±0.5 noise breaks deterministic FS micro-stepping. FS error
      // diffusion preserves local average. Result: 8-bit output with
      // float-precision local averages, banding mathematically impossible.
      const fsDither = (chan) => {
        for (let py = 0; py < H; py++) {
          for (let px = 0; px < W; px++) {
            const idx = py * W + px;
            const oldV = chan[idx];
            const noise = Math.random() - 0.5;
            let newV = oldV + noise + 0.5;
            if (newV < 0) newV = 0;
            else if (newV > 255) newV = 255;
            newV = newV | 0;
            chan[idx] = newV;
            const err = oldV - newV;
            if (px + 1 < W) chan[idx + 1] += err * (7 / 16);
            if (py + 1 < H) {
              if (px > 0)     chan[idx + W - 1] += err * (3 / 16);
                              chan[idx + W]     += err * (5 / 16);
              if (px + 1 < W) chan[idx + W + 1] += err * (1 / 16);
            }
          }
        }
      };
      fsDither(rChan);
      fsDither(gChan);
      fsDither(bChan);

      // Pass 3: write opaque pixels to ImageData (alpha=255, no browser compositing)
      const imageData = ctx.createImageData(W, H);
      const data = imageData.data;
      for (let i = 0; i < W * H; i++) {
        const idx = i * 4;
        data[idx]     = rChan[i];
        data[idx + 1] = gChan[i];
        data[idx + 2] = bChan[i];
        data[idx + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
    };

    const schedulePaint = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        paint();
      });
    };

    schedulePaint();

    window.addEventListener('resize', schedulePaint);
    const themeObserver = new MutationObserver(schedulePaint);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('resize', schedulePaint);
      themeObserver.disconnect();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

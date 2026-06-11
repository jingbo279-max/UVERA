import React from 'react';

/**
 * ActivityIndicator — visionOS spec (Figma node 487:12235)
 *
 * 8-bar step-rotating spinner. Apple HIG Progress Indicator (indeterminate).
 * Bars at 45° intervals around the center, opacity decays 0.8 → 0.1 from
 * the 12-o'clock leader bar clockwise. Container rotates with `steps(8)`
 * at 1s/revolution — the bright leader appears to chase around the ring.
 *
 * Linear rotation breaks the perceptual feel; `steps(8)` is required for
 * the canonical Apple spinner motion (every 125ms snaps to the next slot).
 *
 * Sizes: Small 20×20 / Medium 28×28 / Large 44×44 (Figma authoritative).
 * Bar dimensions are derived from Figma percentage insets:
 *   width  ≈ 13.34% of container (Medium/Large) / 13.64% (Small)
 *   height ≈ 33.33% of container (Medium/Large) / 31.82% (Small)
 *   radius 1.5px Small / 4px Medium·Large
 */

const SIZES = {
  Small:  { box: 20, w: 2.73, h: 6.36,  r: 1.5 },
  Medium: { box: 28, w: 3.74, h: 9.33,  r: 4 },
  Large:  { box: 44, w: 5.87, h: 14.67, r: 4 },
};

const OPACITIES = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

export default function ActivityIndicator({
  size = 'Medium',
  className = '',
  style,
  color = 'rgba(255, 255, 255, 1)',
}) {
  const s = SIZES[size] || SIZES.Medium;
  return (
    <div
      className={`activity-indicator-spin ${className}`.trim()}
      style={{
        position: 'relative',
        width: `${s.box}px`,
        height: `${s.box}px`,
        ...style,
      }}
      role="status"
      aria-label="Loading"
    >
      {OPACITIES.map((opacity, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            width: `${s.w}px`,
            height: `${s.h}px`,
            marginLeft: `${-s.w / 2}px`,
            borderRadius: `${s.r}px`,
            background: color,
            opacity,
            transformOrigin: `50% ${s.box / 2}px`,
            transform: `rotate(${i * 45}deg)`,
          }}
        />
      ))}
    </div>
  );
}

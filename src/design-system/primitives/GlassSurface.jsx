import React from 'react';

/**
 * GlassSurface — Apple Liquid Glass multi-layer component
 *
 * Faithfully replicates the Figma layering (node 28:77 _Controls - Lock Screen):
 *   Layer 1  backdrop-blur(40px)               — frosted glass base
 *   Layer 2  rgba(0,0,0,0.08) + blur(20px)     — shadow / depth (mix-blend-hard-light)
 *   Layer 3  rgba(255,255,255,0.07)             — glass sheen    (mix-blend-screen)
 *   Layer 4  children                           — content
 *
 * Props:
 *   variant   "clear" (default) | "regular" | "dark"
 *   className  applied to the outer wrapper (size, shape, positioning, transitions)
 *   style      inline styles for the outer wrapper
 *   onClick / onPointerDown / ...rest  forwarded to outer div
 */
export default function GlassSurface({ variant = 'clear', className = '', style, children, ...rest }) {
  const tint = {
    clear:   { sheen: 'rgba(255,255,255,0.07)', shadow: 'rgba(0,0,0,0.08)',  border: 'rgba(255,255,255,0.15)' },
    regular: { sheen: 'rgba(255,255,255,0.14)', shadow: 'rgba(0,0,0,0.10)',  border: 'rgba(255,255,255,0.42)' },
    dark:    { sheen: 'rgba(0,0,0,0.18)',        shadow: 'rgba(0,0,0,0.20)',  border: 'rgba(255,255,255,0.14)' },
  }[variant] ?? {};

  return (
    <div className={`relative overflow-hidden ${className}`} style={style} {...rest}>

      {/* Layer 1 — backdrop blur */}
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{ backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}
      />

      {/* Layer 2 — depth shadow (mix-blend-hard-light) */}
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background:   tint.shadow,
          filter:       'blur(20px)',
          mixBlendMode: 'hard-light',
        }}
      />

      {/* Layer 3 — glass sheen (mix-blend-screen) + border */}
      <div
        className="absolute inset-0 rounded-[inherit]"
        style={{
          background:   tint.sheen,
          mixBlendMode: 'screen',
          boxShadow:    `inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.08)`,
          border:       `1px solid ${tint.border}`,
        }}
      />

      {/* Layer 4 — content */}
      <div className="relative">{children}</div>
    </div>
  );
}

import React, { useId } from 'react';

/**
 * GlassPane — visionOS Windows/Glass panel utility (Figma node 139:23912 /
 * swatch 865:1172)
 *
 * 2026-05-19 round-32 (Leon) — 抽出 React wrapper 复用 .glass-pane-container
 * + inline SVG stroke overlay。之前 SparkMode 单 use site,B2 推广到 Create /
 * Library 各 pane 之前先抽组件。
 *
 * 4-layer stack(全在 .glass-pane-container utility CSS 里 + 本组件):
 *   · parent (Component as):     drop shadow + border-radius:20px + overflow:hidden
 *   · ::before (z:0):            backdrop-filter blur(50px)
 *   · ::after  (z:1):            rgba(128,128,128,0.30) + mix-blend luminosity
 *   · SVG overlay (z:2):         157deg/4-stop stroke gradient via Skia
 *   · content wrapper (z:3):     {children}
 *
 * Stroke spec(visual-verified 2026-05-19 Leon round-32):
 *   gradient axis:        objectBoundingBox (0,0) → (0.42, 1) ≈ CSS 157°
 *   stops:                2.12%/39%/54.33%/93.02% with alpha 0.40/0/0/0.10
 *   visible stroke width: 1.4px (Figma authoritative, SVG strokeWidth="2.8"
 *                          center-aligned, outer half clipped by overflow:hidden)
 *
 * Visual test note: 1.4px vs 1.0px 在 SparkMode dark backdrop 实测视觉无明显
 * 差异(Leon round-32 决策),仍保留 1.4 跟 Figma authoritative 一致。
 *
 * SVG paint server 走 Skia GPU,跟 Figma render 引擎同源 → 跨 browser 视觉
 * parity。这是 round-30 切换 CSS gradient border → SVG paint server 的关键
 * 原因(CSS gradient engine 在 1.4px 极端 alpha gradient 上 render 偏弱)。
 *
 * Usage:
 *   <GlassPane as="aside" className="..." style={{ width: 440 }}>
 *     {content}
 *   </GlassPane>
 *
 *   // contentClassName 覆盖默认 z-[3] wrapper:
 *   <GlassPane contentClassName="relative z-[3] custom-flex">
 *     {content}
 *   </GlassPane>
 *
 * @param {object} props
 * @param {string|React.ElementType} [props.as='div'] - Render as tag (e.g. 'aside', 'section')
 * @param {string} [props.className] - Additional class on outer container
 * @param {object} [props.style] - Inline style on outer container
 * @param {string} [props.contentClassName='relative z-[3] flex flex-col flex-1 min-h-0'] - Inner content wrapper class
 * @param {number} [props.radius=20] - Border radius in px (also drives SVG stroke corner rx). Default 20 = Figma Windows/Glass authoritative. Use 32 for hero glass (--radius-glass).
 * @param {React.ReactNode} props.children - Panel content
 */
export function GlassPane({
  as: Component = 'div',
  className = '',
  style,
  contentClassName = 'relative z-[3] flex flex-col flex-1 min-h-0',
  radius = 20,
  children,
  ...rest
}) {
  // useId per-instance unique gradient ID,避免多 GlassPane 实例 id 冲突
  const gradientId = useId();

  return (
    <Component
      className={`glass-pane-container ${className}`.trim()}
      style={{ borderRadius: `${radius}px`, ...style }}
      {...rest}
    >
      {/* SVG stroke overlay (z:2) — Figma 157deg/4-stop authoritative
       * via Skia paint server。strokeWidth=2.8 center-aligned,内半 1.4px
       * 在 panel 内可见 = Figma 1.4px inside-aligned stroke。 */}
      <svg
        width="100%"
        height="100%"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          pointerEvents: 'none',
          zIndex: 2,
        }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Stop color/opacity via CSS class — light/dark variants 在
           * glass.css 控制 (.glass-pane-stop-N { stop-color, stop-opacity })。
           * SVG `stop-color`/`stop-opacity` 是 CSS presentation attribute,
           * 浏览器支持充分。round-33 增加 light mode (black stroke). */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0.42" y2="1">
            <stop offset="2.12%" className="glass-pane-stop-1" />
            <stop offset="39%" className="glass-pane-stop-2" />
            <stop offset="54.33%" className="glass-pane-stop-3" />
            <stop offset="93.02%" className="glass-pane-stop-4" />
          </linearGradient>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx={radius}
          ry={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="2.8"
        />
      </svg>
      <div className={contentClassName}>{children}</div>
    </Component>
  );
}

export default GlassPane;

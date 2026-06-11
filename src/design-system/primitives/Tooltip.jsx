import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Tooltip — visionOS spec (Figma node 904:78, file lKatfXIfgAii0NHTXenM71)
 *
 * 2026-05-27 Leon round-78 — 抽 design-system primitive (跟 <TextField>,
 * <Checkbox> 同等级) 让所有 chip / icon-only button hover 时浮出
 * visionOS-style 浮层提示。
 *
 * Figma authoritative spec (REST API depth-fetch):
 *   INSTANCE "Tooltip" 64×32 (含 8px top padding 给 arrow,bezel 24 高)
 *   corner: 200 (pill rounded-full)
 *   Bezel fills: rgba(255,255,255,0.030) LUMINOSITY + rgba(127,127,127,0.150)
 *                COLOR_BURN
 *   Bezel stroke: GRADIENT_LINEAR 4-stop white 0.45/0.0001/0.0001/0.15, 0.75px
 *   Bezel effect: BACKGROUND_BLUR 136 → CSS backdrop-filter blur(68px)
 *   Text: rgba(255,255,255,0.96) text-xs
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * v4 — React Portal 逃 ancestor overflow:hidden clip:
 *
 * 之前 v3 Tooltip 是 trigger 的 absolute child,如果 trigger 在 GlassPane
 * (overflow:hidden) 边缘,tooltip 超出 trigger 那侧被 GlassPane 裁切 → 文字
 * 不完整。v4 用 createPortal 把 tooltip 渲染到 document.body,position:fixed
 * 相对 viewport,不受 ancestor clip 影响 (跟 macOS native NSPopover 一致)。
 *
 * Position calculation:
 *   - 测 trigger.getBoundingClientRect() 拿 viewport-relative position
 *   - tooltip center 对齐 trigger center X (left = triggerCenterX - tipW/2)
 *   - isTop:tooltip bottom 在 trigger top 上方 4px (top = triggerTop - tipH - 4)
 *   - isBottom:tooltip top 在 trigger bottom 下方 4px
 *
 * Viewport clamp (TODO future):trigger 在 viewport edge 时,tooltip 可能仍超出
 * viewport。可加 left/right clamp 保 tooltip 始终可见。当前 desktop 1440 +
 * GlassPane max-w-512 居中,trigger 离 viewport edge 远,clamp 不紧急。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * macOS pill+arrow seamless 实现 (v3 保留):
 *
 * 用 `clip-path: path()` 单一 SVG path 同时绘 pill rounded-rect + arrow tip,
 * backdrop-filter 跟随 clipped shape → bg + blur + border 都在同一 shape 内,
 * 无任何接缝。Corner 用 SVG A (elliptical arc) 替代 Q (quadratic bezier) 让
 * short side 完整半圆。
 *
 * CSS 实现取舍 (Z-C 静态色路径,blend 不可用):
 *   - bg: `bg-black/55 dark:bg-white/15` Tailwind variant — light 黑 / dark
 *     白 wash 透出 backdrop tint (接近 Figma color-burn 中灰 视觉)
 *   - backdrop-filter: blur(20px)
 *   - border: SVG <path> stroke 1px white/15 (跟 GlassPane stroke 风格)
 *   - drop-shadow filter (CSS box-shadow 不跟 clip-path)
 *
 * macOS "平滑长出来" 动画:
 *   transform-origin: bottom center (top placement) + scale + opacity → 模拟
 *   macOS native tooltip "从 arrow tip 长出来" effect。180ms cubic-bezier ease-out。
 *
 * Measure: 用 offsetWidth/offsetHeight (untransformed) 而非
 * getBoundingClientRect (受 animation transform 影响)。
 *
 * Props:
 *   children — trigger element,包 hover/focus events
 *   content (string | ReactNode) — tooltip body;falsy 不 render
 *   delay (number, default 500ms) — hover 显示 delay
 *   placement ('top' (default) | 'bottom') — arrow direction
 *   className — outer wrapper class (Layout 用)
 */

const ARROW_H = 5;       // arrow tip 高度 (px)
const ARROW_HALF = 5;    // arrow tip 半宽 (px)
const PAD_X = 12;
const PAD_Y = 4;         // (Figma bezel 24 - text 16) / 2 = 4

function buildPath(w, h, isTop) {
  // RADIUS dynamic = h/2 → full pill (Figma border-radius: 200px)。
  // SVG A (elliptical arc) 替代 Q (quadratic bezier) 让 corner 真圆形。
  const RADIUS = h / 2;
  const cx = w / 2;
  if (isTop) {
    return `M ${RADIUS} 0 L ${w - RADIUS} 0 A ${RADIUS} ${RADIUS} 0 0 1 ${w} ${RADIUS} L ${w} ${h - RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${w - RADIUS} ${h} L ${cx + ARROW_HALF} ${h} L ${cx} ${h + ARROW_H} L ${cx - ARROW_HALF} ${h} L ${RADIUS} ${h} A ${RADIUS} ${RADIUS} 0 0 1 0 ${h - RADIUS} L 0 ${RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${RADIUS} 0 Z`;
  }
  return `M ${RADIUS} ${ARROW_H} L ${cx - ARROW_HALF} ${ARROW_H} L ${cx} 0 L ${cx + ARROW_HALF} ${ARROW_H} L ${w - RADIUS} ${ARROW_H} A ${RADIUS} ${RADIUS} 0 0 1 ${w} ${ARROW_H + RADIUS} L ${w} ${h + ARROW_H - RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${w - RADIUS} ${h + ARROW_H} L ${RADIUS} ${h + ARROW_H} A ${RADIUS} ${RADIUS} 0 0 1 0 ${h + ARROW_H - RADIUS} L 0 ${ARROW_H + RADIUS} A ${RADIUS} ${RADIUS} 0 0 1 ${RADIUS} ${ARROW_H} Z`;
}

export function Tooltip({ children, content, delay = 500, placement = 'top', className = '' }) {
  const [show, setShow] = useState(false);
  const [dim, setDim] = useState({ w: 0, h: 0 });
  const [triggerRect, setTriggerRect] = useState(null);
  const triggerRef = useRef(null);
  const measureRef = useRef(null);
  const timerRef = useRef(null);

  const handleEnter = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShow(true), delay);
  };
  const handleLeave = () => {
    clearTimeout(timerRef.current);
    setShow(false);
  };

  // Cleanup on unmount
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Measure trigger rect on show (viewport-relative — fixed positioning)
  useLayoutEffect(() => {
    if (show && triggerRef.current) {
      setTriggerRect(triggerRef.current.getBoundingClientRect());
    }
  }, [show]);

  // Measure tooltip content dim (untransformed via offsetWidth/Height,not
  // getBoundingClientRect — latter affected by animation transform scale).
  useLayoutEffect(() => {
    if (show && measureRef.current) {
      setDim({
        w: measureRef.current.offsetWidth,
        h: measureRef.current.offsetHeight,
      });
    }
  }, [show, content]);

  if (!content) {
    return (
      <span
        ref={triggerRef}
        className={`relative inline-flex ${className}`.trim()}
      >
        {children}
      </span>
    );
  }

  const isTop = placement === 'top';
  const totalW = dim.w;
  const totalH = dim.h + ARROW_H;
  const path = (totalW > 0) ? buildPath(totalW, dim.h, isTop) : '';

  // Compute fixed positioning for portaled tooltip
  let fixedStyle = { visibility: 'hidden' };
  if (triggerRect && totalW > 0) {
    const triggerCenterX = triggerRect.left + triggerRect.width / 2;
    fixedStyle = {
      position: 'fixed',
      top: isTop
        ? triggerRect.top - totalH - 4
        : triggerRect.bottom + 4,
      left: triggerCenterX - totalW / 2,
      width: totalW,
      height: totalH,
      zIndex: 9999,
      pointerEvents: 'none',
      transformOrigin: isTop ? 'bottom center' : 'top center',
      animation: 'tooltip-emerge 0.18s cubic-bezier(0.4, 0, 0.2, 1) both',
    };
  }

  return (
    <>
      <span
        ref={triggerRef}
        className={`relative inline-flex ${className}`.trim()}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
      >
        {children}
      </span>
      {show && typeof document !== 'undefined' && createPortal(
        <span role="tooltip" style={fixedStyle}>
          {/* Layer 1: clipped backdrop (bg + blur,follow path shape).
            * bg via className `bg-black/55 dark:bg-white/15` (light/dark variant).
            * filter: drop-shadow 让 pill+arrow 整体投影 (CSS box-shadow 不跟
            * clip-path,drop-shadow 跟)。 */}
          {totalW > 0 && (
            <span
              aria-hidden
              className="bg-black/55 dark:bg-white/15"
              style={{
                position: 'absolute',
                inset: 0,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                clipPath: `path('${path}')`,
                WebkitClipPath: `path('${path}')`,
                filter: 'drop-shadow(0 2px 8px rgba(0, 0, 0, 0.25))',
              }}
            />
          )}
          {/* Layer 2: SVG stroke overlay drawing same path for border (continuous
            * pill+arrow edge). */}
          {totalW > 0 && (
            <svg
              aria-hidden
              width={totalW}
              height={totalH}
              viewBox={`0 0 ${totalW} ${totalH}`}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              <path
                d={path}
                fill="none"
                stroke="rgba(255, 255, 255, 0.15)"
                strokeWidth="1"
              />
            </svg>
          )}
          {/* Layer 3: actual content (text)。measureRef wraps this — 测自身
            * padding+text size 干净 (absolute positioning + offsetWidth/Height
            * untransformed)。 */}
          <span
            ref={measureRef}
            style={{
              position: 'absolute',
              top: isTop ? 0 : `${ARROW_H}px`,
              left: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: `${PAD_Y}px ${PAD_X}px`,
              fontSize: '12px',
              lineHeight: '16px',
              fontWeight: 500,
              color: 'rgba(255, 255, 255, 0.95)',
              whiteSpace: 'nowrap',
            }}
          >
            {content}
          </span>
        </span>,
        document.body
      )}
      {/* Inject keyframe globally (idempotent — multiple Tooltip instances OK). */}
      <style>{`
        @keyframes tooltip-emerge {
          from { opacity: 0; transform: translateY(2px) scale(0.92); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </>
  );
}

export default Tooltip;

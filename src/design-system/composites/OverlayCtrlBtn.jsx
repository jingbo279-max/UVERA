import React from 'react';

/**
 * OverlayCtrlBtn — T-1a frosted floating control button
 *
 * 2026-05-07 (Phase 2 of 2026-05-06 spark glass system).
 *
 * Wraps the .glass-frosted-edge utility with consistent disabled-state
 * + hover-scale pattern used by Spark video overlay controls (Close /
 * Prev / Next / etc.).
 *
 * Sizing / shape are caller-controlled via className/style — pass e.g.
 * "w-10 h-10 rounded-full" for circle, or { width: 64, height: 40,
 * borderRadius: 9999 } via style for capsule.
 *
 * Props:
 *   onClick      — handler
 *   disabled     — when true, opacity 0.3 + cursor not-allowed
 *   ariaLabel    — required for a11y
 *   className    — extra Tailwind classes (sizing/positioning)
 *   style        — inline style (sizes, fade opacity, etc.)
 *   children     — icon
 */
export default function OverlayCtrlBtn({
  onClick,
  disabled = false,
  ariaLabel,
  className = '',
  style,
  children,
}) {
  return (
    <button
      type="button"
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`glass-frosted-edge flex items-center justify-center transition-all ${
        disabled
          ? 'opacity-30 cursor-not-allowed'
          : 'hover:scale-105 cursor-pointer opacity-100'
      } ${className}`}
      style={style}
    >
      {children}
    </button>
  );
}

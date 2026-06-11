import React from 'react';
import { formatCompactNumber } from '../../utils/formatNumber';

/**
 * CountActionBtn — icon button with reserved-width count
 *
 * 2026-05-07 (Phase 2 of 2026-05-06 spark glass system).
 *
 * Used in social interaction rows: Like / Save / Share style. Reserves
 * fixed min-width (3rem) when count is shown, so digit changes
 * (0 ↔ 1 ↔ 1.2K) don't shift sibling layout (matches Apple Music /
 * TikTok / X icon-button convention).
 *
 * Props:
 *   Icon         — Phosphor icon component
 *   active       — boolean; when true icon uses `weight="fill"` and
 *                  `activeColor` className
 *   activeColor  — Tailwind color class (e.g. "text-red-500")
 *   count        — number; not rendered when 0 (still reserves width)
 *   hasCount     — when false, no count area + no min-width
 *                  (e.g. Share button)
 *   iconSize     — defaults 20
 *   onClick      — handler
 *   ariaLabel    — required for a11y
 */
export default function CountActionBtn({
  Icon,
  active = false,
  activeColor = 'text-vision-primary',
  count,
  hasCount = true,
  iconSize = 20,
  onClick,
  ariaLabel,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`flex items-center gap-1 px-1 py-1 cursor-pointer group ${hasCount ? 'min-w-[3rem]' : ''}`}
    >
      <Icon
        size={iconSize}
        weight={active ? 'fill' : 'regular'}
        className={active ? activeColor : 'text-vision-secondary group-hover:text-vision-primary'}
      />
      {hasCount && (
        <span className="text-xs text-vision-secondary tabular-nums">
          {count > 0 ? formatCompactNumber(count) : ''}
        </span>
      )}
    </button>
  );
}

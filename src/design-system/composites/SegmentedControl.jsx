import React from 'react';

/**
 * SegmentedControl — dual-track design system implementation.
 *
 * - Mobile / iPad: iOS spec (Figma 51:5972, Apple HIG iOS Segmented Control)
 * - Desktop: visionOS spec (auto-applied via @media (pointer: fine) and
 *   (min-width: 1312px) per dual-track design system 2026-04-29 decision)
 * - Light / Dark mode: auto-followed via .dark class on <html>
 *
 * Theming via CSS custom properties on `.segmented-control` (defined in
 * src/design-system/tokens/glass.css). 4-way matrix:
 *   - default:                  iOS Light
 *   - .dark:                    iOS Dark
 *   - desktop @media:           visionOS Light
 *   - .dark + desktop @media:   visionOS Dark
 *
 * @param {Array<{value: string, label: string}>} segments
 * @param {string}   value      currently selected value
 * @param {function} onChange   called with new value on click
 * @param {string}   className  extra classes on container
 * @param {boolean}  overDark   override: floating over dark backdrop (Spark immerse,
 *                              Hero) — forces white-glass spec regardless of theme
 *                              for legibility against forced-dark video bg
 */
export default function SegmentedControl({
  segments = [],
  value,
  onChange,
  className = '',
  overDark = false,
}) {
  // overDark overrides the dual-track CSS vars with hardcoded forced-dark spec.
  // Otherwise, use CSS vars from .segmented-control class which auto-resolve
  // based on theme (.dark) + viewport (desktop visionOS media query).
  const containerStyle = overDark
    ? {
        background: 'rgba(255,255,255,0.16)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }
    : {
        background: 'var(--segctrl-bg)',
      };

  const separatorColor = overDark ? 'rgba(255,255,255,0.6)' : 'var(--segctrl-separator)';
  const selectedFillBg = overDark ? 'rgba(255,255,255,0.92)' : 'var(--segctrl-selected-bg)';
  const selectedShadow = overDark
    ? '0px 2px 20px 0px rgba(0,0,0,0.06)'
    : 'var(--segctrl-selected-shadow)';
  const selectedBorder = overDark ? 'none' : 'var(--segctrl-selected-border)';

  // Active label: in overDark always dark text (against white pill).
  // Otherwise: same vars-based color (visionOS Light uses dark text against
  // white-ish pill, visionOS Dark uses white text against translucent pill —
  // the var resolves correctly per theme).
  const activeTextColor = overDark
    ? 'rgba(0,0,0,0.85)'
    : 'var(--segctrl-text)';
  const inactiveTextColor = overDark
    ? 'rgba(255,255,255,0.85)'
    : 'var(--segctrl-text)';

  return (
    <div
      className={`segmented-control flex h-[36px] items-center justify-center overflow-clip px-[8px] py-[4px] relative rounded-[100px] ${className}`}
      style={containerStyle}
    >
      {segments.map((seg, i) => {
        const active     = seg.value === value;
        const prevActive = i > 0 && segments[i - 1].value === value;
        const showSep    = i > 0 && !active && !prevActive;

        return (
          <React.Fragment key={seg.value}>
            {/* Separator — hidden when adjacent to selected (Figma spec) */}
            {showSep && (
              <div
                className="h-full opacity-30 rounded-[0.5px] shrink-0 w-px"
                style={{ background: separatorColor }}
              />
            )}

            <button
              role="tab"
              aria-selected={active}
              onClick={() => onChange?.(seg.value)}
              className={`content-stretch flex flex-[1_0_0] h-full items-center min-w-px px-[10px] py-[3px] relative cursor-pointer ${active ? 'rounded-[7px]' : ''}`}
            >
              {/* Selected fill pill */}
              {active && (
                <div
                  className="absolute inset-[0_-4px] rounded-[20px]"
                  style={{
                    background: selectedFillBg,
                    boxShadow: selectedShadow,
                    border: selectedBorder,
                  }}
                />
              )}

              {/* Label */}
              <p
                className={`flex-[1_0_0] h-[18px] leading-[18px] min-w-px overflow-hidden relative text-[14px] text-center text-ellipsis tracking-[-0.08px] whitespace-nowrap ${active ? 'font-semibold' : 'font-medium'}`}
                style={{ color: active ? activeTextColor : inactiveTextColor }}
              >
                {seg.label}
              </p>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

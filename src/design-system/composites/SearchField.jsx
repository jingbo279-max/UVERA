import React, { useState, useRef, useEffect } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';

/**
 * SearchField — iOS 26 HIG aligned (UISearchBar + glass pill)
 * Figma: TODO (Uvera Design System → Search → SearchField)
 * iOS mapping: UISearchBar with .thinMaterial (clear) / .thickMaterial (prominent)
 *
 * Collapsed: a glass circle with a search icon.
 * Expanded: a glass pill with text input, category filter, and clear button.
 * Standalone version — accepts color tokens as props (the NavigationBar
 * keeps its own inline implementation for Hero-aware color adaptation).
 *
 * @param {string} placeholder - Input placeholder (default: "Search...")
 * @param {string[]} categories - Filter categories (default: ['All'])
 * @param {boolean} overDark - Whether rendered over a dark background
 * @param {'clear'|'prominent'} variant - Glass variant for the collapsed circle
 * @param {function} onSearch - Called with search text on input change
 * @param {string} className - Additional CSS classes
 */
export default function SearchField({
  placeholder = 'Search...',
  categories = ['All'],
  overDark = false,
  variant = 'clear',
  onSearch,
  className = '',
}) {
  const [expanded, setExpanded] = useState(false);
  const [category, setCategory] = useState(categories[0]);
  const [filterOpen, setFilterOpen] = useState(false);
  const inputRef = useRef(null);

  /* ── Dark-mode awareness (iOS 26: pick .thinMaterial in light, .thickMaterial only on dark-in-dark) ── */
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  // Close filter on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.sf-filter-area')) setFilterOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [filterOpen]);

  const close = () => {
    setExpanded(false);
    setCategory(categories[0]);
    setFilterOpen(false);
  };

  /* iOS 26 tokenized: when overDark=true we're over a dark hero so white overrides,
     otherwise use semantic tokens that auto-switch with theme. */
  const textColor   = overDark ? 'rgba(255,255,255,0.85)' : 'var(--color-label)';
  const mutedColor  = overDark ? 'rgba(255,255,255,0.55)' : 'var(--color-label-secondary)';
  const subtleColor = overDark ? 'rgba(255,255,255,0.40)' : 'var(--color-label-tertiary)';
  const chipBg      = overDark ? 'rgba(255,255,255,0.08)' : 'var(--color-fill-secondary)';

  /* iOS 26 Material pick: .thickMaterial only for dark-on-dark contexts */
  const collapsedVariant = (variant === 'prominent' && !(overDark || isDark)) ? 'clear' : variant;
  const expandedMaterial = (overDark && isDark) ? 'glass-prominent' : 'glass-clear';

  return (
    <div className={`relative ${className}`} style={{ width: '40px', height: '40px', flexShrink: 0 }}>
      {/* Collapsed glass circle */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className={`glass-regular-${collapsedVariant} w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300`}
        >
          <MagnifyingGlass size={20} style={{ color: textColor }} />
        </button>
      )}

      {/* Expanded pill */}
      {expanded && (
        <div
          className={expandedMaterial}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            height: '40px',
            width: '300px',
            borderRadius: '20px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            gap: '8px',
          }}
        >
          <MagnifyingGlass size={18} style={{ color: mutedColor, flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent outline-none border-none"
            style={{ fontSize: '14px', color: textColor, caretColor: textColor, padding: 0, minWidth: 0 }}
            placeholder={placeholder}
            onChange={(e) => onSearch?.(e.target.value)}
            onBlur={(e) => {
              if (!e.target.value && !e.relatedTarget?.closest('.sf-filter-area')) close();
            }}
          />

          {/* Category filter chip */}
          {categories.length > 1 && (
            <div className="sf-filter-area" style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setFilterOpen(!filterOpen)}
                className="flex items-center cursor-pointer sf-filter-area"
                style={{
                  fontSize: '12px',
                  color: mutedColor,
                  padding: '0 8px',
                  height: '26px',
                  borderRadius: '13px',
                  backgroundColor: chipBg,
                  border: 'none',
                  gap: '4px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{category}</span>
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: filterOpen ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s ease', flexShrink: 0 }}
                >
                  <polyline points="18 15 12 9 6 15" />
                </svg>
              </button>

              {/* Category dropdown */}
              {filterOpen && (
                <div
                  className="sf-filter-area glass-regular"
                  style={{ position: 'absolute', top: '36px', right: 0, width: '180px', borderRadius: '20px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '1px', zIndex: 100 }}
                >
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => { setCategory(cat); setFilterOpen(false); }}
                      className="cursor-pointer text-left"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        height: '40px',
                        borderRadius: '14px',
                        padding: '0 12px',
                        fontSize: '14px',
                        color: textColor,
                        backgroundColor: category === cat ? chipBg : 'transparent',
                        border: 'none',
                        transition: 'background-color 0.2s',
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Clear / close */}
          <button
            onClick={close}
            className="flex items-center justify-center cursor-pointer"
            style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'transparent', border: 'none', color: subtleColor, fontSize: '18px', lineHeight: 1 }}
            aria-label="Clear search"
          >×</button>
        </div>
      )}
    </div>
  );
}

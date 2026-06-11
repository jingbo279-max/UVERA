import React, { useState, useEffect } from 'react';

/**
 * Menu — visionOS-style glass dropdown menu
 *
 * Renders a trigger button that opens a glass-backed dropdown.
 * Supports radio-select items with optional icons.
 * Standalone version — accepts color tokens as props.
 *
 * @param {React.ReactNode} trigger - Trigger element (rendered inside a button)
 * @param {Array<{value: any, label: string, icon?: React.ReactNode}>} items - Menu items
 * @param {any} value - Currently selected value
 * @param {function} onChange - Called with new value on selection
 * @param {'pill'|'list'} layout - 'pill' = horizontal compact, 'list' = vertical full-width
 * @param {boolean} overDark - Whether rendered over a dark background
 * @param {'clear'|'prominent'} variant - Glass variant for the trigger
 * @param {string} className - Additional CSS classes
 */
export default function Menu({
  trigger,
  items = [],
  value,
  onChange,
  layout = 'list',
  overDark = false,
  variant = 'clear',
  className = '',
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!e.target.closest('.menu-dropdown-area')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  /* iOS 26 tokenized: overDark=true forces white-on-dark-content regardless of theme;
     overDark=false uses semantic tokens that auto-switch with .dark class. */
  const textColor  = overDark ? 'rgba(255,255,255,0.85)' : 'var(--color-label)';
  const faintColor = overDark ? 'rgba(255,255,255,0.30)' : 'var(--color-label-tertiary)';
  const activeBg   = overDark ? 'rgba(255,255,255,0.10)' : 'var(--color-fill-secondary)';
  const hoverBg    = overDark ? 'rgba(255,255,255,0.06)' : 'var(--color-fill)';

  if (layout === 'pill') {
    return (
      <div className={`menu-dropdown-area relative ${className}`}>
        <button
          onClick={() => setOpen(true)}
          className={`glass-regular-${variant} w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300`}
          style={{ opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
        >
          {trigger}
        </button>
        {open && (
          <div
            className="glass-regular"
            style={{
              position: 'absolute',
              top: '-1px',
              right: 0,
              borderRadius: '9999px',
              padding: '5px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {items.map((item) => (
              <button
                key={String(item.value)}
                onClick={() => { onChange?.(item.value); setOpen(false); }}
                className="flex items-center justify-center cursor-pointer"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: value === item.value ? activeBg : 'transparent',
                  border: 'none',
                  transition: 'background-color 0.2s',
                }}
                onMouseEnter={(e) => { if (value !== item.value) e.currentTarget.style.backgroundColor = hoverBg; }}
                onMouseLeave={(e) => { if (value !== item.value) e.currentTarget.style.backgroundColor = 'transparent'; }}
                title={item.label}
              >
                {item.icon || <span style={{ fontSize: '12px', color: value === item.value ? textColor : faintColor }}>{item.label.charAt(0)}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // list layout
  return (
    <div className={`menu-dropdown-area relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className={`glass-regular-${variant} w-10 h-10 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300`}
      >
        {trigger}
      </button>
      {open && (
        <div
          className="glass-regular"
          style={{
            position: 'absolute',
            top: '48px',
            right: 0,
            minWidth: '200px',
            borderRadius: '20px',
            padding: '6px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px',
            zIndex: 100,
          }}
        >
          {items.map((item) => (
            <button
              key={String(item.value)}
              onClick={() => { onChange?.(item.value); setOpen(false); }}
              className="cursor-pointer text-left"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                height: '44px',
                borderRadius: '16px',
                padding: '0 12px',
                fontSize: '14px',
                color: textColor,
                backgroundColor: value === item.value ? activeBg : 'transparent',
                border: 'none',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => { if (value !== item.value) e.currentTarget.style.backgroundColor = hoverBg; }}
              onMouseLeave={(e) => { if (value !== item.value) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {item.icon && <span style={{ flexShrink: 0 }}>{item.icon}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

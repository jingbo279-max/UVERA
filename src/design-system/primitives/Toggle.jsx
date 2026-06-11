import React from 'react';

/**
 * Toggle — iOS / visionOS standard toggle switch
 *
 * 2026-05-14 Leon — 旧实现用 glass-ctrl-on / glass-ctrl-off,light mode
 * 下 OFF 状是半透 dark 叠白底,实际渲染成浅灰白色,跟 iOS ON (绿/蓝)
 * 视觉混淆 (用户报「样式不标准」)。改回标准 SaaS / iOS / visionOS HIG:
 *   ON  — emerald-500 (#10B981,与 Library BASE ACTOR badge 同款绿)。
 *         **不**用 bg-accent: 品牌紫已经在 Header pills / Primary CTA /
 *         SegmentedControl 激活态等多处承担「主 action」语义,toggle 是
 *         state 编码不是 action,保留 brand color discipline,用通用绿表达
 *         on/正向 (iOS 自己也是这么做的: tint color 随主题变, toggle
 *         永远 system green)。
 *   OFF — 实心 zinc-300 (light) / zinc-700 (dark),清晰灰底
 *   Knob — 纯白,带阴影,左右滑动
 *
 * @param {boolean} on - Current toggle state
 * @param {function} onToggle - Called when toggled
 * @param {'regular'|'small'} size - Toggle size
 * @param {boolean} disabled - Disabled state
 * @param {string} className - Additional CSS classes
 */
export default function Toggle({
  on = false,
  onToggle,
  size = 'regular',
  disabled = false,
  className = '',
  ...props
}) {
  const isSmall = size === 'small';
  const trackW = isSmall ? 'w-9' : 'w-[51px]';
  const trackH = isSmall ? 'h-5' : 'h-[31px]';
  const knobSize = isSmall ? 'w-4 h-4' : 'w-[27px] h-[27px]';
  const knobTranslate = on
    ? (isSmall ? 'translate-x-4' : 'translate-x-5')
    : '';

  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => !disabled && onToggle?.(!on)}
      disabled={disabled}
      className={`
        relative ${trackW} ${trackH} rounded-full
        ${on ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-700'}
        transition-colors duration-300 cursor-pointer
        disabled:opacity-40 disabled:cursor-not-allowed
        ${className}
      `}
      {...props}
    >
      <span
        className={`
          absolute top-[2px] left-[2px]
          ${knobSize} rounded-full bg-white
          shadow-[0_2px_4px_rgba(0,0,0,0.15),0_0_1px_rgba(0,0,0,0.3)]
          transition-transform duration-300 ease-in-out
          ${knobTranslate}
        `}
      />
    </button>
  );
}

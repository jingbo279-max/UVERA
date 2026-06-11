import React from 'react';

/**
 * GlassButton — iOS / visionOS 风格玻璃图标按钮(circular symbol button)。
 * iOS mapping: nav/toolbar 图标按钮 + iOS 26 Liquid Glass(.buttonStyle(.glass /
 * .glassProminent) + .buttonBorderShape(.circle))。
 *
 * 设计要点(2026-06-06 与 Leon 对齐,为后续 mobile→iOS App 严格遵守 Apple 规则):
 *  - **点击区(hit target)恒为 ≥44×44pt** —— Apple HIG 唯一硬性规则。外层
 *    <button> 撑满 44pt(或更大的视觉尺寸),透明、无边框。
 *  - **视觉玻璃圈直径 = `size`**,居中放在点击区内。视觉可小于点击区(Apple 自身
 *    nav 图标按钮即如此:视觉 ~40pt,点击区 44pt)。
 *  - web 里 1 CSS px ≈ 1pt(布局层面),故 px 值直接对应 pt。
 *
 * variant → 真实 glass-* 材质 class(2026-06-06 修复:旧实现拼 glass-regular-{variant}
 * 这些 class 在 .liquid-glass-*→.glass-* 重命名后根本不存在 → 非 active 态无材质。
 * 现映射到实际存在的 .glass-clear / .glass-prominent / .glass-tinted / .glass-regular)。
 *
 * @param {React.ReactNode} children  图标元素(如 <CaretLeft size={20} />)
 * @param {'mini'|'small'|'regular'|'large'|'xl'|number} size  玻璃圈直径预设或自定义 px(默认 regular=40)
 * @param {'clear'|'prominent'|'tinted'|'regular'} variant  玻璃材质(默认 clear)
 * @param {boolean} active  选中/激活态(→ glass-ctrl-on)
 * @param {string} className  附加到外层 button 的 class(定位、文字色等)
 * @param {object} props  透传到 <button>(onClick / aria-label / disabled / style …)
 */

// 玻璃圈视觉直径(px ≈ pt)。Apple control size 参考:mini~28 / small 32 / medium(regular) 40 / large 48
const SIZE_MAP = { mini: 28, small: 32, regular: 40, large: 48, xl: 56 };
const VARIANT_MAP = { clear: 'glass-clear', prominent: 'glass-prominent', tinted: 'glass-tinted', regular: 'glass-regular' };
const MIN_TAP = 44; // Apple HIG 最小点击区(pt)

export default function GlassButton({
  children,
  size = 'regular',
  variant = 'clear',
  active = false,
  className = '',
  style,
  ...props
}) {
  const diameter = typeof size === 'number' ? size : (SIZE_MAP[size] ?? SIZE_MAP.regular);
  const tap = Math.max(diameter, MIN_TAP);
  const glassCls = active ? 'glass-ctrl-on' : (VARIANT_MAP[variant] ?? VARIANT_MAP.clear);

  return (
    <button
      className={`flex items-center justify-center cursor-pointer disabled:cursor-not-allowed ${className}`}
      style={{ width: tap, height: tap, background: 'none', border: 'none', padding: 0, ...style }}
      {...props}
    >
      <span
        className={`flex items-center justify-center rounded-full transition-all duration-300 ${glassCls}`}
        style={{ width: diameter, height: diameter }}
      >
        {children}
      </span>
    </button>
  );
}

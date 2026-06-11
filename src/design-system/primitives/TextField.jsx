import React, { useId, useState, useRef, forwardRef } from 'react';
import { X } from '@phosphor-icons/react';

/**
 * TextField — visionOS spec (Figma node 137:9597, file lKatfXIfgAii0NHTXenM71)
 *
 * 2026-05-22 Leon round-71 — 抽 design-system primitive (跟 <Checkbox> 同等级)
 * 替换 round-69 StoryGenerator Title/Desc ad-hoc input className 堆砌。
 *
 * Figma authoritative spec (REST API depth-fetch 5):
 *
 *   COMPONENT_SET: Text Fields (Secure Field / Search Field / Text Field)
 *   Variants: State=Idle|Hover|Typing|Disabled × Shape=Pill|Rounded Rect
 *
 *   State=Idle, Shape=Rounded Rect:
 *     fill[0]: rgba(208, 208, 208, 0.50) COLOR_BURN
 *     fill[1]: rgba(0, 0, 0, 0.10) LUMINOSITY
 *     4-stack inner shadow:
 *       (1, 1.5) blur 4  rgba(0,0,0, 0.10) NORMAL
 *       (1, 1.5) blur 4  rgba(0,0,0, 0.08) OVERLAY
 *       (0, -0.5) blur 1 rgba(255,255,255, 0.25) NORMAL
 *       (0, -0.5) blur 1 rgba(255,255,255, 0.30) OVERLAY
 *     corner: 16
 *
 *   State=Disabled: layer1 rgba(214,214,214,0.45) color-burn + layer2 rgba(0,0,0,0.08)
 *     luminosity (no inner shadow,muted)
 *
 *   State=Hover: Idle + Highlight Frame radial gradient (visionOS gaze hover)
 *   State=Typing: Idle + Cursor (2×20 #0091FF) + Clear Button (28×28 .fill-idle)
 *
 *   Clear Button:
 *     position: absolute right ~8px center
 *     size: 28×28, .fill-idle (Controls/Fills Idle)
 *     icon: X (white 0.96), 14×14
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CSS 实现取舍 (Z-C 静态色路径,见 docs/design/system/material-depth-reference.md):
 *   - fill color-burn + luminosity blend 在 GlassPane SC barrier 下 NO-OP →
 *     Z-C 静态 alpha 等效。bg-black/8 light / bg-black/40 dark (跟 .material-
 *     recessed 同源 + round-55 dark 视觉补偿)。
 *   - 4-stack inner shadow: 复用 var(--material-recessed-inset-shadow) SSOT
 *   - caret-color: var(--accent) = #0091FF (Figma Typing state cursor)
 *   - Hover Highlight radial gradient: 简化 — Desktop pointer-hover 用 focus ring
 *     不实现 visionOS gaze gradient (复杂度 vs 实用性低)
 *
 * Props:
 *   value, onChange — controlled (onChange 收到 native event;Clear button 合成
 *     一个 event,target.value='')
 *   placeholder, disabled, maxLength
 *   multiline (default false) — true → <textarea>,false → <input type="text">
 *   rows — only multiline
 *   showClear — Typing state 是否显示 Clear button (default: !multiline)
 *   leadingIcon — optional ReactNode (Search Field 的 Mic 等),28×28 .fill-idle
 *   shape ('rounded' | 'pill') — corner 16 (rounded) vs 100 (pill).
 *     Default 跟 multiline 绑定 (Leon round-71 设计决策):
 *       · single-line input  → 'pill'    (流畅 form input)
 *       · multiline textarea → 'rounded' (多行结构对齐)
 *     Consumer 可显式 override (e.g. Search Field 单行用 'rounded')。
 *   className — 追加到 outer wrapper (Layout 用,如 w-full / flex-1)
 *   id, name, ...rest — 透传 native input/textarea
 */
/* 2026-05-27 round-79 — forwardRef + dual-ref setter:让 caller 拿 underlying
 * <input>/<textarea> ref(用于 imperative focus / selection / 复杂 onKeyDown
 * 拿 selectionStart / 自定义 caret position 等)。Free mode prompt textarea 用
 * @ mention picker 复杂逻辑必须拿 textarea ref,enhance TextField 让它能复用
 * 而不重造 raw <textarea>。 */
export const TextField = forwardRef(function TextField({
  value = '',
  onChange,
  placeholder,
  disabled = false,
  maxLength,
  multiline = false,
  rows = 3,
  showClear: showClearProp,
  leadingIcon,
  shape,
  className = '',
  id,
  name,
  onFocus,
  onBlur,
  ...rest
}, forwardedRef) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef(null);

  /* Dual-ref setter:同时 fill internal inputRef (TextField 内 imperative focus
   * 用,如 Clear handler 调 .focus()) 跟 forwarded external ref (caller 用)。 */
  const setRefs = (el) => {
    inputRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef) forwardedRef.current = el;
  };

  // multiline 默认不显示 Clear (textarea Clear 按钮在 visionOS spec 不存在,UX 上
  // 多行内容 accidental Clear 风险大 — 误触丢失工作)
  const showClear = showClearProp ?? !multiline;
  const hasValue = value !== '' && value !== null && value !== undefined;
  const showClearBtn = showClear && hasValue && !disabled;

  const handleFocus = (e) => { setIsFocused(true); onFocus?.(e); };
  const handleBlur = (e) => { setIsFocused(false); onBlur?.(e); };

  const handleClear = (e) => {
    e.preventDefault();
    if (onChange) {
      // Synthesize an empty-value change event so consumer onChange handlers
      // (which expect `e.target.value`) keep working unchanged.
      const synthetic = { ...e, target: { ...e.target, value: '' } };
      onChange(synthetic);
    }
    inputRef.current?.focus();
  };

  // Shape default 跟 multiline 绑定 (Leon round-71):
  //   single-line input  → 'pill'    (corner 100 / rounded-full)
  //   multiline textarea → 'rounded' (corner 16 / rounded-lg)
  // ⚠️ codebase 重定义 Tailwind radius scale (tokens/index.css):
  //   --radius-lg = 16px (Figma 匹配),--radius-xl = 20px,--radius-2xl = 24px
  // 所以 16px corner = `rounded-lg` 而非 `rounded-xl` / `rounded-2xl`。
  const effectiveShape = shape ?? (multiline ? 'rounded' : 'pill');
  const radiusClass = effectiveShape === 'pill' ? 'rounded-full' : 'rounded-lg';

  // Padding:left 16 default,leading icon 时 left 44 (icon 28 + gap 8 + edge 8)。
  // Right:Clear button 时 44,否则 16。
  const leftPad = leadingIcon ? 'pl-11' : 'pl-4';
  const rightPad = showClearBtn ? 'pr-11' : 'pr-4';

  // Outer wrapper — 承载 bg / shadow / border / focus ring。Native control 在内部
  // bg transparent border 0 outline 0。Clear/leading 在 outer absolute 定位。
  // focus-within ring-accent (跟 round-69 ad-hoc 一致 affordance)。
  const wrapperClass = [
    'relative inline-flex items-stretch w-full',
    radiusClass,
    'bg-black/8 dark:bg-black/40',
    'border border-background-tertiary dark:border-white/6',
    'shadow-[var(--material-recessed-inset-shadow)]',
    'transition-shadow',
    isFocused && !disabled ? 'ring-2 ring-accent' : '',
    disabled ? 'opacity-50 cursor-not-allowed' : '',
    className,
  ].filter(Boolean).join(' ');

  // Native control class — transparent bg,no border,focus 在 wrapper 上。
  // caret-accent 使用 codebase --color-accent token (= #5B53FF brand purple,
  // 而非 Figma literal #0091FF — visionOS spec 适配本品牌色,保持 design system
  // SSOT)。Tailwind 4 caret-<color> 内建支持 color token alias。
  const controlClass = [
    'w-full bg-transparent border-0 outline-none',
    'py-2.5', leftPad, rightPad,
    // 桌面 14px(text-sm)；mobile(< 792px Phone 断点)提到 16px,避免 iOS Safari
    // focus 时 font-size < 16px 触发自动 zoom。max-[791px] 与项目 isSmallScreen 断点对齐。
    'text-sm max-[791px]:text-base text-label placeholder:text-label-tertiary',
    'caret-accent',
    disabled ? 'cursor-not-allowed' : '',
    multiline ? 'resize-none min-h-0' : '',
  ].filter(Boolean).join(' ');

  const controlProps = {
    id: inputId,
    name,
    ref: setRefs,
    value,
    onChange,
    onFocus: handleFocus,
    onBlur: handleBlur,
    placeholder,
    disabled,
    maxLength,
    className: controlClass,
    ...rest,
  };

  return (
    <div className={wrapperClass}>
      {/* Leading icon (Search Field 用 Mic / MagnifyingGlass 等)。
        * 28×28 .fill-idle visionOS Controls/Fills 风格。
        * Wrap pattern:outer span absolute 定位,inner span 用 fill-idle
        * (fill-idle 自带 position:relative,跟 absolute 冲突,所以分两层)。
        * pointer-events:none on outer → click 落到 input。 */}
      {leadingIcon && (
        <span
          aria-hidden
          className={`absolute left-2 ${multiline ? 'top-2' : 'top-1/2 -translate-y-1/2'} w-7 h-7 pointer-events-none`}
        >
          <span className="fill-idle w-full h-full rounded-full flex items-center justify-center">
            <span className="relative z-10 flex items-center justify-center">{leadingIcon}</span>
          </span>
        </span>
      )}

      {/* Native control */}
      {multiline ? (
        <textarea {...controlProps} rows={rows} />
      ) : (
        <input {...controlProps} type="text" />
      )}

      {/* Clear button (Typing state) — 28×28 .fill-idle,absolute right 8。
        * Wrap pattern 同 leadingIcon:outer absolute,inner button + .fill-idle。
        * onMouseDown preventDefault → 防 input blur (click 完保焦点)。
        * tabIndex=-1 → Tab 跳过 Clear,顺序 input → next field。 */}
      {showClearBtn && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7">
          <button
            type="button"
            aria-label="Clear"
            onClick={handleClear}
            onMouseDown={(e) => e.preventDefault()}
            tabIndex={-1}
            className="fill-idle w-full h-full rounded-full flex items-center justify-center cursor-pointer hover:opacity-90"
          >
            <X size={14} weight="bold" className="relative z-10 text-label" />
          </button>
        </span>
      )}
    </div>
  );
});

export default TextField;

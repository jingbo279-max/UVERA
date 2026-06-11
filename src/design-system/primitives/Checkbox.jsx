import React, { useId } from 'react';

/**
 * Checkbox — visionOS spec (Figma node 137:9566)
 *
 * Figma authoritative spec (REST API depth-fetch 5 + effects):
 *
 *   Unchecked Idle:
 *     fill:   rgba(0, 0, 0, 0.10) blend=LINEAR_BURN
 *     effect: inner-shadow rgba(0, 0, 0, 0.08) offset(1, 1.5) blur 4
 *     effect: inner-shadow rgba(255, 255, 255, 0.30) offset(0, -0.5) blur 1
 *     corner: 100 (full circle)
 *
 *   Unchecked Hover:
 *     同 Idle +
 *     Gaze Glow child:  32×32 ellipse, white, LAYER_BLUR 18px
 *
 *   Checked Idle:
 *     fill:   rgba(0, 145, 255, 1.0)  = #0091FF
 *     effect: BACKGROUND_BLUR 40px (backdrop-filter blur)
 *     child:  checkmark `􀆅` (SF Symbols) white opacity 0.96
 *
 *   Checked Hover:
 *     fill 1: rgba(10, 132, 255, 1.0) = #0A84FF (solid base)
 *     fill 2: GRADIENT_RADIAL  blend=NORMAL
 *             handles: center (0.5, 1.0) → top (0.505, 0.0)
 *             stops: 0% white 0.07 → 55.59% white 0.00
 *     fill 3: GRADIENT_RADIAL  blend=COLOR_DODGE
 *             同 handles
 *             stops: 0% rgba(94,94,94,0.14) → 73.85% rgba(94,94,94,0.00)
 *     Gaze Glow child + checkmark
 *
 * CSS approximation 取舍:
 *   - LINEAR_BURN blend on Unchecked fill — CSS 无精确等价,
 *     bg-black/10 + inner shadow stack 视觉等效 ("recessed" 凹陷感)
 *   - BACKGROUND_BLUR on Checked Idle — CSS backdrop-filter 实现
 *   - COLOR_DODGE blend on Hover gradient 2 — CSS background-blend-mode
 *     原生支持
 *   - Gaze Glow LAYER_BLUR 18 — CSS filter: blur(18px) on absolute
 *     positioned 32×32 white circle,溢出 4px (32-28=4)
 */
export function Checkbox({
  checked = false,
  onChange,
  disabled = false,
  className = '',
  id,
  name,
  children,
  ...rest
}) {
  // 2026-05-19 round-46 — API refactor: outer 是 `<label>`,native `<input>`
  // 在 label 内部走 HTML label-control association(click anywhere on label
  // toggles input)。Round-39~45 用 `<div role="checkbox">` 自己 onClick 是
  // a11y 回归 — label text click 不能 toggle。新 API:children prop 接收
  // 旁边的 label text,outer 一个 label 全部 clickable。
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <label
      htmlFor={inputId}
      className={`group inline-flex items-start gap-2.5 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${className}`.trim()}
    >
      {/* Visual wrapper 28×28 — relative positioning anchor for Gaze Glow + 主圆 */}
      <span className="relative inline-flex items-center justify-center select-none flex-shrink-0" style={{ width: 28, height: 28 }}>
        {/* Native input — sr-only,visual hidden 但参与 label 关联 + form 提交 + 键盘
          * 焦点 + Space toggle native 行为(无需 ARIA 手动 handlers)。 */}
        <input
          type="checkbox"
          id={inputId}
          checked={checked}
          onChange={(e) => !disabled && onChange?.(e)}
          disabled={disabled}
          name={name}
          className="sr-only"
          {...rest}
        />

      {/* Main checkbox circle 28×28.
        * Unchecked spec (Leon 5/19 round-41,Figma node 137:9574 CSS panel
        * verbatim,State 1 lock-in):
        *   border-radius: 100px              (= rounded-full on 28×28)
        *   background: rgba(0, 0, 0, 0.10)
        *   background-blend-mode: plus-darker  (WebKit only,Chrome fallback)
        *   box-shadow:
        *     0 -0.5px 1px 0 rgba(255,255,255,0.30) inset,   ← white 高光 on top
        *     1px 1.5px 4px 0 rgba(0,0,0,0.08) inset           ← black 阴影 under
        *
        * 2026-05-19 round-42 — overflow:hidden 让 inside Gaze Glow (Hover
        * state 子 child) clip 到圆角 (Figma SVG clip-path rx=14)。 */}
      <span
        aria-hidden
        className="relative rounded-full flex items-center justify-center transition-colors overflow-hidden"
        style={{
          width: 28,
          height: 28,
          background: checked ? '#0091FF' : 'rgba(0, 0, 0, 0.10)',
          backgroundBlendMode: !checked ? 'plus-darker' : undefined,
          // round-43 (Leon, Figma node 137:9570 CSS panel verbatim):
          // backdrop-filter: blur(20px). Figma BACKGROUND_BLUR radius=40
          // → CSS blur(20px) via 2:1 conversion(跟 LAYER_BLUR 同 pattern)
          backdropFilter: checked ? 'blur(20px)' : undefined,
          WebkitBackdropFilter: checked ? 'blur(20px)' : undefined,
          boxShadow: !checked
            ? 'inset 0 -0.5px 1px rgba(255, 255, 255, 0.30), inset 1px 1.5px 4px rgba(0, 0, 0, 0.08)'
            : 'none',
        }}
      >
        {/* State 2 Hover Unchecked — Inside Gaze Glow (Figma node 137:9572
          * SVG verbatim,Leon round-42):
          *   <circle cx="21" cy="21" r="16" fill="white"/>   = 32×32 圆中
          *      心在(21,21)= box 右下偏移
          *   feGaussianBlur stdDeviation="9"   = CSS filter:blur(9px)
          *   opacity="0.15"                    = 15% group opacity
          *   mix-blend-mode: plus-lighter      = CSS standard,跨 browser ✓
          *   clipPath rect rx=14               = parent overflow:hidden 实现
          * Only Hover Unchecked,所以 !checked && group-hover trigger。 */}
        {!checked && (
          <span
            aria-hidden
            className={`absolute pointer-events-none transition-opacity duration-150 ${
              disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-[0.15]'
            }`}
            style={{
              width: 32,
              height: 32,
              left: 5,
              top: 5,
              borderRadius: '50%',
              background: 'rgb(255, 255, 255)',
              filter: 'blur(9px)',
              mixBlendMode: 'plus-lighter',
            }}
          />
        )}
        {/* State 4 Hover Checked overlay (Leon 5/19 round-44, Figma node
          * 137:9567 CSS panel verbatim):
          *   background:
          *     radial-gradient(101.08% 100% at 50% 100%,
          *       rgba(94, 94, 94, 0.14) 0%, rgba(94, 94, 94, 0.00) 73.85%),
          *     radial-gradient(100.02% 100% at 50% 100%,
          *       rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.00) 55.59%),
          *     #0A84FF;
          *   background-blend-mode: color-dodge, normal, normal;
          * Hover 时 fade-in (overlay 整个 swap idle blue to hover gloss)。 */}
        {checked && (
          <span
            aria-hidden
            className={`absolute inset-0 rounded-full pointer-events-none transition-opacity duration-150 ${
              disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{
              background: 'radial-gradient(101.08% 100% at 50% 100%, rgba(94, 94, 94, 0.14) 0%, rgba(94, 94, 94, 0.00) 73.85%), radial-gradient(100.02% 100% at 50% 100%, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.00) 55.59%), #0A84FF',
              backgroundBlendMode: 'color-dodge, normal, normal',
            }}
          />
        )}

        {/* State 4 Hover Checked Gaze Glow (Leon 5/19 round-45,Figma node
          * 137:9568 SVG verbatim):
          *   <circle cx="21" cy="21" r="16" fill="white"/>   = 32×32 同 State 2
          *   feGaussianBlur stdDeviation="9"                = CSS blur(9px)
          *   opacity="0.3"                                  = 30% (跟 State 2
          *      Unchecked 0.15 翻倍,checked 加亮 2×)
          *   mix-blend-mode: plus-lighter
          * 跟 State 2 spec 完全一致除 opacity (0.15 vs 0.30)。Position / size /
          * blur / blend 同源。 */}
        {checked && (
          <span
            aria-hidden
            className={`absolute pointer-events-none transition-opacity duration-150 ${
              disabled ? 'opacity-0' : 'opacity-0 group-hover:opacity-[0.3]'
            }`}
            style={{
              width: 32,
              height: 32,
              left: 5,
              top: 5,
              borderRadius: '50%',
              background: 'rgb(255, 255, 255)',
              filter: 'blur(9px)',
              mixBlendMode: 'plus-lighter',
            }}
          />
        )}

        {/* Checkmark — Figma `􀆅` SF Symbols glyph 跨平台 fallback 用 SVG path。
          * relative z-10 让它在 hover overlay 之上。 */}
        {checked && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
            className="relative z-10"
          >
            <path
              d="M3.5 8.5L6.5 11.5L12.5 5.5"
              stroke="white"
              strokeOpacity="0.96"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        </span>
      </span>
      {/* Optional inline label text — children prop。Click 任何 children 区域
        * 通过 outer label htmlFor 关联触发 input toggle (HTML 标准)。 */}
      {children && <span className="flex-1 min-w-0">{children}</span>}
    </label>
  );
}

export default Checkbox;

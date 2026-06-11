import React from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';

/**
 * VideoOverlayButtons — shared end-of-playback / video-pane buttons used by
 * both SparkMode (immerse) and Library work-detail modal.
 *
 * 2026-05-17 Leon — created so the same recipe lives in one place. Modify
 * here and all video-overlay buttons stay visually identical.
 *
 * NOT here (intentional):
 *   - Back button: use the existing <OverlayCtrlBtn> composite from this
 *     same folder (already shared, already T-1a glass). The CaretLeft icon
 *     is passed as children.
 *   - SparkMode desktop end-overlay (line ~1817) uses a smaller "subtle"
 *     variant with glass-hero class. That variant is intentionally
 *     different (per 2026-05-06 Leon's End-of-play 布局重组 spec). When/if
 *     we unify desktop too, accept a `variant="subtle"` prop on the two
 *     components below.
 */

/* ── VideoReplayButton ────────────────────────────────────────────────
 * 80×80 glass-hero halo with counter-clockwise arrow.
 * Spec (2026-05-17 canonical = Spark desktop end-overlay):
 *   .glass-hero class (visionOS-style frosted halo),
 *   80×80 round, ArrowCounterClockwise size 32 weight bold white.
 * The "play again from start" hero CTA used by every video end-overlay.
 */
export function VideoReplayButton({ onClick, ariaLabel = 'Replay', className = '', style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`glass-hero w-20 h-20 rounded-full flex items-center justify-center cursor-pointer ${className}`}
      style={style}
    >
      <ArrowCounterClockwise size={32} weight="bold" className="text-white" />
    </button>
  );
}

/* ── VideoEndCTAButton ────────────────────────────────────────────────
 * h-8 glass-pill, icon + label. Secondary CTA next to Replay.
 * Spec (2026-05-17 canonical = Spark desktop "subtle" CTA spec from
 * 2026-05-06 reorganization):
 *   h-8, padding 0/16, font 13/500, gap 6, icon 14, rounded full,
 *   bg rgba(255,255,255,0.10) + blur(10), border rgba(255,255,255,0.20).
 *   Tier supporting / less visually loud than Replay.
 * Caller provides icon (Phosphor component) + label children.
 *   - Spark immerse: icon={TreeStructure}, label="Branch"
 *   - Library work-detail: icon={MagicWand}, label="Continue this story"
 */
export function VideoEndCTAButton({ onClick, icon: Icon, children, ariaLabel, className = '', style }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={`px-4 h-8 rounded-full text-white text-[13px] font-medium cursor-pointer inline-flex items-center gap-1.5 ${className}`}
      style={{
        background: 'rgba(255,255,255,0.10)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.20)',
        ...style,
      }}
    >
      {Icon && <Icon size={14} weight="bold" />}
      {children}
    </button>
  );
}

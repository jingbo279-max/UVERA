import React from 'react';

/**
 * TagChip — clickable metadata tag chip
 *
 * 2026-05-07 (Phase 2 of 2026-05-06 spark glass system).
 *
 * Visual: rounded-md (6px) rectangle (per "Shape = Function" — pill is
 * for actions; rounded-rect is for metadata/tags). bg white@06 + hover
 * white@12. Text vision-secondary → vision-primary on hover.
 *
 * Behavior: clickable when onClick provided; gracefully disabled
 * (cursor: default, no hover state change) when missing.
 */
export default function TagChip({ tag, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(tag)}
      disabled={!onClick}
      aria-label={`Filter by ${tag}`}
      className="h-7 px-3 rounded-md bg-white/6 hover:bg-white/12 text-vision-secondary hover:text-vision-primary text-xs font-medium flex items-center transition-colors cursor-pointer disabled:cursor-default disabled:hover:bg-white/6 disabled:hover:text-vision-secondary"
    >
      {tag}
    </button>
  );
}

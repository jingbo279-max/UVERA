import React from 'react';
import { Play, Pause, SkipForward, SkipBack, SpeakerHigh, SpeakerSlash, Heart, ShareNetwork, DotsThreeVertical } from '@phosphor-icons/react';
import { SIDEBAR_MODE } from '../hooks/useSidebarState';

/* Shared button style for playback controls */
const ctrlBtn = {
  width: '40px',
  height: '40px',
  borderRadius: '50%',
  backgroundColor: 'rgba(255,255,255,0.10)',
  border: 'none',
  transition: 'background 0.2s linear',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};
const onHoverIn  = (e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.28)'; };
const onHoverOut = (e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.10)'; };

/* Fallback gradient when no channel color is available */
const DEFAULT_GRADIENT = 'linear-gradient(135deg, #7C3AED 0%, #9333EA 50%, #4338CA 100%)';

export default function Remote({ isSmallScreen, sidebar, isPlaying, setIsPlaying, isMuted, setIsMuted, currentItem, channel }) {
  /* Left offset matches getMainPaddingLeft: pl-60=240px / pl-16=64px / pl-0=0 */
  const leftOffset =
    sidebar.mode === SIDEBAR_MODE.FULL ? '240px'
    : sidebar.mode === SIDEBAR_MODE.MINI ? '64px'
    : '0';

  const thumbnailGradient = channel?.hero?.gradient ?? DEFAULT_GRADIENT;

  return (
    <div
      className={`fixed z-50 transition-all duration-500 ${
        isSmallScreen ? 'bottom-4 px-4' : 'bottom-8 px-6'
      }`}
      style={{ left: leftOffset, right: '0' }}
    >
      <div className="max-w-[896px] mx-auto">
        <div
          className={`glass-overlay ${
            isSmallScreen ? 'rounded-2xl' : 'rounded-3xl'
          } shadow-2xl overflow-hidden`}
        >
          <div className={isSmallScreen ? 'px-4 py-3' : 'px-6 py-4'}>

            {/* ── Row 1: Now Playing info ── */}
            <div className={`flex items-center justify-between ${isSmallScreen ? 'mb-3' : 'mb-4'}`}>
              {/* Track info */}
              <div className={`flex items-center ${isSmallScreen ? 'gap-3' : 'gap-4'} min-w-0 flex-1`}>
                {/* Thumbnail: cover image if available, else channel gradient */}
                <div
                  className={`${isSmallScreen ? 'w-10 h-10' : 'w-12 h-12'} rounded-xl flex-shrink-0 shadow-lg overflow-hidden`}
                  style={{ background: thumbnailGradient }}
                >
                  {currentItem?.cover && (
                    <img
                      src={currentItem.cover}
                      alt={currentItem.title}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4
                    className="font-semibold text-white text-sm truncate"
                    style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
                  >
                    {currentItem?.title ?? channel?.label ?? '—'}
                  </h4>
                  <p className="text-xs text-white/60 truncate">
                    {currentItem?.artist ?? 'Hover a card to preview'}
                  </p>
                </div>
              </div>

              {/* Action buttons */}
              <div className={`flex items-center gap-2 flex-shrink-0 ${isSmallScreen ? 'ml-2' : 'ml-4'}`}>
                <button className="w-9 h-9 rounded-full glass-icon-muted flex items-center justify-center transition-all duration-300 cursor-pointer">
                  <Heart size={16} className="text-white" />
                </button>
                {!isSmallScreen && (
                  <>
                    <button className="w-9 h-9 rounded-full glass-icon-muted flex items-center justify-center transition-all duration-300 cursor-pointer">
                      <ShareNetwork size={16} className="text-white" />
                    </button>
                    <button className="w-9 h-9 rounded-full glass-icon-muted flex items-center justify-center transition-all duration-300 cursor-pointer">
                      <DotsThreeVertical size={16} className="text-white" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* ── Row 2: Progress bar ── */}
            <div className={isSmallScreen ? 'mb-3' : 'mb-4'}>
              <div className="flex items-center gap-3">
                <span className="text-xs text-white/50 font-medium tabular-nums flex-shrink-0">1:23</span>
                <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden group cursor-pointer">
                  <div className="w-1/3 h-full bg-white/80 rounded-full transition-all duration-200 group-hover:bg-white" />
                </div>
                <span className="text-xs text-white/50 font-medium tabular-nums flex-shrink-0">4:15</span>
              </div>
            </div>

            {/* ── Row 3: Controls ── */}
            <div className="flex items-center justify-between">

              {/* Volume */}
              <div className="flex items-center gap-3 flex-shrink-0">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  style={ctrlBtn}
                  onMouseEnter={onHoverIn}
                  onMouseLeave={onHoverOut}
                >
                  {isMuted
                    ? <SpeakerSlash size={20} className="text-white" />
                    : <SpeakerHigh  size={20} className="text-white" />}
                </button>
                {!isSmallScreen && (
                  <div className="w-20 h-1 bg-white/10 rounded-full overflow-hidden group cursor-pointer">
                    <div className="w-2/3 h-full bg-white/60 rounded-full transition-all duration-200 group-hover:bg-white/80" />
                  </div>
                )}
              </div>

              {/* Playback controls */}
              <div className="flex items-center gap-3">
                <button style={ctrlBtn} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}>
                  <SkipBack size={20} weight="fill" className="text-white" />
                </button>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  style={ctrlBtn}
                  onMouseEnter={onHoverIn}
                  onMouseLeave={onHoverOut}
                >
                  {isPlaying
                    ? <Pause size={20} weight="fill" className="text-white" />
                    : <Play  size={20} weight="fill" className="text-white ml-0.5" />}
                </button>

                <button style={ctrlBtn} onMouseEnter={onHoverIn} onMouseLeave={onHoverOut}>
                  <SkipForward size={20} weight="fill" className="text-white" />
                </button>
              </div>

              {/* Spacer (balances volume section) */}
              <div className={`${isSmallScreen ? 'w-[38px]' : 'w-[116px]'} flex-shrink-0`} />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

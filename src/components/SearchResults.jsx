import React, { useState, useEffect, useMemo } from 'react';
import { CaretLeft, MagnifyingGlass } from '@phosphor-icons/react';
import MasonryGrid from './MasonryGrid';
import { getMainPaddingLeft } from '../hooks/useSidebarState';

/* Chips 对齐 media_kind 3 值（2026-04-23 — 从旧版 Spark/Story/Sound/Live 4 频道
 * chips 切换到 media_kind 分类，旧频道产品已全线下线） */
const SEARCH_CHIPS = ['All', 'Video', 'Image', 'Live'];

export default function SearchResults({
  query,
  allItems,
  sidebar,
  isSmallScreen,
  likedItems,
  toggleLike,
  savedItems,
  toggleSave,
  onPlay,
  onBack,
  isMuted,
  cardRefs,
  videoRefs,
  audioRefs,
  hoveredCard,
  setHoveredCard,
  visibleCards,
}) {
  const [typeFilter, setTypeFilter] = useState(null);
  const [isDark, setIsDark] = useState(false);
  const [hoveredChip, setHoveredChip] = useState(null);

  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  /* Filter items by search query — title / artist / tag 字符匹配 */
  const searchResults = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return allItems.filter(item =>
      item.title?.toLowerCase().includes(q) ||
      item.artist?.toLowerCase().includes(q) ||
      item.tags?.some(t => t.toLowerCase().includes(q))
    );
  }, [query, allItems]);

  /* Apply media_kind filter chip */
  const filteredResults = useMemo(() => {
    if (!typeFilter) return searchResults;
    return searchResults.filter(i => i.mediaKind === typeFilter);
  }, [searchResults, typeFilter]);

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none pt-20 ${getMainPaddingLeft(sidebar.mode)}`}>
      {/* Search header */}
      <div className={`${isSmallScreen ? 'px-4' : 'px-8'} mb-2`}>
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={onBack}
            className="flex items-center justify-center cursor-pointer rounded-full transition-colors duration-200"
            style={{
              width: '34px', height: '34px', border: 'none',
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
              color: isDark ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.60)',
            }}
          >
            <CaretLeft size={20} weight="bold" />
          </button>
          <div className="flex items-center gap-2" style={{ color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.40)' }}>
            <MagnifyingGlass size={18} />
            <span style={{ fontSize: '22px', fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)' }}>
              "{query}"
            </span>
            <span style={{ fontSize: '14px', marginLeft: '8px' }}>
              {searchResults.length} results
            </span>
          </div>
        </div>

        {/* Type filter chips */}
        <div className="flex items-center gap-2 mb-6">
          {SEARCH_CHIPS.map((chip) => {
            const isActive = chip === 'All' ? typeFilter === null : typeFilter === chip;
            const isHovered = hoveredChip === chip && !isActive;
            return (
              <button
                key={chip}
                onClick={() => setTypeFilter(chip === 'All' ? null : isActive ? null : chip)}
                onMouseEnter={() => setHoveredChip(chip)}
                onMouseLeave={() => setHoveredChip(null)}
                className="relative overflow-clip rounded-[12px] cursor-pointer whitespace-nowrap flex items-center justify-center transition-all duration-200"
                style={{
                  height: '44px',
                  padding: '0 20px',
                  fontSize: '15px',
                  fontWeight: 600,
                  lineHeight: '20px',
                  border: 'none',
                  color: isActive
                    ? (isDark ? '#000' : '#fff')
                    : (isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.65)'),
                }}
              >
                <span className="absolute inset-0 pointer-events-none rounded-[12px]" aria-hidden="true">
                  {isActive ? (
                    <span className="absolute inset-0 rounded-[12px]" style={{
                      backgroundColor: isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.85)',
                    }} />
                  ) : (
                    <>
                      <span className="absolute inset-0 rounded-[12px]" style={{
                        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                        mixBlendMode: isDark ? 'lighten' : 'normal',
                      }} />
                      <span className="absolute inset-0 rounded-[12px]" style={{
                        backgroundColor: isDark ? 'rgba(94,94,94,0.18)' : 'rgba(0,0,0,0.04)',
                        mixBlendMode: isDark ? 'color-dodge' : 'normal',
                      }} />
                      {/* Hover: radial gradient highlight from bottom-center (visionOS spec) */}
                      {isHovered && (
                        <>
                          <span className="absolute inset-0 rounded-[12px]" style={{
                            backgroundImage: isDark
                              ? 'radial-gradient(ellipse at 50% 100%, rgba(255,255,255,0.07) 0%, transparent 55.6%)'
                              : 'radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.04) 0%, transparent 55.6%)',
                            mixBlendMode: isDark ? 'lighten' : 'normal',
                          }} />
                          <span className="absolute inset-0 rounded-[12px]" style={{
                            backgroundImage: isDark
                              ? 'radial-gradient(ellipse at 50% 100%, rgba(94,94,94,0.14) 0%, transparent 73.8%)'
                              : 'radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.06) 0%, transparent 73.8%)',
                            mixBlendMode: isDark ? 'color-dodge' : 'normal',
                          }} />
                        </>
                      )}
                    </>
                  )}
                </span>
                <span className="relative">{chip}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Results grid — reuse MasonryGrid without chips (already shown above) */}
      {filteredResults.length > 0 ? (
        <MasonryGrid
          isSmallScreen={isSmallScreen}
          filteredMediaItems={filteredResults}
          activeFilter={null}
          setActiveFilter={() => {}}
          chips={[]}
          title=""
          isMuted={isMuted}
          likedItems={likedItems}
          toggleLike={toggleLike}
          savedItems={savedItems}
          toggleSave={toggleSave}
          onPlay={onPlay}
          cardRefs={cardRefs}
          videoRefs={videoRefs}
          audioRefs={audioRefs}
          hoveredCard={hoveredCard}
          setHoveredCard={setHoveredCard}
          visibleCards={visibleCards}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)' }}>
          <MagnifyingGlass size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
          <p style={{ fontSize: '16px', fontWeight: 500 }}>No results found for "{query}"</p>
          <p style={{ fontSize: '14px', marginTop: '8px', opacity: 0.7 }}>Try a different search term</p>
        </div>
      )}
    </div>
  );
}

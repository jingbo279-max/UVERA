import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightning, Broadcast, FilmSlate, Heart, BookmarkSimple, Monitor, MusicNote, Disc, PlayCircle, FilmStrip, Globe, Lock, MagnifyingGlass, ArrowElbowRight, ArrowUpRight, RocketLaunch, Flag } from '@phosphor-icons/react';
import ReportContentModal from './ReportContentModal';
import UnifiedVideoPlayer from './UnifiedVideoPlayer';
import GlassSurface from './GlassSurface';
import { formatCompactNumber } from '../utils/formatNumber';

/* ─── SPA-safe CTA navigate (used by Hero card + regular card CTA buttons) ─
 * 内部路由（/ 开头且不是 // 协议相对）→ react-router navigate()，避免整页刷新
 * 外部链接 / 显式新 tab → window.open() 按 cta_target 走
 * 提取到顶层是为了和 HeroCard、gridItem CTA 共用同一份逻辑。
 * ────────────────────────────────────────────────────────────────────── */
function handleCtaClick(e, ctaUrl, ctaTarget, navigate) {
  e.stopPropagation();
  if (!ctaUrl) return;
  if (ctaTarget === '_blank') {
    window.open(ctaUrl, '_blank', 'noopener,noreferrer');
    return;
  }
  // 内部路由用 SPA navigate
  if (ctaUrl.startsWith('/') && !ctaUrl.startsWith('//')) {
    navigate(ctaUrl);
  } else {
    window.location.href = ctaUrl;
  }
}

/* ─── HeroCard — 瀑布流首张 pinned card 的特殊渲染 ─────────────────────
 * 触发条件：item.pinned === true && item.pinOrder === 1（调用方已筛好）
 * 形态：
 *   - 全宽 16:9（aspect-video），rounded-3xl
 *   - 视频 muted autoplay loop playsInline + prefers-reduced-motion 尊重
 *   - 中央 overlay：title + 单 CTA
 *   - 无 tag badge（hero 专属视觉，区分普通卡）
 *   - 无 eyebrow / description（Phase 1，等 D-004 加列后 Phase 2）
 * AR 固定 16:9：ignore item.aspectRatio，用 tailwind aspect-video
 *               （admin 端也会锁定 hero-slot AR 为 16:9，数据+渲染双重保险）
 * ──────────────────────────────────────────────────────────────────── */
function HeroCard({ item, isSmallScreen }) {
  const navigate = useNavigate();
  const [videoError, setVideoError] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const showVideo = !!item.video && !videoError && !reducedMotion;

  /* 尺寸策略：
   * - Mobile（isSmallScreen）：aspect-video（16:9）— 用户 /test/hero-ar 视觉实测通过
   * - Desktop：cap 到 min(56vh, 520px) — 宽屏下真 16:9 会吃掉首屏把瀑布流压到折叠下
   *   交付一个"能看到瀑布流入口"的 hero 高度，视觉 AR 变成 banner 比（≈3:1 ~ 4:1）
   *   这不是新增 AR 档，只是视窗自适应的 cap；真 21:9 option 仍在 D-002 冻结
   */
  return (
    <section
      className={`relative w-full overflow-hidden rounded-3xl ${isSmallScreen ? 'aspect-video' : 'h-[min(52vh,480px)]'}`}
      style={{ background: 'var(--gradient-hero-discover)' }}
      aria-label={item.title}
    >
      {showVideo && (
        <video
          autoPlay loop muted playsInline
          poster={item.cover}
          onError={() => setVideoError(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
          src={item.video}
          aria-hidden
        />
      )}
      {!showVideo && item.cover && (
        <img
          src={item.cover}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'center 30%' }}
          aria-hidden
        />
      )}

      {/* readability scrim */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      {/* Title — 垂直中心锚定在 Hero 高度的上黄金分割点 (38.2%)，不随 Hero 高度变化漂移 */}
      <div
        className="absolute left-0 right-0 text-center pointer-events-none flex justify-center"
        style={{
          top: '38.2%',
          transform: 'translateY(-50%)',
          padding: isSmallScreen ? '0 16px' : '0 48px',
        }}
      >
        <h2
          className="font-semibold leading-[1.1] mx-auto"
          style={{
            fontSize: isSmallScreen ? '1.5rem' : '2.5rem',   /* 24px 小屏 / 40px 桌面 */
            letterSpacing: '-0.02em',
            color: '#fff',
            textShadow: '0 2px 16px rgba(0,0,0,0.35)',
            /* 小屏限制到 ~16 字符宽度，强制 long-title 在更均衡的点换行
               （text-wrap: balance 需 iOS 17.4+，iPhone X 最高 iOS 16 不支持） */
            maxWidth: isSmallScreen ? '16ch' : undefined,
            wordBreak: 'keep-all',
            hyphens: 'none',
          }}
        >
          {item.title}
        </h2>
      </div>

      {/* CTA — 锚定底部中间，不挤占 title 的垂直中心 */}
      {item.ctaLabel && item.ctaUrl && (
        <button
          type="button"
          onClick={(e) => handleCtaClick(e, item.ctaUrl, item.ctaTarget, navigate)}
          className="glass-prominent inline-flex items-center gap-2 rounded-full cursor-pointer whitespace-nowrap transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] absolute left-1/2 -translate-x-1/2"
          style={{
            bottom: isSmallScreen ? '24px' : '40px',
            padding: isSmallScreen ? '10px 16px' : '12px 22px',
            fontSize: isSmallScreen ? '13px' : '14px',
            fontWeight: 600,
            color: '#fff',
            background: 'linear-gradient(135deg, var(--color-raw-violet-600) 0%, #9333ea 100%)',
            boxShadow: '0 6px 20px rgba(124, 58, 237, 0.28)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {item.ctaLabel}
          <ArrowUpRight size={14} weight="bold" />
        </button>
      )}
    </section>
  );
}

/* ─── UpgradePromoCard — 瀑布流内嵌的订阅升级 CTA（4:3 卡片形态）────────
 * 出现条件：mobile + explore 视图（desktop 的入口在 NavigationBar 上）
 * 位置：masonry 第一张卡（gridItems[0] 注入），占据 col 0 顶端
 * 形态：4:3 aspect，rounded / shadow / hover lift 与普通媒体卡片一致，
 *       但无 artist / like / save；采用 brand-moment 视觉（cosmic 暗底 +
 *       放射性 light rays + Crimson Pro italic 副标 + 大字 display 主标题）
 * 设计依据：
 *   - Leon 提供的参考设计稿（dark cosmic + glowing light rays）
 *   - 与桌面端 NavigationBar Upgrade CTA 共用 `.upgrade-glow` rainbow 动画
 *     （`src/design-system/tokens/animations.css` L24-62）
 *   - RocketLaunch 图标与 NavigationBar 保持一致（ArrowLineUp 会被误读为
 *     "回到顶部"，语义错误）
 *   - Title/Subtitle 使用 Crimson Pro（项目 display 字体约定，与 Hero /
 *     SubscriptionPage / SettingsPage 一致）
 * 点击：整卡或 CTA btn 都调 `onUpgrade?.()`（父页传入 setActiveSection('subscription')）
 * ─────────────────────────────────────────────────────────────────── */
function UpgradePromoCard({ onUpgrade, isSmallScreen }) {
  const SERIF = "'Crimson Pro', 'Georgia', serif";
  return (
    <div
      className="group cursor-pointer transition-all duration-300"
      onClick={onUpgrade}
      role="button"
      aria-label="Upgrade plan"
    >
      <div
        className={`relative ${isSmallScreen ? 'rounded-md' : 'rounded-lg'} overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500 hover:-translate-y-1`}
      >
        {/* Cosmic 4:3 stage — 暗底 + 放射性光线 + 中心光晕 */}
        <div
          className="relative overflow-hidden flex flex-col items-center justify-center text-center"
          style={{
            aspectRatio: '4/3',
            padding: isSmallScreen ? '16px 14px' : '20px 18px',
            background: 'radial-gradient(ellipse 120% 90% at 50% 55%, #2a1f4a 0%, #140c28 55%, #07050f 100%)',
          }}
        >
          {/* Layer 1 — conic light rays 从标题中心向外放射 */}
          <div
            className="absolute pointer-events-none"
            style={{
              top: '50%',
              left: '50%',
              width: '160%',
              height: '160%',
              transform: 'translate(-50%, -50%)',
              background: 'conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(255,255,255,0.16) 8deg, transparent 16deg, transparent 40deg, rgba(255,255,255,0.10) 48deg, transparent 56deg, transparent 90deg, rgba(255,255,255,0.14) 98deg, transparent 106deg, transparent 140deg, rgba(255,255,255,0.08) 148deg, transparent 156deg, transparent 200deg, rgba(255,255,255,0.12) 208deg, transparent 216deg, transparent 260deg, rgba(255,255,255,0.09) 268deg, transparent 276deg, transparent 320deg, rgba(255,255,255,0.14) 328deg, transparent 336deg)',
              filter: 'blur(8px)',
              opacity: 0.65,
              mixBlendMode: 'screen',
            }}
          />

          {/* Layer 2 — 中央白色光球（hero spotlight） */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.12) 18%, transparent 42%)',
              mixBlendMode: 'screen',
            }}
          />

          {/* Layer 3 — 顶部冷色渐变加深氛围 */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, rgba(99,102,241,0.18) 0%, transparent 40%, rgba(139,92,246,0.12) 100%)',
            }}
          />

          {/* Subtitle — Crimson Pro italic（参考稿位于标题上方） */}
          <div
            className="relative"
            style={{
              fontFamily: SERIF,
              fontStyle: 'italic',
              fontWeight: 400,
              fontSize: isSmallScreen ? '12px' : '14px',
              lineHeight: 1.15,
              color: 'rgba(255,255,255,0.78)',
              letterSpacing: '0.01em',
              whiteSpace: 'nowrap',
              marginBottom: isSmallScreen ? '6px' : '8px',
            }}
          >
            Unlimited AI generation
          </div>

          {/* Title — 大字 display，Crimson Pro，发光效果 */}
          <div
            className="relative font-semibold leading-none"
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: isSmallScreen ? '26px' : '36px',
              color: '#ffffff',
              letterSpacing: '-0.02em',
              whiteSpace: 'nowrap',
              textShadow: '0 0 12px rgba(255,255,255,0.55), 0 0 28px rgba(167,139,250,0.45), 0 0 48px rgba(99,102,241,0.35)',
            }}
          >
            Upgrade Plan
          </div>

          {/* CTA — 带 .upgrade-glow rainbow 动画，与桌面 NavigationBar 统一 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpgrade?.(); }}
            className="upgrade-glow relative inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-all duration-200 hover:scale-[1.04] active:scale-[0.97]"
            style={{
              marginTop: isSmallScreen ? '12px' : '16px',
              padding: isSmallScreen ? '7px 14px' : '8px 16px',
              fontSize: isSmallScreen ? '12px' : '13px',
              color: '#ffffff',
              background: 'rgba(255,255,255,0.10)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255,255,255,0.22)',
            }}
          >
            <RocketLaunch size={isSmallScreen ? 14 : 16} weight="fill" style={{ color: '#ffffff' }} />
            <span style={{ letterSpacing: '0.02em' }}>Upgrade</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Chips row with inline search ─── */
function ChipsWithSearch({ chips, activeFilter, setActiveFilter, isDark, isSmallScreen, onSearch, allItems, hideSearch }) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [hoveredChip, setHoveredChip] = useState(null);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);

  /* Generate suggestions from allItems based on query */
  useEffect(() => {
    if (!searchQuery.trim()) { setSuggestions([]); setSelectedIdx(-1); return; }
    const q = searchQuery.toLowerCase();
    const matches = allItems
      .filter(item =>
        item.title?.toLowerCase().includes(q) ||
        item.artist?.toLowerCase().includes(q) ||
        item.tags?.some(t => t.toLowerCase().includes(q))
      )
      .slice(0, 6)
      .map(item => ({ id: item.id, text: item.title, sub: item.artist || item.tags?.[0] || item.mediaKind, item }));
    setSuggestions(matches);
    setSelectedIdx(-1);
  }, [searchQuery, allItems]);

  /* Close on outside click */
  useEffect(() => {
    if (!searchExpanded) return;
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setSearchExpanded(false);
        setSearchQuery('');
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchExpanded]);

  const submitSearch = (query) => {
    const q = query || searchQuery;
    if (!q.trim()) return;
    onSearch?.(q.trim());
    setSearchExpanded(false);
    setSearchQuery('');
    setSuggestions([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(prev => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && suggestions[selectedIdx]) {
        submitSearch(suggestions[selectedIdx].text);
      } else {
        submitSearch();
      }
    } else if (e.key === 'Escape') {
      setSearchExpanded(false);
      setSearchQuery('');
      setSuggestions([]);
    }
  };

  return (
    <div className={`${isSmallScreen ? 'mb-3' : 'py-3'}`}>
      {/* Chips + Search in one row
          Mobile: negative margin breaks out of section px-4 so chips reach screen edge;
          overflow-x:scroll + touch-action:pan-x fixes iOS Safari horizontal swipe     */}
      <div
        className={`flex items-center gap-2 flex-nowrap scrollbar-none`}
        style={isSmallScreen ? {
          overflowX: 'scroll',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          paddingBottom: '2px',
          /* Fade mask aligned to section content width (no negative margin) */
          WebkitMaskImage: 'linear-gradient(to right, black 0px, black calc(100% - 32px), transparent 100%)',
          maskImage:        'linear-gradient(to right, black 0px, black calc(100% - 32px), transparent 100%)',
        } : undefined}
      >
        {chips.map((chip, i) => {
          const isFirst  = i === 0;
          const isActive = isFirst ? activeFilter === null : activeFilter === chip;
          const isHovered = hoveredChip === chip && !isActive;
          return (
            <button
              key={chip}
              onClick={() => setActiveFilter(isFirst ? null : isActive ? null : chip)}
              onMouseEnter={() => setHoveredChip(chip)}
              onMouseLeave={() => setHoveredChip(null)}
              className="relative overflow-clip rounded-[10px] cursor-pointer whitespace-nowrap flex items-center justify-center transition-all duration-200"
              style={{
                height: '28px',
                padding: '0 10px',
                fontSize: '14px',
                fontWeight: 600,
                lineHeight: '18px',
                border: 'none',
                flexShrink: 0,
                color: isActive
                  ? (isDark ? '#000' : '#fff')
                  : (isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.65)'),
              }}
            >
              {/* visionOS Button glass background */}
              <span className="absolute inset-0 pointer-events-none rounded-[10px]" aria-hidden="true">
                {isActive ? (
                  /* Selected: solid platter */
                  <span className="absolute inset-0 rounded-[10px]" style={{
                    backgroundColor: isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.85)',
                  }} />
                ) : (
                  /* Idle (Platter): two-layer glass */
                  <>
                    <span className="absolute inset-0 rounded-[10px]" style={{
                      backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
                      mixBlendMode: isDark ? 'lighten' : 'normal',
                    }} />
                    <span className="absolute inset-0 rounded-[10px]" style={{
                      backgroundColor: isDark ? 'rgba(94,94,94,0.18)' : 'rgba(0,0,0,0.04)',
                      mixBlendMode: isDark ? 'color-dodge' : 'normal',
                    }} />
                    {/* Hover: radial gradient highlight from bottom-center (visionOS spec) */}
                    {isHovered && (
                      <>
                        <span className="absolute inset-0 rounded-[10px]" style={{
                          backgroundImage: isDark
                            ? 'radial-gradient(ellipse at 50% 100%, rgba(255,255,255,0.07) 0%, transparent 55.6%)'
                            : 'radial-gradient(ellipse at 50% 100%, rgba(0,0,0,0.04) 0%, transparent 55.6%)',
                          mixBlendMode: isDark ? 'lighten' : 'normal',
                        }} />
                        <span className="absolute inset-0 rounded-[10px]" style={{
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

        {/* Search pill — hidden on mobile (moved to Header) */}
        {!hideSearch && <div ref={wrapperRef} className="relative flex-shrink-0" style={{ zIndex: 30 }}>
        <div
          className="flex items-center rounded-full relative"
          style={{
            width: searchExpanded ? '305px' : '40px',
            height: '40px',
            padding: '0 6px',
            overflow: 'clip',
            cursor: searchExpanded ? 'text' : 'pointer',
            transition: 'width 0.4s cubic-bezier(0.26, 1, 0.48, 1)',
          }}
          onClick={() => { if (!searchExpanded) { setSearchExpanded(true); setTimeout(() => inputRef.current?.focus(), 100); } }}
        >
          {/* visionOS glass background layers */}
          <div className="absolute inset-0 pointer-events-none rounded-full" aria-hidden="true">
            <div className="absolute inset-0 rounded-full" style={{
              backgroundColor: isDark ? 'rgba(80,80,80,0.45)' : 'rgba(208,208,208,0.5)',
              mixBlendMode: 'color-burn',
            }} />
            <div className="absolute inset-0 rounded-full" style={{
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.1)',
              mixBlendMode: 'luminosity',
            }} />
          </div>
          {/* Inner shadow overlay */}
          <div className="absolute inset-0 pointer-events-none rounded-full" aria-hidden="true" style={{
            boxShadow: 'inset 0px -0.5px 1px rgba(255,255,255,0.3), inset 0px -0.5px 1px rgba(255,255,255,0.25), inset 1px 1.5px 4px rgba(0,0,0,0.08), inset 1px 1.5px 4px rgba(0,0,0,0.1)',
          }} />

          {/* Search icon — 28×28 container */}
          <div className="flex items-center justify-center flex-shrink-0 rounded-full relative" style={{ width: '28px', height: '28px' }}>
            <MagnifyingGlass
              size={17}
              weight="bold"
              style={{ color: isDark ? 'rgba(255,255,255,0.55)' : '#545454' }}
            />
          </div>

          {/* Placeholder or Input */}
          {!searchExpanded ? (
            /* Collapsed: no text shown, icon only */
            null
          ) : (
            <div className="flex flex-1 items-center min-w-0 h-full relative" style={{ gap: '4px' }}>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent outline-none border-none"
                style={{
                  fontFamily: "'Inter', -apple-system, sans-serif",
                  fontSize: '17px',
                  fontWeight: 500,
                  color: searchQuery
                    ? (isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.85)')
                    : (isDark ? 'rgba(255,255,255,0.55)' : '#545454'),
                  caretColor: '#0091ff',
                  padding: 0,
                  minWidth: 0,
                  lineHeight: '22px',
                }}
                placeholder="Search"
              />
              {/* Clear button — shown when there's text */}
              {searchQuery && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSearchQuery(''); inputRef.current?.focus(); }}
                  className="flex items-center justify-center flex-shrink-0 rounded-full cursor-pointer"
                  style={{
                    width: '28px',
                    height: '28px',
                    border: 'none',
                    backgroundColor: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
                    color: isDark ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.45)',
                    fontSize: '13px',
                    fontWeight: 600,
                  }}
                  aria-label="Clear search"
                >✕</button>
              )}
            </div>
          )}
        </div>

        {/* Suggestions dropdown */}
        {searchExpanded && suggestions.length > 0 && (
          <div
            className="absolute left-0 mt-2"
            style={{
              width: '305px',
              borderRadius: '22px',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              backgroundColor: isDark ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(48px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(48px) saturate(1.6)',
              boxShadow: isDark
                ? '0 8px 32px rgba(0,0,0,0.50), inset 0 -0.5px 1px rgba(255,255,255,0.15), inset 0 0.5px 0 rgba(255,255,255,0.08)'
                : '0 8px 32px rgba(0,0,0,0.12), inset 0 -0.5px 1px rgba(255,255,255,0.5), inset 0 0.5px 0 rgba(255,255,255,0.3)',
              border: isDark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.06)',
            }}
          >
            {suggestions.map((s, i) => (
              <button
                key={s.id}
                className="flex items-center gap-3 w-full text-left cursor-pointer"
                style={{
                  padding: '8px 12px',
                  borderRadius: '12px',
                  border: 'none',
                  backgroundColor: i === selectedIdx
                    ? (isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)')
                    : 'transparent',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => submitSearch(s.text)}
              >
                <MagnifyingGlass size={14} style={{ color: isDark ? 'rgba(255,255,255,0.40)' : 'rgba(0,0,0,0.35)', flexShrink: 0 }} />
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: '13px', fontWeight: 500, color: isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.text}
                  </div>
                  {s.sub && (
                    <div style={{ fontSize: '11px', color: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {s.sub}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>}{/* end search wrapper */}
      </div>{/* end flex-nowrap row */}
    </div>
  );
}

/* media_kind → Phosphor icon (Title Case 对齐 migration 20260420 line 63-64 约定) */
function TypeIcon({ mediaKind, size = 16 }) {
  const props = { size, className: 'text-white' };
  switch (mediaKind) {
    case 'Video': return <PlayCircle {...props} weight="fill" />;
    case 'Image': return <Globe      {...props} />;
    case 'Live':  return <Broadcast  {...props} weight="fill" />;
    default:      return <PlayCircle {...props} weight="fill" />;
  }
}

export default function MasonryGrid({
  isSmallScreen,
  filteredMediaItems,
  activeFilter,
  setActiveFilter,
  chips = ['All'],
  title = 'Discover',
  isMuted,
  likedItems,
  toggleLike,
  savedItems,
  toggleSave,
  onPlay = () => {},
  cardRefs,
  videoRefs,
  audioRefs,
  hoveredCard,
  setHoveredCard,
  visibleCards,
  onSearch,            /* (query: string) => void — navigate to search results page */
  allItems = [],       /* all media items for generating suggestions */
  overDarkBg = false,  /* true when rendered below Hero (dark gradient bg regardless of theme) */
  onChain,             /* (item) => void — "然后呢？" chain/sequel CTA */
  hideSearch = false,  /* hide search pill from chips row (mobile: search lives in Header) */
  showUpgradePromo = false, /* render UpgradePromoCard after chips (mobile explore only) */
  onUpgrade,           /* () => void — click handler for UpgradePromoCard (navigate to subscription) */
  ownerUserId,         /* string | null — when set, cards owned by this user show a privacy toggle */
  onTogglePublished,   /* (item, makePublished) => Promise<void> — privacy toggle handler */
  /* §2026-05-23 fei: mobile pagination.
   *   mobilePageLimit: when set on small screens, cap the grid at this
   *     many items and render a "Load more" button below to extend.
   *   onLoadMore: tap handler for the button. Should increment the limit
   *     state in the parent and pass the new value back.
   *   onRefreshMobile: tap handler for the "换一批" link next to Load
   *     More. Should re-shuffle the parent feed AND reset limit back
   *     to mobilePageLimit's starting value (e.g., 25). */
  mobilePageLimit,
  onLoadMore,
  onRefreshMobile,
}) {
  const navigate = useNavigate();

  /* ── Report-content modal state ──
   * Single state for any card's flag click; modal renders via portal-like
   * absolutely-positioned div at the end of the JSX. We only track the
   * minimum needed to render — type / id / display title. */
  const [reportingItem, setReportingItem] = useState(null);
  /* §2026-05-25 fei — detect real aspect ratio from cover image natural
   * dimensions to auto-correct cards whose DB row stored a wrong / missing
   * aspect_ratio. Without this, a landscape 16:9 video stored as 9:16 default
   * shows as a tall blue placeholder box with the video shrunk at the bottom
   * (object-contain letterboxing). Once the cover image loads, we have the
   * real ratio — override the card sizing so the media fills the frame.
   *
   * Note: this DOES cause a small layout shift on first load. Acceptable
   * trade-off vs the "empty box" alternative. Long-term fix is a server-
   * side backfill of recommended_content.aspect_ratio. */
  const [detectedAspectRatios, setDetectedAspectRatios] = useState({});
  // §2026-06-02 BUG-005 — 缩略图加载失败的卡(如 CF Stream 424 孤儿)→ 占位层
  //   显示"视频不可用"兜底,而不是只剩一块底色 + 点击无反应。video 元数据
  //   成功加载时会清掉该标记(避免"封面挂了但视频其实能播"的误判)。
  const [coverErrors, setCoverErrors] = useState({});

  /* ── Dark-mode awareness ── */
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    const sync = () => setSystemDark(document.documentElement.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  const isDark = overDarkBg || systemDark;

  /* ─ Hero 提取 ─────────────────────────────────────────────────────────
   * `pinned === true && pinOrder === 1` 的卡片会被从瀑布流抽出来，用
   * HeroCard 渲染成全宽 16:9 置顶 banner。剩余 items 正常进瀑布流。
   * 多条 pin_order=1 时取第一条（正常情况下 admin 会限制唯一性）。
   * ─────────────────────────────────────────────────────────────────── */
  const heroItem = filteredMediaItems.find(i => i.pinned === true && i.pinOrder === 1);
  const baseGridItems = heroItem
    ? filteredMediaItems.filter(i => i.id !== heroItem.id)
    : filteredMediaItems;

  /* ── Upgrade promo 注入 — 作为 gridItems[0] 占据 col-0 顶端的瀑布流卡 ──
   * 条件由父页控制 (showUpgradePromo prop)。合成一个 __isPromo 标记的 item，
   * 底下渲染循环看到此标记就走 <UpgradePromoCard />，其他照常走媒体卡片。
   * ─────────────────────────────────────────────────────────────────── */
  /* §2026-05-23 fei: mobile pagination. Cap baseGridItems to mobilePageLimit
   *   on small screens so the user isn't slammed with an unbounded grid.
   *   Promo card always counts as part of the limit so 25 truly means 25
   *   cards on screen. hasMoreMobile drives the "Load more" footer. */
  const baseGridItemsLimited =
    (isSmallScreen && typeof mobilePageLimit === 'number' && mobilePageLimit > 0)
      ? baseGridItems.slice(0, Math.max(0, mobilePageLimit - (showUpgradePromo ? 1 : 0)))
      : baseGridItems;
  const hasMoreMobile = isSmallScreen
    && typeof mobilePageLimit === 'number'
    && baseGridItems.length > baseGridItemsLimited.length;

  const gridItems = showUpgradePromo
    ? [{ id: '__upgrade_promo__', __isPromo: true }, ...baseGridItemsLimited]
    : baseGridItemsLimited;

  return (
    <section className={`${isSmallScreen ? 'px-4 pb-8' : 'pb-6'}`} style={isSmallScreen ? undefined : { paddingLeft: '92px', paddingRight: '56px' }}>

      {/* Hero card — 全宽 16:9 pinned banner（若存在） */}
      {heroItem && (
        <div className={isSmallScreen ? 'pb-3' : 'pt-1 pb-4'}>
          <HeroCard item={heroItem} isSmallScreen={isSmallScreen} />
        </div>
      )}

      {/* Filter chips + Search (hidden when chips is empty, e.g. search results page) */}
      {chips.length > 0 && (
        <ChipsWithSearch
          chips={chips}
          activeFilter={activeFilter}
          setActiveFilter={setActiveFilter}
          isDark={isDark}
          isSmallScreen={isSmallScreen}
          onSearch={onSearch}
          allItems={allItems}
          hideSearch={hideSearch}
        />
      )}

      {/* Masonry grid - shortest-column algorithm.
          Each card placed in the column with smallest accumulated height
          (using aspectRatio h/w as proxy). Replaces round-robin which
          produced visibly uneven columns when card aspectRatios differ. */}
      <div className={`flex gap-2 ${isSmallScreen ? '' : 'pt-2'}`}>
        {(() => {
          const colCount = isSmallScreen ? 2 : 5;
          const cols = Array.from({ length: colCount }, () => []);
          const colHeights = Array.from({ length: colCount }, () => 0);
          for (let i = 0; i < gridItems.length; i++) {
            const item = gridItems[i];
            // §2026-05-25 fei — prefer detected AR (from cover image) over DB
            const ar = detectedAspectRatios[item.id] || item.aspectRatio || '3/4';
            const parts = ar.split('/');
            const w = Number(parts[0]);
            const h = Number(parts[1]);
            const heightProxy = (w > 0 && h > 0) ? (h / w) : 1.33;
            let minCol = 0;
            for (let c = 1; c < colCount; c++) {
              if (colHeights[c] < colHeights[minCol]) minCol = c;
            }
            cols[minCol].push({ item, index: i });
            colHeights[minCol] += heightProxy;
          }
          return cols.map((col, colIdx) => (
            <div key={colIdx} className="flex-1 min-w-0 flex flex-col gap-2">
              {col.map(({ item, index }) => (
          item.__isPromo ? (
            <UpgradePromoCard key={item.id} onUpgrade={onUpgrade} isSmallScreen={isSmallScreen} />
          ) : (
          <div
            key={item.id}
            ref={el => { cardRefs.current[item.id] = el; }}
            data-card-id={item.id}
            className="group cursor-pointer transition-all duration-300"
            style={{ animationDelay: `${index * 50}ms` }}
            onClick={() => onPlay(item)}
          >
            <div
              className={`relative ${isSmallScreen ? 'rounded-md' : 'rounded-lg'} overflow-hidden shadow-lg hover:shadow-2xl transition-all duration-500 hover:-translate-y-1`}
              onMouseEnter={() => {
                setHoveredCard(item.id);
                if (item.video && videoRefs.current[item.id]) {
                  try {
                    const video = videoRefs.current[item.id];
                    if (typeof video.currentTime !== 'undefined') video.currentTime = 0;
                    if (typeof video.play === 'function') video.play()?.catch?.(() => {});
                  } catch(e) {}
                }
                if (item.audio && audioRefs.current[item.id]) {
                  const audio = audioRefs.current[item.id];
                  audio.currentTime = 0;
                  audio.play();
                }
              }}
              onMouseLeave={() => {
                setHoveredCard(null);
                if (item.video && videoRefs.current[item.id]) {
                  try {
                    const video = videoRefs.current[item.id];
                    if (typeof video.pause === 'function') video.pause();
                    if (typeof video.currentTime !== 'undefined') video.currentTime = 0;
                  } catch(e) {}
                }
                if (item.audio && audioRefs.current[item.id]) {
                  const audio = audioRefs.current[item.id];
                  audio.pause();
                  audio.currentTime = 0;
                }
              }}
            >
              {/* Media area
                  §2026-05-25 fei — aspect ratio now sourced from detected
                  AR (cover img natural dims) first, falling back to DB
                  stored aspect_ratio, then default. Eliminates the "tall
                  blue empty box with tiny letterboxed video" symptom for
                  rows whose DB aspect_ratio is wrong or missing. */}
              <div
                className="bg-gradient-to-br flex items-center justify-center relative overflow-hidden"
                style={{ aspectRatio: detectedAspectRatios[item.id] || item.aspectRatio || '3/4' }}
              >
                {/* ── Placeholder — always rendered as the bottom layer ──
                    Visible when cover/video missing or fails to load.       */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${item.color || 'from-violet-900 to-indigo-900'} flex items-center justify-center`}
                >
                  {/* Large semi-transparent type icon */}
                  <div style={{ opacity: 0.18 }}>
                    <TypeIcon mediaKind={item.mediaKind} size={isSmallScreen ? 40 : 52} />
                  </div>
                  {/* Subtle radial glow at center */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: 'radial-gradient(ellipse at 50% 60%, rgba(255,255,255,0.12) 0%, transparent 65%)',
                    }}
                  />
                  {/* §2026-06-02 BUG-005 — 封面/缩略图加载失败(如 CF Stream 424
                      孤儿)→ 明确提示"视频不可用",而不是只剩一块神秘底色。 */}
                  {coverErrors[item.id] && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/35 text-white/85 pointer-events-none">
                      <FilmSlate size={isSmallScreen ? 22 : 28} weight="duotone" />
                      <span className="text-[10px] font-medium tracking-wide">Video unavailable</span>
                    </div>
                  )}
                </div>

                {/* Cover image — alt="" prevents double-title on load error;
                    onError hides the broken-image element, revealing placeholder.
                    §2026-05-25 fei: switched back to object-cover now that
                    we detect the true aspect ratio from the image's natural
                    dimensions in onLoad and reflow the card to match.
                    No more letterboxing because the card matches the image. */}
                {item.cover && (
                  <img
                    src={item.cover}
                    alt=""
                    onError={e => { e.currentTarget.style.display = 'none'; setCoverErrors(prev => prev[item.id] ? prev : { ...prev, [item.id]: true }); }}
                    onLoad={e => {
                      const w = e.currentTarget.naturalWidth;
                      const h = e.currentTarget.naturalHeight;
                      if (!w || !h) return;
                      const detectedAr = `${w}/${h}`;
                      // Only override if it differs meaningfully (>15%) from
                      // what's already used — avoids needless re-renders for
                      // rows whose DB AR was correct.
                      const currentAr = item.aspectRatio || '3/4';
                      const [cw, ch] = currentAr.split('/').map(Number);
                      const currentRatio = (cw && ch) ? (cw / ch) : 0.75;
                      const detectedRatio = w / h;
                      const drift = Math.abs(detectedRatio - currentRatio) / currentRatio;
                      if (drift > 0.15) {
                        setDetectedAspectRatios(prev =>
                          prev[item.id] === detectedAr ? prev : { ...prev, [item.id]: detectedAr }
                        );
                      }
                    }}
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                      hoveredCard === item.id && item.video && visibleCards.has(item.id) ? 'opacity-0' : 'opacity-100'
                    }`}
                  />
                )}

                {/* Video (rendered lazily when card enters viewport)
                    §2026-05-23 fei: UnifiedVideoPlayer collapses what used
                    to be a CF Stream / direct-mp4 branch into a single
                    native <video> path. Same lifecycle for both URL flavors,
                    no iframe mount cost on hover. */}
                {item.video && visibleCards.has(item.id) && (
                  <UnifiedVideoPlayer
                    ref={el => {
                      videoRefs.current[item.id] = el;
                      if (el) el.muted = isMuted;
                    }}
                    src={item.video}
                    /* §2026-05-25 fei — object-contain → object-cover since
                       card AR is now auto-corrected from cover / video
                       metadata. No more letterboxing. */
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                      hoveredCard === item.id ? 'opacity-100' : 'opacity-0'
                    }`}
                    loop
                    playsInline
                    preload="auto"
                    muted={isMuted}
                    autoPlay={hoveredCard === item.id}
                    /* §2026-05-25 fei — fallback AR detection for items
                       without a cover image (Stream URL-only rows). Video
                       metadata gives us videoWidth/videoHeight. Same drift
                       threshold + idempotent setState as the cover onLoad. */
                    onLoadedMetadata={e => {
                      // §2026-06-02 BUG-005 — 视频元数据加载成功 = 能播,清掉
                      //   "视频不可用"误判(封面挂了但视频其实正常的情况)。
                      setCoverErrors(prev => { if (!prev[item.id]) return prev; const n = { ...prev }; delete n[item.id]; return n; });
                      const v = e.target;
                      const w = v?.videoWidth, h = v?.videoHeight;
                      if (!w || !h) return;
                      const detectedAr = `${w}/${h}`;
                      const currentAr = item.aspectRatio || '3/4';
                      const [cw, ch] = currentAr.split('/').map(Number);
                      const currentRatio = (cw && ch) ? (cw / ch) : 0.75;
                      const drift = Math.abs((w / h) - currentRatio) / currentRatio;
                      if (drift > 0.15) {
                        setDetectedAspectRatios(prev =>
                          prev[item.id] === detectedAr ? prev : { ...prev, [item.id]: detectedAr }
                        );
                      }
                    }}
                  />
                )}

                {/* Hidden audio element */}
                {item.audio && visibleCards.has(item.id) && (
                  <audio
                    ref={el => { audioRefs.current[item.id] = el; }}
                    src={item.audio}
                    preload="auto"
                  />
                )}

                {/* Hover overlay + Play FAB */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-300 flex items-center justify-center">
                  <GlassSurface
                    variant="clear"
                    onClick={(e) => { e.stopPropagation(); onPlay(item); }}
                    className="opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-300 cursor-pointer flex items-center justify-center rounded-full"
                    style={{
                      width:  isSmallScreen ? '40px' : '48px',
                      height: isSmallScreen ? '40px' : '48px',
                    }}
                    title="Play"
                  >
                    <Monitor size={isSmallScreen ? 16 : 20} color="white" />
                  </GlassSurface>
                </div>

                {/* Badge — top-left
                 * 显示优先级：
                 *   - 若是 series 卡片（tags 含 'series'）→ "Series · N eps"
                 *     依赖 Worker /api/series/publish 写入 'episodes:N' tag
                 *   - tags[0]（运营手动打的 #MV/#Trailer/#Vlog ...）
                 *   - mediaKind（Video/Image/Live 兜底）
                 * 2026-04-23 决策：tag-first 徽章；2026-05-08 增 series 增强支线 */}
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-1 rounded glass-chip text-xs font-medium text-white">
                    {(() => {
                      const isSeries = item.tags?.includes('series');
                      if (isSeries) {
                        const epTag = item.tags?.find(t => typeof t === 'string' && t.startsWith('episodes:'));
                        const count = epTag ? Number(epTag.split(':')[1]) : null;
                        return count ? `Series · ${count} ep${count === 1 ? '' : 's'}` : 'Series';
                      }
                      return item.tags?.[0] || item.mediaKind;
                    })()}
                  </span>
                </div>

                {/* Like + Save buttons — top-right
                 * 2026-04-25：与 SparkMode immersive 对齐 — 无容器，icon 在上、count 在下。
                 * text-shadow/drop-shadow 保障在浅色缩略图上也有对比。 */}
                <div className="absolute top-2 right-2 flex flex-col gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleLike(item.id); }}
                    className="flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer group/like"
                    style={{ width: 36, padding: '2px 4px' }}
                  >
                    <Heart
                      size={18}
                      weight={likedItems.has(item.id) ? 'fill' : 'regular'}
                      className={`transition-transform flex-shrink-0 ${
                        likedItems.has(item.id)
                          ? 'text-red-500 animate-heartbeat'
                          : 'text-white group-hover/like:scale-110'
                      }`}
                      style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                    />
                    {item.likesCount > 0 && (
                      <span className="text-[10px] leading-none font-medium text-white tabular-nums" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                        {formatCompactNumber(item.likesCount)}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSave?.(item.id); }}
                    className="flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer group/save"
                    style={{ width: 36, padding: '2px 4px' }}
                  >
                    <BookmarkSimple
                      size={18}
                      weight={savedItems?.has(item.id) ? 'fill' : 'regular'}
                      className={`transition-transform flex-shrink-0 ${
                        savedItems?.has(item.id)
                          ? 'text-amber-400'
                          : 'text-white group-hover/save:scale-110'
                      }`}
                      style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                    />
                    {item.savesCount > 0 && (
                      <span className="text-[10px] leading-none font-medium text-white tabular-nums" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
                        {formatCompactNumber(item.savesCount)}
                      </span>
                    )}
                  </button>
                  {/* Privacy toggle — only shown to the work's owner.
                      Click flips recommended_content.published. Parent
                      handles optimistic UI update + service call. */}
                  {ownerUserId && item.artist === ownerUserId && onTogglePublished && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePublished(item, !(item.published !== false));
                      }}
                      className="flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer group/priv"
                      style={{ width: 36, padding: '2px 4px' }}
                      title={item.published !== false ? 'Public — click to make private' : 'Private — click to make public'}
                    >
                      {item.published !== false ? (
                        <Globe
                          size={18}
                          weight="fill"
                          className="transition-transform flex-shrink-0 text-emerald-400 group-hover/priv:scale-110"
                          style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                        />
                      ) : (
                        <Lock
                          size={18}
                          weight="fill"
                          className="transition-transform flex-shrink-0 text-zinc-300 group-hover/priv:scale-110"
                          style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                        />
                      )}
                    </button>
                  )}
                  {/* Report (flag) — DMCA + abuse reporting entry point.
                   * Visible only on hover (group-hover) to avoid clutter,
                   * always tappable on touch devices via opacity-100 below.
                   * Tag-aware: for series cards we'll prefer the series row
                   * as the report target (lets admin trace back to source),
                   * otherwise we report the recommended_content row directly.
                   * 2026-05-08 added in v1.0.7 P0 compliance push. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const seriesTag = item.tags?.find(t => typeof t === 'string' && t.startsWith('series:'));
                      const seriesId = seriesTag?.split(':')[1];
                      setReportingItem({
                        contentType: seriesId ? 'series' : 'recommended_content',
                        contentId: seriesId || item.id,
                        title: item.title,
                      });
                    }}
                    className="flex flex-col items-center justify-center gap-0.5 bg-transparent border-0 cursor-pointer group/flag opacity-0 group-hover:opacity-90 md:opacity-90 transition-opacity"
                    style={{ width: 36, padding: '2px 4px' }}
                    aria-label="Report this content"
                    title="Report content"
                  >
                    <Flag
                      size={16}
                      className="text-white/85 group-hover/flag:scale-110 transition-transform flex-shrink-0"
                      style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.55))' }}
                    />
                  </button>
                </div>
              </div>

              {/* Title / artist overlay — slides up on hover.
               * 2026-04-26 iOS 16.7 fix：min-w-0 / flex-1 计算异常导致 title 被
               * 截到 1 字 + ellipsis（"O..." / "Uv..."）。改 inline style 显式
               * minWidth:0 + flex:1 1 0%，绕开 Tailwind v4 calc(var(--spacing)*0). */}
              <div className="absolute bottom-0 left-0 right-0 px-3 pt-6 pb-3 bg-gradient-to-t from-black/60 via-black/25 to-transparent text-white transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                <div className="flex items-end justify-between gap-2 flex-wrap" style={{ minWidth: 0 }}>
                  <div className="flex-1" style={{ minWidth: 0, flex: '1 1 0%' }}>
                    <h4 className="media-card-title font-medium text-sm mb-0.5 tracking-wide truncate" style={{ minWidth: 0, color: 'white' }}>{item.title}</h4>
                    <p className="media-card-artist text-xs truncate" style={{ minWidth: 0, color: 'rgba(255,255,255,0.75)' }}>{item.artist}</p>
                  </div>
                  {/* v2 CTA — operation-configured click-through (runs alongside What's next?).
                      - stopPropagation so tapping the pill doesn't trigger whole-card play/detail
                      - scheme allowlist: only http(s) + same-origin relative paths accepted
                      - 内部路由 (/ 开头) → SPA-safe react-router navigate()（共享 handleCtaClick）
                      - _blank → window.open with noopener
                      - 2026-04-21：从 window.location.href 切到 navigate()，避免内部跳转全页刷新 */}
                  {item.ctaLabel && item.ctaUrl && (() => {
                    const url = String(item.ctaUrl);
                    const safe = /^https?:\/\//i.test(url) || url.startsWith('/');
                    if (!safe) return null;
                    return (
                      <button
                        onClick={(e) => handleCtaClick(e, url, item.ctaTarget, navigate)}
                        aria-label={`CTA: ${item.ctaLabel}`}
                        className="opacity-0 group-hover:opacity-100 flex items-center flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
                        style={{
                          padding: '4px 10px',
                          borderRadius: '20px',
                          background: 'rgba(255,255,255,0.15)',
                          border: '1px solid rgba(255,255,255,0.28)',
                          backdropFilter: 'blur(12px)',
                          WebkitBackdropFilter: 'blur(12px)',
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'rgba(255,255,255,0.92)',
                          whiteSpace: 'nowrap',
                          lineHeight: '1',
                        }}
                        title={item.ctaLabel}
                      >
                        {item.ctaLabel}
                      </button>
                    );
                  })()}
                  {/* What's next? — chain/sequel CTA, Video only (Image 按钮显隐待产品决策 2026-04-23) */}
                  {onChain && item.mediaKind === 'Video' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onChain(item); }}
                      className="opacity-0 group-hover:opacity-100 flex items-center gap-1 flex-shrink-0 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
                      style={{
                        padding: '4px 10px 4px 8px',
                        borderRadius: '20px',
                        background: 'rgba(255,255,255,0.15)',
                        border: '1px solid rgba(255,255,255,0.28)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'rgba(255,255,255,0.92)',
                        whiteSpace: 'nowrap',
                        lineHeight: '1',
                      }}
                      title="What's next? Create a sequel"
                    >
                      <ArrowElbowRight size={12} weight="bold" />
                      What's next?
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
          )
              ))}
            </div>
          ));
        })()}
      </div>

      {/* §2026-05-23 fei: mobile pagination footer. Renders only on small
       *   screens when mobilePageLimit is set. "加载更多" extends by another
       *   page; "换一批" reshuffles the source feed and resets the limit.
       *   When everything's been loaded, the Load more button becomes a
       *   "换一批" call-to-action so the user always has a fresh option. */}
      {isSmallScreen && typeof mobilePageLimit === 'number' && (onLoadMore || onRefreshMobile) && (
        <div className="flex flex-col items-center gap-2 mt-5 mb-3">
          {hasMoreMobile && onLoadMore && (
            <button
              onClick={onLoadMore}
              className="px-5 py-2.5 rounded-full text-sm font-medium bg-white/10 hover:bg-white/15 text-white border border-white/15 backdrop-blur-md transition-colors"
            >
              加载更多
            </button>
          )}
          {!hasMoreMobile && onRefreshMobile && (
            <button
              onClick={onRefreshMobile}
              className="px-5 py-2.5 rounded-full text-sm font-medium bg-white/10 hover:bg-white/15 text-white border border-white/15 backdrop-blur-md transition-colors"
            >
              已加载全部 · 点击换一批
            </button>
          )}
          {hasMoreMobile && onRefreshMobile && (
            <button
              onClick={onRefreshMobile}
              className="text-xs text-white/55 hover:text-white/80 transition-colors"
            >
              换一批
            </button>
          )}
        </div>
      )}

      {/* Report-content modal — single instance, driven by reportingItem state.
       * Lives at section root so its fixed-positioned overlay isn't clipped
       * by parent overflow / transform contexts. */}
      <ReportContentModal
        open={!!reportingItem}
        onClose={() => setReportingItem(null)}
        contentType={reportingItem?.contentType}
        contentId={reportingItem?.contentId}
        contentTitle={reportingItem?.title}
      />
    </section>
  );
}

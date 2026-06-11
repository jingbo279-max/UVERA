/**
 * NavigationBar (aka Header) — iOS 26 HIG aligned
 * Figma: TODO (Uvera Design System → Navigation → NavigationBar)
 * iOS mapping: UINavigationBar + glass buttons (.thinMaterial / .thickMaterial)
 */
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SpeakerHigh, SpeakerSlash, Sun, Moon, CircleHalf, RocketLaunch, GlobeSimple, MagnifyingGlass, CaretLeft, X, Sparkle as SparkleToken, FilmSlate, FilmStrip, FlowArrow, Lock } from '@phosphor-icons/react';
import SegmentedControl from './SegmentedControl';
import GlassButton from '../primitives/GlassButton';
import { supabase, getUserProfile } from '../../api/supabaseClient';
import useUcoinsWallet from '../../hooks/useUcoinsWallet';
import { openSubscriptionModal } from '../../utils/subscriptionModal';
import { canAccessSeries, canAccessFlow, tierUnlocking, TIER_DISPLAY } from '../../data/plans';
import { getUserLang, setUserLang } from '../../utils/i18n';

/* ── Create channel pills — desktop header centre (2026-05-11 Leon) ──
 * 把 Short/Series/Flow 三 pill 放进 Header,腾出主内容垂直空间。
 * Single-line icon + title,active 用 glass-clear / default ultra-thin。
 * Click 通过 React Router navigate(/create/*),URL 是 single source of truth。 */
function CreateChannelPills({ pathname, onNavigate, currentTier = 'free' }) {
  /* P1 tier-gate: Series 需 CREATOR+,Flow 需 STUDIO。
     locked pill 不允许 navigate,改 dispatch UPGRADE_MODAL + alert 提示。 */
  const pills = [
    /* Short icon 从 Sparkle 换 FilmSlate (2026-05-13 Leon):
       Sparkle 是 Token pill + 全站 AI/AIGen 触发按钮的统一图标 (token、
       Summon AI、AI generate 等),Short pill 再用 Sparkle 视觉重复且语义混淆。
       FilmSlate (打板器) 表达"短片创作"语义,与 Series 的 FilmStrip
       (胶片)、Flow 的 FlowArrow 形成同一影像生产语义家族。 */
    { key: 'short',  title: 'Short',  icon: FilmSlate, path: '/create/short',  locked: false },
    { key: 'series', title: 'Series', icon: FilmStrip, path: '/create/series', locked: !canAccessSeries(currentTier), unlockTier: tierUnlocking('series') },
    { key: 'flow',   title: 'Flow',   icon: FlowArrow, path: '/create/flow',   locked: !canAccessFlow(currentTier),   unlockTier: tierUnlocking('flow'), badge: 'Beta' },
  ];
  const activeKey =
    pathname === '/create/short'  ? 'short'  :
    pathname === '/create/series' ? 'series' :
    pathname === '/create/flow'   ? 'flow'   : null;

  /* 2026-05-12 P1 — locked pill 也 navigate(URL 反映 intent + 刷新保留);
     content area 接管显示 LockedFeaturePreview 提示 + Upgrade CTA。
     不再 alert (alert 是 modal 阻塞,UX 差)。 */
  const handleClick = (pill) => {
    onNavigate(pill.path);
  };

  return (
    <div className="flex gap-2 items-center">
      {pills.map(pill => {
        const isActive  = activeKey === pill.key;
        const Icon      = pill.icon;
        const iconColor = pill.locked ? 'text-label-tertiary' : 'text-accent';
        return (
          <button
            key={pill.key}
            onClick={() => handleClick(pill)}
            className={`flex items-center justify-center gap-2 px-3 py-2 rounded-full cursor-pointer transition-colors w-[120px] ${isActive ? 'glass-clear' : 'glass-ultra-thin'} ${pill.locked ? 'opacity-60' : ''}`}
            title={pill.locked && pill.unlockTier ? `Unlocks on ${TIER_DISPLAY[pill.unlockTier]?.label}` : pill.title}
          >
            {pill.locked
              ? <Lock size={14} weight="fill" className="text-label-tertiary" />
              : <Icon size={18} weight="fill" className={iconColor} />}
            <span className={`text-sm font-medium leading-none ${pill.locked ? 'text-label-secondary' : 'text-label'}`}>
              {pill.title}
            </span>
            {pill.badge && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold tracking-wider uppercase bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 leading-none">
                {pill.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

const LANGUAGES = [
  { value: 'en',    label: 'English' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
];

const UPGRADE_LABEL = { free: 'Upgrade Plan', starter: 'Go Creator', creator: 'Go Studio', studio: 'Go Business' };

export default function Header({
  sidebar, isSmallScreen, isMuted, setIsMuted, darkMode, setDarkMode,
  setActiveSection, onLogoClick, overDarkBg, subscriptionTier = 'free',
  /* Mobile-only props */
  activeSection, discoverTab, setDiscoverTab, discoverSegments, onMobileSearch,
  /* Discover immerse 态 (2026-04-25): 左槽显示返回按钮 (2026-05-14 SquaresFour → CaretLeft) */
  discoverView, onExitImmerse,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [kebabMenuOpen, setKebabMenuOpen] = useState(false);
  const [langMenuOpen,  setLangMenuOpen]  = useState(false);
  // §2026-06-06 fei — 语言选择持久化(之前是装饰性局部 state)。初始化读 localStorage→浏览器。
  const [language,      setLanguage]      = useState(() => getUserLang());
  /* 2026-05-07 Leon — Token + Upgrade segmented pill in header.
   * Fetch credits/tier。Mirror TabBar 模式：unconditional initial fetch
   * (getUserProfile 内部自己 getUser，无 session race 问题) + auth state
   * change 订阅。之前 getSession-gated 写法在 session 未 hydrated 时 return
   * early 导致 credits 一直是 0。 */
  const [credits, setCredits] = useState(0);
  const [tier,    setTier]    = useState('free');
  // §2026-06-09 (Leon「Header 也进统一缓存」)— Header 余额改读共享 useUcoinsWallet
  //   (与 Wallet/订阅浮窗同一来源,pub/sub 实时同步);getUserProfile 仅留 tier +
  //   首帧 fallback。displayCredits 下方统一取 wallet.ucoins ?? credits。
  const { wallet: sharedWallet } = useUcoinsWallet({ withPackages: false });
  const displayCredits = sharedWallet?.ucoins ?? credits;
  useEffect(() => {
    let cancelled = false;
    const apply = (profile) => {
      if (cancelled || !profile) return;
      setCredits(profile.credits ?? 0);
      setTier(profile.tier ?? 'free');
    };
    getUserProfile().then(apply).catch(() => {});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled || !session?.user) return;
      getUserProfile().then(apply).catch(() => {});
    });

    /* 2026-05-13 Leon — Window focus refresh 已提到 supabaseClient.js 模块级
       singleton (避免多组件并发 refreshSession 触发 navigator.locks
       AbortError)。此处只 listen TOKEN_REFRESHED 事件更新本地 state。 */

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  /* Mobile search state */
  const [mobileSearchOpen,  setMobileSearchOpen]  = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const mobileSearchInputRef = useRef(null);

  /* Reset mobile search on section change */
  useEffect(() => {
    setMobileSearchOpen(false);
    setMobileSearchQuery('');
  }, [activeSection]);

  /* ── CTA adaptive color ── */
  const ctaRef = useRef(null);
  const [ctaOverDark, setCtaOverDark] = useState(overDarkBg ?? true);
  useEffect(() => {
    const header = ctaRef.current?.closest('header');
    if (!header) return;
    const main = header.closest('[style*="position"]')?.parentElement;
    const scroller = main?.querySelector('.overflow-y-auto');
    if (!scroller) return;
    const check = () => {
      const hero = scroller.querySelector('section.group');
      if (!hero) { setCtaOverDark(overDarkBg ?? false); return; }
      const heroBottom = hero.getBoundingClientRect().bottom;
      const headerBottom = header.getBoundingClientRect().bottom;
      const dark = document.documentElement.classList.contains('dark');
      setCtaOverDark(dark || heroBottom > headerBottom);
    };
    scroller.addEventListener('scroll', check, { passive: true });
    check();
    return () => scroller.removeEventListener('scroll', check);
  }, [overDarkBg]);

  /* ── Dark-mode awareness ── */
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const sync = () => setIsDark(document.documentElement.classList.contains('dark'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  /* iOS 26: .thickMaterial only for dark-on-dark, otherwise .thinMaterial */
  const glassBtn  = (overDarkBg && isDark) ? 'glass-prominent' : 'glass-clear';
  const onDarkBg  = overDarkBg || isDark;
  const btnIcon   = onDarkBg ? 'rgba(255,255,255,0.70)' : 'rgba(0,0,0,0.40)';
  const ctaColor  = ctaOverDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';

  const dd = overDarkBg || isDark;
  const dc = {
    text:        dd ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
    textFaint:   dd ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.30)',
    activeBg:    dd ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)',
    hoverBg:     dd ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
  };
  const c = {
    text:        isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)',
    textMuted:   isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)',
    dropBg:      isDark ? 'rgba(30,28,35,0.96)'    : 'rgba(255,255,255,0.96)',
    dropBorder:  isDark ? 'rgba(255,255,255,0.10)'  : 'rgba(0,0,0,0.08)',
    activeBg:    isDark ? 'rgba(255,255,255,0.10)'  : 'rgba(0,0,0,0.06)',
    hoverBg:     isDark ? 'rgba(255,255,255,0.08)'  : 'rgba(0,0,0,0.06)',
    hoverGlass:  isDark ? 'rgba(255,255,255,0.12)'  : 'rgba(255,255,255,0.28)',
  };

  /* Close menus on outside click */
  useEffect(() => {
    if (!kebabMenuOpen) return;
    const h = (e) => { if (!e.target.closest('.kebab-menu-area')) setKebabMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [kebabMenuOpen]);
  useEffect(() => {
    if (!langMenuOpen) return;
    const h = (e) => { if (!e.target.closest('.lang-menu-area')) setLangMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [langMenuOpen]);

  const submitMobileSearch = () => {
    if (!mobileSearchQuery.trim()) return;
    onMobileSearch?.(mobileSearchQuery.trim());
    setMobileSearchOpen(false);
    setMobileSearchQuery('');
  };

  /* ─────────────────────────────────────────────────────────────────────
     MOBILE HEADER
     Layout: [SegmentedControl] [flex-1] [🔍]
     When searching: [←] [input] [→]
     ───────────────────────────────────────────────────────────────────── */
  if (isSmallScreen) {
    /* Discover browse 态：显示 SegmentedControl（follow/discover 切换）。
     * Discover immerse 态：隐藏 seg，左槽换成 CaretLeft 返回按钮。 */
    const isImmerse = activeSection === 'discover' && discoverView === 'immerse';
    const showSeg   = activeSection === 'discover' && !isImmerse && !!discoverSegments;

    return (
      <header
        className="z-40 flex items-center"
        style={{
          height: '52px',
          flexShrink: 0,
          paddingLeft: '12px',
          paddingRight: '12px',
          backgroundColor: 'transparent',
          pointerEvents: 'none',
          overflow: 'visible',
          gap: '8px',
        }}
      >
        {mobileSearchOpen ? (
          /* ── Search mode ── */
          <>
            <button
              onClick={() => { setMobileSearchOpen(false); setMobileSearchQuery(''); }}
              aria-label="Close search"
              className="flex items-center justify-center flex-shrink-0 rounded-full"
              style={{ width: '36px', height: '36px', pointerEvents: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <X size={20} weight="bold" style={{ color: btnIcon }} />
            </button>

            <div
              className="glass-clear flex flex-1 items-center rounded-full overflow-hidden"
              style={{
                height: '36px',
                padding: '0 12px',
                pointerEvents: 'auto',
                gap: '8px',
              }}
            >
              <input
                ref={mobileSearchInputRef}
                autoFocus
                type="text"
                value={mobileSearchQuery}
                onChange={e => setMobileSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitMobileSearch();
                  if (e.key === 'Escape') { setMobileSearchOpen(false); setMobileSearchQuery(''); }
                }}
                placeholder="Search"
                style={{
                  flex: 1,
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '16px', // ≥16px 防 iOS Safari focus 自动 zoom(移动端搜索框)
                  fontWeight: 500,
                  color: onDarkBg ? 'rgba(255,255,255,0.90)' : 'rgba(0,0,0,0.85)',
                  minWidth: 0,
                }}
              />
              {mobileSearchQuery && (
                <button
                  onClick={() => setMobileSearchQuery('')}
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
                >
                  <span style={{ fontSize: '13px', lineHeight: 1, color: onDarkBg ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)' }}>✕</span>
                </button>
              )}
            </div>

            <button
              onClick={submitMobileSearch}
              className="flex items-center justify-center flex-shrink-0 rounded-full"
              style={{ width: '36px', height: '36px', pointerEvents: 'auto', backgroundColor: 'rgba(99,102,241,0.85)', border: 'none', cursor: 'pointer' }}
            >
              <MagnifyingGlass size={16} weight="bold" style={{ color: 'white' }} />
            </button>
          </>
        ) : (
          /* ── Normal mode — 3-col grid so SegmentedControl is centred on screen ── */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '36px 1fr 36px',
              gap: '8px',
              alignItems: 'center',
              width: '100%',
            }}
          >
            {/* Left: immerse 态显示 CaretLeft 返回瀑布流;browse 态空占位保持居中。
             * 2026-05-14 Leon — 全站 back 按钮统一 CaretLeft (从 SquaresFour 换)。 */}
            {isImmerse ? (
              <GlassButton
                onClick={() => onExitImmerse?.()}
                aria-label="Back to Discover"
                variant="prominent"
                size="regular"
                className="pointer-events-auto"
              >
                <CaretLeft size={20} weight="bold" style={{ color: onDarkBg ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)' }} />
              </GlassButton>
            ) : (
              <div />
            )}

            {/* Centre: SegmentedControl（仅 browse 态渲染） */}
            <div style={{ display: 'flex', justifyContent: 'center', pointerEvents: showSeg ? 'auto' : 'none' }}>
              {showSeg && (
                <SegmentedControl
                  segments={discoverSegments}
                  value={discoverTab}
                  onChange={val => setDiscoverTab?.(val)}
                  className="w-full"
                  overDark={overDarkBg}
                />
              )}
            </div>

            {/* Right: Search button — immerse 态隐藏 */}
            {activeSection === 'discover' && !isImmerse ? (
              <button
                onClick={() => setMobileSearchOpen(true)}
                className="flex items-center justify-center cursor-pointer glass-prominent rounded-full"
                style={{ width: '36px', height: '36px', pointerEvents: 'auto', border: 'none' }}
              >
                <MagnifyingGlass size={18} style={{ color: onDarkBg ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.65)' }} />
              </button>
            ) : (
              <div />
            )}
          </div>
        )}
      </header>
    );
  }

  /* ─────────────────────────────────────────────────────────────────────
     DESKTOP HEADER (unchanged)
     ───────────────────────────────────────────────────────────────────── */
  return (
    <header
      className="z-40 grid items-center"
      style={{
        height: '80px',
        flexShrink: 0,
        paddingRight: '24px',
        gridTemplateColumns: '1fr auto 1fr',
        backgroundColor: 'transparent',
        pointerEvents: 'none',
        overflow: 'visible',
      }}
    >
      {/* Left: Logo */}
      <div className="relative z-10 flex items-center" style={{ pointerEvents: 'none', paddingLeft: '24px' }}>
        <button
          onClick={() => onLogoClick ? onLogoClick() : setActiveSection?.('discover')}
          className="flex items-center gap-3 cursor-pointer"
          style={{ background: 'none', border: 'none', padding: 0, pointerEvents: 'auto' }}
        >
          <img
            src="/brand/uvera-logo.png"
            alt="UVERA"
            width="32"
            height="32"
            className="flex-shrink-0 rounded-full"
            style={{ display: 'block', width: '32px', height: '32px' }}
          />
        </button>
      </div>

      {/* Centre: SegmentedControl (discover) / CreateChannelPills (create) /
        * empty for other sections。Discover immerse 态隐藏让出沉浸感。 */}
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', pointerEvents: 'auto' }}>
        {activeSection === 'discover' && discoverView !== 'immerse' && !!discoverSegments && (
          <SegmentedControl
            segments={discoverSegments}
            value={discoverTab}
            onChange={val => setDiscoverTab?.(val)}
            className="w-[300px]"
            overDark={overDarkBg}
          />
        )}
        {activeSection === 'create' && (
          <CreateChannelPills pathname={location.pathname} onNavigate={navigate} currentTier={tier} />
        )}
      </div>

      {/* Right: Upgrade → Language → Theme → Mute */}
      <div
        className="justify-self-end flex items-center"
        style={{ pointerEvents: 'auto', alignSelf: 'center', position: 'relative', zIndex: 20, gridColumn: '3', gap: '8px' }}
      >
        {/* Token pill (smaller, secondary CTA spec) + Upgrade pill (primary,
         * unchanged), 错位重叠 — token pill 右段被 Upgrade pill 压盖。
         * Spec: 镜像 Spark end-of-play "Branch this story" 的次级样式
         * (bg white@10 + 1px white@20 + blur 10)。颜色保持 glass 系（per
         * Leon: 颜色不发生变化）。 */}
        {UPGRADE_LABEL[tier] ? (
          <div className="flex items-center" style={{ height: '32px' }}>
            <button
              onClick={() => setActiveSection?.('wallet')}
              className="flex items-center cursor-pointer transition-colors hover:bg-white/18"
              style={{
                height: '28px',
                // 2026-05-08 Leon — overlap 区域按 upgrade pill 圆角形状蒙版
                // 切（不是粗暴矩形）。dual-layer mask：
                //   layer 1: 左 (100%-28px) solid white 全可见
                //   layer 2: 右 28px SVG 蒙版 — 白底 + 黑圆角矩形（rx=16
                //     模拟 upgrade pill h=32 radius=16，y=-2 to 30 vertically
                //     centered relative to token h=28）
                // padding-right=40：12px effective right pad（content end 到
                // upgrade_left = mask cut 位置）+ 28px mask region. 让数字
                // 与可见 pill 右边缘有合理空隙（vs 之前 1px）。
                padding: '0 40px 0 12px',
                gap: '5px',
                borderRadius: '9999px',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.20)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                maskImage: "linear-gradient(white,white), url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' preserveAspectRatio='none'><rect width='28' height='28' fill='white'/><rect x='1' y='-2' width='28' height='32' rx='16' fill='black'/></svg>\")",
                WebkitMaskImage: "linear-gradient(white,white), url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 28 28' preserveAspectRatio='none'><rect width='28' height='28' fill='white'/><rect x='1' y='-2' width='28' height='32' rx='16' fill='black'/></svg>\")",
                maskSize: 'calc(100% - 28px) 100%, 28px 100%',
                WebkitMaskSize: 'calc(100% - 28px) 100%, 28px 100%',
                maskPosition: 'left center, right center',
                WebkitMaskPosition: 'left center, right center',
                maskRepeat: 'no-repeat, no-repeat',
                WebkitMaskRepeat: 'no-repeat, no-repeat',
                maskMode: 'luminance',
                marginRight: '-28px',
                zIndex: 1,
                position: 'relative',
              }}
            >
              <SparkleToken size={12} weight="fill" style={{ color: ctaColor }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: ctaColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                {displayCredits.toLocaleString()}
              </span>
            </button>
            {/* Upgrade Plan — Figma node 139:10057 (Apple HIG Segmented Control
             * Selected) styling，**尺寸保持原 32h / padding 14 / font 13**
             * 不变（per Leon: 尺寸不要变化）。Figma 部分仅取：
             *   - 0.5px white@40 border (替代原 glassBtn 边)
             *   - 2 层 mix-blend bg（white@6 lighten + grey@18 color-dodge）
             *   - drop shadow 0 2 4 black@10
             *   - text color rgba(255,255,255,0.96)
             * upgrade-glow rainbow underglow 保留不动。 */}
            <button
              ref={ctaRef}
              onClick={() => openSubscriptionModal()}
              className="upgrade-glow flex items-center cursor-pointer transition-all duration-300"
              style={{
                position: 'relative',
                isolation: 'isolate',
                height: '32px',
                padding: '0 14px',
                gap: '6px',
                borderRadius: '9999px',
                border: '0.5px solid rgba(255,255,255,0.40)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.10)',
                zIndex: 2,
              }}
            >
              {/* Mix-blend bg layers — 内 wrapper overflow:hidden 让 layers
               * clip 到 pill 形状；button 保持 overflow:visible 让 upgrade-glow
               * ::before rainbow 能延伸到下方。 */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 'inherit',
                  overflow: 'hidden',
                  pointerEvents: 'none',
                  zIndex: 0,
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.06)', mixBlendMode: 'lighten' }} />
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(94,94,94,0.18)', mixBlendMode: 'color-dodge' }} />
              </div>
              <RocketLaunch
                size={16}
                weight="fill"
                style={{ color: 'rgba(255,255,255,0.96)', position: 'relative', zIndex: 1 }}
              />
              <span style={{
                fontSize: '13px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.96)',
                whiteSpace: 'nowrap',
                letterSpacing: '0.02em',
                position: 'relative',
                zIndex: 1,
              }}>
                {UPGRADE_LABEL[tier]}
              </span>
            </button>
          </div>
        ) : (
          /* Top tier — only token pill, no upsell to overlap with */
          <button
            onClick={() => setActiveSection?.('wallet')}
            className="flex items-center cursor-pointer transition-colors hover:bg-white/18"
            style={{
              height: '28px',
              padding: '0 12px',
              gap: '5px',
              borderRadius: '9999px',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.20)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
            }}
          >
            <SparkleToken size={12} weight="fill" style={{ color: ctaColor }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: ctaColor, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              {displayCredits.toLocaleString()}
            </span>
          </button>
        )}

        {/* Language */}
        <div className="lang-menu-area" style={{ position: 'relative' }}>
          <button
            onClick={() => setLangMenuOpen(o => !o)}
            className={`flex items-center justify-center cursor-pointer ${glassBtn} rounded-full transition-all duration-300`}
            style={{ width: '32px', height: '32px' }}
            title="Language"
            onMouseEnter={(e) => { e.currentTarget.style.background = c.hoverGlass; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
          >
            <GlobeSimple size={18} weight="regular" style={{ color: btnIcon }} />
          </button>
          {langMenuOpen && (
            <div
              className="glass-regular"
              style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: '50%', transform: 'translateX(-50%)',
                borderRadius: '16px', padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '148px',
              }}
            >
              {LANGUAGES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => { setUserLang(value); setLanguage(value); setLangMenuOpen(false); }}
                  className="flex items-center cursor-pointer"
                  style={{
                    height: '36px', padding: '0 14px', borderRadius: '10px',
                    backgroundColor: language === value ? dc.activeBg : 'transparent',
                    border: 'none', transition: 'background-color 0.2s',
                    fontSize: '13px', fontWeight: language === value ? 600 : 500,
                    color: language === value ? dc.text : dc.textFaint,
                    whiteSpace: 'nowrap', textAlign: 'left', width: '100%',
                  }}
                  onMouseEnter={(e) => { if (language !== value) e.currentTarget.style.backgroundColor = dc.hoverBg; }}
                  onMouseLeave={(e) => { if (language !== value) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Theme */}
        <div className="kebab-menu-area" style={{ position: 'relative' }}>
          <button
            onClick={() => setKebabMenuOpen(o => !o)}
            className={`flex items-center justify-center cursor-pointer ${glassBtn} rounded-full transition-all duration-300`}
            style={{ width: '32px', height: '32px' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = c.hoverGlass; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
          >
            {darkMode === true  ? <Moon       size={18} weight="fill" style={{ color: btnIcon }} />
           : darkMode === false ? <Sun        size={18} weight="fill" style={{ color: btnIcon }} />
           :                      <CircleHalf size={18} weight="fill" style={{ color: btnIcon }} />}
          </button>
          {kebabMenuOpen && (
            <div className="glass-regular" style={{ position: 'absolute', top: 'calc(100% + 4px)', right: '0', borderRadius: '9999px', padding: '5px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { value: 'system', Icon: CircleHalf, label: 'System Default' },
                { value: false,    Icon: Sun,     label: 'Light Mode' },
                { value: true,     Icon: Moon,    label: 'Dark Mode' },
              ].map(({ value, Icon, label }) => (
                <button
                  key={label}
                  onClick={() => { setDarkMode(value); setKebabMenuOpen(false); }}
                  className="flex items-center justify-center cursor-pointer"
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    backgroundColor: darkMode === value ? dc.activeBg : 'transparent',
                    border: 'none', transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => { if (darkMode !== value) e.currentTarget.style.backgroundColor = dc.hoverBg; }}
                  onMouseLeave={(e) => { if (darkMode !== value) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  title={label}
                >
                  <Icon size={16} weight={Icon === CircleHalf ? 'fill' : 'regular'} style={{ color: darkMode === value ? dc.text : dc.textFaint }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mute */}
        <button
          onClick={() => setIsMuted(!isMuted)}
          className={`flex items-center justify-center cursor-pointer ${glassBtn} rounded-full transition-all duration-300`}
          style={{ width: '32px', height: '32px' }}
          title={isMuted ? 'Unmute' : 'Mute'}
          onMouseEnter={(e) => { e.currentTarget.style.background = c.hoverGlass; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
        >
          {isMuted
            ? <SpeakerSlash size={18} weight="regular" style={{ color: btnIcon }} />
            : <SpeakerHigh  size={18} weight="regular" style={{ color: btnIcon }} />}
        </button>
      </div>
    </header>
  );
}

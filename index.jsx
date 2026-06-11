import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLineUp, UserCircle, CaretLeft } from '@phosphor-icons/react';

import { useSidebarState, getMainPaddingLeft, SIDEBAR_MODE } from './src/hooks/useSidebarState';
import { useMediaQuery } from './src/hooks/useMediaQuery';
import { supabase } from './src/api/supabaseClient';
import AdminLogin        from './src/pages/admin/AdminLogin';
import AdminDashboard    from './src/pages/admin/AdminDashboard';
import { checkAdminAuth, fetchRecommendedContent } from './src/api/adminService';
import { normalizeRecommendedList } from './src/utils/normalizeRecommended';
import { COVER_PLACEHOLDER } from './src/utils/coverPlaceholder';
import { VIDEO_TAG_CHIPS as HOME_CHIPS } from './src/data/videoTags';


import Header         from './src/components/Header';
import { fetchUserInteractions, toggleLikeStatus, toggleSaveStatus } from './src/api/interactionService';
import { fetchUserFollowing, toggleFollowStatus } from './src/api/followService';
import Sidebar        from './src/components/Sidebar';
import Hero, { HeroBackdrop, HeroContent } from './src/components/Hero';
import MasonryGrid    from './src/components/MasonryGrid';
import ErrorBoundary  from './src/components/ErrorBoundary';
import SeriesTreeOverlay from './src/components/SeriesTreeOverlay';
import StudioPage        from './src/components/StudioPage';
import SearchResults     from './src/components/SearchResults';
import SubscriptionPage  from './src/pages/SubscriptionPage';
import { SUBSCRIPTION_MODAL_EVENT } from './src/utils/subscriptionModal';
import AuthPage          from './src/pages/AuthPage';
// SegmentedControl now rendered inside NavigationBar (Header) for both mobile & desktop
import BottomTabBar      from './src/design-system/composites/BottomTabBar';
import SettingsPage      from './src/pages/SettingsPage';
import SelfProfilePage from './src/pages/SelfProfilePage';
import UserProfilePage   from './src/pages/UserProfilePage';
// VersionUpdater moved to src/main.jsx (mounted at Router root) so
// every route gets the update toast, not just IndexPage-served paths.
import InstallAppBanner  from './src/components/InstallAppBanner';
import CreateSpotlightCanvas from './src/components/CreateSpotlightCanvas';

/* CreateMusicPage is lazy-loaded */
const StoryGeneratorPage = lazy(() => import('./src/components/StoryGeneratorPage'));

/* Library + Spark — new pages per IA-v2 (2026-04-17) */
const LibraryPage = lazy(() => import('./src/components/LibraryPage'));
/* §2026-06-10 — importer 抽出,供 openImmerse 预加载 chunk(避免从 profile 等
 * 非-discover section 首次进沉浸态时 lazy 未就绪 → Suspense 露出底下 Discover)。 */
const importSparkMode = () => import('./src/components/SparkMode');
const SparkMode   = lazy(importSparkMode);

/* Video Editor Page */
const VideoEditorPage = lazy(() => import('./src/pages/VideoEditorPage'));

/* Discover page filter chips — 来源 src/data/videoTags.js 单一真相
 * （admin TAG_OPTIONS 同源，任一端改动自动同步）
 * MVP: labels only, filter logic treats these as no-op until data has tags. */

/* Discover top-level Tab — IA-v2 §4.1
 * 2026-04-24: 原 Explore 顶层名统一改为 Discover（算法推送心智模型）
 * 2026-04-25: Spark 合并为 Discover 的 immerse 态（非独立 tab），SegmentedControl 只剩 follow/discover */
const DISCOVER_TABS = [
  { value: 'follow',   label: 'Follow'   },
  { value: 'discover', label: 'Discover' },
];

/* Background theme key per activeSection (2026-04-23 — 收敛：clip-flow/story/sound/live
 * 4 频道已下线，BG_CHANNEL 只保留仍活跃的 3 个 section) */
const BG_CHANNEL = {
  'discover':     'discover',
  'create':       'create',
  'create-music': 'create',
  /* 2026-05-14 Leon — Library 复用 Create 的 spotlight 背景 (light/dark 都同套),
     原 fallback 'discover' 背景偏平,Create 频道的顶光锥 + dither + fog 立体感
     更贴 Library 的"工作台"心智模型(对比 Discover 的"消费 feed"扁平网格)。 */
  'library':      'create',
};

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/* ── Auth gate wrapper — keeps all hooks inside IndexPage unconditional ──
 * Note: in the current router (src/main.jsx) /admin and /admin/dashboard
 * route directly to the page components, so this wrapper is only reached
 * via the catch-all `*` route when react-router is bypassed. checkAdminAuth
 * is async (Supabase getUser), so we render a tiny loading state until it
 * resolves. */
function AdminPortal() {
  const [adminView, setAdminView] = useState('checking'); // 'checking' | 'login' | 'dashboard'

  useEffect(() => {
    let cancelled = false;
    checkAdminAuth().then((isAdmin) => {
      if (cancelled) return;
      setAdminView(isAdmin ? 'dashboard' : 'login');
    });
    return () => { cancelled = true; };
  }, []);

  if (adminView === 'checking') {
    return <div className="min-h-dvh flex items-center justify-center bg-zinc-950 text-zinc-500">Checking session…</div>;
  }
  return adminView === 'dashboard'
    ? <AdminDashboard onLogout={() => setAdminView('login')} />
    : <AdminLogin     onLogin={() => setAdminView('dashboard')} />;
}

export default function App() {
  if (window.location.pathname.startsWith('/admin')) return <AdminPortal />;

  /* DEV-only bypass: http://127.0.0.1:5176/?preview — skipped in production build */
  const devPreview = import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has('preview');

  const [authChecked,     setAuthChecked]    = useState(devPreview);
  const [isAuthenticated, setIsAuthenticated] = useState(devPreview);

  useEffect(() => {
    if (devPreview) return;

    /* 2026-05-14 Leon — Email verification callback handler.
     * 甲方报: 新注册邮箱用户点验证邮件 → 落到登录页 → 没反应。
     *
     * 根因: Supabase v2+ 默认 email 模板的 confirm-signup 链接,verify 后
     * 把用户 redirect 回我们的 site_url,query 里带 `?token_hash=...&type=signup`
     * (新 PKCE-style),不再是旧的 `#access_token` hash。Supabase JS SDK
     * **不自动**处理 token_hash — 必须显式调 `verifyOtp({token_hash, type})`
     * 才能完成 session 设置。我们之前完全没接,所以用户落在带 token_hash
     * 的 URL 上,getSession() 返回 null,渲染 AuthPage,卡住。
     *
     * 这个 handler 兼容两种模板:
     *   - 新 (?token_hash=X&type=signup|recovery|email_change|invite) → verifyOtp
     *   - 旧 (#access_token=...&refresh_token=...) → SDK 自动处理,handler 是 no-op
     */
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get('token_hash');
    const otpType   = url.searchParams.get('type');

    const bootstrap = async () => {
      if (tokenHash && otpType) {
        try {
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType });
          if (error) console.error('[auth] verifyOtp failed:', error.message);
          // Clean up the verification params so a refresh doesn't re-fire.
          url.searchParams.delete('token_hash');
          url.searchParams.delete('type');
          window.history.replaceState(null, document.title, url.pathname + (url.search || ''));
        } catch (e) {
          console.error('[auth] verifyOtp threw:', e);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      setIsAuthenticated(!!session);
      setAuthChecked(true);
      if (session && window.location.hash.includes('access_token')) {
        // Clean up the legacy OAuth hash from the URL.
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
    };
    bootstrap();

    // 2026-05-09 reported flashing fix: previously this listener
    // unconditionally `setIsAuthenticated(!!session)` on every event.
    // Token refresh transient failures + INITIAL_SESSION races could
    // briefly emit session=null even though the user was still logged
    // in, which swapped the page between IndexPage and AuthPage —
    // visible to the user as flashing.
    //
    // Now we only treat the explicit SIGNED_OUT event (or USER_DELETED)
    // as a real logout. SIGNED_IN / TOKEN_REFRESHED / USER_UPDATED with
    // a real session promote to authenticated. Other events (e.g.
    // INITIAL_SESSION with null after a transient network blip) leave
    // current state intact rather than ping-ponging.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        setIsAuthenticated(false);
        setAuthChecked(true);
        return;
      }
      if (session) {
        setIsAuthenticated(true);
        setAuthChecked(true);
        if (window.location.hash.includes('access_token')) {
          window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
        }
      } else {
        // No session AND not an explicit signed-out event → could be a
        // network blip or initial state before getSession() resolved.
        // Just mark auth check done so we stop showing the splash, but
        // don't force-flip isAuthenticated to false (avoids flashing).
        setAuthChecked(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  if (!authChecked) return <div className="fixed inset-0" style={{ background: '#0c0c1d' }} />;
  if (!isAuthenticated) return <AuthPage onLogin={() => setIsAuthenticated(true)} />;
  return <IndexPage />;
}

/* 2026-05-08 Leon — 方案 B 全面 activeSection ↔ URL 双向同步。
 * 之前只 discover/create/library/studio/subscription/u 同步，profile/wallet/
 * settings/preferences/help/legal/search/create-music 等刷新都回 /discover。
 *
 * SECTION_PATHS: 单向真理来源。null 表示该 section 不直接 navigate（如
 * user-profile 由 /u/:userId 单独处理）。subscription 走自己的 path。 */
const SECTION_PATHS = {
  discover:        '/discover',
  library:         '/library',
  create:          '/create',
  'create-story':  '/create-story',
  'create-music':  '/create-music',
  studio:          '/studio',
  subscription:    '/subscription',
  profile:         '/profile',
  search:          '/search',
  wallet:          '/wallet',
  settings:        '/settings',
  preferences:     '/preferences',
  help:            '/help',
  legal:           '/legal',
  logout:          '/logout',
  'user-profile':  null, // 由 /u/:userId 处理，不直接 navigate
};

/** Reverse lookup: pathname → section（或 null 表示无对应 section） */
function pathToSection(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const first = parts[0];
  if (!first) return 'discover';
  if (first === 'u' && parts[1]) return 'user-profile';
  // 找 SECTION_PATHS 里 path 第一段匹配的 section
  const match = Object.entries(SECTION_PATHS).find(([, p]) => p === '/' + first);
  return match?.[0] || null;
}

function IndexPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathSection = location.pathname.split('/')[1]; // e.g., "create" from "/create"

  /* §2026-06-10 — immerse 来源路由追踪。
   *   currentPathRef: 每次 render 同步当前 pathname,供 openImmerse 在点击瞬间
   *     无 dep churn 地读到"从哪进的沉浸态"。
   *   immerseOriginRef: openImmerse 记录非-discover 来源(主页 /profile、他人
   *     主页 /u/:id、搜索 /search 等),exitImmerse 退出时回到该来源;来源是
   *     discover 自身则存 null → 退出仍落 /discover/browse(原行为)。 */
  const currentPathRef = useRef(location.pathname);
  currentPathRef.current = location.pathname;
  const immerseOriginRef = useRef(null);
  const defaultSection = pathToSection(location.pathname) || 'discover';
  /* URL → discover 频道形态解析。
   *   /discover            → device default：mobile immerse / desktop browse
   *   /discover/s/:id      → immerse 定位到指定条目（跨设备一致）
   *   /discover/browse     → browse 瀑布流（跨设备一致） */
  const pathImmerseId = (() => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'discover' && parts[1] === 's' && parts[2] ? parts[2] : null;
  })();
  const pathIsBrowse = (() => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'discover' && parts[1] === 'browse';
  })();
  /* 设备判断：mobile 默认 immerse（TikTok 风 home），desktop 默认 browse（瀑布流优先）。
   * 此处用 window.innerWidth 初值（SSR 阶段不挂载，无破绽），后续 URL sync 中同步。 */
  const initialIsMobile = typeof window !== 'undefined' && window.innerWidth <= 791;

  /* ── Shared UI state ── */
  const [isPlaying,      setIsPlaying]     = useState(false);
  const [activeSection,  setActiveSection]  = useState(location.state?.activeSection || defaultSection);
  const [likedItems,     setLikedItems]    = useState(new Set());
  const [savedItems,     setSavedItems]    = useState(new Set());
  /* /u/:userId target — initial value reads from path so first paint can query */
  const [userProfileId,  setUserProfileId]  = useState(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0] === 'u' && parts[1] ? parts[1] : null;
  });
  const [followingUsers, setFollowingUsers] = useState(new Set()); // Set<userId> of users I follow
  /* currentUserId — 2026-05-14 Leon。订阅 auth 变化,用于 self-follow 拦截:
     用户看自己作品时不该看到 Follow 按钮,toggleFollow 也要在 target===self 时 bail。
     DB 有 follows_no_self_follow CHECK 兜底,但 UX 层不能让按钮先错诱导。 */
  const [currentUserId, setCurrentUserId] = useState(null);

  /* SPA URL → activeSection 同步（2026-04-21）
   * 过去只在初始挂载读 pathname；useNavigate('/create') 改 URL 但 state 不跟，
   * 结果 HeroCard / 任意卡片 CTA 调 navigate('/create') 看起来"点了没反应"。
   * 此处让 pathname 变化时同步 activeSection，一次根治所有 SPA 内部路由。
   * 白名单复用 defaultSection 的验证集；未命中路径（如 '/'）忽略不覆盖。 */
  /* URL → activeSection 同步（pathname 变化时） */
  useEffect(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const next = pathToSection(location.pathname);
    if (next && next !== 'user-profile') {
      setActiveSection(prev => (prev === next ? prev : next));
    }
    /* /u/:userId — UserProfilePage route (Session 3, 2026-05-06) */
    if (parts[0] === 'u' && parts[1]) {
      setUserProfileId(parts[1]);
      setActiveSection(prev => (prev === 'user-profile' ? prev : 'user-profile'));
    }
    /* URL → discover 形态同步：
     *   /discover/browse  → browse 瀑布流（跨设备一致）
     *   /discover/s/:id   → immerse 定位（跨设备一致）
     *   /discover（裸）   → device default：mobile immerse / desktop browse */
    if (parts[0] === 'discover') {
      if (parts[1] === 'browse') {
        setDiscoverView('browse');
        setSparkItemId(null);
      } else if (parts[1] === 's' && parts[2]) {
        setDiscoverView('immerse');
        setSparkItemId(parts[2]);
      } else {
        const mobile = window.innerWidth <= 791;
        setDiscoverView(mobile ? 'immerse' : 'browse');
        setSparkItemId(null);
      }
    }
  }, [location.pathname]);

  /* activeSection → URL 同步（方案 B 通用版，2026-05-08）
   * 替代之前 subscription-only 的双向同步；现在所有 SECTION_PATHS 中的
   * section 都自动同步 URL。
   *
   * Guards：
   * - 'user-profile' 由 /u/:userId 单独处理（targetPath null）
   * - discover sub-paths /discover/browse, /discover/s/:id 不被覆盖
   * - URL 已是 target 时 noop，无循环 */
  /* 2026-05-09 — fix Start-Creating flashing loop. The two-way URL ↔
   * activeSection sync above had a race: when navigate() is called from
   * a click handler (Hero CTA, MasonryGrid card etc), URL changes
   * SYNCHRONOUSLY but the matching setActiveSection in effect 1 is
   * QUEUED for the next render. Both effects fire after the same render,
   * effect 2 sees the STALE activeSection and navigates BACK to the old
   * URL → effect 1 schedules another section update → effect 2 navigates
   * forward again → loop.
   *
   * Fix: track whether THIS effect run was triggered by a URL change
   * (let effect 1 handle it, bail) vs an activeSection change (legit
   * user-driven nav like sidebar click — proceed with navigate).
   * Refs let us compare prev vs current values and tell which side
   * "moved first". */
  const prevLocationRef = useRef(location.pathname);
  const prevSectionRef = useRef(activeSection);
  useEffect(() => {
    const locationChanged = prevLocationRef.current !== location.pathname;
    const sectionChanged = prevSectionRef.current !== activeSection;
    prevLocationRef.current = location.pathname;
    prevSectionRef.current = activeSection;

    // URL changed but section didn't (yet) → effect 1 will catch up
    // on next render. Bail to avoid the navigate-back loop.
    if (locationChanged && !sectionChanged) return;

    const targetPath = SECTION_PATHS[activeSection];
    if (!targetPath) return; // user-profile 等不映射的 section
    if (activeSection === 'discover' && location.pathname.startsWith('/discover')) return;
    /* 2026-05-11 Leon — create 频道有 /create/short, /create/series, /create/flow
       sub-paths 由 StoryGeneratorPage 内部 sync,不要让外层 effect 重写回 /create。
       注意排除 /create-story, /create-music (它们是独立 section,不是 create 的 sub-path)。 */
    if (activeSection === 'create' && (location.pathname === '/create' || location.pathname.startsWith('/create/'))) return;
    /* 2026-05-14 Leon — library 同 create pattern, /library/works|recasts|series|...
       sub-paths 由 LibraryPage 自己 navigate,外层 effect 不要重写回 /library。
       否则甲方报「Library/Works 刷新回上一级」: URL ↔ tab sync 被这条 effect
       overwrite 掉了。 */
    if (activeSection === 'library' && (location.pathname === '/library' || location.pathname.startsWith('/library/'))) return;
    if (location.pathname === targetPath) return;
    navigate(targetPath);
  }, [activeSection, location.pathname, navigate]);

  /* ── Load persistent user interactions eagerly ── */
  useEffect(() => {
    fetchUserInteractions().then(({ likedItems: initialLikes, savedItems: initialSaves }) => {
      setLikedItems(initialLikes);
      setSavedItems(initialSaves);
    }).catch(console.warn);
    fetchUserFollowing().then(setFollowingUsers).catch(console.warn);

    /* currentUserId: 初次取 + 订阅 auth 变化(切账号同步)。SIGNED_OUT 清空以
       便未登录态 toggleFollow 仍能正常跑(target !== null,顺利触发后端 401)。 */
    supabase.auth.getSession().then(({ data }) => setCurrentUserId(data?.session?.user?.id || null));
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setCurrentUserId(null);
      else setCurrentUserId(session?.user?.id || null);
    });
    return () => { authSub?.unsubscribe?.(); };
  }, []);

  /* Toggle follow on a target user (UUID). Optimistic update +
   * server sync; revert on failure.
   *
   * 2026-05-14 Leon — self-follow 拦截。DB 有 `follows_no_self_follow CHECK
   * (follower_id <> following_id)` 兜底,followService.toggleFollowStatus 也有
   * 同样的 guard,但前端在这层 early-return 可以:
   *   1. 完全避开 optimistic update 引起 Set 视觉抖动
   *   2. 不浪费一次 401/23514 RPC
   *   3. 让 UI 二次 click 安全(SparkMode 隐藏按钮是首选,但 keyboard nav 等
   *      意外路径仍需此层兜底)。 */
  const toggleFollow = async (targetUserId) => {
    if (!targetUserId) return;
    if (currentUserId && targetUserId === currentUserId) return;
    const isFollowing = followingUsers.has(targetUserId);
    setFollowingUsers(prev => {
      const next = new Set(prev);
      if (isFollowing) next.delete(targetUserId);
      else next.add(targetUserId);
      return next;
    });
    try {
      await toggleFollowStatus(targetUserId, isFollowing);
    } catch (err) {
      // Revert
      setFollowingUsers(prev => {
        const next = new Set(prev);
        if (isFollowing) next.add(targetUserId);
        else next.delete(targetUserId);
        return next;
      });
    }
  };

  const [hoveredCard,    setHoveredCard]   = useState(null);
  const [visibleCards,   setVisibleCards]  = useState(new Set());
  const [activeFilter,   setActiveFilter]  = useState(null);
  const [darkMode,       setDarkMode]      = useState(() => {
    /* Theme preference persistence — restore from localStorage on mount.
       Key: 'uvera-theme-preference'   Values: 'true' | 'false' | 'system' */
    try {
      const stored = localStorage.getItem('uvera-theme-preference');
      if (stored === 'true')   return true;
      if (stored === 'false')  return false;
      if (stored === 'system') return 'system';
    } catch {}
    return 'system';
  }); // 'system' | false | true
  /* §2026-05-23 fei: isMuted 默认 false (sound ON by default).
   *   之前默认 true 是 2026-04-28 Leon 加的，理由是 iOS Safari 禁止 unmuted
   *   autoplay。但现在两件事改变了这个 tradeoff：
   *     (1) UnifiedVideoPlayer 有 NotAllowedError 兜底：iOS 拒绝 unmuted
   *         autoplay 时自动 force muted + retry → 视频一定会播。
   *     (2) UnifiedVideoPlayer 现在 emit onVolumeChange，SparkMode 监听后
   *         同步 isMuted 到实际 video.muted —— 兜底触发 mute 时 UI 立刻
   *         更新成"muted" 图标。
   *   所以现在的行为：
   *     · 首次进入（无 user gesture）：默认 isMuted=false → autoplay 被
   *       iOS 拒绝 → 兜底自动 mute → UI sync 成 muted → 用户 1 次 tap
   *       unmute 即可。之前是 UI 假装 unmuted 但实际 muted，要 2 次 tap
   *       才真 unmute。
   *     · 用户 unmute 之后（有 user gesture 信用）：后续 swipe 都能直接
   *       unmuted autoplay，无需再 tap。这就是用户要的 "sound on by
   *       default" 体验。 */
  const [isMuted,        setIsMuted]       = useState(false);
  const [searchQuery,    setSearchQuery]   = useState(null);   // null = not searching, string = active search
  const [heroSlide,      setHeroSlide]    = useState(0);      // carousel slide index (Discover home)
  const [discoverTab,     setDiscoverTab]   = useState('discover'); // SegmentedControl: follow | discover
  /* Discover 频道形态。默认态 device-aware：mobile=immerse（TikTok home）/ desktop=browse。
   * URL 显式指定（/discover/browse、/discover/s/:id）时以 URL 为准。 */
  const [discoverView,        setDiscoverView]       = useState(
    pathIsBrowse   ? 'browse'
    : pathImmerseId ? 'immerse'
    : (initialIsMobile ? 'immerse' : 'browse')
  );
  const [sparkItemId,         setSparkItemId]        = useState(pathImmerseId);
  const [scrollToTabsPending, setScrollToTabsPending] = useState(false); // on Spark→discover return
  const [backToTopVisible,    setBackToTopVisible]    = useState(false); // floating FAB on Discover grid
  const [chainSource,         setChainSource]         = useState(null);  // item that triggered "然后呢？"
  const [immerseChromeVisible, setImmerseChromeVisible] = useState(true); // SparkMode 驱动；fullscreen+playing 时 false → 隐 Header/BottomTabBar
  const [activeSeriesTree,    setActiveSeriesTree]    = useState(null); // { seriesId, rootId }

  /* Discover immerse 进入"模态遮罩"模式（2026-04-27 Leon Phase 1）：
   * SparkMode 不再替换 Discover，改为浮层覆盖。Discover browse 一直挂载，
   * scroll position / 滚到的位置 / hover state / 选中的 #tag 全部保留。 */
  const isImmerseOpen = activeSection === 'discover' && discoverView === 'immerse';

  /* ── Create nav 入口清 stale 二级流（Sequel/Branch/Recast）draft (2026-04-27) ──
   * 复现：用户从某个视频点 "Continue this story" / "Branch this story" → localStorage
   * 写入 isSequel/isBranch/isRecast draft + window.location.href='/create'
   * (2026-05-13 §C rename: isContinuation → isSequel; 旧 key 仍兼容读取)
   * 进入 Create 流。如果用户中途放弃（导航到别的 section），localStorage draft
   * 残留。下次点 BottomTabBar/Sidebar Create nav → StoryGeneratorPage mount →
   * auto-restore 读到残留 draft → 直接卡进 Branch/Continue/Recast 界面。
   *
   * 修法：activeSection 转到 'create'/'create-story' 时（仅 SPA-internal nav，
   * 非初始 mount／非外部 CTA 硬跳转），清掉 secondary-flow draft。
   *
   * 区分两种入口：
   *   - 外部 CTA（"Continue this story" 等）走 window.location.href hard reload，
   *     IndexPage 首次 mount，activeSection 直接初始化为 'create'，prev===activeSection，
   *     useEffect 跳过 → localStorage 保留 ✓
   *   - SPA nav click（BottomTabBar/Sidebar）走 setActiveSection，activeSection
   *     从其他值转到 'create'，prev !== activeSection → 清 stale 二级流 draft ✓ */
  const prevActiveSectionRef = useRef(activeSection);
  useEffect(() => {
    const prev = prevActiveSectionRef.current;
    prevActiveSectionRef.current = activeSection;
    if (prev === activeSection) return; // 初始 mount，跳过
    if (activeSection !== 'create' && activeSection !== 'create-story') return;
    try {
      const draftStr = localStorage.getItem('uvera_story_draft');
      if (!draftStr) return;
      const draft = JSON.parse(draftStr);
      // §C rename: 新 key isSequel；旧 key isContinuation 仍兼容到 v1.2 Phase 4 cleanup
      if (draft.isSequel || draft.isContinuation || draft.isBranch || draft.isRecast) {
        localStorage.removeItem('uvera_story_draft');
      }
    } catch { /* JSON 损坏／localStorage 不可用都忽略 */ }
  }, [activeSection]);

  /* ── SparkMode 模态：Esc 退出 + body scroll 锁 ──
   * Esc：键盘退出 immerse（桌面友好，跟 Lightbox / 系统模态一致体感）
   * Body lock：iOS Safari 防滚动穿透到下层 Discover 的兜底（modal position:fixed
   * + touch-action:none 已捕获大部分；body overflow hidden 是 belt-and-suspenders） */
  useEffect(() => {
    if (!isImmerseOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') exitImmerse(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isImmerseOpen]); // exitImmerse 是 useCallback；依赖 isImmerseOpen 即可

  /* §2026-06-08 Leon — 沉浸态全黑:Safari 顶部状态栏 / 底部地址栏的暗灰条由
   * <meta theme-color>(站点默认 #0B0E15)上色,与播放器纯黑 letterbox 之间出现
   * 接缝。进入 immerse 时把 theme-color 动态设为 #000(Safari chrome 跟着变纯黑,
   * 与播放器无缝),退出恢复站点色。Safari chrome 在 DOM 外,只能靠 theme-color 改。 */
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const DEFAULT_THEME_COLOR = '#0B0E15';
    meta.setAttribute('content', isImmerseOpen ? '#000000' : DEFAULT_THEME_COLOR);
    return () => { meta.setAttribute('content', DEFAULT_THEME_COLOR); };
  }, [isImmerseOpen]);

  /* ── Perform Supabase Auth Logout ── */
  /* 2026-05-26 round-78 (Leon,甲方报错):signOut 之后必须改 URL 到 `/`,
   * 不能用 reload() — URL 仍是 `/logout` 会触发 pathToSection→'logout' 死循环
   * (signOut → reload(/logout) → 又 signOut → 又 reload → 用户永远登不上)。 */
  useEffect(() => {
    if (activeSection === 'logout') {
      supabase.auth.signOut().then(() => {
        window.location.href = '/';
      }).catch(console.error);
    }
  }, [activeSection]);

  /* ── Dark mode: sync .dark class on <html> ──
     主题切换瞬间临时禁用所有 transition,避免 bg-base 0.6s background
     transition 在 #131a1c → #c7c7c7 中间经过中灰造成「逐渐变亮」扫描感。
     标准做法:.theme-transitioning class 在 50ms 内 force transition:none。 */
  useEffect(() => {
    const apply = (dark) => {
      const html = document.documentElement;
      html.classList.add('theme-transitioning');
      html.classList.toggle('dark', dark);
      /* 双 rAF 等浏览器完成 layout + paint 才移除,确保新值已经 commit。
         避免单 rAF 在某些情况下 transition 还会触发的 race。 */
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          html.classList.remove('theme-transitioning');
        });
      });
    };
    if (darkMode === true)  { apply(true);  return; }
    if (darkMode === false) { apply(false); return; }
    /* 'system' — follow OS preference */
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mq.matches);
    const handler = (e) => apply(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [darkMode]);

  /* ── Persist theme preference to localStorage ── */
  useEffect(() => {
    try {
      localStorage.setItem('uvera-theme-preference', String(darkMode));
    } catch {}
  }, [darkMode]);

  /* Effective dark boolean (派生自 documentElement.classList,响应主题切换 +
     系统偏好,供 Create 频道 inline-styled JSX 使用) */
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  /* ── Sidebar + breakpoints ── */
  const sidebar = useSidebarState();

  /* Separate open/close state for forced-overlay pages (Create Music).
     Cannot reuse sidebar.isOpen because useSidebarState has a useEffect that
     auto-resets isOpen=false on non-mobile viewports. */
  const [forcedOverlayOpen, setForcedOverlayOpen] = useState(false);

  // §2026-06-06 Step 5 — 订阅浮窗:CTA 调 openSubscriptionModal() 触发全局事件,
  //   此处接住并以浮层盖在当前页上(不切 activeSection、不离开原流程)。关闭即回原页。
  const [subModalOpen, setSubModalOpen] = useState(false);
  useEffect(() => {
    const open = () => setSubModalOpen(true);
    window.addEventListener(SUBSCRIPTION_MODAL_EVENT, open);
    // §2026-06-09 — 进站自动开订阅浮窗:?subscribe=1 直达,或落在 /subscription
    //   (Stripe 付款回跳 success_url 仍是 /subscription?checkout=... / ?tab=ucoins;
    //   独立全页已删 → 改由浮窗接住 ?checkout 成功 banner + 余额轮询)。
    if (typeof window !== 'undefined' &&
        (new URLSearchParams(window.location.search).get('subscribe') === '1' ||
         window.location.pathname.startsWith('/subscription'))) {
      setSubModalOpen(true);
    }
    return () => window.removeEventListener(SUBSCRIPTION_MODAL_EVENT, open);
  }, []);

  /* 2026-05-08 Leon — 'create' 从 forced overlay 列表移除：
   * Create 频道 (StoryGenerator 入口) 是 section page，非 modal/immerse，
   * sidebar + profile pill 应正常 render 方便调试时切其他频道。
   * create-music (VideoEditor 全屏) 仍 forced overlay。 */
  const isForced = activeSection === 'create-music';

  const effectiveSidebar = isForced
    ? {
        ...sidebar,
        mode:   SIDEBAR_MODE.OVERLAY,
        isOpen: forcedOverlayOpen,
        toggle: () => setForcedOverlayOpen(v => !v),
        open:   () => setForcedOverlayOpen(true),
        close:  () => setForcedOverlayOpen(false),
      }
    : sidebar;

  /* Close forced overlay when leaving create-music page */
  useEffect(() => {
    if (activeSection !== 'create-music') setForcedOverlayOpen(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const isSmallScreen  = useMediaQuery('(max-width: 791px)');
  const isMediumScreen = useMediaQuery('(min-width: 792px) and (max-width: 1311px)');

  /* §2026-05-25 fei — direct-URL series redirect.
   *
   *   /discover/s/<recommendedContentId> renders SparkMode immerse, which
   *   plays the row as a single video with no paywall awareness. For rows
   *   tagged 'series' (root cards of multi-episode works) this is wrong —
   *   user expects the proper SeriesDetailPage at /series/<realSeriesId>.
   *
   *   The 'real' series.id is stored in the 'series:<uuid>' tag on the
   *   recommended_content row (written at publish time). When the immerse
   *   URL is set for such a row, look it up and redirect.
   *
   *   Only fires when sparkItemId is set (immerse mode active). Falls
   *   through silently if the row isn't series-tagged or the tag is missing
   *   (legacy data without the series:<uuid> tag). */
  useEffect(() => {
    if (!sparkItemId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: row, error } = await supabase
          .from('recommended_content')
          .select('id,tags')
          .eq('id', sparkItemId)
          .maybeSingle();
        if (cancelled || error || !row) return;
        const tags = Array.isArray(row.tags) ? row.tags : [];
        if (!tags.includes('series')) return;
        const idTag = tags.find(t => typeof t === 'string' && t.startsWith('series:'));
        const realSeriesId = idTag ? idTag.split(':')[1] : null;
        if (realSeriesId) {
          navigate(`/series/${realSeriesId}`, { replace: true });
        }
      } catch (e) {
        // Soft-fail: better to show immerse than to crash; user can still
        //   bail back to Discover.
        console.warn('[discover-immerse-series-redirect]', e.message);
      }
    })();
    return () => { cancelled = true; };
  }, [sparkItemId, navigate]);

  /* ── Discover immerse 态集中 helper ───────────────────────────────────────
   * Spark 不再是独立 section，而是 Discover 频道的 immerse 形态。
   * openImmerse: 瀑布流卡片点击 / URL 直链 /discover/s/:id 的统一入口
   * exitImmerse: 左上角 CaretLeft / BottomTabBar Discover tap / 系统返回的退出路径 */
  const openImmerse = useCallback((itemId) => {
    /* §2026-05-30 round-106 — 不在这里 setActiveSection('discover')。
     * 从别的 section(如 search)进 immerse 时,section 变更 + navigate 同帧竞态
     * 会让 URL↔section sync effect(见上方 322 注释)把路由弹回 /discover(首页)
     * 再弹回 → 甲方报"闪回首页2次再切回"。改由 navigate → effect1(route→state)
     * 单向推导 section='discover',无竞态。discoverView/sparkItemId 即时设(effect1
     * 会再确认一遍,幂等)。 */
    /* §2026-06-10 — 记录来源路由,供 exitImmerse 返回原页面。
     * discover 自身(/discover…)进的不算来源 → null → 退出落 /discover/browse。 */
    const origin = currentPathRef.current;
    immerseOriginRef.current = (origin && !origin.startsWith('/discover')) ? origin : null;
    /* §2026-06-10 — 预热 SparkMode chunk:从 profile 等非-discover section 进时
     * lazy 多半未加载,提前 import 让浮层挂载即就绪,消除"先闪 Discover"。 */
    importSparkMode();
    setDiscoverView('immerse');
    setSparkItemId(itemId);
    if (itemId) navigate(`/discover/s/${itemId}`);
  }, [navigate]);

  const exitImmerse = useCallback(() => {
    setDiscoverView('browse');
    setSparkItemId(null);
    /* 2026-04-27 模态遮罩 Phase 1：去掉 setScrollToTabsPending(true)。
     * 旧路由替换模式下，SparkMode unmount → Discover 重 mount，scroll=0，所以
     * "auto-scroll to top"是确认体验。模态模式下 Discover 一直挂载，scroll
     * position 应原地保留 — 触发 scroll-to-top 反而是 bug。 */
    /* §2026-06-10 — 有来源(主页/他人主页/搜索等)则返回原页面;否则原行为落
     * Discover browse。来源消费后即清,避免泄漏到下次退出。 */
    const origin = immerseOriginRef.current;
    immerseOriginRef.current = null;
    navigate(origin || '/discover/browse');
  }, [navigate]);

  /* Home: 回 discover 频道默认视图（URL /discover）。
   * discoverView 由 URL sync effect 按设备决定：mobile=immerse / desktop=browse。 */
  const goHome = useCallback(() => {
    setActiveSection('discover');
    setSparkItemId(null);
    navigate('/discover');
  }, [navigate]);

  /* ── Mobile Bottom Tab Bar: active tab + navigation handler ──────────────
   * Derived from activeSection + discoverView/Tab so the bottom bar reflects
   * the actual view without duplicating state.                              */
  /* activeBottomTab: 3 nav tabs (discover/library/create) + profile pill */
  const activeBottomTab = (() => {
    if (activeSection === 'discover') return 'discover';
    if (activeSection === 'library') return 'library';
    if (activeSection === 'create' || activeSection === 'create-music') return 'create';
    if (activeSection === 'profile') return 'profile';
    return 'discover'; // subscription / studio / search / lightbox → highlight Discover
  })();

  const handleBottomTab = (id) => {
    if (id === 'discover') {
      /* Discover = home（immerse）。从 browse / 其他 section 返回均进 immerse；
       * 已在 immerse 时无副作用（不重置 index），让用户"双击 home"感觉无害。 */
      if (activeSection === 'discover' && discoverView === 'immerse') return;
      goHome();
    } else if (id === 'library') {
      setActiveSection('library');
    } else if (id === 'create') {
      setActiveSection('create');
    } else if (id === 'profile') {
      setActiveSection('profile');
    }
  };

  /* ── Media refs ── */
  const cardRefs  = useRef({});
  const audioRefs = useRef({});
  const videoRefs = useRef({});

  /* ── Scroll container ref (callback ref so effect re-runs on mount) ── */
  const [scrollContainer, setScrollContainer] = useState(null);
  const scrollContainerCallback = useCallback((el) => setScrollContainer(el), []);

  /* ── Shuffle once on mount ── */
  const [shuffledMediaItems, setShuffledMediaItems] = useState([]);

  /* §2026-05-23 fei: mobile homepage pagination — show 25 cards at a time,
   *   "加载更多" extends by 25 more, "换一批" reshuffles + resets to 25.
   *   Reset to 25 when the active filter changes so users don't see a
   *   tiny filtered slice. */
  const MOBILE_PAGE_SIZE = 25;
  const [mobileGridLimit, setMobileGridLimit] = useState(MOBILE_PAGE_SIZE);
  // Reset to first page when the filter or section changes — avoids leaving
  // user at "page 4 of 100 cards" worth of limit when they switch filter to
  // one that only has 10 items.
  useEffect(() => { setMobileGridLimit(MOBILE_PAGE_SIZE); }, [activeFilter, discoverTab]);
  // "换一批" — reshuffle the source feed AND reset to first page.
  const handleMobileRefresh = useCallback(() => {
    setShuffledMediaItems(prev => shuffleArray(prev));
    setMobileGridLimit(MOBILE_PAGE_SIZE);
    // Scroll to top so the refreshed batch is visible.
    try { scrollContainer?.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  }, [scrollContainer]);
  // Track Discover content fetch state so we can show a clear retry UI
  // instead of a silent blank when the request fails (network blocked,
  // ITP / extension / firewall, or a clock-skew JWT validation error).
  const [discoverFetchState, setDiscoverFetchState] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [discoverFetchError, setDiscoverFetchError] = useState(null);
  const [discoverFetchAttempt, setDiscoverFetchAttempt] = useState(0);  // bump to retry

  useEffect(() => {
    setDiscoverFetchState('loading');
    setDiscoverFetchError(null);
    fetchRecommendedContent().then(raw => {
      // Helper now returns Error on failure (was returning [] silently).
      if (raw instanceof Error) {
        setDiscoverFetchState('error');
        setDiscoverFetchError(raw.message || 'Could not load content');
        return;
      }
      /* 前端层 normalize：把后端 DB 行映射成 MasonryGrid 形状。
         后端 adminService.js 严格保留 feifeixp 的 visualPool 版本，
         视觉/类型映射在此处（src/utils/normalizeRecommended.js）。 */
      const feed = normalizeRecommendedList(raw)
        // Only show root videos in plaza (exclude branch nodes)
        .filter(item => {
          if (!item.tags) return true;
          return !item.tags.some(tag => typeof tag === 'string' && tag.startsWith('#Parent:'));
        })
        .map(item => ({
          ...item,
          cover: item.cover || COVER_PLACEHOLDER
        }));
      setShuffledMediaItems(shuffleArray(feed));
      setDiscoverFetchState('loaded');
    });
  }, [discoverFetchAttempt]);

  const retryDiscoverFetch = () => setDiscoverFetchAttempt(n => n + 1);

  /* ── Section change cleanup: reset filter, hover state,
     and pause any playing grid media ── */
  useEffect(() => {
    setActiveFilter(null);
    setHoveredCard(null);
    setHeroSlide(0);
    /* discoverTab 统一默认 'discover'（Spark 已合入 Discover immerse 态，不再单独 segment）。
     * discoverView/sparkItemId 由 URL 驱动（见 pathname useEffect），此处不手动重置，
     * 避免与 URL sync 赛跑。 */
    setDiscoverTab('discover');
    Object.values(videoRefs.current).forEach(v => { if (v) { v.pause(); v.currentTime = 0; } });
    Object.values(audioRefs.current).forEach(a => { if (a) { a.pause(); a.currentTime = 0; } });
  }, [activeSection]);

  /* ── Filtered items: apply #tag chip filter (#All = pass-through) ── */
  const filteredMediaItems = (activeFilter && activeFilter !== '#All')
    ? shuffledMediaItems.filter(i => i.tags?.includes(activeFilter))
    : shuffledMediaItems;

  /* Discover "关注" Tab — show works whose author is in the user's
   * `followingUsers` Set (populated by /api/follows on mount via
   * fetchUserFollowing). Pre-fix this was hardcoded to [] as an MVP
   * stub — comment said "MVP: empty (no follow data yet)" — which made
   * the Follow tab look broken once users actually started following
   * creators (Leon bug report 2026-05-11).
   *
   * 2026-05-13 — 修正字段。normalizeRecommendedItem 把 `dbItem.artist`
   * (UUID) 转成 display-name 字符串放在 `item.artist`，UUID 单独留在
   * `item.artistId`。followingUsers 是 Set<UUID>，所以这里必须比 `artistId`，
   * 不是 `artist` — 之前两边对不上,follow tab 永远空。createdAt 在
   * normalize 里目前未输出，sort 全是 0 等价于不排序; 等 normalize
   * 补 createdAt 后会自然生效。 */
  const discoverFilteredItems = (activeSection === 'discover' && discoverTab === 'follow')
    ? shuffledMediaItems
        .filter(item => item.artistId && followingUsers.has(item.artistId))
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        })
    : filteredMediaItems;

  const chips = HOME_CHIPS;

  /* ── Helpers ── */
  /* toggleLike / toggleSave 重构（2026-04-21）
   * 旧实现把 setShuffledMediaItems(...) 嵌套在 setLikedItems(prev => ...) 的
   * updater 函数内部 — StrictMode 双调用 updater 导致 count +2（不是 +1）。
   * 修法：从闭包 capture 当前 likedItems/savedItems 状态算出 isLiking/isSaving，
   * 然后两个 setter 同级调用，各自是纯 updater。 */
  const toggleLike = async (id) => {
    const isLiking = !likedItems.has(id);
    const delta = isLiking ? 1 : -1;

    // 1. Optimistic UI — two independent, pure updaters
    setLikedItems(prev => {
      const next = new Set(prev);
      isLiking ? next.add(id) : next.delete(id);
      return next;
    });
    setShuffledMediaItems(items => items.map(item =>
      item.id === id ? { ...item, likesCount: Math.max(0, item.likesCount + delta) } : item
    ));

    // 2. Background sync
    try {
      await toggleLikeStatus(id, !isLiking);
    } catch (e) {
      // Revert — mirror both updates with inverse delta
      setLikedItems(prev => {
        const next = new Set(prev);
        isLiking ? next.delete(id) : next.add(id);
        return next;
      });
      setShuffledMediaItems(items => items.map(item =>
        item.id === id ? { ...item, likesCount: Math.max(0, item.likesCount - delta) } : item
      ));
    }
  };

  const toggleSave = async (id) => {
    const isSaving = !savedItems.has(id);
    const delta = isSaving ? 1 : -1;

    // 1. Optimistic UI — two independent, pure updaters
    setSavedItems(prev => {
      const next = new Set(prev);
      isSaving ? next.add(id) : next.delete(id);
      return next;
    });
    setShuffledMediaItems(items => items.map(item =>
      item.id === id ? { ...item, savesCount: Math.max(0, item.savesCount + delta) } : item
    ));

    // 2. Background sync
    try {
      await toggleSaveStatus(id, !isSaving);
    } catch (e) {
      setSavedItems(prev => {
        const next = new Set(prev);
        isSaving ? next.delete(id) : next.add(id);
        return next;
      });
      setShuffledMediaItems(items => items.map(item =>
        item.id === id ? { ...item, savesCount: Math.max(0, item.savesCount - delta) } : item
      ));
    }
  };

  /* ── IntersectionObserver: lazy-load video/audio when card enters scroll container ──
     root: scrollContainer (not null/viewport) — avoids overflow:hidden ancestor clipping.
     Re-observes on activeSection change so channel pages get the same preload behaviour. */
  useEffect(() => {
    if (!scrollContainer) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const cardId = parseInt(entry.target.getAttribute('data-card-id'), 10);
          setVisibleCards(prev => {
            const next = new Set(prev);
            entry.isIntersecting ? next.add(cardId) : next.delete(cardId);
            return next;
          });
        });
      },
      { root: scrollContainer, rootMargin: '200px', threshold: 0.1 }
    );

    Object.values(cardRefs.current).forEach(el => { if (el) observer.observe(el); });
    return () => observer.disconnect();
  }, [shuffledMediaItems, scrollContainer, activeSection]);

  /* ── Global mute: sync grid card media elements only.
     SparkMode immerse player manages its own mute state internally.
     Depends on visibleCards so newly-mounted videos also get synced. ── */
  useEffect(() => {
    Object.values(videoRefs.current).forEach(v => { if (v) v.muted = isMuted; });
    Object.values(audioRefs.current).forEach(a => { if (a) a.muted = isMuted; });
  }, [isMuted, visibleCards]);

  /* ── Scroll to Discover tabs after returning from Spark.
   * When user clicks Close in Spark → onBack fires → discoverTab becomes
   * 'discover' → Spark unmounts, Discover grid mounts → scrollContainer
   * state updates → this effect scrolls the container so [data-discover-tabs]
   * aligns vertically with the Header CTA centre (y=36px → top at y=14px).  */
  useEffect(() => {
    if (!scrollToTabsPending || !scrollContainer) return;
    /* Belt-and-suspenders scheduling: rAF lets React flush its commit first,
     * setTimeout is the fallback if rAF is throttled (e.g. unfocused tab).
     * A one-shot guard ensures we only scroll once per pending flag. */
    let done = false;
    const doScroll = () => {
      if (done) return;
      done = true;
      /* SegmentedControl now lives in the Header (not scroll content),
       * so "scroll to tabs" simply means scroll to top of content.    */
      scrollContainer.scrollTo({ top: 0, behavior: 'auto' });
      setBackToTopVisible(false);
      setScrollToTabsPending(false);
    };
    const raf = requestAnimationFrame(doScroll);
    const tmo = setTimeout(doScroll, 80);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(tmo);
    };
  }, [scrollToTabsPending, scrollContainer]);

  /* ── Back-to-top FAB visibility.
   * Shown on Discover grid (not Spark) once the grid has scrolled off-screen
   * by more than one full viewport past the tab-alignment pivot
   * (Grid top reaches scrollTop ≈ 595 when tabs align with Header CTA, so
   * threshold = that pivot + 1 viewport height). Resets on section/tab
   * switch. Throttled via rAF to stay cheap on scroll. */
  useEffect(() => {
    if (!scrollContainer || activeSection !== 'discover' || discoverView === 'immerse') {
      setBackToTopVisible(false);
      return;
    }
    /* Synchronous compute — no rAF throttle.
     * rAF is throttled to 0fps when the tab is hidden (visibilityState
     * === 'hidden'), so rAF-based handlers never run under headless/MCP
     * testing. The work here is ~3 DOM reads + one setState per scroll
     * event; React batches identical state, so cost stays flat. */
    const onScroll = () => {
      /* SegmentedControl is in the Header; pivot = top of content (scrollTop 0).
       * Show FAB once user scrolls more than one viewport past the top.          */
      const threshold = window.innerHeight;
      setBackToTopVisible(scrollContainer.scrollTop > threshold);
    };
    scrollContainer.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => scrollContainer.removeEventListener('scroll', onScroll);
  }, [scrollContainer, activeSection, discoverView]);

  /* 2026-05-17 Leon — Spark immerse 的 Create BG 改放 wrapper 内部 (line ~1438),
     单一组件树渲染,不再借用页面级。useCreateBg 回到只 gate /create 频道。 */
  const useCreateBg = BG_CHANNEL[activeSection] === 'create';

  return (
    <div
      className="flex h-dvh overflow-hidden"
      data-channel={BG_CHANNEL[activeSection] || 'discover'}
    >
        {/* Background */}
        <div className="bg-base" />
        <div className="bg-mesh" />
        <div className="bg-vignette" />
        <div className="bg-grain" />
        {/* Create channel layers (按 Claude Design HANDOFF.md verbatim 顺序):
              1. .bg-dither     — banding 治理 noise overlay (REQUIRED)
              2. Top-light cone — SVG mask trapezoid + feGaussianBlur (NOT clip-path)
              3. Fog noise      — turbulence tile masked to fog band
            其它频道不渲染 (gated by channel === 'create'),性能 + 简洁 */}
        {useCreateBg && (
          <>
            {/* Dark mode: Canvas-rendered spotlight with Floyd-Steinberg
                dithering 取代 .bg-mesh 的 CSS spotlight。CSS gradient 在
                macOS Chrome 上 8-bit 量化无 native dither,Canvas 渲染
                可在 8-bit 输出前做误差扩散,完全消除 banding。
                Light 不挂(无 banding 问题)。 */}
            {dark && <CreateSpotlightCanvas />}
            <div className="bg-dither" />
            {/* Top-light cone (Light mode) — Light bg 上 banding 不显著,inline SVG mask 即可。
                Dark mode 的 cone 由 <CreateSpotlightCanvas> 一并 Canvas dither 渲染 (在
                同一 Canvas 内 float composite + Floyd-Steinberg + 白噪声 dither,banding
                数学上不可能形成)。 */}
            {!dark && (
              <div
                style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  background: `linear-gradient(to bottom,
                    rgba(var(--create-top-light-color), var(--create-top-light-alpha)) 0%,
                    rgba(var(--create-top-light-color), 0) 100%)`,
                  WebkitMaskImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><defs><filter id='b' x='-20%25' y='-20%25' width='140%25' height='140%25'><feGaussianBlur stdDeviation='6'/></filter></defs><polygon filter='url(%23b)' fill='white' points='${50 - 10.5},${0} ${50 + 10.5},${0} ${50 + 30},${41} ${50 - 30},${41}' /></svg>")`,
                  maskImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><defs><filter id='b' x='-20%25' y='-20%25' width='140%25' height='140%25'><feGaussianBlur stdDeviation='6'/></filter></defs><polygon filter='url(%23b)' fill='white' points='${50 - 10.5},${0} ${50 + 10.5},${0} ${50 + 30},${41} ${50 - 30},${41}' /></svg>")`,
                  WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
                  WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
                }}
              />
            )}
            <div
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                opacity: 0.15,
                mixBlendMode: 'overlay',
                backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
                backgroundSize: `${220 * 2.55}px ${220 * 2.55}px`,
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 59%, black 100%)',
                maskImage: 'linear-gradient(to bottom, transparent 59%, black 100%)',
              }}
            />
          </>
        )}

        {/* VersionUpdater is now mounted at the Router root in src/main.jsx */}
        <InstallAppBanner />

        {/* ── Sidebar — desktop / tablet only ──
         * Mobile (< 792px) 用 BottomTabBar 处理导航，Sidebar 完全不渲染
         * （overlay 模式无 hamburger trigger，永远 collapsed 还会因 Tailwind v4
         * 对 -translate-x-[calc(100%+12px)] 的解析问题露 4px 在屏幕左边）。
         * Discover immerse 模式下也隐藏（desktop 沉浸态不需要 nav）。 */}
        {!isImmerseOpen && !isSmallScreen && (
          <Sidebar
            sidebar={effectiveSidebar}
            activeSection={activeSection}
            setActiveSection={setActiveSection}
            overDarkBg={false}
          />
        )}

        {/* ── Main area: flex-col, main itself never scrolls.
               Header is pinned as first flex child (flex-shrink:0).
               Each content section carries its own overflow-y-auto,
               eliminating sticky-in-scrollable-flex overscroll bugs. ── */}
        <main className="flex-1 relative z-0 flex flex-col overflow-hidden">
          {/* Header — absolutely positioned, floats transparently over content.
           * pointerEvents:'none' on this wrapper lets clicks pass through to
           * the scroll content below (e.g. SegmentedControl docked at y=14).
           * Header's own interactive children (CTA, language, theme, mute
           * buttons) re-enable pointer events locally.
           *
           * Hidden during SparkMode fullscreen+playing (immerseChromeVisible=false).
           *
           * 2026-05-19 round-47 (docs/asks/2026-05-19-mobile-empty-header-toplevel-
           * padding.md) — Mobile + non-discover section 时 NavigationBar 3 slots
           * 全空(Left/Centre/Right 都没渲染内容),52px header 视觉为空白。
           * 隐藏 Header wrapper 避免占位。Discover (browse 跟 immerse 都) 仍 keep。
           * 对应 main wrapper pt 也降到 pt-1 (Create line 1159 + Profile line 1179)。*/}
          {immerseChromeVisible && !(isSmallScreen && activeSection !== 'discover') && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 40, pointerEvents: 'none' }}>
            <Header
              sidebar={effectiveSidebar}
              isSmallScreen={isSmallScreen}
              isMediumScreen={isMediumScreen}
              isMuted={isMuted}
              setIsMuted={setIsMuted}
              darkMode={darkMode}
              setDarkMode={setDarkMode}
              setActiveSection={setActiveSection}
              onLogoClick={() => { setIsPlaying(false); goHome(); }}
              overDarkBg={isSmallScreen && activeSection === 'discover' && discoverView === 'immerse'}
              /* Mobile-only props */
              activeSection={activeSection}
              discoverTab={discoverTab}
              setDiscoverTab={setDiscoverTab}
              discoverSegments={DISCOVER_TABS}
              discoverView={discoverView}
              onExitImmerse={exitImmerse}
              onMobileSearch={(q) => { setSearchQuery(q); setActiveSection('search'); }}
            />
          </div>
          )}

          {['wallet', 'settings', 'preferences', 'help', 'legal', 'subscription'].includes(activeSection) ? (
            /* ── Settings / Wallet ──────────────────────────────────────
               §2026-06-09 (Leon)— 'subscription' 独立全页(孤儿)已删:Header
               Upgrade CTA 改开浮窗(openSubscriptionModal);/subscription URL
               (Stripe 付款回跳 success_url 仍是 /subscription?... / 直达)渲染
               Wallet 作底,订阅 + 充值 UI 全走浮窗(下方 subModalOpen 自动开,
               浮窗内含 ?checkout 成功 banner + 余额轮询)。activeTab 把
               'subscription' 归到 'wallet'。 */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${getMainPaddingLeft(sidebar.mode)} ${isSmallScreen ? 'pt-1' : 'pt-20'}`}
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              <SettingsPage
                isSmallScreen={isSmallScreen}
                activeTab={activeSection === 'subscription' ? 'wallet' : activeSection}
                onTabChange={setActiveSection}
                darkMode={darkMode}
                setDarkMode={setDarkMode}
                isMuted={isMuted}
                setIsMuted={setIsMuted}
              />
            </div>

          ) : activeSection === 'edit-video' ? (
            /* ── Video Editor Page ─────────────────────────────── */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${getMainPaddingLeft(sidebar.mode)} pt-[60px]`}
            >
              <Suspense fallback={<div className="flex-1 flex items-center justify-center text-white"><CircleNotch size={32} className="animate-spin text-accent" /></div>}>
                <VideoEditorPage
                  isSmallScreen={isSmallScreen}
                  onBack={() => setActiveSection('discover')}
                  userTier="free"
                />
              </Suspense>
            </div>

          ) : activeSection === 'studio' ? (
            /* ── Studio page ────────────────────────────────────────── */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${getMainPaddingLeft(sidebar.mode)} ${isSmallScreen ? 'pt-1' : 'pt-20'}`}
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              <StudioPage isSmallScreen={isSmallScreen} />
            </div>

          ) : activeSection === 'library' ? (
            /* ── Library page — IA-v2 §3.2 ──────────────────────────── */
            <Suspense fallback={null}>
              <LibraryPage
                sidebarMode={sidebar.mode}
                isSmallScreen={isSmallScreen}
              />
            </Suspense>

          ) : activeSection === 'create-story' || activeSection === 'create' ? (
            /* ── Story Generator page ──────────────────────────────────── */
            /* 2026-05-09 Leon — outer pt mobile-only：mobile pt-[56px]
             * (NavigationBar ~52 + 4 breathing) / desktop pt-24 (NavigationBar
             * 80px + 16px breathing。2026-05-11 升级 header 72 → 80 容纳
             * Create channel pills,pt 20 → 24 保留 breathing。
             * SelfProfile/UserProfile 仍 pt-20。
             * 2026-05-19 round-47 — mobile pt-[56px] → pt-1 (Header wrapper
             * 在 mobile + non-discover 时已隐藏,line 1039 条件)。 */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${isSmallScreen ? 'pt-1' : 'pt-24'} ${getMainPaddingLeft(effectiveSidebar.mode)}`}
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              <Suspense fallback={null}>
                <StoryGeneratorPage
                  isSmallScreen={isSmallScreen}
                  onBack={() => { setChainSource(null); setActiveSection('discover'); }}
                  chainSource={chainSource}
                  clearChain={() => setChainSource(null)}
                />
              </Suspense>
            </div>

          ) : activeSection === 'profile' ? (
            /* ── Profile page — (mobile BottomTabBar 方案B) ────── */
            /* 2026-05-08 Leon — outer wrapper：mobile pt-[56px] (NavigationBar
             * ~52px + 4px breathing), desktop pt-20 (NavigationBar ~96px tall)。
             * 之前 mobile pt-20 (80) 让 avatar 偏低；Discover MasonryGrid 用同
             * 模式 (52 mobile / 96 desktop)。
             * 2026-05-19 round-47 — mobile pt-[56px] → pt-1 (Header wrapper
             * 在 mobile + non-discover 时已隐藏,line 1039 条件)。 */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${getMainPaddingLeft(sidebar.mode)} ${isSmallScreen ? 'pt-1' : 'pt-20'}`}
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              <SelfProfilePage
                isSmallScreen={isSmallScreen}
                setActiveSection={setActiveSection}
                allItems={shuffledMediaItems}
                isMuted={isMuted}
                likedItems={likedItems}
                toggleLike={toggleLike}
                savedItems={savedItems}
                toggleSave={toggleSave}
                /* §2026-06-01 — 个人主页媒体点击:series → /series/:realId(paywall 页),
                 * 否则 openImmerse(item.id) 开 SparkMode 沉浸态(全站唯一播放路径)。 */
                onPlay={(item) => {
                  const isSeriesRoot = Array.isArray(item.tags) && item.tags.includes('series');
                  if (isSeriesRoot) {
                    const idTag = item.tags.find(t => typeof t === 'string' && t.startsWith('series:'));
                    const realSeriesId = idTag ? idTag.split(':')[1] : null;
                    if (realSeriesId) { navigate(`/series/${realSeriesId}`); return; }
                  }
                  openImmerse(item.id);
                }}
                onChain={(item) => { setChainSource(item); setActiveSection('create'); }}
                cardRefs={cardRefs}
                videoRefs={videoRefs}
                audioRefs={audioRefs}
                hoveredCard={hoveredCard}
                setHoveredCard={setHoveredCard}
                visibleCards={visibleCards}
                followingUsers={followingUsers}
                toggleFollow={toggleFollow}
              />
            </div>

          ) : activeSection === 'user-profile' ? (
            /* ── User Profile page (/u/:userId) — 看别人的主页 ── */
            <div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${getMainPaddingLeft(sidebar.mode)} ${isSmallScreen ? 'pt-1' : 'pt-20'}`}
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              <UserProfilePage
                userId={userProfileId}
                isSmallScreen={isSmallScreen}
                onBack={() => navigate(-1)}
                allItems={shuffledMediaItems}
                isMuted={isMuted}
                likedItems={likedItems}
                toggleLike={toggleLike}
                savedItems={savedItems}
                toggleSave={toggleSave}
                /* §2026-06-01 — 用户主页媒体点击:series → /series/:realId(paywall 页),
                 * 否则 openImmerse(item.id) 开 SparkMode 沉浸态(全站唯一播放路径)。 */
                onPlay={(item) => {
                  const isSeriesRoot = Array.isArray(item.tags) && item.tags.includes('series');
                  if (isSeriesRoot) {
                    const idTag = item.tags.find(t => typeof t === 'string' && t.startsWith('series:'));
                    const realSeriesId = idTag ? idTag.split(':')[1] : null;
                    if (realSeriesId) { navigate(`/series/${realSeriesId}`); return; }
                  }
                  openImmerse(item.id);
                }}
                onChain={(item) => { setChainSource(item); setActiveSection('create'); }}
                cardRefs={cardRefs}
                videoRefs={videoRefs}
                audioRefs={audioRefs}
                hoveredCard={hoveredCard}
                setHoveredCard={setHoveredCard}
                visibleCards={visibleCards}
                followingUsers={followingUsers}
                toggleFollow={toggleFollow}
              />
            </div>

          ) : activeSection === 'search' ? (
            /* ── Search results page ───────────────────────────────────── */
            <SearchResults
              query={searchQuery}
              allItems={shuffledMediaItems}
              sidebar={sidebar}
              isSmallScreen={isSmallScreen}
              likedItems={likedItems}
              toggleLike={toggleLike}
              savedItems={savedItems}
              toggleSave={toggleSave}
              /* §2026-05-30 round-106 — 搜索结果点击:series → /series/:realId
               * (paywall 页),否则 openImmerse(item.id) 开 SparkMode 沉浸态
               * (全站唯一播放路径,与 discover 主 feed 同款)。 */
              onPlay={(item) => {
                setSearchQuery(null); // 清搜索态,避免过渡期 search 视图残留
                const isSeriesRoot = Array.isArray(item.tags) && item.tags.includes('series');
                if (isSeriesRoot) {
                  const idTag = item.tags.find(t => typeof t === 'string' && t.startsWith('series:'));
                  const realSeriesId = idTag ? idTag.split(':')[1] : null;
                  if (realSeriesId) { navigate(`/series/${realSeriesId}`); return; }
                }
                openImmerse(item.id);
              }}
              onBack={() => { setSearchQuery(null); setActiveSection('discover'); }}
              isMuted={isMuted}
              cardRefs={cardRefs}
              videoRefs={videoRefs}
              audioRefs={audioRefs}
              hoveredCard={hoveredCard}
              setHoveredCard={setHoveredCard}
              visibleCards={visibleCards}
            />

          ) : (
            /* ── Discover grid view（永久挂载 — immerse 态走模态遮罩，不替换） */
            <>
            {/* Back-to-Top FAB — Discover grid only.
             * Destination = "page top" defined as Grid-aligned state where
             * SegmentedControl sits centred on the Header CTA (scrollTop ≈ 595).
             * Reuses the existing setScrollToTabsPending auto-scroll pipeline.
             * Fades in once the user has scrolled > pivot + 1 viewport past it. */}
            {activeSection === 'discover' && (
              <button
                type="button"
                onClick={() => setScrollToTabsPending(true)}
                aria-label="Back to top"
                className="liquid-glass absolute bottom-6 right-6 z-50 rounded-full flex items-center justify-center cursor-pointer"
                style={{
                  width: 32, height: 32,
                  transition: 'opacity 0.2s ease',
                  opacity: backToTopVisible ? 1 : 0,
                  pointerEvents: backToTopVisible ? 'auto' : 'none',
                }}
              >
                <ArrowLineUp size={18} weight="bold" className="text-label-secondary" />
              </button>
            )}

            <div
              ref={scrollContainerCallback}
              className="flex-1 min-h-0 overflow-y-auto overscroll-y-none"
              style={isSmallScreen ? { paddingBottom: 'calc(80px + env(safe-area-inset-bottom, 0px))' } : undefined}
            >
              {/* Hero 已下沉到 MasonryGrid 内部 HeroCard —
                  由 DB 记录 pinned=true && pin_order=1 驱动，运营可在 admin 管理。 */}

              <div
                className={getMainPaddingLeft(sidebar.mode)}
                data-masonry
                style={activeSection === 'discover' ? {
                  /* NavigationBar 是 floating 定位，discover 顶部 section 需要自己清净空。
                   * 老 ExploreHero 时代这个净空在 ExploreHero 内部（80/96px）；
                   * Hero 下沉到 MasonryGrid 后，净空上移到这一层，值保持不变。 */
                  paddingTop: isSmallScreen ? '52px' : '96px',
                } : undefined}
              >
                {/* Discover top-level Tab (关注/发现/火花) — IA-v2 §4.1
                 * Switching to 关注 or 发现 triggers the same auto-scroll
                 * behaviour as returning from Spark, so the tabs always land
                 * at the Header CTA vertical centre.                        */}
                {/* SegmentedControl now lives in the Header (both mobile + desktop).
                    Anchor for scroll-to-tabs kept here as a zero-height marker.   */}
                {activeSection === 'discover' && <div data-discover-tabs style={{ height: 0 }} />}

                {activeSection === 'discover' && discoverTab === 'follow' && discoverFilteredItems.length === 0 ? (
                  /* "关注" empty state — no follow data yet.
                   * min-h-screen guarantees enough scroll headroom so the
                   * auto-scroll can position the tabs at y=14 (aligned with
                   * Header CTA). Without this, the short empty state clamps
                   * scrollHeight below the required target and the tabs stay
                   * stuck at their natural position. */
                  <div className="min-h-screen flex flex-col items-center justify-center text-center py-16">
                    <p className="text-label text-lg font-medium mb-2">No following yet</p>
                    <p className="text-label-secondary text-sm max-w-sm">
                      Follow creators you like, and their work will appear here.
                    </p>
                  </div>
                ) : (
                  <>
                  {/* Mobile Upgrade Plan CTA 已迁入 MasonryGrid 内嵌渲染
                      （原来是 MasonryGrid 上方的独立 banner，现在作为瀑布流的一部分）— 2026-04-21 */}

                  {/* 2026-05-09 — explicit error UI when Discover content fetch fails.
                      Was silently rendering a blank MasonryGrid before, indistinguishable
                      from "no content exists" — frustrating for users with flaky network
                      / extension-blocked Supabase / wrong device clock (which causes JWT
                      validation 400s). Now: visible "Couldn't load — Retry" panel with
                      the actual error message. */}
                  {activeSection === 'discover' && discoverFetchState === 'error' && shuffledMediaItems.length === 0 && (
                    <div className="w-full max-w-2xl mx-auto px-6 py-12 text-center">
                      <div className="w-14 h-14 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5 text-red-500">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="8" x2="12" y2="12" />
                          <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-medium text-label mb-2">Couldn't load content</h3>
                      <p className="text-sm text-label-secondary mb-1 max-w-md mx-auto">
                        {discoverFetchError || 'Something went wrong reaching our servers.'}
                      </p>
                      <p className="text-xs text-label-tertiary mb-6 max-w-md mx-auto leading-relaxed">
                        Common causes: ad blocker / privacy extension blocking{' '}
                        <code className="font-mono text-[10px]">supabase.co</code>, unstable network,
                        or device clock significantly out of sync. Try disabling extensions or refreshing.
                      </p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={retryDiscoverFetch}
                          className="px-5 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium transition-colors"
                        >
                          Try again
                        </button>
                        <button
                          onClick={() => window.location.reload()}
                          className="px-5 py-2 bg-background-secondary hover:bg-background-tertiary text-label rounded-xl text-sm font-medium transition-colors border border-background-tertiary"
                        >
                          Hard reload
                        </button>
                      </div>
                    </div>
                  )}

                  {/* §2026-06-03 BUG-002 止损 — discover feed 单独包 ErrorBoundary。
                      iOS WebKit 偶发栈溢出(Maximum call stack)在此子树崩时,只局部
                      降级 + 重试(多为间歇性,重试常能成功),不再触发整页白屏。 */}
                  <ErrorBoundary fallback={({ reset }) => (
                    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                      <p className="text-sm text-label-secondary">Something went wrong loading this page.</p>
                      <button
                        onClick={reset}
                        className="px-4 py-2 rounded-full bg-accent text-white text-sm font-medium cursor-pointer hover:bg-accent/90"
                      >
                        Retry
                      </button>
                    </div>
                  )}>
                  <MasonryGrid
                    isSmallScreen={isSmallScreen}
                    filteredMediaItems={activeSection === 'discover' ? discoverFilteredItems : filteredMediaItems}
                    activeFilter={activeFilter}
                    setActiveFilter={setActiveFilter}
                    chips={chips}
                    title="Discover"
                    overDarkBg={false}
                    isMuted={isMuted}
                    likedItems={likedItems}
                    toggleLike={toggleLike}
                    savedItems={savedItems}
                    toggleSave={toggleSave}
                    /* Discover 频道：任意条目（视频/图片）均进 immerse；其他 section 仍走 Lightbox。
                     * 图片条目的多图横滑待 SparkMode 后续扩展（已挂任务）。 */
                    onPlay={(item) => {
                      /* §2026-05-25 fei — series cards on Discover must
                       * route to /series/:realSeriesId (paywall-aware
                       * SeriesDetailPage), NOT /discover/s/:recommendedId
                       * (SparkMode immerse = single video, no paywall).
                       * The real series.id is stored in the
                       * 'series:<uuid>' tag on the recommended_content row.
                       * Falls through to legacy immerse if tag missing
                       * (older series rows that pre-date the tag pattern). */
                      const isSeriesRoot = Array.isArray(item.tags) && item.tags.includes('series');
                      if (isSeriesRoot) {
                        const idTag = item.tags.find(t => typeof t === 'string' && t.startsWith('series:'));
                        const realSeriesId = idTag ? idTag.split(':')[1] : null;
                        if (realSeriesId) {
                          navigate(`/series/${realSeriesId}`);
                          return;
                        }
                      }
                      /* §2026-06-01 — 原非 discover 分支落 setLightboxItem(round-102 死
                       * stub)→ 点击不播放。统一走 openImmerse,任何挂此 grid 的 section 都能播。 */
                      openImmerse(item.id);
                    }}
                    onChain={(item) => { setChainSource(item); setActiveSection('create'); }}
                    cardRefs={cardRefs}
                    videoRefs={videoRefs}
                    audioRefs={audioRefs}
                    hoveredCard={hoveredCard}
                    setHoveredCard={setHoveredCard}
                    visibleCards={visibleCards}
                    onSearch={(q) => { setSearchQuery(q); setActiveSection('search'); }}
                    allItems={shuffledMediaItems}
                    hideSearch={isSmallScreen}
                    showUpgradePromo={isSmallScreen && activeSection === 'discover'}
                    onUpgrade={() => setActiveSection('subscription')}
                    /* §2026-05-23 fei: mobile pagination — 25 per page,
                       Load more / 换一批 controls in the grid footer. */
                    mobilePageLimit={isSmallScreen && activeSection === 'discover' ? mobileGridLimit : undefined}
                    onLoadMore={() => setMobileGridLimit(n => n + MOBILE_PAGE_SIZE)}
                    onRefreshMobile={handleMobileRefresh}
                  />
                  </ErrorBoundary>
                  </>
                )}
              </div>
            </div>

            {/* ── SparkMode 模态遮罩（2026-04-27 Leon Phase 1）─────────────────
             * Discover 永久挂载在上面，SparkMode 浮在 viewport 之上 z-100。
             * 退出 → modal 卸载 → 下层 Discover scroll position / hover state 全保留。
             * 导出方式：modal 左上角 CaretLeft / Esc 键 / 浏览器返回。
             *
             * 用 inline style 写 inset 避开 Tailwind v4 inset-0 calc 在 iOS 16.7
             * 的 silent-drop（详见 src/design-system/tokens/index.css fallback 注释）。
             * touchAction:'none' 防止 iOS Safari 的滚动穿透到下层 Discover。 */}
            {isImmerseOpen && (
              <Suspense fallback={
                /* §2026-06-10 — 实底深色 fallback(非 null):SparkMode chunk 加载
                 * 期间盖住底层 Discover,避免从 profile 进沉浸态时"先闪 Discover"。
                 * 与下方真实子树同款 .dark + var(--create-bg) 底,加载完无缝切换。 */
                <div className="dark" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100 }}>
                  <div data-channel="create" style={{ position: 'absolute', inset: 0, background: 'var(--create-bg)' }} />
                </div>
              }>
                {/* 2026-05-17 Leon — Spark immerse 锁 dark-only (Option 1)。
                 * 选择理由 vs 适配 light:沉浸式视频体验业界惯例全暗
                 * (YouTube theater / TikTok / Reels / Netflix 等),light bg
                 * 让视频边缘对比丢失;且双套维护成本(BG / 控件 / Halo /
                 * 右面板) ≫ 锁暗的收益。
                 * 落地:外层挂 .dark class,nested 子元素 inherit dark token
                 * (因 `.dark [data-channel="create"]` selector 命中内层),
                 * 与用户系统主题无关。退出 immerse 自动恢复用户主题
                 * (影院模式 — 进暗、出灯亮)。 */}
                <div
                  className="dark"
                  style={{
                    position: 'fixed',
                    top: 0, right: 0, bottom: 0, left: 0,
                    zIndex: 100,
                  }}
                >
                  <div
                    data-channel="create"
                    style={{
                      position: 'absolute', inset: 0,
                      /* Create dark BG = #16181c (token resolves to dark
                       * value because ancestor .dark wrapper triggers
                       * `.dark [data-channel="create"]` selector override). */
                      background: 'var(--create-bg)',
                      /* 不加 touchAction:none — SparkMode 内部容器已自带。 */
                    }}
                  >
                  {/* Create dark BG 三件套,与 index.jsx 顶部页面级渲染同一套。
                   * CreateSpotlightCanvas 永远渲染 — 不再 dark gate,因外层
                   * .dark 已锁定语义,immerse 内 token 永远 resolve 到 dark 值。 */}
                  <CreateSpotlightCanvas />
                  <div className="bg-dither" />
                  <div
                    style={{
                      position: 'absolute', inset: 0, pointerEvents: 'none',
                      opacity: 0.15,
                      mixBlendMode: 'overlay',
                      backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='4'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
                      backgroundSize: `${220 * 2.55}px ${220 * 2.55}px`,
                      WebkitMaskImage: 'linear-gradient(to bottom, transparent 59%, black 100%)',
                      maskImage: 'linear-gradient(to bottom, transparent 59%, black 100%)',
                    }}
                  />
                  <SparkMode
                    allItems={shuffledMediaItems}
                    initialItemId={sparkItemId}
                    sidebarMode={sidebar.mode}
                    isSmallScreen={isSmallScreen}
                    likedItems={likedItems}
                    toggleLike={toggleLike}
                    savedItems={savedItems}
                    toggleSave={toggleSave}
                    isMuted={isMuted}
                    setIsMuted={setIsMuted}
                    onBack={exitImmerse}
                    /* §2026-05-23 fei: end-of-feed refresh. Bumping
                       discoverFetchAttempt re-runs the fetch useEffect →
                       new allItems → baseFeed recomputes (watched filter
                       skips already-seen rows from the new payload too).
                       If the user has truly seen everything, the fresh
                       feed will be tiny — the "all caught up" overlay
                       will re-appear immediately, which is honest. */
                    onRefreshFeed={() => retryDiscoverFetch()}
                    onChromeVisibleChange={setImmerseChromeVisible}
                    /* 费 2026-04-27 加的 Branch tree overlay 入口 */
                    onBranchClick={(seriesId, rootId) => setActiveSeriesTree({ seriesId, rootId })}
                    /* 2026-05-06 Leon — right pane tag chip 点击：设 filter +
                     * 退 immerse → 落到 Discover browse 视图 + tag 已过滤。 */
                    onTagFilter={(tag) => {
                      setActiveFilter(tag);
                      /* §2026-06-10 — tag 过滤永远落 Discover browse,清来源避免
                       * 退回主页(即便沉浸态是从主页进的)。 */
                      immerseOriginRef.current = null;
                      exitImmerse();
                    }}
                    /* 2026-05-06 Leon — right pane avatar/username 点击：跳
                     * /u/:userId (UserProfilePage by Session 3 scope)。
                     * 2026-05-08 Leon — 不调 exitImmerse() 因其内部 navigate
                     * '/discover/browse' 后再 navigate('/u/...') 留下中间
                     * history entry，refresh 时 URL 不稳定。直接 reset state
                     * + 单次 navigate /u/:userId 干净。 */
                    onUserProfile={(userId) => {
                      setDiscoverView('browse');
                      setSparkItemId(null);
                      immerseOriginRef.current = null; // §2026-06-10 直接跳 profile,清来源
                      navigate(`/u/${userId}`);
                    }}
                    /* mobile 左滑手势 / bottom-left author bar 点击共用入口。
                     * Item 含 artistId (UUID) 才生效；legacy 字符串作者无 FK。 */
                    onAuthorProfile={(it) => {
                      if (!it?.artistId) return;
                      setDiscoverView('browse');
                      setSparkItemId(null);
                      immerseOriginRef.current = null; // §2026-06-10 直接跳 profile,清来源
                      navigate(`/u/${it.artistId}`);
                    }}
                    /* 2026-05-06 Leon — Follow 真实化（migration 20260506_follows_table）。
                     * 2026-05-14 Leon — 传 currentUserId 给 SparkMode 用于
                     * self-follow UX 隐藏(自己作品不显 + Follow 按钮)。 */
                    followingUsers={followingUsers}
                    onToggleFollow={toggleFollow}
                    currentUserId={currentUserId}
                  />

                  {/* Mobile 退出按钮 — 固定在模态左上角（mobile 视频区 = viewport，
                   * 模态左上角 = 视频左上角）。Desktop 由 SparkMode 内部在 video
                   * pane 左上角渲染（2026-04-28 Leon 调整）。 */}
                  {isSmallScreen && (
                    <button
                      type="button"
                      onClick={exitImmerse}
                      aria-label="Close immersive view"
                      style={{
                        position: 'absolute',
                        top: 'max(env(safe-area-inset-top, 12px), 12px)',
                        left: 12,
                        zIndex: 110,
                        width: 40, height: 40,
                        borderRadius: '50%',
                        background: 'rgba(0,0,0,0.45)',
                        backdropFilter: 'blur(10px)',
                        WebkitBackdropFilter: 'blur(10px)',
                        border: '1px solid rgba(255,255,255,0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        pointerEvents: 'auto',
                        opacity: immerseChromeVisible ? 1 : 0,
                        transition: 'opacity 0.2s ease',
                      }}
                    >
                      <CaretLeft size={22} weight="bold" style={{ color: 'white' }} />
                    </button>
                  )}
                  </div>
                </div>
              </Suspense>
            )}
            </>
          )}
        </main>

        {/* ── Bottom Tab Bar (mobile only — 方案B) ─────────────────────────
         * Renders as a floating glass pill above the screen bottom edge.
         * Hidden on tablet/desktop where the sidebar handles navigation.
         * Hidden during SparkMode fullscreen+playing (immerseChromeVisible=false). */}
        {isSmallScreen && immerseChromeVisible && (
          <BottomTabBar
            activeTab={activeBottomTab}
            onTabChange={handleBottomTab}
          />
        )}
        
        {activeSeriesTree && (
          <SeriesTreeOverlay
            seriesId={activeSeriesTree.seriesId}
            rootId={activeSeriesTree.rootId}
            onClose={() => setActiveSeriesTree(null)}
            onPlay={(node) => {
               /* §2026-06-01 — 节点本身是 recommended_content 行(SeriesTreeOverlay
                * 从该表取),node.id 即可被 openImmerse 解析 → 关 overlay 进 SparkMode 沉浸态。 */
               setActiveSeriesTree(null);
               openImmerse(node.id);
            }}
            onCreateBranch={() => {
              const item = shuffledMediaItems.find(i => i.id === activeSeriesTree.rootId) || {};
              const by = item.artist ? ` by ${item.artist}` : '';
              localStorage.setItem('uvera_story_draft', JSON.stringify({
                transcript: `[Branch] Based on "${item.title}"${by}. Continue the story in a new direction while keeping the established style, setting, and characters.`,
                referenceVideoUrl: item.video,
                // §C rename 2026-05-13: continuationTitle → sequelTitle,
                // isContinuation → isSequel. StoryGeneratorPage reads both
                // keys with ?? fallback for legacy drafts in transit.
                sequelTitle: item.title,
                isSequel: true,
                isBranch: true,
                sourceWorkId: item.id || activeSeriesTree.rootId,
                seriesId: activeSeriesTree.seriesId,
                parentId: item.id || activeSeriesTree.rootId,
                step: 0,
              }));
              setActiveSeriesTree(null);
              window.location.href = '/create';
            }}
          />
        )}

        {/* §2026-06-06 Step 5 — 订阅浮窗:盖在当前页上,关闭回原页(付款走 Stripe
            整页跳转,返回落 /subscription 整页显示成功)。 */}
        {subModalOpen && (
          <SubscriptionPage
            modal
            isSmallScreen={isSmallScreen}
            onClose={() => setSubModalOpen(false)}
          />
        )}
    </div>
  );
}

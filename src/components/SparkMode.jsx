import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  CaretUp, CaretDown, Heart, BookmarkSimple, ShareFat, ChatCircle,
  FilmStrip, SpeakerHigh, SpeakerSlash, DotsThree,
  Play, Pause, UserCircle, CornersOut, CornersIn, ArrowCounterClockwise,
  DeviceRotate, CircleNotch,
  PictureInPicture, CaretLeft, DownloadSimple,
} from '@phosphor-icons/react';
/* §2026-05-23 fei: <Stream> iframe import dropped — UnifiedVideoPlayer handles
 *   ALL playback now, both for visible slots and for branch-prefetch. */
import UnifiedVideoPlayer, { labelForLevel } from './UnifiedVideoPlayer';
import { deriveContentType } from '../utils/contentType';
import { formatCompactNumber } from '../utils/formatNumber';
import { isStreamUrl, extractStreamUid, streamUidToHlsUrl, canPlayHlsNatively } from '../utils/streamUrl';
import TagChip from '../design-system/composites/TagChip';
import GlassButton from '../design-system/primitives/GlassButton';
import CountActionBtn from '../design-system/composites/CountActionBtn';
import OverlayCtrlBtn from '../design-system/composites/OverlayCtrlBtn';
import { VideoReplayButton } from '../design-system/composites/VideoOverlayButtons';
import { GlassPane } from '../design-system/composites/GlassPane';
import { getMainPaddingLeft } from '../hooks/useSidebarState';
import { supabase } from '../api/supabaseClient';
import { normalizeRecommendedList } from '../utils/normalizeRecommended';
import { markAsWatched, getWatchedIds } from '../utils/watchedHistory';
import { downloadVideo } from '../utils/downloadVideo';
import { useComments } from '../hooks/useComments';
import CommentList from './comments/CommentList';
import CommentComposer from './comments/CommentComposer';

/*
 * SparkMode — IA-v2 §4.1 "火花"
 *
 * Desktop: 6:4 split layout.
 *
 * Mobile TikTok-style:
 *   - 3-slot vertical track (prev / current / next) follows finger in real-time
 *   - Release past 28% screen height → snap to next/prev with easing
 *   - Release below threshold → elastic snap-back
 *   - Boundary rubber-band (20% resistance when no more items)
 *   - Swipe LEFT on video → navigate to author profile (onAuthorProfile prop)
 *   - Tap video → play/pause
 *   - Fullscreen button → hide Header + BottomTabBar (onFullscreenChange prop)
 *
 * touch-action:none on the container handles scroll conflict at the browser level;
 * no e.preventDefault() needed.
 */

const SNAP_EASING = 'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const V_THRESHOLD_RATIO = 0.18; // 18% of screen height to trigger snap（对标 TikTok，原 0.28 偏粘）
const V_FLICK_VELOCITY  = 0.5;  // px/ms，≥ 此速度的 flick 即使距离短也翻页（2026-04-21 加入）
const V_FLICK_MIN_DRIFT = 20;   // flick 路径最少位移（px），防止 jitter 误判
const H_THRESHOLD       = 60;   // px horizontal to trigger author profile
const AXIS_LOCK_PX      = 12;   // px of movement before axis is locked
const RUBBER_COEFF      = 0.18; // resistance coefficient at boundaries
const TAP_MAX_MS        = 300;  // finger lift-off within this window = tap
const TAP_MAX_DRIFT     = 14;   // total finger drift tolerance for a tap

export default function SparkMode({
  allItems = [],
  sidebarMode,
  isSmallScreen,
  likedItems,
  toggleLike,
  savedItems,
  toggleSave,
  onMore,                // §2026-06-08 Leon: (item) => void — 右上角 more 菜单(后端待接,可选)
  isMuted,
  setIsMuted,
  onBack,
  onFullscreenChange,    // (bool) => void — fullscreen toggle (mobile only)
  onChromeVisibleChange, // (bool) => void — derived: !isFullscreen || !isPlaying；驱动 Header / BottomTabBar
  onAuthorProfile,       // (item) => void — left-swipe navigate to author
  onBranchClick,         // (item) => void
  onTagFilter,           // (tag: string) => void — desktop right pane tag chip click → discover with filter applied
  onUserProfile,         // (userId: string) => void — desktop right pane avatar/username click → /u/:userId
  followingUsers,        // Set<userId> | undefined — current user's following set (UUIDs)
  onToggleFollow,        // (targetUserId: string) => void — toggle follow on target
  currentUserId,         // string | null — 当前登录用户 UUID;用于 self-follow 隐藏 (2026-05-14)
  initialItemId,         // string | null — 进入 immerse 态的起点 item.id；不传则从 feed[0] 开始
  onRefreshFeed,         // §2026-05-23 fei: () => void — called from "all caught up" overlay
                         //   when user reaches end of feed. Parent should re-fetch and pass
                         //   updated allItems. If omitted, the refresh button is hidden.
}) {
  /* ── Feed ─────────────────────────────────────────────────────────────────
   * §2026-05-23 fei: rewrote ordering.
   *
   *   User complaint: "目前是没有规律的，而且会不停循环播几段视频" — no clear order,
   *   keeps looping the same few videos.
   *
   *   Root causes:
   *     · DB query (adminService.fetchRecommendedContent) ORDER BY only
   *       published_at — no popularity signal.
   *     · IndexPage.jsx pre-shuffles items with shuffleArray() before
   *       passing them to us → any DB ordering is randomized away.
   *     · Old baseFeed only sorted by aspect ratio (9:16 first) and CAPPED
   *       AT 20 ITEMS. Once user reached index 19 they couldn't swipe
   *       further; swipe-back hit the same 20 items → felt like a loop.
   *     · markAsWatched existed but no reader → watched videos never
   *       excluded; user kept seeing the same ones across sessions.
   *
   *   New ordering: hybrid score = popularity (log-compressed likes+saves)
   *   × recency (exp decay, half-life 7d) + vertical-orientation bonus.
   *   Vertical preference is soft (bonus, not a hard filter), so a very
   *   popular landscape video can still surface above a stale vertical.
   *
   *   Filtering: exclude rows whose id is in the watched-history Set
   *   (localStorage, snapshot at mount). Cap removed — show ALL playable
   *   items so the user has a real backlog to scroll through.
   */
  const watchedAtMount = useMemo(() => getWatchedIds(), []);

  const scoreItem = useCallback((item) => {
    const likes = Number(item.likesCount || item.likes_count || 0);
    const saves = Number(item.savesCount || item.saves_count || 0);
    const popularity = Math.log(likes + saves + 1);   // 0..~7 typical
    const ts = item.publishedAt || item.published_at || item.createdAt;
    let recency = 0.1;                                 // floor for missing dates
    if (ts) {
      const ageMs  = Date.now() - new Date(ts).getTime();
      const ageDays = Math.max(0, ageMs / 86_400_000);
      recency = Math.exp(-ageDays / 7);               // half-life ~7 days
    }
    const orientationBonus = item.aspectRatio === '9/16' ? 0.3 : 0;
    return popularity * 0.4 + recency * 1.0 + orientationBonus;
  }, []);

  const baseFeed = useMemo(() => {
    const playable = allItems
      .filter((i) => i.video || i.cover)
      .filter((i) => !watchedAtMount.has(i.id));  // exclude already-seen

    const sorted = [...playable].sort((a, b) => scoreItem(b) - scoreItem(a));

    // Lift the user-clicked item to position 0 if it's still playable +
    // not watched. (If it WAS watched, we let the score sort decide where
    // it lands — most likely buried.)
    if (initialItemId) {
      const clicked = sorted.find((x) => x.id === initialItemId);
      const rest = sorted.filter((x) => x.id !== initialItemId);
      // Fallback: if clicked got filtered out by watched-filter, try to
      // restore it from raw allItems so the click-to-spark path still
      // lands on the right video.
      if (!clicked) {
        const recovered = allItems.find((x) => x.id === initialItemId && (x.video || x.cover));
        if (recovered) return [recovered, ...sorted];
      }
      return clicked ? [clicked, ...rest] : sorted;
    }
    return sorted;
  }, [allItems, initialItemId, watchedAtMount, scoreItem]);

  const [feed, setFeed] = useState([]);
  useEffect(() => { setFeed(baseFeed); }, [baseFeed]);

  /* ── Shared state ─────────────────────────────────────────────────────── */
  const [index,       setIndex]       = useState(0);
  const [isPlaying,   setIsPlaying]   = useState(true);

  /* §2026-05-23 fei: per-item MEASURED aspect ratio (from <video>.videoWidth /
   *   videoHeight at loadedmetadata time). Falls back to slotItem.aspectRatio
   *   if not yet measured.
   *
   *   Why: the DB-stored aspectRatio on recommended_content rows is wrong /
   *   missing for many videos (e.g. 16:9 landscape videos stored as the 9:16
   *   default). The slot's boxStyle computation below uses aspectRatio to
   *   decide whether the video is landscape vs portrait — wrong AR meant the
   *   box was sized as portrait but the video was actually landscape, so
   *   object-fit:cover would crop the video to show only a tiny center slice.
   *
   *   With measured AR, the box exactly matches the video's natural
   *   dimensions, object-fit:cover === object-fit:contain (no crop, no
   *   letterbox) — full video shown, properly letterboxed against the slot
   *   if needed.
   */
  /* §2026-05-23 fei: end-of-feed sentinel. Set true when user tries to
   *   swipe past the last item; reset when feed/index changes (refresh
   *   landed or user manually went back). Drives the "all caught up"
   *   overlay below. */
  const [triedEndSwipe, setTriedEndSwipe] = useState(false);
  useEffect(() => { setTriedEndSwipe(false); }, [index, feed.length]);
  // §2026-06-04 — 移除 measuredARs/recordMeasuredAR:沉浸视频改为 object-contain
  //   铺满整槽(浏览器按 intrinsic AR letterbox),不再用 JS 算的 measured-AR box,
  //   故 AR 实测/记录逻辑全部废弃(根治切视频"从小到大"+ Safari 尺寸抖动 BUG-008)。
  // isFollowing now derived from `followingUsers` Set (passed from IndexPage,
  // sourced from public.follows table). Local state removed — kept persistent
  // across navigation + browser refresh.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoadingBranch, setIsLoadingBranch] = useState(false);

  /* Desktop control bar 显隐（2026-04-28 Phase 1）：
   * - paused 持续显
   * - playing 3s 无操作 fade
   * - 鼠标在视频区移动 → 重置 timer
   * AutoPlay state 是 placeholder，Phase 2 与费对齐后再接 handleEnded 行为。 */
  const [showControls, setShowControls] = useState(true);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true); // ∞ autoplay advance toggle
  /* §2026-05-30 round-106 增量C — 🔁 Repeat 'off'|'all'|'one'(见 transport-model doc)。
   * short-feed 默认 'one'(loop self)。'one' → active video.loop=true。
   * 'all' 循环 feed(播完 goNext 回头,简化版),'off' 播完按 ∞ autoplay。 */
  const [repeatMode, setRepeatMode] = useState('one'); // mobile loop prop 用;desktop 由 PlayerActionBar 管
  const [speedPopupOpen, setSpeedPopupOpen] = useState(false);
  const speedWrapperRef = useRef(null);
  /* §2026-05-27 fei round 4 — Quality picker integrated into desktop
   *   controls bar (next to Speed). Replaces the prior internal pill
   *   from UnifiedVideoPlayer (`showQualitySelector` prop) which floated
   *   at bottom-right of the FULL pane (absolute inset-0) — visually
   *   outside the video frame, in the letterbox black area, far from
   *   the rest of the controls. Bar-integration mirrors the LibraryPage
   *   pattern and keeps all video controls in one place.
   *
   *   Re Leon's 2026-05-03 note about no HLS source: CF Stream migration
   *   is now in progress, and even single-level content gets a read-only
   *   pill via videoIntrinsicHeight fallback in UnifiedVideoPlayer. */
  const [videoLevels, setVideoLevels] = useState([]);
  const [videoLevel, setVideoLevel] = useState(-1);
  const [qualityPopupOpen, setQualityPopupOpen] = useState(false);
  const qualityWrapperRef = useRef(null);

  // 2026-05-06 Leon — Right pane comment input state（Phase 1 UI shell;
  // 真实 comments 表 / API / RLS Phase 2 高危需费对齐）。
  const [commentExpanded, setCommentExpanded] = useState(false);
  const idleTimerRef = useRef(null);

  /* P2-1: Browser fullscreen ─────────────────────────────────────────────
   * 视频 pane wrapper 调 requestFullscreen() — 视频独占屏幕。
   * 监听 fullscreenchange + webkit-prefixed 兼容旧 Safari，
   * 用户 ESC 退出也能正确同步 state */
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const videoPaneRef = useRef(null);
  const fullscreenSupported = typeof document !== 'undefined' &&
    (document.fullscreenEnabled || document.webkitFullscreenEnabled);

  const toggleBrowserFullscreen = useCallback(() => {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      exit?.call(document);
    } else {
      const el = videoPaneRef.current;
      if (!el) return;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      req?.call(el).catch((err) => console.warn('Fullscreen request failed:', err));
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      setIsBrowserFullscreen(!!fsEl);
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  /* P2-2 PiP state — 注意：isCurrentVideoCF / 关联 effect 引用 item，
   * 必须在 `const item = feed[index] ?? null` 之后才能 derive。state 本身
   * 不依赖 item 可以放这里；derive + effect 移到 item 声明之后。 */
  const [isPipActive, setIsPipActive] = useState(false);
  const togglePiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (videoRef.current && videoRef.current.requestPictureInPicture) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (e) {
      console.warn('PiP toggle failed:', e);
    }
  }, []);

  /* Speed popup 点击 outside 关闭 */
  useEffect(() => {
    if (!speedPopupOpen) return;
    const handler = (e) => {
      if (speedWrapperRef.current && !speedWrapperRef.current.contains(e.target)) {
        setSpeedPopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [speedPopupOpen]);

  /* §2026-05-27 fei — Quality popup outside-click (mirrors Speed). */
  useEffect(() => {
    if (!qualityPopupOpen) return;
    const handler = (e) => {
      if (qualityWrapperRef.current && !qualityWrapperRef.current.contains(e.target)) {
        setQualityPopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [qualityPopupOpen]);

  /* 控件自动隐藏延时 — 单一 source of truth，所有绑 showControls 的元素
   * （控件 bar / prev-next / close 按钮）共享此值。Leon 2026-04-29 改 3000→2000。 */
  const IDLE_HIDE_MS = 2000;

  const showControlsBriefly = useCallback(() => {
    setShowControls(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (isPlaying) {
      idleTimerRef.current = setTimeout(() => setShowControls(false), IDLE_HIDE_MS);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!isPlaying) {
      setShowControls(true);
      return;
    }
    idleTimerRef.current = setTimeout(() => setShowControls(false), IDLE_HIDE_MS);
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [isPlaying]);

  /* ── Video chrome state (fullscreen-paused control panel) ────────────────
   * 设计：fullscreen + playing → 全部 chrome 隐藏（沉浸态）；fullscreen + paused
   * → Header / Sound+Full / 底部视频控件（标题 / 进度条 / 时长 / 倍速 / 横屏提示）
   * 全部出现。tap 视频切 isPlaying，自动驱动整套 chrome 显隐。 */
  const [currentTime,  setCurrentTime]  = useState(0);
  const [duration,     setDuration]     = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75];
  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((rate) => {
      const idx = PLAYBACK_RATES.indexOf(rate);
      return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    });
  }, []);
  const formatVideoTime = (s) => {
    if (!s || !isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  };

  // Relative-time formatter for right pane post timestamp. Returns null
  // if input is missing/invalid so caller can conditionally skip render.
  const formatPostTime = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1)   return 'Just now';
    if (min < 60)  return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24)   return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 7)   return `${day}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  /* initialIndexRef：记录进入 immerse 态的起点 index。
   * 用户从瀑布流点某条进来 → 该条为起点；沿用户决策"以该条为 index 0 继续下刷"，
   * 向下可刷任意条，回滑到该条即停（canPrev 在此边界内变 false）。*/
  const initialIndexRef = useRef(null);
  useEffect(() => {
    if (!feed.length) return;
    if (initialIndexRef.current !== null) return;
    const i = initialItemId ? feed.findIndex((x) => x.id === initialItemId) : 0;
    const resolved = i >= 0 ? i : 0;
    initialIndexRef.current = resolved;
    setIndex(resolved);
  }, [feed, initialItemId]);

  /* ── End-of-playback 接龙 / 重播 ─────────────────────────────────────────
   * endedIds：播完过的 item.id 集合 — 进入"然后呢？/重播"结束态
   * positionMap：item.id → 最后 currentTime，切换 item 后滑回可恢复播放位置
   * 设计：每次播完都停（不 loop），滑走/滑回保持停/播位置。接龙后端由费实现，
   *       这里先保留 onContinue placeholder，等 API 就位再接线。*/
  const [endedIds, setEndedIds] = useState(() => new Set());
  const positionMap = useRef(new Map());

  /* ── Desktop video ref ────────────────────────────────────────────────── */
  const videoRef = useRef(null);

  /* ── Mobile swipe state (all refs — no re-render during drag) ─────────── */
  const screenH        = useRef(typeof window !== 'undefined' ? window.innerHeight : 812);
  const [trackY,       setTrackY]         = useState(() => -(typeof window !== 'undefined' ? window.innerHeight : 812));
  const [trackTrans,   setTrackTrans]      = useState('none');
  const isSnapping     = useRef(false);
  const dragAxis       = useRef(null);    // 'v' | 'h' | null — locked on first move
  const touchStart     = useRef({ x: 0, y: 0 });
  const touchCurr      = useRef({ x: 0, y: 0 });
  const touchStartTime = useRef(0);
  const dragStartTrack = useRef(0);
  /* passthrough：touch 起点落在 button / link / [data-spark-passthrough] 内时置 true
   * → 整条 touch 流程跳过手势解析，native click 正常触发 Like/Follow/Save 等
   * 修复：手机上点 Like/Follow 会同时触发 play/pause（外层 onTouchEnd 把所有 tap
   * 都当成 toggle play）。参考 DEFERRED-DECISIONS 无此条目 — 属 bugfix 不留挂起。 */
  const passthrough    = useRef(false);

  /* lastTouchEndTs：记录最近一次 touchEnd 时间。desktop 浏览器模拟 mobile 时
   * 若 DevTools 未开 touch emulation，只发 mouse 事件，touch handler 不触发
   * → togglePlay 永不执行。加个 onClick fallback 解决开发调试问题；真机 tap
   * 后浏览器会合成 click ~300ms 内，用时间戳抑制双触发。*/
  const lastTouchEndTs = useRef(0);

  /* isMouseDown：desktop DevTools 未开 touch emulation 时只发 mouse 事件，
   * 鼠标上下拖动无法翻页（touch handler 不触发）。mouse 事件没有 native
   * pressed-state，需要自己 track 下/上/leave 三态。 */
  const isMouseDown = useRef(false);

  /* containerRef：wheel 事件 React 默认 passive，preventDefault 无效
   * → 需要 useEffect + addEventListener 手动绑定 { passive: false }，
   * 否则 wheel 冒泡到上层把 Segment Control 横向滚走。 */
  const containerRef = useRef(null);

  const item    = feed[index] ?? null;
  /* canPrev 边界：不允许回滑到进入 immerse 的起点之前（TikTok/IG Reels 风），
   * initialIndexRef 未就绪时退化为普通首项约束。*/
  const canPrev = index > (initialIndexRef.current ?? 0);
  const canNext = index < feed.length - 1;

  const isLiked = item && likedItems?.has(item.id);
  const isSaved = item && savedItems?.has(item.id);

  /* §2026-06-10 — 评论数据(desktop 右 pane + mobile 评论 sheet 共用)。
   * 切 item 自动重拉;total 实时驱动 action row / pane 顶的 Comments·N。 */
  const commentsApi = useComments(item?.id, { initialCount: item?.commentsCount || 0 });
  const [mobileCommentsOpen, setMobileCommentsOpen] = useState(false);
  // action row / pane 显示的评论数:优先用 hook 实时 total,初始回退 feed 静态值
  const liveCommentsCount = commentsApi.total;

  /* P2-2 PiP — derive 部分（依赖 item）+ effect（依赖 item.id）。
   * CF Stream iframe 不暴露 video element → 不支持 PiP，disabled fallback。
   * Detection 走共用 helper：videodelivery.net + iframe.cloudflarestream.com 都覆盖。 */
  const isCurrentVideoCF = isStreamUrl(item?.video);
  const pipSupported = typeof document !== 'undefined' &&
    document.pictureInPictureEnabled && !isCurrentVideoCF;

  useEffect(() => {
    if (isSmallScreen) return;
    const video = videoRef.current;
    if (!video || !video.addEventListener) return;
    const onEnter = () => setIsPipActive(true);
    const onLeave = () => setIsPipActive(false);
    video.addEventListener('enterpictureinpicture', onEnter);
    video.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      video.removeEventListener('enterpictureinpicture', onEnter);
      video.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [isSmallScreen, item?.id]);

  /* 2026-04-28 Phase D: 用真实 item.tags（DB 字段）。
   * description 暂无 DB 列，desktop 那行 <p>{mockDesc}</p> 一并去掉，等 schema
   * 加 description 列再复活。 */
  const itemTags = Array.isArray(item?.tags) ? item.tags : [];

  /* ── Fullscreen notify ────────────────────────────────────────────────── */
  useEffect(() => { onFullscreenChange?.(isFullscreen); }, [isFullscreen, onFullscreenChange]);
  useEffect(() => () => { onFullscreenChange?.(false); }, []); // eslint-disable-line

  /* ── Chrome visibility derivation + propagate ────────────────────────────
   * chromeVisible = 任何"非沉浸播放"态。fullscreen 才参与判定；非 fullscreen
   * 永远 true（原生 chrome 始终可见）。父层（index.jsx）据此切 Header/BottomTabBar。 */
  const chromeVisible = !isFullscreen || !isPlaying;
  /* §2026-06-10 — 移动评论 sheet 打开时,隐藏 index.jsx 的 Header/BottomTabBar,
   * 否则底部 tab bar 与评论 composer 撞位(本地 Sound+Full 簇被 sheet 盖住,不另处理)。*/
  useEffect(() => { onChromeVisibleChange?.(chromeVisible && !mobileCommentsOpen); }, [chromeVisible, mobileCommentsOpen, onChromeVisibleChange]);
  useEffect(() => () => { onChromeVisibleChange?.(true); }, []); // eslint-disable-line

  /* ── Apply playback rate to active video on rate / item change ─────────── */
  useEffect(() => {
    const ref = isSmallScreen ? mobileVideoRef.current : videoRef.current;
    if (!ref) return;
    try { ref.playbackRate = playbackRate; } catch { /* CF Stream 偶发 */ }
  }, [playbackRate, isSmallScreen, item?.id]);

  /* ── Reset video time / duration / playback rate on item change ────────── */
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setPlaybackRate(1); // 倍速不跨 item 持久（Leon 2026-04-25）
    setIsPlaying(true); // 保证切换视频时自动播放
  }, [item?.id]);


  /* ── Scrubbing (drag progress bar to seek) ─────────────────────────────── */
  const progressBarRef = useRef(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const computeScrubFraction = useCallback((clientX) => {
    const el = progressBarRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    return rect.width > 0 ? x / rect.width : 0;
  }, []);
  const seekToFraction = useCallback((fraction) => {
    if (!duration || !isFinite(duration)) return;
    const newTime = Math.max(0, Math.min(duration, duration * fraction));
    const ref = isSmallScreen ? mobileVideoRef.current : videoRef.current;
    if (ref) {
      try { ref.currentTime = newTime; } catch { /* CF Stream 偶发 */ }
    }
    setCurrentTime(newTime);
  }, [duration, isSmallScreen]);
  const handleScrubStart = useCallback((e) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsScrubbing(true);
    seekToFraction(computeScrubFraction(e.clientX));
  }, [computeScrubFraction, seekToFraction]);
  const handleScrubMove = useCallback((e) => {
    if (!isScrubbing) return;
    e.stopPropagation();
    seekToFraction(computeScrubFraction(e.clientX));
  }, [isScrubbing, computeScrubFraction, seekToFraction]);
  const handleScrubEnd = useCallback((e) => {
    if (!isScrubbing) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    setIsScrubbing(false);
  }, [isScrubbing]);

  /* currentTime=0 和 play/pause 拆两个 effect：
   *  - item.id 变时 reset 到开头（换视频）
   *  - isPlaying 变时只 play/pause，不动 currentTime（保留当前进度）
   *  合在一个 effect 会导致"每次 tap pause 视频回零"。 */

  /* ── Desktop: restore position / reset on video change ──────────────── */
  useEffect(() => {
    if (isSmallScreen || !videoRef.current || !item) return;
    const saved = positionMap.current.get(item.id);
    try { videoRef.current.currentTime = saved ?? 0; } catch { /* noop */ }
  }, [item?.id, isSmallScreen]);

  /* ── Desktop: play / pause (ended 时不 auto-play，等用户选「重播/接龙」) */
  useEffect(() => {
    if (isSmallScreen || !videoRef.current) return;
    if (isPlaying && !endedIds.has(item?.id)) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  }, [isPlaying, item?.id, isSmallScreen, endedIds]);

  /* ── Mobile: restore position / reset on video change ────────────────── */
  const mobileVideoRef = useRef(null);
  useEffect(() => {
    if (!isSmallScreen || !mobileVideoRef.current || !item) return;
    const saved = positionMap.current.get(item.id);
    try { mobileVideoRef.current.currentTime = saved ?? 0; } catch { /* noop */ }
  }, [item?.id, isSmallScreen]);

  /* ── §2026-06-11 isPlaying ← video 事件单向同步(video 为事实来源)─────────
   * isPlaying 此前是"愿望状态",video 实际可背离(iOS NotAllowedError 拒播、
   * UVP muted-fallback、系统打断/画中画/来电),两边脱节 → CTA 说谎/闪烁。
   * 监听当前 active video 的 play/pause 原生事件回写 isPlaying,UI 永远如实。
   * 注:pause() 的事件按规范 queue task 异步派发,切视频时本 effect cleanup
   * 先同步移除旧监听 → 旧 video 的滞后 pause 事件不会误写新 item 状态。
   * ended 引发的 pause 跳过(ended 流程由 handleVideoEnded 管)。 */
  useEffect(() => {
    if (!isSmallScreen) return;
    const v = mobileVideoRef.current;
    if (!v) return;
    const onPlay  = () => setIsPlaying(true);
    const onPause = () => { if (!v.ended) setIsPlaying(false); };
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => { v.removeEventListener('play', onPlay); v.removeEventListener('pause', onPause); };
  }, [isSmallScreen, item?.id]);

  /* ── Mobile: play / pause — snap 结束后生效 ──────────────────────────── */
  /* 2026-04-28 fix: CF Stream iframe 的 streamRef 回调通过 postMessage 异步绑定，
   * 在 slot 切换后可能延迟 200-800ms 才就绪。仅靠 3 次 rAF (~50ms) 远远不够。
   * 改为混合策略：先 rAF 快速尝试（覆盖 native <video> 的快速 mount），
   * 然后 setTimeout 150ms 间隔持续重试最长 2s（覆盖 CF Stream 慢绑定）。
   * pause 路径保持同步（ref 存在就立即 pause，不存在也无所谓）。 */
  useEffect(() => {
    if (!isSmallScreen) return;
    if (!isPlaying || endedIds.has(item?.id)) {
      mobileVideoRef.current?.pause();
      return;
    }
    let cancelled = false;
    let attempt = 0;
    const MAX_ATTEMPTS = 15;        // 3 rAF (~50ms) + 12 × 150ms (~1.8s)
    const POLL_INTERVAL = 150;      // ms between setTimeout retries

    const tryPlay = () => {
      if (cancelled) return;
      const el = mobileVideoRef.current;
      if (el) {
        const p = el.play();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {
            // play() rejected (e.g. element not ready yet) — schedule retry
            if (!cancelled && attempt < MAX_ATTEMPTS) {
              attempt++;
              setTimeout(tryPlay, POLL_INTERVAL);
            }
          });
        }
      } else if (attempt < MAX_ATTEMPTS) {
        // ref not bound yet — keep polling
        attempt++;
        if (attempt <= 3) {
          requestAnimationFrame(tryPlay);   // fast path for native <video>
        } else {
          setTimeout(tryPlay, POLL_INTERVAL); // slow path for CF Stream
        }
      }
    };
    // First attempt: one rAF delay so React can commit the new element
    requestAnimationFrame(tryPlay);
    return () => { cancelled = true; };
  }, [isPlaying, item?.id, isSmallScreen, endedIds]);

  /* ── 保持 screenH / trackY 与实际 viewport 同步 ─────────────────────────
   * 第一次以为这里是"两个 slot 半重叠 + 中间黑带"的根因（URL bar 延迟收缩
   * 导致 screenH 采样偏小），Leon 2026-04-21 真机验证后反馈**该 fix 未解决
   * 问题**，且 Hero 视频无此 bug、feed 其它视频有。真正根因见下方视频渲染
   * 块注释：CF Stream Container `padding-top` AR hack 把 iframe 压缩到顶部
   * 一段 + native <video> 的 poster 属性在 iOS 未 autoplay 时不尊重 object-fit。
   *
   * 本段 resize listener 保留作为 iOS URL bar 抖动的 defense-in-depth（真
   * 机上仍可能在切换 URL bar 时出现 1 帧的 slot 尺寸不一致），开销可忽略。 */
  useEffect(() => {
    if (!isSmallScreen) return;

    const readH = () => Math.round(window.visualViewport?.height ?? window.innerHeight);

    const sync = () => {
      if (isSnapping.current) return;                    // 避免打断翻页动画
      if (dragAxis.current !== null) return;             // 用户拖动中不要打断
      const h = readH();
      if (h === screenH.current) return;                 // 无变化则跳过（避免多余 re-render）
      screenH.current = h;
      setTrackTrans('none');
      setTrackY(-h);
    };

    sync();                                              // 初次挂载同步一次（覆盖 useState 可能采到的 stale 值）

    window.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('resize', sync);
    window.visualViewport?.addEventListener('scroll', sync);  // iOS URL bar 收缩会 fire scroll
    return () => {
      window.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('resize', sync);
      window.visualViewport?.removeEventListener('scroll', sync);
    };
  }, [isSmallScreen]);

  const prefetchSet = useRef(new Set());
  const [prefetchedBranch, setPrefetchedBranch] = useState(null);

  /* §2026-05-23 fei round-3: 10-deep TikTok-style lookahead prefetch.
   *
   *   User request: "我希望视频可以预加载10段视频的开头部分，这样可以更丝
   *   滑的上下切换视频" — preload the beginning of 10 videos for smoother
   *   up/down swipes.
   *
   *   What we prefetch per upcoming item:
   *     (a) HLS m3u8 manifest (~1-3 KB) — primes browser cache. When the
   *         actual <video> element later requests the same URL, it's a
   *         cache hit — saves 1 RTT (~80-300ms on cellular).
   *     (b) Cover image (~10-30 KB) — instant poster paint on swipe.
   *         Done via `new Image()` which triggers HTTP cache prefetch
   *         + decode without holding DOM references.
   *     (c) For direct mp4 (rare post-migration): Range 0-256KB to grab
   *         the moov atom + first frame chunk so <video> can paint
   *         instantly when mounted.
   *
   *   Why 10 vs the previous 2:
   *     · Heavy users swipe 3-5 videos in quick succession. 2-deep
   *       lookahead got out-paced — the 5th swipe hit cold cache.
   *     · 10 × ~25KB total ≈ 250KB per index change. Well under a video
   *       segment's size; ignorable on WiFi, acceptable on cellular.
   *
   *   Why we re-enabled on Safari (was disabled in round-2):
   *     · Round-2 disabled because: HTTP/2 connection contention on iOS
   *       Safari starved the active video's segment fetches when we did
   *       Range-fetches for direct mp4.
   *     · Now most rows are Stream (post-migration), so we mostly fetch
   *       tiny m3u8 manifests + small cover images — no significant
   *       contention. Cover prefetch in particular has direct UX value
   *       on Safari (instant poster).
   *     · For Safari + direct mp4 (rare), we still skip the Range
   *       prefetch to avoid the contention risk.
   *
   *   Skipped entirely on save-data + slow-2g networks.
   */
  const lookaheadSet = useRef(new Set());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && ['slow-2g', '2g'].includes(conn.effectiveType)) return;

    const safariNative = canPlayHlsNatively();

    // 10-deep lookahead. Skip 0 (active) and -1 (prev, already rendered).
    const lookaheadOffsets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const toFetch = [];
    for (const off of lookaheadOffsets) {
      const next = feed[index + off];
      if (!next?.video) continue;
      if (lookaheadSet.current.has(next.video)) continue;
      lookaheadSet.current.add(next.video);
      toFetch.push(next);
    }
    if (toFetch.length === 0) return;

    const controllers = [];
    toFetch.forEach(item => {
      const src = item.video;
      const isStream = isStreamUrl(src);
      const uid = isStream ? extractStreamUid(src) : null;
      const fetchUrl = (isStream && uid) ? streamUidToHlsUrl(uid) : src;

      // For direct mp4 on Safari: skip the Range fetch (HTTP/2 contention
      // risk on iOS). Manifest fetches for Stream URLs are tiny + safe.
      const shouldFetchVideo = !(safariNative && !isStream);
      if (shouldFetchVideo) {
        const ac = new AbortController();
        controllers.push(ac);
        const headers = (isStream && uid) ? {} : { Range: 'bytes=0-262143' };
        fetch(fetchUrl, {
          signal: ac.signal,
          headers,
          priority: 'low',
          cache: 'default',
        }).catch(() => { /* silent — best-effort prefetch */ });
      }

      // Cover image — `new Image()` triggers HTTP fetch + decode. Browser
      // keeps it in its image cache; when SparkMode's <video poster=...>
      // or hidden <img src=cover> later loads, it's instant.
      if (item.cover) {
        try {
          const img = new Image();
          img.decoding = 'async';
          img.src = item.cover;
        } catch { /* silent */ }
      }
    });

    return () => {
      controllers.forEach(ac => { try { ac.abort(); } catch {} });
    };
  }, [index, feed]);

  const handlePrefetchBranch = useCallback(async (itemId) => {
    if (prefetchSet.current.has(itemId)) return;
    prefetchSet.current.add(itemId);
    setIsLoadingBranch(true);

    try {
      const { data: branches, error } = await supabase
        .from('recommended_content')
        .select('*')
        .contains('tags', [`#Parent:${itemId}`]);

      if (!error && branches && branches.length > 0) {
        const nextBranch = branches[Math.floor(Math.random() * branches.length)];
        const normalizedList = normalizeRecommendedList([nextBranch]);
        if (normalizedList.length > 0) {
          setPrefetchedBranch({ parentId: itemId, branch: normalizedList[0] });
        }
      }
    } catch (err) {
      console.error('Failed to pre-fetch branch:', err);
    } finally {
      setIsLoadingBranch(false);
    }
  }, []);

  const handleEnded = useCallback(async () => {
    if (!item) return;

    if (prefetchedBranch && prefetchedBranch.parentId === item.id) {
      const nextBranch = prefetchedBranch.branch;
      setPrefetchedBranch(null);
      markAsWatched(item.id);
      setFeed(prev => {
        const newFeed = [...prev];
        newFeed[index] = nextBranch;
        return newFeed;
      });
      setIsPlaying(true);
      setIsLoadingBranch(false);
      return;
    }

    setIsLoadingBranch(true);
    try {
      const { data: branches, error } = await supabase
        .from('recommended_content')
        .select('*')
        .contains('tags', [`#Parent:${item.id}`]);

      if (!error && branches && branches.length > 0) {
        const nextBranch = branches[Math.floor(Math.random() * branches.length)];
        const normalizedList = normalizeRecommendedList([nextBranch]);
        if (normalizedList.length > 0) {
          const normalized = normalizedList[0];
          markAsWatched(item.id);
          setFeed(prev => {
            const newFeed = [...prev];
            newFeed[index] = normalized;
            return newFeed;
          });
          setIsPlaying(true);
          setIsLoadingBranch(false);
          return;
        }
      }
    } catch (err) {
      console.error('Failed to auto-play branch:', err);
    }
    
    // Fallback: no branch or error
    setIsLoadingBranch(false);
    setEndedIds((s) => { const n = new Set(s); n.add(item.id); return n; });
    markAsWatched(item.id);
    setIsPlaying(false);
  }, [item, index, feed, isSmallScreen, prefetchedBranch]);

  const handleUnifiedTimeUpdate = useCallback((t, sourceRef) => {
    if (!item) return;
    positionMap.current.set(item.id, t);
    setCurrentTime(t);
    const d = sourceRef.current?.duration;
    if (d && isFinite(d)) {
      setDuration((prev) => prev === d ? prev : d);
    }
    /* §2026-05-30 round-106 增量C — 删 dead Branch prefetch 触发(原 d-t<=1.5
       时 query #Parent;Branch round-105 已停,短视频改原生 loop self,无需 prefetch)。 */
  }, [item, index]);

  const handleQuickBranch = useCallback(() => {
    if (!item) return;
    const seriesTag = (item.tags || []).find(t => typeof t === 'string' && t.startsWith('#Series:'));
    const seriesId = seriesTag ? seriesTag.split(':')[1] : item.id;
    const by = item.artist ? ` by ${item.artist}` : '';
    const parentId = item.id;
    localStorage.setItem('uvera_story_draft', JSON.stringify({
      transcript: `[Branch] Based on "${item.title}"${by}. Continue the story in a new direction while keeping the established style, setting, and characters.`,
      referenceVideoUrl: item.video,
      sequelTitle: item.title,
      isSequel: true,
      isBranch: true,
      sourceWorkId: item.id,
      seriesId: seriesId,
      parentId: parentId,
      step: 0,
    }));
    window.location.href = '/create';
  }, [item]);

  const handleViewBranchTree = useCallback(() => {
    if (!item) return;
    const seriesTag = (item.tags || []).find(t => typeof t === 'string' && t.startsWith('#Series:'));
    const seriesId = seriesTag ? seriesTag.split(':')[1] : item.id;
    
    if (onBranchClick) {
      onBranchClick(seriesId, item.id);
    } else {
      handleQuickBranch();
    }
  }, [item, onBranchClick, handleQuickBranch]);

/* 2026-05-06 Leon — Share 真实化。canonical URL 用 immerse permalink
   * (/discover/s/:id) 这样接收方点击会打开同一条视频的 immerse 态。
   * Web Share API 优先（mobile + supported desktop）→ 系统原生 share 表
   * fallback clipboard + alert（IE/旧 Safari/桌面无 share）— mirror
   * LibraryPage handleShare 模式（line 238-258）。 */
  const [shareToast, setShareToast] = useState(null);
  const handleShare = useCallback(async () => {
    if (!item) return;
    const shareUrl = `${window.location.origin}/discover/s/${item.id}`;
    const shareTitle = item.title || 'Uvera';
    const shareText = `Check out this video on Uvera: ${shareTitle}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareText, url: shareUrl });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareUrl);
        setShareToast('Link copied to clipboard');
        setTimeout(() => setShareToast(null), 2000);
      } else {
        // Last resort fallback
        prompt('Copy this link:', shareUrl);
      }
    } catch (err) {
      // AbortError = user dismissed share sheet — silent. Other errors log only.
      if (err && err.name !== 'AbortError') console.warn('Share failed:', err);
    }
  }, [item]);

  /* §2026-05-25 fei: use shared downloadVideo helper (handles CF Stream
     pre-process). The old inline fetch→blob worked for R2 but failed for
     Stream URLs (saved iframe HTML or m3u8 manifest, not the mp4). */
  const [sparkDownloadStatus, setSparkDownloadStatus] = useState(null);
  const handleDownloadSparkVideo = useCallback(async () => {
    if (!item?.video) return;
    try {
      await downloadVideo(item.video, item.title, {
        onPrepare:  () => setSparkDownloadStatus('准备 MP4 中…'),
        onProgress: (pct) => setSparkDownloadStatus(`Cloudflare Stream 生成 MP4… ${pct}%`),
        onDownload: () => setSparkDownloadStatus('下载中…'),
      });
    } catch (e) {
      console.error('Download failed:', e);
      alert('下载失败：' + (e.message || '未知错误'));
    } finally {
      setSparkDownloadStatus(null);
    }
  }, [item?.video, item?.title]);

  /* ── Navigation helpers ───────────────────────────────────────────────── */
  /* togglePlay：若当前 item 已 ended → 走"重播"路径（清 ended、reset currentTime、play）；
   * 否则走普通 toggle。让 tap 视频在 ended 态等价于点中央"重播"按钮（Primary）。*/
  const togglePlay = useCallback(() => {
    if (item && endedIds.has(item.id)) {
      setEndedIds((prev) => { const n = new Set(prev); n.delete(item.id); return n; });
      positionMap.current.delete(item.id);
      const ref = isSmallScreen ? mobileVideoRef.current : videoRef.current;
      if (ref) {
        try { ref.currentTime = 0; } catch { /* CF Stream 偶发抛错，忽略 */ }
        ref.play?.().catch(() => {});
      }
      setIsPlaying(true);
      return;
    }
    /* §2026-06-11 — iOS 真机:非静音视频的程序化 play() 必须在用户手势调用栈内。
     * 之前只 setIsPlaying,由 [isPlaying] effect 异步调 play() — 已脱离手势栈,
     * unmute 后被 NotAllowedError 拒绝且 catch 静默吞掉 → 「tap 无效」(muted 受
     * 豁免,故静音时一直正常,长期未暴露;iOS 26.5 模拟器 WebDriver 复现实锤)。
     * 改为手势栈内同步 play()/pause(),以 video.paused 为事实来源;[isPlaying]
     * effect 保留,兜底非手势路径(切视频/auto-advance),play 幂等无副作用。 */
    const ref = isSmallScreen ? mobileVideoRef.current : videoRef.current;
    if (ref) {
      const willPlay = ref.paused;
      if (willPlay) ref.play?.().catch(() => {});
      else ref.pause?.();
      setIsPlaying(willPlay);
      return;
    }
    setIsPlaying((v) => !v);
  }, [item?.id, endedIds, isSmallScreen]);
  const goPrev = useCallback(() => canPrev && setIndex((i) => i - 1), [canPrev]);
  const goNext = useCallback(() => canNext && setIndex((i) => i + 1), [canNext]);

  /* ══════════════════════════════════════════════════════════════════════
     MOBILE TOUCH HANDLERS
     ══════════════════════════════════════════════════════════════════════ */

  const handleTouchStart = useCallback((e) => {
    if (isSnapping.current) return;

    /* 若 touch 起点落在交互控件内（button/link/role=button/data-spark-passthrough），
     * 整条 gesture 流程让路给 native click — 避免 tap Like/Follow 的同时被外层
     * touchEnd 判定为 tap→togglePlay 的双重副作用。 */
    if (e.target.closest?.('button, a, [role="button"], [data-spark-passthrough]')) {
      passthrough.current = true;
      return;
    }
    /* §2026-06-10 — 评论 sheet 打开时整屏手势让路(兜底;sheet 根已有
     * data-spark-passthrough,此处防 portal/edge case 漏网)。 */
    if (mobileCommentsOpen) {
      passthrough.current = true;
      return;
    }
    passthrough.current = false;

    screenH.current = window.innerHeight;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    touchCurr.current  = { x: t.clientX, y: t.clientY };
    touchStartTime.current = Date.now();
    dragAxis.current   = null;
    dragStartTrack.current = trackY; // capture current track position
    setTrackTrans('none');           // disable transition during drag
  }, [trackY, mobileCommentsOpen]);

  const handleTouchMove = useCallback((e) => {
    if (passthrough.current) return;
    if (isSnapping.current) return;
    const t = e.touches[0];
    touchCurr.current = { x: t.clientX, y: t.clientY };

    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;

    /* Lock axis after AXIS_LOCK_PX px of movement */
    if (!dragAxis.current) {
      if (Math.abs(dx) > AXIS_LOCK_PX || Math.abs(dy) > AXIS_LOCK_PX) {
        dragAxis.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
      }
      return;
    }

    if (dragAxis.current === 'v') {
      const SH = screenH.current;
      let newY = dragStartTrack.current + dy;

      /* Rubber-band at top boundary (no prev) */
      if (newY > -SH) {
        const over = newY - (-SH);
        newY = -SH + over * (canPrev ? 1 : RUBBER_COEFF);
        if (!canPrev) newY = Math.min(newY, -SH + SH * 0.3);
      }
      /* Rubber-band at bottom boundary (no next) */
      if (newY < -SH) {
        const under = newY - (-SH);
        newY = -SH + under * (canNext ? 1 : RUBBER_COEFF);
        if (!canNext) newY = Math.max(newY, -SH - SH * 0.3);
      }
      setTrackY(newY);
    }
    /* Horizontal drag: no visual feedback needed (just detected on release) */
  }, [canPrev, canNext]);

  const handleTouchEnd = useCallback((e) => {
    if (passthrough.current) { passthrough.current = false; return; }
    if (isSnapping.current) return;

    const SH = screenH.current;
    const axis = dragAxis.current;
    dragAxis.current = null;

    /* ── Tap detection (takes precedence over swipe) ─────────────────────
     * Treat the gesture as a tap when either:
     *   (a) touch was released quickly (< TAP_MAX_MS) AND finger barely moved
     *       (< TAP_MAX_DRIFT px) — generous upper bound for fat-finger taps
     *   (b) axis was never locked AND drift stayed below the old threshold
     *       (kept as fallback so a very slow, still touch still toggles)
     * Tap always snaps the track back to current slot and toggles play. */
    const duration = Date.now() - touchStartTime.current;
    const adx = Math.abs(touchCurr.current.x - touchStart.current.x);
    const ady = Math.abs(touchCurr.current.y - touchStart.current.y);
    const fastTap  = duration < TAP_MAX_MS && adx < TAP_MAX_DRIFT && ady < TAP_MAX_DRIFT;
    const stillTap = axis === null && adx < 8 && ady < 8;
    if (fastTap || stillTap) {
      /* Snap the track back to the current slot in case a short vertical
       * drag was in progress (axis locked to 'v' but within TAP_MAX_DRIFT). */
      if (trackY !== -SH) {
        setTrackTrans(SNAP_EASING);
        setTrackY(-SH);
      }
      togglePlay();
      lastTouchEndTs.current = Date.now();
      /* §2026-06-11 — 杀掉 iOS 合成 click:tap 已在 touchend 处理,preventDefault
       * 按规范阻止 mouse 兼容事件(含 click)。否则 iPhone 11 等慢设备上合成
       * click 可晚于 onClick fallback 的 800ms 抑制窗 → 二次 togglePlay 把状态
       * 翻回 →「播放 CTA 闪现后消失,无限重现」(每次 tap 双触发)。 */
      e?.preventDefault?.();
      return;
    }
    lastTouchEndTs.current = Date.now();

    if (axis === 'h') {
      const dx = touchCurr.current.x - touchStart.current.x;
      const dy = Math.abs(touchCurr.current.y - touchStart.current.y);
      /* Only trigger if horizontal is dominant and left-swipe */
      if (dx < -H_THRESHOLD && Math.abs(dx) > dy) {
        onAuthorProfile?.(item);
      }
      return;
    }

    if (axis === 'v') {
      const delta = trackY - dragStartTrack.current;
      /* Flick 速度判定：总位移 / 总时长 ≥ V_FLICK_VELOCITY → 快滑，与 iOS scroll 体感一致
       * 两种 commit 条件任一命中就翻页：
       *   (a) 位移 ≥ 18% 屏高（慢拖但走得远）
       *   (b) flick velocity ≥ 0.5 px/ms 且位移 ≥ 20px（快甩） */
      const velocity = duration > 0 ? Math.abs(delta) / duration : 0;
      const isFlick  = velocity >= V_FLICK_VELOCITY && Math.abs(delta) >= V_FLICK_MIN_DRIFT;

      const wantsNext  = (delta < -(SH * V_THRESHOLD_RATIO) || (isFlick && delta < 0));
      const wantsPrev  = (delta >   SH * V_THRESHOLD_RATIO  || (isFlick && delta > 0));
      const commitNext = wantsNext && canNext;
      const commitPrev = wantsPrev && canPrev;
      /* §2026-05-23 fei: user tried to swipe past end → surface the
         "all caught up" overlay. Reset on next index change. */
      if (wantsNext && !canNext) setTriedEndSwipe(true);

      /* §2026-05-23 fei: iOS Safari unmuted-autoplay fix.
       *   Safari rejects v.play() with NotAllowedError if it's called
       *   outside a user-gesture handler chain AND the video isn't muted.
       *   Our snap-to-next/prev defers setIndex by 330ms (snap animation),
       *   so by the time React re-renders + UnifiedVideoPlayer's autoPlay
       *   useEffect calls play(), the user-gesture context is GONE.
       *   Symptom user reported: "有时候视频不会自动播放，需要点击屏幕才可以继续".
       *
       *   Fix: pre-play the target slot's <video> RIGHT NOW, synchronously
       *   inside this touch event handler. iOS captures the user-gesture
       *   token at call time. The play promise may resolve later (when the
       *   video has enough data), but the gesture authorization persists.
       *
       *   After the 330ms snap completes and React re-renders, that <video>
       *   element is reconciled into slot[1] (active) — same DOM node,
       *   still playing. UnifiedVideoPlayer's useEffect then calls play()
       *   again, which is a no-op since it's already playing. */
      if (containerRef.current) {
        const targetPos = commitNext ? 2 : commitPrev ? 0 : null;
        if (targetPos != null) {
          const v = containerRef.current.querySelector(
            `[data-slot-pos="${targetPos}"] video`
          );
          if (v) {
            try { v.play()?.catch(() => {}); } catch {}
          }
        }
      }

      if (commitNext) {
        /* ─ Snap to NEXT ─ */
        isSnapping.current = true;
        setTrackTrans(SNAP_EASING);
        setTrackY(-2 * SH);
        setTimeout(() => {
          setIndex((i) => i + 1);
          setTrackTrans('none');
          setTrackY(-SH);
          isSnapping.current = false;
        }, 330);

      } else if (commitPrev) {
        /* ─ Snap to PREV ─ */
        isSnapping.current = true;
        setTrackTrans(SNAP_EASING);
        setTrackY(0);
        setTimeout(() => {
          setIndex((i) => i - 1);
          setTrackTrans('none');
          setTrackY(-SH);
          isSnapping.current = false;
        }, 330);

      } else {
        /* ─ Snap back ─ */
        setTrackTrans(SNAP_EASING);
        setTrackY(-SH);
      }
    }
    /* Tap handling moved to the top of this function — see fastTap/stillTap */
  }, [trackY, canPrev, canNext, item, onAuthorProfile, togglePlay]);

  const handleTouchCancel = useCallback(() => {
    if (passthrough.current) { passthrough.current = false; return; }
    if (isSnapping.current) return;
    dragAxis.current = null;
    setTrackTrans(SNAP_EASING);
    setTrackY(-screenH.current);
  }, []);

  /* commitSnap：抽出的翻页动画（给 wheel handler 复用，touch 路径里仍就地
   * inline 不变，避免节外生枝） */
  const commitSnap = useCallback((direction) => {
    if (isSnapping.current) return;
    if (direction > 0 && !canNext) return;
    if (direction < 0 && !canPrev) return;
    const SH = screenH.current;
    isSnapping.current = true;
    setTrackTrans(SNAP_EASING);
    setTrackY(direction > 0 ? -2 * SH : 0);
    setTimeout(() => {
      setIndex((i) => i + direction);
      setTrackTrans('none');
      setTrackY(-SH);
      isSnapping.current = false;
    }, 330);
  }, [canNext, canPrev]);

  /* ══════════════════════════════════════════════════════════════════════
     WHEEL HANDLER — trackpad / mouse wheel feed 切换
     ──────────────────────────────────────────────────────────────────────
     桌面浏览器 mobile emulation 下，trackpad 两指滑 / 滚轮 fire wheel 事件，
     而非 mousemove。没处理时 wheel 冒泡到上层 Segment Control 把它横向
     滚走。方案：
     1. useEffect + addEventListener 以 { passive: false } 绑定 wheel
        （React 的 onWheel 默认 passive，preventDefault 不生效）
     2. preventDefault 阻止上层 scroll
     3. deltaY 累加过阈值 → commitSnap 翻页，300ms 内不重复触发
     ══════════════════════════════════════════════════════════════════════ */
  /* commitSnap 依赖 canNext/canPrev，每翻一页就重建 → 若放在 wheel useEffect
   * 的依赖里，翻完第一页 listener 会被清理重绑，closure 里的 suppressed 从
   * true 重置为 false → 第二波 inertia wheel 又被当新手势触发第二次翻页。
   * 用 ref 保住最新 commitSnap，listener 只在挂载时绑一次。 */
  const commitSnapRef = useRef(commitSnap);
  useEffect(() => { commitSnapRef.current = commitSnap; }, [commitSnap]);

  useEffect(() => {
    if (!isSmallScreen) return;
    const el = containerRef.current;
    if (!el) return;

    /* 2026-04-28 hybrid suppression（修两类 bug）：
     *
     * Bug A (前 idle-gap 版): 桌面持续 wheel 事件密集 50-100ms 一个，idle timer
     *   不断 re-arm → suppression 永不解除 → 用户"鼠标滚动无效，需多次滚"
     * Bug B (前 fixed 400ms 版): trackpad inertia tail 超过 400ms 窗口，accum
     *   从 0 重新累积过阈值 → 一次手势触发 2 次翻页
     *
     * Hybrid 策略：
     * - SUPPRESS_MIN_MS=400  commitSnap 后至少抑制 400ms（覆盖 snap 动画 330ms）
     * - SUPPRESS_EXTEND_MS=80 期间每个 wheel event 把 suppressedUntil 推到
     *   Date.now()+80（吃 inertia 尾巴：用户停手 80ms 后才解除）
     * - SUPPRESS_MAX_MS=1200 兜底硬上限：从 commit 起最多抑制 1.2s（防止
     *   inertia 无限延长把用户锁死）
     *
     * 行为：
     * - 单次手势 → 1 次翻页（含 inertia tail 全在 suppression 内）✓
     * - 用户停手 → 80ms 后解除 → 下次手势立即翻 ✓
     * - 极长 inertia → 1.2s 后强制解除 → 用户最多等 1.2s 第二次翻 ✓
     */
    const WHEEL_THRESHOLD    = 60;
    const SUPPRESS_MIN_MS    = 400;
    const SUPPRESS_EXTEND_MS = 80;
    const SUPPRESS_MAX_MS    = 1200;
    const accumRef           = { v: 0 };
    let   suppressionStart   = 0;
    let   suppressedUntil    = 0;

    const onWheel = (e) => {
      e.preventDefault();
      if (isSnapping.current) return;

      if (Date.now() < suppressedUntil) {
        // 仍在抑制 — 延长 suppressedUntil（吃 inertia），但不超过硬上限
        const cap = suppressionStart + SUPPRESS_MAX_MS;
        suppressedUntil = Math.min(cap, Date.now() + SUPPRESS_EXTEND_MS);
        return;
      }

      accumRef.v += e.deltaY;

      if (accumRef.v > WHEEL_THRESHOLD) {
        commitSnapRef.current?.(1);
        accumRef.v = 0;
        suppressionStart = Date.now();
        suppressedUntil  = suppressionStart + SUPPRESS_MIN_MS;
      } else if (accumRef.v < -WHEEL_THRESHOLD) {
        commitSnapRef.current?.(-1);
        accumRef.v = 0;
        suppressionStart = Date.now();
        suppressedUntil  = suppressionStart + SUPPRESS_MIN_MS;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
    /* !!item：feed 首次异步加载到、empty-state 早返回切回 mobile 分支时，
     * containerRef 才挂上真实 DOM 节点 → 此时 effect 必须重跑一次才能绑 listener。
     * 用 boolean 而不是 item 本身：item 每翻一页都变，会触发 listener rebind
     * 把 suppressed 重置掉（就是我们要避免的）。 */
  }, [isSmallScreen, !!item]);

  /* ══════════════════════════════════════════════════════════════════════
     MOUSE HANDLERS — desktop DevTools mobile emulation fallback
     ──────────────────────────────────────────────────────────────────────
     React 的 onMouseMove/onMouseUp 只在元素边界内触发，鼠标拖出 div 就断流
     → handleTouchCancel 吞掉本应 commit 的滑动。解法：mousedown 时挂 document
     级 move/up listener，拖拽期间全局跟随，抬起再清理。
     ══════════════════════════════════════════════════════════════════════ */
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return; // 仅左键
    e.preventDefault();         // 阻止原生 text selection / image drag
    isMouseDown.current = true;
    handleTouchStart({
      target: e.target,
      touches: [{ clientX: e.clientX, clientY: e.clientY }],
    });

    const onMove = (ev) => {
      if (!isMouseDown.current) return;
      handleTouchMove({
        touches: [{ clientX: ev.clientX, clientY: ev.clientY }],
      });
    };
    const onUp = () => {
      if (!isMouseDown.current) return;
      isMouseDown.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handleTouchEnd();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  /* ══════════════════════════════════════════════════════════════════════
     EMPTY / LOADING STATE
     2026-05-03 Leon — 占位用 logo 居中（替代原 "No videos to play" 文案）。
     后续换成 loading 动画（spinner / 呼吸 / morphing logo 等，待设计）。
     w-full h-full（不用 flex-1）— 父 modal wrapper 是 fixed inset 0
     非 flex 容器，flex-1 在此塌缩导致垂直不居中。
     ══════════════════════════════════════════════════════════════════════ */
  if (!item) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <img
          src="/brand/uvera-logo.png"
          alt="UVERA"
          className="w-12 h-12"
          style={{
            filter: 'drop-shadow(0 8px 24px rgba(99,102,241,0.35)) drop-shadow(0 2px 8px rgba(0,0,0,0.40))',
          }}
        />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     MOBILE — TikTok-style 3-slot track
     ══════════════════════════════════════════════════════════════════════ */
  if (isSmallScreen) {
    const SH = screenH.current;
    const BOTTOM_PAD = 'calc(88px + env(safe-area-inset-bottom, 0px))';
    /* TABBAR_OFFSET = BottomTabBar 可视上边缘高度（safe + 64px）。进度条
     * bottom 设这个值 → 进度条正好坐在 BottomTabBar 上边缘 = #tag 块底部
     * 之间。沉浸态模态盖住了 BottomTabBar，但用户视觉上仍预期"进度条在
     * tabbar 之上"。 */
    const TABBAR_OFFSET = 'calc(env(safe-area-inset-bottom, 0px) + 64px)';

    /* Three feed items to render as slots: [prev, current, next] */
    const slotItems = [
      index > 0              ? feed[index - 1] : null,
      item,
      index < feed.length - 1 ? feed[index + 1] : null,
    ];

    return (
      <div
        ref={containerRef}
        className="spark-immersive"
        style={{
          /* 2026-04-27 修：SparkMode 现在是 modal wrapper（fixed inset 0）的子元素，
           * 之前用 position:fixed inset:0 嵌套 fixed → 某些 iOS 版本 viewport
           * 计算异常，video element dimension 错误，表现为切视频后全黑。
           * 改 absolute fill parent（modal wrapper 已经是 viewport-size fixed），
           * 等价于 fill viewport，但消除嵌套 fixed 的副作用。
           * 同时把 inset 改成 4 边显式声明（绕开 Tailwind v4 inset-0 calc 在
           * iOS 16.7 silent-drop，本组件用 inline style 不受影响但保持一致）。 */
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 30,
          /* 2026-04-28 Phase C: bg 由外层 modal wrapper（index.jsx）提供 #0B0E15
           * 这里去掉重复，省一次 paint。slot div 自身 bg 兜底 letterbox。 */
          overflow: 'hidden',
          touchAction: 'none',        /* let JS handle all gestures */
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          overscrollBehavior: 'contain', /* 阻 scroll chaining 到祖先 */
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onMouseDown={handleMouseDown}
        onClick={(e) => {
          /* Desktop mobile-emulation fallback — 真机 tap 后浏览器合成的 click
           * 抑制窗口。passthrough 目标（Like/Follow/Save）走 button 自己的 click。
           *
           * 2026-04-25 iPhone 16 Pro Safari bug：tap 后视频"短暂播放后自动暂停"
           * 根因：track snap 动画 320ms 期间 iOS 把合成 click 排队等动画结束才 fire，
           * 实测 600-800ms 后才到，500ms 阈值漏掉它 → click 触发第二次 togglePlay
           * 把 isPlaying 翻回去。提到 800ms 覆盖此 case；真实用户 800ms 内双击不可能。 */
          if (Date.now() - lastTouchEndTs.current < 800) return;
          if (e.target.closest?.('button, a, [role="button"], [data-spark-passthrough]')) return;
          togglePlay();
        }}
      >
        {/* ── Video track: 3 slots stacked vertically ─────────────────
         *  Normal position: translateY(-SH) shows middle slot = current.
         *  Drag shifts the whole track; snap animation settles at 0, -SH,
         *  or -2*SH then index updates + track resets to -SH instantly. */}
        <div
          style={{
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 3 * SH,
            transform: `translateY(${trackY}px)`,
            transition: trackTrans,
            willChange: 'transform',
          }}
        >
          {slotItems.map((slotItem, pos) => {
            const isActive = pos === 1;
            /* Key by feed index so React reuses DOM nodes when scrolling */
            const feedIdx = index - 1 + pos;
            return (
              <div
                key={feedIdx}
                /* §2026-05-23 fei: data-slot-pos lets handleTouchEnd find
                   the target slot's <video> element synchronously during
                   the touch handler, so play() is called with iOS Safari's
                   user-gesture token still active. See commitNext/commitPrev
                   in handleTouchEnd. */
                data-slot-pos={pos}
                /* 2026-05-17 Leon — letterbox transparent,露 Spark wrapper 自带的
                   Create dark BG (Canvas spotlight + dither + fog,见 index.jsx
                   line ~1438)。视频之外的 letterbox 空白自然继承同款 ambient。 */
                style={{ position: 'relative', height: SH, background: 'transparent', overflow: 'hidden' }}
              >
                {/* 图片条目（无 video，仅 cover）静态显示 — 多图横滑 carousel 为后续任务。
                 * 与 video 分支互斥：有 video 走下面的 CF/native branch；纯图片走此处。 */}
                {slotItem && !slotItem.video && slotItem.cover && (
                  <img
                    src={slotItem.cover}
                    alt=""
                    className="absolute inset-0 w-full h-full"
                    /* §2026-06-04 BUG-007 — 封面图按视频同款适配标准:object-contain
                     * (横屏图→适配视口宽、竖屏图→适配视口高,letterbox 留白),
                     * 而非 cover 撑满高度把横屏图裁成满屏。 */
                    style={{ objectFit: 'contain', objectPosition: 'center' }}
                    draggable={false}
                  />
                )}
                {/* §2026-05-22 fei: include prev slot (pos===0) in the pre-render.
                 *
                 *   Original policy: render active (pos=1) + next (pos=2), skip prev (pos=0)
                 *   to save bandwidth.
                 *   Bug fei reported: swipe-down (to PREVIOUS video) caused "卡在黑屏"
                 *   on iOS Safari — video element wasn't pre-mounted, so swipe forced
                 *   fresh mount + metadata fetch from scratch (~1-3s of black on iOS).
                 *
                 *   New policy: pre-render all 3 slots (prev / active / next). Non-active
                 *   slots use preload="metadata" (only ~50KB per video, just enough for
                 *   duration + first frame), so bandwidth cost is minimal compared to
                 *   the active video's full stream. Trade ~50KB per swipe-back for
                 *   smooth UX.
                 *
                 *   non-active slot: autoplay=false, muted, no handlers — browser
                 *   downloads metadata only. */}
                {slotItem && slotItem.video && (isActive || pos === 0 || pos === 2) && (() => {
                  /* §2026-05-22 fei: 双 player 时代结束。
                   *   之前 Stream URL → <Stream> iframe, 直链 mp4 → <video>,
                   *   两个 player 各有各的 lifecycle, iframe 在 iOS swipe-back
                   *   时巨慢. 现在 UnifiedVideoPlayer 把两条路都收敛到 native
                   *   <video> + (Safari native HLS / hls.js for others),
                   *   iframe 永远不出现, swipe 一致流畅. */
                  /* §2026-06-04 BUG-008 — 不再用 JS 算的 measured-AR pixel box。
                   * (旧做法曾按 measuredARs>DB aspectRatio>'9/16' 优先级算 box,因很多
                   *  老视频 DB aspectRatio 缺失/错误 → 需用实测维度纠正。)
                   * 旧做法:按实测 videoWidth/Height 算 boxW/boxH 居中。问题:Safari
                   * 原生 HLS 播放前才报维度 → box 先按 fallback AR(小/错)画、metadata
                   * 到了再变 → 切视频时"从小到大"放大 + 码率切换时尺寸抖动(Chrome 用
                   * hls.js 维度早稳,无此问题)。
                   * 新做法:视频铺满整槽 + object-contain → 浏览器按视频 intrinsic AR
                   * letterbox,无 JS 重算 → 切视频/加载全程尺寸稳定,Chrome/Safari 统一。 */
                  const boxStyle = {
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  };

                  return (
                    <>
                      <UnifiedVideoPlayer
                        ref={isActive ? mobileVideoRef : undefined}
                        src={slotItem.video}
                        poster={slotItem.cover}
                        /* §2026-06-04 BUG-007 — 传 object-contain 让 UnifiedVideoPlayer
                         * 的海报背景层(styleWithPosterBg / 模糊封面层)用
                         * backgroundSize:'contain' 而非默认 'cover',横屏视频的
                         * letterbox 带不再被模糊放大的海报填满,保持干净适配。 */
                        className="object-contain"
                        showLoadingOverlay={isActive}
                        playsInline
                        autoPlay={isActive && isPlaying}
                        muted={isActive ? isMuted : true}
                        /* §2026-05-30 round-106 增量C — loop 由 🔁 Repeat 控制
                           (repeatMode 'one' = loop self);series 不循环。 */
                        loop={isActive && repeatMode === 'one' && deriveContentType(slotItem) !== 'series'}
                        /* §2026-05-27 fei — quality picker only on the
                           active slot. prev/next slots are pre-buffered
                           previews; showing a pill there would visually
                           clutter the swipe feed. */
                        showQualitySelector={isActive}
                        /* §2026-05-23 fei: aggressive pre-buffer for next slot.
                           Active (pos=1) gets 'auto' (full buffer).
                           Next   (pos=2) gets 'auto' too — by the time the
                             user swipes down, the actual first .ts segment
                             is already in the browser buffer, not just the
                             m3u8 manifest. play() starts decoding immediately
                             instead of round-tripping for segments first.
                           Prev   (pos=0) stays 'metadata' — less likely to
                             be swiped to, save the bandwidth. */
                        preload={(isActive || pos === 2) ? 'auto' : 'metadata'}
                        style={boxStyle}
                        onEnded={isActive ? handleEnded : undefined}
                        onLoadedMetadata={(e) => {
                          // §2026-06-04 — 不再 recordMeasuredAR(已废弃 JS box,改 object-contain
                          // 让浏览器按 intrinsic AR letterbox)。仅 active slot 取 duration。
                          if (isActive) {
                            const d = e.currentTarget.duration;
                            if (d && isFinite(d)) setDuration(d);
                          }
                        }}
                        onTimeUpdate={isActive ? ((t) => handleUnifiedTimeUpdate(t, mobileVideoRef)) : undefined}
                        /* §2026-05-23 fei: sync React isMuted ↔ actual video.muted.
                           UnifiedVideoPlayer's iOS-autoplay fallback flips
                           v.muted = true when play() rejects on unmuted (no
                           user gesture). Without sync, React state still says
                           muted=false → UI shows "unmuted" → user taps the
                           toggle → React flips muted=true (in line with
                           reality) → UI updates → user taps AGAIN to actually
                           unmute. This sync makes the FIRST tap do the real
                           unmute. Only attach for active so non-active fallback
                           mutes don't bubble back to global isMuted. */
                        onVolumeChange={isActive ? ((e) => {
                          const actual = e.currentTarget.muted;
                          if (actual !== isMuted && typeof setIsMuted === 'function') {
                            setIsMuted(actual);
                          }
                        }) : undefined}
                      />
                      {/* Prefetched branch (hidden) — uses UnifiedVideoPlayer too.
                          Metadata-only preload so it doesn't fight active for bandwidth. */}
                      {isActive && prefetchedBranch && prefetchedBranch.parentId === slotItem.id && prefetchedBranch.branch.video && (
                        <div style={{ display: 'none' }}>
                          <UnifiedVideoPlayer
                            src={prefetchedBranch.branch.video}
                            preload="metadata"
                            muted
                          />
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* ── Gradient vignette (over track, not affected by drag) ─────── */}
        <div
          aria-hidden
          style={{
            position: 'absolute', inset: 0, zIndex: 1,
            background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.18) 30%, transparent 55%)',
            pointerEvents: 'none',
          }}
        />

        {/* §2026-05-23 fei: "All caught up" overlay — appears when user
         *   tries to swipe past the last item in the feed. Surfaces a
         *   refresh action (re-fetch source content from parent) + a
         *   shortcut back to the top so the user isn't trapped. */}
        {triedEndSwipe && !canNext && (
          <div
            data-spark-passthrough
            style={{
              position: 'absolute', inset: 0, zIndex: 4,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 16, padding: 24,
              background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(14px)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 4 }}>🎉</div>
            <div style={{ color: 'white', fontSize: 18, fontWeight: 600, textAlign: 'center' }}>
              已看完所有视频
            </div>
            <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
              You've watched everything in this feed. Refresh to pull the latest, or jump back to the top.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
              {typeof onRefreshFeed === 'function' && (
                <button
                  onClick={() => { onRefreshFeed(); setTriedEndSwipe(false); }}
                  style={{
                    padding: '10px 20px', borderRadius: 999,
                    background: 'white', color: 'black',
                    fontSize: 14, fontWeight: 600,
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  🔄 刷新看更多
                </button>
              )}
              <button
                onClick={() => { setIndex(0); setTriedEndSwipe(false); }}
                style={{
                  padding: '10px 20px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.12)', color: 'white',
                  fontSize: 14, fontWeight: 500,
                  border: '1px solid rgba(255,255,255,0.2)',
                  backdropFilter: 'blur(8px)', cursor: 'pointer',
                }}
              >
                ⬆ 返回顶部
              </button>
            </div>
          </div>
        )}

        {/* ── Play / Pause center indicator（ended 态让位给「重播/接龙」） */}
        {!isPlaying && !endedIds.has(item?.id) && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'rgba(0,0,0,0.52)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Play size={28} weight="fill" style={{ color: 'white', marginLeft: 2 }} />
            </div>
          </div>
        )}

        {/* §2026-05-29 Leon round-105 — End-of-playback Branch CTA + social proof 删除
          * (拍摄分支暂停)。只保留 Replay button。 */}
        {endedIds.has(item?.id) && (
          <div
            data-spark-passthrough
            style={{
              position: 'absolute', inset: 0, zIndex: 3,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
              pointerEvents: 'none',
            }}
          >
            <VideoReplayButton onClick={togglePlay} style={{ pointerEvents: 'auto' }} />
          </div>
        )}

        {/* ── Overlay UI ────────────────────────────────────────────────
         *   状态机（mobile fullscreen 行为 — 2026-04-25 设计）:
         *     非 fullscreen          → 全部 chrome 可见
         *     fullscreen + playing   → 全部 chrome 隐藏（沉浸态）
         *     fullscreen + paused    → Header / Sound+Full / 视频控件 panel 显示
         *
         *   chromeVisible = !isFullscreen || !isPlaying（驱动 Sound+Full 簇）
         *   Header / BottomTabBar 通过 onChromeVisibleChange 上报 index.jsx 切显隐
         *
         *   right action column 双簇：
         *     - 上簇 social actions — fullscreen 下 visibility:hidden（保列宽）
         *     - 下簇 media chrome (Sound + Full) — 跟随 chromeVisible 切显隐
         *   底部 video controls panel — fullscreen + paused 才出现 */}
        <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
          {!isFullscreen && (
            <>
              {/* ─ Top-right: More menu — §2026-06-08 Leon ──────────────── */}
              <div style={{
                position: 'absolute',
                top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                right: 12,
                pointerEvents: 'auto',
              }}>
                <GlassButton
                  onClick={() => onMore?.(item)}
                  aria-label="More"
                  variant="prominent"
                  size="regular"
                >
                  <DotsThree size={24} weight="bold" style={{ color: 'rgba(255,255,255,0.85)' }} />
                </GlassButton>
              </div>

              {/* ─ Bottom-left: author + title + tags ──────────────────── */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 72,
                paddingLeft: 16, paddingRight: 8,
                paddingBottom: BOTTOM_PAD,
                pointerEvents: 'auto',
                userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
              }}>
                {/* Author row — 2026-05-08 Leon: avatar + name 包成 button
                 *   onClick → onUserProfile(artistId) (与 desktop 右栏一致)。
                 *   item.artistId (UUID) 不存在则 button disabled — legacy
                 *   字符串作者无 FK 链路。Tap 只在 button 区域响应；视频外
                 *   layer 的 tap-to-pause 由 button stopPropagation 隔离。
                 *   左滑手势单独由 video container handleTouchEnd 处理 (line ~795)。 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.artistId) onUserProfile?.(item.artistId);
                    }}
                    disabled={!item.artistId || !onUserProfile}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'transparent', border: 'none', padding: 0,
                      cursor: item.artistId && onUserProfile ? 'pointer' : 'default',
                      flexShrink: 0,
                    }}
                    aria-label={`View ${item.artist ?? 'creator'} profile`}
                  >
                    <AuthorAvatar url={item.artistAvatarUrl} name={item.artist} className="w-9 h-9" iconSize={22} />
                    <span style={{
                      color: 'rgba(255,255,255,0.92)', fontSize: 14, fontWeight: 600,
                      flexShrink: 0, maxWidth: 130,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {item.artist ?? 'Creator'}
                    </span>
                  </button>
                  {/* 2026-05-06 Leon — Follow 持久化（同 desktop right pane）。
                      2026-05-14 Leon — 自己作品不渲染 Follow 按钮 (self-follow 防呆)。 */}
                  {(() => {
                    const isOwnWork = !!(currentUserId && item.artistId === currentUserId);
                    if (isOwnWork) return null;
                    const isFollowing = item.artistId && followingUsers?.has(item.artistId);
                    const canFollow = !!(item.artistId && onToggleFollow);
                    return (
                      <button
                        onClick={() => canFollow && onToggleFollow(item.artistId)}
                        disabled={!canFollow}
                        style={{
                          height: 24, padding: '0 10px', borderRadius: 12,
                          background: 'transparent',
                          border: `1.5px solid ${isFollowing ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.95)'}`,
                          color: 'white',
                          fontSize: 12, fontWeight: 600,
                          cursor: canFollow ? 'pointer' : 'default',
                          opacity: canFollow ? 1 : 0.5,
                          flexShrink: 0,
                        }}
                      >
                        {isFollowing ? 'Following' : '+ Follow'}
                      </button>
                    );
                  })()}
                </div>

                {/* Title */}
                <p style={{ color: 'white', fontSize: 15, fontWeight: 600, marginBottom: 6, lineHeight: 1.35 }}>
                  {item.title}
                </p>

                {/* Tags — hint: swipe ← for author profile */}
                {itemTags.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    {itemTags.map((tag) => (
                      <span key={tag} style={{ color: 'rgba(255,255,255,0.70)', fontSize: 13, fontWeight: 500 }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Swipe-up hint 已移除 (Leon 2026-04-28) — 用户已熟悉 TikTok 风
               * 上滑下一条手势，提示反而成视觉噪音。 */}
            </>
          )}

          {/* ─ Right action column（常驻：保证 Exit 中心 = Full 中心） ─── */}
          <div style={{
            position: 'absolute', right: 12, bottom: 0,
            paddingBottom: BOTTOM_PAD,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
            pointerEvents: 'auto',
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          }}>
            {/* Social actions cluster — fullscreen 下 visibility:hidden 保住列宽 */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
              visibility: isFullscreen ? 'hidden' : 'visible',
            }}>
              {/* §2026-06-08 Leon — action row 顺序:Save → Comment → Like → Share */}
              <MobileActionBtn
                onClick={() => toggleSave?.(item.id)}
                icon={<BookmarkSimple size={26} weight={isSaved ? 'fill' : 'regular'} style={{ color: isSaved ? '#fbbf24' : 'white' }} />}
                label={item.savesCount > 0 ? formatCompactNumber(item.savesCount) : (isSaved ? 'Saved' : 'Save')}
              />
              <MobileActionBtn
                /* §2026-06-10 — Comment 按钮:打开移动端评论 sheet(接真实数据)。 */
                onClick={() => setMobileCommentsOpen(true)}
                icon={<ChatCircle size={27} weight="regular" style={{ color: 'white' }} />}
                label={liveCommentsCount > 0 ? formatCompactNumber(liveCommentsCount) : 'Comment'}
              />
              <MobileActionBtn
                onClick={() => toggleLike?.(item.id)}
                icon={<Heart size={28} weight={isLiked ? 'fill' : 'regular'} style={{ color: isLiked ? '#ff4d4f' : 'white' }} />}
                label={item.likesCount > 0 ? formatCompactNumber(item.likesCount) : (isLiked ? 'Liked' : 'Like')}
              />
              <MobileActionBtn
                icon={<ShareFat size={26} weight="regular" style={{ color: 'white' }} />}
                label="Share"
              />
              {/* §2026-05-29 Leon round-105 — Mobile Recast button 删除 (Recast 取消) */}
            </div>
            {/* Media chrome cluster (Sound + Full) — fullscreen + playing 时隐藏（同
             * 沉浸态规则）；fullscreen + paused / 非 fullscreen 时可见。 */}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
              visibility: chromeVisible ? 'visible' : 'hidden',
            }}>
              <MobileActionBtn
                onClick={() => setIsMuted?.(!isMuted)}
                icon={
                  isMuted
                    ? <SpeakerSlash size={26} weight="fill" style={{ color: 'white' }} />
                    : <SpeakerHigh  size={26} weight="fill" style={{ color: 'white' }} />
                }
                label={isMuted ? 'Muted' : 'Sound'}
              />
              <MobileActionBtn
                onClick={() => setIsFullscreen((v) => !v)}
                icon={
                  isFullscreen
                    ? <CornersIn  size={22} weight="bold" style={{ color: 'white' }} />
                    : <CornersOut size={22} weight="bold" style={{ color: 'white' }} />
                }
                label={isFullscreen ? 'Exit' : 'Full'}
              />
            </div>
          </div>

          {/* ─ Standalone progress bar — 任何 paused 状态都显示，横贯视频宽度
           *   2026-04-27 Leon 调整：从 fullscreen-only panel 中抽出来独立。
           *   bottom = TABBAR_OFFSET（坐在 BottomTabBar 上边缘 = #tag 块底部之间）。
           *   hit area 32px（HIG 触控目标 ≥ 32px，舒适 scrub）。
           *   visual 3px 细线（scrub 时 5px），垂直居中在 hit area 内。
           *   data-spark-passthrough 防止外层 touchEnd 把 scrub 误判为 togglePlay。 */}
          {!isPlaying && item && (
            <div
              data-spark-passthrough
              ref={progressBarRef}
              onPointerDown={handleScrubStart}
              onPointerMove={handleScrubMove}
              onPointerUp={handleScrubEnd}
              onPointerCancel={handleScrubEnd}
              style={{
                position: 'absolute',
                left: 0, right: 0,
                bottom: TABBAR_OFFSET,
                height: 32,
                cursor: 'pointer',
                touchAction: 'none',
                pointerEvents: 'auto',
                zIndex: 4,
              }}
            >
              <div style={{
                position: 'absolute', top: '50%', left: 0, right: 0,
                height: isScrubbing ? 5 : 3,
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.25)',
                borderRadius: 3,
                transition: 'height 0.12s ease-out',
              }}>
                <div style={{
                  height: '100%',
                  width: duration > 0 ? `${Math.min(100, (currentTime / duration) * 100)}%` : '0%',
                  background: 'rgba(255,255,255,0.95)',
                  borderRadius: 3,
                  transition: isScrubbing ? 'none' : 'width 0.2s linear',
                }} />
              </div>
              {duration > 0 && (
                <div style={{
                  position: 'absolute', top: '50%',
                  left: `${Math.min(100, (currentTime / duration) * 100)}%`,
                  transform: `translate(-50%, -50%) scale(${isScrubbing ? 1 : 0})`,
                  width: 14, height: 14, borderRadius: '50%',
                  background: 'white',
                  pointerEvents: 'none',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                  transition: 'transform 0.12s ease-out',
                }} />
              )}
            </div>
          )}

          {/* ─ Fullscreen + paused video controls panel ─────────────────────
           * fullscreen + 暂停时出现：title + time / duration + 倍速 + 横屏 hint。
           * 进度条已抽到上方 standalone（任何 paused 都显），此处不再含进度条。
           * data-spark-passthrough 让 touchEnd 不把 panel 内 tap 误判为 togglePlay。 */}
          {isFullscreen && !isPlaying && item && (
            <div
              data-spark-passthrough
              style={{
                position: 'absolute',
                /* bottom 抬到 progress bar 之上（TABBAR_OFFSET + 32 hit area + 8px 间距）*/
                bottom: `calc(${TABBAR_OFFSET} + 40px)`,
                left: 0, right: 80,
                paddingLeft: 16, paddingRight: 8,
                paddingTop: 32,
                paddingBottom: 12,
                pointerEvents: 'auto',
                background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.4) 60%, transparent 100%)',
                zIndex: 3,
              }}
            >
              <p style={{
                color: 'white', fontSize: 15, fontWeight: 600,
                marginBottom: 10, lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {item.title}
              </p>

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{
                  color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: 500,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatVideoTime(currentTime)} / {formatVideoTime(duration)}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button
                    onClick={cyclePlaybackRate}
                    style={{
                      height: 28, padding: '0 12px', borderRadius: 14,
                      background: 'rgba(255,255,255,0.16)',
                      border: '1px solid rgba(255,255,255,0.30)',
                      color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                    aria-label={`Playback speed ${playbackRate}x`}
                  >
                    {playbackRate}x
                  </button>
                  {(() => {
                    const ar = item.aspectRatio || '9/16';
                    const [w, h] = ar.split('/').map(Number);
                    if (!(w > h)) return null;
                    return (
                      <button
                        onClick={async () => {
                          // 尝试 browser fullscreen + orientation lock。iOS Safari
                          // 不支持，静默失败 — icon 仍作为视觉提示让用户手动横屏。
                          try {
                            const el = document.documentElement;
                            if (el.requestFullscreen) await el.requestFullscreen();
                            if (screen.orientation?.lock) {
                              await screen.orientation.lock('landscape').catch(() => {});
                            }
                          } catch { /* graceful */ }
                        }}
                        style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: 'rgba(255,255,255,0.16)',
                          border: '1px solid rgba(255,255,255,0.30)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                        aria-label="Rotate to landscape"
                      >
                        <DeviceRotate size={16} weight="bold" style={{ color: 'white' }} />
                      </button>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Mobile 评论 sheet ──────────────────────────────────────────────
         * 2026-06-10 修:此前被误放进 desktop return,而 mobile 在上方提前 return
         * → 永远渲染不到 → Comment 点击无效。移回 mobile 分支内,守卫去掉冗余
         * isSmallScreen(本就在 isSmallScreen 分支里)。复用 useComments + CommentList。 */}
        {mobileCommentsOpen && item && (
          /* data-spark-passthrough:sheet 在手势容器内,触摸起点落在 sheet 任意
           * 位置(遮罩/列表/输入框)都必须让外层 tap→togglePlay / swipe 换视频
           * 手势机让路 —— 否则点遮罩关面板会误切播放、滚评论会拖动视频轨。 */
          <div data-spark-passthrough className="absolute inset-0 z-[120] flex flex-col justify-end" role="dialog" aria-modal="true">
            {/* backdrop */}
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileCommentsOpen(false)}
            />
            {/* sheet */}
            <div className="relative w-full max-h-[72%] flex flex-col rounded-t-2xl bg-vision-bg-elevated backdrop-blur-2xl border-t border-white/10 animate-slide-up"
                 style={{ background: 'rgba(28,28,30,0.92)' }}>
              {/* grabber + header */}
              <div className="flex-shrink-0 pt-2.5 px-4 pb-2 border-b border-white/10">
                <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-white/25" />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">
                    Comments · {formatCompactNumber(liveCommentsCount)}
                  </p>
                  <button
                    onClick={() => setMobileCommentsOpen(false)}
                    className="text-white/60 hover:text-white text-sm cursor-pointer px-2"
                    aria-label="Close comments"
                  >
                    Done
                  </button>
                </div>
              </div>
              {/* list */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                <CommentList
                  comments={commentsApi.comments}
                  loading={commentsApi.loading}
                  error={commentsApi.error}
                  total={commentsApi.total}
                  currentUserId={currentUserId}
                  ownerId={item.artistId}
                  onUserProfile={onUserProfile}
                  posting={commentsApi.posting}
                  onLike={(c) => commentsApi.like(c.id, c.liked)}
                  onDelete={(c) => commentsApi.remove(c.id)}
                  onReply={(body, parentId, replyToAuthorId, mentions) => commentsApi.post(body, parentId, replyToAuthorId, mentions)}
                />
              </div>
              {/* composer */}
              <div className="flex-shrink-0 px-3 py-2.5 border-t border-white/10"
                   style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}>
                {currentUserId ? (
                  <CommentComposer
                    busy={commentsApi.posting}
                    placeholder="Say something..."
                    onSubmit={async (body, mentions) => { await commentsApi.post(body, null, null, mentions); }}
                  />
                ) : (
                  <p className="text-center text-white/50 text-sm py-2">登录后参与评论</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     DESKTOP — 视频填左侧剩余空间 + 440px 右信息栏（2026-04-28 Leon 调整）
     ══════════════════════════════════════════════════════════════════════
     之前：6:4 flex split + getMainPaddingLeft 给 sidebar 让位。
     现在：modal 已覆盖 sidebar，无需让位 → 移除 padding-left；右栏固定
     440px；左侧 flex-1 fill viewport，video object-contain 适配 AR
     letterbox。 */
  return (
    /* h-full + w-full：父级（modal wrapper）是 fixed inset 0 viewport-size，
     * 子元素拿 100% 显式撑开。p-8 = 32 四边留白。
     * 旧的 flex-1 min-h-0 是 SparkMode 还在 main flex 里时的写法，modal 包了
     * 之后那俩 class 失效 — 故改 h-full w-full。 */
    <div className="h-full w-full overflow-hidden p-8">
      <div className="h-full w-full flex gap-8">
        {/* ── Left: Video pane (fills remaining width, AR-fitted) ──────
         * videoPaneRef 用于 requestFullscreen(); browser 进入 fullscreen
         * 时只有这个 div 独占屏幕，info pane 在 fullscreen 状态下隐藏。 */}
        <div
          ref={videoPaneRef}
          onMouseMove={showControlsBriefly}
          className="flex-1 min-w-0 relative overflow-hidden bg-black"
          style={{
            // A1 (2026-04-29) — Desktop visionOS 风 video container frame:
            // 圆角 + 极淡 specular border 营造漂浮感。
            // 2026-05-06 Leon — #4 黑色 ambient shadow 在 dark bg 上不可见
            // 移除（节约 GPU compositing），specular border 单层支持 lift 信号
            // 已足够。如果后续视觉太平，加回 indigo accent halo: '0 4px 40px
            // rgba(99,102,241,0.10)'（与 brand accent + modal halo 同色系）。
            // fullscreen 状态下 border 也归零，避免全屏视图出现内嵌矩形边框。
            // 2026-05-19 round-49 (Leon) — radius 20 → 32 (--radius-glass token,
            // visionOS hero glass 同档,跟右 pane GlassPane radius={32} 一致)。
            borderRadius: isBrowserFullscreen ? 0 : 32,
            border: isBrowserFullscreen ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {(() => {
            /* 图片条目（无 video）静态显示；多图 carousel 为后续任务。 */
            if (!item.video && item.cover) {
              return (
                <img
                  src={item.cover}
                  alt=""
                  className="absolute inset-0 w-full h-full"
                  style={{ objectFit: 'contain' }}
                  draggable={false}
                />
              );
            }
            if (!item.video) return null;
            /* §2026-05-22 fei: desktop branch unified — single
             *   UnifiedVideoPlayer handles both Stream + direct URLs.
             *   onClick wraps the video itself for togglePlay binding. */
            return (
              <>
                {/* §2026-05-30 round-106 path A — 去 wrapper onClick={togglePlay}:
                    customControls 下 PlayerActionBar(round-93)已自带 video click→
                    togglePlay,重复绑会双触发 → 点击不能暂停。中心 Play hero 仍管暂停态。 */}
                <div className="absolute inset-0 z-0">
                  <UnifiedVideoPlayer
                    ref={videoRef}
                    src={item.video}
                    poster={item.cover}
                    showLoadingOverlay
                    playsInline
                    autoPlay={isPlaying}
                    muted={isMuted}
                    /* §2026-05-30 round-106 path A — desktop 改用 PlayerActionBar
                       (customControls 内部渲染,跟 Admin/SeriesDetail 一致)。
                       自带 progress/volume/resolution(videoHeight)/speed/download/
                       PiP/fullscreen + transport 簇。删 SparkMode 自定义 bar。
                       loop 初值给 short-feed;PlayerActionBar 内 🔁 接管 video.loop。 */
                    loop={deriveContentType(item) !== 'series'}
                    preload="auto"
                    customControls
                    onPrev={canPrev ? goPrev : undefined}
                    onNext={canNext ? goNext : undefined}
                    autoplay={autoPlayEnabled}
                    onAutoplayChange={setAutoPlayEnabled}
                    className="absolute inset-0 w-full h-full object-contain"
                    onEnded={handleEnded}
                    onTimeUpdate={(t) => handleUnifiedTimeUpdate(t, videoRef)}
                    /* §2026-05-23 fei: sync isMuted with actual video.muted —
                       see mobile branch for the why. */
                    onVolumeChange={(e) => {
                      const actual = e.currentTarget.muted;
                      if (actual !== isMuted && typeof setIsMuted === 'function') {
                        setIsMuted(actual);
                      }
                    }}
                  />
                </div>
                {/* Prefetched branch (hidden, metadata-only) — unified too. */}
                {prefetchedBranch && prefetchedBranch.parentId === item.id && prefetchedBranch.branch.video && (
                  <div style={{ display: 'none' }}>
                    <UnifiedVideoPlayer
                      src={prefetchedBranch.branch.video}
                      preload="metadata"
                      muted
                    />
                  </div>
                )}
              </>
            );
          })()}

          {/* Desktop close button — CaretLeft 在视频 pane 左上角。
           * 2026-04-29 Leon：与 prev/next + 控件 bar 同步绑 showControls，
           * 一起 fade（playing 2s 无操作）。
           * 2026-05-03 Leon — Tier Q2: Close 用 T-1a (.glass-frosted-edge)。
           * 2026-05-14 Leon — 统一返回 icon SquaresFour → CaretLeft (甲方
           * 反馈 SquaresFour 网格图不像返回,与 Apple Photos 隐喻太隐晦)。
           * 所有 back 按钮统一 CaretLeft,见 UserProfilePage / Library /
           * SettingsPage 等同步替换。 */}
          {onBack && (
            <OverlayCtrlBtn
              onClick={onBack}
              ariaLabel="Close Spark"
              className="absolute top-4 left-4 z-10 w-10 h-10 rounded-full"
              style={{
                opacity: showControls ? 1 : 0,
                pointerEvents: showControls ? 'auto' : 'none',
                transition: 'opacity 0.2s ease, transform 0.2s ease',
              }}
            >
              <CaretLeft size={20} weight="bold" className="text-white" />
            </OverlayCtrlBtn>
          )}

          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-40 pointer-events-none"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}
          />

          {!isPlaying && !endedIds.has(item?.id) && (
            <button
              onClick={togglePlay}
              className="absolute inset-0 flex items-center justify-center cursor-pointer"
              aria-label="Play"
            >
              {/* T0 hero — .glass-hero utility (Phase 1 refactor 2026-05-06).
               * Spec 详见 glass.css + decision doc 2026-05-03-liquid-glass-
               * fidelity-deferral.md (4-layer bg + 5-shadow recipe).
               * (doc filename keeps "liquid-glass" — that doc is about
               * npm pkg `liquid-glass-react` T3 path; separate from our
               * CSS classes which were renamed to `.glass-*` 2026-05-18.) */}
              <div className="glass-hero w-20 h-20 rounded-full flex items-center justify-center">
                <Play size={32} weight="fill" className="text-white ml-[3px]" />
              </div>
            </button>
          )}

          {/* §2026-05-29 Leon round-105 — End-of-playback Branch CTA + proof 删除
            * (拍摄分支暂停)。只保留 Replay button。 */}
          {endedIds.has(item?.id) && (
            <div
              className="absolute inset-0 flex items-center justify-center z-10"
              style={{ pointerEvents: 'none' }}
            >
              <VideoReplayButton onClick={togglePlay} style={{ pointerEvents: 'auto' }} />
            </div>
          )}

          {/* Prev/Next 切换 — 上下两个按钮叠在视频右侧（2026-04-29 Leon 调整）。
           * 因 SparkMode feed 是垂直 navigation（上=prev、下=next 心智匹配），
           * 改 CaretUp / CaretDown 图标 + flex-col 容器右侧 vertically 居中。
           * 显隐：同 control bar 的 showControls — paused 持续显，playing 3s
           * 无操作 fade，鼠标移动重置 timer。两者绑同一 state，未来改 timing
           * 只动 useEffect (line ~150) 一处自动同步。 */}
          {/* 2026-05-03 Leon — Tier Q2 A/B 测试结论：Prev + Next 统一 T-1a
           * (.glass-frosted-edge) — frosted with edge 在 floating ctrl 角色
           * 上读起来更像"按钮"，T-1b 无边版暂无 SparkMode 应用（class 留作
           * 未来 panel-tier 复用）。形状保持 horizontal capsule (64×40)。 */}
          {/* §2026-05-30 round-106 path A — 竖排 prev/next 侧胶囊按钮删除:
              desktop 已改用 PlayerActionBar,其 ⏮⏭ transport 接管 feed 换条,
              侧按钮冗余。(mobile swipe 手势换条不受影响) */}

          {/* ── Control overlay (2026-04-28 Phase 1) ─────────────────────────
           * AppleTV 风 layout：current LEFT / progress 中间 / total RIGHT
           * 视觉：.glass-frosted-no-edge-light utility class (Figma spec
           * Fill #fff 10% + Background Blur Uniform 92). 锚视频底部，
           * 仍无 border / inset / 外阴影 — 简洁不抢戏。
           * 显隐：paused 持续显；playing 3s 无操作 fade；鼠标移动重置 timer。 */}
        </div>

        {/* ── Right: Info / Actions pane (440 wide, Figma node 139:23912) ──
         * 2026-05-19 round-32 (Leon) — refactor:抽 <GlassPane> React wrapper
         * 复用 .glass-pane-container utility + SVG stroke overlay。组件内部
         * 自带 4 层 stack(drop shadow + blur ::before + fill+luminosity
         * ::after + SVG 157deg/4-stop stroke + content wrapper z-[3])。
         * Stroke 视觉 1.4px (Figma authoritative, visual-verified 1.4 vs 1.0
         * 实测无明显视觉差,保留 1.4 跟 Figma 一致)。
         * 三段式 layout(XHS 风格):
         *   [Header sticky 顶]   Avatar + Username + Follow
         *   [Scroll 中段]        Title + 时间 + Tags + Comments
         *   [Bottom sticky 底]   Comment input + Like/Save/Share counts
         * Comments 真实功能(schema/API/RLS)Phase 2 高危需费对齐 — 当前
         * 仅 UI shell + empty state placeholder。 */}
        <GlassPane
          as="aside"
          className="flex-shrink-0 flex flex-col"
          style={{ width: 440 }}
          radius={32}
        >

            {/* ── Header (sticky 顶) ─────────────────────────────────── */}
            <div className="flex-shrink-0 px-6 pt-5 pb-3">
              <div className="flex items-center gap-3">
                {/* 2026-05-06 Leon — Avatar + Username 可点击跳 user profile
                 * (/u/:userId)。仅当 item.artistId (UUID) 存在时生效；legacy
                 * 字符串作者无 profile 链路 → button 但 onClick noop。
                 * UserProfilePage 实际页面由 Session 3 (scope-3-profile.md)
                 * 后续实现 — 当前路由会 fallback 到 IndexPage discover。 */}
                <button
                  onClick={() => item.artistId && onUserProfile?.(item.artistId)}
                  disabled={!item.artistId || !onUserProfile}
                  className="flex items-center gap-3 flex-1 min-w-0 group cursor-pointer disabled:cursor-default text-left"
                  type="button"
                  aria-label={`View ${item.artist ?? 'creator'} profile`}
                >
                  <AuthorAvatar url={item.artistAvatarUrl} name={item.artist} className="w-10 h-10 group-hover:opacity-80 transition-opacity" iconSize={24} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-vision-primary truncate group-hover:underline underline-offset-2">
                      {item.artist ?? 'Anonymous Creator'}
                    </p>
                    <p className="text-xs text-vision-secondary truncate">
                      @{(item.artist ?? 'creator').toLowerCase().replace(/\s+/g, '')}
                    </p>
                  </div>
                </button>
                {/* 2026-05-06 Leon — Follow 持久化（migration 20260506_follows_table）。
                 * isFollowing 从 followingUsers Set 派生，不在本地维护。
                 * 仅当 item.artistId (UUID) 存在时按钮 enabled — legacy 字符串
                 * 作者无 auth.users FK 链路，无法 follow。
                 * 2026-05-14 Leon — 自己作品不渲染 Follow 按钮 (self-follow 防呆)。 */}
                {(() => {
                  const isOwnWork = !!(currentUserId && item.artistId === currentUserId);
                  if (isOwnWork) return null;
                  const isFollowing = item.artistId && followingUsers?.has(item.artistId);
                  const canFollow = !!(item.artistId && onToggleFollow);
                  return (
                    <button
                      onClick={() => canFollow && onToggleFollow(item.artistId)}
                      disabled={!canFollow}
                      className={`h-8 px-4 rounded-full text-xs font-semibold transition-all cursor-pointer disabled:cursor-default disabled:opacity-50 ${
                        isFollowing
                          ? 'bg-white/10 text-vision-secondary'
                          : 'bg-accent text-white hover:bg-accent/90'
                      }`}
                    >
                      {isFollowing ? 'Following' : '+ Follow'}
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* ── Scrollable 中段 (title + meta + tags + comments) ───── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3">
              <h2 className="text-lg font-semibold text-vision-primary mb-1.5 leading-snug">
                {item.title}
              </h2>
              {/* Post time meta — null 时不渲染 */}
              {formatPostTime(item.publishedAt) && (
                <p className="text-xs text-vision-tertiary mb-3">
                  {formatPostTime(item.publishedAt)}
                </p>
              )}

              {itemTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-5">
                  {itemTags.map((tag) => (
                    <TagChip key={tag} tag={tag} onClick={onTagFilter} />
                  ))}
                </div>
              )}

              {/* Comments section — 真实数据(useComments / commentService) */}
              <div className="border-t border-white/8 pt-4">
                <p className="text-xs text-vision-secondary mb-4">
                  Comments · {formatCompactNumber(liveCommentsCount)}
                </p>
                <CommentList
                  comments={commentsApi.comments}
                  loading={commentsApi.loading}
                  error={commentsApi.error}
                  total={commentsApi.total}
                  currentUserId={currentUserId}
                  ownerId={item.artistId}
                  onUserProfile={onUserProfile}
                  posting={commentsApi.posting}
                  onLike={(c) => commentsApi.like(c.id, c.liked)}
                  onDelete={(c) => commentsApi.remove(c.id)}
                  onReply={(body, parentId, replyToAuthorId, mentions) => commentsApi.post(body, parentId, replyToAuthorId, mentions)}
                />
              </div>
            </div>

            {/* ── Bottom bar (sticky 底) ──────────────────────────────── */}
            <div className="flex-shrink-0 px-4 py-3 border-t border-white/10">
              {commentExpanded ? (
                <CommentComposer
                  autoFocus
                  busy={commentsApi.posting}
                  placeholder="Say something..."
                  onSubmit={async (body, mentions) => {
                    await commentsApi.post(body, null, null, mentions);
                    setCommentExpanded(false);
                  }}
                  onCancel={() => setCommentExpanded(false)}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (currentUserId) setCommentExpanded(true); }}
                    disabled={!currentUserId}
                    className="surface-sunken flex-1 min-w-0 h-9 rounded-full px-3 text-left text-sm text-vision-tertiary transition-colors cursor-pointer disabled:cursor-not-allowed"
                    type="button"
                    aria-label="Open comment editor"
                  >
                    {currentUserId ? 'Say something...' : '登录后参与评论'}
                  </button>
                  <CountActionBtn Icon={Heart} active={isLiked} activeColor="text-red-500"
                    count={item.likesCount} onClick={() => toggleLike?.(item.id)}
                    ariaLabel={isLiked ? 'Unlike' : 'Like'} />
                  <CountActionBtn Icon={BookmarkSimple} active={isSaved} activeColor="text-amber-400"
                    count={item.savesCount} onClick={() => toggleSave?.(item.id)}
                    ariaLabel={isSaved ? 'Unsave' : 'Save'} />
                  <CountActionBtn Icon={ShareFat} hasCount={false}
                    onClick={handleShare} ariaLabel="Share" />
                </div>
              )}
            </div>

        </GlassPane>
      </div>
      
      {/* Loading Branch Indicator — 2026-05-06 Leon: 改 mobile-only。
       * Desktop 改在 control bar AutoPlay-Mute 之间 inline 显示（line ~1982）。*/}
      {isLoadingBranch && isSmallScreen && (
        <div className="absolute z-[100] flex items-center gap-2 bg-black/70 backdrop-blur-md px-4 py-2.5 rounded-full border border-white/20 animate-fade-in shadow-2xl bottom-24 right-4">
          <CircleNotch size={18} className="text-white animate-spin" />
          <span className="text-white text-sm font-medium tracking-wide">下段视频加载中...</span>
        </div>
      )}

      {/* Share toast (2026-05-06) — clipboard fallback feedback when
       * navigator.share unavailable (most desktop browsers). Auto-dismiss 2s. */}
      {shareToast && (
        <div className="absolute z-[100] bottom-12 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-black/80 backdrop-blur-md text-white text-xs font-medium animate-fade-in shadow-2xl">
          {shareToast}
        </div>
      )}

    </div>
  );
}

/* DesktopActionBtn removed 2026-05-06 — Right pane bottom bar now inline
 * Like/Save/Share with horizontal counts (XHS-style). Component was used
 * only there. */

/* ── Author avatar with graceful fallback ──────────────────────────────────
 * §2026-06-08 Leon — 真机发现头像空洞:artist_avatar_url 有值但图片加载失败时,
 * 旧实现 onError 只 display:none → 留空洞。这里失败/缺失统一回退到渐变占位。
 * URL 变化(切视频)自动重置 error 态。 */
function AuthorAvatar({ url, name, className = '', iconSize = 22 }) {
  const [errored, setErrored] = useState(false);
  useEffect(() => { setErrored(false); }, [url]);
  if (url && !errored) {
    return (
      <img
        src={url}
        alt={name ?? 'avatar'}
        className={`rounded-full object-cover flex-shrink-0 bg-white/6 ${className}`}
        referrerPolicy="no-referrer"
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <div className={`rounded-full flex-shrink-0 bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center ${className}`}>
      <UserCircle size={iconSize} weight="fill" className="text-white" />
    </div>
  );
}

/* ── Mobile TikTok-style action button ─────────────────────────────────── */
function MobileActionBtn({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px',
      }}
    >
      {icon}
      {label && (
        <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: 500, lineHeight: 1 }}>
          {label}
        </span>
      )}
    </button>
  );
}

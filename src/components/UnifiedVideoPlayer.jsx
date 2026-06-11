import React, { forwardRef, useRef, useEffect, useState } from 'react';
import { isStreamUrl, extractStreamUid, streamUidToHlsUrl, canPlayHlsNatively } from '../utils/streamUrl';
import { PlayerActionBar } from '../design-system/primitives/PlayerActionBar';
import ActivityIndicator from '../design-system/primitives/ActivityIndicator';

/* §2026-05-27 fei — video quality selector helpers.
 *
 *   Maps an HLS level's `height` to a user-facing label. We use raw
 *   resolution numbers (1080p / 720p / 480p) instead of tiered Chinese
 *   labels (超清/高清/标清) because:
 *     · YouTube, Vimeo, CF Stream's own player, all major Western video
 *       platforms use raw resolution — it's the universal mental model
 *     · International users see English unambiguously
 *     · Power users can tell the actual quality at a glance
 *
 *   Auto stays the default — hls.js ABR picks the best level for the
 *   user's bandwidth in real time.
 *
 *   §2026-05-28 Leon round-97 — portrait video (uvera SparkMode 竖屏短剧
 *   大量内容) 的 ABR ladder report `level.height` = frame height 长边:
 *     · 横屏 240p tier = 426×240 → height 240 → "240p" ✓
 *     · 竖屏 240p tier = 240×426 → height 426 → "426p" ✗ (Leon 报)
 *   Fix:tier = short edge (Math.min(width, height)) — 跟 YouTube / Vimeo
 *   行业惯例一致,无论方向同 source quality 显示同 logical tier。
 *
 *   Edge cases:
 *     · Width + Height present → `${min(w,h)}p` (e.g. "1080p" / "720p" / "480p" / "240p")
 *     · Height only → `${h}p` (fallback,理论上 hls.js manifest 总有 width)
 *     · 都没 (audio-only level) → fallback to bitrate kbps string
 */
export function levelShortEdge(level) {
  const h = level?.height || 0;
  const w = level?.width || 0;
  if (w > 0 && h > 0) return Math.min(w, h);
  return h || w || 0;
}

export function labelForLevel(level) {
  const tier = levelShortEdge(level);
  if (!tier) {
    const kbps = Math.round((level?.bitrate || 0) / 1000);
    return kbps ? `${kbps}kbps` : 'Unknown';
  }
  return `${tier}p`;
}

// §2026-05-23 fei: lazy-load hls.js (~500KB).
//   Before: static `import Hls from 'hls.js'` pulled it into whatever bundle
//     this component lived in. Once Hero/MasonryGrid/SparkMode migrated
//     to UnifiedVideoPlayer (all eager-loaded by Explore page), hls.js
//     leaked into the main bundle and made it ~500KB heavier — for users
//     who'd never even open SparkMode.
//   Now: cached module-level promise, fetched on first need. Safari users
//     never download it (they use native HLS). Other browsers fetch once
//     and reuse the same import for the lifetime of the page.
let _hlsPromise = null;
function loadHls() {
  if (!_hlsPromise) {
    _hlsPromise = import('hls.js').then(m => m.default);
  }
  return _hlsPromise;
}

/**
 * UnifiedVideoPlayer — §2026-05-22 fei
 *
 * One <video> element, one rendering path, every browser.
 *
 * Background:
 *   Before this, we had TWO players coexisting:
 *     · <Stream> iframe (cloudflare-stream-react) — for CF Stream videos
 *     · native <video>  — for direct .mp4 URLs (R2, OSS, etc)
 *   Two players = two failure modes. iOS Safari swipe-back on the iframe
 *   variant caused 1-3s black screens (iframe mount cost). AI-gen videos
 *   (R2 .mp4 → native <video>) worked fine. User-uploaded (CF Stream →
 *   iframe) didn't.
 *
 *   fei 决定: 把所有视频统一迁到 CF Stream + 播放器也统一。
 *
 * Strategy (this component):
 *   ALWAYS render a native <video>. For Stream URLs:
 *     · Safari (iOS + macOS): native HLS in <video src={hls.m3u8}>
 *     · Other browsers: hls.js attaches HLS-via-MSE to the same <video>
 *   Either way, the React tree contains a single <video> element. No
 *   iframe ever. Same lifecycle, same events, same ref. iOS swipe-back
 *   stays smooth because the <video> is just a DOM element React can
 *   reconcile cleanly.
 *
 * Props passed through:
 *   src, poster, controls, autoPlay, muted, loop, playsInline, preload,
 *   className, style, onEnded, onLoadedMetadata, onTimeUpdate, onPlay,
 *   onError, onVolumeChange
 *
 * Ref: forwarded to the underlying <video> in all cases.
 */
const UnifiedVideoPlayer = forwardRef(function UnifiedVideoPlayer(props, ref) {
  const {
    src,
    poster,
    controls,
    autoPlay,
    muted,
    loop,
    playsInline = true,
    preload,
    className,
    style,
    onEnded,
    onLoadedMetadata,
    onTimeUpdate,
    onPlay,
    onError,
    onVolumeChange,
    /* §2026-05-25 fei — content-protection defaults.
     *
     * Suppress the browser-native download UI by default everywhere:
     *   · controlsList="nodownload"  — hides Chrome's overflow-menu
     *     "Download" item next to fullscreen + PiP
     *   · onContextMenu preventDefault — disables right-click "Save
     *     Video As..." (the other obvious save path)
     *   · disablePictureInPicture — closes the PiP capture vector
     *
     * Opt-in via allowDownload={true} for admin / preview surfaces
     * that legitimately need the native save flow.
     *
     * Users still have the per-work Download button in Library for
     * their OWN content (separate dedicated downloadVideo.js blob flow),
     * which is fine — they own that work. */
    allowDownload = false,
    /* §2026-05-27 fei — quality selector visibility override.
     *
     * Default behavior: selector shows when `controls={true}` AND the
     * HLS manifest has > 1 level. Callers with custom control bars
     * (LibraryPage, etc.) pass `controls={false}` to hide native
     * controls, which also unintentionally hid the quality pill.
     * Pass `showQualitySelector={true}` to force-enable it regardless
     * of `controls`. Hero / MasonryGrid thumbnails stay clean (they
     * never opt in, no clutter on tiny previews). */
    showQualitySelector: showQualitySelectorProp,
    /* §2026-05-27 fei — caller-driven quality picker (controlled).
     *
     * Three optional hooks for callers that have their OWN controls bar
     * and want to render a quality button inline with their other buttons
     * (LibraryPage). The internal pill is independent; callers using these
     * hooks typically also leave `showQualitySelector` unset so only the
     * inline UI appears.
     *
     *   onLevelsChange(levels) — fires with the level list when the HLS
     *     manifest parses; fires with [] on unmount / src change. Same
     *     shape as the internal `levels` state ({index, height, width,
     *     bitrate}). Caller decides how to render.
     *
     *   onLevelChange(idx) — fires with -1 (auto/ABR) or numeric level
     *     index on every LEVEL_SWITCHED event. Caller mirrors into local
     *     state to highlight the active option.
     *
     *   qualityLevel — controlled level. When this prop changes, we
     *     write it to hls.currentLevel. -1 = auto, N = specific. Pass
     *     undefined to leave control entirely internal.
     *
     * Side effect: if `onLevelsChange` is provided, hls.js is forced even
     * on Safari (native HLS doesn't expose levels). Without this opt-in
     * Safari users would silently see an empty picker. */
    onLevelsChange,
    onLevelChange,
    qualityLevel,
    /* §2026-05-27 Leon round-81 — customControls opt-in.
     *
     * Default false → native HTML5 <video controls> + fei quality popover
     * (现有行为不变,保护其他 caller)。
     *
     * true + pointer:fine (desktop) → 渲染 PlayerActionBar primitive overlay,
     * 关闭 native controls。统一 UX:Volume hover-expand / Resolution dropdown /
     * Speed / Autoplay (Infinity) / Fullscreen (CornersOut/In)。
     *
     * true + pointer:coarse (mobile) → 仍走 native controls (PlayerActionBar
     * 内部 isPointerFine 检测,mobile 返回 null)。Mobile 浏览器原生控件触屏
     * 优化好,自建不一定改善体验。
     *
     * 跟 fei 的 onLevelsChange/onLevelChange/qualityLevel controlled-mode 互补:
     * fei's path = caller 自渲染 quality picker UI (LibraryPage 等);
     * Leon's path = PlayerActionBar 内置 resolution dropdown 全套自渲染。 */
    customControls = false,
    /* §2026-05-28 Leon round-83 — PlayerActionBar control visibility passthrough。
     * Admin Works 单视频预览 (无 autoplay loop 需求) 传 showAutoplay={false} 隐藏。
     * showPiP 默认 true,caller 偶尔 fullscreen-locked 场景可关。 */
    showAutoplay = true,
    showPiP = true,
    /* §2026-05-29 Leon round-103 — Download button passthrough.
     * showDownload (caller 算 isOwner || work.allow_download) 控制 visibility,
     * onDownload (optional) caller 自定 download 流程 (LibraryPage 已有
     * downloadVideo.js blob 流程);未传则 PlayerActionBar 用 <a download> fallback。 */
    showDownload = false,
    onDownload,
    /* §2026-05-29 Leon round-106 — transport passthrough → PlayerActionBar。
     * onPrev/onNext (上下项)、autoplay/onAutoplayChange (∞)、onRepeatChange (🔁)。 */
    onPrev,
    onNext,
    autoplay = false,
    onAutoplayChange,
    onRepeatChange,
    /* §2026-05-28 Leon round-95 — loading overlay (visionOS Activity Indicator)。
     * 视频未到可播之前 (loadstart / waiting / stalled / readyState < HAVE_FUTURE_DATA)
     * 中心叠 Medium 28×28 spinner + 海报 blur(8px),给用户心理预期"已经在加载"。
     *
     * Default **false** — 开启会包一层 wrapper div (overlay mount point),fei
     * round-81 注释明确 Hero/MasonryGrid 等 caller 假设 root = <video>,wrap
     * 会破坏 layout (object-cover 等 className 跑去 wrapper)。主播放 caller
     * (LibraryPage / SparkMode / SeriesDetailPage) 显式
     * opt-in `showLoadingOverlay={true}`。
     *
     * Loading state delayed 200ms 才 fade-in,< 200ms 完成的加载不会闪屏。 */
    showLoadingOverlay: showLoadingOverlayProp = false,
  } = props;

  // Internal ref for hls.js attachment. We expose the same element via
  //   the forwarded ref (caller can still call .play() / .pause() / read
  //   .currentTime), AND keep an internal handle for hls.js teardown.
  const internalRef = useRef(null);
  const hlsInstanceRef = useRef(null);
  /* §2026-05-27 Leon round-81 — customControls wrapper ref。
   * PlayerActionBar fullscreen target = wrapper(包 video + bar 一起 enter fs)。
   * 单 video.requestFullscreen() 会丢失 bar overlay。 */
  const containerRef = useRef(null);

  /* §2026-05-28 Leon round-95 — loading overlay state + delayed trigger。
   * `isLoading` 立即响应 video element 的 loadstart/waiting/stalled,但 overlay
   * 实际 fade-in 要 delay 200ms — 短卡顿 (< 200ms) 不闪屏。延迟由 ref 计时器
   * 管理,canplay/playing/loadeddata/seeked 一到立即 clear timer + hide。 */
  const [isLoading, setIsLoading] = useState(false);
  const loadingDelayTimerRef = useRef(null);
  /* §2026-05-30 round-106 — poster blur:甲方反馈"loading 显清晰封面、播放又模糊"
   * 很跳。改成 loading 一开始封面就模糊(从 t=0 即 true,不走 200ms delay),
   * canplay/playing 后淡出 → 模糊封面 → 视频,过渡平滑。 */
  const [posterBlur, setPosterBlur] = useState(true);

  /* §2026-05-27 Leon round-81 — pointer:fine 分路。
   * customControls 仅在 desktop (mouse/trackpad) 生效;mobile (touch) 保留
   * native controls (浏览器触屏优化好,自建未必更佳)。 */
  const [isPointerFine, setIsPointerFine] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: fine)');
    setIsPointerFine(mq.matches);
    const h = (e) => setIsPointerFine(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', h);
    else mq.addListener(h);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', h);
      else mq.removeListener(h);
    };
  }, []);
  const useCustomControls = customControls && isPointerFine;

  /* §2026-05-27 fei — quality selector state.
   *
   *   levels[]: hls.js exposes per-level metadata (height, width, bitrate).
   *     Populated on MANIFEST_PARSED; reset on unmount / src change.
   *   currentLevel: -1 = auto (ABR drives), 0..N = manual pick.
   *     Two-way bound: writing to hls.currentLevel actually changes the
   *     active level; LEVEL_SWITCHED event mirrors back so the picker
   *     reflects what's actually playing (useful when caller flipped Auto
   *     and ABR decided to switch).
   *
   * §2026-05-27 Leon round-81 — fei popover state (showMenu) 已废弃,
   * picker UI 由 PlayerActionBar 提供;levels/currentLevel 数据机制保留。 */
  const [levels, setLevels] = useState([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  /* wantsQualitySelector — fei 原 popover UI 触发 flag,Leon round-81 phase 2
   * 删除 popover JSX 后此 flag 仅用作 useHlsJs 决策依据 (合并冲突时已被 fei
   * round 5 revert,见 useHlsJs 处理)。
   *
   * Leon: "取其值,样式位置按照我的来" — 保留 showQualitySelector prop
   * (callers 兼容),但 UI 由 PlayerActionBar (customControls path) 唯一渲染;
   * fei pill + 弹层菜单已全删。
   *
   * showQualitySelector prop 兼容性:
   *   - LibraryPage controlled-mode (onLevelsChange/qualityLevel) 不受影响
   *   - 其他 showQualitySelector 调用方 (admin/SeriesDetail) 需补 customControls
   *     才能拿 PlayerActionBar resolution dropdown */
  const wantsQualitySelector = showQualitySelectorProp !== undefined
    ? showQualitySelectorProp
    : !!controls;

  // Resolve which URL to feed the <video> element + whether we need hls.js
  const isStream = src && isStreamUrl(src);
  const cfUid = isStream ? extractStreamUid(src) : null;
  const hlsUrl = isStream && cfUid ? streamUidToHlsUrl(cfUid) : null;

  /* §2026-05-27 fei — when to actually use hls.js.
   *
   *   Safari (iOS + macOS) has native HLS in <video src={m3u8}>. That path
   *   is dramatically faster than hls.js:
   *     · Native: browser decodes directly, no JS in the playback path,
   *       ~50ms first-frame.
   *     · hls.js: lazy-load ~500KB JS → parse manifest → fetch first .ts
   *       via fetch() → MSE → decoder. ~500-1000ms first-frame, plus
   *       initial bundle download on first request.
   *
   *   fei round 5 (2026-05-27) — REVERTED force-hls-on-Safari. An earlier
   *   change (rounds 1-4) forced hls.js when wantsQualitySelector or
   *   onLevelsChange was set, so Safari users could see a clickable
   *   multi-level picker. But CF Stream playback got noticeably slow on
   *   Safari (all Discover content is on Stream — verified prod, 20/20
   *   recent items are videodelivery.net), and fei reported "视频加载很慢".
   *
   *   New behavior:
   *     · Safari → native HLS (fast). Quality pill shows current playback
   *       resolution as a read-only badge (videoIntrinsicHeight fallback).
   *       User can't manually pick — Safari's adaptive HLS handles bitrate
   *       internally and there's no JS API to hook into it.
   *     · Chrome / Firefox / Edge → hls.js (no native HLS available). Full
   *       picker works as designed.
   *
   *   For surfaces with caller-driven pickers (Library / Spark bar):
   *   Safari users will see no Quality button (videoLevels stays empty).
   *   They still get ABR auto. Trade accepted in favor of playback speed.
   *
   *   §2026-05-28 Leon round-87 → round-91:customControls 触发 useHlsJs 实测
   *   失败 — Safari + hls.js MSE 路径解码 CF Stream HLS fMP4 segments 黑屏 +
   *   video 无 metadata (Leon round-91 测试反馈)。撤回 customControls trigger,
   *   回到 fei round 5 revert 后的稳定版本 — Safari 必须走 native HLS。
   *
   *   Safari + customControls trade-off:
   *     · 视频正常播放 (native HLS,~50ms 第一帧)
   *     · Resolution dropdown 视觉一致 (visibleTiers 基于 intrinsicHeight 算)
   *     · Tier 点击 disabled (levels=[],已在 round-88 加诊断行 + visual gate)
   *   D-017 启动时考虑 mobile/Safari mini variant (read-only badge)。 */
  const useHlsJs = isStream && hlsUrl && !canPlayHlsNatively();

  // Final video src:
  //   · Direct URL (mp4/webm/etc) — use as-is
  //   · Stream URL going through hls.js → undefined (hls.js attaches via MSE)
  //   · Stream URL on Safari native HLS path → use hlsUrl directly
  const videoSrc = !isStream
    ? src
    : useHlsJs
      ? undefined  // hls.js will set the source via MSE
      : hlsUrl;    // Safari native HLS

  /* §2026-05-25 fei — mobile fullscreen landscape rotation.
   *
   *   When user enters fullscreen on a landscape video (videoWidth >
   *   videoHeight) on a mobile device, ask the screen to lock to
   *   landscape orientation. Browser-native fullscreen on Android Chrome
   *   doesn't auto-rotate (you have to manually turn the phone); iOS
   *   Safari does it natively when you tap the fullscreen icon and we
   *   leave its native flow alone.
   *
   *   screen.orientation.lock requires:
   *     · HTTPS (we are)
   *     · fullscreen API active (we check via fullscreenElement)
   *     · API support (Safari iOS lacks .lock; gracefully fail)
   *
   *   On exit, unlock to let user return to natural rotation. */
  useEffect(() => {
    const video = internalRef.current;
    if (!video) return;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
    if (!isMobile) return;

    const onFsChange = async () => {
      const isInFs = document.fullscreenElement === video
                  || video.webkitDisplayingFullscreen;
      if (isInFs) {
        const w = video.videoWidth, h = video.videoHeight;
        const isLandscape = w && h && w > h;
        if (isLandscape && screen.orientation && typeof screen.orientation.lock === 'function') {
          try {
            await screen.orientation.lock('landscape');
          } catch (e) {
            // Common: NotSupportedError on iOS, AbortError if user already rotated.
            // Both harmless — fullscreen still works, just no auto-rotate.
            console.debug('[UnifiedVideoPlayer] orientation lock skipped:', e?.name || e?.message);
          }
        }
      } else {
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
          try { screen.orientation.unlock(); } catch (_) { /* harmless */ }
        }
      }
    };

    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);  // older Safari / iOS
    video.addEventListener('webkitbeginfullscreen', onFsChange);
    video.addEventListener('webkitendfullscreen', onFsChange);

    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      video.removeEventListener('webkitbeginfullscreen', onFsChange);
      video.removeEventListener('webkitendfullscreen', onFsChange);
    };
  }, []);

  // §2026-05-22 fei: hls.js attach effect.
  //   Runs when `useHlsJs` resolves true — i.e. either the browser lacks
  //   native HLS (Chrome/Firefox/Android Chrome/Edge), or the caller asked
  //   for the quality selector (forces hls.js on Safari too — see useHlsJs
  //   comment above for why).
  //   hls.js attaches to the <video> element, fetches HLS manifest,
  //   processes chunks via Media Source Extensions, feeds them to <video>.
  //   From React's perspective the <video> is just a normal element —
  //   same reconciliation, same swipe-friendly behavior.
  useEffect(() => {
    if (!useHlsJs) return;

    let cancelled = false;
    loadHls().then((Hls) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        console.warn('[UnifiedVideoPlayer] hls.js not supported in this browser, video may not play');
        return;
      }
      const video = internalRef.current;
      if (!video) return;

      const hls = new Hls({
        // §2026-05-23 fei: swipe-smoothness tuning.
        maxBufferLength: 30,      // 30s ahead buffer (default 30)
        maxMaxBufferLength: 60,   // hard ceiling
        enableWorker: true,       // off-main-thread parsing
        // Fetch first fragment immediately on attach — don't wait for
        // play() to be called. Critical for SparkMode pre-rendered next
        // slot: when user swipes, the slot's <video> already has data
        // buffered, so play() can start frame decode immediately instead
        // of round-tripping for the first segment first.
        startFragPrefetch: true,
        // Lower buffer-start threshold so we play sooner (default 10s).
        maxBufferHole: 0.5,
        // Don't wait for an extra-large buffer to start playback —
        // half a segment is enough.
        // §2026-06-03 fei — fix "videos start at 240p, only climb to HD after
        //   a few seconds" (reported on Chrome). This SUPERSEDES the 2026-06-01
        //   attempt that set `startLevel: -1` + testBandwidth:false +
        //   abrEwmaDefaultEstimate and CLAIMED to force a 720p first segment.
        //   That attempt did NOT actually work — verified empirically with a
        //   headless-Chrome harness running real hls.js 1.6.16 against our real
        //   CF Stream manifests, capturing the height of the FIRST loaded
        //   fragment, single instance, 5 runs each:
        //     · startLevel:-1 (auto)  → 240p,1080p,240p,1080p,1080p  ← UNRELIABLE
        //         (lands on 240p ~40% of the time; hls.js's initial auto-pick
        //          ignores the EWMA seed for fragment 0 and frequently starts
        //          at the lowest rung. THIS is what users saw as "240p".)
        //     · startLevel:3          → 720p,720p,720p,720p,720p     ← RELIABLE
        //   So the ONLY reliable lever is an EXPLICIT start level index.
        //   CF Stream's ladder is always ascending [240,360,480,720,1080], so
        //   index 3 == 720p whenever the source is ≥720p. For a lower-res
        //   source (e.g. a 480p ladder [240,360,480]) index 3 is out of range
        //   and hls.js clamps to the top rung — verified: a 3-rung video starts
        //   at 480p. So index 3 means "start at 720p, or the ladder top if the
        //   source is smaller" — exactly the 480p/720p floor we want, never 240p.
        //   startLevel only sets the FIRST segment; ABR stays on auto afterward,
        //   so 1080p sources still climb to 1080p and slow links down-switch
        //   after segment 0. testBandwidth:false keeps hls.js from inserting a
        //   240p probe segment; abrEwmaDefaultEstimate seeds post-seg0 ABR high.
        //   Note: hls.js browsers only (Chrome/Firefox/Edge). Safari uses native
        //   HLS with Apple's own ABR — not tunable here (separate item).
        startLevel: 3,            // explicit: 720p (or ladder top) — NOT auto
        testBandwidth: false,
        abrEwmaDefaultEstimate: 5_000_000,
        // §2026-05-23: be aggressive about back-buffer eviction to free
        // memory on iOS where multiple pre-rendered slots compete for the
        // ~4-6 simultaneous decoder slots.
        backBufferLength: 10,
      });
      hlsInstanceRef.current = hls;

      /* §2026-05-28 Leon round-90 — CRITICAL fix:listener 必须在 loadSource()
       * 之前注册。Manifest 命中 disk cache (admin Works reload 场景) 时解析
       * 极快,MANIFEST_PARSED event 可能在 listener 注册前 fire → listener
       * miss event → levels 永远不被 setState → dropdown 只显 Auto。
       *
       * 之前 fei 的 order:loadSource → attachMedia → hls.on(...) 在 cold
       * fetch 时 OK (manifest XHR 比 .on() 慢),但 cache hit 时 race 失败。
       *
       * 新 order:hls.on(...) → loadSource → attachMedia (hls.js 推荐 pattern)。
       *
       * MANIFEST_PARSED fires once after the master manifest + all level
       *   manifests are loaded → `hls.levels` is fully populated.
       * LEVEL_SWITCHED fires every time the active level changes (ABR
       *   auto-switching or user manual pick) → mirror into React state
       *   so the picker always reflects what's actually playing. */
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        const ls = (hls.levels || []).map((l, i) => ({
          index: i,
          height: l.height,
          width: l.width,
          bitrate: l.bitrate,
        }));
        // §2026-05-28 Leon round-89 — diagnostic log:让 Leon 看 hls.js 实际
        // 给的 levels。CF Stream 单 ladder 视频会只给 1 个 level,Resolution
        // dropdown tier 切不了不是 frontend bug 是 CF Stream 转码没生成多档。
        console.info('[UnifiedVideoPlayer] HLS manifest parsed —', ls.length, 'levels:', ls.map(l => `${l.height}p@${Math.round(l.bitrate/1000)}kbps`).join(', ') || '(empty)');
        setLevels(ls);
        /* §2026-06-09 fei — "开播总是 240p" 的真因是 native-HLS 误判(canPlayHlsNatively
         *   把安卓 Chrome 的 'maybe' 当能原生播 → 走原生 <video>,hls.js 全不参与)。已在
         *   streamUrl.js 修。修了之后实测:hls.js 纯 ABR auto + config(startLevel:3、
         *   abrEwmaDefaultEstimate 5M)本身就高清起播(frag#0=720p)。
         *   注意:之前试过的 manual 锁档(currentLevel/nextLoadLevel/startLevel 一起设)
         *   反而让 hls 状态机选 level0(240p)——已彻底移除,不夺 ABR 决策权。
         *   这里只温和抬高 ABR 起始估算(setter→resetEstimator),压制冷启动头几段掉档。 */
        if (qualityLevel === undefined && ls.length > 1) {
          try { hls.bandwidthEstimate = 10_000_000; } catch { /* ignore */ }
        }
        // currentLevel may already have switched by the time manifest fires;
        // sync once now in addition to the LEVEL_SWITCHED listener below.
        const initial = hls.currentLevel ?? -1;
        setCurrentLevel(initial);
        // Notify caller (LibraryPage custom controls bar etc.)
        if (typeof onLevelsChange === 'function') onLevelsChange(ls);
        if (typeof onLevelChange === 'function') onLevelChange(initial);
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        if (cancelled) return;
        // hls.currentLevel returns -1 only when user explicitly set it to
        // -1 (auto). Once ABR resolves, hls.currentLevel returns the
        // actual numeric level, even though `hls.autoLevelEnabled` is true.
        // Use autoLevelEnabled to know whether user picked Auto vs manual.
        const lv = hls.autoLevelEnabled ? -1 : data.level;
        setCurrentLevel(lv);
        if (typeof onLevelChange === 'function') onLevelChange(lv);
      });
      // listener 注册完才 loadSource + attachMedia,确保 cache-hit fast-parse
      // 路径也能 fire 到 listener。
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      if (hlsInstanceRef.current) {
        hlsInstanceRef.current.destroy();
        hlsInstanceRef.current = null;
      }
      // Reset selector state so next src change starts clean (no stale
      // levels from previous video flashing in the picker before new
      // manifest parses).
      setLevels([]);
      setCurrentLevel(-1);
      // Tell external picker the levels list went away (so it can hide
      // / disable its button while between videos).
      if (typeof onLevelsChange === 'function') onLevelsChange([]);
    };
  }, [hlsUrl, useHlsJs]);

  /* §2026-05-27 fei — apply caller-controlled qualityLevel prop.
   *
   * When the parent (e.g. LibraryPage) changes its picker selection,
   * `qualityLevel` flips through this effect and we mirror it into
   * hls.currentLevel. The LEVEL_SWITCHED handler will then echo back
   * through onLevelChange — caller's state stays in sync without a
   * setState loop because the value matches.
   *
   * Guard: skip when uncontrolled (undefined) or when no hls.js instance
   * (Safari native HLS path doesn't expose level switching anyway). */
  useEffect(() => {
    if (qualityLevel === undefined) return;
    const hls = hlsInstanceRef.current;
    if (!hls) return;
    if (hls.currentLevel !== qualityLevel) {
      hls.currentLevel = qualityLevel;
    }
  }, [qualityLevel]);

  /* §2026-05-27 fei — apply level switch to hls.js when user picks.
   *
   *   -1 → hls.currentLevel = -1 AND hls.nextLevel = -1, plus we'd want
   *     hls.loadLevel = -1, but the canonical "enable auto" toggle is
   *     `hls.currentLevel = -1` which hls.js then translates internally.
   *   N  → hls.currentLevel = N. Takes effect at the next segment boundary
   *     (usually within 2-6s, depending on segment duration). The video
   *     keeps playing during the switch — no rebuffer. */
  const applyLevelChoice = (idx) => {
    const hls = hlsInstanceRef.current;
    if (!hls) return;
    hls.currentLevel = idx;  // -1 for auto, N for manual
    setCurrentLevel(idx);
  };

  // §2026-05-23 fei: the play/pause-state-after-mount fix.
  //   Browsers IGNORE `autoPlay` attribute changes after mount — once a
  //   <video> is rendered with autoPlay={false}, flipping it to autoPlay={true}
  //   in a later render does NOT start playback (and vice-versa). Without
  //   this effect, our SparkMode 3-slot pre-render bug:
  //     · slot[2] (pos=2, isActive=false) mounts <video autoPlay={false} muted>.
  //     · User swipes; slot[2] becomes slot[1] (pos=1, isActive=true). React
  //       reconciles the SAME DOM node — autoPlay attribute changes false→true,
  //       but the browser sees no event, video stays paused. SparkMode's
  //       retry-play effect (line ~441) catches this for the ACTIVE slot only.
  //     · The OLD slot[1] (now slot[0], isActive=false) was playing — autoPlay
  //       flip true→false does nothing, video keeps playing in the background,
  //       muted but consuming a decoder + buffering segments.
  //   After 5-6 swipes on iOS Safari (which caps simultaneous <video>
  //   decoders at ~4-6), the decoder pool is exhausted and new plays fail.
  //
  //   This effect explicitly drives play/pause from the autoPlay prop, so
  //   non-active slots are paused immediately and active slots resume play
  //   even when the DOM node was reconciled rather than freshly mounted.
  useEffect(() => {
    const v = internalRef.current;
    if (!v) return;
    if (autoPlay) {
      // §2026-05-23 fei: iOS Safari unmuted-autoplay handling.
      //   Safari rejects v.play() with NotAllowedError if the call isn't
      //   inside a user-gesture handler chain AND the video is unmuted.
      //   In SparkMode, the swipe handler defers setIndex by 330ms (snap
      //   animation), so by the time this useEffect runs, the user-gesture
      //   token is gone. SparkMode also pre-plays the target slot inside
      //   the touch handler (correct fix), but as defense for any other
      //   caller, we fall back to muted play() so the user at least sees
      //   something play. They can tap the volume button to restore sound.
      const tryPlay = (forceMute) => {
        if (forceMute) v.muted = true;
        const p = v.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (err?.name === 'NotAllowedError' && !forceMute && !v.muted) {
              tryPlay(true);
            }
          });
        }
      };
      tryPlay(false);
    } else {
      if (!v.paused) v.pause();
    }
  }, [autoPlay]);

  /* §2026-05-28 Leon round-95 — wire loading overlay events.
   *
   * HTMLMediaElement events:
   *   loadstart / waiting / stalled → schedule show (200ms delay)
   *   canplay / playing / loadeddata / seeked / error → cancel + hide
   *
   * readyState check on mount handles fast cache hits (video already
   * buffered when effect runs, no loadstart event ever fires).
   *
   * Re-attach when videoSrc changes (new episode swap = new loading cycle).
   */
  useEffect(() => {
    if (!showLoadingOverlayProp) return undefined;
    const video = internalRef.current;
    if (!video) return undefined;

    const scheduleShow = () => {
      if (loadingDelayTimerRef.current) return;
      loadingDelayTimerRef.current = setTimeout(() => {
        loadingDelayTimerRef.current = null;
        /* §2026-05-29 Leon round-98 — 二次 check:200ms 内 readyState 可能已到 3
         * 但 canplay/playing event miss (mp4 直 stream / autoPlay race 等)。
         * 真到 timer fire 时仍 < 3 才显示 overlay,否则放弃。 */
        if (video.readyState < 3) setIsLoading(true);
      }, 200);
    };
    const cancelAndHide = () => {
      if (loadingDelayTimerRef.current) {
        clearTimeout(loadingDelayTimerRef.current);
        loadingDelayTimerRef.current = null;
      }
      setIsLoading(false);
      setPosterBlur(false); // §round-106 — 可播即淡出模糊封面
    };

    // §round-106 — 新 src loading 重置:未可播即模糊封面(从 t=0)
    setPosterBlur(video.readyState < 3);
    // HAVE_FUTURE_DATA = 3 — enough data to play forward. < 3 means still loading.
    if (video.readyState < 3) scheduleShow();
    else cancelAndHide();

    /* §2026-05-29 Leon round-98 — timeupdate 兜底:视频实际在播放 (currentTime
     * 推进) 强制 cancel spinner。Round-95 实测 mp4 admin Works callsite 偶发
     * playing event 不到位 (autoPlay race / native controls disable 时序),
     * 导致 spinner 卡死播放期间。timeupdate ~4Hz 足以及时清掉错误显示。 */
    const onTimeUpdateHide = () => {
      if (!video.paused && video.readyState >= 3) cancelAndHide();
    };

    video.addEventListener('loadstart', scheduleShow);
    video.addEventListener('waiting', scheduleShow);
    video.addEventListener('stalled', scheduleShow);
    video.addEventListener('canplay', cancelAndHide);
    video.addEventListener('playing', cancelAndHide);
    video.addEventListener('loadeddata', cancelAndHide);
    video.addEventListener('seeked', cancelAndHide);
    video.addEventListener('error', cancelAndHide);
    video.addEventListener('timeupdate', onTimeUpdateHide);

    return () => {
      if (loadingDelayTimerRef.current) {
        clearTimeout(loadingDelayTimerRef.current);
        loadingDelayTimerRef.current = null;
      }
      video.removeEventListener('loadstart', scheduleShow);
      video.removeEventListener('waiting', scheduleShow);
      video.removeEventListener('stalled', scheduleShow);
      video.removeEventListener('canplay', cancelAndHide);
      video.removeEventListener('playing', cancelAndHide);
      video.removeEventListener('loadeddata', cancelAndHide);
      video.removeEventListener('seeked', cancelAndHide);
      video.removeEventListener('error', cancelAndHide);
      video.removeEventListener('timeupdate', onTimeUpdateHide);
    };
  }, [videoSrc, showLoadingOverlayProp]);

  // Forward ref to internal video element
  const setRefs = (el) => {
    internalRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  /* §2026-05-27 fei round 2 + Leon round-81 phase 2 — intrinsic videoHeight
   *   tracking 已删除 (原仅用于 fei pill read-only fallback,popover UI 已废弃)。
   *   D-017 启动时(mobile mini variant + Safari fallback)若需要 PlayerActionBar
   *   显示 read-only resolution badge 再恢复此 effect 并把数据传给 PlayerActionBar。 */

  // §2026-05-23 fei: render `poster` as a CSS background-image on the
  //   <video> element itself. Why not just use the native `poster` attr?
  //     · Browsers clear the poster the moment they commit a `src` change
  //       or MSE attaches (hls.js path). For our Chrome users with the
  //       lazy hls.js dynamic-import (~50-300ms) + manifest fetch + first
  //       segment decode, there's a 0.5-1s window where the poster is
  //       gone but no video frame has been painted yet → black flash.
  //     · CSS background-image stays drawn on the element box until a
  //       child paints over it. The <video>'s rendered content (the first
  //       decoded frame) paints over the bg the instant it arrives, so
  //       the user never sees black between poster and first frame.
  //   Caveat: only kicks in when caller passed `poster`. For callers that
  //   don't (e.g. admin preview), behavior is unchanged.
  //
  // §2026-05-26 Leon round-79 — backgroundSize 跟 video object-fit 对齐:
  //   caller className 含 `object-contain` 时,bg 也 contain (跟 video frame
  //   比例一致,letterbox black 区跟 bg 黑底匹配,无错位);否则 cover (fei
  //   原默认)。SparkMode 是 contain consumer,之前 bg 错位在 video 上下黑
  //   边显示封面图被拉伸 (Leon 报"视频下出现静态封面图做背景")。
  const isObjectContain = typeof className === 'string' && /\bobject-contain\b/.test(className);
  /* §2026-05-28 Leon round-95 — forward object-fit class to inner <video>
   * in wrap path. fei round-81 hard-coded video.className = 'w-full h-full'
   * which dropped caller's object-* modifier (object-cover / object-contain
   * etc.) — wrapper div has no effect on video letterboxing. Detect any
   * object-fit class on caller and re-apply to the inner video element. */
  const objectFitMatch = typeof className === 'string'
    ? className.match(/\bobject-(contain|cover|fill|none|scale-down)\b/)
    : null;
  const objectFitClass = objectFitMatch ? objectFitMatch[0] : '';
  /* §2026-06-04 — 统一术语:本组件显示的图一律称 **poster**(来源是 caller 传的
   *   `poster` prop;沉浸/缩略图 call site 由 `item.cover` 提供)。不再混用
   *   封面 / PosterBg / CSS 背景图 等叫法。poster 的呈现收敛为两条路径:
   *     · bare(静态缩略图,无 loading overlay):poster 作 <video> 的 CSS 背景
   *       兜底(防 src 切换瞬间 native poster 被浏览器清空的黑闪)。
   *     · wrapped + showLoadingOverlay(沉浸主播放):**单独一层 poster overlay
   *       盖在视频上面、canplay 淡出** —— 唯一一层,不再叠 native poster + wrapper
   *       背景(见下方 wrapper / video / overlay)。 */
  const posterImageCss = poster ? {
    backgroundImage: `url("${poster.replace(/"/g, '\\"')}")`,
    backgroundSize: isObjectContain ? 'contain' : 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
  } : null;
  const styleWithPosterBg = poster ? { ...posterImageCss, backgroundColor: 'black', ...style } : style;

  /* §2026-05-27 Leon round-81 — wrapped 路径条件:只 customControls 时 wrap。
   * fei popover UI 已废弃 (Leon: "取其值,样式位置按照我的来"),resolution
   * dropdown 唯一视觉 = PlayerActionBar 内 Speed 左侧。showQualitySelector
   * prop 保留只用于 force hls.js on Safari (拿 levels 数据),不再渲染 UI。 */
  /* §2026-05-28 Leon round-95 — wrap 条件追加 loading overlay。
   * customControls 之外,启用 loading overlay 也需要 wrapper 来 mount overlay
   * 层。Hero/MasonryGrid 等 autoplay muted loop 缩略图 readyState 通常瞬间到
   * 3,200ms delay 内 hide,wrap 视觉无差异;不放心的 caller 显式传
   * showLoadingOverlay={false} 退回 bare path。 */
  const isWrapped = useCustomControls || showLoadingOverlayProp;

  const videoElement = (
    <video
      ref={setRefs}
      src={videoSrc}
      /* §2026-06-04 — showLoadingOverlay 路径下 poster 由上面的 overlay 层独家负责,
       * 这里不再设 native poster(避免重复一层)。其余路径(bare 缩略图等)保留。 */
      poster={showLoadingOverlayProp ? undefined : poster}
      /* customControls 走 PlayerActionBar overlay,native controls 必须关
       * (否则双层控件叠加难用)。 */
      controls={controls && !useCustomControls}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      playsInline={playsInline}
      preload={preload}
      // When wrapped (quality selector mounted), className lives on the
      // wrapper div and the video fills it. Otherwise className stays on
      // the video so single-element callers are unaffected.
      className={isWrapped ? `w-full h-full ${objectFitClass}`.trim() : className}
      style={isWrapped ? undefined : styleWithPosterBg}
      onEnded={onEnded}
      onLoadedMetadata={onLoadedMetadata}
      onTimeUpdate={onTimeUpdate ? (e) => onTimeUpdate(e.currentTarget.currentTime) : undefined}
      onPlay={onPlay}
      onError={onError}
      onVolumeChange={onVolumeChange}
      /* §2026-05-25 fei — block native download UI + right-click save
         unless caller explicitly opts in (allowDownload=true). */
      controlsList={allowDownload ? undefined : 'nodownload noremoteplayback'}
      disablePictureInPicture={!allowDownload}
      onContextMenu={allowDownload ? undefined : (e) => e.preventDefault()}
    />
  );

  /* §2026-05-27 fei — no quality selector path. Keep the bare <video> as
   *   the root element so existing callers (Hero/SparkMode/MasonryGrid
   *   thumbnails with custom layout assumptions) see zero behavioral
   *   change. Quality picker only mounts when:
   *     - controls={true} (caller wants a UI)
   *     - levels.length > 1 (HLS manifest has multiple bitrates)
   *   Direct mp4 + Safari native HLS + single-level Stream all stay bare.
   *
   * §2026-05-27 Leon round-81 — customControls 走 wrapped 路径 (即使无 HLS
   * levels) 因为 PlayerActionBar 自己也要 wrapper 容器 mount overlay。 */
  if (!isWrapped) return videoElement;

  /* §2026-05-27 Leon round-81 — customControls 路径 (desktop pointer:fine):
   *   wrapper div (containerRef) 包 video + PlayerActionBar。Fullscreen 目标 =
   *   wrapper (这样 bar overlay 也跟 enter fullscreen)。
   *
   *   Leon round-81 phase 2 — 删除 fei 原 popover JSX (bottom-right 小 pill
   *   + 弹层菜单)。Leon: "费做的 showQualitySelector 取其值,样式位置按照我
   *   的来" — fei 的 hls.js levels 数据机制 + force hls.js on Safari 保留
   *   (showQualitySelector 跟 onLevelsChange 都继续工作),但 resolution
   *   picker 视觉统一由 PlayerActionBar 内的 Speed 左侧 dropdown 提供。
   *
   *   Mobile pointer:coarse 走 native controls,native HLS 无法切换 levels
   *   (Safari 限制),视为 known regression — D-017 待补:为 PlayerActionBar
   *   设计 mobile mini variant (小屏 resolution chip)。 */
  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        /* §2026-06-04 — showLoadingOverlay 路径:poster 由下面唯一的 poster overlay
         *   层负责,wrapper 只留黑底(letterbox 留白)+ caller 布局 style,不再在
         *   wrapper 上画 poster 背景(避免与 overlay 重复)。其余 wrapped caller
         *   (如部分 customControls,无 overlay)仍保留 poster 背景兜底。 */
        ...(showLoadingOverlayProp ? { backgroundColor: 'black', ...style } : styleWithPosterBg),
      }}
    >
      {videoElement}
      {/* §2026-06-04 — **唯一的 poster overlay**(收敛后:沉浸态 poster 只此一层)。
       * 盖在视频【上面】(zIndex 1),清晰显示 poster 直到 canplay 再淡出 → 视频。
       * 取代了过去 native poster + wrapper 背景 + 模糊层 三层叠画;并去掉了原
       * round-106 的 blur(造成"清晰→模糊→清晰"闪烁),改清晰海报。 */}
      {poster && showLoadingOverlayProp && (
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            backgroundImage: `url("${poster.replace(/"/g, '\\"')}")`,
            backgroundSize: isObjectContain ? 'contain' : 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            backgroundColor: 'black',
            opacity: posterBlur ? 1 : 0,
            transition: 'opacity 0.35s ease',
          }}
        />
      )}
      {/* §2026-05-28 Leon round-95 — loading spinner (visionOS Activity Indicator)。
       * poster 显示由上方唯一的 poster overlay 负责;此层只居中 spinner
       * (zIndex 2,在 poster overlay 之上;无 poster 时透明)。 */}
      {showLoadingOverlayProp && isLoading && (
        <div
          className="animate-fade-in"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          <ActivityIndicator size="Medium" />
        </div>
      )}
      {useCustomControls && (
        <PlayerActionBar
          videoRef={internalRef}
          containerRef={containerRef}
          levels={levels}
          currentLevel={currentLevel}
          onResolutionChange={applyLevelChoice}
          showAutoplay={showAutoplay}
          showPiP={showPiP}
          showDownload={showDownload}
          onDownload={onDownload}
          onPrev={onPrev}
          onNext={onNext}
          autoplay={autoplay}
          onAutoplayChange={onAutoplayChange}
          onRepeatChange={onRepeatChange}
        />
      )}
    </div>
  );
});

export default UnifiedVideoPlayer;

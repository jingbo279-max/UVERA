import React, { forwardRef, useState } from 'react';
import UnifiedVideoPlayer from '../../components/UnifiedVideoPlayer';

/**
 * VideoPlayer — 高层 player composite (Leon round-102)
 *
 * 内部 wrap UnifiedVideoPlayer + PlayerActionBar,所有 round-93 ~ 101 通用 fix
 * 全自动生效:loading overlay / 进度条 3 层 buffered / rAF 60Hz / knob 中性白 /
 * Resolution short-edge / Replay isEnded / 中心 Play / Replay overlay。
 *
 * **通用部分一处改,所有 callsite 自动跟**。各页面差异化通过语义角色 slot 表达
 * (传则显示,不传则无),不需要 caller 自己叠 DOM / 管 z-index / 算定位。
 *
 * ─── kind ────────────────────────────────────────────────────────────────
 * 决定一组 default 行为(customControls / autoPlay / loading overlay / 各
 * action row 按钮 visibility)。每个具体 prop 可单独 override。
 *
 *   primary       — 用户主播放 (SparkMode / SeriesDetail / Library)
 *                   = customControls + showLoadingOverlay + showQualitySelector +
 *                     autoPlay + 完整 action row (vol/res/speed/autoplay/fullscreen)
 *
 *   thumbnail     — 静帧预览 (列表 / 选集缩略图)
 *                   = no controls + muted + no autoPlay + no loading overlay
 *
 *   decorative    — autoPlay muted loop 装饰 (Hero / SparkMode secondary slot)
 *                   = no controls + muted + autoPlay + loop + no loading overlay
 *
 *   admin-preview — admin Works 单视频预览
 *                   = primary + showDownload=true + showAutoplay=false (loop 按钮)
 *
 * ─── Slot (语义角色) ─────────────────────────────────────────────────────
 * 每个 slot 接 ReactNode (caller 提供 chrome 元素),VideoPlayer 负责 absolute
 * 定位 + z-index 管理。caller 决定 chrome 长什么样、做什么。
 *
 *   closeButton      — 右上角关闭按钮 (Lightbox / Admin 弹层)
 *   episodeBadge     — 左上角剧集名 + 编号 (SeriesDetail)
 *   publicTag        — 左上角公开/私密标识 (Library)
 *                      ⚠️ 跟 episodeBadge 互斥 (同位置),caller 自管不重叠
 *   nextEpisodeHint  — 底部右侧 / footer 下一集 hint
 *   footer           — PlayerActionBar 之下的扩展内容 (下集预览缩略图等)
 *
 * §2026-05-29 Leon round-105 — branchCTA slot 删除 (拍摄分支产品暂停)
 *
 * ─── Action row 按钮 visibility ──────────────────────────────────────────
 * kind 给一组默认值,显式 prop 覆盖:
 *   showDownload, showAutoplay, showPiP, showResolution, showSpeed, showFullscreen
 *
 * ─── 行为回调 ────────────────────────────────────────────────────────────
 *   onEnded, onTimeUpdate, onPlay, onError, onVolumeChange — 透传给 UnifiedVideoPlayer
 *   onLevelsChange / onLevelChange / qualityLevel — controlled quality picker (LibraryPage 等)
 *
 * ─── ref ──────────────────────────────────────────────────────────────────
 * forwardRef 透传到 UnifiedVideoPlayer → 内部 <video> 元素。caller 可 .play() /
 * .pause() / 读 .currentTime 等。
 */

const KIND_DEFAULTS = {
  primary: {
    customControls: true,
    showLoadingOverlay: true,
    showQualitySelector: true,
    showDownload: false,
    showAutoplay: true,
    showPiP: true,
    autoPlay: true,
    muted: false,
    loop: false,
    controls: true,
    preload: 'metadata',
  },
  thumbnail: {
    customControls: false,
    showLoadingOverlay: false,
    showQualitySelector: false,
    showDownload: false,
    showAutoplay: false,
    showPiP: false,
    autoPlay: false,
    muted: true,
    loop: false,
    controls: false,
    preload: 'metadata',
  },
  decorative: {
    customControls: false,
    showLoadingOverlay: false,
    showQualitySelector: false,
    showDownload: false,
    showAutoplay: false,
    showPiP: false,
    autoPlay: true,
    muted: true,
    loop: true,
    controls: false,
    preload: 'auto',
  },
  'admin-preview': {
    customControls: true,
    showLoadingOverlay: true,
    showQualitySelector: true,
    showDownload: true,
    showAutoplay: false,
    showPiP: true,
    /* §2026-05-29 Leon round-102 fix — admin-preview default autoPlay=false。
     * admin 上传 / 点开 Works 看视频,Chrome muted=false + autoPlay 必被 block
     * → video 不真正 load → 无 metadata / 无 resolution / 无 loading 动画 (Leon
     * round-102 截图 4 个 regression 全部源于此)。改 default false,callsite
     * 4096 (works 列表点开) 显式 autoPlay 保留"自动播"语义。 */
    autoPlay: false,
    muted: false,
    loop: false,
    controls: true,
    preload: 'metadata',
  },
};

/* §2026-05-29 Leon round-106 — contentType 播放逻辑默认 (跟 kind chrome preset 正交)。
 * 见 docs/decisions/2026-05-29-playback-transport-model.md 矩阵:
 *   autoplay  — ∞ 播完自动前进默认值 (series ON,其余 OFF)
 *   loopSelf  — 短视频/mv-single 默认循环自身 (= video.loop / 🔁 Repeat ONE)
 * mv-album 暂 fall back mv-single (无 playlist 数据结构,见 D-019)。 */
const CONTENT_DEFAULTS = {
  'short-feed': { autoplay: false, loopSelf: true },
  'mv-single':  { autoplay: false, loopSelf: true },
  'mv-album':   { autoplay: false, loopSelf: true },  // D-019 启用后改 repeat 'all'
  'series':     { autoplay: true,  loopSelf: false },
};

const VideoPlayer = forwardRef(function VideoPlayer(props, ref) {
  const {
    kind = 'primary',
    /* §2026-05-29 Leon round-106 — contentType 管播放逻辑 (跟 kind chrome 正交)。
     * 'short-feed' | 'mv-single' | 'mv-album' | 'series'。决定 🔁∞ 默认 + 播完行为。 */
    contentType = 'short-feed',
    src,
    poster,
    className = '',
    style,

    // ─── Transport (round-106) ───
    /* onPrev/onNext — 上/下一项 (剧集换集 / feed 换条);传则显 ⏮⏭。
     * autoplay (controlled optional) — ∞ 状态;不传则 VideoPlayer 按 contentType
     *   默认管理。onAutoplayChange — ∞ 点击回调 (caller 可镜像)。
     * onRepeatChange — 🔁 状态上报 (caller 处理 'all' 循环播放列表)。 */
    onPrev,
    onNext,
    autoplay: autoplayProp,
    onAutoplayChange,
    onRepeatChange,

    // ─── Slots ───
    closeButton,
    episodeBadge,
    publicTag,
    nextEpisodeHint,
    footer,

    // ─── Action row visibility (可 override kind defaults) ───
    showDownload,
    showAutoplay,
    showPiP,
    showQualitySelector,
    showLoadingOverlay,

    // ─── Behavior (可 override kind defaults) ───
    autoPlay,
    muted,
    loop,
    controls,
    customControls,
    playsInline = true,
    preload,
    allowDownload,

    // ─── 透传事件 ───
    onEnded,
    onTimeUpdate,
    onLoadedMetadata,
    onPlay,
    onError,
    onVolumeChange,
    /* §2026-05-29 Leon round-103 — caller 自定 download 流程 (LibraryPage
     * 走 downloadVideo.js blob+sanitize)。未传时 PlayerActionBar 用
     * <a download href={src}> fallback。 */
    onDownload,

    // ─── HLS 控件 (LibraryPage 等 controlled quality) ───
    onLevelsChange,
    onLevelChange,
    qualityLevel,

    // ─── 其它 ───
    ...rest
  } = props;

  const defaults = KIND_DEFAULTS[kind] || KIND_DEFAULTS.primary;
  const cDefaults = CONTENT_DEFAULTS[contentType] || CONTENT_DEFAULTS['short-feed'];

  /* §2026-05-29 Leon round-106 — autoplay (∞) 状态:controlled prop 优先,
   * 否则 VideoPlayer 内部按 contentType 默认管理。 */
  const [autoplayState, setAutoplayState] = useState(cDefaults.autoplay);
  const autoplayResolved = autoplayProp ?? autoplayState;
  const handleAutoplayChange = (next) => {
    if (autoplayProp === undefined) setAutoplayState(next);
    onAutoplayChange?.(next);
  };

  // kind defaults 跟 explicit prop 合并,explicit 优先(undefined 才用 default)
  const merged = {
    customControls:      customControls      ?? defaults.customControls,
    showLoadingOverlay:  showLoadingOverlay  ?? defaults.showLoadingOverlay,
    showQualitySelector: showQualitySelector ?? defaults.showQualitySelector,
    showAutoplay:        showAutoplay        ?? defaults.showAutoplay,
    showPiP:             showPiP             ?? defaults.showPiP,
    autoPlay:            autoPlay            ?? defaults.autoPlay,
    muted:               muted               ?? defaults.muted,
    /* loop:explicit > contentType loopSelf > kind default。短视频/mv-single
     * loopSelf=true → video.loop=true → PlayerActionBar 读作 Repeat ONE 默认。 */
    loop:                loop                ?? (cDefaults.loopSelf || defaults.loop),
    controls:            controls            ?? defaults.controls,
    preload:             preload             ?? defaults.preload,
    allowDownload:       allowDownload       ?? defaults.showDownload,
  };
  const showDownloadFinal = showDownload ?? defaults.showDownload;

  // 是否需要外层 wrapper:有任何 slot 传入,或 kind 是 primary/admin-preview (loading
  // overlay + PlayerActionBar 已内置 wrapper)。仅 thumbnail/decorative 无 slot 时
  // 可走 UnifiedVideoPlayer bare path。
  const hasAnySlot = Boolean(
    closeButton || episodeBadge || publicTag || nextEpisodeHint || footer
  );

  const videoEl = (
    <UnifiedVideoPlayer
      ref={ref}
      src={src}
      poster={poster}
      className={hasAnySlot ? 'w-full h-full' : className}
      style={hasAnySlot ? undefined : style}
      customControls={merged.customControls}
      showLoadingOverlay={merged.showLoadingOverlay}
      showQualitySelector={merged.showQualitySelector}
      showAutoplay={merged.showAutoplay}
      showPiP={merged.showPiP}
      autoPlay={merged.autoPlay}
      muted={merged.muted}
      loop={merged.loop}
      controls={merged.controls}
      playsInline={playsInline}
      preload={merged.preload}
      allowDownload={showDownloadFinal}
      showDownload={showDownloadFinal}
      onDownload={onDownload}
      onPrev={onPrev}
      onNext={onNext}
      autoplay={autoplayResolved}
      onAutoplayChange={handleAutoplayChange}
      onRepeatChange={onRepeatChange}
      onEnded={onEnded}
      onTimeUpdate={onTimeUpdate}
      onLoadedMetadata={onLoadedMetadata}
      onPlay={onPlay}
      onError={onError}
      onVolumeChange={onVolumeChange}
      onLevelsChange={onLevelsChange}
      onLevelChange={onLevelChange}
      qualityLevel={qualityLevel}
      {...rest}
    />
  );

  // 无 slot 时 bare,跟 UnifiedVideoPlayer 直用零差异
  if (!hasAnySlot) return videoEl;

  // 有 slot 时 wrap,叠 absolute chrome
  return (
    <div className={`relative ${className}`} style={style}>
      {videoEl}

      {/* 左上 — episodeBadge 或 publicTag (互斥,caller 自管) */}
      {(episodeBadge || publicTag) && (
        <div className="absolute top-3 left-3 z-10 pointer-events-none [&>*]:pointer-events-auto">
          {episodeBadge || publicTag}
        </div>
      )}

      {/* 右上 — closeButton */}
      {closeButton && (
        <div className="absolute top-3 right-3 z-10 pointer-events-none [&>*]:pointer-events-auto">
          {closeButton}
        </div>
      )}

      {/* 底部右侧 — nextEpisodeHint */}
      {nextEpisodeHint && (
        <div className="absolute right-3 bottom-16 z-[4] pointer-events-none [&>*]:pointer-events-auto">
          {nextEpisodeHint}
        </div>
      )}

      {/* PlayerActionBar 之下 — footer (caller 完整控制 layout) */}
      {footer && (
        <div className="absolute left-0 right-0 -bottom-0 translate-y-full z-10">
          {footer}
        </div>
      )}
    </div>
  );
});

export default VideoPlayer;

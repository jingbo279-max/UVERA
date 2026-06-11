import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause,
  SpeakerHigh, SpeakerLow, SpeakerSlash,
  CornersOut, CornersIn,
  Infinity as InfinityIcon,
  PictureInPicture,
  DownloadSimple,
  Repeat, RepeatOnce, SkipBack, SkipForward,
} from '@phosphor-icons/react';
import { Tooltip } from './Tooltip';
import { VideoReplayButton } from '../composites/VideoOverlayButtons';
import { levelShortEdge } from '../../components/UnifiedVideoPlayer';

/**
 * PlayerActionBar — unified custom video controls overlay (visionOS spec)
 *
 * 2026-05-27 round-81 (Leon):
 *   全站 video player action bar 统一。UnifiedVideoPlayer / SparkMode
 *   都复用这个 primitive,native <video controls> 在 desktop
 *   path 弃用,自建底栏统一 UX:
 *     · Volume btn — hover-expand 向左滑出 slider + click toggle mute
 *     · Resolution dropdown — Speed 左侧,hls.js levels[] 映射 (auto + 各档)
 *     · Speed dropdown — 0.5×/0.75×/1×/1.25×/1.5×/2×
 *     · Autoplay toggle — Phosphor Infinity icon + Tooltip "Autoplay"
 *       (loop 视频结尾自动重播)
 *     · Fullscreen — CornersOut(idle) / CornersIn(active) icon swap
 *     · Play/Pause + 进度条 + 时间显示 (replace native HTML5 controls)
 *
 * Mobile (pointer:coarse) 不渲染:caller 用 native <video controls> 保留
 * 触屏优化的浏览器默认控件 (大按钮 + auto-hide + 系统级 fullscreen)。
 *
 * State 自管理 (caller 只传 videoRef + containerRef + 可选 hls.js levels):
 *   - play/pause、currentTime、duration、volume、muted 全从 video 元素事件读
 *   - speed (playbackRate)、loop (autoplay) 写回 video 元素
 *   - fullscreen 在 containerRef.current 触发 (含 webkit prefix 兼容旧 Safari)
 *
 * Props:
 *   videoRef        — RefObject<HTMLVideoElement> 底层 video 元素 ref
 *   containerRef    — RefObject<HTMLElement> 全屏 target (一般包 video + bar 的 wrapper)
 *   levels          — hls.js 层级数组 [{index,height,width,bitrate}] (可选)
 *   currentLevel    — 当前层级 index (-1=auto)
 *   onResolutionChange(idx) — caller 调 hls.currentLevel = idx
 *   className       — 追加到 outer overlay container
 *   onAutoplayChange(bool) — 可选 caller hook (loop state 仍内部驱动)
 */
export function PlayerActionBar({
  videoRef,
  containerRef,
  levels = [],
  currentLevel = -1,
  onResolutionChange,
  onAutoplayChange,
  /* §2026-05-29 Leon round-106 — transport 簇 (Apple Music 模式,见 doc
   * 2026-05-29-playback-transport-model)。布局:[🔁][⏮ ▶/⏸(大) ⏭][∞]
   *
   *   onPrev / onNext — caller 提供上/下一项 (剧集换集 / feed 换条)。传则显 ⏮⏭。
   *   autoplay / onAutoplayChange — ∞ 自动前进 toggle。当 autoplay && onNext,
   *     video 'ended' 时自动 onNext()。∞ 仅在 onNext 存在时显示 (无下一项无意义)。
   *   onRepeatChange(mode) — 🔁 Repeat 状态 'off'|'all'|'one' 上报 caller
   *     (caller 处理 'all' = 循环播放列表;'one' = video.loop 内部已处理)。
   *
   * §2026-05-28 Leon round-83 — showAutoplay 旧语义 (∞=loop) 已被 round-106
   * 🔁 Repeat 接管。showAutoplay 现控制 ∞ autoplay-advance 是否可显 (仍需
   * onNext 才真正 render)。 */
  onPrev,
  onNext,
  onRepeatChange,
  autoplay = false,
  showAutoplay = true,
  showPiP = true,
  /* §2026-05-29 Leon round-103 — Download button。
   * showDownload: visibility (caller 算 isOwner || work.allow_download)。
   * onDownload: 可选 callback,caller 提供完整下载逻辑 (LibraryPage 已有
   * downloadVideo.js blob+sanitize 流程,直接接);未传时 fallback 到浏览器
   * 原生 <a download href={src}> (CORS allow 时 browser save dialog)。
   * src: 兜底 fallback 用 (取 video.currentSrc / video.src)。 */
  showDownload = false,
  onDownload,
  className = '',
}) {
  // ─────────────────────────────────────────────────────────────────────
  // 平台分路:pointer:fine = mouse/trackpad,无此 media query 的 mobile
  // 返回 null caller fallback 到 native controls。
  // ─────────────────────────────────────────────────────────────────────
  const [isPointerFine, setIsPointerFine] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: fine)');
    setIsPointerFine(mq.matches);
    const handler = (e) => setIsPointerFine(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // Video state 自管理 — 监听 video 元素事件回写 React state
  // ─────────────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  /* §2026-05-29 Leon round-99 → round-100 — buffered ranges 数组 (单位:秒)。
   * HTMLMediaElement.buffered 是 TimeRanges,seek 后会有多段非连续 range,e.g.
   * [{start:0,end:30}, {start:60,end:80}]。Round-99 只取"包含 currentTime 的段"
   * 显示一段,seek 留下的 buffer 孤岛 (Leon round-100 截图末尾那节) 看不见。
   * 改成存全部 ranges,trackBg multi-stop gradient 渲染所有 buffered 区间。 */
  const [bufferedRanges, setBufferedRanges] = useState([]);
  const [duration, setDuration]     = useState(0);
  const [volume, setVolume]         = useState(1);
  const [muted, setMuted]           = useState(false);
  const [speed, setSpeed]           = useState(1);
  /* §2026-05-29 Leon round-106 — Repeat mode 'off'|'all'|'one' (替代旧 loop bool)。
   * 'one' → video.loop=true (单视频循环);'all' → 上报 caller 循环播放列表;
   * 'off' → 播完不循环 (autoplay/stop 由 ∞ + onNext 决定)。 */
  const [repeatMode, setRepeatMode] = useState('off');
  const [isFullscreen, setIsFullscreen] = useState(false);
  /* §2026-05-28 Leon round-82 — actual decoded resolution (videoHeight from
   * <video> element)。Resolution button label 显示当前实际播放的 height,
   * 而非字面 "Auto"(Leon spec):
   *   - Auto mode (currentLevel=-1):ABR 自动选的实际 level 不暴露给 React
   *     (hls.autoLevelEnabled 状态),所以读 videoHeight 直接拿 decoded frame
   *   - Manual mode:label 由 levels[currentLevel].height 给(精确匹配 picked)
   * 'resize' 事件 fire on ABR ladder switch (Safari native HLS),保证 badge
   * 不被冻在 first-load 值。 */
  const [intrinsicHeight, setIntrinsicHeight] = useState(0);
  /* §2026-05-28 Leon round-83 — PiP state。
   * 仅 desktop Chrome / Edge / Safari 14+ 支持 document.pictureInPictureEnabled。
   * Firefox 跟移动端均不支持,buton 自动 hide 通过 pipSupported check。 */
  const [isPiP, setIsPiP] = useState(false);
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;
  /* §2026-05-28 Leon round-94 — Safari UA 检测(给 fullscreen Live Text
   * overlay 让位)。Safari 18+ 在 video fullscreen + 暂停时自动加 system
   * Live Text 浮层在右下角,会覆盖我们的 CornersIn。无 JS/CSS API 可禁。
   * Workaround:Safari + fullscreen 时给 right action group 加 pr-10 右内
   * 边距,留 40px 让 Safari 浮层占用,不互相覆盖。 */
  const isSafari = typeof navigator !== 'undefined'
    && /^((?!chrome|android).)*safari/i.test(navigator.userAgent || '');
  /* §2026-05-28 Leon round-93 — ended state for center Replay overlay。
   * 'ended' 事件 fire 后,中心显 VideoReplayButton (80×80 .glass-hero) 替代
   * Play overlay。再 play 重置 currentTime=0 + clear isEnded。 */
  const [isEnded, setIsEnded] = useState(false);

  // popover/dropdown open state
  const [resMenuOpen, setResMenuOpen] = useState(false);
  const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
  const resBtnRef = useRef(null);
  const speedBtnRef = useRef(null);
  const [resMenuRect, setResMenuRect] = useState(null);
  const [speedMenuRect, setSpeedMenuRect] = useState(null);

  // Sync video → React state via events
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onPlay  = () => { setIsPlaying(true); setIsEnded(false); };
    const onPause = () => setIsPlaying(false);
    /* §2026-05-29 Leon round-106 — autoplay-advance:video.loop (repeat 'one')
     * 时 'ended' 不 fire,无需处理。非 loop + autoplay + 有 onNext → 自动前进。
     * 否则正常进 ended 态 (显 Replay overlay)。 */
    const onEnded = () => {
      setIsPlaying(false);
      if (autoplay && typeof onNext === 'function') {
        onNext();
        return;
      }
      setIsEnded(true);
    };
    const onTime  = () => setCurrentTime(v.currentTime || 0);
    const onMeta  = () => {
      setDuration(v.duration || 0);
      // §2026-05-28 Leon round-97 — intrinsic 存 short edge (portrait video 兼容)。
      // 横屏 1280x720 → short = 720 → "720p"
      // 竖屏 720x1280 → short = 720 → "720p" (而非 frame height 1280)
      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      const shortEdge = w > 0 && h > 0 ? Math.min(w, h) : h;
      if (shortEdge > 0) setIntrinsicHeight(shortEdge);
    };
    const onVol   = () => { setVolume(v.volume); setMuted(v.muted); };
    const onRate  = () => setSpeed(v.playbackRate || 1);
    const onResize = () => {
      // ABR ladder switch (Safari native HLS) → videoHeight 变化,Resolution
      // label 反映实际 playing level (Leon round-82)
      // §2026-05-28 Leon round-97 — short edge (portrait video 兼容)
      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      const shortEdge = w > 0 && h > 0 ? Math.min(w, h) : h;
      if (shortEdge > 0) setIntrinsicHeight(shortEdge);
    };
    // initial sync
    setIsPlaying(!v.paused);
    setCurrentTime(v.currentTime || 0);
    setDuration(v.duration || 0);
    setVolume(v.volume);
    setMuted(v.muted);
    setSpeed(v.playbackRate || 1);
    setRepeatMode(v.loop ? 'one' : 'off');  // §round-106 — video.loop → repeat 'one'
    // §2026-05-28 Leon round-97 — short edge (portrait video 兼容)
    {
      const w = v.videoWidth || 0;
      const h = v.videoHeight || 0;
      setIntrinsicHeight(w > 0 && h > 0 ? Math.min(w, h) : h);
    }

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('durationchange', onMeta);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('ratechange', onRate);
    v.addEventListener('resize', onResize);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('durationchange', onMeta);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('ratechange', onRate);
      v.removeEventListener('resize', onResize);
    };
  }, [videoRef, autoplay, onNext]);

  /* §2026-05-28 Leon round-96 — rAF loop 60Hz 更新 currentTime。
   * HTMLMediaElement timeupdate 事件浏览器实测 ~4Hz (250ms 间隔),进度条
   * fill 每 250ms 跳一次 → 视觉上明显步阶感。requestAnimationFrame 在播放
   * 期间持续读 video.currentTime,达到 60Hz 平滑 fill (跟 monitor refresh
   * 同步)。Paused 时 stop rAF,timeupdate 仍兜底 seek/scrub 的精确同步。
   * Tab 切后台 rAF 自动暂停,零耗电开销。 */
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return undefined;

    /* §2026-05-29 Leon round-100 — 从 video.buffered (TimeRanges) 读全部
     * range 段,数组形式给 trackBg multi-stop gradient 用。seek 后留下的
     * 孤岛 buffer 段都正确显示。 */
    const readAllBufferedRanges = () => {
      const b = v.buffered;
      if (!b || !b.length) return [];
      const out = [];
      for (let i = 0; i < b.length; i++) {
        out.push({ start: b.start(i), end: b.end(i) });
      }
      return out;
    };

    let rafId = null;
    const tick = () => {
      setCurrentTime(v.currentTime || 0);
      setBufferedRanges(readAllBufferedRanges());
      rafId = requestAnimationFrame(tick);
    };
    const startRaf = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(tick);
    };
    const stopRaf = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
    /* §2026-05-29 Leon round-99 — progress event 兜底:paused 时 rAF 停,但
     * 后台仍可能继续 buffer (mp4 preload / HLS pre-fetch) — progress event
     * fire on buffer 增加,确保 paused 状态下 buffered 指示也实时更新。 */
    const onProgress = () => setBufferedRanges(readAllBufferedRanges());

    if (!v.paused) startRaf();
    setBufferedRanges(readAllBufferedRanges()); // initial sync
    v.addEventListener('play', startRaf);
    v.addEventListener('pause', stopRaf);
    v.addEventListener('ended', stopRaf);
    v.addEventListener('progress', onProgress);
    return () => {
      stopRaf();
      v.removeEventListener('play', startRaf);
      v.removeEventListener('pause', stopRaf);
      v.removeEventListener('ended', stopRaf);
      v.removeEventListener('progress', onProgress);
    };
  }, [videoRef]);

  /* §2026-05-28 Leon round-93 — click video toggle play/pause。
   * customControls 关了 native controls,默认 click 不 toggle。这里给 video
   * element 加 click listener:click → togglePlay (符合 user expectation +
   * Leon spec "点击视频暂停")。 */
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onClick = () => {
      if (isEnded) {
        v.currentTime = 0;
        setIsEnded(false);
        v.play()?.catch(() => {});
      } else if (v.paused) {
        v.play()?.catch(() => {});
      } else {
        v.pause();
      }
    };
    v.addEventListener('click', onClick);
    return () => v.removeEventListener('click', onClick);
  }, [videoRef, isEnded]);

  // Sync fullscreen state
  useEffect(() => {
    const onFsChange = () => {
      const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      const c = containerRef?.current;
      setIsFullscreen(!!fsEl && (fsEl === c || (c && c.contains?.(fsEl))));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [containerRef]);

  /* §2026-05-28 Leon round-83 — sync PiP state via video element events。
   * enterpictureinpicture / leavepictureinpicture 是 spec 标准事件。 */
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onEnter = () => setIsPiP(true);
    const onLeave = () => setIsPiP(false);
    v.addEventListener('enterpictureinpicture', onEnter);
    v.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter);
      v.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [videoRef]);

  // Measure dropdown anchor rect for portal positioning
  useLayoutEffect(() => {
    if (resMenuOpen && resBtnRef.current) {
      const r = resBtnRef.current.getBoundingClientRect();
      setResMenuRect(r);
    }
  }, [resMenuOpen]);
  useLayoutEffect(() => {
    if (speedMenuOpen && speedBtnRef.current) {
      const r = speedBtnRef.current.getBoundingClientRect();
      setSpeedMenuRect(r);
    }
  }, [speedMenuOpen]);

  // ─────────────────────────────────────────────────────────────────────
  // Action handlers
  // ─────────────────────────────────────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef?.current;
    if (!v) return;
    /* §2026-05-29 Leon round-98 — ended 时 reset currentTime 再 play,跟 click-on-video
     * handler (round-93) 同 isEnded 分支一致。原 togglePlay 只看 v.paused,
     * ended 时 v.paused=true 但 v.play() 不 reset → 立即又 ended → 看起来"按了
     * 不播"。Leon round-98 报。 */
    if (isEnded) {
      v.currentTime = 0;
      setIsEnded(false);
      v.play()?.catch(() => {});
      return;
    }
    if (v.paused) v.play()?.catch(() => {});
    else v.pause();
  };

  const handleReplay = () => {
    const v = videoRef?.current;
    if (!v) return;
    v.currentTime = 0;
    setIsEnded(false);
    v.play()?.catch(() => {});
  };

  const toggleMute = () => {
    const v = videoRef?.current;
    if (!v) return;
    v.muted = !v.muted;
  };

  const handleVolumeChange = (e) => {
    const v = videoRef?.current;
    if (!v) return;
    const val = Number(e.target.value);
    v.volume = val;
    if (val > 0 && v.muted) v.muted = false;
  };

  const handleSeek = (e) => {
    const v = videoRef?.current;
    if (!v || !duration) return;
    v.currentTime = Number(e.target.value);
  };

  const applySpeed = (rate) => {
    const v = videoRef?.current;
    if (!v) return;
    v.playbackRate = rate;
    setSpeedMenuOpen(false);
  };

  const applyResolution = (idx) => {
    onResolutionChange?.(idx);
    setResMenuOpen(false);
  };

  /* §2026-05-28 Leon round-85 — applyTier:用户点标准档位 (1080p/720p/...),
   * hls.js 找最接近的实际 level 切。如果 levels 数组缺该 tier,fallback 到
   * 高度最接近的。Safari (levels=[]) 无 tier 可切,这函数不会被调到 (UI 已
   * gate by levels.length > 0)。 */
  const applyTier = (targetHeight) => {
    if (!levels.length) return;
    // §2026-05-28 Leon round-97 — match by short edge (portrait video 兼容)
    // 1. exact match
    let match = levels.find(l => levelShortEdge(l) === targetHeight);
    // 2. closest match (short-edge distance sort)
    if (!match) {
      match = [...levels].sort((a, b) =>
        Math.abs(levelShortEdge(a) - targetHeight) - Math.abs(levelShortEdge(b) - targetHeight)
      )[0];
    }
    applyResolution(match?.index ?? -1);
  };

  /* §2026-05-29 Leon round-103 — handleDownload。
   * caller 提供 onDownload (LibraryPage 既有 downloadVideo.js blob 流程) → 直接调。
   * 否则 fallback browser 原生 download:从 video 元素取 currentSrc,生成 <a download>
   * dispatch click。CORS 跨域时浏览器会忽略 download 属性当作 navigate,但 R2/Stream
   * 资产通常同源或开了 ACAO,实际 work。HLS .m3u8 src 直接 download 会拿到 manifest
   * 文本不是视频,所以 m3u8 caller 必须传 onDownload (走 downloadVideo.js blob 合并)。 */
  const handleDownload = useCallback(() => {
    if (typeof onDownload === 'function') {
      onDownload();
      return;
    }
    const v = videoRef?.current;
    const src = v?.currentSrc || v?.src;
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [onDownload, videoRef]);

  /* §2026-05-29 Leon round-106 — 🔁 Repeat cycle off → all → one → off。
   *   'one' → video.loop=true (单视频循环,'ended' 不 fire)
   *   'all' → video.loop=false,上报 caller 循环播放列表 (onNext at end)
   *   'off' → video.loop=false,播完按 autoplay/stop
   * onRepeatChange(mode) 让 caller 拿到状态 (处理 'all')。 */
  const cycleRepeat = () => {
    const v = videoRef?.current;
    const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    setRepeatMode(next);
    if (v) v.loop = (next === 'one');
    onRepeatChange?.(next);
  };

  const togglePiP = useCallback(async () => {
    const v = videoRef?.current;
    if (!v || !pipSupported) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        await v.requestPictureInPicture();
      }
    } catch (e) {
      // NotAllowedError if user denied / video too small / etc — harmless
      console.debug('[PlayerActionBar] PiP toggle skipped:', e?.message);
    }
  }, [videoRef, pipSupported]);

  const toggleFullscreen = useCallback(() => {
    const c = containerRef?.current;
    if (!c) return;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      exit?.call(document).catch(() => {});
    } else {
      const req = c.requestFullscreen || c.webkitRequestFullscreen;
      req?.call(c).catch(() => {});
    }
  }, [containerRef]);

  // ─────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────
  const fmtTime = (sec) => {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Volume icon swap by level (idle / low / mute)
  const VolIcon = muted || volume === 0
    ? SpeakerSlash
    : volume < 0.5 ? SpeakerLow : SpeakerHigh;

  /* Resolution label — §2026-05-28 Leon round-82 (revised):
   *   显示**当前实际播放分辨率**(浏览者眼里看到的)而非字面 "Auto"。
   *   - Auto mode (currentLevel=-1):ABR 自动选的实际 level 不暴露给 React,
   *     用 intrinsicHeight (videoElement.videoHeight) 作为 truth source
   *     (Safari native HLS / hls.js auto 都更新这个值)。
   *   - Manual mode:用 levels[currentLevel].height (精确匹配 picked 档位)。
   *   - Fallback:都没有时显示 — (avoid showing stale 'Auto' label)。 */
  const resLabel = (() => {
    if (currentLevel !== -1) {
      const lvl = levels.find(l => l.index === currentLevel);
      const tier = levelShortEdge(lvl);
      if (tier) return `${tier}p`;
    }
    if (intrinsicHeight > 0) return `${intrinsicHeight}p`;
    return '—';
  })();

  /* §2026-05-28 Leon round-85 — Resolution dropdown 改固定标准档位列表
   * (覆盖 80%+ 视频常见档位),按视频本体最高分辨率截断:
   *   - 视频本体 720p → 列 720/480/360/240(不显 1080p,超本体上限)
   *   - 视频本体 1080p → 列 1080/720/480/360/240
   *   - 视频本体 4K → 列 1080/720/480/360/240(我们 ladder cap 1080,够用)
   *
   * 用户点击 tier:applyTier 找 hls.js levels 数组里 height 最接近的实际
   * level 切。Safari (levels=[]) 无 tier 可切 → tier 列表跳过(只显 Auto)。
   *
   * 视频本体最高 = max(...levels.map(h), intrinsicHeight)。先取 hls.js 完整
   * ladder 的 max,无 levels 时退而求 intrinsic(可能不是真本体最高,但
   * Safari 场景反正切不了,只用于 visual capping 不影响功能)。 */
  const STANDARD_TIERS = [1080, 720, 480, 360, 240];
  // §2026-05-28 Leon round-97 — sourceMaxHeight 用 short edge (portrait video 兼容)
  const sourceMaxHeight = Math.max(
    ...levels.map(l => levelShortEdge(l)),
    intrinsicHeight,
    0
  );
  const visibleTiers = STANDARD_TIERS.filter(h => h <= sourceMaxHeight);
  // Selected tier = 当前 playing label 的 short edge (Auto 模式下 intrinsic,Manual 下 level)
  const currentPlayingHeight = (() => {
    if (currentLevel !== -1) {
      const lvl = levels.find(l => l.index === currentLevel);
      const tier = levelShortEdge(lvl);
      if (tier) return tier;
    }
    return intrinsicHeight;
  })();

  // Don't render on mobile / coarse pointer — caller falls back to native controls
  if (!isPointerFine) return null;

  // Slider gradient (filled portion accent, rest semi-transparent track)
  /* §2026-05-29 Leon round-100 — trackBg multi-stop gradient with all
   * buffered ranges:
   *   - 0 → playedPct: 已播 (0.85,最不透明)
   *   - playedPct 之后,每个 buffered range 内: 已缓冲 (0.42)
   *   - 其余: 未缓冲 (0.20)
   * 多段 ranges (seek 后形成的孤岛 buffer) 全部正确显示。
   *
   * 兼容:caller 不传 ranges → 退化纯 2-stop (volume slider 无 buffer 概念)。
   *
   * 参数:
   *   playedPct - 0..100,已播部分百分比
   *   bufRangesPct - [{start, end}] 百分比单位 (caller 提前算好,避免每次
   *     trackBg 调用都 re-map)
   */
  const trackBg = (playedPct, bufRangesPct) => {
    const stops = [`rgba(255,255,255,0.85) 0%`, `rgba(255,255,255,0.85) ${playedPct}%`];
    let pos = playedPct;
    const ranges = (bufRangesPct || [])
      .map(r => ({ start: Math.max(r.start, 0), end: Math.min(r.end, 100) }))
      .filter(r => r.end > playedPct)
      .sort((a, b) => a.start - b.start);
    for (const r of ranges) {
      const start = Math.max(r.start, pos);
      const end = Math.max(r.end, pos);
      if (end <= pos) continue;
      if (start > pos) {
        stops.push(`rgba(255,255,255,0.20) ${pos}%`);
        stops.push(`rgba(255,255,255,0.20) ${start}%`);
      }
      stops.push(`rgba(255,255,255,0.42) ${start}%`);
      stops.push(`rgba(255,255,255,0.42) ${end}%`);
      pos = end;
    }
    if (pos < 100) {
      stops.push(`rgba(255,255,255,0.20) ${pos}%`);
      stops.push(`rgba(255,255,255,0.20) 100%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  };
  const volPct = (muted ? 0 : volume) * 100;
  const seekPct = duration ? (currentTime / duration) * 100 : 0;
  /* §2026-05-29 Leon round-101 — buffered end snap 到 100%。
   * HLS 最后一个 segment 通常略短于 manifest 报的 duration (~0.5-2s),
   * mp4 浮点精度也可能让 end < duration 一点点 → endPct = 98-99.5% 末尾
   * 留 sliver 暗灰 (Leon 截图)。tolerance 1% 内视为到底,snap 到 100。
   * Start 端不做 snap (用户 seek 起点可能正好接近 0,误 snap 会错误显示
   * "buffer 从 0 开始")。 */
  const bufRangesPct = duration
    ? bufferedRanges.map(r => {
        const startPct = (r.start / duration) * 100;
        let endPct = (r.end / duration) * 100;
        if (endPct >= 99) endPct = 100;
        return { start: startPct, end: endPct };
      })
    : [];

  // Common chip btn class — glass pill 28×28
  const chipBtn = 'w-7 h-7 flex items-center justify-center rounded-full text-white/95 hover:bg-white/15 cursor-pointer transition-colors';
  /* §2026-05-29 Leon round-106 — transport mode toggle (🔁 / ∞) 专用 className builder。
   * 关键:layout-only base,不含 chipBtn 的 text-white/95 —— 否则 off 状态的
   * text-white/40 跟 chipBtn 的 text-white/95 是两个竞争 text utility,Tailwind
   * 生成顺序不保证 /40 赢 → off 渲染成亮白看似 active (Leon round-106 报 "off 无法识别")。
   * 纯 base 后,off=text-white/40 唯一 text color,可靠渲染 dim;active=accent。 */
  const toggleBtn = (active) =>
    `w-7 h-7 flex items-center justify-center rounded-full cursor-pointer transition-colors ${
      active ? 'bg-accent/20 text-accent' : 'text-white/40 hover:bg-white/15 hover:text-white/70'
    }`;

  /* §2026-05-28 Leon round-82 — 2-row layout (参考 SparkMode / 主流 player):
   *   Row 1 (top):full-width progress bar + 时间 (elapsed 在左,total 在右)
   *   Row 2 (bot):Play/Pause(左) | 右 action group: Vol/Res/Speed/Autoplay/FS
   *   原 1-row 单条 (round-81) 视觉拥挤 + 进度条太短不便 seek。
   *
   * §2026-05-28 Leon round-93 — 加 center Play / Replay overlay (套 SparkMode):
   *   暂停:中心显 .glass-hero 80×80 Play btn (filled icon size 32)
   *   播完:中心显 VideoReplayButton (现成 composite,ArrowCounterClockwise) */
  return (
    <>
      {/* Center Play / Replay overlay — 暂停/播完时 80×80 .glass-hero。
        * pointer-events-none on container 让 video click toggle 不被拦截;
        * button 上 pointer-events-auto 接 click。 */}
      {!isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[2]">
          {isEnded ? (
            <VideoReplayButton onClick={handleReplay} className="pointer-events-auto" />
          ) : (
            <button
              type="button"
              onClick={togglePlay}
              aria-label="Play"
              className="glass-hero w-20 h-20 rounded-full flex items-center justify-center cursor-pointer pointer-events-auto"
            >
              <Play size={32} weight="fill" className="text-white ml-1" />
            </button>
          )}
        </div>
      )}

    <div
      className={`absolute left-0 right-0 bottom-0 px-3 pt-2 pb-2 bg-gradient-to-t from-black/70 via-black/40 to-transparent z-[3] ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ════════════════════════ Row 1: Progress + Time ════════════════════════ */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] text-white/80 tabular-nums shrink-0">{fmtTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={handleSeek}
          className="uvera-player-slider flex-1 h-1 rounded-full appearance-none cursor-pointer"
          style={{ background: trackBg(seekPct, bufRangesPct) }}
          aria-label="Seek"
        />
        <span className="text-[11px] text-white/80 tabular-nums shrink-0">{fmtTime(duration)}</span>
      </div>

      {/* ════════════════════════ Row 2: Controls ════════════════════════ */}
      <div className="flex items-center justify-between">
        {/* ════ Left: Transport 簇 [🔁][⏮ ▶/⏸(大) ⏭][∞] (round-106 Apple Music) ════
          * 🔁 Repeat / ∞ Autoplay = mode toggle,off 时 dim (text-white/40),
          *   on 时 accent (bg-accent/15 text-accent,memory rule 11)。
          * ⏮ ▶ ⏭ = 播放控制,常亮。Play 放大 (36px) 建立主次。
          * ⏮⏭∞ caller-gated:onPrev/onNext 传才显 (单视频 caller 无下一项 → 不显)。 */}
        <div className="flex items-center gap-1">
          {/* 🔁 Repeat — off → all → one cycle */}
          <Tooltip content={repeatMode === 'one' ? 'Repeat one' : repeatMode === 'all' ? 'Repeat all' : 'Repeat'}>
            <button
              onClick={cycleRepeat}
              className={toggleBtn(repeatMode !== 'off')}
              aria-label="Repeat"
              aria-pressed={repeatMode !== 'off'}
            >
              {repeatMode === 'one'
                ? <RepeatOnce size={16} weight="bold" />
                : <Repeat size={16} weight={repeatMode === 'all' ? 'bold' : 'regular'} />}
            </button>
          </Tooltip>

          {/* ⏮ Prev (caller-gated) */}
          {onPrev && (
            <Tooltip content="Previous">
              <button onClick={onPrev} className={chipBtn} aria-label="Previous">
                <SkipBack size={16} weight="fill" />
              </button>
            </Tooltip>
          )}

          {/* ▶/⏸ Play — 放大 36px (Apple Music hierarchy) */}
          <Tooltip content={isPlaying ? 'Pause' : 'Play'}>
            <button
              onClick={togglePlay}
              className="w-9 h-9 flex items-center justify-center rounded-full text-white hover:bg-white/15 cursor-pointer transition-colors"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying
                ? <Pause size={22} weight="fill" />
                : <Play size={22} weight="fill" className="ml-0.5" />}
            </button>
          </Tooltip>

          {/* ⏭ Next (caller-gated) */}
          {onNext && (
            <Tooltip content="Next">
              <button onClick={onNext} className={chipBtn} aria-label="Next">
                <SkipForward size={16} weight="fill" />
              </button>
            </Tooltip>
          )}

          {/* ∞ Autoplay (caller-gated:需 onNext 才有意义) */}
          {showAutoplay && onNext && (
            <Tooltip content={autoplay ? 'Autoplay on' : 'Autoplay off'}>
              <button
                onClick={() => onAutoplayChange?.(!autoplay)}
                className={toggleBtn(autoplay)}
                aria-label="Autoplay"
                aria-pressed={autoplay}
              >
                <InfinityIcon size={16} weight={autoplay ? 'bold' : 'regular'} />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Right action group:
          *   [Volume(L)] [Resolution] [Speed] [Autoplay] [Fullscreen]
          * Volume 是 right-group 最左 item,hover 向左展开 slider (Leon round-81 spec)。
          * §2026-05-28 Leon round-94 — Safari fullscreen 时加 pr-10 让 Live
          * Text 系统浮层有空间不覆盖 CornersIn。 */}
        <div className={`flex items-center gap-1 ${isSafari && isFullscreen ? 'pr-10' : ''}`}>

        {/* ── Volume (hover-expand 向左) ──
          * Default:仅 speaker icon (28×28)
          * Hover:slider 从 width 0 → 64px 从左侧滑出,opacity 0 → 1
          * Click speaker:toggle mute
          * Click slider:scrub 音量 */}
        <div className="group flex items-center">
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={handleVolumeChange}
            aria-label="Volume"
            className="uvera-player-slider h-1 rounded-full appearance-none cursor-pointer origin-right transition-all duration-200 w-0 opacity-0 group-hover:w-16 group-hover:opacity-100 group-hover:mr-2"
            style={{ background: trackBg(volPct) }}
          />
          <Tooltip content={muted ? 'Unmute' : 'Mute'}>
            <button onClick={toggleMute} className={chipBtn} aria-label={muted ? 'Unmute' : 'Mute'}>
              <VolIcon size={16} weight="fill" />
            </button>
          </Tooltip>
        </div>

        {/* ── Resolution dropdown (Speed 左侧) ──
          * Label 显示当前实际播放分辨率 (Leon round-82)。无 CaretDown。
          * §2026-05-28 Leon round-84 — 渲染条件放宽到 "有 metadata 即可"
          * (intrinsicHeight > 0 OR levels > 0)。始终 clickable,弹 dropdown:
          *   - levels > 1:Auto + 各 levels 多选 (hls.js 视频)
          *   - levels <= 1(Safari native HLS / 单档 Stream / 直 mp4):dropdown
          *     只显 "Auto" 一项(选不了别的但至少看得到当前 res + 一致 UX)
          *
          * 历史:
          *   round-82 levels<=1 时 disabled button 仍渲染 → Leon "点击不弹出"
          *   round-83 改成只 levels>1 时渲染 → Leon "不见了" (单档 / Safari 隐藏)
          *   round-84 折中:始终可见且可点,内容 degrade gracefully */}
        {(levels.length > 0 || intrinsicHeight > 0) && (
          <Tooltip content="Resolution">
            <button
              ref={resBtnRef}
              onClick={() => setResMenuOpen(o => !o)}
              className={`${chipBtn} w-auto px-2 text-[11px] font-medium tabular-nums`}
              aria-label="Resolution"
              aria-expanded={resMenuOpen}
            >
              {resLabel}
            </button>
          </Tooltip>
        )}

        {/* ── Speed dropdown ── 无 CaretDown (Leon round-82 #3) */}
        <Tooltip content="Playback speed">
          <button
            ref={speedBtnRef}
            onClick={() => setSpeedMenuOpen(o => !o)}
            className={`${chipBtn} w-auto px-2 text-[11px] font-medium tabular-nums`}
            aria-label="Speed"
            aria-expanded={speedMenuOpen}
          >
            {speed}×
          </button>
        </Tooltip>

        {/* §2026-05-29 Leon round-106 — 旧 ∞ Autoplay(=loop)已移到左 transport 簇:
          * loop 功能归 🔁 Repeat,∞ 归 autoplay-advance。此处右簇不再放 ∞。 */}

        {/* ── Download ── §2026-05-29 Leon round-103 (round-106 移到 PiP 前,
          * 顺序对齐 doc 矩阵:Volume / Resolution / Speed / Download / PiP / Fullscreen)。
          * caller 算 showDownload (isOwner || work.allow_download)。
          * onDownload 未传时用 browser 原生 <a download> fallback。 */}
        {showDownload && (
          <Tooltip content="Download">
            <button
              onClick={handleDownload}
              className={chipBtn}
              aria-label="Download"
            >
              <DownloadSimple size={16} weight="bold" />
            </button>
          </Tooltip>
        )}

        {/* ── Picture-in-Picture (PiP) ──
          * §2026-05-28 Leon round-83 Q2 — native controls 关掉后 PiP 入口
          * 没了,需要自建 button。Phosphor PictureInPicture icon。
          * Browser support:Chrome / Edge / Safari 14+,Firefox 不支持 →
          * document.pictureInPictureEnabled === false 时整 button 隐藏。
          * caller 可传 showPiP={false} 隐藏 (e.g. fullscreen-locked context)。 */}
        {showPiP && pipSupported && (
          <Tooltip content={isPiP ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}>
            <button
              onClick={togglePiP}
              className={`${chipBtn} ${isPiP ? 'bg-accent/30' : ''}`}
              aria-label={isPiP ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
              aria-pressed={isPiP}
            >
              <PictureInPicture size={16} weight="bold" />
            </button>
          </Tooltip>
        )}

        {/* ── Fullscreen ── */}
        <Tooltip content={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <button
            onClick={toggleFullscreen}
            className={chipBtn}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen
              ? <CornersIn size={16} weight="bold" />
              : <CornersOut size={16} weight="bold" />}
          </button>
        </Tooltip>
        </div>{/* /Right action group */}
      </div>{/* /Row 2 controls */}

      {/* ── Resolution dropdown portal ──
        * §2026-05-28 Leon round-92 — 完全套 SparkMode speed/quality popup 样式
        * (Leon: "直接调用 Discover/spark mode 的样式,不要试来试去,直接完整
        * 套用样式")。Source-of-truth = src/components/SparkMode.jsx:2334-2377。
        *
        * Container:.glass-frosted-edge (T-1a supporting tier) + borderRadius:20
        *   + padding:8 + minWidth:96 (跟 quality dropdown 同 minWidth)。
        * Items:px-3 py-1.5 rounded-full text-xs font-semibold tabular-nums。
        *   Active = text-vision-primary + bg rgba(255,255,255,0.20) white well。
        *   Inactive = text-vision-secondary + transparent;hover bg 0.10。
        * Position:center-X 到 button (translateX -50%),button 上方 8px gap。
        *
        * Safari (levels=[]):只显 Auto(Leon round-92 #1),不显 tier 列表。
        * Chrome (levels>0):Auto + visibleTiers DESC。 */}
      {resMenuOpen && resMenuRect && createPortal(
        <>
          <div
            onClick={() => setResMenuOpen(false)}
            className="fixed inset-0 z-[9998]"
          />
          <div
            className="glass-frosted-edge flex flex-col"
            style={{
              position: 'fixed',
              zIndex: 9999,
              left: resMenuRect.left + resMenuRect.width / 2,
              top: resMenuRect.top - 8,
              transform: 'translate(-50%, -100%)',
              borderRadius: 20,
              padding: 8,
              minWidth: 96,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Auto — 永远在最上 */}
            {(() => {
              const active = currentLevel === -1;
              return (
                <button
                  onClick={() => applyResolution(-1)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer tabular-nums transition-colors ${active ? 'text-vision-primary' : 'text-vision-secondary'}`}
                  style={{ background: active ? 'rgba(255,255,255,0.20)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  Auto
                </button>
              );
            })()}
            {/* 标准档位 1080/720/480/360/240(本体最高以下) — Chrome (levels>0)
              * 才显示;Safari (levels=[]) 跳过,只 Auto 可选 (Leon round-92 #1)。 */}
            {levels.length > 0 && visibleTiers.map(h => {
              const active = currentLevel !== -1 && currentPlayingHeight === h;
              return (
                <button
                  key={h}
                  onClick={() => applyTier(h)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer tabular-nums transition-colors ${active ? 'text-vision-primary' : 'text-vision-secondary'}`}
                  style={{ background: active ? 'rgba(255,255,255,0.20)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {h}p
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}

      {/* ── Speed dropdown portal ──
        * §2026-05-28 Leon round-92 — 完全套 SparkMode speed popup 样式 +
        * 倍速顺序高→低 (Leon: "speed list 倍速顺序反了。这个也是已经验证
        * 通过的东西重新造轮子,给自己制造问题")。
        * 顺序:2× / 1.5× / 1.25× / 1× / 0.75× / 0.5× (高→低)。 */}
      {speedMenuOpen && speedMenuRect && createPortal(
        <>
          <div
            onClick={() => setSpeedMenuOpen(false)}
            className="fixed inset-0 z-[9998]"
          />
          <div
            className="glass-frosted-edge flex flex-col"
            style={{
              position: 'fixed',
              zIndex: 9999,
              left: speedMenuRect.left + speedMenuRect.width / 2,
              top: speedMenuRect.top - 8,
              transform: 'translate(-50%, -100%)',
              borderRadius: 20,
              padding: 8,
              minWidth: 72,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 高→低排序(用户视觉自上而下扫描)*/}
            {[2, 1.5, 1.25, 1, 0.75, 0.5].map(rate => {
              const active = speed === rate;
              return (
                <button
                  key={rate}
                  onClick={() => applySpeed(rate)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer tabular-nums transition-colors ${active ? 'text-vision-primary' : 'text-vision-secondary'}`}
                  style={{ background: active ? 'rgba(255,255,255,0.20)' : 'transparent' }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.10)'; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {rate}×
                </button>
              );
            })}
          </div>
        </>,
        document.body
      )}
    </div>
    </>
  );
}

export default PlayerActionBar;

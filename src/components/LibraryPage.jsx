import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CardsThree, Smiley, FilmSlate, VideoCamera, PencilSimple, CircleNotch, Plus, X, Lock, LockKey, Globe, ShareNetwork, Trash, TreeStructure, CaretLeft, ArrowRight, Check, ArrowsLeftRight, FilmStrip, Eye, Archive, CheckCircle, CloudArrowUp, Hourglass, XCircle, Sparkle, UserCircle, PictureInPicture, DownloadSimple, Play, Pause, SpeakerHigh, SpeakerSlash, CornersOut, CornersIn, ArrowsClockwise } from '@phosphor-icons/react';
import OverlayCtrlBtn from '../design-system/composites/OverlayCtrlBtn';
import { openSubscriptionModal } from '../utils/subscriptionModal';
import { VideoReplayButton } from '../design-system/composites/VideoOverlayButtons';
import SegmentedControl from '../design-system/composites/SegmentedControl';
import Toggle from '../design-system/primitives/Toggle';
import { SIDEBAR_MODE } from '../hooks/useSidebarState';
import { supabase, handleShareCredits, getUserProfile } from '../api/supabaseClient';
import { canCreateActor, getTierLimits, getNextTier, TIER_DISPLAY } from '../data/plans';
import { listDrafts, deleteDraft as deleteServerDraft } from '../api/draftService';
import { COVER_PLACEHOLDER } from '../utils/coverPlaceholder';
import { downloadVideo } from '../utils/downloadVideo';
import UnifiedVideoPlayer from './UnifiedVideoPlayer';
import { isLoopSelf } from '../utils/contentType';
import InlineCharacterCreator from './InlineCharacterCreator';

/*
 * LibraryPage — IA-v2 §3.2
 *
 * Inner tabs:
 *   Avatars  — user's Digital Avatars (initial quota = 3)
 *   Works    — works the user authored / produced
 *   Series   — short drama series
 *   Uploads  — raw uploads
 *   Drafts   — in-progress Create sessions
 *
 * §2026-05-29 Leon round-105 — Recasts tab 完全删除 (Recast 产品功能取消)。
 */
const TABS = [
  { value: 'avatars',     label: 'Avatars',     icon: Smiley       },
  { value: 'works',       label: 'Works',       icon: FilmSlate    },
  { value: 'series',      label: 'Series',      icon: FilmStrip    },
  { value: 'uploads',     label: 'Uploads',     icon: CloudArrowUp },
  { value: 'drafts',      label: 'Drafts',      icon: PencilSimple },
];

const SeriesTreeNode = ({ node, allNodes, onPlay }) => {
  const children = node.children.map(cid => allNodes.find(n => n.id === cid)).filter(Boolean);
  
  return (
    <div className="flex flex-col items-center">
      <div 
        className="w-40 sm:w-48 bg-background-secondary rounded-xl overflow-hidden border border-background-tertiary shadow-sm cursor-pointer hover:border-accent hover:shadow-accent/20 hover:shadow-lg transition-all group relative z-10"
        onClick={() => onPlay(node)}
      >
        <div className="aspect-video relative bg-black">
          <img src={node.cover || COVER_PLACEHOLDER} alt={node.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 opacity-80 group-hover:opacity-100" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-accent text-white flex items-center justify-center backdrop-blur-md">
              <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"></path></svg>
            </div>
          </div>
          <div className="absolute bottom-2 left-2 flex gap-1">
            {node.tags && node.tags.map(t => (
              <span key={t} className="px-1.5 py-0.5 bg-black/60 backdrop-blur-sm text-[8px] font-medium text-white rounded uppercase tracking-wider">{t}</span>
            ))}
          </div>
        </div>
        <div className="p-3">
          <p className="text-xs text-label font-medium line-clamp-2 text-center">{node.title}</p>
        </div>
      </div>
      
      {children.length > 0 && (
        <div className="flex justify-center relative pt-8">
          <div className="absolute top-0 left-1/2 w-px h-8 bg-white/20 -translate-x-1/2"></div>
          
          {children.map((child, index) => {
            const isFirst = index === 0;
            const isLast = index === children.length - 1;
            const isOnly = children.length === 1;
            return (
              <div key={child.id} className="relative px-2 sm:px-4 flex flex-col items-center">
                {!isOnly && (
                  <>
                    {!isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-white/20"></div>}
                    {!isLast && <div className="absolute top-0 left-1/2 right-0 h-px bg-white/20"></div>}
                  </>
                )}
                <div className="absolute top-0 left-1/2 w-px h-8 bg-white/20 -translate-x-1/2"></div>
                <div className="pt-8">
                  <SeriesTreeNode node={child} allNodes={allNodes} onPlay={onPlay} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* AvatarThumbCard — Library Avatars grid 单卡 (2026-05-14 Leon)
 * 加 loading skeleton + onError fallback,避免大图(1-2MB)未加载完时显示
 * 浏览器原生破图占位 "Avatar" alt-text(甲方报)。img 不直接放 div 里裸跑,
 * 抽出本组件维持每卡独立 loading/error state。 */
function AvatarThumbCard({ char, onClick, onDelete }) {
  const [imgReady, setImgReady] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div onClick={onClick} className="group relative cursor-pointer aspect-[3/4] rounded-2xl overflow-hidden border border-background-secondary bg-background-secondary shadow-sm hover:shadow-md transition-all">
      {/* Skeleton — 显示直到 img onLoad 触发,或永久(失败时)。
          紫色 gradient 软-pulse,与 Avatar 主色一致。 */}
      {!imgReady && !imgFailed && (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-200/30 to-purple-200/30 dark:from-violet-900/30 dark:to-purple-900/30 animate-pulse" />
      )}
      {/* Fallback — 加载失败显示 UserCircle 占位 */}
      {imgFailed && (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-200/40 to-purple-200/40 dark:from-violet-900/40 dark:to-purple-900/40 flex items-center justify-center">
          <UserCircle size={64} weight="thin" className="text-label-tertiary" />
        </div>
      )}
      {/* 真实图片 — 加 loading=lazy 减少瀑布流外的卡也并发拉大图,
          onLoad/onError 切 state。char.photo_url 缺失时不渲染 img,直接走 fallback。 */}
      {char.photo_url && !imgFailed && (
        <img
          src={char.photo_url}
          alt="Avatar"
          loading="lazy"
          decoding="async"
          onLoad={() => setImgReady(true)}
          onError={() => setImgFailed(true)}
          className={`w-full h-full object-cover transition-all duration-500 group-hover:scale-105 ${imgReady ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {/* Hover overlay — 与之前一致,Base Actor badge + delete + title */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-4">
        <div className="flex justify-between items-start">
          <span className="px-2 py-1 bg-emerald-500/80 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">
            Base Actor
          </span>
          <button onClick={onDelete} className="p-1.5 bg-black/40 hover:bg-red-500/80 rounded-full text-white backdrop-blur-md transition-colors">
            <Trash size={14} weight="fill" />
          </button>
        </div>
        <div>
          <p className="text-white text-sm font-medium">#{char.id.substring(0, 5)}</p>
          <p className="text-white/70 text-xs mt-1">Tap to view derived Characters</p>
        </div>
      </div>
    </div>
  );
}

export default function LibraryPage({ sidebarMode, isSmallScreen }) {
  const navigate = useNavigate();
  /* 2026-05-14 Leon — tab ↔ URL 双向同步 (修「Library/Works 刷新回上一级」)。
     之前 tab 纯 local state,刷新 /library/works 落回默认 avatars,用户感知像
     被踢回上一级。现在 Route 加了 /library/:tab,这里读 URL,setTab 同步
     navigate。Direct 链接 /library/works / 刷新 / 浏览器后退都保 tab 状态。
     未知 :tab 值兼容 fallback 'avatars'。 */
  const { tab: urlTab } = useParams();
  const validTab = TABS.find(t => t.value === urlTab) ? urlTab : 'avatars';
  const [tab, _setTab] = useState(validTab);

  // Keep local state in sync with URL (back/forward, direct link)
  useEffect(() => {
    if (validTab !== tab) _setTab(validTab);
  }, [validTab, tab]);

  // wrapper: setTab navigates URL too — replace so back-button doesn't accumulate
  const setTab = (next) => {
    _setTab(next);
    navigate(next === 'avatars' ? '/library' : `/library/${next}`, { replace: false });
  };

  const current = TABS.find((t) => t.value === tab) ?? TABS[0];
  const Icon = current.icon ?? CardsThree;

  // §2026-05-22 fei: AI-generated Character concept deleted. Library now
  //   shows only Avatars (the source-photo identities). The drill-down
  //   "click Avatar → see its Characters" view is gone, along with batch-
  //   delete (was scoped to Characters), generatedRecasts derived state,
  //   selectedSourceAvatar state, and toggleSelectForDelete/handleBatchDelete
  //   handlers. Legacy DB rows with createdVia='generated_concept' are
  //   filtered out of the displayed list — they remain in the DB but never
  //   surface in UI.

  // Avatars State
  const [avatars, setAvatars] = useState([]);
  const [isLoadingAvatars, setIsLoadingAvatars] = useState(false);
  // §2026-05-22 fei: Actor creation moved from StoryGenerator step 0 to here.
  //   isAddingActor=true → render InlineCharacterCreator overlay.
  const [isAddingActor, setIsAddingActor] = useState(false);

  // User tier (for +New Avatar tier-gate; mirrors Create/Short Quick Mode locked card UX)
  const [userTier, setUserTier] = useState('free');
  useEffect(() => {
    let cancelled = false;
    getUserProfile().then(({ tier }) => {
      if (!cancelled) setUserTier(tier || 'free');
    }).catch(() => { /* keep default 'free' */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (tab !== 'avatars') return;

    async function fetchAvatars() {
      setIsLoadingAvatars(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        let query = supabase.from('characters').select('*').order('createdAt', { ascending: false });
        if (session) query = query.eq('user_id', session.user.id);

        const { data } = await query;
        setAvatars(data || []);
      } catch (err) {
        console.error('Error fetching avatars:', err);
      } finally {
        setIsLoadingAvatars(false);
      }
    }

    fetchAvatars();
  }, [tab]);

  // Filter out legacy AI-Character rows — only show Avatars (uploaded photo identities).
  const sourceAvatars = avatars.filter(char => {
    let parsedFeatures = {};
    try { parsedFeatures = typeof char.identity_features === 'string' ? JSON.parse(char.identity_features) : char.identity_features || {}; } catch(e) {}
    return parsedFeatures.createdVia !== 'generated_concept';
  });

  const handleDeleteCharacter = async (charId, e) => {
    e.stopPropagation();
    if (!confirm('Delete this avatar? Avatar quota is limited and this cannot be undone.')) return;
    try {
      const { error } = await supabase.from('characters').delete().eq('id', charId);
      if (error) throw error;
      setAvatars(prev => prev.filter(c => c.id !== charId));
    } catch(err) {
      alert('Delete failed: ' + err.message);
    }
  };

  // Works State
  const [works, setWorks] = useState([]);
  const [isLoadingWorks, setIsLoadingWorks] = useState(false);
  const [selectedWork, setSelectedWork] = useState(null);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [isToggling, setIsToggling] = useState(false);
  const [isDeletingWork, setIsDeletingWork] = useState(false);
  const [isVideoEnded, setIsVideoEnded] = useState(false);

  // 2026-05-13 Leon — Works bulk delete mode（仅 Private + 非 series 可选）
  const [isWorksBulkDeleteMode, setIsWorksBulkDeleteMode] = useState(false);
  const [selectedWorksForDelete, setSelectedWorksForDelete] = useState([]);
  const [isBulkDeletingWorks, setIsBulkDeletingWorks] = useState(false);
  // §2026-05-25 fei: bump to trigger Works tab re-fetch (manual refresh button)
  const [worksRefreshSeq, setWorksRefreshSeq] = useState(0);

  /* 2026-05-15 Leon — work-detail FULL custom video controls.
   * 上一版踩坑: 把自定义 button cluster 叠在 native controls 之上,导致
   * 功能重复 + native "..." kebab 还在(controlsList 在 Chrome 部分版本下
   * 不能 100% 隐藏 kebab,留个空菜单更尴尬)。
   * 正确做法 (SparkMode pattern): `controls={false}` 关掉 native,自己画
   * 完整 control bar — Play/Pause + 时间 + scrubber + 时间 + Mute + PiP +
   * Speed + Download + Fullscreen。一行,深玻璃底,hover-only button bg。 */
  const workVideoRef = useRef(null);
  const workVideoContainerRef = useRef(null);
  /* §2026-05-30 round-106 path A — speed/quality/fullscreen state 删:
     对应控件随自定义 bar 删,PlayerActionBar 内部自管。playbackRate 保留
     (effect 应用到 video;PlayerActionBar speed 控件会覆盖)。 */
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isHoveringVideo, setIsHoveringVideo] = useState(false);

  // Apply playbackRate to video
  useEffect(() => {
    if (workVideoRef.current) {
      try { workVideoRef.current.playbackRate = playbackRate; } catch { /* swallow */ }
    }
  }, [playbackRate, selectedWork?.id]);
  // Reset rate + close popup when modal opens for a different work
  useEffect(() => {
    if (selectedWork) { setPlaybackRate(1); setCurrentTime(0); setDuration(0); }
  }, [selectedWork?.id]);

  // §2026-06-10 (Leon)— ESC = 返回(通用规则):作品/剧集查看态下按 Escape 关闭,
  //   等同左上角返回按钮。仅查看态挂监听;topmost 优先(先关 work、再关 series);
  //   聚焦输入框时不抢 Esc(让其做取消/失焦)。
  useEffect(() => {
    if (!selectedWork && !selectedSeries) return;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (selectedWork) setSelectedWork(null);
      else if (selectedSeries) setSelectedSeries(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedWork, selectedSeries]);

  /* §2026-05-27 fei — multi-segment view selector state.
   *
   *   Library detail page now supports works that have segment_videos[]
   *   (Quick Mode / Free Mode multi-segment renders saved as a single
   *   row per request). Default view = merged version (selectedSegmentIdx
   *   === null, plays selectedWork.video). Dropdown lets user switch to
   *   individual segments (idx 0..N-1, plays segment_videos[idx].video).
   *
   *   Reset to merged whenever selectedWork changes so a new work doesn't
   *   carry over the previous segment selection. */
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(null);
  const [segmentMenuOpen, setSegmentMenuOpen] = useState(false);
  useEffect(() => {
    setSelectedSegmentIdx(null);
    setSegmentMenuOpen(false);
  }, [selectedWork?.id]);

  // Resolve the actual video URL to render — merged or specific segment.
  // segment_videos may be either an array (server JSON) or null/undefined.
  const segments = Array.isArray(selectedWork?.segment_videos)
    ? selectedWork.segment_videos
    : null;
  const hasSegmentChooser = segments && segments.length > 0;
  const currentVideoSrc = (selectedSegmentIdx !== null && segments?.[selectedSegmentIdx])
    ? segments[selectedSegmentIdx].video
    : selectedWork?.video;

  // Wire video events for time / play state / mute (run after modal mounts)
  useEffect(() => {
    const v = workVideoRef.current;
    if (!v || !selectedWork) return;
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration || 0);
    const onVol = () => setIsMuted(v.muted);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onMeta);
    v.addEventListener('volumechange', onVol);
    setIsMuted(v.muted);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onMeta);
      v.removeEventListener('volumechange', onVol);
    };
  }, [selectedWork?.id]);

  /* §2026-05-30 round-106 path A — 删 fullscreen/speed-popup/quality-popup/
     quality-reset 4 个 effect:对应控件已随自定义 bar 删,PlayerActionBar 内部
     自管 fullscreen/speed/resolution。 */

  /* §2026-05-30 round-106 path A — PLAYBACK_RATES / toggleMute / seekToFraction /
     formatTime 删:都是自定义 bar 的辅助,bar 删后无引用(PlayerActionBar 自带)。 */
  /* §2026-05-30 round-106 path A — toggleWorkPiP 删(PiP 按钮随 bar 删,
     PlayerActionBar 自带 PiP)。 */
  /* §2026-05-25 fei: replaced inline fetch→blob with the new shared
     downloadVideo() helper. The old code did `fetch(work.video).blob()`
     which works for R2 URLs but for Cloudflare Stream URLs returned a
     1KB HTML iframe page OR a m3u8 manifest text — saving that as
     video.mp4 produced a corrupt file. The new helper detects Stream
     URLs and runs the mp4-generation step first (POST to CF Stream
     /downloads → poll until ready → return mp4 URL), THEN blob-fetches.
     For non-Stream URLs (R2 direct) it just blob-fetches immediately.
     Surfaces progress via setDownloadStatus so user knows it's working. */
  const [downloadStatus, setDownloadStatus] = useState(null);
  const handleDownloadWorkVideo = async () => {
    if (!selectedWork?.video) return;
    try {
      await downloadVideo(selectedWork.video, selectedWork.title, {
        onPrepare:  () => setDownloadStatus('准备视频中...'),
        onProgress: (pct) => setDownloadStatus(`Cloudflare Stream 正在生成 MP4… ${pct}%`),
        onDownload: () => setDownloadStatus('下载中...'),
      });
    } catch (e) {
      console.error('Download failed:', e);
      alert('下载失败：' + (e.message || '未知错误') + '\n\n如果一直失败，可以右键视频画面 → Save Video As 作为兜底。');
    } finally {
      setDownloadStatus(null);
    }
  };

  // Drafts State
  const [drafts, setDrafts] = useState([]);

  useEffect(() => {
    /* §2026-05-25 fei: drafts now persisted server-side (story_drafts).
     *   Load order:
     *     1. Server (one row per generation_mode, RLS-scoped to user)
     *     2. localStorage fallback if server returned empty
     *        (covers anonymous users + offline + brand-new accounts
     *         that hadn't synced yet)
     *
     *   Server drafts include `updated_at` from Postgres, which we use
     *   for the "Last edited" line + sort order. Local fallback only has
     *   the older `draft.timestamp` field. */
    if (tab !== 'drafts') return;
    let cancelled = false;
    (async () => {
      const hasMeaningfulContent = (d) => {
        if (!d || typeof d !== 'object') return false;
        const quick = !!(d.transcript || d.generatedScript);
        const free  = !!(d.freePrompt
                         || (Array.isArray(d.freeAssets)   && d.freeAssets.length > 0)
                         || (Array.isArray(d.freeSegments) && d.freeSegments.length > 0));
        return quick || free;
      };

      try {
        const rows = await listDrafts();
        if (cancelled) return;
        if (rows && rows.length > 0) {
          // Hydrate each server row into the shape the renderer expects.
          //   We carry through id + generation_mode + updated_at so the
          //   card can show "edited 2 hours ago" + we can delete one row
          //   without affecting siblings.
          const hydrated = rows
            .filter(r => hasMeaningfulContent(r.data))
            .map(r => ({
              ...r.data,
              _serverId: r.id,
              _serverMode: r.generation_mode,
              _updatedAt: r.updated_at,
              // ensure generationMode is set for routing even on legacy rows
              generationMode: r.data?.generationMode || r.generation_mode,
            }));
          setDrafts(hydrated);
          return;
        }
      } catch (err) {
        console.warn('[LibraryPage] server drafts fetch failed:', err);
      }

      // Fallback: localStorage
      try {
        const localDraft = localStorage.getItem('uvera_story_draft');
        if (localDraft) {
          const parsed = JSON.parse(localDraft);
          if (hasMeaningfulContent(parsed)) {
            setDrafts([parsed]);
          } else {
            setDrafts([]);
          }
        } else {
          setDrafts([]);
        }
      } catch (err) {
        setDrafts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // Series State — pulls user's drafts + published + archived from public.series.
  // Lazy-loaded: only fetched when the Series tab is active. RLS scopes to
  // own rows via series_owner_full policy.
  const [seriesItems, setSeriesItems] = useState([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState(null);

  useEffect(() => {
    if (tab !== 'series') return;
    let cancelled = false;
    (async () => {
      setSeriesLoading(true);
      setSeriesError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setSeriesItems([]);
          return;
        }
        /* §2026-05-25 fei Phase 3 — same is_premiere/is_recommended priority
         *   ordering as MySeriesPage so the two listings stay consistent. */
        const { data, error } = await supabase
          .from('series')
          .select('*')
          .eq('user_id', user.id)
          .order('is_premiere', { ascending: false })
          .order('is_recommended', { ascending: false })
          .order('updated_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setSeriesItems(data || []);
      } catch (e) {
        if (!cancelled) setSeriesError(e.message);
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  // My Uploads — user's submissions to Upload Video mode (the standalone
  // user_video_uploads table, not Series episodes). Shows admin review
  // status (pending_review / approved / rejected) so users know whether
  // their video is on Discover yet.
  // RLS user_video_uploads_select_own scopes to own rows.
  const [uploadsItems, setUploadsItems] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsError, setUploadsError] = useState(null);

  useEffect(() => {
    if (tab !== 'uploads') return;
    let cancelled = false;
    (async () => {
      setUploadsLoading(true);
      setUploadsError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setUploadsItems([]);
          return;
        }
        const { data, error } = await supabase
          .from('user_video_uploads')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (error) throw error;
        if (!cancelled) setUploadsItems(data || []);
      } catch (e) {
        if (!cancelled) setUploadsError(e.message);
      } finally {
        if (!cancelled) setUploadsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab]);

  useEffect(() => {
    if (selectedWork) setIsVideoEnded(false);
  }, [selectedWork?.id]);

  const handleTogglePublish = async () => {
    if (!selectedWork) return;
    setIsToggling(true);
    try {
      const newPublishedState = !selectedWork.published;

      let idsToUpdate = [];
      if (selectedSeries) {
        idsToUpdate = selectedSeries.nodes.map(n => n.id);
      } else {
        idsToUpdate = [selectedWork.id];
      }

      const { error } = await supabase
        .from('recommended_content')
        .update({ published: newPublishedState, published_at: newPublishedState ? new Date().toISOString() : null })
        .in('id', idsToUpdate);

      if (error) throw error;

      // Update local state
      const updatedWork = { ...selectedWork, published: newPublishedState };
      setSelectedWork(updatedWork);

      if (selectedSeries) {
        const updatedNodes = selectedSeries.nodes.map(n => ({ ...n, published: newPublishedState }));
        const updatedSeries = { ...selectedSeries, published: newPublishedState, nodes: updatedNodes };
        setSelectedSeries(updatedSeries);
        setWorks(works.map(w => w.id === updatedSeries.id ? updatedSeries : w));
      } else {
        setWorks(works.map(w => w.id === updatedWork.id ? updatedWork : w));
      }
    } catch (err) {
      console.error('Toggle error:', err);
      alert('Action failed: ' + err.message);
    } finally {
      setIsToggling(false);
    }
  };

  /* §2026-05-31 Leon round-103 Phase B — Allow Download toggle.
   *   Mirrors handleTogglePublish — when the selected work is a series-folder,
   *   flips the flag on ALL episodes so the whole series behaves consistently.
   *   Single-work mode just flips that one row.
   *   Optimistic local update + revert-on-error pattern matches the publish
   *   toggle so user sees the change instantly.
   */
  const [isTogglingAllowDownload, setIsTogglingAllowDownload] = useState(false);
  const handleToggleAllowDownload = async () => {
    if (!selectedWork || isTogglingAllowDownload) return;
    setIsTogglingAllowDownload(true);
    const newState = !selectedWork.allow_download;
    try {
      let idsToUpdate = [];
      if (selectedSeries) {
        idsToUpdate = selectedSeries.nodes.map(n => n.id);
      } else {
        idsToUpdate = [selectedWork.id];
      }

      const { error } = await supabase
        .from('recommended_content')
        .update({ allow_download: newState })
        .in('id', idsToUpdate);

      if (error) throw error;

      const updatedWork = { ...selectedWork, allow_download: newState };
      setSelectedWork(updatedWork);

      if (selectedSeries) {
        const updatedNodes = selectedSeries.nodes.map(n => ({ ...n, allow_download: newState }));
        const updatedSeries = { ...selectedSeries, allow_download: newState, nodes: updatedNodes };
        setSelectedSeries(updatedSeries);
        setWorks(works.map(w => w.id === updatedSeries.id ? updatedSeries : w));
      } else {
        setWorks(works.map(w => w.id === updatedWork.id ? updatedWork : w));
      }
    } catch (err) {
      console.error('[allow_download] toggle error:', err);
      alert('Update failed: ' + err.message);
    } finally {
      setIsTogglingAllowDownload(false);
    }
  };

  // 2026-05-13 Leon — 仅允许删除 Private 状态的 work（防止误删已发布到 Discover 的内容）。
  // 后端 RLS 应同样限制（DELETE policy 只允许 owner 删除自己的 row），
  // 前端 check 是 UX 保护，不能替代 backend 授权。
  const handleDeleteWork = async () => {
    if (!selectedWork) return;
    if (selectedWork.published) {
      alert('Cannot delete a public work. Make it Private first.');
      return;
    }
    if (selectedWork.type === 'series') {
      alert('Series deletion is not yet supported. Delete individual episodes instead.');
      return;
    }
    if (!confirm(`Delete "${selectedWork.title || 'Untitled'}"? This cannot be undone.`)) return;
    setIsDeletingWork(true);
    try {
      const { error } = await supabase
        .from('recommended_content')
        .delete()
        .eq('id', selectedWork.id);
      if (error) throw error;
      setWorks(prev => prev.filter(w => w.id !== selectedWork.id));
      setSelectedWork(null);
    } catch (err) {
      console.error('Delete work error:', err);
      alert('Delete failed: ' + err.message);
    } finally {
      setIsDeletingWork(false);
    }
  };

  // 2026-05-13 Leon — Bulk delete handlers。Avatar tab 之前的 bulk delete 已删（fei 5/22 砍掉
  // generated Characters drill-down），但 pattern 对 Works "清理多个 Private 草稿" 场景仍有用，
  // 所以这里独立给 Works tab 重建。
  const toggleWorkSelection = (workId) => {
    setSelectedWorksForDelete(prev =>
      prev.includes(workId) ? prev.filter(id => id !== workId) : [...prev, workId]
    );
  };

  const enterBulkDeleteMode = () => {
    setIsWorksBulkDeleteMode(true);
    setSelectedWorksForDelete([]);
  };

  const exitBulkDeleteMode = () => {
    setIsWorksBulkDeleteMode(false);
    setSelectedWorksForDelete([]);
  };

  const handleBulkDeleteWorks = async () => {
    if (selectedWorksForDelete.length === 0) return;
    if (!confirm(`Delete ${selectedWorksForDelete.length} Private work${selectedWorksForDelete.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setIsBulkDeletingWorks(true);
    try {
      const { error } = await supabase
        .from('recommended_content')
        .delete()
        .in('id', selectedWorksForDelete);
      if (error) throw error;
      setWorks(prev => prev.filter(w => !selectedWorksForDelete.includes(w.id)));
      setSelectedWorksForDelete([]);
      setIsWorksBulkDeleteMode(false);
    } catch (err) {
      console.error('Bulk delete works error:', err);
      alert('Bulk delete failed: ' + err.message);
    } finally {
      setIsBulkDeletingWorks(false);
    }
  };

  const handleShare = async () => {
    if (!selectedWork) return;
    try {
      const shareText = `Check out this cinematic video I made: ${selectedWork.title} - ${selectedWork.video}`;
      if (navigator.share) {
        await navigator.share({ title: selectedWork.title, text: shareText, url: selectedWork.video });
      } else {
        await navigator.clipboard.writeText(shareText);
        alert('Share link copied to clipboard.');
      }
      
      const res = await handleShareCredits();
      if (res.success) {
        alert(`Shared! +10 credits awarded. (Today: ${res.newCount}/3)`);
      } else if (res.reason === 'daily_limit_reached') {
        alert('Daily share limit reached (3/3). Come back tomorrow.');
      }
    } catch (err) {
      console.log('Share canceled or failed', err);
    }
  };

  // §2026-05-26 fei — handleAndThen (Sequel CTA handler) removed alongside
  // the "Continue this story" + "Sequel" buttons. Both surfaces invoked this
  // function to seed an `isSequel: true` draft and push the user to /create.
  // Sequel feature is retired per product decision.

  useEffect(() => {
    if (tab !== 'works') return;

    async function fetchWorks() {
      setIsLoadingWorks(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { setWorks([]); return; }

        // Use recommended_content where the artist equals the user's ID
        const { data, error } = await supabase
          .from('recommended_content')
          .select('*')
          .eq('artist', session.user.id)
          .order('createdAt', { ascending: false });

        if (error) throw error;

        /* §2026-05-29 Leon round-105 — Recast 取消,仍 filter 出 DB 老 #Recast
         * tag 数据避免显示在 main Works list (backend Phase B 清理 column +
         * 数据后再删此 filter)。 */
        const worksData = (data || []).filter(w => !(w.tags || []).includes('#Recast'));
        const realWorks = worksData;

        const allWorksMap = new Map(realWorks.map(w => [w.id, w]));
        
        const seriesIds = new Set();
        realWorks.forEach(w => {
          const st = (w.tags || []).find(t => typeof t === 'string' && t.startsWith('#Series:'));
          if (st) seriesIds.add(st.split(':')[1]);
        });

        const finalWorksList = [];
        const processedWorkIds = new Set();

        seriesIds.forEach(seriesId => {
          const rootWork = allWorksMap.get(seriesId);
          if (!rootWork) return; 
          
          const nodesInSeries = realWorks.filter(w => {
             const st = (w.tags || []).find(t => typeof t === 'string' && t.startsWith('#Series:'));
             return (st && st.split(':')[1] === seriesId) || w.id === seriesId;
          });

          const seriesFolder = {
            id: `series-${seriesId}`,
            type: 'series',
            title: `${rootWork.title} (Series)`,
            cover: rootWork.cover || `https://image.mux.com/${rootWork.video}/thumbnail.jpg`,
            published: rootWork.published,
            rootId: seriesId,
            nodes: nodesInSeries.map(w => {
               const pt = (w.tags || []).find(t => typeof t === 'string' && t.startsWith('#Parent:'));
               return {
                 ...w,
                 parentId: pt ? pt.split(':')[1] : null
               };
            })
          };
          
          seriesFolder.nodes.forEach(node => {
            node.children = seriesFolder.nodes.filter(n => n.parentId === node.id).map(n => n.id);
          });

          finalWorksList.push(seriesFolder);
          nodesInSeries.forEach(n => processedWorkIds.add(n.id));
        });

        realWorks.forEach(w => {
          if (!processedWorkIds.has(w.id)) {
            finalWorksList.push(w);
          }
        });

        setWorks(finalWorksList);
      } catch (err) {
        console.error('Error fetching works:', err);
      } finally {
        setIsLoadingWorks(false);
      }
    }

    fetchWorks();
  }, [tab, worksRefreshSeq]);

  return (
    /* 2026-05-09 Leon — mobile outer pt-20 → pt-[56px] (NavigationBar 净空)，
     * 与 SelfProfile/UserProfile/Create 同模式。
     * 2026-05-12 Leon — 主内容区左 padding 改 92px（局部覆盖 useSidebarState 的
     * 全局 pl-20=80px），仅 Library 应用；Overlay 模式 mobile 仍 pl-0。 */
    <div className={`flex-1 min-h-0 overflow-y-auto overscroll-y-none ${sidebarMode === SIDEBAR_MODE.OVERLAY ? 'pl-0' : 'pl-[92px]'} ${isSmallScreen ? 'pt-[56px]' : 'pt-20'}`}>
      {/* Padding 与 Discover MasonryGrid 对齐 — desktop paddingLeft 92 / paddingRight 56，
          无 max-w + mx-auto 居中（撑满 viewport 贴 sidebar）。mobile 用 px-4。
          Mobile inner pt 紧凑 (pt-8 → pt-2)。 */}
      <div
        className={`${isSmallScreen ? 'px-4 pt-2' : 'pt-8'} pb-6`}
        style={{
          ...(isSmallScreen ? null : { paddingLeft: '92px', paddingRight: '56px' }),
          /* 2026-05-15 Leon: real `filter: blur` on the page-content wrapper
             when modal is open. Chrome's `backdrop-filter` on the modal silently
             no-ops due to stacking-context isolation (overflow-y-auto + sibling
             mix-blend-mode dither). Applying `filter` here works because:
              - This wrapper is sibling to the modal (modal not inside it),
                so modal itself stays crisp
              - filter:blur is a direct property on the painted layer, no
                stacking-context-isolation issues
             tint at 85% can be relaxed back since real blur is doing the
             defocus work — done in the backdrop sibling below. */
          filter: selectedWork ? 'blur(10px)' : undefined,
          transition: 'filter 0.25s ease',
        }}
      >
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-3xl font-semibold text-label">Library</h1>
          <p className="text-sm text-label-secondary mt-1">
            Manage your Avatars, Works, and Drafts.
          </p>
        </div>

        {/* Inner tabs — SegmentedControl (desktop) / horizontal scroll chip strip (mobile)
         * 2026-05-09 Leon — 6 segments 在 mobile 410 viewport 装不下 (Avat... / Reca...
         * 截断)，改 mobile-only chip strip 横向 scroll，每个 chip 完整显示。Desktop
         * 保持 SegmentedControl iOS spec (≤5 segments 视觉最佳，6 在 460 prx 仍 OK)。 */}
        {isSmallScreen ? (
          <div className="overflow-x-auto -mx-4 px-4 mb-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex gap-2 w-max">
              {TABS.map(t => (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    tab === t.value
                      ? 'bg-label text-background'
                      : 'bg-background-tertiary text-label-secondary hover:text-label'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex justify-center mb-10">
            <SegmentedControl
              segments={TABS}
              value={tab}
              onChange={setTab}
              className="w-[500px]"
            />
          </div>
        )}

        {/* Content Area */}
        {tab === 'avatars' ? (
          <div className="animate-fade-in">
            {/* §2026-05-22 fei: Actor creation now happens HERE in Library
                instead of inside StoryGenerator step 0. Renders inline above
                the grid so user has context of their existing Avatars while
                creating a new one. */}
            {isAddingActor && (
              <div className="mb-6">
                <InlineCharacterCreator
                  onCancel={() => setIsAddingActor(false)}
                  onSuccess={(newChar) => {
                    setAvatars(prev => [newChar, ...prev]);
                    setIsAddingActor(false);
                  }}
                />
              </div>
            )}
            {isLoadingAvatars ? (
              <div className="min-h-[50vh] flex justify-center items-center">
                <CircleNotch size={32} className="animate-spin text-accent" />
              </div>
            ) : sourceAvatars.length === 0 && !isAddingActor ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-label-secondary">
                  <Smiley size={36} weight="regular" />
                </div>
                <p className="text-xl font-medium text-label mb-2">No Actors yet</p>
                <p className="text-sm text-label-tertiary max-w-xs mb-6">
                  Open the camera or upload a photo to build your first Actor.
                </p>
                <button
                  onClick={() => setIsAddingActor(true)}
                  className="px-6 py-2.5 bg-label text-background font-medium rounded-full text-sm hover:opacity-90 transition"
                >
                  Open camera to create Actor
                </button>
              </div>
            ) : sourceAvatars.length === 0 ? null : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {sourceAvatars.map(char => (
                  <AvatarThumbCard
                    key={char.id}
                    char={char}
                    /* §2026-05-22 fei: Avatar tile no longer drills into a
                       Characters subview (concept deleted). Click takes user
                       straight to /create/short with nothing pre-selected —
                       they can pick this Avatar in the picker. Delete icon
                       still removes the Avatar from the DB. */
                    onClick={() => navigate('/create/short')}
                    onDelete={(e) => handleDeleteCharacter(char.id, e)}
                  />
                ))}

                {(() => {
                  /* 2026-05-14 Leon — locked-state UX 与 Create/Short/Quick Mode 同款,
                     视觉/文案一致(Lock icon + 套餐限额描述 + Upgrade Plan CTA)。
                     §2026-05-22 fei: New Actor 按钮直接打开 InlineCharacterCreator
                     (上方 isAddingActor block), 不再 navigate 到 /create。
                     Library 现在是 Actor 创建的唯一入口。 */
                  const actorLimit = getTierLimits(userTier).actors;
                  const canAddMore = canCreateActor(userTier, sourceAvatars.length);
                  const nextTier   = getNextTier(userTier);
                  const tierLabel  = TIER_DISPLAY[userTier]?.label || userTier;
                  const nextLabel  = nextTier ? TIER_DISPLAY[nextTier]?.label : null;

                  if (!canAddMore) {
                    const handleUpgrade = () => {
                      window.dispatchEvent(new CustomEvent('NEOAI_UPGRADE_MODAL', { detail: { feature: 'actor_slots', currentTier: userTier, nextTier } }));
                      if (nextTier) openSubscriptionModal();
                    };
                    return (
                      <div
                        className="aspect-[3/4] rounded-2xl border-2 border-dashed border-background-tertiary/50 bg-background-secondary/30 flex flex-col items-center justify-center gap-2 px-3 py-4 text-center"
                        title={`You've reached your ${tierLabel} plan limit (${actorLimit} Actor${actorLimit > 1 ? 's' : ''})`}
                      >
                        <div className="w-10 h-10 rounded-full bg-fill-secondary flex items-center justify-center mb-1">
                          <Lock size={20} weight="fill" className="text-label-tertiary" />
                        </div>
                        <span className="text-[10px] font-semibold text-label-tertiary tracking-widest uppercase leading-none">
                          {nextLabel ? `Locked · Upgrade to ${nextLabel}` : 'Locked · Highest tier'}
                        </span>
                        <span className="text-sm font-medium text-label">New Actor</span>
                        <span className="text-[11px] text-label-secondary leading-snug px-1">
                          Your {tierLabel} plan includes {actorLimit} Actor{actorLimit > 1 ? 's' : ''}
                          {nextLabel ? `. Upgrade for more slots.` : ' — this is the highest tier.'}
                        </span>
                        {nextTier && (
                          <button
                            onClick={handleUpgrade}
                            className="mt-1 inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-accent hover:bg-accent/90 text-white text-[11px] font-medium transition-colors cursor-pointer"
                          >
                            Upgrade Plan
                            <ArrowRight size={11} />
                          </button>
                        )}
                        <span className="text-[10px] text-label-tertiary mt-0.5">({sourceAvatars.length}/{actorLimit})</span>
                      </div>
                    );
                  }

                  return (
                    <button
                      onClick={() => setIsAddingActor(true)}
                      disabled={isAddingActor}
                      className="aspect-[3/4] rounded-2xl border-2 border-dashed border-background-tertiary flex flex-col items-center justify-center text-label-tertiary hover:text-accent hover:border-accent/50 hover:bg-accent/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      title={isAddingActor ? 'Creator already open above' : 'Create a new Actor from a photo'}
                    >
                      <Plus size={24} className="mb-2" />
                      <span className="text-sm font-medium">New Actor</span>
                      <span className="text-[10px] opacity-70 mt-1">({sourceAvatars.length}/{actorLimit})</span>
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
        ) : tab === 'works' ? (
          <div className="animate-fade-in">
            {/* §2026-05-25 fei: manual Refresh button. Helpful when a user
                just generated something in StoryGenerator and comes back
                to Library — the per-tab effect won't auto-refetch unless
                tab actually changes. Click bumps the seq → effect re-runs.
                §2026-05-13 Leon: 顺手清中英混用 + 加 Bulk delete 模式入口。 */}
            <div className="flex justify-end items-center gap-2 mb-3">
              {isWorksBulkDeleteMode ? (
                <>
                  <button
                    onClick={exitBulkDeleteMode}
                    disabled={isBulkDeletingWorks}
                    className="px-3 py-1.5 rounded-full text-xs text-label-secondary border border-background-tertiary hover:bg-background-secondary disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkDeleteWorks}
                    disabled={selectedWorksForDelete.length === 0 || isBulkDeletingWorks}
                    className="px-3 py-1.5 rounded-full text-xs text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
                  >
                    {isBulkDeletingWorks ? (
                      <><CircleNotch size={12} className="animate-spin" /> Deleting…</>
                    ) : (
                      <><Trash size={12} weight="fill" /> Delete {selectedWorksForDelete.length || ''}</>
                    )}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setWorksRefreshSeq(s => s + 1)}
                    disabled={isLoadingWorks}
                    className="px-3 py-1.5 rounded-full text-xs text-label-secondary border border-background-tertiary hover:bg-background-secondary disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                    title="Reload works list"
                  >
                    {isLoadingWorks
                      ? <><CircleNotch size={12} className="animate-spin" /> Loading…</>
                      : <><ArrowsClockwise size={12} /> Refresh</>}
                  </button>
                  {works.some(w => !w.published && w.type !== 'series') && (
                    <button
                      onClick={enterBulkDeleteMode}
                      className="px-3 py-1.5 rounded-full text-xs text-label-secondary border border-background-tertiary hover:bg-background-secondary hover:text-red-500 flex items-center gap-1.5 transition-colors"
                      title="Bulk delete Private works"
                    >
                      <Trash size={12} /> Bulk delete
                    </button>
                  )}
                </>
              )}
            </div>
            {isLoadingWorks ? (
              <div className="min-h-[50vh] flex justify-center items-center">
                <CircleNotch size={32} className="animate-spin text-accent" />
              </div>
            ) : works.length === 0 ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-label-secondary">
                  <FilmSlate size={36} weight="regular" />
                </div>
                <p className="text-xl font-medium text-label mb-2">No video works yet</p>
                <p className="text-sm text-label-tertiary max-w-xs mb-6">
                  You haven't generated any video stories yet.
                </p>
                <button
                  onClick={() => window.location.href='/create'}
                  className="px-6 py-2.5 bg-label text-background font-medium rounded-full text-sm hover:opacity-90 transition"
                >
                  Generate a story
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {works.map((work) => {
                  // §2026-05-24 fei: derive thumbnail URL from CF Stream UID
                  //   when no cover. The old fallback was `image.mux.com`
                  //   which doesn't exist for our videos — Free Mode
                  //   segments (which usually have no cover at insert time)
                  //   were showing broken thumbnails. Now we extract the
                  //   Stream UID and use CF's thumbnail endpoint.
                  let thumbUrl = work.cover || null;
                  if (!thumbUrl && work.video) {
                    const m = String(work.video).match(/(?:videodelivery\.net|cloudflarestream\.com)\/([a-f0-9]{32})/i);
                    if (m) thumbUrl = `https://videodelivery.net/${m[1]}/thumbnails/thumbnail.jpg`;
                  }
                  // §2026-05-24 fei: Free Mode origin badge — helps user
                  //   see which works came from Free Mode vs Quick Mode.
                  const isFreeSegment = Array.isArray(work.tags) && work.tags.includes('#FreeSegment');
                  // 2026-05-13 Leon — Bulk delete mode 下：
                  //   - Private + 非 series: click toggles selection, 显示 checkbox
                  //   - Public 或 series: 视觉淡化、不响应 click（uneligible）
                  const isEligibleForBulkDelete = !work.published && work.type !== 'series';
                  const isSelectedForDelete = selectedWorksForDelete.includes(work.id);
                  const handleCardClick = () => {
                    if (isWorksBulkDeleteMode) {
                      if (isEligibleForBulkDelete) toggleWorkSelection(work.id);
                      return;
                    }
                    if (work.type === 'series') setSelectedSeries(work);
                    else setSelectedWork(work);
                  };
                  return (
                    <div
                      key={work.id}
                      onClick={handleCardClick}
                      className={`group relative aspect-video rounded-2xl overflow-hidden border bg-background-secondary shadow-sm hover:shadow-md transition-all cursor-pointer ${
                        isWorksBulkDeleteMode && isSelectedForDelete
                          ? 'border-red-500 ring-2 ring-red-500/40'
                          : isWorksBulkDeleteMode && !isEligibleForBulkDelete
                            ? 'border-background-secondary opacity-40 cursor-not-allowed'
                            : 'border-background-secondary'
                      }`}
                    >
                      {/* Preview thumbnail with onError fallback to a neutral placeholder */}
                      {thumbUrl ? (
                        <img
                          src={thumbUrl}
                          alt="Work thumbnail"
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-90 group-hover:opacity-100"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      ) : null}
                      {/* Neutral placeholder underneath (visible if no thumb or img errors) */}
                      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
                        <FilmSlate size={36} weight="light" className="text-white/30" />
                      </div>

                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex flex-col justify-between p-4">
                        {/* Bulk delete checkbox — 仅在 mode 内且 eligible 时显示，左上角 */}
                        {isWorksBulkDeleteMode && isEligibleForBulkDelete && (
                          <div className={`absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-lg ${
                            isSelectedForDelete
                              ? 'bg-red-500 border-2 border-white'
                              : 'bg-black/40 border-2 border-white/70 backdrop-blur-md'
                          }`}>
                            {isSelectedForDelete && <Check size={16} weight="bold" className="text-white" />}
                          </div>
                        )}
                        <div className="flex justify-end items-start gap-2">
                          {work.type === 'series' && (
                            <span className="px-2 py-1 bg-accent/80 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1 absolute top-4 left-4 shadow-lg border border-accent/20">
                              <TreeStructure size={14} weight="bold" /> Series
                            </span>
                          )}
                          {isFreeSegment && (
                            <span className="px-2 py-1 bg-emerald-500/80 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">
                              Free Mode
                            </span>
                          )}
                          {work.published ? (
                            <span className="px-2 py-1 bg-blue-500/80 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">
                              Public
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-background-tertiary/80 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">
                              Private
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="text-white text-base font-bold line-clamp-1">{work.title || 'Untitled'}</p>
                          <p className="text-white/80 text-xs font-medium mt-0.5">#{work.id.substring(0, 5)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        ) : tab === 'series' ? (
          /* ─── Series tab ─────────────────────────────────────────────────
             User's drafts + published + archived series. Mirrors the
             standalone /my-series page so users have two ways to find their
             work: from Library (default landing) or via direct URL.
             View → /series/:id, Continue → /create?series=<id>. */
          <div className="animate-fade-in">
            {seriesLoading ? (
              <div className="min-h-[40vh] flex items-center justify-center text-label-secondary">
                <CircleNotch size={20} className="animate-spin mr-2" /> Loading…
              </div>
            ) : seriesError ? (
              <div className="min-h-[40vh] flex items-center justify-center text-red-500 text-sm">
                Failed to load series: {seriesError}
              </div>
            ) : seriesItems.length === 0 ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-label-secondary">
                  <FilmStrip size={36} weight="regular" />
                </div>
                <p className="text-xl font-medium text-label mb-2">No series yet</p>
                <p className="text-sm text-label-secondary mb-6 max-w-md">
                  Build a multi-episode story with a recurring cast. Save drafts and publish when ready.
                </p>
                {/* 2026-05-13 Leon — 深链到 Create 频道的 Series mode
                    (/create/series 是已存在 creationLevel='series' 的 URL,
                    与 /create/short 平级。Header CreateChannelPills 上「Series」
                    高亮)。不再着陆 quick mode 让用户再切。 */}
                <Link
                  to="/create/series"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-full text-sm font-medium transition-colors"
                >
                  <Plus size={14} /> Create a Series
                </Link>
              </div>
            ) : (
              <div>
                {/* Status counts header */}
                <div className="flex items-center gap-4 mb-4 text-xs text-label-tertiary">
                  <span>{seriesItems.length} total</span>
                  <span className="inline-flex items-center gap-1">
                    <PencilSimple size={11} /> {seriesItems.filter(s => s.status === 'draft').length} draft
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle size={11} /> {seriesItems.filter(s => s.status === 'published').length} published
                  </span>
                  {seriesItems.filter(s => s.status === 'archived').length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Archive size={11} /> {seriesItems.filter(s => s.status === 'archived').length} archived
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {seriesItems.map(s => {
                    const eps = Array.isArray(s.episodes) ? s.episodes : [];
                    const epCount = eps.filter(e => e?.status === 'ready').length;
                    const totalEp = eps.length;
                    // All statuses editable now — published series can be
                    // updated and re-saved (republish updates the same Discover
                    // card via series:<id> tag lookup).
                    const isEditable = true;
                    const editLabel = s.status === 'published' ? 'Edit' : 'Continue';
                    return (
                      <div
                        key={s.id}
                        className="bg-background-secondary border border-background-tertiary rounded-2xl overflow-hidden hover:border-accent/40 transition-colors group"
                      >
                        <Link to={`/series/${s.id}`} className="block">
                          <div className="aspect-video bg-black relative overflow-hidden">
                            {s.cover_url ? (
                              <img
                                src={s.cover_url}
                                alt={s.title}
                                className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                                onError={(e) => {
                                  if (!e.target.dataset.retried) {
                                    e.target.dataset.retried = '1';
                                    setTimeout(() => { e.target.src = s.cover_url + '?t=' + Date.now(); }, 5000);
                                  }
                                }}
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-label-tertiary">
                                <FilmStrip size={40} />
                              </div>
                            )}
                            <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-black/70 text-white border border-white/10">
                              {s.status}
                            </div>
                            {epCount > 0 && (
                              <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium bg-black/70 text-white">
                                {epCount} ep{epCount === 1 ? '' : 's'}
                              </div>
                            )}
                          </div>
                        </Link>
                        <div className="p-4">
                          <Link to={`/series/${s.id}`} className="block">
                            <h3 className="text-base font-medium text-label mb-1 hover:text-accent transition-colors line-clamp-1">
                              {s.title || 'Untitled series'}
                            </h3>
                          </Link>
                          {s.description && (
                            <p className="text-xs text-label-secondary line-clamp-2 mb-3">{s.description}</p>
                          )}
                          <div className="flex items-center justify-between text-[11px] text-label-tertiary mb-3">
                            <span>
                              {totalEp > 0 && epCount < totalEp
                                ? `${epCount}/${totalEp} ready`
                                : `${epCount} episode${epCount === 1 ? '' : 's'}`}
                            </span>
                            <span>{new Date(s.updated_at).toLocaleDateString()}</span>
                          </div>
                          <div className="flex gap-2">
                            <Link
                              to={`/series/${s.id}`}
                              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-background hover:bg-background-tertiary rounded-full text-xs font-medium text-label transition-colors border border-background-tertiary"
                            >
                              <Eye size={12} /> View
                            </Link>
                            {isEditable && (
                              <Link
                                to={`/create?series=${s.id}`}
                                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent/90 text-white rounded-full text-xs font-medium transition-colors"
                              >
                                <PencilSimple size={12} /> {editLabel}
                              </Link>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 flex justify-center">
                  <Link
                    to="/create"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-label-secondary hover:text-accent transition-colors"
                  >
                    <Plus size={14} /> Create another series
                  </Link>
                </div>
              </div>
            )}
          </div>

        ) : tab === 'uploads' ? (
          /* ─── My Uploads ─────────────────────────────────────────────────
             User-facing view of /api/user-videos pipeline. Shows status
             (pending_review / approved / rejected) so users know whether
             their submitted video is live on Discover. Admin acts on these
             from /admin/dashboard → User Videos (Review). */
          <div className="animate-fade-in">
            {uploadsLoading ? (
              <div className="min-h-[40vh] flex items-center justify-center text-label-secondary">
                <CircleNotch size={20} className="animate-spin mr-2" /> Loading…
              </div>
            ) : uploadsError ? (
              <div className="min-h-[40vh] flex items-center justify-center text-red-500 text-sm">
                Failed to load uploads: {uploadsError}
              </div>
            ) : uploadsItems.length === 0 ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-label-secondary">
                  <CloudArrowUp size={36} weight="regular" />
                </div>
                <p className="text-xl font-medium text-label mb-2">Nothing uploaded yet</p>
                <p className="text-sm text-label-secondary mb-6 max-w-md">
                  Upload your own videos for review and publishing to Discover. We review submissions within 48 hours.
                </p>
                {/* 2026-05-13 Leon — 深链到 Create 频道的 Upload Video 模式
                    (而不是落地 quick mode 让用户再切 tab)。StoryGeneratorPage
                    解析 `/create/short/upload` 把 generationMode 设成 'upload'。 */}
                <Link
                  to="/create/short/upload"
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-full text-sm font-medium transition-colors"
                >
                  <CloudArrowUp size={14} /> Upload a video
                </Link>
              </div>
            ) : (
              <div>
                {/* Status counts header */}
                <div className="flex items-center gap-4 mb-4 text-xs text-label-tertiary flex-wrap">
                  <span>{uploadsItems.length} total</span>
                  <span className="inline-flex items-center gap-1">
                    <Hourglass size={11} /> {uploadsItems.filter(u => u.status === 'pending_review').length} pending
                  </span>
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle size={11} /> {uploadsItems.filter(u => u.status === 'approved').length} approved
                  </span>
                  {uploadsItems.filter(u => u.status === 'rejected').length > 0 && (
                    <span className="inline-flex items-center gap-1 text-red-500">
                      <XCircle size={11} /> {uploadsItems.filter(u => u.status === 'rejected').length} rejected
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {uploadsItems.map(u => {
                    const sizeMB = u.file_size_bytes ? (u.file_size_bytes / 1024 / 1024).toFixed(1) : null;
                    const statusBadge = {
                      uploading:      { label: 'Uploading',     cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30',          icon: CloudArrowUp },
                      pending_review: { label: 'In Review',     cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30',       icon: Hourglass },
                      approved:       { label: 'Approved · Live', cls: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30', icon: CheckCircle },
                      rejected:       { label: 'Rejected',      cls: 'bg-red-500/15 text-red-500 border-red-500/30',             icon: XCircle },
                    }[u.status] || { label: u.status, cls: 'bg-zinc-500/15 text-label border-zinc-500/30', icon: FilmStrip };
                    const StatusIcon = statusBadge.icon;
                    return (
                      <div
                        key={u.id}
                        className="bg-background-secondary border border-background-tertiary rounded-2xl overflow-hidden"
                      >
                        <div className="aspect-video bg-black relative overflow-hidden">
                          {u.thumbnail_url ? (
                            <img
                              src={u.thumbnail_url}
                              alt={u.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                if (!e.target.dataset.retried) {
                                  e.target.dataset.retried = '1';
                                  setTimeout(() => { e.target.src = u.thumbnail_url + '?t=' + Date.now(); }, 5000);
                                }
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-label-tertiary">
                              <CloudArrowUp size={40} />
                            </div>
                          )}
                          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] uppercase tracking-wider font-semibold border flex items-center gap-1 ${statusBadge.cls}`}>
                            <StatusIcon size={10} /> {statusBadge.label}
                          </div>
                        </div>
                        <div className="p-4">
                          <h3 className="text-base font-medium text-label mb-1 line-clamp-1">
                            {u.title || 'Untitled upload'}
                          </h3>
                          {u.description && (
                            <p className="text-xs text-label-secondary line-clamp-2 mb-3">{u.description}</p>
                          )}
                          <div className="flex items-center justify-between text-[11px] text-label-tertiary mb-2">
                            <span>{sizeMB ? `${sizeMB} MB` : '—'}{u.duration_seconds ? ` · ${u.duration_seconds}s` : ''}</span>
                            <span>{new Date(u.created_at).toLocaleDateString()}</span>
                          </div>
                          {u.status === 'rejected' && u.rejection_reason && (
                            <div className="mt-2 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-[11px] text-red-500">
                              <strong>Rejection reason:</strong> {u.rejection_reason}
                            </div>
                          )}
                          {u.status === 'pending_review' && (
                            <p className="text-[11px] text-label-tertiary italic">
                              We typically review within 48 hours. You'll be notified when this is approved or rejected.
                            </p>
                          )}
                          {u.status === 'approved' && u.recommended_content_id && (
                            <Link
                              to="/"
                              className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent hover:opacity-80"
                            >
                              <Eye size={11} /> View on Discover
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-8 flex justify-center">
                  {/* 2026-05-13 Leon — 与 L1144 empty state CTA 同 target，
                      深链到 Create > Short > Upload Video 模式。 */}
                  <Link
                    to="/create/short/upload"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-label-secondary hover:text-accent transition-colors"
                  >
                    <CloudArrowUp size={14} /> Upload another video
                  </Link>
                </div>
              </div>
            )}
          </div>

        ) : tab === 'drafts' ? (
          <div className="animate-fade-in">
            {drafts.length === 0 ? (
              <div className="min-h-[50vh] flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6 text-label-secondary">
                  <PencilSimple size={36} weight="regular" />
                </div>
                <p className="text-xl font-medium text-label mb-2">No drafts yet</p>
                <p className="text-sm text-label-tertiary max-w-xs mb-6">
                  You don't have any unfinished story drafts.
                </p>
                <button
                  onClick={() => window.location.href='/create'}
                  className="px-6 py-2.5 bg-label text-background font-medium rounded-full text-sm hover:opacity-90 transition cursor-pointer"
                >
                  Go to Create
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {drafts.map((draft, idx) => {
                  // §2026-05-24 fei: route Continue based on draft.generationMode.
                  //   Free Mode → /create/short/free  (URL sync effect picks
                  //                                    generationMode='free')
                  //   Quick    → /create              (default)
                  //   Upload   → /create/short/upload
                  const continueHref =
                    draft.generationMode === 'free' ? '/create/short/free'
                  : draft.generationMode === 'upload' ? '/create/short/upload'
                  : '/create';

                  const isFree = draft.generationMode === 'free';
                  const isUpload = draft.generationMode === 'upload';

                  /* §2026-05-25 fei: derive Step from highest data present,
                   *   not draft.step. Some error paths reset step=0 but
                   *   other data (transcript/style/script) stays — naive
                   *   "Step 0" is misleading. Use the same inference as
                   *   StoryGeneratorPage's restore: data → step. */
                  const inferredStep = (() => {
                    if (draft.renderProgress >= 1) return 4;
                    if (draft.generatedScript)     return 3;
                    if (draft.selectedStyle)       return 2;
                    if (draft.transcript)          return 1;
                    return 1;  // never show "Step 0" — minimum is 1
                  })();
                  const displayStep = Math.max(draft.step || 0, inferredStep);

                  const STEP_LABELS = {
                    1: '剧本输入',
                    2: '风格选择',
                    3: '剧本审阅',
                    4: '渲染中',
                  };

                  // §2026-05-24 fei: derive label + title to handle both
                  //   Free Mode (no transcript, has freePrompt/freeSegments)
                  //   and Quick Mode (transcript + script + step) drafts.
                  const badge = isFree
                    ? `Free Mode · ${draft.freeSegments?.length || 0} 段`
                    : isUpload
                    ? 'Upload Mode'
                    : `Quick Mode · ${STEP_LABELS[displayStep] || `Step ${displayStep}`}`;
                  const title = isFree
                    ? (draft.freePrompt || (draft.freeSegments?.length ? `${draft.freeSegments.length} 段视频草稿` : 'Free Mode 草稿'))
                    : (draft.generatedScript?.summary || draft.transcript || 'Untitled draft');

                  return (
                    <div key={idx} onClick={() => window.location.href = continueHref} className="group relative rounded-2xl overflow-hidden border border-background-secondary bg-background-secondary shadow-sm hover:shadow-md transition-all cursor-pointer p-5 flex flex-col justify-between aspect-video">
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                            isFree   ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                          : isUpload ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300'
                          :            'bg-accent/10 text-accent'
                          }`}>
                            {badge}
                          </span>
                          <PencilSimple size={18} className="text-label-secondary" />
                        </div>
                        <h3 className="text-base font-bold text-label line-clamp-2 mb-2">
                          {title}
                        </h3>
                        {!isFree && draft.styleName && (
                          <p className="text-sm text-label-secondary mb-1">Style: {draft.styleName}</p>
                        )}
                        {isFree && draft.freeAssets?.length > 0 && (
                          <p className="text-xs text-label-tertiary mb-1">
                            {draft.freeAssets.length} 张参考素材
                          </p>
                        )}
                      </div>
                      <div className="flex justify-between items-end mt-4">
                        <p className="text-xs text-label-tertiary">
                          {/* §2026-05-25 fei: prefer server _updatedAt over the
                              legacy draft.timestamp — server is authoritative
                              now. localStorage-only fallback still works. */}
                          Last edited: {(draft._updatedAt || draft.timestamp)
                            ? new Date(draft._updatedAt || draft.timestamp).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                        </p>
                        <div className="flex gap-2">
                          {/* Per-mode delete — only shown when this is a
                              server row (we can't safely delete a server row
                              that doesn't exist; local fallback still uses the
                              clear-button on /create) */}
                          {draft._serverId && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                if (!window.confirm(`Delete this ${draft._serverMode} draft? This cannot be undone.`)) return;
                                await deleteServerDraft(draft._serverMode);
                                setDrafts(prev => prev.filter(d => d._serverId !== draft._serverId));
                              }}
                              className="px-3 py-1.5 bg-background border border-background-tertiary rounded-full text-xs font-medium text-label-secondary hover:text-red-500 hover:border-red-500 transition-colors"
                              title="Delete draft"
                            >
                              <Trash size={14} />
                            </button>
                          )}
                          <button className="px-4 py-1.5 bg-background border border-background-tertiary rounded-full text-xs font-medium group-hover:bg-accent group-hover:text-white transition-colors">
                            Continue
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="min-h-[60vh] flex flex-col items-center justify-center text-center animate-fade-in">
            <div className="w-20 h-20 rounded-full glass-regular flex items-center justify-center mb-6">
              <Icon size={36} weight="regular" className="text-label-secondary" />
            </div>
            <p className="text-xl font-medium text-label mb-2">
              {current.label}
            </p>
            <p className="text-sm text-label-tertiary max-w-xs">
              Coming soon. Your {current.label} will show up here.
            </p>
          </div>
        )}
      </div>

        {/* Series Overlay */}
        {selectedSeries && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-md" onClick={() => setSelectedSeries(null)} />
            <div className="relative w-full max-w-6xl h-[85vh] bg-background border border-background-secondary rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-fade-in">
              <div className="flex justify-between items-center p-6 border-b border-background-secondary bg-background/80 backdrop-blur z-10 relative">
                <div>
                  <h2 className="text-2xl font-bold text-label flex items-center gap-2">
                    <TreeStructure size={24} className="text-accent" />
                    {selectedSeries.title}
                  </h2>
                  <p className="text-sm text-label-secondary mt-1">All branching episodes within this series</p>
                </div>
                <button onClick={() => setSelectedSeries(null)} className="w-10 h-10 rounded-full hover:bg-background-secondary flex items-center justify-center text-label-secondary transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-auto p-12 bg-[#0A0A0A] flex justify-center items-start min-h-0 relative">
                <div className="absolute inset-0 opacity-20 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
                <div className="inline-block relative z-10 pt-4 pb-20">
                  <SeriesTreeNode 
                    node={selectedSeries.nodes.find(n => n.id === selectedSeries.rootId)} 
                    allNodes={selectedSeries.nodes} 
                    onPlay={(node) => {
                       // Do not close series, just open player OVER the series!
                       setSelectedWork({ ...node, title: node.title, video: node.video });
                    }} 
                  />
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Video Overlay (shows on top of everything including series) */}
      {selectedWork && (
        /* 2026-05-14 Leon — 重构 Work Detail Modal 为「上下两模块」结构 (类 Vireel
         * AI Agent App 截图):
         *   ┌────────────────────────────┐
         *   │       Video (720 wide)     │  ← 主区域,黑色 letterbox,rounded
         *   ├────────────────────────────┤
         *   │  title / id / actions      │  ← 玻璃 panel,信息 + 操作
         *   └────────────────────────────┘
         * 旧结构是左右(2/3 + 1/3),视频被压在 67% 宽。新结构让视频 720px 全宽
         * 显示,信息区放到下面,垂直空间更舒服。
         *
         * 关闭:点 backdrop / × button(右上,移到下面 panel 内对齐 title)。 */
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
          {/* Backdrop tint — onClick 关闭。
              2026-05-15 Leon 第五轮 (路径 B): 真 blur 由页面内容 wrapper 的
              `filter: blur(10px)` 接管 (line ~538),backdrop-filter 不再扛
              失焦责任 → tint 浊度从 85% 降回 50%,modal 重新"浮"在玻璃感的
              失焦背景上,而不是"罩"在厚黑布上。
              backdrop-filter 因为 stacking-context isolation silent-fail,
              保留 blur-3xl declaration 备未来 Chrome 解锁。 */}
          <div className="absolute inset-0 bg-background/50 backdrop-blur-3xl" onClick={() => setSelectedWork(null)} />
          {/* 2026-05-15 Leon B — Dither overlay (kills backdrop banding)。
              bg-grain (站点级 2.8%) 在 backdrop-filter blur 之下,blur 把它的
              随机噪声平均掉,所以遮罩输出仍可见 8-bit 量化阶梯。
              这层是 backdrop 之上的兄弟,blur 不再触达 → 直接在用户视觉到
              的图像上铺一层细颗粒噪声,打散量化条纹。
              Spec: 与 .bg-dither 同款 SVG turbulence (baseFreq 1.4 / 2-octave
              / stitch),3% opacity,180px tile。"注意噪声不要太大"(Leon) →
              比 .bg-dither (3.5% light / 5% dark) 还轻一档。pointer-events:
              none 让 click 落到 backdrop 上正常关闭。
              **2026-05-15 第二轮 (Leon: "勉强可以接受")** → 加
              `mix-blend-mode: overlay`,把噪声从均匀灰膜变成非线性扰动
              (深处变深、浅处变浅),dither 数学振幅 ×3-4 但视觉噪声量不变。
              保持 3% opacity 不动,只补 blend mode,匹配 .bg-dither 同款配方。 */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              opacity: 0.03,
              mixBlendMode: 'overlay',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.4' numOctaves='2' seed='9' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`,
              backgroundSize: '180px 180px',
              backgroundRepeat: 'repeat',
            }}
          />
          {/* 2026-05-14 Leon — max-w 760 → 720,前次 760 让视频实际宽 760 (gap-4 不
              算 padding),改 720 让视频严格 720 宽。 */}
          <div className="relative w-full max-w-[720px] flex flex-col gap-4 animate-fade-in my-auto">

            {/* Chrome 可见性 — 三件套(back/badge/control-bar)共享:
                  - 暂停: 常驻
                  - 播放 + 鼠标在视频上: 显示
                  - 播放 + 鼠标离开: 淡出
                  - 视频播放完(end overlay 显示 Replay/What's next?): 常驻
                    (2026-05-15 Leon: end 态时 chrome 应同步出现,方便用户立即
                    后退/重播/换 speed 再看一遍) */}
            {(() => null)()}

            {/* ── Top: Video player (720 wide) + 角标 + 返回按钮 ──
                §2026-05-13 Leon — wrapper 加 aspect-video 锁 16:9，reserve 720×405
                空间，避免 video metadata 加载前 height=0 → 50px controls → expand
                的 layout shift。loaded 后 object-contain 填进去；vertical/square
                upload 用 letterbox 接受（少数情况）。 */}
            <div
              ref={workVideoContainerRef}
              onMouseEnter={() => setIsHoveringVideo(true)}
              onMouseLeave={() => setIsHoveringVideo(false)}
              className="w-full aspect-video bg-black rounded-2xl shadow-2xl overflow-hidden relative group"
            >
              {/* UnifiedVideoPlayer branches Safari→native HLS / others→hls.js.
                  forwardRef so workVideoRef still works.
                  §2026-05-30 round-106 path A — 去掉 wrapper onClick={togglePlayPause}:
                  customControls 下 PlayerActionBar(round-93)已自带 video click→
                  togglePlay,再叠 wrapper onClick 会双触发(切两次=净不变)→ "点击不能暂停"。 */}
              <div className="absolute inset-0">
                <UnifiedVideoPlayer
                  ref={workVideoRef}
                  /* §2026-05-27 fei — bind to currentVideoSrc (resolves
                     to selectedWork.video for the merged view, or
                     segment_videos[idx].video when user picks a segment
                     from the dropdown below). Key forces React to fully
                     re-mount <video> on src change instead of trying to
                     swap mid-playback (which iOS Safari handles badly,
                     same lesson as the iOS-Safari-swap fix in commit
                     8f00861-era). */
                  key={currentVideoSrc}
                  src={currentVideoSrc}
                  showLoadingOverlay
                  /* §2026-05-30 round-106 path A — 用 PlayerActionBar(customControls,
                     跟 SparkMode/Admin/SeriesDetail 一致);删 Library 自定义 control bar。
                     progress/volume/resolution/speed/PiP/fullscreen 全由 PlayerActionBar
                     内部管(含 hls levels)。Library 单作品无 feed transport,不传 onPrev/onNext。 */
                  customControls
                  autoPlay
                  /* §2026-05-30 round-106 增量C — short-feed/mv loop self(跟 Spark 一致);
                     series 作品不循环。*/
                  loop={isLoopSelf(selectedWork)}
                  playsInline
                  /* §2026-05-13 Leon — h-full 填满外层 aspect-video container
                     (720×405)，配 object-contain 保比例。原 h-auto max-h-[70vh]
                     让 video 按 metadata 撑开，metadata 加载前 height=0 导致
                     wrapper 塌陷成 controls 高度 → layout shift. */
                  className="w-full h-full object-contain"
                  onEnded={() => setIsVideoEnded(true)}
                  onPlay={() => setIsVideoEnded(false)}
                />
              </div>

              {/* §2026-05-27 fei — multi-segment view selector.
                  Renders only for works with segment_videos[] populated.
                  Dropdown sits top-center under the back button, faded
                  with chrome so it doesn't block while playing. Click
                  outside the menu (backdrop) closes it. */}
              {hasSegmentChooser && (
                <div
                  className="absolute top-4 left-1/2 -translate-x-1/2 z-20"
                  style={{
                    opacity: (!isPlaying || isHoveringVideo || isVideoEnded) ? 1 : 0,
                    transition: 'opacity 0.2s ease',
                    pointerEvents: (!isPlaying || isHoveringVideo || isVideoEnded) ? 'auto' : 'none',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSegmentMenuOpen(s => !s); }}
                    className="px-3 py-1.5 rounded-full bg-black/70 backdrop-blur-md text-white text-xs font-medium hover:bg-black/85 flex items-center gap-1.5 border border-white/10"
                    aria-expanded={segmentMenuOpen}
                  >
                    {selectedSegmentIdx === null
                      ? '合并版'
                      : `分段 ${selectedSegmentIdx + 1} / ${segments.length}`}
                    <span className="text-[10px] opacity-70">▾</span>
                  </button>
                  {segmentMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0"
                        style={{ zIndex: -1 }}
                        onClick={() => setSegmentMenuOpen(false)}
                      />
                      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 min-w-[160px] rounded-xl bg-black/90 backdrop-blur-md text-white shadow-2xl border border-white/10 py-1 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => { setSelectedSegmentIdx(null); setSegmentMenuOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 ${selectedSegmentIdx === null ? 'text-accent font-medium' : ''}`}
                        >
                          {selectedSegmentIdx === null ? '✓ ' : '  '}合并版
                          <span className="ml-1 text-[10px] opacity-60">(完整)</span>
                        </button>
                        {segments.map((seg, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => { setSelectedSegmentIdx(i); setSegmentMenuOpen(false); }}
                            className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 ${selectedSegmentIdx === i ? 'text-accent font-medium' : ''}`}
                          >
                            {selectedSegmentIdx === i ? '✓ ' : '  '}分段 {i + 1}
                            {seg.duration_sec && <span className="ml-1 text-[10px] opacity-60">({seg.duration_sec}s)</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Back button — 2026-05-17 Leon: 改 <OverlayCtrlBtn> (Spark immerse 的
                  back 同款 composite,glass-frosted-edge T-1a tier)。绑 isHoveringVideo
                  与 chrome 联动淡入淡出。 */}
              <OverlayCtrlBtn
                onClick={() => setSelectedWork(null)}
                ariaLabel="Back"
                className="absolute top-4 left-4 z-10 w-10 h-10 rounded-full"
                style={{
                  opacity: (!isPlaying || isHoveringVideo || isVideoEnded) ? 1 : 0,
                  pointerEvents: (!isPlaying || isHoveringVideo || isVideoEnded) ? 'auto' : 'none',
                  transition: 'opacity 0.2s ease, transform 0.2s ease',
                }}
              >
                <CaretLeft size={20} weight="bold" className="text-white" />
              </OverlayCtrlBtn>


              {/* 自建完整 control bar (替代 native controls) — 2026-05-15 Leon。
                  布局: scrubber 上行, 按钮下行
                    左: [Play] [Mute]
                    右: [Speed] [Download] [PiP] [Fullscreen]
                  2026-05-15 第二轮 (Leon): 右侧按钮顺序重排,Speed/Download 是
                  高频使用,排在前面;PiP 次频在第三;Fullscreen 末尾(最远离
                  Mute,符合 YouTube 等惯例,Fullscreen 永远靠最右)。
                  深色 gradient backdrop 从底向上淡出,hover 时整 bar 显现,
                  暂停时常驻 (与 SparkMode 同 UX 哲学)。 */}
              {/* 2026-05-15 Leon — hover 检测从 bar 自身移到整个视频容器
                 (workVideoContainerRef 上的 onMouseEnter/Leave)。
                 之前只 hover bar 才显,鼠标在视频中央滑动看不到 controls。
                 现在: 暂停 = 常驻;播放 + 鼠标在视频内 = 显;播放 + 鼠标离开
                 视频 = 淡出。pointerEvents: none 防止 bar 自身阻挡点击穿透
                 到视频(togglePlayPause 走 video onClick)。 */}

              {/* End-of-video overlay (Replay + Continue this story) — 2026-05-15
                  Leon 第四轮: 删除 dim backdrop。之前一直在 dim 数值上做调试
                  (50%→30%→15%) 治标——根因是 chrome (z-10) 在 end-overlay
                  container (z-20) 下面,dim 在中间洗它。
                  正解 (Leon): chrome / Replay / Continue this story 都应在同
                  一可见层。删 dim div 后:end-overlay 变纯透明 flex centerer,
                  chrome 在 z-10 完全可见 (背景就是视频末帧本身),Replay/Continue
                  在 z-20 仍然居中悬浮在 chrome 之上。三者共存不打架,无需 dim
                  也无需 z-index hack,「自然就可以解决」。
                  **延期决策 D-010**(`docs/governance/DEFERRED-DECISIONS.md`): 是否加极轻
                  dim(`bg-black/6` 量级)作为 mode-shift 信号 — 当前选择不加,
                  等甲方/用户实测反馈再启。不要预防性加 dim。 */}
              {/* §2026-05-30 round-106 path A — Library 自有 end-overlay Replay 删除:
                  customControls 下 PlayerActionBar(round-93)已在 'ended' 时居中显
                  VideoReplayButton,再叠一个会重复。中心 Replay 统一由 PlayerActionBar 管。 */}
            </div>

            {/* ── Bottom: Info + actions panel ──
             * 2026-05-14 Leon: 宽 720→512 居中,bg solid→glass。
             * 第二轮 (同日): glass-frosted-edge (40% black 18px blur) 还是偏厚重,
             * 换 glass-clear (8% white 80px blur) — 真半透磨砂效果,
             * 露背后 Library 网格的浅色感,与轻量化遮罩呼应。 */}
            {/* 2026-05-17 Leon — 嵌套 rounded 层次替代 hairline divider。
             * 外层 glass-clear rounded-2xl 不变,只把内 padding 收
             * 为 p-2 给内嵌 sub-card 让位;Title/ID 与 Actions 各成 inner
             * rounded-xl sub-card,用浅 wash 表达"内嵌一层"的深度感。
             * Light:  bg-black/4 (黑 wash,在浅玻璃上略沉)
             * Dark:   bg-white/5 (白 wash,在深玻璃上略亮)
             * 视觉来源:Leon 5/17 参考图 (Create prompt 区的 nested chips +
             * textarea 双 sub-card 布局)。 */}
            <div className="w-full max-w-[512px] mx-auto glass-clear rounded-2xl shadow-xl p-2">

              {/* Header: title + id (2026-05-15 Leon: X close 已移到视频左上 CaretLeft) */}
              <div className="rounded-xl bg-black/4 dark:bg-white/5 px-4 py-3 mb-2">
                <h2 className="text-lg font-bold text-label mb-1 line-clamp-2">{selectedWork.title}</h2>
                <p className="text-[11px] text-label-tertiary font-mono">ID: {selectedWork.id}</p>
              </div>

              {/* Actions row — 2026-05-14 Leon:
                   - Visibility 占左,Share + Continue Story 右靠齐
                   - 按钮宽度跟随文字(`w-auto` / 不再 `1fr`),不被均分撑宽
                   - Continue Story 是 primary action,排最右(最远离 backdrop dismiss,
                     最贴近习惯的拇指扫到的位置)
                   - flex-wrap 让 mobile 自适应换行
                   2026-05-17 Leon — 去 `pt-4 border-t border-background-secondary`。
                   2026-05-17 Leon (2nd pass) — 不加 inner rounded sub-card,
                   actions 裸放在外层 glass 上,只有上方 Title/ID 一个嵌套层次,
                   与参考图 (Create prompt) actions 行裸放对齐。padding `px-4 py-3`
                   保持 buttons 横向起始位与上方 Title/ID 内容对齐。 */}
              <div className="px-4 py-3 flex items-center flex-wrap gap-3">

                {/* Left: Visibility toggle (label + switch) */}
                <div className="flex items-center gap-2 mr-auto">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-label leading-tight">Visibility</p>
                    <p className="text-[10px] text-label-tertiary leading-tight">
                      {selectedWork.published ? 'On Discover' : 'Only you'}
                    </p>
                  </div>
                  {isToggling ? (
                    <CircleNotch size={20} className="animate-spin text-label-tertiary flex-shrink-0" />
                  ) : (
                    <Toggle
                      on={selectedWork.published}
                      onToggle={handleTogglePublish}
                      disabled={isToggling}
                      size="regular"
                    />
                  )}
                </div>

                {/* §2026-05-31 Leon round-103 Phase B — Allow Download toggle.
                  * Owner viewers always see the download icon (player caller
                  * adds `isOwner || allow_download` to showDownload). This
                  * toggle controls whether OTHER viewers see it too. */}
                <div className="flex items-center gap-2 mr-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-label leading-tight">Allow download</p>
                    <p className="text-[10px] text-label-tertiary leading-tight">
                      {selectedWork.allow_download
                        ? 'Viewers can download'
                        : 'Owner only'}
                    </p>
                  </div>
                  {isTogglingAllowDownload ? (
                    <CircleNotch size={20} className="animate-spin text-label-tertiary flex-shrink-0" />
                  ) : (
                    <Toggle
                      on={!!selectedWork.allow_download}
                      onToggle={handleToggleAllowDownload}
                      disabled={isTogglingAllowDownload}
                      size="regular"
                    />
                  )}
                </div>

                {/* 2026-05-13 Leon — Delete 仅 Private 状态显示，destructive secondary
                    样式（ghost button + red hover），与 primary Sequel/Share 区分。
                    Series 类型的 selectedWork 走 setSelectedSeries 不会到这里，
                    但 handler 内仍有防御性 check。 */}
                {!selectedWork.published && selectedWork.type !== 'series' && (
                  <button
                    onClick={handleDeleteWork}
                    disabled={isDeletingWork}
                    className="inline-flex items-center justify-center gap-2 py-2 px-4 text-label-secondary hover:text-red-500 hover:bg-red-500/10 rounded-full font-medium transition text-sm disabled:opacity-50"
                  >
                    {isDeletingWork ? <CircleNotch size={16} className="animate-spin" /> : <Trash size={16} />}
                    Delete
                  </button>
                )}

                {/* 2026-05-13 Leon — Share 缩成 icon + pill（去 "Share" 文字），
                    避免 4-button row 在 detail panel 宽度内换行。capsule 形态保留，
                    Sparkle "+10" reward 仍内显（不靠 tooltip）。 */}
                <button
                  onClick={handleShare}
                  title="Share +10"
                  className="inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-background-secondary hover:bg-background-tertiary text-label rounded-full font-medium transition text-sm"
                >
                  <ShareNetwork size={16} />
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">
                    <Sparkle size={10} weight="fill" />
                    <span className="tabular-nums">+10</span>
                  </span>
                </button>

                {/* §2026-05-25 fei — Sequel button removed per product decision
                    (feature being retired alongside Branch in SparkMode). */}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CaretLeft, PlayCircle, CircleNotch, House, FilmStrip, PencilSimple, Flag, Lock, Coin, CheckCircle } from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';
import ReportContentModal from '../components/ReportContentModal';
import VideoPlayer from '../design-system/composites/VideoPlayer';
import PaywallModal from '../components/PaywallModal';
import { listSeriesEpisodes, fetchEpisodeAccess } from '../api/dramaPayService';
// §2026-05-31 Leon round-103 Phase B — isOwner download path for drama.
import { downloadVideo } from '../utils/downloadVideo';

/**
 * Public-facing detail page for a Series. Reached by:
 *   - Discover card click (cta_url = /series/:id)
 *   - Direct shared link
 *   - "My Series" listing → "View" link
 *
 * Shows series header (title, description, cast avatars) + a player
 * for the currently selected episode + the full episode list. Click
 * any episode thumbnail to switch the player.
 *
 * Access control: handled by Supabase RLS via two policies:
 *   - series_public_read: anyone can SELECT status='published'
 *   - series_owner_full: owner can SELECT any status (so they can
 *     preview their own drafts/archived from this page too)
 *
 * Episode playback dual-path:
 *   - ep.streamUid set → Cloudflare Stream iframe embed (HLS adaptive)
 *   - ep.streamUid null → R2 direct .mp4 in <video> tag
 * This mirrors how StoryGeneratorPage uploaded the episode and stored
 * the URL fields. See migrations/20260508_series.up.sql for shape.
 */
export default function SeriesDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [series, setSeries] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEpIdx, setActiveEpIdx] = useState(0);
  const [currentUser, setCurrentUser] = useState(null);
  /* §2026-05-26 fei (audit #11) — Stripe checkout return-status banner.
   * Bundle checkout's cancel_url is /series/:id?checkout=cancelled. SubscriptionPage
   * already handles its own ?checkout=cancelled for Tokens topup; this is the
   * parallel surface for bundle purchases. 'cancelled' is treated as user-initiated
   * (no error toast just a soft amber notice they can dismiss). */
  const [checkoutBanner, setCheckoutBanner] = useState(() => {
    if (typeof window === 'undefined') return null;
    const sp = new URLSearchParams(window.location.search);
    const status = sp.get('checkout');
    if (status === 'cancelled') return 'cancelled';
    if (status === 'success')   return 'success';
    return null;
  });
  const [reportOpen, setReportOpen] = useState(false);

  /* §2026-05-25 fei — Phase 1 短剧付费.
   *   episodesV2     — rows from the new public.episodes table
   *   accessMap      — { [episode_id]: { can_watch, reason, video_url, stream_uid, locked? } }
   *                    Populated lazily on first click of each episode card.
   *   loadingAccess  — episode_id currently being checked (shows spinner)
   *   paywallEp      — episode object the paywall is currently rendering for
   *
   * The legacy series.episodes JSONB is the fallback when episodesV2 is
   * empty (during the brief window before the data-migration runs in
   * Supabase). Once migration is in, episodesV2 wins. */
  const [episodesV2, setEpisodesV2] = useState([]);
  const [accessMap, setAccessMap] = useState({});
  const [loadingAccess, setLoadingAccess] = useState(null);
  const [paywallEp, setPaywallEp] = useState(null);
  const [activeEpV2Id, setActiveEpV2Id] = useState(null);  // when set, player uses video from accessMap

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        // Identify caller (used to show edit link if owner).
        const { data: { user } } = await supabase.auth.getUser();
        if (!cancelled) setCurrentUser(user);

        // Fetch series. RLS handles access (public read for published,
        // owner read for their own drafts).
        const { data: seriesRow, error: seriesErr } = await supabase
          .from('series')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (seriesErr) throw seriesErr;
        if (!seriesRow) throw new Error('Series not found or not yet published.');
        if (cancelled) return;
        setSeries(seriesRow);

        // Fetch cast characters (best-effort — if user has deleted a
        // character, that ID just renders as a placeholder).
        if (Array.isArray(seriesRow.cast_ids) && seriesRow.cast_ids.length > 0) {
          const { data: charRows } = await supabase
            .from('characters')
            .select('id, name, photo_url, image_url')
            .in('id', seriesRow.cast_ids);
          if (!cancelled) setCharacters(charRows || []);
        }

        /* §2026-05-25 fei — also fetch episodes from new episodes table
         *   so we have stable episode_id values to feed /access checks +
         *   the paywall modal. Fails open: if 0 rows (data migration
         *   hasn't run yet) we fall back to series.episodes JSONB below. */
        try {
          const eps = await listSeriesEpisodes(id);
          if (!cancelled) setEpisodesV2(eps);
        } catch (epsErr) {
          console.warn('[SeriesDetailPage] episodes table fetch failed:', epsErr);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load series');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [id]);

  /* §2026-05-26 fei — CRITICAL BUG FIX: auto-fetch access for the active
   *   (default = ep1) V2 episode on page load.
   *
   *   Previous behavior: accessMap was lazy-populated only by user clicks on
   *   episode cards (handleEpisodeClick). Page-load default activeEpIdx=0
   *   selects ep1, but its accessMap entry stays undefined → activeEp computed
   *   to null → main player area falls through to the "第 N 集需要解锁 / 立即
   *   解锁" branch. Clicking "立即解锁" opened PaywallModal even when ep1 is
   *   FREE (free_episodes_count >= 1) — user could pay Tokens for content
   *   they're entitled to watch for $0. Reported by fei 2026-05-26 with
   *   Neowow screenshots (ep1 chip on right showed "免费 / NOW PLAYING"
   *   but main area asked to unlock).
   *
   *   Root cause was a missing trigger, not bad logic — the worker's access
   *   endpoint correctly returns can_watch=true for episode_no <=
   *   free_episodes_count. We just never asked it.
   *
   *   Fix: as soon as episodesV2 arrives, auto-fetch access for whichever
   *   episode is currently active (handles both the initial mount with
   *   default idx 0 AND subsequent idx changes from auto-advance / direct
   *   nav). Guards:
   *     - skip if accessMap already has it (no double-fetch)
   *     - skip if loadingAccess is already on it (no race)
   *     - silent catch (unlike handleEpisodeClick we don't alert on failure —
   *       page load shouldn't surface error toasts; user can still tap the
   *       card to retry which DOES alert) */
  useEffect(() => {
    if (loading) return;
    if (episodesV2.length === 0) return;
    const idx = Math.min(activeEpIdx, episodesV2.length - 1);
    const ep = episodesV2[idx];
    if (!ep) return;
    if (accessMap[ep.id]) return;
    if (loadingAccess === ep.id) return;

    let cancelled = false;
    (async () => {
      setLoadingAccess(ep.id);
      try {
        const access = await fetchEpisodeAccess({ episodeId: ep.id });
        if (cancelled) return;
        setAccessMap(prev => ({ ...prev, [ep.id]: access }));
        // If access grants playback, wire the V2 id so the player uses
        // accessMap-resolved video_url (matches handleEpisodeClick behavior).
        if (access?.can_watch) {
          setActiveEpV2Id(ep.id);
        }
      } catch (err) {
        // Silent: not logged in / network blip. Main UI still shows
        // the lock screen (correct behavior — user just sees "unlock"
        // instead of player until they sign in / network recovers).
        console.warn('[SeriesDetailPage] auto-fetch active ep access failed:', err);
      } finally {
        if (!cancelled) setLoadingAccess(null);
      }
    })();

    return () => { cancelled = true; };
  // Re-run when the series finishes loading, when the V2 list arrives,
  // or when the active index changes (auto-advance / paywall unlock).
  }, [loading, episodesV2, activeEpIdx]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-label-secondary">
        <CircleNotch size={28} className="animate-spin mr-2" /> Loading series…
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-label-secondary px-6 text-center">
        <FilmStrip size={48} className="mb-4 text-label-tertiary" />
        <p className="text-label mb-2">Series unavailable</p>
        <p className="text-xs mb-6">{error || 'Not found'}</p>
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:bg-accent/90"
        >
          <House size={14} className="inline mr-1.5 -mt-0.5" /> Go home
        </button>
      </div>
    );
  }

  /* §2026-05-25 fei — prefer episodes from new table when present.
   *   Normalize to a unified shape: { id, episode_no, title, video_url,
   *   stream_uid, thumbnail_url }. Both shapes flow through the same
   *   render loop below. */
  const isV2 = episodesV2.length > 0;
  const playableEpisodes = isV2
    ? episodesV2.map(ep => ({
        id: ep.id,
        episode_no: ep.episode_no,
        title: ep.title,
        video_url: null,        // resolved via /access on click
        stream_uid: null,
        thumbnail_url: ep.thumbnail_url,
        _is_v2: true,
      }))
    : (Array.isArray(series.episodes) ? series.episodes : [])
        .filter(ep => ep && ep.status === 'ready' && ep.url)
        .map((ep, idx) => ({
          id: ep.id || `legacy_${idx}`,
          episode_no: idx + 1,
          title: ep.title,
          video_url: ep.url,
          stream_uid: ep.streamUid,
          thumbnail_url: ep.thumbnailUrl,
          _is_v2: false,
        }));

  const isOwner = currentUser && currentUser.id === series.user_id;

  // Clamp active index in case stale state from list switch
  const activeIdx = Math.min(activeEpIdx, playableEpisodes.length - 1);
  const activeEpListed = playableEpisodes[activeIdx] || null;

  // When the active ep is a v2 row, use accessMap entry for the resolved
  //   video URLs (which only exist after access check granted can_watch).
  //
  // §2026-05-25 fei BUG FIX — worker /api/episodes/:id/access returns
  //   { success, can_watch, reason, episode: { video_url, stream_uid, … } }
  //   (URLs nested under `episode`). We were reading from access.video_url
  //   (top level, always undefined) → player got src=undefined → black
  //   player even though the unlock badge correctly showed 已解锁. Read
  //   from access.episode.* instead.
  const activeAccess = activeEpListed && accessMap[activeEpListed.id];
  const activeEp = activeEpListed && (activeEpListed._is_v2
    ? (activeAccess?.can_watch ? {
        ...activeEpListed,
        video_url: activeAccess.episode?.video_url,
        stream_uid: activeAccess.episode?.stream_uid,
      } : null)
    : activeEpListed);

  /* On user click of an episode card:
   *   - V2 row: fetch /access. can_watch → play. locked → open paywall.
   *   - Legacy row: just swap activeEpIdx (no access check, all-free).
   * Click on the same active episode is a no-op (already loaded). */
  const handleEpisodeClick = async (ep, idx) => {
    if (!ep._is_v2) {
      setActiveEpIdx(idx);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // V2: check / re-use cached access
    let access = accessMap[ep.id];
    if (!access) {
      setLoadingAccess(ep.id);
      try {
        access = await fetchEpisodeAccess({ episodeId: ep.id });
        setAccessMap(prev => ({ ...prev, [ep.id]: access }));
      } catch (err) {
        console.warn('[SeriesDetailPage] access check failed:', err);
        alert('权限检查失败:' + (err.message || err));
        setLoadingAccess(null);
        return;
      } finally {
        setLoadingAccess(null);
      }
    }

    if (access?.can_watch) {
      setActiveEpIdx(idx);
      setActiveEpV2Id(ep.id);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (access?.reason === 'need_login') {
      /* §2026-05-26 fei — anon visitor clicked a paid episode. App's AuthPage
       *   is root-gated via IndexPage (no standalone /signin route), so we
       *   navigate to '/' which forces sign-in if needed. After auth they
       *   land on Discover (not back to /series/:id — followup task to wire
       *   a `next` query param into IndexPage's auth handoff). Still better
       *   than the previous behavior (alert "权限检查失败"). */
      const ok = window.confirm(`第 ${ep.episode_no} 集需要 ${access.locked?.price ?? '?'} Tokens 解锁。\n登录后可解锁观看,是否前往登录?`);
      if (ok) navigate('/');
    } else if (access?.reason === 'locked') {
      setPaywallEp(ep);
    }
  };

  /* §2026-05-25 fei — when the active episode finishes playing, auto-
   * advance to the next ready episode in the list. Auto-advance respects
   * the paywall: if the next episode is locked, open PaywallModal instead
   * of silently doing nothing. User picks "unlock + continue" or closes.
   *
   * Legacy (non-v2) episodes: just swap index, no access check.
   *
   * Last episode: stop (don't loop). Render station footer below shows
   * "All done" implicit state. */
  const handleEpisodeEnded = async () => {
    const nextIdx = activeIdx + 1;
    if (nextIdx >= playableEpisodes.length) {
      console.log('[SeriesDetailPage] series end — no more episodes');
      return;
    }
    const nextEp = playableEpisodes[nextIdx];

    if (!nextEp._is_v2) {
      // Legacy row — always free
      setActiveEpIdx(nextIdx);
      return;
    }

    // V2 — must check access before continuing
    let access = accessMap[nextEp.id];
    if (!access) {
      setLoadingAccess(nextEp.id);
      try {
        access = await fetchEpisodeAccess({ episodeId: nextEp.id });
        setAccessMap(prev => ({ ...prev, [nextEp.id]: access }));
      } catch (err) {
        console.warn('[SeriesDetailPage] auto-advance access check failed:', err);
        setLoadingAccess(null);
        return;
      } finally {
        setLoadingAccess(null);
      }
    }

    if (access?.can_watch) {
      setActiveEpIdx(nextIdx);
      setActiveEpV2Id(nextEp.id);
    } else if (access?.reason === 'locked') {
      // Open paywall for the next ep without changing the player yet —
      //   user sees the "ended" state on current ep while paywall asks
      //   them to unlock the next one.
      setPaywallEp(nextEp);
    }
  };

  /* Called by PaywallModal after a successful unlock. Refetch access
   * (now should return can_watch=true), close the modal, start playback. */
  const handlePaywallUnlocked = async (unlockRes) => {
    const ep = paywallEp;
    if (!ep) return;
    setPaywallEp(null);
    try {
      const fresh = await fetchEpisodeAccess({ episodeId: ep.id });
      setAccessMap(prev => ({ ...prev, [ep.id]: fresh }));
      if (fresh.can_watch) {
        const idx = playableEpisodes.findIndex(e => e.id === ep.id);
        if (idx >= 0) {
          setActiveEpIdx(idx);
          setActiveEpV2Id(ep.id);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    } catch (err) {
      console.warn('[SeriesDetailPage] post-unlock access refresh failed:', err);
    }
  };

  return (
    <div className="min-h-screen bg-background text-label">
      {/* Top nav */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-background-secondary">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-label-secondary hover:text-label transition-colors text-sm"
          >
            <CaretLeft size={20} weight="bold" /> Back
          </button>
          <div className="flex items-center gap-3">
            {series.status !== 'published' && (
              <span className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/30">
                {series.status}
              </span>
            )}
            {isOwner && (
              <Link
                to="/create"
                className="flex items-center gap-1.5 text-xs text-accent hover:opacity-80 transition-opacity"
              >
                <PencilSimple size={14} /> Edit
              </Link>
            )}
            {!isOwner && (
              <button
                onClick={() => setReportOpen(true)}
                className="flex items-center gap-1.5 text-xs text-label-tertiary hover:text-red-500 transition-colors"
                title="Report this series"
              >
                <Flag size={14} /> Report
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Report-content modal — series detail page entry point */}
      <ReportContentModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        contentType="series"
        contentId={id}
        contentTitle={series?.title}
      />

      {/* §2026-05-25 fei — bumped max-w-5xl → max-w-7xl to make room for
          the new 2-col layout (player + sticky episode list sidebar). */}
      <div className="max-w-7xl mx-auto px-4 py-6 md:py-10">
        {/* §2026-05-26 fei (audit #11) — Bundle checkout return-status banner.
            Mounted at the top of the page body so users see it the moment they
            land back from Stripe. Dismiss removes the banner only (URL param
            stays — clears on next nav). */}
        {checkoutBanner === 'cancelled' && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
            <span className="text-amber-500 text-lg">✕</span>
            <p className="text-sm text-label flex-1">买断已取消,你可以稍后再试或选择单集解锁。</p>
            <button
              onClick={() => setCheckoutBanner(null)}
              className="text-label-tertiary hover:text-label text-xs"
            >
              关闭
            </button>
          </div>
        )}
        {checkoutBanner === 'success' && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
            <span className="text-emerald-500 text-lg">✓</span>
            <p className="text-sm text-label flex-1">买断成功!所有集已解锁,现在可以连续观看。</p>
            <button
              onClick={() => setCheckoutBanner(null)}
              className="text-label-tertiary hover:text-label text-xs"
            >
              关闭
            </button>
          </div>
        )}
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[11px] uppercase tracking-[0.18em] text-accent font-medium">Series</span>
            {/* §2026-05-25 fei Phase 3 — surface curation badges so users
                see immediately when ops has flagged a series as 首发 or 推荐. */}
            {series.is_premiere && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                ★ 首发
              </span>
            )}
            {series.is_recommended && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                ♥ 推荐
              </span>
            )}
            {series.member_free && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
                会员免费
              </span>
            )}
          </div>
          <h1
            className="text-3xl md:text-4xl font-medium tracking-tight mt-2 mb-3"
            style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
          >
            {series.title}
          </h1>
          <p className="text-sm text-label-secondary mb-4">
            {playableEpisodes.length} episode{playableEpisodes.length === 1 ? '' : 's'}
            {series.published_at && (
              <> · Published {new Date(series.published_at).toLocaleDateString()}</>
            )}
          </p>
          {series.description && (
            <p className="text-base text-label-secondary leading-relaxed mb-6 max-w-2xl">
              {series.description}
            </p>
          )}

          {characters.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-label-tertiary uppercase tracking-wider">Cast</span>
              <div className="flex -space-x-2">
                {characters.slice(0, 6).map(char => (
                  <img
                    key={char.id}
                    src={char.photo_url || char.image_url}
                    alt={char.name || 'Cast member'}
                    title={char.name || 'Cast member'}
                    className="w-10 h-10 rounded-full border-2 border-background object-cover"
                  />
                ))}
                {characters.length > 6 && (
                  <div className="w-10 h-10 rounded-full bg-background-secondary border-2 border-background flex items-center justify-center text-xs text-label-secondary font-medium">
                    +{characters.length - 6}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* §2026-05-25 fei — 2-col layout on lg+ so the episode list stays
            visible (sticky sidebar) while a video plays. On mobile we keep
            the original stacked layout: player on top, list below. */}
        <div className="lg:flex lg:gap-6 lg:items-start">
          <div className="lg:flex-1 lg:min-w-0">
        {/* ─── Player ─────────────────────────────────────────────────── */}
        {activeEp ? (
          <div className="mb-6">
            <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-lg">
              {/* §2026-05-29 Leon round-102 → round-106 — VideoPlayer composite
               * + transport。kind="primary"(chrome) + contentType="series"(播放
               * 逻辑:autoplay 默认 ON 自动下一集 / 🔁 默认 off)。
               *   onNext = handleEpisodeEnded(下一集 + paywall check),末集时不传
               *     → ⏭ 隐藏 + 播完显 Replay(不前进)。
               *   onPrev = 切上一集(已解锁),首集时不传 → ⏮ 隐藏。
               *   onEnded 已移除:auto-advance 改由 PlayerActionBar autoplay+onNext
               *     驱动(避免 onEnded 跟 onNext 双触发跳两集)。 */}
              <VideoPlayer
                kind="primary"
                contentType="series"
                key={activeEp.stream_uid || activeEp.video_url}
                src={activeEp.stream_uid
                  ? `https://videodelivery.net/${activeEp.stream_uid}/manifest/video.m3u8`
                  : activeEp.video_url}
                className="w-full h-full object-contain"
                onPrev={activeIdx > 0
                  ? () => handleEpisodeClick(playableEpisodes[activeIdx - 1], activeIdx - 1)
                  : undefined}
                onNext={activeIdx < playableEpisodes.length - 1
                  ? handleEpisodeEnded
                  : undefined}
                /* §2026-05-31 Leon round-103 Phase B — drama download policy:
                 *   isOwner ONLY (paywall-protected content; allow_download is
                 *   intentionally NOT a column on series/episodes — see
                 *   migrations/20260531_recommended_content_allow_download.up.sql
                 *   for the rationale). Non-owners never see Download. */
                showDownload={isOwner}
                onDownload={isOwner ? () => downloadVideo(
                  activeEp.stream_uid
                    ? `https://videodelivery.net/${activeEp.stream_uid}/manifest/video.m3u8`
                    : activeEp.video_url,
                  activeEp.title || `Episode ${activeIdx + 1}`,
                ) : undefined}
              />
            </div>
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-label-tertiary">Now playing</span>
              <span className="text-sm font-medium">{activeEp.title || `Episode ${activeIdx + 1}`}</span>
              {/* §2026-05-25 fei — show unlock reason chip if v2 + paid */}
              {activeAccess && activeAccess.reason && activeAccess.reason !== 'free' && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                  {activeAccess.reason === 'unlocked' && '已解锁'}
                  {activeAccess.reason === 'ucoins' && '已解锁'}
                  {activeAccess.reason === 'bundle' && '整剧买断'}
                  {activeAccess.reason === 'member' && '会员'}
                </span>
              )}
              {/* §2026-05-25 fei — "next up" peek so user knows what's coming */}
              {activeIdx + 1 < playableEpisodes.length && (
                <span className="text-[11px] text-label-tertiary ml-auto">
                  下一集自动播放:{playableEpisodes[activeIdx + 1].title || `Episode ${playableEpisodes[activeIdx + 1].episode_no}`}
                </span>
              )}
            </div>
          </div>
        ) : activeEpListed && activeEpListed._is_v2 ? (
          /* §2026-05-25 fei — v2 episode selected but not yet unlocked.
             Show a paywall-style poster instead of player.
             §2026-05-26 fei — differentiate need_login (anon visitor) from
             locked (logged-in user without balance). need_login: CTA jumps
             to sign-in instead of opening PaywallModal (which would have
             nothing to deduct from). */
          activeAccess?.reason === 'need_login' ? (
            <div className="mb-6 aspect-video bg-gradient-to-br from-background-secondary to-background-tertiary rounded-2xl flex flex-col items-center justify-center text-label-secondary p-6">
              <Lock size={36} className="mb-3 text-accent" weight="fill" />
              <p className="text-sm font-medium text-label mb-1">第 {activeEpListed.episode_no} 集需要 {activeAccess.locked?.price ?? '?'} Tokens</p>
              <p className="text-xs text-label-tertiary mb-3">登录后可使用 Tokens 解锁观看</p>
              <button
                onClick={() => navigate('/')}
                className="mt-2 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                登录 / 注册
              </button>
            </div>
          ) : (
            <div className="mb-6 aspect-video bg-gradient-to-br from-background-secondary to-background-tertiary rounded-2xl flex flex-col items-center justify-center text-label-secondary p-6">
              <Lock size={36} className="mb-3 text-amber-500" weight="fill" />
              <p className="text-sm font-medium text-label mb-2">第 {activeEpListed.episode_no} 集需要解锁</p>
              <button
                onClick={() => setPaywallEp(activeEpListed)}
                className="mt-2 px-4 py-2 bg-accent text-white rounded-full text-sm font-medium flex items-center gap-2 hover:opacity-90 transition-opacity"
              >
                <Coin size={14} weight="fill" /> 立即解锁
              </button>
            </div>
          )
        ) : (
          <div className="mb-6 aspect-video bg-background-secondary rounded-2xl flex items-center justify-center text-label-tertiary text-sm">
            No episodes available yet.
          </div>
        )}
          </div>

          {/* ─── Episode list ───────────────────────────────────────────── */}
          {/* §2026-05-25 fei — sticky sidebar on lg+, stacked on mobile.
              Wider grid on mobile (1 col), single column on desktop sidebar
              (was 3-col grid below player; now narrow vertical list). */}
        {playableEpisodes.length > 0 && (
          <div className="lg:w-80 lg:shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1">
            <h3 className="text-base font-medium mb-3 flex items-center gap-2">
              All episodes
              {isV2 && series.free_episodes_count > 0 && (
                <span className="text-[10px] uppercase tracking-wider text-label-tertiary font-normal">
                  · 前 {series.free_episodes_count} 集免费
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              {playableEpisodes.map((ep, idx) => {
                const isActive = idx === activeIdx;
                const access = accessMap[ep.id];
                const isLoading = loadingAccess === ep.id;
                /* Free-by-position inference for v2 episodes BEFORE we
                 * fetch /access. Lets us render an accurate lock badge on
                 * page load without 30 round-trips. */
                const isLikelyFree = ep._is_v2
                  ? ep.episode_no <= (series.free_episodes_count || 0)
                  : true;
                const isLocked = ep._is_v2 && (access
                  ? access.reason === 'locked'
                  : !isLikelyFree);
                const price = access?.locked?.price || series.ucoins_per_episode || 40;

                const thumbSrc = ep.thumbnail_url || (ep.stream_uid
                  ? `https://videodelivery.net/${ep.stream_uid}/thumbnails/thumbnail.jpg`
                  : null);
                return (
                  <button
                    key={ep.id || idx}
                    onClick={() => handleEpisodeClick(ep, idx)}
                    disabled={isLoading}
                    className={`group flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                      isActive
                        ? 'border-accent bg-accent/5'
                        : 'border-background-tertiary bg-background-secondary hover:border-accent/40'
                    } ${isLoading ? 'opacity-60 cursor-wait' : ''}`}
                  >
                    <div className="relative w-24 aspect-video shrink-0 rounded-lg overflow-hidden bg-black">
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={ep.title || `Episode ${ep.episode_no}`}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            if (!e.target.dataset.retried) {
                              e.target.dataset.retried = '1';
                              setTimeout(() => { e.target.src = thumbSrc + '?t=' + Date.now(); }, 5000);
                            }
                          }}
                        />
                      ) : ep.video_url ? (
                        <video src={ep.video_url} className="w-full h-full object-cover" muted />
                      ) : (
                        <div className="w-full h-full bg-background-tertiary" />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isLoading ? (
                          <CircleNotch size={24} className="animate-spin text-white" />
                        ) : isLocked ? (
                          <Lock size={26} weight="fill" className="text-amber-400" />
                        ) : (
                          <PlayCircle size={28} weight="fill" className="text-white" />
                        )}
                      </div>
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-medium">
                        {ep.episode_no || idx + 1}
                      </div>
                      {/* Lock / unlock badge — top-right corner */}
                      {ep._is_v2 && (
                        access?.can_watch || (isLikelyFree && !access) ? (
                          isLikelyFree && (
                            <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-emerald-500/90 text-white text-[9px] font-bold uppercase tracking-wider">
                              免费
                            </div>
                          )
                        ) : isLocked ? (
                          <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-[9px] font-bold flex items-center gap-0.5">
                            <Coin size={9} weight="fill" /> {price}
                          </div>
                        ) : null
                      )}
                      {/* Already-unlocked check mark (after access fetch) */}
                      {access?.can_watch && !isLikelyFree && (
                        <div className="absolute top-1 right-1 bg-emerald-500/90 text-white rounded-full p-0.5">
                          <CheckCircle size={10} weight="fill" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${isActive ? 'text-accent' : ''}`}>
                        {ep.title || `Episode ${ep.episode_no || idx + 1}`}
                      </div>
                      {isActive && (
                        <div className="text-[10px] uppercase tracking-wider text-accent mt-0.5">
                          Now playing
                        </div>
                      )}
                      {!isActive && isLocked && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                          <Coin size={9} weight="fill" /> 解锁 {price} Tokens
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        </div>{/* end lg:flex wrapper (player + episode list side by side) */}

        {/* §2026-05-25 fei — Paywall modal */}
        <PaywallModal
          open={!!paywallEp}
          onClose={() => setPaywallEp(null)}
          episode={paywallEp}
          series={series}
          locked={paywallEp ? accessMap[paywallEp.id]?.locked : null}
          onUnlocked={handlePaywallUnlocked}
        />
      </div>
    </div>
  );
}

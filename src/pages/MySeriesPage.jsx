import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CaretLeft, Plus, FilmStrip, Eye, PencilSimple, CircleNotch, House, CheckCircle, Archive, Coin } from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';
import PaywallSettingsModal from '../components/PaywallSettingsModal';

/**
 * "My Series" listing — drafts + published series owned by the
 * current user. Two main affordances:
 *   - View → /series/:id (shared detail page; owner sees drafts too
 *     because RLS series_owner_full overrides public-read)
 *   - Edit → /create (loads the series back into the StoryGenerator
 *     form via ?series=<id> query param — handled in StoryGeneratorPage)
 *
 * Filter chips at top: All / Drafts / Published / Archived. Empty
 * state suggests creating one.
 *
 * Access: requires login. Anonymous users get redirected to /auth.
 */
export default function MySeriesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  /* §2026-05-26 fei — paywall settings modal target series. null = closed.
   * Creator clicks 💰 定价 → modal opens with current values → save → in-place
   * patch items[] so the card UI reflects new values without a full refetch. */
  const [paywallEditing, setPaywallEditing] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          navigate('/');
          return;
        }
        /* §2026-05-25 fei Phase 3 — order by 首发 / 推荐 priority first,
         *   then most recent. Owner's own listing is mostly chronological
         *   but if ops flagged any of their series as premiere/recommended
         *   it floats to the top — matches how curated drops should feel
         *   on the public-facing side once Discover gets the same sort. */
        const { data, error: e } = await supabase
          .from('series')
          .select('*')
          .eq('user_id', user.id)
          .order('is_premiere', { ascending: false })
          .order('is_recommended', { ascending: false })
          .order('updated_at', { ascending: false });
        if (e) throw e;
        if (!cancelled) setItems(data || []);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [navigate]);

  const filtered = filter === 'all'
    ? items
    : items.filter(s => s.status === filter);

  const counts = {
    all: items.length,
    draft: items.filter(s => s.status === 'draft').length,
    published: items.filter(s => s.status === 'published').length,
    archived: items.filter(s => s.status === 'archived').length,
  };

  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Drafts', icon: PencilSimple },
    { id: 'published', label: 'Published', icon: CheckCircle },
    { id: 'archived', label: 'Archived', icon: Archive },
  ];

  return (
    <div className="min-h-screen bg-background text-label">
      {/* Top nav */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-background-secondary">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-label-secondary hover:text-label transition-colors text-sm"
          >
            <CaretLeft size={20} weight="bold" /> Back
          </button>
          <Link
            to="/create"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent/90 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Plus size={14} /> New series
          </Link>
          {/* §2026-05-25 fei Phase 3 — link to creator earnings dashboard */}
          <Link
            to="/creator/earnings"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-background-tertiary hover:bg-background-secondary text-label rounded-lg text-xs font-medium transition-colors"
            title="查看你的剧集分成结算"
          >
            <Coin size={14} weight="fill" className="text-amber-500" /> 我的收益
          </Link>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
        {/* ─── Header ──────────────────────────────────────────────────── */}
        <div className="mb-6">
          <span className="text-[11px] uppercase tracking-[0.18em] text-accent font-medium">Library</span>
          <h1
            className="text-3xl md:text-4xl font-medium tracking-tight mt-2 mb-2"
            style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
          >
            My Series
          </h1>
          <p className="text-sm text-label-secondary">
            Series you've started or published. Click any to view; click Edit to keep working on a draft.
          </p>
        </div>

        {/* ─── Filter chips ────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-6">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors flex items-center gap-1.5 ${
                filter === f.id
                  ? 'bg-accent text-white'
                  : 'bg-background-secondary text-label-secondary hover:text-label'
              }`}
            >
              {f.icon && <f.icon size={12} />}
              {f.label}
              <span className={`text-[10px] ${filter === f.id ? 'text-white/70' : 'text-label-tertiary'}`}>
                {counts[f.id]}
              </span>
            </button>
          ))}
        </div>

        {/* ─── List ────────────────────────────────────────────────────── */}
        {loading && (
          <div className="text-label-secondary p-6 text-sm flex items-center gap-2">
            <CircleNotch size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {error && <div className="text-red-500 p-6 text-sm">Failed: {error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="bg-background-secondary border border-background-tertiary rounded-2xl p-10 text-center">
            <FilmStrip size={40} className="mx-auto text-label-tertiary mb-4" />
            <p className="text-label mb-2">
              {filter === 'all' ? 'No series yet' : `No ${filter} series`}
            </p>
            <p className="text-sm text-label-secondary mb-6">
              {filter === 'all'
                ? 'Start your first connected story — multi-episode, with a recurring cast.'
                : `Try a different filter or start a new series.`}
            </p>
            <Link
              to="/create"
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <Plus size={14} /> Create a Series
            </Link>
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(s => {
              const epCount = Array.isArray(s.episodes) ? s.episodes.filter(e => e?.status === 'ready').length : 0;
              const totalEp = Array.isArray(s.episodes) ? s.episodes.length : 0;
              return (
                <div
                  key={s.id}
                  className="bg-background-secondary border border-background-tertiary rounded-2xl overflow-hidden hover:border-accent/30 transition-colors"
                >
                  <Link to={`/series/${s.id}`}>
                    <div className="aspect-video bg-black relative overflow-hidden">
                      {s.cover_url ? (
                        <img
                          src={s.cover_url}
                          alt={s.title}
                          className="w-full h-full object-cover"
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
                      <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
                        <div className="px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-black/70 text-white border border-white/10">
                          {s.status}
                        </div>
                        {/* §2026-05-25 fei Phase 3 — 首发/推荐 curation badges */}
                        {s.is_premiere && (
                          <div className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-white shadow-md">
                            ★ 首发
                          </div>
                        )}
                        {s.is_recommended && (
                          <div className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-white shadow-md">
                            ♥ 推荐
                          </div>
                        )}
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
                        {s.title}
                      </h3>
                    </Link>
                    {s.description && (
                      <p className="text-xs text-label-secondary line-clamp-2 mb-3">{s.description}</p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-label-tertiary">
                      <span>
                        {totalEp > 0 && epCount < totalEp
                          ? `${epCount}/${totalEp} ready`
                          : `${epCount} episode${epCount === 1 ? '' : 's'}`}
                      </span>
                      <span>Updated {new Date(s.updated_at).toLocaleDateString()}</span>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Link
                        to={`/series/${s.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-background hover:bg-background-tertiary rounded-lg text-xs font-medium text-label transition-colors border border-background-tertiary"
                      >
                        <Eye size={12} /> View
                      </Link>
                      <Link
                        to={`/create?series=${s.id}`}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-accent hover:bg-accent/90 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        <PencilSimple size={12} /> {s.status === 'published' ? 'Edit' : 'Continue'}
                      </Link>
                    </div>
                    {/* §2026-05-26 fei — Creator paywall settings (audit #3 fix).
                        Only show for published series — drafts aren't on sale
                        yet, no point setting price. Compact pill row under main
                        actions so the View/Edit primary affordances stay
                        prominent. Subtitle shows current free-count + price so
                        creator sees state at a glance without opening modal. */}
                    {s.status === 'published' && (
                      <button
                        type="button"
                        onClick={() => setPaywallEditing(s)}
                        className="mt-2 w-full flex items-center justify-between px-3 py-2 bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/20 rounded-lg text-xs text-label transition-colors group"
                        title="编辑本剧的免费集数 / 单集价 / 买断价 / 会员免费"
                      >
                        <span className="flex items-center gap-1.5">
                          <Coin size={12} weight="fill" className="text-amber-500" />
                          <span className="font-medium">定价</span>
                        </span>
                        <span className="text-label-tertiary group-hover:text-label">
                          前 {s.free_episodes_count ?? 1} 集免费 · {s.ucoins_per_episode ?? 40} Ucoin/集
                          {s.bundle_price_usd_cents != null && ` · 买断 $${(s.bundle_price_usd_cents / 100).toFixed(2)}`}
                          {s.member_free && ' · 会员免费'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* §2026-05-26 fei — PaywallSettingsModal. Mount at page root so backdrop
          covers the whole page and click-outside-to-close works. onSaved
          patches the matching series in items[] in place — no full refetch
          (avoids the loading spinner flash for a single-row update). */}
      {paywallEditing && (
        <PaywallSettingsModal
          series={paywallEditing}
          episodeCount={Array.isArray(paywallEditing.episodes)
            ? paywallEditing.episodes.filter(e => e?.status === 'ready').length
            : 0}
          onClose={() => setPaywallEditing(null)}
          onSaved={(updated) => {
            setItems(prev => prev.map(it => it.id === updated.id ? { ...it, ...updated } : it));
            setPaywallEditing(null);
          }}
        />
      )}
    </div>
  );
}

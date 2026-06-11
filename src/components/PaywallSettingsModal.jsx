/* §2026-05-26 fei — Creator-facing paywall settings modal.
 *
 * Why this exists: pre-2026-05-26 the only way to set free_episodes_count /
 * ucoins_per_episode / bundle_price_usd_cents / member_free was through the
 * admin `SeriesEditModal` (DramaAdminViews.jsx). Creators were locked out
 * of their own pricing and had to ask admin every time. This modal lifts
 * the same fields into the owner's MySeriesPage so they can self-serve.
 *
 * Owner-only: only fields the creator should control. Fields that affect
 * curation/ops (is_premiere, is_recommended, revenue_share_pct,
 * lifecycle_status, scheduled_publish_at) stay admin-only because they
 * affect the marketplace economy / Discover ranking and shouldn't be
 * self-set.
 *
 * Storage: writes directly via supabase JS client. RLS policy
 * series_owner_full (migrations/20260508_series.up.sql) allows authenticated
 * users to UPDATE rows where user_id = auth.uid(). No new worker endpoint
 * needed.
 */
import { useState, useMemo } from 'react';
import { X, CircleNotch, Coin, Info } from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';

export default function PaywallSettingsModal({ series, episodeCount = 0, onClose, onSaved }) {
  const [form, setForm] = useState({
    free_episodes_count: series.free_episodes_count ?? 1,
    ucoins_per_episode: series.ucoins_per_episode ?? 40,
    /* bundle price stored as USD cents in DB. Surface as "$X.XX" string for
     * editing — null/empty means "no bundle offered". */
    bundle_price_usd: series.bundle_price_usd_cents != null
      ? (series.bundle_price_usd_cents / 100).toString()
      : '',
    /* §2026-05-26 audit #6 fix — default false. Previously DB default TRUE
     * silently gave Starter+ tier members free access to ALL dramas, which
     * is the opposite of what a creator usually wants when they set up
     * per-episode pricing. New series should opt IN to member-free. */
    member_free: !!series.member_free,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  /* Live bundle-vs-singles math so creators see how "deep" their bundle
   * discount is in real time. e.g. 12 episodes × 8 Tokens = 96 Tokens
   * = $4.80 (§2026-06-09 货币合并:1 Token = 5¢,即 $1 = 20 Tokens). If they
   * price bundle at $3.99, that's ~17% off vs buying every episode singly. */
  const bundleHint = useMemo(() => {
    const epCount = episodeCount || 1;
    const perEp = Number(form.ucoins_per_episode) || 0;
    const totalUcoins = perEp * epCount;
    const totalUsdApprox = (totalUcoins / 20).toFixed(2);   // $1 = 20 Tokens(Token = 5¢)
    const bundlePrice = parseFloat(form.bundle_price_usd) || 0;
    if (bundlePrice <= 0) {
      return `单买全部 ${epCount} 集 ≈ ${totalUcoins} Tokens (~$${totalUsdApprox})`;
    }
    const discountPct = Math.round((1 - bundlePrice / Number(totalUsdApprox)) * 100);
    return `单买全部 ${epCount} 集 ≈ $${totalUsdApprox} · 买断省 ${discountPct > 0 ? discountPct + '%' : '0% (持平/更贵)'}`;
  }, [form.ucoins_per_episode, form.bundle_price_usd, episodeCount]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        free_episodes_count: Math.max(0, parseInt(form.free_episodes_count, 10) || 0),
        ucoins_per_episode: Math.max(0, parseInt(form.ucoins_per_episode, 10) || 0),
        bundle_price_usd_cents: form.bundle_price_usd.trim()
          ? Math.round(parseFloat(form.bundle_price_usd) * 100)
          : null,
        member_free: !!form.member_free,
      };

      // RLS: series_owner_full allows owner UPDATE. user_id check is enforced
      // by the policy WITH CHECK clause — we still scope explicitly with .eq
      // for defense in depth.
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');

      const { error: updErr } = await supabase
        .from('series')
        .update(patch)
        .eq('id', series.id)
        .eq('user_id', user.id);
      if (updErr) throw updErr;

      onSaved?.({ ...series, ...patch });
      onClose?.();
    } catch (err) {
      console.error('[PaywallSettingsModal] save failed:', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-background-tertiary rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-background-tertiary px-5 py-4 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-medium text-label flex items-center gap-2">
              <Coin size={18} weight="fill" className="text-amber-500" />
              定价设置
            </h3>
            <p className="text-xs text-label-tertiary mt-0.5 truncate">{series.title}</p>
          </div>
          <button onClick={onClose} className="text-label-tertiary hover:text-label p-1">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Free episodes count */}
          <div>
            <label className="block text-xs font-medium text-label-secondary mb-1.5">
              免费集数 <span className="text-label-tertiary">(前 N 集)</span>
            </label>
            <input
              type="number"
              min="0"
              max={Math.max(1, episodeCount)}
              value={form.free_episodes_count}
              onChange={e => update('free_episodes_count', e.target.value)}
              className="w-full bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-label text-sm focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-label-tertiary mt-1">
              前 {form.free_episodes_count || 0} 集所有用户免费观看,从第 {(parseInt(form.free_episodes_count, 10) || 0) + 1} 集起需付费/订阅
            </p>
          </div>

          {/* Per-episode price */}
          <div>
            <label className="block text-xs font-medium text-label-secondary mb-1.5">
              每集售价 <span className="text-label-tertiary">(Tokens)</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={form.ucoins_per_episode}
                onChange={e => update('ucoins_per_episode', e.target.value)}
                className="flex-1 bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-label text-sm focus:outline-none focus:border-accent"
              />
              <span className="text-xs text-label-tertiary">Tokens</span>
            </div>
          </div>

          {/* Bundle price */}
          <div>
            <label className="block text-xs font-medium text-label-secondary mb-1.5">
              整剧买断价 <span className="text-label-tertiary">(USD,留空 = 不提供买断)</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-label-tertiary text-sm">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="12.99"
                value={form.bundle_price_usd}
                onChange={e => update('bundle_price_usd', e.target.value)}
                className="flex-1 bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-label text-sm focus:outline-none focus:border-accent"
              />
            </div>
            <p className="text-[11px] text-label-tertiary mt-1 flex items-start gap-1">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span>{bundleHint}</span>
            </p>
          </div>

          {/* Member free toggle */}
          <div className="flex items-start justify-between gap-3 py-2 border-t border-background-tertiary">
            <div className="min-w-0">
              <p className="text-xs font-medium text-label">订阅会员免费观看</p>
              <p className="text-[11px] text-label-tertiary mt-0.5">
                开启后,Starter/Creator/Studio 订阅会员无需 Tokens 即可观看本剧所有集
              </p>
            </div>
            <button
              type="button"
              onClick={() => update('member_free', !form.member_free)}
              className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${
                form.member_free ? 'bg-accent' : 'bg-background-tertiary'
              }`}
              aria-pressed={form.member_free}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  form.member_free ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Heads-up: already-paid users not affected */}
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-400">
            提示:已经付费解锁过的用户不受改价影响,继续按之前的解锁记录观看。
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-background border-t border-background-tertiary px-5 py-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-label-secondary hover:text-label"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <><CircleNotch size={14} className="animate-spin" /> 保存中</> : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

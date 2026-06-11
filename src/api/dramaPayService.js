/**
 * §2026-05-25 fei — Phase 1 短剧付费 frontend API surface.
 *
 * Wraps the five worker endpoints introduced in commit 3296e81:
 *   GET  /api/wallet/balance              → fetchWalletBalance()
 *   POST /api/wallet/checkout             → createUcoinsCheckout({ packageId })
 *   POST /api/series/:id/checkout-bundle  → createBundleCheckout({ seriesId })
 *   POST /api/episodes/:id/unlock         → unlockEpisode({ episodeId })
 *   GET  /api/episodes/:id/access         → fetchEpisodeAccess({ episodeId })
 *
 * Also a helper to fetch the U-Coins package SKU list from system_settings
 * (kept server-side so prices can be hot-edited by admin without redeploy).
 *
 * Auth: every call attaches the current Supabase session JWT via the
 * Authorization header. authedHeaders() mirrors the pattern in
 * neoaiService.js.
 */

import { supabase } from './supabaseClient';

const authedHeaders = async (extra = {}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const h = { ...extra };
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`;
  return h;
};

const handleJson = async (resp, fallbackMsg) => {
  const ct = resp.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${fallbackMsg}: non-JSON response (${resp.status}) ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  if (!resp.ok || data?.success === false) {
    const err = new Error(data?.errMessage || fallbackMsg || `HTTP ${resp.status}`);
    // Preserve extra fields so callers can route on them
    //   (insufficient balance → paywall topup CTA, already_owned → 409 toast)
    Object.assign(err, data || {});
    err.status = resp.status;
    throw err;
  }
  return data;
};

/**
 * Fetch the calling user's U-Coins balance + recent transactions.
 * Returns { ucoins, lifetime_purchased, lifetime_spent, recent_tx[] }.
 * Returns zeros for users who never had a wallet row.
 */
export const fetchWalletBalance = async () => {
  const resp = await fetch('/api/wallet/balance', {
    method: 'GET',
    headers: await authedHeaders(),
  });
  return handleJson(resp, 'Failed to load wallet balance');
};

/**
 * Create a Stripe Checkout Session for a U-Coins package and return the
 * redirect URL. Caller is expected to window.location = session_url.
 *
 *   packageId: 'pkg_099_first' | 'pkg_199' | 'pkg_499' | 'pkg_999' |
 *              'pkg_1999' | 'pkg_4999'
 */
export const createUcoinsCheckout = async ({ packageId }) => {
  const resp = await fetch('/api/wallet/checkout', {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ package_id: packageId }),
  });
  return handleJson(resp, 'Failed to create checkout session');
};

/**
 * Create a Stripe Checkout Session for whole-series buyout.
 * Throws with .already_owned=true if user already bought.
 */
export const createBundleCheckout = async ({ seriesId }) => {
  const resp = await fetch(`/api/series/${seriesId}/checkout-bundle`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
  });
  return handleJson(resp, 'Failed to create bundle checkout');
};

/**
 * Spend U-Coins to unlock an episode. Atomic on server.
 *   Returns { unlock_id, balance_after, ucoins_paid } on success.
 * Throws with .insufficient=true + { required, current } when balance
 * too low — caller should route to the topup flow.
 */
export const unlockEpisode = async ({ episodeId }) => {
  const resp = await fetch(`/api/episodes/${episodeId}/unlock`, {
    method: 'POST',
    headers: await authedHeaders({ 'Content-Type': 'application/json' }),
  });
  return handleJson(resp, 'Failed to unlock episode');
};

/**
 * Check if the calling user can watch this episode.
 *   Returns { can_watch, reason, episode, locked? }
 *     reason ∈ 'free' | 'unlocked' | 'bundle' | 'member' | 'locked'
 * When can_watch=true, episode contains video_url + stream_uid.
 * When reason='locked', `locked` contains { price, balance }.
 */
export const fetchEpisodeAccess = async ({ episodeId }) => {
  const resp = await fetch(`/api/episodes/${episodeId}/access`, {
    method: 'GET',
    headers: await authedHeaders(),
  });
  return handleJson(resp, 'Failed to check episode access');
};

/**
 * Fetch the U-Coins package catalog from system_settings.
 *
 * This goes through Supabase directly (system_settings has public-read
 * RLS on the ucoins_packages key — non-secret, prices are public) so
 * we don't need a dedicated worker endpoint. Falls back to a hardcoded
 * matching the migration default if the call fails.
 */
// §2026-06-09 货币合并:Token 档(÷5,$1 = 20 Tokens)。与 system_settings.ucoins_packages
//   一致;字段名沿用 ucoins/bonus,值现为 Token。仅在后端取档失败时兜底。
const FALLBACK_PACKAGES = [
  { id: 'pkg_099_first', price_cents: 99,   ucoins: 40,   bonus: 20,   first_charge: true, label: '$0.99 首充翻倍' },
  { id: 'pkg_199',       price_cents: 199,  ucoins: 40,   bonus: 0,    label: '$1.99' },
  { id: 'pkg_499',       price_cents: 499,  ucoins: 104,  bonus: 4,    label: '$4.99' },
  { id: 'pkg_999',       price_cents: 999,  ucoins: 220,  bonus: 20,   label: '$9.99' },
  { id: 'pkg_1999',      price_cents: 1999, ucoins: 460,  bonus: 60,   label: '$19.99' },
  { id: 'pkg_4999',      price_cents: 4999, ucoins: 1200, bonus: 200,  label: '$49.99' },
];

export const fetchUcoinsPackages = async () => {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'ucoins_packages')
      .maybeSingle();
    if (error) throw error;
    if (data?.value) {
      const parsed = JSON.parse(data.value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn('[dramaPayService] fetchUcoinsPackages fallback:', err.message);
  }
  return FALLBACK_PACKAGES;
};

/**
 * List episodes of a series (independent of access — UI uses this to
 * render the episode grid, then per-episode fetchEpisodeAccess for the
 * lock badge / play decision).
 *
 * Public read via RLS for live series. Anyone (even anon) can call this.
 */
export const listSeriesEpisodes = async (seriesId) => {
  const { data, error } = await supabase
    .from('episodes')
    .select('id, episode_no, title, thumbnail_url, duration_sec, is_free_override, ucoins_price_override')
    .eq('series_id', seriesId)
    .eq('status', 'ready')
    .order('episode_no', { ascending: true });
  if (error) throw error;
  return data || [];
};

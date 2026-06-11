/**
 * Uvera Plans — Source of truth (frontend) for subscription tiers + token top-ups.
 *
 * Single source of truth doc: `docs/product/PLANS.md`. Any change here MUST be
 * synced with that doc (otherwise the doc is wrong, which compounds confusion).
 *
 * Architecture (2026-05-12):
 *   - 4 subscription tiers (FREE / STARTER / CREATOR / STUDIO) control feature gates
 *   - Token top-ups (LITE) are orthogonal SKUs that add tokens to balance without
 *     changing tier or feature access
 *   - Tier source: `auth.users.user_metadata.tier` (Supabase managed schema)
 *   - Token balance source: `auth.users.user_metadata.credits` (TODO rename → tokens,
 *     see docs/archive/asks/2026-05-12-credit-to-token-rename.md)
 *
 * Phase A (this file): frontend hardcode + client-side enforce. Server-side
 * enforcement (Phase B) is费's territory — RLS policy on characters INSERT etc.
 */

/* ── Tier feature gates ──────────────────────────────────────────────────────
 * §2026-05-22 fei: REMOVED charactersPerActor. The "AI-generated Character"
 *   concept (separate entity per generated storyboard image, derived from a
 *   root Actor/Avatar, with per-plan quota) is deleted from the product.
 *   Avatars now go directly to storyboard image — no intermediate Character
 *   record, no quota check. Storyboards live in recommended_content / works
 *   per gen run; the historical Characters table rows from the old flow are
 *   left in place but hidden from UI (no UI to display them now).
 *
 * Previous β config (kept here as commit-time memo for what was removed):
 *   free.charactersPerActor: 3,  starter: 5,  creator: 8,  studio: 12
 */
export const PLAN_LIMITS = {
  free: {
    actors: 1,
    resolution: '480p',
    watermark: true,
    series: false,
    flow: false,
  },
  starter: {
    actors: 2,
    resolution: '720p',
    watermark: false,
    series: false,
    flow: false,
  },
  creator: {
    actors: 3,
    resolution: '1080p',
    watermark: false,
    series: true,
    flow: false,
  },
  studio: {
    actors: 4,
    // §2026-05-15: 降级到 '1080p' — 4K 真实输出需要 HD 二次处理流水线
    // (上采样 + 后处理),目前没开发。Studio 用户依然拿到 Series + Flow
    // + 4 Actors 的差异化价值,但 dropdown 不会展示 4K 选项
    // 避免用户选了走 gen 路径反复失败。
    // 等 HD 流水线上线 → 改回 '4K',对应 SubscriptionPage features 同步更新。
    resolution: '1080p',
    watermark: false,
    series: true,
    flow: true,
  },
};

/* ── Token top-up SKUs — orthogonal to tiers ────────────────────────────────
 * LITE = $3.99 / 100 tokens, repeatable purchase (per费 v1.1.1 implementation).
 * Does NOT change tier or feature gate.                                       */
export const TOKEN_TOPUPS = {
  lite: {
    sku: 'LITE',
    priceUsdCents: 399,
    tokens: 100,
    oneTimePerUser: false,  // 当前 verbatim "buy it again whenever you need more"
                            // 若费后续改限购 1 次,翻 true 即可
  },
};

/* ── Short video token cost (per费 commit 9b0ac4c, 2026-05-11) ─────────────── */
export const VIDEO_TOKEN_COST = {
  '480p':  4,
  '720p':  6,
  '1080p': 12,
  // '4K':  TBD —— neodomain 支持后定
};

/* ── Storyboard image token cost (§2026-05-22 fei) ─────────────────────────────
 * Per-storyboard-image charge added to the render cost calculation. Each
 * render entry charges (storyboard + video); each "Not quite right —
 * regenerate" click charges another storyboard. Tuned to cover OpenAI's
 * gpt-image-2 pricing with margin:
 *   · OpenAI 'medium' quality: $0.042/image → 1.3 tokens at our $0.033/tk rate
 *   · OpenAI 'high' quality:   $0.167/image → 5.0 tokens at our $0.033/tk rate
 * Flat 3 tokens is between the two: covers medium with healthy margin,
 * undercharges high (we'd lose ~$0.07/image at high — admin task to bump if
 * we keep high quality long-term). Default product config is 'medium' since
 * fei 2026-05-22, so 3 is right.
 */
export const STORYBOARD_TOKEN_COST = 3;

/* ── Tier ordering & metadata ────────────────────────────────────────────── */
export const TIER_ORDER = ['free', 'starter', 'creator', 'studio'];

export const TIER_DISPLAY = {
  free:    { label: 'Free',    upgradeCta: 'Upgrade Plan' },
  starter: { label: 'Starter', upgradeCta: 'Go Creator'   },
  creator: { label: 'Creator', upgradeCta: 'Go Studio'    },
  studio:  { label: 'Studio',  upgradeCta: null           },
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Get the limits object for a given tier. Falls back to FREE if tier unknown.
 */
export function getTierLimits(tier) {
  return PLAN_LIMITS[tier] || PLAN_LIMITS.free;
}

/**
 * Resolve user's current tier from a profile-like object.
 * Profile shape: { tier?: string, credits?: number, ... } (from getUserProfile)
 * Returns 'free' if no tier set.
 */
export function getCurrentTier(profile) {
  const t = profile?.tier;
  if (t && TIER_ORDER.includes(t)) return t;
  return 'free';
}

/**
 * Get the next tier above the given one (for upgrade prompts). Returns null
 * if already at the highest tier.
 */
export function getNextTier(tier) {
  const idx = TIER_ORDER.indexOf(tier);
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

/**
 * Can the user create another Actor right now?
 * @param {string} tier — current tier ('free' | 'starter' | ...)
 * @param {number} currentActorCount — number of Actors the user has now
 * @returns {boolean}
 */
export function canCreateActor(tier, currentActorCount) {
  return currentActorCount < getTierLimits(tier).actors;
}

// §2026-05-22 fei: canCreateCharacter() deleted along with the
//   AI-generated-Character concept. Storyboards now generate per gen
//   run from the chosen Avatar; no per-Character quota to gate.

/** Tier-level feature gates */
export const canAccessSeries = (tier) => !!getTierLimits(tier).series;
export const canAccessFlow   = (tier) => !!getTierLimits(tier).flow;
export const hasWatermark    = (tier) => !!getTierLimits(tier).watermark;
export const getMaxResolution = (tier) => getTierLimits(tier).resolution;

/**
 * Returns the list of resolution options available to a tier.
 * Caller can use to populate a <select>.
 */
export function getResolutionOptions(tier) {
  const max = getMaxResolution(tier);
  const all = ['480p', '720p', '1080p', '4K'];
  const maxIdx = all.indexOf(max);
  return maxIdx < 0 ? all : all.slice(0, maxIdx + 1);
}

/**
 * Compute upgrade target for a locked feature. Returns the minimum tier that
 * unlocks the given feature, or null if no tier unlocks it.
 * @param {'actors' | 'characters' | 'series' | 'flow' | 'no-watermark' | '720p' | '1080p' | '4K'} feature
 * @returns {string | null} e.g. 'starter'
 */
export function tierUnlocking(feature) {
  for (const tier of TIER_ORDER) {
    const lim = PLAN_LIMITS[tier];
    if (feature === 'series'        && lim.series)               return tier;
    if (feature === 'flow'          && lim.flow)                 return tier;
    if (feature === 'no-watermark'  && !lim.watermark)           return tier;
    if (feature === '720p'          && parseInt(lim.resolution) >= 720)  return tier;
    if (feature === '1080p'         && parseInt(lim.resolution) >= 1080) return tier;
    if (feature === '4K'            && lim.resolution === '4K')  return tier;
  }
  return null;
}

/**
 * Estimate token cost for generating a Short video at given resolution.
 * Returns null if resolution unknown (e.g. '4K' until neodomain confirms).
 */
export function shortVideoCost(resolution) {
  return VIDEO_TOKEN_COST[resolution] ?? null;
}

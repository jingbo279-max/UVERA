/* ─── DB → frontend normalizer (UI layer only) ──────────────────────────────
 * 职责：把后端 fetchRecommendedContent() 返回的原始 DB 行规范化为前端消费形状。
 *
 * v2 canonical source：分类完全由 `media_kind` + `tags` 决定。
 *   - `media_kind` ∈ { 'Video', 'Image', 'Live' } —— 媒体种类，驱动渲染分支 / 图标
 *   - `tags[]`（例 `#MV` `#Trailer` `#Vlog` `#Short Drama`）—— 细分标签，驱动徽章显示
 *
 * 2026-04-23 — 移除 legacy `type` slug 派生（`clip` / `mv` / `story` / `film` /
 * `parallel` 6 值系统已下线，对应频道产品也早已取消）。consumer 改直接读
 * `item.mediaKind` + `item.tags[0]`。见 commit cba8ab0 + 本次重构。
 * ─────────────────────────────────────────────────────────────────────────── */

/* Tag-specific 默认 AR（MV / Trailer 走 16:9 更符合音乐/预告视频比例） */
const AR_BY_TAG = {
  '#MV':      '16/9',
  '#Trailer': '16/9',
};

const AR_BY_MEDIA_KIND = {
  Video: '9/16',
  Image: '3/4',
  Live:  '9/16',
};

/**
 * 计算新卡默认 AR（DB `aspect_ratio` 列覆盖此默认值）。
 */
export function defaultAspectRatio(mediaKind, firstTag) {
  return AR_BY_TAG[firstTag] ?? AR_BY_MEDIA_KIND[mediaKind] ?? '9/16';
}

const FALLBACK_COLORS = [
  'from-violet-900 to-indigo-900',
  'from-rose-900 to-pink-900',
  'from-amber-900 to-orange-900',
  'from-cyan-900 to-blue-900',
  'from-emerald-900 to-teal-900',
  'from-purple-900 to-fuchsia-900',
];

const CREATOR_ALIASES = {
  '533d5650-b15e-4333-857a-f0d337f3a631': 'feifeixp'
};

/**
 * 把单条 DB 行规范化为 MasonryGrid 消费形状。
 * 不再返回 `type` slug 或 `category` —— consumer 用 `mediaKind` + `tags[0]`。
 */
function normalizeRecommendedItem(dbItem, idx = 0) {
  const tags = Array.isArray(dbItem.tags) ? dbItem.tags : [];
  const mediaKind = dbItem.media_kind || 'Video';

  const rawArtist = dbItem.artist ? String(dbItem.artist) : '';
  let artistName = rawArtist;
  // Prefer profile.username (decorated by adminService.decorateWithProfiles)
  // over CREATOR_ALIASES legacy mapping or UUID truncation fallback.
  if (dbItem.artist_username) {
    artistName = dbItem.artist_username;
  } else if (CREATOR_ALIASES[artistName]) {
    artistName = CREATOR_ALIASES[artistName];
  } else if (artistName.length === 36 && artistName.includes('-')) {
    artistName = `user_${artistName.substring(0, 8)}`;
  }

  // artistId: only set when raw artist is a UUID. Used by Spark right pane
  // to navigate to /u/:userId (UserProfilePage by Session 3 scope-3-profile).
  const artistId =
    rawArtist.length === 36 && rawArtist.includes('-') ? rawArtist : null;

  return {
    id:          dbItem.id,
    title:       dbItem.title   || 'Untitled',
    artist:      artistName     || '',
    artistId,
    /* artistAvatarUrl: from profiles table via adminService decoration.
     * null when artist is legacy display-name string or profile has no
     * avatar set. UI must fallback gracefully (gradient + UserCircle). */
    artistAvatarUrl: dbItem.artist_avatar_url || null,
    cover:       dbItem.cover   || null,
    video:       dbItem.video   || null,
    audio:       dbItem.audio   || null,
    likesCount:  dbItem.likes_count ?? 0,
    savesCount:  dbItem.saves_count ?? 0,
    color:       FALLBACK_COLORS[idx % FALLBACK_COLORS.length],
    aspectRatio: dbItem.aspect_ratio || defaultAspectRatio(mediaKind, tags[0]),

    /* v2 classification (canonical) */
    mediaKind,
    tags,

    /* v2 additive fields */
    ctaLabel:    dbItem.cta_label   ?? null,
    ctaUrl:      dbItem.cta_url     ?? null,
    ctaTarget:   dbItem.cta_target  ?? '_self',
    pinned:      dbItem.pinned      === true,
    pinOrder:    dbItem.pin_order   ?? null,
    published:   dbItem.published   !== false,
    publishedAt: dbItem.published_at ?? null,

    /* Branch / Recast (2026-04-25 — see migrations/20260425_branch_recast_authorization.up.sql)
     * - allow*: author opt-in granted at publish time
     * - *OfId:  inverse pointer to source work (this row was branched/recast from it)
     * - branchCount/recastCount: aggregate count from inverse-FK lookup (backend
     *   provides via view/RPC; safe default 0 until exposed). */
    allowBranch: dbItem.allow_branch === true,
    allowRecast: dbItem.allow_recast === true,
    branchOfId:  dbItem.branch_of_id ?? null,
    recastOfId:  dbItem.recast_of_id ?? null,
    branchCount: dbItem.branch_count ?? 0,
    recastCount: dbItem.recast_count ?? 0,
  };
}

export function normalizeRecommendedList(list) {
  return (list ?? []).map(normalizeRecommendedItem);
}

export { normalizeRecommendedItem, FALLBACK_COLORS };

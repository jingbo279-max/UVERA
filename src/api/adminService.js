import { supabase } from './supabaseClient';

/* ─────────────────────────────────────────────────────────────────────────────
 * 视觉池：沿用既有的 5 色 fallback，映射到 `...item` 之前是 additive —
 * item 里真正有的字段（aspect_ratio, media_kind, tags 等）会被展开运算符
 * 最后覆盖，所以视觉池只对未填字段起兜底作用。
 * ────────────────────────────────────────────────────────────────────────── */
const VISUAL_POOL = [
  { color: 'from-orange-100 to-orange-300', badgeHex: '#FB923C', aspectRatio: '9/16' },
  { color: 'from-cyan-100 to-blue-200',     badgeHex: '#3B82F6', aspectRatio: '1/1' },
  { color: 'from-fuchsia-100 to-purple-300',badgeHex: '#C026D3', aspectRatio: '3/4' },
  { color: 'from-emerald-100 to-teal-200',  badgeHex: '#10B981', aspectRatio: '16/9' },
  { color: 'from-rose-100 to-pink-200',     badgeHex: '#F43F5E', aspectRatio: '9/16' },
];

function applyVisualPool(item, idx) {
  const visual = VISUAL_POOL[idx % VISUAL_POOL.length];
  return {
    ...item,                                 // DB row first (includes new v2 fields)
    aspectRatio: item.aspect_ratio || visual.aspectRatio,
    color:       visual.color,
    badgeHex:    visual.badgeHex,
    bgColor:     `bg-${visual.color.split('-')[1]}-100`,
    // category 不在此生成 — 前端 normalize 层（deriveCardMeta）提供 canonical 值
  };
}

/* ─── Public feed (homepage) ──────────────────────────────────────────────────
 *
 * v2 (2026-04-20): filter `published = true` + ordered by pinned/pin_order/
 * published_at/createdAt. Backward compatible: backfill migration set every
 * existing row to published=true, so no row drops out of the feed.
 * ────────────────────────────────────────────────────────────────────────── */
/* Lookup artist profiles in batch and decorate items with artist_avatar_url
 * + artist_username. Items whose `artist` is not a UUID-like string are
 * skipped (legacy rows with display-name strings). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const decorateWithProfiles = async (rows) => {
  const ids = [...new Set(rows.map(r => r.artist).filter(a => typeof a === 'string' && UUID_RE.test(a)))];
  if (ids.length === 0) return rows;
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', ids);
  if (error) {
    console.warn('Profiles lookup failed (right pane avatars will use fallback):', error.message);
    return rows;
  }
  const byId = Object.fromEntries(profiles.map(p => [p.id, p]));
  return rows.map(r => {
    const p = byId[r.artist];
    if (!p) return r;
    return { ...r, artist_avatar_url: p.avatar_url, artist_username: p.username };
  });
};

/**
 * Fetch the published feed for Discover. Returns either an array of
 * decorated items (success) OR an Error object (failure). Caller is
 * expected to type-check via `Array.isArray(result)`.
 *
 * Pre-2026-05-09 this returned `[]` on any failure, which made the
 * Discover page silently show a blank state — indistinguishable from
 * "no content exists" vs "your network blocked the query". Returning
 * the actual Error lets the UI render a "Couldn't load — Retry" panel
 * so users with flaky connectivity / wrong device clocks (which can
 * cause Supabase JWT validation 400s) have a way out without quitting.
 */
export const fetchRecommendedContent = async () => {
  // Try the full sorted query first. If Supabase returns 4xx/5xx (often
  // happens when a middlebox mangles the URL on cross-border networks,
  // or when a column we're sorting on doesn't exist), fall back to a
  // simpler query that still returns content even if ordering is wrong.
  try {
    const { data, error } = await supabase
      .from('recommended_content')
      .select('*')
      .eq('published', true)
      .order('pinned',       { ascending: false, nullsFirst: false })
      .order('pin_order',    { ascending: true,  nullsFirst: false })
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('createdAt',    { ascending: false });

    if (error) {
      // Surface code + details so admin can see in DevTools what really
      // failed (PostgREST returns code like 'PGRST204' / Postgres '42703'
      // etc). Then try the simpler fallback query before giving up.
      console.error('Fetch recommended_content error (full query):', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      // Fallback: drop the multi-column sort, just published+createdAt
      try {
        const fb = await supabase
          .from('recommended_content')
          .select('*')
          .eq('published', true)
          .order('createdAt', { ascending: false });
        if (!fb.error) {
          console.warn('Fetch recommended_content fallback succeeded');
          const dec = await decorateWithProfiles(fb.data);
          return dec.map(applyVisualPool);
        }
        console.error('Fetch recommended_content fallback also failed:', fb.error);
      } catch (fbErr) {
        console.error('Fetch recommended_content fallback threw:', fbErr);
      }
      const detail = error.code ? ` (${error.code})` : '';
      return new Error((error.message || 'Could not load content') + detail);
    }

    const decorated = await decorateWithProfiles(data);
    return decorated.map(applyVisualPool);
  } catch (err) {
    // Network-level failures (CORS, ITP, offline, blocked by extension)
    // bubble up as thrown TypeErrors from the SDK. Catch and convert to
    // a regular Error so the caller has uniform error handling.
    console.error('Fetch recommended_content threw:', err);
    return new Error(err?.message || 'Network error loading content');
  }
};

/* ─── Admin feed (dashboard) ──────────────────────────────────────────────────
 *
 * No `published` filter — admin sees drafts too. Ordered by createdAt DESC.
 * ────────────────────────────────────────────────────────────────────────── */
export const fetchRecommendedContentAdmin = async () => {
  const { data, error } = await supabase
    .from('recommended_content')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error) {
    console.error('Fetch recommended_content (admin) error:', error);
    return [];
  }

  return data.map(applyVisualPool);
};

/* ─── Add new card ────────────────────────────────────────────────────────────
 *
 * v2 (2026-04-20): 9 additional fields (CTA, pin, publish, classification).
 * All new fields are optional — pass `null`/defaults when not provided so
 * legacy callers keep working unchanged.
 *
 * Note: this returns the admin feed (all rows) because ConfigView — the only
 * caller — needs to see the just-created draft even if it's unpublished.
 * ────────────────────────────────────────────────────────────────────────── */
export const addRecommendedContent = async (newItem) => {
  /* ─── v2 classification ────────────────────────────────────────────────────
   * 分类完全由 media_kind + tags 驱动。legacy `type` 列已于 2026-04-23 由
   * migration 20260423_drop_legacy_type_column.up.sql 从 DB 移除。
   * ──────────────────────────────────────────────────────────────────────── */
  const tagsArr = Array.isArray(newItem.tags) ? newItem.tags : [];

  const payload = {
    title:  newItem.title,
    artist: newItem.artist,
    cover:  newItem.cover,
    video:  newItem.video || null,
    audio:  newItem.audio || null,
    aspect_ratio: newItem.aspect_ratio || null,

    // v2 additions — all optional
    cta_label:    newItem.cta_label    || null,
    cta_url:      newItem.cta_url      || null,
    cta_target:   newItem.cta_target   || null,
    pinned:       newItem.pinned       ?? false,
    pin_order:    newItem.pin_order ?? null,
    published:    newItem.published    ?? false,
    published_at: newItem.published_at || null,
    media_kind:   newItem.media_kind   || null,
    tags:         tagsArr,
  };

  const { data, error } = await supabase
    .from('recommended_content')
    .insert([payload])
    .select();

  if (error) {
    console.error('Add recommended_content error:', error);
    throw error;
  }
  return await fetchRecommendedContentAdmin();
};

export const updateRecommendedContentList = async (newList) => {
  // Now deprecated as we do single inserts/deletes over the network,
  // but kept to satisfy existing AdminDashboard bindings if required.
  return true;
};

export const updateRecommendedContent = async (id, updates) => {
  const { data, error } = await supabase
    .from('recommended_content')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) {
    console.error('Update recommended_content error:', error);
    throw error;
  }
  // Admin-facing update → return all rows (incl. drafts).
  return await fetchRecommendedContentAdmin();
};

export const deleteRecommendedContent = async (id) => {
  const { data, error } = await supabase
    .from('recommended_content')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Delete recommended_content error:', error);
    throw error;
  }
  // Admin-facing delete → return all rows (incl. drafts).
  return await fetchRecommendedContentAdmin();
};

export const fetchRegisteredUsers = async () => {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .order('createdAt', { ascending: false });

  if (error) {
    console.error('Fetch users error:', error);
    return [];
  }
  return data;
};

export const deleteRegisteredUser = async (id) => {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Delete user error:', error);
    throw error;
  }
  return await fetchRegisteredUsers();
};

export const fetchPaymentOrders = async () => {
  // Used by the AdminDashboard top KPIs (Total Revenue / MRR / Active
  // Subscribers). Excludes voided AND refunded orders so soft-deleted
  // and refunded rows don't inflate the dashboard. The detailed OrdersView
  // fetches via /api/admin/orders/list with its own filters (and can opt
  // into showing voided/refunded rows for audit).
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .is('voided_at', null)
    .is('refunded_at', null)
    .order('createdAt', { ascending: false });

  if (error) {
    console.error('Fetch orders error:', error);
    return [];
  }
  return data;
};

export const deletePaymentOrder = async (orderNo) => {
  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('orderNo', orderNo);

  if (error) {
    console.error('Delete order error:', error);
    throw error;
  }
  return await fetchPaymentOrders();
};

// Delete a user work completely
export const deleteUserWork = async (item) => {
  if (!item || !item.sourceTable) return;
  const { error } = await supabase
    .from(item.sourceTable)
    .delete()
    .eq('id', item.id);
  if (error) {
    console.error('Delete work error:', error);
    throw error;
  }
  return await fetchUserWorks();
};

// Return user generated characters and videos for the 'works' tab
export const fetchUserWorks = async () => {
  // 1. Fetch images (characters)
  const { data: charData, error: charError } = await supabase
    .from('characters')
    .select('*')
    .order('createdAt', { ascending: false });

  if (charError) console.error('Fetch characters error:', charError);

  const mappedChars = (charData || []).map(char => {
    let features;
    try {
      features = typeof char.identity_features === 'string'
        ? JSON.parse(char.identity_features)
        : (char.identity_features || {});
    } catch {
      features = {};
    }
    return {
      id: char.id,
      title: 'Identity: ' + (features.style || 'Custom Profile'),
      // §2026-06-10 — 保留原始 creator uuid 供 AdminUserChip(显示名/copy/跳主页)。
      userId: char.user_id || null,
      cover: char.photo_url,
      type: 'character',
      status: char.status,
      category: 'Image',
      sourceTable: 'characters',
      createdAt: char.createdAt
    };
  });

  // 2. Fetch videos (recommended_content where artist is a user ID)
  // We use a simple heuristic: if artist field looks like a UUID (length >= 32), it's user-generated.
  const { data: videoData, error: videoError } = await supabase
    .from('recommended_content')
    .select('*')
    .order('createdAt', { ascending: false });
    
  if (videoError) console.error('Fetch user videos error:', videoError);
  
  console.log('[fetchUserWorks] Raw recommended_content rows:', videoData?.length);

  const mappedVideos = (videoData || [])
    .filter(v => {
      // Supabase user IDs are typically 36 chars (UUID). Let's log if we reject something that looks like an ID
      const isUserGenerated = v.artist && v.artist.length >= 32;
      if (!isUserGenerated && v.artist !== 'Claude' && v.artist !== 'Neodomain') {
          console.log('[fetchUserWorks] Filtered out video due to artist length:', v.artist);
      }
      return isUserGenerated;
    })
    .map(v => ({
      id: v.id,
      title: v.title || 'Untitled Video',
      // §2026-06-10 — 原始 creator uuid(recommended_content.artist 即 user id)。
      userId: String(v.artist),
      cover: v.cover || `https://image.mux.com/${v.video}/thumbnail.jpg`,
      type: v.media_kind,  // legacy `type` column dropped 2026-04-23
      status: v.published ? 'published' : 'draft',
      published: !!v.published,  // §2026-06-10 — 显式 bool,供 admin 上架/下架 toggle
      category: 'Video',
      sourceTable: 'recommended_content',
      createdAt: v.createdAt,
      videoUrl: v.video
    }));

  const all = [...mappedChars, ...mappedVideos];

  // §2026-06-10 甲方需求 — 一次性批量解析所有创建者的 Display Name
  // (profiles.username),admin Works 表显示真实名字而非 "User: 21b2…"。
  // 无 profile 行的 fallback 到 id 前缀(在 AdminUserChip 内处理)。
  const ids = [...new Set(all.map(w => w.userId).filter(id => typeof id === 'string' && UUID_RE.test(id)))];
  let profById = {};
  if (ids.length) {
    const { data: profs, error: pErr } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', ids);
    if (pErr) console.warn('[fetchUserWorks] profiles lookup failed:', pErr.message);
    else profById = Object.fromEntries((profs || []).map(p => [p.id, p]));
  }

  const decorated = all.map(w => {
    const p = w.userId ? profById[w.userId] : null;
    const displayName = p?.username || null;
    return {
      ...w,
      displayName,
      creatorAvatarUrl: p?.avatar_url || null,
      // `artist` 保留供 grid 模式显示 + 搜索 hay 兼容:有名字用名字,否则 id 前缀。
      artist: displayName || (w.userId ? 'User: ' + w.userId.substring(0, 8) : 'Unknown User'),
    };
  });

  // Combined, sorted newest first
  return decorated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

export const getSystemConfig = async (key) => {
  const { data, error } = await supabase
    .from('system_configs')
    .select('value')
    .eq('key', key)
    .single();
  if (error && error.code !== 'PGRST116') {
    console.error(`Get config ${key} error:`, error);
    return null;
  }
  return data ? data.value : null;
};

export const setSystemConfig = async (key, value) => {
  const { error } = await supabase
    .from('system_configs')
    .upsert({ key, value, createdAt: new Date().toISOString() });
  if (error) {
    console.error(`Set config ${key} error:`, error);
    throw error;
  }
  return true;
};

/* ─── Admin authentication ────────────────────────────────────────────────────
 *
 * Admin access = real Supabase user + (email in VITE_ADMIN_EMAILS allowlist OR
 * user_metadata.is_admin === true). Both gates are checked client-side for UX,
 * but the only real protection is Supabase RLS — every admin-mutating table
 * (recommended_content / users / orders / characters) MUST have RLS policies
 * that require auth.role() = 'service_role' OR (auth.jwt() -> 'user_metadata' ->>
 * 'is_admin')::bool = true. Frontend gating without RLS is theatre.
 *
 * 2026-05-05: replaces hardcoded password '123456' / 'admin' + localStorage
 * mock token (CVE-class issue, anyone could `localStorage.setItem('admin_token','x')`).
 * ────────────────────────────────────────────────────────────────────────── */

const ADMIN_EMAILS = (import.meta.env.VITE_ADMIN_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

const isAdminUser = (user) => {
  if (!user) return false;
  if (user.user_metadata?.is_admin === true) return true;
  if (user.email && ADMIN_EMAILS.includes(user.email.toLowerCase())) return true;
  return false;
};

export const adminLogin = async (email, password) => {
  if (!email || !password) {
    return { success: false, errMessage: 'Email and password are required' };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    return { success: false, errMessage: error?.message || 'Login failed' };
  }
  if (!isAdminUser(data.user)) {
    await supabase.auth.signOut();
    return { success: false, errMessage: 'Account is not authorized for admin access' };
  }
  return { success: true };
};

export const logoutAdmin = async () => {
  await supabase.auth.signOut();
};

export const checkAdminAuth = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  return isAdminUser(user);
};

/**
 * Two-tier admin model:
 *   user_metadata.is_admin       → can access AdminDashboard
 *   user_metadata.is_super_admin → ALSO can access System Settings tab
 *
 * Super admin is a strict subset of admin — every super_admin should also
 * have is_admin=true (set by migrations/20260507_admin_roles.up.sql).
 * Returns false on any failure so non-super admins never accidentally
 * see the System Settings tab.
 */
export const checkSuperAdmin = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.user_metadata?.is_super_admin === true;
  } catch {
    return false;
  }
};

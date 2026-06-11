import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqaGRzb2RseGVrdmhwYWhhc2NzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1Mjg1NDAsImV4cCI6MjA5MjEwNDU0MH0.G6wSn2UzbRmEoz5a6fpos4cKGqJ-hFBsJ5zJcBLQ5Kc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ─── Global focus-refresh singleton (2026-05-13) ──────────────────────────
 * Admin grant token 后 client JWT 仍缓存旧 metadata,UI 显示陈旧。Window focus
 * 时 refreshSession 拉新 token → 触发 TOKEN_REFRESHED → 各组件 onAuthStateChange
 * listener 重新 fetch profile。
 *
 * 重要: 单 module-level listener (不是每组件一个),避免并发 refreshSession
 * 触发 navigator.locks AbortError ("Lock broken by another request with the
 * 'steal' option")。30s throttle 共享。
 * ────────────────────────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  let lastRefresh = 0;
  let inflight = null;
  const onFocus = async () => {
    const now = Date.now();
    if (now - lastRefresh < 30_000) return;
    if (inflight) return; // 已有正在进行的 refresh,跳过
    lastRefresh = now;
    inflight = supabase.auth.refreshSession()
      .catch(() => {})        // silent — 失败 (e.g. expired token) 由 auth flow 处理
      .finally(() => { inflight = null; });
    await inflight;
  };
  window.addEventListener('focus', onFocus);
  // Note: 不 removeEventListener,因为 module-level 想全 app 周期都活
}

/**
 * Ensures the user has a tier and credits initialized in user_metadata.
 * Returns { credits, tier }.
 *
 * 2026-05-08 Leon — getUser() (network call to /auth/v1/user) → getSession()
 * (从 localStorage 读 cached session，zero network). Session.user 已含完整
 * user_metadata，无需 server roundtrip。修复甲方冒烟测试反馈：直接刷新
 * /subscription 时 sidebar 4-8 秒内显示 'User / @guest / 0 Token' 占位
 * (paid user 看到这个会怀疑被骗)。
 */
export const getUserProfile = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { credits: 0, tier: 'free' };

  // tier 仍存 user_metadata(本轮不动 tier)。credits 不再从 meta 读 —— 它是
  // 用户可写的,旧实现让任何人都能伪造余额免费烧 GPU。权威余额改读 user_credits。
  let tier = user.user_metadata?.tier;
  if (tier === undefined) {
    tier = 'free';
    try { await supabase.auth.updateUser({ data: { tier } }); } catch (e) { /* non-fatal */ }
  }

  // §2026-05-29 — 权威余额:user_credits(RLS 只读自己)。无行 → 首登,
  //   ensure_user_credits 发欢迎金(SECURITY DEFINER,幂等,无法刷)。
  let balance = 0;
  const { data: rows } = await supabase.from('user_credits').select('balance').eq('user_id', user.id).limit(1);
  if (rows && rows.length > 0) {
    balance = rows[0].balance;
  } else {
    try {
      const { data: ens } = await supabase.rpc('ensure_user_credits', { p_welcome: 20 });
      balance = ens?.balance ?? 20;
    } catch (e) { balance = 0; }
  }

  return {
    credits: balance, tokens: balance, tier,
    lastShareDate: user.user_metadata?.lastShareDate,
    dailyShareCount: user.user_metadata?.dailyShareCount,
  };
};

/**
 * @deprecated §2026-05-29 — 余额改由服务端 RPC(spend_credits/grant_credits)
 * 权威管理,客户端不再写 user_metadata.credits(那是漏洞来源)。保留为只读
 * 返回当前余额以兼容残留调用方;调用方清理后删除。
 */
export const updateCredits = async () => {
  const { credits } = await getUserProfile();
  return credits;
};

/**
 * §2026-05-29 — tier 仍可客户端写(本轮不动 tier);credits 写入已移除。
 */
export const updateTierAndCredits = async (tier) => {
  await supabase.auth.updateUser({ data: { tier } });
  const { credits } = await getUserProfile();
  return { tier, credits };
};

/**
 * Claim today's daily credit allowance (universal, all tiers).
 * User-triggered; the Worker enforces "once per UTC day" + actually
 * persists the new balance via service_role admin API.
 * Returns { success, claimed, credits, last_claim_date, added?, errMessage? }.
 *
 * 2026-05-09 bug fix: Worker correctly persists user_metadata.credits
 * via the Supabase admin API, but the client-side JWT (cached in
 * localStorage) still encodes the OLD credits. After a successful
 * claim, on next page reload getUserProfile() → getSession() returned
 * the stale cached value, so the +6 looked like it never happened.
 *
 * Fix: refreshSession() forces a brand-new access token whose payload
 * encodes the up-to-date user_metadata. updateUser() in the same SDK
 * does this automatically, but Worker-side service_role mutations
 * bypass the client SDK entirely so we have to refresh manually.
 */
export const claimDailyCredits = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, errMessage: 'Not signed in' };
  try {
    const res = await fetch('/api/credits/claim-daily', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const body = await res.json();
    // Refresh local session so the new credits are visible on every
    // subsequent getUserProfile() / getSession() call. Skip if the
    // worker reported nothing changed (idempotent re-claim) — no point
    // burning a refresh round-trip.
    if (body?.success && body?.claimed) {
      try { await supabase.auth.refreshSession(); }
      catch (e) { console.warn('[claimDailyCredits] refreshSession failed:', e?.message); }
    }
    return body;
  } catch (err) {
    return { success: false, errMessage: err.message };
  }
};

/**
 * Handle share to get credits (+10, max 3 per day).
 *
 * §2026-05-29 — was a client-side supabase.auth.updateUser({data:{credits}})
 * write, which is user-writable → anyone could forge balance. Now POSTs to
 * the server-authoritative /api/credits/claim-share (grant_credits + per-day
 * rate limit on credit_tx). Server returns {success, newCredits, newCount} or
 * {success:false, reason:'daily_limit_reached'}.
 *
 * Refresh local session on success so the worker-mirrored user_metadata
 * (cold-path rollback copy) is visible to subsequent getSession() reads.
 */
export const handleShareCredits = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, errMessage: 'Not signed in' };
  try {
    const res = await fetch('/api/credits/claim-share', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const body = await res.json();
    if (body?.success) {
      try { await supabase.auth.refreshSession(); }
      catch (e) { console.warn('[handleShareCredits] refreshSession failed:', e?.message); }
    }
    return body;
  } catch (err) {
    return { success: false, errMessage: err.message };
  }
};

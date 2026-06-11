import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

/* §2026-05-29 Leon round-104 — admin tab URL persistence (whitelist 校验,
 * 防 URL 注入无效 tab 渲染空白)。 */
const VALID_ADMIN_TABS = new Set([
  'users', 'admins', 'orders', 'credits', 'beta', 'videos', 'reports',
  'logs', 'help', 'devlog', 'chat', 'config', 'works', 'system',
  'drama-revenue', 'drama-series', 'drama-settlements', 'drama-ledger', 'drama-acquisition',
]);
import { SignOut, Users, GearSix, Database, CreditCard, PlayCircle, Trash, Plus, X, UploadSimple, WarningCircle, CheckCircle, Star, DotsSixVertical, ArrowsClockwise, PaintBrush, Check, XCircle, Coins, VideoCamera, ChartBar, DownloadSimple, Flag, ArrowSquareOut, MagnifyingGlass, ArrowCounterClockwise, Prohibit, Receipt, Question, PencilSimple, Eye, EyeSlash, ShieldCheck, FileText, Tag, ChatCircleDots, Robot, PaperPlaneTilt, Terminal, CircleNotch, Copy, SquaresFour, Rows } from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import VideoPlayer from '../../design-system/composites/VideoPlayer';
import {
  checkAdminAuth, checkSuperAdmin, logoutAdmin,
  fetchRegisteredUsers, fetchPaymentOrders,
  fetchUserWorks, fetchRecommendedContentAdmin,
  updateRecommendedContentList, deleteRegisteredUser,
  updateRecommendedContent, deleteRecommendedContent,
  deleteUserWork,
  deletePaymentOrder, addRecommendedContent
} from '../../api/adminService';
import { togglePublishedStatus } from '../../api/worksService';
import AdminUserChip from './AdminUserChip';
import { VIDEO_TAGS as TAG_OPTIONS } from '../../data/videoTags';
// §2026-05-25 fei — Phase 1 / 2 短剧付费 admin views (separate file to keep
//   AdminDashboard.jsx from growing past 8k lines).
import { DramaRevenueView, DramaSeriesView, SettlementsView, PaymentLedgerView, AcquisitionCostsView } from './DramaAdminViews';
import { Coin as DramaCoin, FilmReel, Receipt as ReceiptIcon, Wallet as WalletIcon, Megaphone } from '@phosphor-icons/react';

// Reusable components
const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex items-center justify-between">
    <div>
      <p className="text-zinc-400 text-sm mb-1">{title}</p>
      <h3 className="text-2xl font-bold text-white">{value}</h3>
    </div>
    <div className={`p-3 rounded-lg bg-${color}-500/10 text-${color}-400`}>
      <Icon size={24} />
    </div>
  </div>
);

// Tab Views

/**
 * Beta-access requests management. Lists all `beta_requests` rows with
 * approve / decline actions. RLS enforces admin-only access from
 * Supabase side, so a regular user navigating to /admin/dashboard
 * can't read this even if they bypass the UI gate.
 */
import { supabase } from '../../api/supabaseClient';

/**
 * Reusable client-side pagination footer for admin tables.
 *
 * Why client-side: most admin tables fetch all (or first 200) rows in one
 * shot and need only "the user wants to skim, not scroll forever" pagination,
 * not "we have 50k rows" pagination. Server-side pagination (Range header)
 * is reserved for the truly large lists — OrdersView already does it.
 *
 * Usage pattern in each view:
 *   const [page, setPage] = React.useState(1);
 *   const perPage = 50;
 *   React.useEffect(() => { setPage(1); }, [filterDeps...]);  // reset on filter change
 *   const pageItems = items.slice((page - 1) * perPage, page * perPage);
 *   // ...render pageItems instead of items
 *   <AdminPagination
 *     page={page} perPage={perPage} total={items.length}
 *     onChange={setPage}
 *   />
 *
 * Matches the OrdersView pagination footer styling so the whole admin
 * looks coherent.
 */
const AdminPagination = ({ page, perPage, total, onChange, label = 'items' }) => {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) {
    // Single page — still show a quiet count so admin knows total.
    return total > 0 ? (
      <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
        {total} {label}
      </div>
    ) : null;
  }
  const from = (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  return (
    <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-[11px] text-zinc-500 gap-3 flex-wrap">
      <div>
        Showing <span className="text-zinc-300">{from}–{to}</span> of <span className="text-zinc-300">{total}</span> {label}
        <span className="ml-3 text-zinc-600">· Page {page} of {totalPages}</span>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onChange(1)}
          disabled={page === 1}
          className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          title="First page"
        >
          ‹‹
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ‹ Prev
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next ›
        </button>
        <button
          type="button"
          onClick={() => onChange(totalPages)}
          disabled={page === totalPages}
          className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          title="Last page"
        >
          ››
        </button>
      </div>
    </div>
  );
};

/* React hook that wraps a list with client-side pagination state.
   Reset to page 1 whenever the input items array reference changes
   (which happens on filter changes since callers usually `useMemo`
   the filtered list). */
const useAdminPagination = (items, perPage = 50) => {
  const [page, setPage] = React.useState(1);
  // Auto-reset to page 1 when underlying items count drops below current page's start
  React.useEffect(() => {
    const maxPage = Math.max(1, Math.ceil((items?.length || 0) / perPage));
    if (page > maxPage) setPage(1);
  }, [items, perPage, page]);
  const pageItems = React.useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.slice((page - 1) * perPage, page * perPage);
  }, [items, page, perPage]);
  return { page, setPage, pageItems, perPage, total: items?.length || 0 };
};

/**
 * Manual credit-grant tool. Used when a Stripe payment succeeded but
 * the webhook didn't reach our worker (e.g. live-mode webhook misconfigured),
 * or for one-off promo credits. Every grant is audit-logged in
 * credit_grants — admins (and the recipient user) can see the trail.
 */
const CreditGrantsView = () => {
  const [grants, setGrants] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState(null);
  const [form, setForm] = React.useState({
    userEmail: '',
    credits: '',
    tier: '',
    reason: '',
    stripeInvoiceId: '',
  });

  // Reconciliation state — orders that don't have a matching credit_grants row.
  const [unreconciled, setUnreconciled] = React.useState([]);
  const [reconLoading, setReconLoading] = React.useState(true);
  const [fixingId, setFixingId] = React.useState(null);

  // §2026-05-15 client-side pagination (50/page, OrdersView already does server-side)
  const grantsPagination = useAdminPagination(grants, 50);
  const unreconciledPagination = useAdminPagination(unreconciled, 50);

  const loadGrants = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from('credit_grants')
        .select('*')
        .order('granted_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setGrants(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Find orders that don't have a credit_grants row keyed by stripe_invoice_id.
  // These are payments where the webhook delivered the credit successfully OR
  // failed silently — we can't tell which without checking individual events.
  // The "Auto-fix" button assumes the latter and grants the matching credits.
  const loadReconciliation = async () => {
    setReconLoading(true);
    try {
      const [ordersRes, grantsRes] = await Promise.all([
        supabase
          .from('orders')
          .select('"orderNo", "userId", amount, "createdAt", subject')
          .order('"createdAt"', { ascending: false })
          .limit(200),
        supabase
          .from('credit_grants')
          .select('stripe_invoice_id')
          .not('stripe_invoice_id', 'is', null),
      ]);
      const orders = ordersRes.data || [];
      const grantedInvoices = new Set((grantsRes.data || []).map(g => g.stripe_invoice_id));
      setUnreconciled(orders.filter(o => !grantedInvoices.has(o.orderNo)));
    } catch (e) {
      console.warn('reconciliation load failed:', e.message);
    } finally {
      setReconLoading(false);
    }
  };

  React.useEffect(() => { loadGrants(); loadReconciliation(); }, []);

  // Map order subject like "UVERA starter (monthly)" → tier + credits.
  const TIER_CREDITS = { starter: 500, creator: 1500, studio: 5000 };
  const inferTier = (subject) => {
    if (!subject) return null;
    if (/starter/i.test(subject)) return 'starter';
    if (/creator/i.test(subject)) return 'creator';
    if (/studio/i.test(subject))  return 'studio';
    return null;
  };

  const handleAutoFix = async (order) => {
    const tier = inferTier(order.subject);
    if (!tier) {
      alert(`Cannot auto-resolve tier from subject "${order.subject}". Use the form above to grant manually.`);
      return;
    }
    const credits = TIER_CREDITS[tier];
    if (!confirm(`Grant ${credits} credits + set tier=${tier} for invoice ${order.orderNo}?`)) return;

    setFixingId(order.orderNo);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin/grant-credits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: order.userId,
          credits,
          tier,
          reason: `Reconciliation auto-fix for ${order.subject} (Stripe invoice ${order.orderNo})`,
          stripeInvoiceId: order.orderNo,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errMessage);
      setMessage({
        type: 'success',
        text: `✅ Fixed ${order.orderNo}: granted ${credits} credits to ${data.userEmail}.`,
      });
      loadGrants();
      loadReconciliation();
    } catch (err) {
      setMessage({ type: 'error', text: '❌ ' + err.message });
    } finally {
      setFixingId(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const res = await fetch('/api/admin/grant-credits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userEmail: form.userEmail.trim(),
          credits: Number(form.credits),
          tier: form.tier || undefined,
          reason: form.reason.trim() || undefined,
          stripeInvoiceId: form.stripeInvoiceId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errMessage || 'Grant failed');

      setMessage({
        type: 'success',
        text: `✅ Granted ${form.credits} credits to ${data.userEmail}. New balance: ${data.newCredits}.${data.newTier ? ' Tier set to ' + data.newTier + '.' : ''}`,
      });
      setForm({ userEmail: '', credits: '', tier: '', reason: '', stripeInvoiceId: '' });
      loadGrants();
      loadReconciliation();
    } catch (err) {
      setMessage({ type: 'error', text: '❌ ' + err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-medium text-white">Grant credits</h3>
          <p className="text-sm text-zinc-400 mt-1">
            Adds credits to a user's balance and (optionally) sets their tier. Every grant is logged below for reconciliation against Stripe.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">User email</label>
              <input
                type="email"
                value={form.userEmail}
                onChange={e => setForm(f => ({ ...f, userEmail: e.target.value }))}
                required
                placeholder="user@example.com"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Credits to add</label>
              <input
                type="number"
                min="1"
                value={form.credits}
                onChange={e => setForm(f => ({ ...f, credits: e.target.value }))}
                required
                placeholder="500"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Tier <span className="text-zinc-600">(optional)</span></label>
              <select
                value={form.tier}
                onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              >
                <option value="">— Don't change tier —</option>
                <option value="free">free</option>
                <option value="starter">starter</option>
                <option value="creator">creator</option>
                <option value="studio">studio</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Stripe invoice ID <span className="text-zinc-600">(optional, for reconciliation)</span></label>
              <input
                type="text"
                value={form.stripeInvoiceId}
                onChange={e => setForm(f => ({ ...f, stripeInvoiceId: e.target.value }))}
                placeholder="in_1Pxxxx..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 font-mono"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Reason</label>
              <textarea
                value={form.reason}
                onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                rows={2}
                placeholder="Compensating Starter Monthly $25 — webhook missed (Stripe live mode webhook not configured at the time)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500 resize-none"
              />
            </div>
          </div>

          {message && (
            <div className={`p-3 rounded-lg text-sm border ${
              message.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}>
              {message.text}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting || !form.userEmail || !form.credits}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {submitting ? 'Granting…' : 'Grant credits'}
            </button>
          </div>
        </form>
      </div>

      {/* Reconciliation — orders without matching credit_grants */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-white flex items-center gap-2">
              Reconciliation
              {!reconLoading && unreconciled.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
                  {unreconciled.length} missing
                </span>
              )}
              {!reconLoading && unreconciled.length === 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  All clear
                </span>
              )}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Stripe payments without a corresponding credit grant. Click <span className="text-white">Auto-fix</span> to issue the matching credits + tier in one step.
            </p>
          </div>
          <button
            onClick={loadReconciliation}
            className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Refresh reconciliation"
          >
            <ArrowsClockwise size={16} />
          </button>
        </div>

        {reconLoading && <div className="text-zinc-400 p-6 text-sm">Checking…</div>}

        {!reconLoading && unreconciled.length === 0 && (
          <div className="text-zinc-500 p-6 text-sm text-center">
            ✓ Every payment has a matching credit grant. Nothing to reconcile.
          </div>
        )}

        {!reconLoading && unreconciled.length > 0 && (
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">Stripe invoice</th>
                <th className="px-4 py-3 font-medium">Subject</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Paid</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {unreconciledPagination.pageItems.map(o => {
                const tier = inferTier(o.subject);
                const credits = tier ? TIER_CREDITS[tier] : null;
                const fixing = fixingId === o.orderNo;
                return (
                  <tr key={o.orderNo} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-3 font-mono text-xs text-zinc-400">{o.orderNo}</td>
                    <td className="px-4 py-3 text-xs">{o.subject || <span className="text-zinc-600">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-500">{o.userId?.substring(0, 12)}…</td>
                    <td className="px-4 py-3 text-emerald-300">${Number(o.amount || 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-xs">{o.createdAt ? new Date(o.createdAt).toLocaleString() : '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {tier ? (
                        <button
                          onClick={() => handleAutoFix(o)}
                          disabled={fixing}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
                          title={`Grant ${credits} credits + set tier=${tier}`}
                        >
                          {fixing ? 'Fixing…' : `Auto-fix (+${credits})`}
                        </button>
                      ) : (
                        <span className="text-xs text-zinc-600">Manual (subject not parsable)</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <AdminPagination
          page={unreconciledPagination.page}
          perPage={unreconciledPagination.perPage}
          total={unreconciledPagination.total}
          onChange={unreconciledPagination.setPage}
          label="unreconciled orders"
        />
      </div>

      {/* Audit log */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-white">Recent grants</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Audit log — {grants.length} entries shown</p>
          </div>
          <button
            onClick={loadGrants}
            className="text-zinc-400 hover:text-white p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Refresh"
          >
            <ArrowsClockwise size={16} />
          </button>
        </div>

        {loading && <div className="text-zinc-400 p-6 text-sm">Loading…</div>}
        {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
        {!loading && !error && grants.length === 0 && (
          <div className="text-zinc-500 p-6 text-sm text-center">
            No grants yet. Use the form above to issue your first.
          </div>
        )}

        {grants.length > 0 && (
          <table className="w-full text-left text-sm text-zinc-300">
            <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium text-right">+Credits</th>
                <th className="px-4 py-3 font-medium">Tier</th>
                <th className="px-4 py-3 font-medium">Stripe invoice</th>
                <th className="px-4 py-3 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {grantsPagination.pageItems.map(g => (
                <tr key={g.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-3 text-zinc-400 whitespace-nowrap text-xs">{new Date(g.granted_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-400">{g.user_id?.substring(0, 8)}…</td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-300">+{g.amount}</td>
                  <td className="px-4 py-3 text-xs">{g.tier || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3 font-mono text-xs text-zinc-500">{g.stripe_invoice_id || <span className="text-zinc-600">—</span>}</td>
                  <td className="px-4 py-3 text-xs text-zinc-400 max-w-[280px] truncate" title={g.reason || ''}>{g.reason || <span className="text-zinc-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <AdminPagination
          page={grantsPagination.page}
          perPage={grantsPagination.perPage}
          total={grantsPagination.total}
          onChange={grantsPagination.setPage}
          label="grants"
        />
      </div>
    </div>
  );
};

const BetaRequestsView = () => {
  const [requests, setRequests] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const pagination = useAdminPagination(requests, 50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch requests + the requesting user's email/contact for display.
      // We can't easily join to auth.users from anon client, so the row
      // shape is just (id, user_id, feature, status, created_at, notes).
      // For now show user_id; a future migration can add a denormalized
      // user_email column or use a Supabase database view.
      const { data, error } = await supabase
        .from('beta_requests')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRequests(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const updateStatus = async (id, status) => {
    try {
      const { error } = await supabase
        .from('beta_requests')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      setRequests(prev => prev.map(r => (r.id === id ? { ...r, status } : r)));
    } catch (e) {
      alert('Could not update status: ' + e.message);
    }
  };

  if (loading) return <div className="text-zinc-400 p-6">Loading…</div>;
  if (error) return <div className="text-red-400 p-6">Failed: {error}</div>;
  if (requests.length === 0) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
        <PaintBrush size={32} className="mx-auto text-zinc-600 mb-3" />
        <p className="text-zinc-400 text-sm">No beta requests yet.</p>
        <p className="text-zinc-500 text-xs mt-1">Users can request access from the Create page → Creative Canvas card.</p>
      </div>
    );
  }

  const statusColor = {
    pending:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
    approved: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    declined: 'bg-red-500/15 text-red-300 border-red-500/30',
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <table className="w-full text-left text-sm text-zinc-300">
        <thead className="bg-zinc-950 text-zinc-500 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-6 py-4 font-medium">User ID</th>
            <th className="px-6 py-4 font-medium">Feature</th>
            <th className="px-6 py-4 font-medium">Requested</th>
            <th className="px-6 py-4 font-medium">Status</th>
            <th className="px-6 py-4 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {pagination.pageItems.map(r => (
            <tr key={r.id} className="hover:bg-zinc-800/50">
              <td className="px-6 py-4 font-mono text-xs text-zinc-400">{r.user_id?.substring(0, 12)}…</td>
              <td className="px-6 py-4 text-white">{r.feature}</td>
              <td className="px-6 py-4 text-zinc-400">{new Date(r.created_at).toLocaleDateString()}</td>
              <td className="px-6 py-4">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${statusColor[r.status] || 'bg-zinc-700/40 text-zinc-300 border-zinc-700'}`}>
                  {r.status}
                </span>
              </td>
              <td className="px-6 py-4 text-right">
                {r.status === 'pending' && (
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => updateStatus(r.id, 'approved')}
                      className="px-2 py-1 text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 rounded transition-colors flex items-center gap-1"
                      title="Approve"
                    >
                      <Check size={12} weight="bold" /> Approve
                    </button>
                    <button
                      onClick={() => updateStatus(r.id, 'declined')}
                      className="px-2 py-1 text-xs bg-red-500/20 text-red-300 hover:bg-red-500/30 rounded transition-colors flex items-center gap-1"
                      title="Decline"
                    >
                      <XCircle size={12} weight="bold" /> Decline
                    </button>
                  </div>
                )}
                {r.status !== 'pending' && (
                  <button
                    onClick={() => updateStatus(r.id, 'pending')}
                    className="px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Reset to pending"
                  >
                    Reset
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AdminPagination
        page={pagination.page}
        perPage={pagination.perPage}
        total={pagination.total}
        onChange={pagination.setPage}
        label="beta requests"
      />
    </div>
  );
};

/**
 * Review queue for user-uploaded videos. Each row in user_video_uploads
 * with status='pending_review' shows up here. Admin can:
 *   - Preview the video via embedded Cloudflare Stream player
 *   - Approve  → status='approved' + insert into recommended_content
 *               (so the video is published on Discover per 2026-05-07 product call)
 *   - Reject   → status='rejected' with required reason (returned to user)
 *
 * Backend: /api/admin/user-videos/list, /api/admin/user-videos/review
 * Schema: migrations/20260507_user_video_uploads.up.sql
 */
const UserVideosReviewView = () => {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [filter, setFilter] = React.useState('pending_review'); // pending_review | approved | rejected | all
  const [reviewingId, setReviewingId] = React.useState(null);
  const pagination = useAdminPagination(items, 50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch(`/api/admin/user-videos/list?status=${filter}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  const review = async (id, action) => {
    let rejectionReason = null;
    if (action === 'reject') {
      rejectionReason = window.prompt('Reason for rejection (visible to the user):');
      if (!rejectionReason || rejectionReason.trim().length < 5) {
        if (rejectionReason !== null) alert('Reason must be at least 5 characters.');
        return;
      }
    } else if (!window.confirm('Approve this video and publish it to Discover?')) {
      return;
    }

    setReviewingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/user-videos/review', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ recordId: id, action, rejectionReason })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      // Optimistic local update — also reload to reflect any backend-side edits
      setItems(prev => prev.filter(i => i.id !== id));
      // small delay to let DB settle, then reload counts
      setTimeout(() => load(), 250);
    } catch (e) {
      alert(`Review failed: ${e.message}`);
    } finally {
      setReviewingId(null);
    }
  };

  const FILTERS = [
    { id: 'pending_review', label: 'Pending' },
    { id: 'approved',       label: 'Approved' },
    { id: 'rejected',       label: 'Rejected' },
    { id: 'all',            label: 'All' },
  ];

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <VideoCamera size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No videos in this queue.</p>
        </div>
      )}

      {/* Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {pagination.pageItems.map(item => {
          const sizeMB = item.file_size_bytes ? (item.file_size_bytes / 1024 / 1024).toFixed(1) : '?';
          const isPending = item.status === 'pending_review';
          const isReviewing = reviewingId === item.id;
          return (
            <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              {/* Stream player */}
              {item.stream_uid ? (
                <div className="aspect-video bg-black">
                  <iframe
                    src={`https://iframe.cloudflarestream.com/${item.stream_uid}?preload=metadata`}
                    className="w-full h-full border-0"
                    allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                    allowFullScreen
                  />
                </div>
              ) : (
                <div className="aspect-video bg-black flex items-center justify-center text-zinc-600 text-xs">
                  (Stream UID not yet assigned)
                </div>
              )}

              <div className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-medium text-white text-sm leading-snug">{item.title}</h4>
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border shrink-0 ${
                    item.status === 'pending_review' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                    item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                    item.status === 'rejected' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                    'bg-zinc-700 text-zinc-300 border-zinc-600'
                  }`}>
                    {item.status.replace('_', ' ')}
                  </span>
                </div>

                {item.description && (
                  <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">{item.description}</p>
                )}

                <div className="text-[11px] text-zinc-500 space-y-0.5 pt-2 border-t border-zinc-800">
                  <div><span className="text-zinc-600">Submitter:</span> {item.user_email || item.user_id}</div>
                  <div><span className="text-zinc-600">Size:</span> {sizeMB} MB · <span className="text-zinc-600">Filename:</span> {item.original_filename || '—'}</div>
                  <div><span className="text-zinc-600">Submitted:</span> {new Date(item.created_at).toLocaleString()}</div>
                  <div><span className="text-zinc-600">Copyright ack:</span> {new Date(item.copyright_acknowledged_at).toLocaleString()} <span className="text-zinc-600">({item.copyright_text_version})</span></div>
                  {item.submitter_ip && <div><span className="text-zinc-600">IP:</span> {item.submitter_ip}</div>}
                  {item.rejection_reason && (
                    <div className="text-red-400 mt-1"><span className="text-zinc-600">Rejection:</span> {item.rejection_reason}</div>
                  )}
                </div>

                {isPending && (
                  <div className="flex gap-2 pt-3">
                    <button
                      onClick={() => review(item.id, 'approve')}
                      disabled={isReviewing}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <Check size={14} weight="bold" /> Approve & Publish
                    </button>
                    <button
                      onClick={() => review(item.id, 'reject')}
                      disabled={isReviewing}
                      className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <XCircle size={14} weight="bold" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <AdminPagination
        page={pagination.page}
        perPage={pagination.perPage}
        total={pagination.total}
        onChange={pagination.setPage}
        label="user videos"
      />
    </div>
  );
};

/**
 * Detailed generation log viewer + CSV export.
 *
 * Each row corresponds to one /api/volcengine/video/submit call. The Worker
 * inserts the row at submit time (status='started') and updates it when the
 * task transitions to terminal status (succeeded/failed). See
 * migrations/20260508_generation_logs.up.sql for the full schema.
 *
 * UI features:
 *   - Filters: status, generation_type, date range, user email substring
 *   - Summary at top: total cost USD, total credits, success rate
 *   - Sortable table (default: started_at DESC)
 *   - "Export CSV" → builds CSV client-side from the loaded rows
 *
 * Data flow: direct Supabase query (RLS limits to admin), no Worker proxy
 * needed. Default page size 200; admin can bump via "Load more" if needed.
 */
const GenerationLogsView = () => {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [typeFilter, setTypeFilter] = React.useState('all');
  const [emailFilter, setEmailFilter] = React.useState('');
  const [daysFilter, setDaysFilter] = React.useState(30);
  const [pageSize, setPageSize] = React.useState(200);  // server fetch cap
  const [detail, setDetail] = React.useState(null);
  // §2026-05-15 client-side pagination at 50/page — server fetch can still
  // pull up to 200/500/1000 via the "Load more" dropdown; client paginates
  // whatever's loaded.
  const pagination = useAdminPagination(items, 50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('generation_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(pageSize);

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (typeFilter !== 'all') query = query.eq('generation_type', typeFilter);
      if (daysFilter > 0) {
        const since = new Date(Date.now() - daysFilter * 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('started_at', since);
      }
      if (emailFilter.trim()) {
        // Case-insensitive substring match on denormalized user_email column
        query = query.ilike('user_email', `%${emailFilter.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter, typeFilter, daysFilter, pageSize]);

  // ── CSV export ──────────────────────────────────────────────────────────
  // Builds CSV from currently-loaded items. Uses RFC 4180 quoting:
  // double-quote-wrap any field containing comma/quote/newline; escape
  // internal double-quotes by doubling them. UTF-8 BOM prefix so Excel on
  // Windows opens Chinese characters correctly without manual import.
  const exportCsv = () => {
    const columns = [
      { key: 'started_at',           label: 'Started At' },
      { key: 'finished_at',          label: 'Finished At' },
      { key: 'duration_ms',          label: 'Duration (ms)' },
      { key: 'status',               label: 'Status' },
      { key: 'http_status',          label: 'HTTP Status' },
      { key: 'user_email',           label: 'User Email' },
      { key: 'generation_type',      label: 'Type' },
      { key: 'endpoint',             label: 'Endpoint' },
      { key: 'vendor',               label: 'Vendor' },
      { key: 'model',                label: 'Model' },
      { key: 'task_id',              label: 'Task ID' },
      { key: 'resolution',           label: 'Resolution' },
      { key: 'duration_seconds',     label: 'Duration (s)' },
      { key: 'ratio',                label: 'Ratio' },
      { key: 'reference_image_count',label: 'Ref Images' },
      { key: 'has_video_reference',  label: 'Has Video Ref' },
      { key: 'credits_charged',      label: 'Tokens Charged' },
      // §2026-06-06 fei — 失败退款标记(退款本体在 credit_tx,这里是 generation_logs 行上的镜像)
      { key: 'refunded',             label: 'Refunded' },
      { key: 'refunded_credits',     label: 'Refunded Credits' },
      { key: 'cost_usd',             label: 'Cost USD' },
      // §2026-05-31 fei — cost_basis + BytePlus actuals so CSV can
      //   distinguish estimated vs reconciled rows for invoice matching.
      { key: 'cost_basis',                     label: 'Cost Basis' },
      { key: 'actual_completion_tokens',       label: 'Actual Tokens' },
      { key: 'actual_video_duration_seconds',  label: 'Actual Duration (s)' },
      // §2026-05-30 fei Bug 4 — admin can sort/filter CSV by session_id
      //   to compute total cost per render in Excel.
      { key: 'render_session_id',    label: 'Render Session' },
      // §2026-05-26 fei — per-call token usage (NULL for non-LLM rows)
      { key: 'input_tokens',         label: 'Input Tokens' },
      { key: 'output_tokens',        label: 'Output Tokens' },
      { key: 'response_size_bytes',  label: 'Response Bytes' },
      { key: 'prompt_length',        label: 'Prompt Length' },
      { key: 'prompt',               label: 'Prompt' },
      // request_params is JSONB — flatten to a JSON string for CSV
      { key: 'request_params',       label: 'Request Params (JSON)',
        format: (v) => v ? JSON.stringify(v) : '' },
      { key: 'output_url',           label: 'Output URL' },
      { key: 'error_message',        label: 'Error' },
      { key: 'client_ip',            label: 'IP' },
      { key: 'user_agent',           label: 'User Agent' },
    ];

    const escapeCell = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const lines = [
      columns.map(c => escapeCell(c.label)).join(','),
      ...items.map(row => columns.map(c => {
        const raw = row[c.key];
        const v = c.format ? c.format(raw) : raw;
        return escapeCell(v);
      }).join(','))
    ];
    const csv = '﻿' + lines.join('\r\n');  // BOM for Excel UTF-8

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    a.download = `uvera_generation_logs_${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ── Summary stats over the loaded set ───────────────────────────────────
  const stats = React.useMemo(() => {
    const succeeded = items.filter(i => i.status === 'succeeded');
    const failed = items.filter(i => i.status === 'failed');
    const totalCostUsd = items.reduce((s, i) => s + Number(i.cost_usd || 0), 0);
    const totalCredits = items.reduce((s, i) => s + Number(i.credits_charged || 0), 0);
    const totalSeconds = items.reduce((s, i) => s + Number(i.duration_seconds || 0), 0);
    const successRate = items.length > 0
      ? ((succeeded.length / items.length) * 100).toFixed(1)
      : '—';
    const avgRenderMs = succeeded.length > 0
      ? Math.round(succeeded.reduce((s, i) => s + Number(i.duration_ms || 0), 0) / succeeded.length)
      : null;
    return {
      total: items.length,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      totalCostUsd,
      totalCredits,
      totalSeconds,
      successRate,
      avgRenderMs,
    };
  }, [items]);

  const STATUS_FILTERS = [
    { id: 'all',          label: 'All' },
    { id: 'started',      label: 'Running' },
    { id: 'succeeded',    label: 'Succeeded' },
    { id: 'failed',       label: 'Failed' },
    { id: 'timeout',      label: 'Timeout' },
  ];

  // Mirrors the generation_type CHECK constraint in
  // migrations/20260509_generation_logs_extend.up.sql
  // + 20260522_generation_logs_storyboard_type.up.sql (storyboard_image).
  const TYPE_FILTERS = [
    { id: 'all',                label: 'All types' },
    { id: 'video',              label: 'Video gen' },
    { id: 'storyboard_image',   label: 'Storyboard (GPT-image-2)' },
    { id: 'concept_image',      label: 'Concept img (Gemini legacy)' },
    { id: 'asset_describe',     label: 'Describe' },
    { id: 'optimize_prompt',    label: 'Optimize prompt' },
    { id: 'random_ideas',       label: 'Ideas' },
    { id: 'script',             label: 'Script' },
    { id: 'user_video_upload',  label: 'User upload' },
  ];

  const DAYS_FILTERS = [1, 7, 30, 90, 0];  // 0 = all-time

  return (
    <div className="space-y-4">
      {/* ─── Summary cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Total Generations</div>
          <div className="text-2xl font-bold text-white mt-1">{stats.total}</div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {stats.succeededCount} ✓ · {stats.failedCount} ✗ · {stats.successRate}% success
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Cost (USD)</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">${stats.totalCostUsd.toFixed(2)}</div>
          <div className="text-[11px] text-zinc-500 mt-1">estimated, hard rates</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Tokens Charged</div>
          <div className="text-2xl font-bold text-blue-400 mt-1">{stats.totalCredits.toLocaleString()}</div>
          <div className="text-[11px] text-zinc-500 mt-1">{stats.totalSeconds}s total render</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
          <div className="text-[11px] uppercase tracking-wider text-zinc-500">Avg Render Time</div>
          <div className="text-2xl font-bold text-purple-400 mt-1">
            {stats.avgRenderMs != null ? `${(stats.avgRenderMs / 1000).toFixed(1)}s` : '—'}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">succeeded only</div>
        </div>
      </div>

      {/* ─── Filters + actions ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-xl p-3">
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                statusFilter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Type filter — added v1.0.7 with extended generation_logs */}
        <div className="flex gap-1 ml-2 border-l border-zinc-800 pl-2">
          {TYPE_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                typeFilter === f.id ? 'bg-purple-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-2 border-l border-zinc-800 pl-2">
          {DAYS_FILTERS.map(d => (
            <button
              key={d}
              onClick={() => setDaysFilter(d)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                daysFilter === d ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {d === 0 ? 'All time' : `Last ${d}d`}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by user email…"
          value={emailFilter}
          onChange={(e) => setEmailFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          onBlur={load}
          className="ml-2 px-3 py-1 text-xs bg-zinc-900 border border-zinc-800 text-white rounded-md placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 w-48"
        />
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 text-white rounded-md focus:outline-none"
        >
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
        </select>
        <button
          onClick={load}
          className="px-3 py-1 text-xs font-medium bg-zinc-900 text-zinc-300 hover:text-white rounded-md transition-colors flex items-center gap-1"
        >
          <ArrowsClockwise size={12} /> Refresh
        </button>
        <button
          onClick={exportCsv}
          disabled={items.length === 0}
          className="ml-auto px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md transition-colors flex items-center gap-1"
        >
          <DownloadSimple size={14} /> Export CSV ({items.length})
        </button>
      </div>

      {/* ─── Table ─────────────────────────────────────────────────────── */}
      {loading && <div className="text-zinc-400 p-6 text-sm">Loading…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <ChartBar size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No generation logs in this window.</p>
          <p className="text-zinc-500 text-xs mt-1">Try widening the date range or removing filters.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950 border-b border-zinc-800">
                <tr className="text-zinc-500 uppercase tracking-wider text-[10px]">
                  <th className="px-3 py-2 text-left font-medium">Started</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Type</th>
                  <th className="px-3 py-2 text-left font-medium">Endpoint</th>
                  <th className="px-3 py-2 text-left font-medium">User</th>
                  <th className="px-3 py-2 text-left font-medium">Model</th>
                  <th className="px-3 py-2 text-right font-medium">USD</th>
                  <th className="px-3 py-2 text-right font-medium">Render</th>
                  <th className="px-3 py-2 text-left font-medium">Prompt / Params</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {pagination.pageItems.map(r => {
                  const renderSec = r.duration_ms ? (r.duration_ms / 1000).toFixed(1) : '—';
                  const summary = r.prompt
                    ? r.prompt
                    : r.request_params
                      ? Object.entries(r.request_params).map(([k, v]) => `${k}=${v}`).slice(0, 3).join(' · ')
                      : '—';
                  return (
                    <tr
                      key={r.id}
                      className="hover:bg-zinc-950/50 cursor-pointer"
                      onClick={() => setDetail(r)}
                    >
                      <td className="px-3 py-2 text-zinc-300 whitespace-nowrap">
                        {new Date(r.started_at).toLocaleString(undefined, {
                          month: '2-digit', day: '2-digit',
                          hour: '2-digit', minute: '2-digit', second: '2-digit'
                        })}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          r.status === 'succeeded' ? 'bg-emerald-500/15 text-emerald-300' :
                          r.status === 'failed'    ? 'bg-red-500/15 text-red-300' :
                          r.status === 'started'   ? 'bg-amber-500/15 text-amber-300' :
                          'bg-zinc-700 text-zinc-300'
                        }`}>{r.status}</span>
                        {/* §2026-06-06 fei — 失败已退款标记,FAILED 行直接可见(退款本体在 credit_tx) */}
                        {r.refunded && (
                          <div className="text-[9px] text-blue-300/90 mt-0.5 font-semibold uppercase tracking-wider"
                               title={`失败已退还 ${r.refunded_credits || 0} 积分${r.refunded_at ? ' @ ' + new Date(r.refunded_at).toLocaleString() : ''}`}>
                            已退款 {r.refunded_credits || 0}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          r.generation_type === 'video'             ? 'bg-purple-500/10 text-purple-300' :
                          r.generation_type === 'storyboard_image'  ? 'bg-fuchsia-500/10 text-fuchsia-300' :
                          r.generation_type === 'concept_image'     ? 'bg-blue-500/10 text-blue-300' :
                          r.generation_type === 'asset_describe'    ? 'bg-cyan-500/10 text-cyan-300' :
                          r.generation_type === 'optimize_prompt'   ? 'bg-amber-500/10 text-amber-300' :
                          r.generation_type === 'random_ideas'      ? 'bg-pink-500/10 text-pink-300' :
                          r.generation_type === 'script'            ? 'bg-emerald-500/10 text-emerald-300' :
                                                                      'bg-zinc-700/30 text-zinc-300'
                        }`}>{r.generation_type || '?'}</span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400 font-mono text-[10px] max-w-[200px] truncate" title={r.endpoint || ''}>
                        {r.endpoint || '—'}
                      </td>
                      <td className="px-3 py-2 text-zinc-400 max-w-[160px] truncate" title={r.user_email || r.user_id}>
                        {r.user_email || (r.user_id ? r.user_id.substring(0, 8) + '…' : <span className="italic text-zinc-600">anon</span>)}
                      </td>
                      <td className="px-3 py-2 text-zinc-400 max-w-[140px] truncate text-[10px]" title={r.model || ''}>
                        {r.model ? (r.model.length > 24 ? r.model.substring(0, 22) + '…' : r.model) : '—'}
                      </td>
                      {/* §2026-05-26 fei — 4dp so sub-cent LLM token costs (e.g.
                          $0.0008 for a multi-segment script call) don't render
                          as $0.000. Tokens shown as superscript so power users
                          can sanity-check pricing without expanding the row.
                          §2026-05-30 fei — Bug 3 fix: "Subsidized" badge when
                          cost_usd > 0 but credits_charged is NULL (e.g. character
                          board is intentionally free). Without the badge admin
                          couldn't tell "subsidized item" from "logging bug". */}
                      <td className="px-3 py-2 text-emerald-400 text-right tabular-nums">
                        <div>${Number(r.cost_usd || 0).toFixed(4)}</div>
                        {/* §2026-05-31 fei — cost_basis badge:
                            'actual' (green) = reconciled with BytePlus usage
                            'estimate' (zinc) = pre-render rate-table estimate
                            null = older row pre-reconciliation feature */}
                        {r.cost_basis === 'actual' && (
                          <div className="text-[9px] text-emerald-500/80 mt-0.5 uppercase tracking-wider font-semibold" title="cost_usd reconciled from BytePlus actual_completion_tokens × per-million rate">
                            Actual
                          </div>
                        )}
                        {r.cost_basis === 'estimate' && (
                          <div className="text-[9px] text-zinc-500 mt-0.5 uppercase tracking-wider" title="cost_usd is estimated from rate table × requested duration × model multiplier. Not yet reconciled with BytePlus actual usage.">
                            Estimate
                          </div>
                        )}
                        {/* §2026-05-31 fei — actual usage numbers (BytePlus) */}
                        {(r.actual_completion_tokens != null || r.actual_video_duration_seconds != null) && (
                          <div className="text-[9px] text-cyan-400/80 mt-0.5" title="Actual BytePlus usage from task status response">
                            {r.actual_completion_tokens != null && (
                              <span>{Number(r.actual_completion_tokens).toLocaleString()}tk</span>
                            )}
                            {r.actual_completion_tokens != null && r.actual_video_duration_seconds != null && ' · '}
                            {r.actual_video_duration_seconds != null && (
                              <span>{Number(r.actual_video_duration_seconds).toFixed(1)}s</span>
                            )}
                          </div>
                        )}
                        {Number(r.cost_usd || 0) > 0 && (r.credits_charged == null || Number(r.credits_charged) === 0) && (
                          <div className="text-[9px] text-amber-400 mt-0.5 uppercase tracking-wider font-semibold" title="Platform pays vendor; user not charged (intentional subsidy)">
                            Subsidized
                          </div>
                        )}
                        {(r.input_tokens != null || r.output_tokens != null) && (
                          <div className="text-[9px] text-zinc-500 mt-0.5">
                            {Number(r.input_tokens || 0).toLocaleString()}↓ {Number(r.output_tokens || 0).toLocaleString()}↑
                          </div>
                        )}
                        {r.render_session_id && (
                          <div
                            className="text-[9px] text-indigo-400/80 mt-0.5 font-mono cursor-help"
                            title={`Render session: ${r.render_session_id}\n(All rows with this ID came from one Quick Mode render — char board + storyboard + video segments.)`}
                          >
                            ↔ {r.render_session_id.substring(0, 6)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-400 text-right tabular-nums">
                        <div>{renderSec}s</div>
                        {/* §2026-06-02 甲方需求 — 本次生成扣除的用户 Tokens(credits_charged)。
                            标 "Tokens" 与上方 USD 列里的厂商算力 token(input/output "tok" /
                            BytePlus "tk")区分,避免混淆。数据列仍是 credits_charged。 */}
                        {r.credits_charged != null && Number(r.credits_charged) > 0 && (
                          <div className="text-[9px] text-blue-400 mt-0.5 font-medium" title="本次生成扣除的用户 Tokens（credits_charged），区别于厂商算力 token（input/output/completion）">
                            {Number(r.credits_charged).toLocaleString()} Tokens
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-400 max-w-[280px] truncate" title={summary}>
                        {summary}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="generation logs"
          />
          <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
            {items.length} rows fetched from server (cap: {pageSize}) · click any row for full request/response detail · "Export CSV" for the entire batch
          </div>
        </div>
      )}

      {/* ─── Detail drawer ─────────────────────────────────────────────── */}
      {detail && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setDetail(null)}
        >
          <div
            className="w-full max-w-lg h-full bg-zinc-900 border-l border-zinc-800 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-5 py-3 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <ChartBar size={16} className="text-zinc-500" />
                <h3 className="text-sm font-medium text-white">API call detail</h3>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-zinc-300">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold ${
                    detail.status === 'succeeded' ? 'bg-emerald-500/15 text-emerald-300' :
                    detail.status === 'failed'    ? 'bg-red-500/15 text-red-300' :
                    detail.status === 'started'   ? 'bg-amber-500/15 text-amber-300' :
                                                    'bg-zinc-700 text-zinc-300'
                  }`}>{detail.status}</span>
                  <span className="text-zinc-600 text-[10px]">·</span>
                  <span className="text-zinc-400 text-[11px]">{detail.generation_type}</span>
                  {detail.http_status && (
                    <>
                      <span className="text-zinc-600 text-[10px]">·</span>
                      <span className="text-zinc-400 text-[11px]">HTTP {detail.http_status}</span>
                    </>
                  )}
                </div>
                <div className="font-mono text-[11px] text-blue-300 break-all">{detail.endpoint || '—'}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Started</div>
                  <div className="text-zinc-300 mt-1">{new Date(detail.started_at).toLocaleString()}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Finished</div>
                  <div className="text-zinc-300 mt-1">{detail.finished_at ? new Date(detail.finished_at).toLocaleString() : <span className="italic text-zinc-600">—</span>}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Duration</div>
                  <div className="text-zinc-300 mt-1 tabular-nums">
                    {detail.duration_ms != null ? `${detail.duration_ms} ms (${(detail.duration_ms / 1000).toFixed(2)}s)` : '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Cost / Tokens</div>
                  <div className="text-zinc-300 mt-1 tabular-nums">
                    <span className="text-emerald-400">${Number(detail.cost_usd || 0).toFixed(6)}</span>
                    {detail.credits_charged != null && <span className="text-blue-400 ml-2" title="本次生成扣除的用户 Tokens（credits_charged）">{Number(detail.credits_charged).toLocaleString()} Tokens</span>}
                    {/* §2026-05-31 fei — cost_basis badge */}
                    {detail.cost_basis === 'actual' && <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[9px] uppercase tracking-wider font-semibold" title="Reconciled from BytePlus actual_completion_tokens × token rate">actual</span>}
                    {detail.cost_basis === 'estimate' && <span className="ml-2 px-1.5 py-0.5 rounded bg-zinc-500/15 text-zinc-400 text-[9px] uppercase tracking-wider" title="Pre-render rate-table estimate, not yet reconciled with BytePlus">estimate</span>}
                  </div>
                  {/* §2026-05-26 fei — explicit token breakdown for LLM rows */}
                  {(detail.input_tokens != null || detail.output_tokens != null) && (
                    <div className="text-[10px] text-zinc-500 mt-1 tabular-nums">
                      in: {Number(detail.input_tokens || 0).toLocaleString()} · out: {Number(detail.output_tokens || 0).toLocaleString()} tok
                    </div>
                  )}
                  {/* §2026-05-31 fei — BytePlus actual usage for video rows */}
                  {(detail.actual_completion_tokens != null || detail.actual_video_duration_seconds != null) && (
                    <div className="text-[10px] text-cyan-400/90 mt-1 tabular-nums">
                      {detail.actual_completion_tokens != null && (
                        <span title="BytePlus usage.completion_tokens">BytePlus tokens: {Number(detail.actual_completion_tokens).toLocaleString()}</span>
                      )}
                      {detail.actual_completion_tokens != null && detail.actual_video_duration_seconds != null && ' · '}
                      {detail.actual_video_duration_seconds != null && (
                        <span title="BytePlus content.duration (rendered video length)">actual {Number(detail.actual_video_duration_seconds).toFixed(2)}s</span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* §2026-05-31 fei — raw BytePlus response for video debugging.
                  Helpful when cost reconciliation looks off — gives admin the
                  authoritative BytePlus side of the equation. */}
              {detail.byteplus_response && (
                <details className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-zinc-500">BytePlus raw response</summary>
                  <pre className="mt-2 text-zinc-300 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(detail.byteplus_response, null, 2)}
                  </pre>
                </details>
              )}

              <div className="space-y-1.5 text-[11px]">
                <div><span className="text-zinc-600">Caller:</span> {detail.user_email || (detail.user_id ? <code className="font-mono">{detail.user_id}</code> : <span className="italic text-zinc-600">anonymous</span>)}</div>
                {detail.client_ip && <div><span className="text-zinc-600">IP:</span> {detail.client_ip}</div>}
                <div><span className="text-zinc-600">Vendor:</span> {detail.vendor || '—'} · <span className="text-zinc-600">Model:</span> <span className="font-mono text-[10px]">{detail.model || '—'}</span></div>
                {detail.task_id && <div><span className="text-zinc-600">Task ID:</span> <code className="font-mono text-[10px]">{detail.task_id}</code></div>}
                {detail.response_size_bytes != null && <div><span className="text-zinc-600">Response size:</span> {detail.response_size_bytes.toLocaleString()} bytes</div>}
              </div>

              {detail.prompt && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Prompt ({detail.prompt_length || detail.prompt.length} chars)</div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300 leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto text-[11px]">
                    {detail.prompt}
                  </div>
                </div>
              )}

              {detail.request_params && Object.keys(detail.request_params).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Request params</div>
                  <pre className="bg-zinc-950 border border-zinc-800 rounded p-2 text-zinc-300 text-[10px] font-mono overflow-x-auto">{JSON.stringify(detail.request_params, null, 2)}</pre>
                </div>
              )}

              {detail.output_url && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Output</div>
                  <a href={detail.output_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:opacity-80 break-all text-[11px]">
                    {detail.output_url}
                  </a>
                </div>
              )}

              {detail.error_message && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-red-500 mb-1">Error</div>
                  <div className="bg-red-500/10 border border-red-500/30 rounded p-2 text-red-300 text-[11px] whitespace-pre-wrap break-words">
                    {detail.error_message}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-zinc-600 pt-2 border-t border-zinc-800">
                Log id: <code className="font-mono">{detail.id}</code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Content Reports triage view. Each row in public.content_reports
 * with status='open' shows up here for admin action.
 *
 * Workflow:
 *   - Filter by status (open / investigating / resolved / dismissed / all)
 *   - For each report: see reporter (or 'anonymous'), reason category,
 *     detail text, IP, plus a quick link to the reported content
 *   - Admin actions:
 *     - Investigate: status='investigating' (no resolution yet)
 *     - Resolve:    status='resolved'   (action taken)
 *     - Dismiss:    status='dismissed'  (no violation)
 *
 * Backend: /api/admin/content-reports/resolve
 * Schema: migrations/20260508_content_reports.up.sql
 */
const ContentReportsView = () => {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('open');
  const [resolvingId, setResolvingId] = React.useState(null);
  const pagination = useAdminPagination(items, 50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('content_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query.limit(200);
      if (error) throw error;
      setItems(data || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [statusFilter]);

  const resolve = async (id, status) => {
    let resolutionNote = null;
    let actionTaken = null;
    if (status === 'resolved') {
      actionTaken = window.prompt('What action did you take? (e.g. unpublished, archived, no_action)') || 'no_action';
      resolutionNote = window.prompt('Resolution note (optional, visible to reporter):') || null;
    } else if (status === 'dismissed') {
      resolutionNote = window.prompt('Why dismissing? (optional, visible to reporter):') || null;
    }

    setResolvingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/content-reports/resolve', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reportId: id, status, resolutionNote, actionTaken })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      setItems(prev => prev.filter(i => i.id !== id));
      setTimeout(() => load(), 250);
    } catch (e) {
      alert(`Action failed: ${e.message}`);
    } finally {
      setResolvingId(null);
    }
  };

  const FILTERS = [
    { id: 'open',          label: 'Open' },
    { id: 'investigating', label: 'Investigating' },
    { id: 'resolved',      label: 'Resolved' },
    { id: 'dismissed',     label: 'Dismissed' },
    { id: 'all',           label: 'All' },
  ];

  const REASON_LABEL = {
    copyright:     'Copyright',
    inappropriate: 'Inappropriate',
    impersonation: 'Impersonation',
    spam:          'Spam',
    dangerous:     'Dangerous',
    other:         'Other',
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={load}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 rounded-lg transition-colors flex items-center gap-1"
        >
          <ArrowsClockwise size={12} /> Refresh
        </button>
      </div>

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <Flag size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No reports in this queue.</p>
        </div>
      )}

      <div className="space-y-3">
        {pagination.pageItems.map(r => {
          const isResolving = resolvingId === r.id;
          const isOpen = r.status === 'open' || r.status === 'investigating';
          // Best-effort link to the reported content
          const targetLink = r.content_type === 'series'
            ? `/series/${r.reported_content_id}`
            : null;
          return (
            <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${
                      r.reason === 'copyright'     ? 'bg-orange-500/15 text-orange-300 border-orange-500/30' :
                      r.reason === 'inappropriate' ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                      r.reason === 'impersonation' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                      r.reason === 'dangerous'     ? 'bg-red-700/30 text-red-300 border-red-700/50' :
                      r.reason === 'spam'          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                                                     'bg-zinc-700/30 text-zinc-300 border-zinc-700/50'
                    }`}>
                      {REASON_LABEL[r.reason] || r.reason}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold border ${
                      r.status === 'open'          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                      r.status === 'investigating' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30' :
                      r.status === 'resolved'      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
                                                     'bg-zinc-700/30 text-zinc-300 border-zinc-700/50'
                    }`}>
                      {r.status}
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm font-medium text-white mb-0.5">
                    {r.reported_title || `${r.content_type} ${r.reported_content_id?.substring(0, 8)}…`}
                  </div>
                  <div className="text-[11px] text-zinc-500">
                    {r.content_type} · id <code className="font-mono">{r.reported_content_id?.substring(0, 12)}…</code>
                    {targetLink && (
                      <> · <a href={targetLink} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">view content ↗</a></>
                    )}
                  </div>
                </div>
              </div>

              {r.detail && (
                <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-xs text-zinc-300 mb-3 leading-relaxed whitespace-pre-wrap">
                  {r.detail}
                </div>
              )}

              <div className="text-[11px] text-zinc-500 space-y-0.5 mb-3 pt-2 border-t border-zinc-800">
                <div>
                  <span className="text-zinc-600">Reporter:</span>{' '}
                  {r.reporter_email || (r.reporter_user_id ? r.reporter_user_id.substring(0, 8) + '…' : <span className="italic">anonymous</span>)}
                </div>
                {r.reporter_ip && <div><span className="text-zinc-600">IP:</span> {r.reporter_ip}</div>}
                {r.reported_url && (
                  <div className="truncate"><span className="text-zinc-600">From:</span> <span title={r.reported_url}>{r.reported_url}</span></div>
                )}
                {r.resolution_note && (
                  <div className="text-zinc-400 mt-1"><span className="text-zinc-600">Resolution:</span> {r.resolution_note}</div>
                )}
                {r.action_taken && (
                  <div className="text-zinc-400"><span className="text-zinc-600">Action:</span> <code className="font-mono">{r.action_taken}</code></div>
                )}
              </div>

              {isOpen && (
                <div className="flex gap-2">
                  {r.status === 'open' && (
                    <button
                      onClick={() => resolve(r.id, 'investigating')}
                      disabled={isResolving}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      Investigating
                    </button>
                  )}
                  <button
                    onClick={() => resolve(r.id, 'resolved')}
                    disabled={isResolving}
                    className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Check size={12} weight="bold" /> Resolve
                  </button>
                  <button
                    onClick={() => resolve(r.id, 'dismissed')}
                    disabled={isResolving}
                    className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <XCircle size={12} weight="bold" /> Dismiss
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <AdminPagination
        page={pagination.page}
        perPage={pagination.perPage}
        total={pagination.total}
        onChange={pagination.setPage}
        label="reports"
      />
    </div>
  );
};

/**
 * One-click token adjust modal. Opens from any user row's "+ Tokens"
 * button — preset buttons cover the three monthly tiers ($25/$69/$189
 * in USD = +500/+1500/+5000 tokens), plus a free-form custom amount
 * field for promo / partial compensation. Optional tier change and
 * Stripe invoice ID (for reconciliation against a failed webhook).
 *
 * Calls POST /api/admin/grant-credits which:
 *   - Verifies caller is admin (JWT)
 *   - Adds credits to user_metadata (additive — does NOT overwrite)
 *   - Logs to credit_grants table (audit trail w/ granted_by)
 *
 * `onDone(updatedSnapshot)` is called with { credits, tier } so the
 * caller can patch its row state in-place without a full refetch.
 */
const TokenAdjustModal = ({ user, onClose, onDone }) => {
  const [amount, setAmount] = React.useState('');
  const [tier, setTier] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [stripeInvoiceId, setStripeInvoiceId] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);

  if (!user) return null;

  const PRESETS = [
    { amount: 500,  tier: 'starter', label: '+500',  sub: 'Starter ($25)' },
    { amount: 1500, tier: 'creator', label: '+1500', sub: 'Creator ($69)' },
    { amount: 5000, tier: 'studio',  label: '+5000', sub: 'Studio ($189)' },
    { amount: 100,  tier: '',        label: '+100',  sub: 'Promo' },
    { amount: 50,   tier: '',        label: '+50',   sub: 'Goodwill' },
  ];

  const applyPreset = (p) => {
    setAmount(String(p.amount));
    if (p.tier) setTier(p.tier);
  };

  const submit = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Enter a positive number of tokens.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/admin/grant-credits', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          credits: n,
          tier: tier || undefined,
          reason: reason.trim() || undefined,
          stripeInvoiceId: stripeInvoiceId.trim() || undefined,
        })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      onDone({ credits: data.newCredits, tier: data.newTier || user.tier });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const projectedNew = Number(amount) > 0 ? (user.credits || 0) + Number(amount) : null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <Coins size={16} weight="fill" className="text-amber-400" /> Adjust tokens
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 truncate max-w-[400px]">{user.email || user.id}</p>
          </div>
          <button onClick={() => !submitting && onClose()} className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors" disabled={submitting}>
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current state */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 flex items-center justify-between text-xs">
            <div className="text-zinc-400">Current</div>
            <div className="flex items-center gap-3">
              <span className="text-zinc-300">tier <span className="text-white font-medium">{user.tier || 'free'}</span></span>
              <span className="text-zinc-300">tokens <span className="text-blue-400 font-medium tabular-nums">{user.credits ?? 0}</span></span>
            </div>
          </div>

          {/* Presets */}
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-2">Quick presets</div>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map(p => (
                <button
                  key={p.label + p.sub}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={submitting}
                  className="bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-left px-2.5 py-2 rounded transition-colors disabled:opacity-50"
                >
                  <div className="text-white text-sm font-medium tabular-nums">{p.label}</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5">{p.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Custom amount */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Amount (tokens to add)</label>
            <input
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 500"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50 tabular-nums"
            />
            {projectedNew !== null && (
              <div className="text-[11px] text-zinc-500 mt-1.5">
                After grant: <span className="text-blue-400 tabular-nums font-medium">{projectedNew}</span> tokens
              </div>
            )}
          </div>

          {/* Tier override */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Set tier (optional)</label>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm focus:outline-none focus:border-blue-600 disabled:opacity-50"
            >
              <option value="">— don't change ({user.tier || 'free'}) —</option>
              <option value="free">free</option>
              <option value="starter">starter</option>
              <option value="creator">creator</option>
              <option value="studio">studio</option>
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Reason (audit log)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Stripe webhook failed — manual reconciliation"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50"
            />
          </div>

          {/* Stripe invoice ID — for reconciliation */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Stripe invoice ID (optional)</label>
            <input
              type="text"
              value={stripeInvoiceId}
              onChange={(e) => setStripeInvoiceId(e.target.value)}
              placeholder="in_1ABC… (links this grant to a Stripe payment)"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50 font-mono text-xs"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-md px-3 py-2 flex items-start gap-2">
              <WarningCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !amount || Number(amount) <= 0}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? <><ArrowsClockwise size={12} className="animate-spin" /> Granting…</> : <><Check size={12} weight="bold" /> Grant tokens</>}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Users management — backed by auth.users (Supabase Auth) via Worker
 * /api/admin/users/list. Replaces the legacy table that pulled from
 * the stale public.users mirror (which had wrong contact / type /
 * status columns and no token / role / login info).
 *
 * Capabilities:
 *   - Search by email / name / id
 *   - Filter by status (all / paid / admin / banned)
 *   - Per-row info: avatar, name, email, registered, last login,
 *     tier, tokens, role badge, banned state, content/order counts
 *   - Click row → drawer with all metadata + recent activity
 *   - Actions menu: Set role (super admin / admin / regular user),
 *     Ban / Unban (with reason), + Tokens (one-click grant via
 *     /api/admin/grant-credits), Delete (legacy public.users row only)
 *
 * Role-change actions require the caller to be super admin (Worker
 * enforces); Ban requires regular admin. UI hides actions the caller
 * isn't allowed to perform.
 */
const UsersView = ({ users: legacyUsers, setUsers: setLegacyUsers, mode = 'users' }) => {
  /* 2026-05-12 mode prop:
   *   mode='users' (default) — 完整 user list,filter pills 含 All/Paid/Admins/Banned
   *   mode='admins'           — 只显示 admin/super_admin,filter pills 简化为
   *                             All admins / Super / Admin。导航分立 Admin tab。 */
  const isAdminsMode = mode === 'admins';
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [callerIsSuperAdmin, setCallerIsSuperAdmin] = React.useState(false);
  const [callerId, setCallerId] = React.useState(null);
  const [acting, setActing] = React.useState(null);  // { id, action } while a per-row mutation is in flight
  const [detailUser, setDetailUser] = React.useState(null);
  const [tokenUser, setTokenUser] = React.useState(null);  // user passed to TokenAdjustModal
  const [flashId, setFlashId] = React.useState(null);  // briefly highlight a row after a successful grant

  // Patch a row in-place after a successful token grant + flash for visual confirm.
  const onTokensGranted = (userId, { credits, tier }) => {
    setItems(prev => prev.map(u => u.id === userId ? { ...u, credits, tier: tier || u.tier } : u));
    if (detailUser?.id === userId) {
      setDetailUser(prev => prev ? { ...prev, credits, tier: tier || prev.tier } : prev);
    }
    setFlashId(userId);
    setTimeout(() => setFlashId(prev => prev === userId ? null : prev), 1800);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session, user } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      setCallerIsSuperAdmin(user?.user_metadata?.is_super_admin === true);
      setCallerId(user?.id || null);

      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      params.set('perPage', '200');

      const r = await fetch(`/api/admin/users/list?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      /* 2026-05-12 防御: r.json() 在 r.body 为空 (401/204/CF cold-start) 时
         会抛 "Unexpected end of JSON input"。先 text() + 显式 parse,把错误
         消息合并成可读的 HTTP code + body。 */
      const rawText = await r.text();
      let data = {};
      if (rawText) {
        try { data = JSON.parse(rawText); }
        catch { data = { errMessage: `Non-JSON body: ${rawText.slice(0, 80)}` }; }
      }
      if (!r.ok) {
        if (r.status === 401) {
          throw new Error('Session expired — please sign out and sign back in.');
        }
        throw new Error(data.errMessage || `HTTP ${r.status}${rawText ? '' : ' (empty body)'}`);
      }
      if (!data.success) throw new Error(data.errMessage || 'API returned non-success status');
      setItems(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // §2026-05-15: client-side pagination (50/page) on the filtered users list.
  // pagination is computed AFTER filter so changing the filter pill auto-resets
  // to page 1 (hook detects items reference change).
  const filtered = React.useMemo(() => {
    if (isAdminsMode) {
      /* Admins mode: base 集 = is_admin || is_super_admin。pills 是 super/admin 切分。 */
      const adminItems = items.filter(u => u.is_admin || u.is_super_admin);
      if (statusFilter === 'super') return adminItems.filter(u => u.is_super_admin);
      if (statusFilter === 'regular-admin') return adminItems.filter(u => u.is_admin && !u.is_super_admin);
      return adminItems;
    }
    if (statusFilter === 'all') return items;
    if (statusFilter === 'paid') return items.filter(u => u.tier && u.tier !== 'free');
    if (statusFilter === 'admin') return items.filter(u => u.is_admin);
    if (statusFilter === 'banned') return items.filter(u => u.banned);
    return items;
  }, [items, statusFilter, isAdminsMode]);
  const pagination = useAdminPagination(filtered, 50);

  const counts = isAdminsMode ? (() => {
    const adminItems = items.filter(u => u.is_admin || u.is_super_admin);
    return {
      all:             adminItems.length,
      super:           adminItems.filter(u => u.is_super_admin).length,
      'regular-admin': adminItems.filter(u => u.is_admin && !u.is_super_admin).length,
    };
  })() : {
    all:    items.length,
    paid:   items.filter(u => u.tier && u.tier !== 'free').length,
    admin:  items.filter(u => u.is_admin).length,
    banned: items.filter(u => u.banned).length,
  };

  const setRole = async (userId, role) => {
    const labels = { super_admin: 'super admin', admin: 'admin', user: 'regular user' };
    if (!window.confirm(`Set this user's role to "${labels[role]}"?\n\nNote: the user must log out and log back in to refresh their session token before the change takes effect.`)) return;
    setActing({ id: userId, action: 'role' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/users/update-role', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, role })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      setItems(prev => prev.map(u => u.id === userId ? {
        ...u,
        is_admin: role !== 'user',
        is_super_admin: role === 'super_admin',
      } : u));
    } catch (e) {
      alert(`Role change failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  const setBan = async (userId, banned) => {
    let reason = null;
    let durationHours = null;
    if (banned) {
      reason = window.prompt('Reason for ban (visible to ops; not shown to the user):');
      if (reason === null) return; // user cancelled
      const dur = window.prompt('Ban duration in hours (leave empty for permanent):', '');
      if (dur && dur.trim()) {
        const n = parseInt(dur, 10);
        if (Number.isFinite(n) && n > 0) durationHours = n;
      }
      const finalConfirm = window.confirm(`Ban this user${durationHours ? ` for ${durationHours} hours` : ' permanently'}?\n\nThe user will be unable to log in. Existing sessions remain valid until JWT expiry (~1h). Existing content is NOT removed — handle takedown separately if needed.`);
      if (!finalConfirm) return;
    } else {
      if (!window.confirm('Unban this user? They will be able to log in again.')) return;
    }
    setActing({ id: userId, action: 'ban' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/users/ban', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, banned, reason, durationHours })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      setItems(prev => prev.map(u => u.id === userId ? { ...u, banned, ban_reason: banned ? reason : null } : u));
    } catch (e) {
      alert(`${banned ? 'Ban' : 'Unban'} failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  const formatTimeAgo = (iso) => {
    if (!iso) return '—';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return new Date(iso).toLocaleDateString();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 48) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  };

  const FILTERS = isAdminsMode
    ? [
        { id: 'all',            label: 'All admins' },
        { id: 'super',          label: 'Super' },
        { id: 'regular-admin',  label: 'Admin' },
      ]
    : [
        { id: 'all',    label: 'All' },
        { id: 'paid',   label: 'Paid' },
        { id: 'admin',  label: 'Admins' },
        { id: 'banned', label: 'Banned' },
      ];

  return (
    <div className="space-y-4">
      {/* ─── Search + filter bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-xl p-3">
        <input
          type="text"
          placeholder="Search email / name / id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') load(); }}
          onBlur={load}
          className="px-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 text-white rounded-md placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 w-64"
        />
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${
                statusFilter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label} <span className="text-[10px] opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={load}
          className="ml-auto px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 rounded-md transition-colors flex items-center gap-1"
        >
          <ArrowsClockwise size={12} /> Refresh
        </button>
      </div>

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading users…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
      {!loading && !error && filtered.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <Users size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No users in this filter.</p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 font-medium">User</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium text-right">Tokens</th>
                  <th className="px-3 py-2 font-medium">Registered</th>
                  <th className="px-3 py-2 font-medium">Last Login</th>
                  <th className="px-3 py-2 font-medium text-right">Videos</th>
                  <th className="px-3 py-2 font-medium text-right">Orders</th>
                  <th className="px-3 py-2 font-medium">Role / Status</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {pagination.pageItems.map(u => {
                  const isActing = acting?.id === u.id;
                  const role = u.is_super_admin ? 'super_admin' : u.is_admin ? 'admin' : 'user';
                  return (
                    <tr key={u.id} className={`hover:bg-zinc-800/30 transition-colors ${u.banned ? 'opacity-60' : ''} ${flashId === u.id ? 'bg-amber-500/10 ring-1 ring-amber-500/40' : ''}`}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setDetailUser(u)}
                            className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity min-w-0"
                          >
                            {u.avatar_url ? (
                              <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full bg-zinc-800 flex-shrink-0" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 flex-shrink-0">
                                <Users size={14} />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-white font-medium truncate max-w-[180px]" title={u.name || u.email}>
                                {u.name || u.email?.split('@')[0] || u.id.substring(0, 8)}
                              </div>
                              <div className="text-zinc-500 truncate max-w-[180px]" title={u.email}>
                                {u.email || u.id.substring(0, 12) + '…'}
                              </div>
                            </div>
                          </button>
                          {/* §2026-06-10 — copy 完整 user id + 新标签打开用户主页 */}
                          <AdminUserChip variant="actions" userId={u.id} />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold ${
                          u.tier === 'studio'  ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30' :
                          u.tier === 'creator' ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30' :
                          u.tier === 'starter' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' :
                                                  'bg-zinc-700/30 text-zinc-400 border border-zinc-700'
                        }`}>{u.tier || 'free'}</span>
                      </td>
                      <td className="px-3 py-2 text-blue-400 text-right tabular-nums">{u.credits ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-400" title={u.created_at}>{formatTimeAgo(u.created_at)}</td>
                      <td className="px-3 py-2 text-zinc-400" title={u.last_sign_in_at}>{formatTimeAgo(u.last_sign_in_at)}</td>
                      <td className="px-3 py-2 text-zinc-400 text-right tabular-nums">{u.video_count}</td>
                      <td className="px-3 py-2 text-zinc-400 text-right tabular-nums">{u.order_count}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          {u.is_super_admin && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 inline-block w-fit">
                              ⚡ Super
                            </span>
                          )}
                          {u.is_admin && !u.is_super_admin && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 inline-block w-fit">
                              Admin
                            </span>
                          )}
                          {u.banned && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-semibold bg-red-500/15 text-red-300 border border-red-500/30 inline-block w-fit" title={u.ban_reason || ''}>
                              Banned
                            </span>
                          )}
                          {!u.is_admin && !u.banned && (
                            <span className="text-[10px] text-zinc-600">active</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {/* Role change — super admin only */}
                          {callerIsSuperAdmin && (
                            <select
                              value={role}
                              onChange={(e) => setRole(u.id, e.target.value)}
                              disabled={isActing}
                              className="px-2 py-1 bg-zinc-950 border border-zinc-800 text-zinc-300 rounded text-[10px] disabled:opacity-50 focus:outline-none focus:border-blue-600"
                              title="Change user role"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                              <option value="super_admin">Super Admin</option>
                            </select>
                          )}
                          <button
                            onClick={() => setTokenUser(u)}
                            disabled={isActing}
                            className="px-2 py-1 rounded text-[10px] font-medium bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            title="Adjust this user's tokens / tier (audit-logged)"
                          >
                            <Coins size={10} weight="fill" /> Tokens
                          </button>
                          <button
                            onClick={() => setBan(u.id, !u.banned)}
                            disabled={isActing || u.id === callerId}
                            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              u.banned
                                ? 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40'
                                : 'bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-600/40'
                            }`}
                            title={u.id === callerId ? 'Refusing to ban yourself' : (u.banned ? 'Unban this user' : 'Ban this user')}
                          >
                            {u.banned ? 'Unban' : 'Ban'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="users"
          />
          {items.length === 200 && (
            <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
              Server fetch capped at 200 — refine search if a specific user is missing.
            </div>
          )}
        </div>
      )}

      {/* ─── Detail drawer ───────────────────────────────────────────── */}
      {detailUser && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setDetailUser(null)}
        >
          <div
            className="w-full max-w-md h-full bg-zinc-900 border-l border-zinc-800 shadow-2xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-5 py-3 flex items-center justify-between z-10">
              <h3 className="text-sm font-medium text-white">User detail</h3>
              <button
                onClick={() => setDetailUser(null)}
                className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-3">
                {detailUser.avatar_url ? (
                  <img src={detailUser.avatar_url} alt="" className="w-14 h-14 rounded-full bg-zinc-800" />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500">
                    <Users size={24} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-base font-medium text-white truncate">{detailUser.name || detailUser.email?.split('@')[0]}</div>
                  <div className="text-xs text-zinc-400 truncate">{detailUser.email}</div>
                  {detailUser.phone && <div className="text-xs text-zinc-400 truncate">{detailUser.phone}</div>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Tier</div>
                  <div className="text-white font-medium mt-1">{detailUser.tier || 'free'}</div>
                </div>
                <button
                  onClick={() => setTokenUser(detailUser)}
                  className="bg-zinc-950 border border-zinc-800 hover:border-amber-500/50 hover:bg-amber-500/5 rounded p-2 text-left transition-colors group"
                  title="Adjust tokens / tier"
                >
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-between">
                    Tokens
                    <Coins size={10} weight="fill" className="text-zinc-600 group-hover:text-amber-400 transition-colors" />
                  </div>
                  <div className="text-blue-400 font-medium mt-1 tabular-nums">{detailUser.credits ?? '—'}</div>
                </button>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Videos</div>
                  <div className="text-white font-medium mt-1 tabular-nums">{detailUser.video_count}</div>
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Orders</div>
                  <div className="text-white font-medium mt-1 tabular-nums">{detailUser.order_count}</div>
                </div>
              </div>

              <div className="space-y-1.5 text-[11px] text-zinc-400">
                <div><span className="text-zinc-600">User ID:</span> <code className="font-mono text-zinc-300">{detailUser.id}</code></div>
                <div><span className="text-zinc-600">Provider:</span> {detailUser.provider || '—'}</div>
                <div><span className="text-zinc-600">Email confirmed:</span> {detailUser.email_confirmed_at ? new Date(detailUser.email_confirmed_at).toLocaleString() : '— never'}</div>
                <div><span className="text-zinc-600">Registered:</span> {detailUser.created_at ? new Date(detailUser.created_at).toLocaleString() : '—'}</div>
                <div><span className="text-zinc-600">Last login:</span> {detailUser.last_sign_in_at ? new Date(detailUser.last_sign_in_at).toLocaleString() : '— never'}</div>
                <div><span className="text-zinc-600">Last generation:</span> {detailUser.last_generation_at ? new Date(detailUser.last_generation_at).toLocaleString() : '—'}</div>
                {detailUser.banned && (
                  <>
                    <div className="text-red-400 mt-2"><span className="text-zinc-600">Banned until:</span> {detailUser.banned_until ? new Date(detailUser.banned_until).toLocaleString() : '—'}</div>
                    {detailUser.ban_reason && <div className="text-red-400"><span className="text-zinc-600">Reason:</span> {detailUser.ban_reason}</div>}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Token adjust modal ──────────────────────────────────────── */}
      {tokenUser && (
        <TokenAdjustModal
          user={tokenUser}
          onClose={() => setTokenUser(null)}
          onDone={(snapshot) => onTokensGranted(tokenUser.id, snapshot)}
        />
      )}
    </div>
  );
};

/**
 * Refund modal — issues a Stripe refund (full or partial) on a paid order
 * via /api/admin/orders/refund. Optionally deducts tokens from the user's
 * balance (default: prorated to the refund amount, clamped to >= 0).
 *
 * Refund flow:
 *   1. Worker calls Stripe POST /v1/refunds with the resolved payment_intent
 *   2. On Stripe success, writes audit columns to orders
 *   3. Optionally deducts credits from user_metadata
 *
 * Manual orders (orderNo not matching in_xxx or cs_xxx) cannot be
 * refunded — the modal refuses with a hint to use Void instead.
 */
const RefundModal = ({ order, onClose, onDone }) => {
  const [amount, setAmount] = React.useState('');         // empty = full refund
  const [reason, setReason] = React.useState('');
  const [stripeReason, setStripeReason] = React.useState('requested_by_customer');
  const [deductCredits, setDeductCredits] = React.useState(true);
  // Best guess at how many tokens were granted, derived from order.subject pattern
  // "UVERA <tier> ..." — matches our webhook's insert format.
  const tierFromSubject = React.useMemo(() => {
    if (!order?.subject) return null;
    const m = order.subject.match(/UVERA\s+(\w+)/i);
    return m ? m[1].toLowerCase() : null;
  }, [order]);
  const tokenGrantByTier = { lite: 100, starter: 500, creator: 1500, studio: 5000 };
  const grantedTokens = tokenGrantByTier[tierFromSubject] || 0;
  const [tokensToDeduct, setTokensToDeduct] = React.useState(String(grantedTokens));

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [context, setContext] = React.useState(null);
  const [contextLoading, setContextLoading] = React.useState(true);

  React.useEffect(() => {
    setTokensToDeduct(String(grantedTokens));
  }, [grantedTokens]);

  // Fetch abuse-detection context: how much of the granted tokens has the
  // user already consumed? Are they a serial refunder? Worker queries
  // generation_logs.credits_charged + counts prior refunded orders.
  React.useEffect(() => {
    if (!order?.orderNo) return;
    let cancelled = false;
    (async () => {
      setContextLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not signed in');
        const r = await fetch(`/api/admin/orders/refund-context?orderNo=${encodeURIComponent(order.orderNo)}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const data = await r.json();
        if (!cancelled && r.ok && data.success) {
          setContext(data.context);
          // Pre-fill amount with the suggested pro-rated value if usage is non-trivial
          if (data.context.usagePct >= 0.30 && data.context.suggestedRefundUsd > 0) {
            setAmount(String(data.context.suggestedRefundUsd));
          }
        }
      } catch (e) {
        // Non-fatal — modal still works without context, just no risk hint
        console.warn('refund-context fetch failed:', e.message);
      } finally {
        if (!cancelled) setContextLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.orderNo]);

  if (!order) return null;

  const isStripeOrder = order.source === 'stripe';
  const fullAmount = Number(order.amount) || 0;
  const refundAmt = amount.trim() === '' ? fullAmount : Number(amount);
  const isPartial = refundAmt > 0 && refundAmt < fullAmount;

  // Auto-prorate the suggested deduction when admin types a partial amount.
  React.useEffect(() => {
    if (amount.trim() === '') {
      setTokensToDeduct(String(grantedTokens));
    } else {
      const n = Number(amount);
      if (Number.isFinite(n) && n > 0 && fullAmount > 0) {
        setTokensToDeduct(String(Math.ceil((n / fullAmount) * grantedTokens)));
      }
    }
  }, [amount, fullAmount, grantedTokens]);

  const submit = async () => {
    if (!isStripeOrder) {
      setError('This is a manual order — use Void instead of Refund.');
      return;
    }
    if (!reason.trim()) {
      setError('Reason is required for the audit log.');
      return;
    }
    if (amount.trim() !== '') {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) {
        setError('Amount must be a positive number.');
        return;
      }
      if (n > fullAmount) {
        setError(`Amount exceeds order total ($${fullAmount.toFixed(2)}).`);
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/admin/orders/refund', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderNo: order.orderNo,
          amount: amount.trim() === '' ? undefined : Number(amount),
          reason: reason.trim(),
          stripeReason,
          deductCredits: deductCredits ? Number(tokensToDeduct) || 0 : 0,
        })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      onDone(data);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={() => !submitting && onClose()}
    >
      <div
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <Receipt size={16} weight="fill" className="text-red-400" /> Refund payment
            </h3>
            <p className="text-[11px] text-zinc-500 mt-0.5 truncate max-w-[400px] font-mono">{order.orderNo}</p>
          </div>
          <button onClick={() => !submitting && onClose()} className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors" disabled={submitting}>
            <X size={14} weight="bold" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!isStripeOrder && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs rounded-md px-3 py-2 flex items-start gap-2">
              <WarningCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>Manual orders (ORD-xxx) have no Stripe payment to refund. Use the <strong>Void</strong> action instead — it removes the order from KPIs without touching payment systems.</span>
            </div>
          )}

          {/* Abuse-detection context — fetched from /api/admin/orders/refund-context.
              Shows token consumption since this purchase + prior refund history,
              with a color-coded risk level so admin can spot users who already used
              most of what they're trying to refund. */}
          {contextLoading && isStripeOrder && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-500 flex items-center gap-2">
              <ArrowsClockwise size={12} className="animate-spin" />
              Loading usage signals…
            </div>
          )}

          {context && isStripeOrder && (
            <div className={`border rounded-lg px-3 py-2.5 text-xs space-y-1.5 ${
              context.riskLevel === 'high'   ? 'bg-red-500/10 border-red-500/40' :
              context.riskLevel === 'medium' ? 'bg-amber-500/10 border-amber-500/30' :
                                                'bg-emerald-500/5 border-emerald-500/20'
            }`}>
              <div className={`flex items-center justify-between font-semibold ${
                context.riskLevel === 'high'   ? 'text-red-300' :
                context.riskLevel === 'medium' ? 'text-amber-300' :
                                                  'text-emerald-300'
              }`}>
                <span className="flex items-center gap-1.5">
                  {context.riskLevel === 'high'
                    ? <><WarningCircle size={12} weight="fill" /> High refund-abuse risk</>
                    : context.riskLevel === 'medium'
                      ? <><WarningCircle size={12} /> Review carefully</>
                      : <><CheckCircle size={12} /> Low risk — safe to refund</>
                  }
                </span>
                {context.usagePct > 0 && (
                  <span className="font-mono tabular-nums">{Math.round(context.usagePct * 100)}% used</span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div className="text-zinc-400">Granted by this order</div>
                <div className="text-white text-right tabular-nums">{context.grantedTokens.toLocaleString()} tokens ({context.tier || '—'})</div>

                <div className="text-zinc-400">Used since purchase</div>
                <div className={`text-right tabular-nums ${
                  context.usagePct >= 0.7 ? 'text-red-300' :
                  context.usagePct >= 0.3 ? 'text-amber-300' :
                                            'text-zinc-200'
                }`}>
                  {context.usageTokens.toLocaleString()} tokens · {context.generationCount} generations
                </div>

                <div className="text-zinc-400">Current balance</div>
                <div className="text-white text-right tabular-nums">{context.currentBalance.toLocaleString()} tokens</div>

                {context.priorRefunds > 0 && (
                  <>
                    <div className="text-zinc-400">Prior refunds by this user</div>
                    <div className={`text-right tabular-nums font-medium ${context.priorRefunds >= 2 ? 'text-red-300' : 'text-amber-300'}`}>
                      {context.priorRefunds} ⚠
                    </div>
                  </>
                )}
              </div>

              {context.riskReasons.length > 0 && (
                <div className="pt-1.5 mt-1.5 border-t border-current/10 text-[11px] text-zinc-300 leading-relaxed">
                  {context.riskReasons.map((r, i) => <div key={i}>· {r}</div>)}
                </div>
              )}

              {context.suggestedRefundUsd < context.orderAmount && (
                <div className="pt-1.5 mt-1.5 border-t border-current/10">
                  <button
                    type="button"
                    onClick={() => setAmount(String(context.suggestedRefundUsd))}
                    className="text-[11px] font-medium text-blue-400 hover:text-blue-300 underline cursor-pointer"
                  >
                    Use suggested refund: ${context.suggestedRefundUsd.toFixed(2)} (unused portion only)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Order summary */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-zinc-400">Customer</span>
              <span className="text-white truncate max-w-[280px]">{order.userEmail || order.userId || '—'}</span>
            </div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-zinc-400">Subject</span>
              <span className="text-white truncate max-w-[280px]">{order.subject}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-400">Total paid</span>
              <span className="text-emerald-400 font-medium tabular-nums">${fullAmount.toFixed(2)}</span>
            </div>
          </div>

          {/* Refund amount */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">
              Refund amount (USD) — leave empty for full refund
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={fullAmount}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Default: $${fullAmount.toFixed(2)} (full)`}
              disabled={submitting || !isStripeOrder}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-600 disabled:opacity-50 tabular-nums"
            />
            <div className="text-[11px] text-zinc-500 mt-1.5">
              {amount.trim() === ''
                ? <>Full refund: <span className="text-red-400 tabular-nums font-medium">${fullAmount.toFixed(2)}</span></>
                : isPartial
                  ? <>Partial refund: <span className="text-red-400 tabular-nums font-medium">${refundAmt.toFixed(2)}</span> of ${fullAmount.toFixed(2)} ({Math.round((refundAmt / fullAmount) * 100)}%)</>
                  : <>Full refund: <span className="text-red-400 tabular-nums font-medium">${refundAmt.toFixed(2)}</span></>
              }
            </div>
          </div>

          {/* Stripe reason */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Stripe-side reason (for chargeback protection)</label>
            <select
              value={stripeReason}
              onChange={(e) => setStripeReason(e.target.value)}
              disabled={submitting || !isStripeOrder}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm focus:outline-none focus:border-red-600 disabled:opacity-50"
            >
              <option value="requested_by_customer">Requested by customer</option>
              <option value="duplicate">Duplicate charge</option>
              <option value="fraudulent">Fraudulent</option>
            </select>
          </div>

          {/* Internal reason */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Internal reason (audit log)</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer reported double-charge from old account"
              disabled={submitting || !isStripeOrder}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-red-600 disabled:opacity-50"
            />
          </div>

          {/* Token deduction */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deductCredits}
                onChange={(e) => setDeductCredits(e.target.checked)}
                disabled={submitting || !isStripeOrder}
                className="accent-red-600"
              />
              <span className="text-xs text-white">Also deduct tokens from this user</span>
            </label>
            {deductCredits && (
              <div className="pl-6">
                <input
                  type="number"
                  min="0"
                  value={tokensToDeduct}
                  onChange={(e) => setTokensToDeduct(e.target.value)}
                  disabled={submitting || !isStripeOrder}
                  className="w-32 px-3 py-1.5 bg-zinc-900 border border-zinc-800 text-white rounded-md text-xs focus:outline-none focus:border-red-600 disabled:opacity-50 tabular-nums"
                />
                <span className="text-[11px] text-zinc-500 ml-2">
                  {grantedTokens > 0
                    ? <>Suggested: {amount.trim() === '' ? grantedTokens : Math.ceil((Number(amount) / fullAmount) * grantedTokens)} (full {tierFromSubject || ''} grant {amount.trim() !== '' ? `× ${Math.round((Number(amount) / fullAmount) * 100)}%` : ''})</>
                    : <>Couldn't auto-detect tier from subject</>
                  }
                </span>
                <div className="text-[11px] text-zinc-500 mt-1">
                  Clamped to {">"}= 0 — never makes the user's balance go negative.
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-md px-3 py-2 flex items-start gap-2">
              <WarningCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 rounded-md transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || !isStripeOrder || !reason.trim()}
            className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting
              ? <><ArrowsClockwise size={12} className="animate-spin" /> Refunding…</>
              : <><Receipt size={12} weight="bold" /> Refund ${(amount.trim() === '' ? fullAmount : refundAmt).toFixed(2)}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * OrderDetailDrawer — read-only deep-dive for a single order.
 *
 * Opens when admin clicks the order row (or the "Details" button).
 * Fetches /api/admin/orders/details which joins our DB row with live
 * Stripe data (invoice, payment_intent, charge, payment_method, customer,
 * refunds). Shows everything in a right-side scrollable drawer.
 *
 * Sections:
 *   - Header: orderNo + source badge + status
 *   - Customer summary
 *   - Payment status (Stripe payment_intent / charge.status)
 *   - Payment method (card brand + last4 if available)
 *   - Money summary (paid / refunded / net)
 *   - Refund history (one row per Stripe refund)
 *   - Receipt link (Stripe-hosted)
 *   - Raw JSON expandable for power users
 */
const OrderDetailDrawer = ({ orderNo, onClose, onRefund, onVoid, onRestore }) => {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [showRaw, setShowRaw] = React.useState(false);

  React.useEffect(() => {
    if (!orderNo) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not signed in');
        const r = await fetch(`/api/admin/orders/details?orderNo=${encodeURIComponent(orderNo)}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const d = await r.json();
        if (!cancelled) {
          if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
          setData(d);
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [orderNo]);

  if (!orderNo) return null;

  const order = data?.order;
  const user = data?.user;
  const stripe = data?.stripe;
  const pm = stripe?.payment_method;
  const isStripe = typeof orderNo === 'string' && (orderNo.startsWith('in_') || orderNo.startsWith('cs_'));

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl h-full bg-zinc-900 border-l border-zinc-800 shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 px-5 py-3 flex items-center justify-between z-10">
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-white">Order detail</h3>
            <p className="text-[11px] text-zinc-500 font-mono truncate max-w-[400px]">{orderNo}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-zinc-500 hover:text-white rounded transition-colors">
            <X size={14} weight="bold" />
          </button>
        </div>

        {loading && (
          <div className="px-5 py-12 text-center text-sm text-zinc-400 flex items-center justify-center gap-2">
            <ArrowsClockwise size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {error && !loading && (
          <div className="px-5 py-8 text-center">
            <XCircle size={28} className="text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-300 mb-1">Failed to load detail</p>
            <p className="text-xs text-zinc-500">{error}</p>
          </div>
        )}

        {data && !loading && (
          <div className="p-5 space-y-5">
            {/* Source + status summary */}
            <div className="flex items-center gap-2 flex-wrap text-[11px]">
              <span className={`px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border ${
                isStripe
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                  : 'bg-zinc-700/30 text-zinc-400 border-zinc-700'
              }`}>{isStripe ? 'Stripe' : 'Manual'}</span>
              {order?.refunded_at ? (
                <span className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border bg-red-500/10 text-red-300 border-red-500/30">
                  Refunded {Number(order.refunded_amount) < Number(order.amount) ? '(partial)' : ''}
                </span>
              ) : order?.voided_at ? (
                <span className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border bg-zinc-800/50 text-zinc-500 border-zinc-700">
                  Voided
                </span>
              ) : Number(order?.status) === 1 ? (
                <span className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border bg-emerald-400/10 text-emerald-400 border-emerald-500/20">Paid</span>
              ) : (
                <span className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border bg-amber-400/10 text-amber-400 border-amber-500/20">Pending</span>
              )}
              {stripe?.payment_intent?.status && (
                <span className="px-1.5 py-0.5 rounded uppercase tracking-wider font-semibold border bg-zinc-800 text-zinc-400 border-zinc-700 font-mono">
                  PI: {stripe.payment_intent.status}
                </span>
              )}
            </div>

            {/* Customer */}
            <Section title="Customer">
              {user ? (
                <Row label="Name">{user.name || '—'}</Row>
              ) : null}
              {user ? <Row label="Email">{user.email || '—'}</Row> : null}
              {user ? <Row label="UVERA tier">{user.tier}</Row> : null}
              {user ? <Row label="Tokens balance">{user.credits?.toLocaleString() || 0}</Row> : null}
              {user ? <Row label="User ID"><code className="font-mono text-[10px] text-zinc-400">{user.id}</code></Row> : null}
              {stripe?.customer?.id && stripe.customer.id !== user?.id && (
                <Row label="Stripe customer">
                  <code className="font-mono text-[10px] text-zinc-400">{stripe.customer.id}</code>
                </Row>
              )}
              {stripe?.customer?.email && stripe.customer.email !== user?.email && (
                <Row label="Stripe email">{stripe.customer.email}</Row>
              )}
            </Section>

            {/* Money */}
            <Section title="Money">
              <Row label="Subject">{order?.subject}</Row>
              <Row label="Amount paid">
                <span className="text-emerald-400 tabular-nums">${Number(order?.amount || 0).toFixed(2)}</span>
              </Row>
              {order?.refunded_amount > 0 && (
                <Row label="Refunded">
                  <span className="text-red-300 tabular-nums">−${Number(order.refunded_amount).toFixed(2)}</span>
                </Row>
              )}
              {order?.refunded_amount > 0 && (
                <Row label="Net">
                  <span className="text-white tabular-nums font-medium">
                    ${(Number(order.amount) - Number(order.refunded_amount)).toFixed(2)}
                  </span>
                </Row>
              )}
              {order?.credits_deducted > 0 && (
                <Row label="Credits deducted">
                  <span className="text-amber-300 tabular-nums">−{order.credits_deducted.toLocaleString()} tokens</span>
                </Row>
              )}
              <Row label="Created">{order?.createdAt ? new Date(order.createdAt).toLocaleString() : '—'}</Row>
            </Section>

            {/* Payment method (Stripe only) */}
            {pm && (
              <Section title="Payment method">
                <Row label="Type">{pm.type || '—'}</Row>
                {pm.brand && (
                  <Row label="Card">
                    <span className="uppercase">{pm.brand}</span>
                    {pm.last4 && <span className="ml-1.5 text-zinc-400">· · · · {pm.last4}</span>}
                  </Row>
                )}
                {pm.exp_month && pm.exp_year && (
                  <Row label="Expires">{String(pm.exp_month).padStart(2, '0')} / {pm.exp_year}</Row>
                )}
                {pm.country && <Row label="Country">{pm.country}</Row>}
                {pm.funding && <Row label="Funding">{pm.funding}</Row>}
                {stripe?.receipt_url && (
                  <Row label="Receipt">
                    <a href={stripe.receipt_url} target="_blank" rel="noopener noreferrer"
                       className="text-blue-400 hover:underline inline-flex items-center gap-1">
                      View receipt <ArrowSquareOut size={10} />
                    </a>
                  </Row>
                )}
              </Section>
            )}

            {/* Refund history (Stripe only) */}
            {stripe?.refunds?.length > 0 && (
              <Section title={`Stripe refunds (${stripe.refunds.length})`}>
                <div className="space-y-2">
                  {stripe.refunds.map(rf => (
                    <div key={rf.id} className="bg-zinc-950 border border-zinc-800 rounded-md p-2.5 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-red-300 tabular-nums font-medium">
                          −${(rf.amount / 100).toFixed(2)}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {rf.created ? new Date(rf.created * 1000).toLocaleString() : '—'}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Status: <span className="text-zinc-200">{rf.status}</span>
                      </div>
                      {rf.reason && (
                        <div className="text-[11px] text-zinc-400">
                          Reason: <span className="text-zinc-200">{rf.reason}</span>
                        </div>
                      )}
                      {rf.metadata?.uvera_reason && (
                        <div className="text-[11px] text-zinc-400">
                          UVERA reason: <span className="text-zinc-200">{rf.metadata.uvera_reason}</span>
                        </div>
                      )}
                      <code className="block mt-1 text-[10px] text-zinc-500 font-mono">{rf.id}</code>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Admin actions audit */}
            {(order?.voided_at || order?.refunded_at) && (
              <Section title="Admin actions">
                {order?.voided_at && (
                  <>
                    <Row label="Voided at">{new Date(order.voided_at).toLocaleString()}</Row>
                    {data?.voidedBy?.email && <Row label="Voided by">{data.voidedBy.email}</Row>}
                    {order.voided_reason && <Row label="Reason">{order.voided_reason}</Row>}
                  </>
                )}
                {order?.refunded_at && (
                  <>
                    <Row label="Refunded at">{new Date(order.refunded_at).toLocaleString()}</Row>
                    {data?.refundedBy?.email && <Row label="Refunded by">{data.refundedBy.email}</Row>}
                    {order.refunded_reason && <Row label="Reason">{order.refunded_reason}</Row>}
                    {order.stripe_refund_id && (
                      <Row label="Refund ID">
                        <code className="font-mono text-[10px] text-zinc-400">{order.stripe_refund_id}</code>
                      </Row>
                    )}
                  </>
                )}
              </Section>
            )}

            {/* Inline actions — refund / void / restore.
                Lets admin act on the order without closing the drawer.
                Same gating as the row-level buttons:
                  - Refund: only stripe + paid + not-already-refunded + not-voided
                  - Void: not-already-refunded
                  - Restore: only when currently voided                            */}
            <div className="grid grid-cols-2 gap-2">
              {isStripe && order && Number(order.status) === 1 && !order.refunded_at && !order.voided_at && onRefund && (
                <button
                  onClick={() => { onRefund(order); onClose(); }}
                  className="px-3 py-2 text-xs font-medium bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Receipt size={12} weight="bold" /> Refund payment
                </button>
              )}
              {!order?.refunded_at && !order?.voided_at && onVoid && (
                <button
                  onClick={() => { onVoid(order); onClose(); }}
                  className="px-3 py-2 text-xs font-medium bg-zinc-600/20 hover:bg-zinc-600/40 text-zinc-200 border border-zinc-600/40 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                >
                  <Prohibit size={12} weight="bold" /> Void order
                </button>
              )}
              {order?.voided_at && onRestore && (
                <button
                  onClick={() => { onRestore(order); onClose(); }}
                  className="px-3 py-2 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40 rounded-lg transition-colors flex items-center justify-center gap-1.5 col-span-2"
                >
                  <ArrowCounterClockwise size={12} weight="bold" /> Restore voided order
                </button>
              )}
            </div>

            {/* Stripe Dashboard link.
                URL strategy: in_xxx invoices have a working /invoices/ deep
                link; cs_xxx Checkout Sessions DO NOT — /payments/ expects a
                pi_xxx PaymentIntent ID, not a session ID. We use Stripe's
                universal /search which redirects cs_ → the correct PI page.
                (Permanent fix is storing payment_intent_id alongside session.id
                in the orders row — pending stripe_payment_intent_id column.) */}
            {isStripe && (
              <a
                href={
                  orderNo.startsWith('in_')
                    ? `https://dashboard.stripe.com/invoices/${orderNo}`
                    : `https://dashboard.stripe.com/search?query=${encodeURIComponent(orderNo)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center px-4 py-2.5 bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 border border-indigo-500/30 rounded-lg text-sm font-medium transition-colors"
              >
                Open in Stripe Dashboard →
              </a>
            )}

            {/* Raw JSON */}
            <div>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showRaw ? '▼' : '▶'} Raw Stripe data (for debugging)
              </button>
              {showRaw && (
                <pre className="mt-2 p-3 bg-zinc-950 border border-zinc-800 rounded-md text-[10px] text-zinc-400 overflow-auto max-h-[400px] font-mono">
                  {JSON.stringify(stripe, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* Tiny helper components for OrderDetailDrawer's repetitive sections */
const Section = ({ title, children }) => (
  <div>
    <h4 className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 mb-2">{title}</h4>
    <div className="space-y-1.5 text-xs">{children}</div>
  </div>
);
const Row = ({ label, children }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-zinc-500 flex-shrink-0">{label}</span>
    <span className="text-zinc-200 text-right min-w-0 break-words">{children}</span>
  </div>
);

/**
 * Stripe reconciliation modal — cross-references Stripe (last N days) with
 * the orders table and surfaces paid charges that never made it into our DB.
 * One-click "Import" per row calls /api/admin/stripe/reconcile/import which
 * INSERTs the orders row + grants credits + emails a receipt, idempotent.
 *
 * Why it exists: Stripe webhook delivery isn't 100% reliable — signing
 * secret rotation, CF Worker cold-start 503s, FK violations, missing event
 * subscriptions can all swallow a real payment. This is the safety net.
 */
const ReconcileModal = ({ open, onClose, onImported }) => {
  const [days, setDays] = React.useState(30);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState(null);   // { missingOneTime, missingInvoices, summary }
  const [error, setError] = React.useState(null);
  const [importingId, setImportingId] = React.useState(null);
  const [importResults, setImportResults] = React.useState({});  // { [id]: { success, message } }

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch(`/api/admin/stripe/reconcile?days=${days}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setData(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  React.useEffect(() => {
    if (open) {
      setImportResults({});
      load();
    }
  }, [open, load]);

  const handleImport = async (id) => {
    setImportingId(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/stripe/reconcile/import', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setImportResults(prev => ({
        ...prev,
        [id]: {
          success: true,
          message: d.alreadyExisted
            ? 'Already in DB'
            : `+${d.creditsGranted} tokens, balance ${d.newBalance.toLocaleString()}`,
        },
      }));
      if (onImported) onImported();
    } catch (e) {
      setImportResults(prev => ({ ...prev, [id]: { success: false, message: e.message } }));
    } finally {
      setImportingId(null);
    }
  };

  const handleImportAll = async () => {
    if (!data) return;
    const all = [...(data.missingOneTime || []), ...(data.missingInvoices || [])];
    const remaining = all.filter(item => !importResults[item.id]?.success);
    if (remaining.length === 0) return;
    if (!window.confirm(`Import all ${remaining.length} missing orders? Each will grant tokens and email the user. Idempotent — safe to re-run if interrupted.`)) return;
    for (const item of remaining) {
      // Sequential to keep Stripe API rate limits + audit logs ordered
      // eslint-disable-next-line no-await-in-loop
      await handleImport(item.id);
    }
  };

  if (!open) return null;

  const all = data ? [...(data.missingOneTime || []), ...(data.missingInvoices || [])] : [];
  const importedCount = Object.values(importResults).filter(r => r.success).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4 pt-8">
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-5xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <ArrowsClockwise size={16} weight="bold" className="text-indigo-400" />
              Reconcile with Stripe
            </h2>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              Find paid Stripe payments not yet in this database, then one-click import.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Controls */}
        <div className="px-5 py-3 border-b border-zinc-900 flex items-center gap-3 flex-wrap">
          <label className="text-[11px] text-zinc-500">Look back:</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            disabled={loading}
            className="px-2.5 py-1 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-md disabled:opacity-50"
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days (max)</option>
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="px-2.5 py-1 text-xs bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-md disabled:opacity-50 flex items-center gap-1"
          >
            <ArrowsClockwise size={11} /> Reload
          </button>
          {data && all.length > 0 && (
            <button
              onClick={handleImportAll}
              disabled={loading || importingId !== null}
              className="ml-auto px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-md disabled:opacity-50 flex items-center gap-1"
            >
              <DownloadSimple size={11} weight="bold" />
              Import all {importedCount > 0 ? `(${all.length - importedCount} left)` : `(${all.length})`}
            </button>
          )}
        </div>

        {/* Summary */}
        {data && (
          <div className="px-5 py-3 border-b border-zinc-900 grid grid-cols-4 gap-3 text-center">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Stripe one-time</div>
              <div className="text-lg font-semibold text-white">{data.summary.stripeOneTime}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Stripe invoices</div>
              <div className="text-lg font-semibold text-white">{data.summary.stripeInvoices}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Matched in DB</div>
              <div className="text-lg font-semibold text-emerald-400">{data.summary.dbMatched}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Missing</div>
              <div className={`text-lg font-semibold ${data.summary.missingTotal > 0 ? 'text-amber-400' : 'text-zinc-500'}`}>
                {data.summary.missingTotal}
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-5 py-4 max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="text-zinc-400 text-sm py-8 text-center">Scanning Stripe (last {days} days)…</div>
          )}
          {error && (
            <div className="bg-red-950/40 border border-red-900 rounded-md p-3 text-xs text-red-300">
              Failed: {error}
            </div>
          )}
          {!loading && !error && data && all.length === 0 && (
            <div className="text-center py-8">
              <CheckCircle size={32} className="mx-auto text-emerald-500 mb-3" />
              <p className="text-sm text-zinc-300">All caught up.</p>
              <p className="text-[11px] text-zinc-500 mt-1">
                No paid Stripe charges in the last {days} days are missing from this database.
              </p>
            </div>
          )}
          {!loading && !error && data && all.length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-900">
                  <th className="text-left px-2 py-2">Date</th>
                  <th className="text-left px-2 py-2">Type</th>
                  <th className="text-left px-2 py-2">ID</th>
                  <th className="text-right px-2 py-2">Amount</th>
                  <th className="text-left px-2 py-2">Customer</th>
                  <th className="text-right px-2 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {all.map(item => {
                  const result = importResults[item.id];
                  const isImporting = importingId === item.id;
                  const isImported = result?.success;
                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-zinc-900 ${isImported ? 'opacity-50' : ''}`}
                    >
                      <td className="px-2 py-2 text-zinc-400 whitespace-nowrap">
                        {new Date(item.created * 1000).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2">
                        {item.type === 'checkout_session' ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/15 text-blue-300 rounded uppercase">one-time</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-500/15 text-violet-300 rounded uppercase">sub</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-zinc-500 font-mono text-[10px]" title={item.id}>
                        {item.id.slice(0, 24)}…
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-emerald-400">
                        ${item.amount.toFixed(2)}
                      </td>
                      <td className="px-2 py-2 text-zinc-300">
                        {item.customerName || item.customerEmail || (
                          <span className="text-zinc-600 italic">unknown</span>
                        )}
                        {item.customerEmail && item.customerName && (
                          <div className="text-[10px] text-zinc-500">{item.customerEmail}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {isImported ? (
                          <span className="text-emerald-400 text-[10px] flex items-center justify-end gap-1">
                            <CheckCircle size={11} weight="bold" /> {result.message}
                          </span>
                        ) : result && !result.success ? (
                          <button
                            onClick={() => handleImport(item.id)}
                            disabled={isImporting || importingId !== null}
                            className="px-2 py-1 text-[10px] font-medium bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 rounded transition-colors"
                            title={result.message}
                          >
                            Retry
                          </button>
                        ) : (
                          <button
                            onClick={() => handleImport(item.id)}
                            disabled={isImporting || importingId !== null}
                            className="px-2 py-1 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded disabled:opacity-50"
                          >
                            {isImporting ? 'Importing…' : 'Import'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {/* Per-row error details (shown below each table when retrying) */}
          {!loading && !error && data && all.some(i => importResults[i.id] && !importResults[i.id].success) && (
            <div className="mt-3 space-y-1">
              {all.filter(i => importResults[i.id] && !importResults[i.id].success).map(i => (
                <div key={`err-${i.id}`} className="text-[10px] text-red-400 font-mono">
                  <span className="text-zinc-500">{i.id.slice(0, 16)}…</span> — {importResults[i.id].message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-800 flex justify-between items-center">
          <p className="text-[10px] text-zinc-500">
            Idempotent — already-imported orders are skipped. Receipt emails are sent on first import.
          </p>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Payments & Orders — backed by /api/admin/orders/list, which enriches
 * each row with the payer's email/name so admins don't have to translate
 * UUIDs by hand. Stripe-sourced orders (orderNo starts with `in_`) get
 * a one-click "Open in Stripe Dashboard" button for cross-system audit.
 *
 * Filters (all server-side):
 *   - Search: orderNo, subject, or payer email (substring, case-insensitive)
 *   - Status: paid / pending / all
 *   - Date range: 7d / 30d / 90d / all
 *   - Voided: hidden by default; toggle to show them
 *
 * Soft-delete: replaces the legacy hard-delete (which destroyed audit
 * trail). Voided rows persist with `voided_at`/`voided_by`/`voided_reason`
 * — restorable, and excluded from KPIs.
 */
const OrdersView = ({ onTotalsChange, onDataChanged }) => {
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [dateFrom, setDateFrom] = React.useState('');   // 指定起始日期 yyyy-mm-dd
  const [dateTo, setDateTo] = React.useState('');       // 指定结束日期 yyyy-mm-dd
  const [showVoided, setShowVoided] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [perPage] = React.useState(50);
  const [total, setTotal] = React.useState(0);
  const [acting, setActing] = React.useState(null);
  const [refundOrder, setRefundOrder] = React.useState(null);
  const [detailOrderNo, setDetailOrderNo] = React.useState(null);
  const [showReconcile, setShowReconcile] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  // §2026-06-02 甲方需求 — 改成指定日期范围(本地时区:起 00:00:00 / 止 23:59:59.999,含两端)。
  const dateRange = () => ({
    from: dateFrom ? new Date(dateFrom + 'T00:00:00').toISOString() : null,
    to:   dateTo   ? new Date(dateTo   + 'T23:59:59.999').toISOString() : null,
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');

      const { from, to } = dateRange();
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (showVoided) params.set('voided', 'include');
      params.set('page', String(page));
      params.set('perPage', String(perPage));

      const r = await fetch(`/api/admin/orders/list?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      setItems(data.orders || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // §2026-06-02 甲方需求 — 导出 Excel(CSV + UTF-8 BOM,Excel 双击直开)。
  //   按"当前筛选条件"(search / status / date / showVoided)循环翻页拉全部
  //   匹配订单,而不只是当前页 50 条。纯调已有只读接口,不动后端。
  const exportOrders = async () => {
    setExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const { from, to } = dateRange();
      const EXPORT_PER_PAGE = 200;
      let pageN = 1, all = [], grandTotal = Infinity;
      while (all.length < grandTotal) {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
        if (showVoided) params.set('voided', 'include');
        params.set('page', String(pageN));
        params.set('perPage', String(EXPORT_PER_PAGE));
        const r = await fetch(`/api/admin/orders/list?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
        const batch = data.orders || [];
        all.push(...batch);
        grandTotal = data.total || all.length;
        if (batch.length === 0 || pageN > 500) break;   // 安全阀:无更多 / 硬上限
        pageN++;
      }

      const statusLabel = (o) =>
        o.voided_at ? 'Voided'
        : (o.refunded_at || o.refunded_amount) ? (Number(o.refunded_amount) < Number(o.amount) ? 'Refunded (partial)' : 'Refunded')
        : Number(o.status) === 1 ? 'Paid'
        : 'Pending';
      const fmtDate = (v) => v ? new Date(v).toLocaleString() : '';
      const columns = [
        { key: 'orderNo',          label: 'Order No' },
        { key: 'createdAt',        label: 'Date',           format: fmtDate },
        { key: 'userName',         label: 'Payer Name' },
        { key: 'userEmail',        label: 'Payer Email' },
        { key: 'userId',           label: 'User ID' },
        { key: 'subject',          label: 'Subject / Plan' },
        { key: 'amount',           label: 'Amount (USD)',    format: (v) => Number(v || 0).toFixed(2) },
        { key: '_status',          label: 'Status',          format: (_, o) => statusLabel(o) },
        { key: 'source',           label: 'Source' },
        { key: 'refunded_amount',  label: 'Refunded (USD)',  format: (v) => (v != null && v !== '') ? Number(v).toFixed(2) : '' },
        { key: 'refunded_at',      label: 'Refunded At',     format: fmtDate },
        { key: 'refunded_reason',  label: 'Refund Reason' },
        { key: 'refundedByEmail',  label: 'Refunded By' },
        { key: 'voided_at',        label: 'Voided At',       format: fmtDate },
        { key: 'voided_reason',    label: 'Void Reason' },
        { key: 'voidedByEmail',    label: 'Voided By' },
        { key: 'credits_deducted', label: 'Tokens Deducted' },
      ];
      const escapeCell = (v) => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        columns.map(c => escapeCell(c.label)).join(','),
        ...all.map(row => columns.map(c => escapeCell(c.format ? c.format(row[c.key], row) : row[c.key])).join(',')),
      ];
      const csv = '﻿' + lines.join('\r\n');  // BOM → Excel UTF-8 正确识别中文
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      a.download = `uvera_orders_${ts}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('导出失败: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  // Reload when filters change (debounce search)
  React.useEffect(() => {
    const t = setTimeout(load, search ? 350 : 0);
    return () => clearTimeout(t);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [search, statusFilter, dateFrom, dateTo, showVoided, page]);

  // Reset to page 1 when filters change (but not when page itself changes)
  React.useEffect(() => { setPage(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, statusFilter, dateFrom, dateTo, showVoided]);

  // Visible (non-voided) totals — computed from the current page's data
  const totals = React.useMemo(() => {
    const active = items.filter(o => !o.voided_at);
    const paid = active.filter(o => Number(o.status) === 1);
    return {
      visibleCount: items.length,
      activeCount: active.length,
      voidedCount: items.length - active.length,
      paidSum: paid.reduce((s, o) => s + Number(o.amount || 0), 0),
    };
  }, [items]);

  React.useEffect(() => {
    if (onTotalsChange) onTotalsChange(totals);
  }, [totals, onTotalsChange]);

  const handleVoid = async (order) => {
    if (order.voided_at) {
      // Unvoid path — just confirm
      if (!window.confirm(`Restore order ${order.orderNo}?\n\nIt will be re-counted in revenue and KPIs.`)) return;
      setActing(order.orderNo);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const r = await fetch('/api/admin/orders/void', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderNo: order.orderNo, void: false })
        });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
        load();
      } catch (e) {
        alert(`Restore failed: ${e.message}`);
      } finally {
        setActing(null);
      }
      return;
    }
    // Void path — require reason
    const reason = window.prompt(
      `Void order ${order.orderNo}?\n\nThis is a soft-delete: the row stays in the database (audit trail) but is excluded from revenue and KPIs.\n\nReason (required, e.g. "test charge", "duplicate", "refunded out-of-band"):`
    );
    if (reason === null) return;
    if (!reason.trim()) { alert('A reason is required.'); return; }
    setActing(order.orderNo);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/orders/void', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNo: order.orderNo, void: true, reason: reason.trim() })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.errMessage || `HTTP ${r.status}`);
      load();
    } catch (e) {
      alert(`Void failed: ${e.message}`);
    } finally {
      setActing(null);
    }
  };

  const STATUS_FILTERS = [
    { id: 'all',      label: 'All' },
    { id: 'paid',     label: 'Paid' },
    { id: 'pending',  label: 'Pending' },
    { id: 'refunded', label: 'Refunded' },
  ];

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 bg-zinc-950 border border-zinc-900 rounded-xl p-3">
        <div className="relative">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search orderNo / subject / email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 text-white rounded-md placeholder:text-zinc-500 focus:outline-none focus:border-blue-600 w-72"
          />
        </div>
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                statusFilter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* 指定日期范围:yyyy-mm-dd 至 yyyy-mm-dd(按 createdAt,含两端)*/}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-md focus:outline-none focus:border-blue-600 [color-scheme:dark] cursor-pointer"
            title="起始日期"
          />
          <span className="text-zinc-500 text-xs">至</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-md focus:outline-none focus:border-blue-600 [color-scheme:dark] cursor-pointer"
            title="结束日期"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-zinc-500 hover:text-white cursor-pointer p-0.5"
              title="清除日期"
              aria-label="清除日期"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <label className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={showVoided}
            onChange={(e) => setShowVoided(e.target.checked)}
            className="accent-blue-600"
          />
          Show voided
        </label>
        <button
          onClick={() => setShowReconcile(true)}
          className="ml-auto px-3 py-1 text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-600/40 rounded-md transition-colors flex items-center gap-1"
          title="Find Stripe payments missing from this list and one-click import them"
        >
          <ArrowsClockwise size={12} /> Reconcile w/ Stripe
        </button>
        <button
          onClick={exportOrders}
          disabled={exporting}
          className="px-3 py-1 text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-600/40 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="按当前筛选条件导出全部订单为 Excel(CSV/UTF-8)"
        >
          {exporting
            ? <><CircleNotch size={12} className="animate-spin" /> 导出中…</>
            : <><DownloadSimple size={12} /> 导出 Excel</>}
        </button>
        <button
          onClick={load}
          className="px-3 py-1 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 rounded-md transition-colors flex items-center gap-1 cursor-pointer"
        >
          <ArrowsClockwise size={12} /> Refresh
        </button>
      </div>

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading orders…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}
      {!loading && !error && items.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <CreditCard size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No orders match these filters.</p>
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Payer</th>
                  <th className="px-3 py-2 font-medium">Subject</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {items.map(o => {
                  const isVoided   = !!o.voided_at;
                  const isRefunded = !!o.refunded_at;
                  const isActing   = acting === o.orderNo;
                  return (
                    <tr key={o.orderNo} className={`hover:bg-zinc-800/30 transition-colors ${(isVoided || isRefunded) ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setDetailOrderNo(o.orderNo)}
                          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity cursor-pointer"
                          title="Open order detail"
                        >
                          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${
                            o.source === 'stripe'
                              ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                              : 'bg-zinc-700/30 text-zinc-400 border border-zinc-700'
                          }`}>
                            {o.source === 'stripe' ? 'Stripe' : 'Manual'}
                          </span>
                          <span className="font-mono text-zinc-300 hover:text-white text-[11px] truncate max-w-[180px] underline-offset-2 hover:underline" title={o.orderNo}>
                            {o.orderNo}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        {o.userEmail ? (
                          <div className="flex items-center gap-2">
                            {o.userAvatar ? (
                              <img src={o.userAvatar} alt="" className="w-6 h-6 rounded-full bg-zinc-800 flex-shrink-0" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 flex-shrink-0">
                                <Users size={10} />
                              </div>
                            )}
                            <div className="min-w-0">
                              {o.userName && <div className="text-white truncate max-w-[160px]" title={o.userName}>{o.userName}</div>}
                              <div className="text-zinc-500 truncate max-w-[160px]" title={o.userEmail}>{o.userEmail}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="font-mono text-zinc-600 text-[11px] truncate" title={o.userId}>
                            {o.userId ? o.userId.substring(0, 8) + '…' : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-white truncate max-w-[200px]" title={o.subject}>{o.subject}</td>
                      <td className="px-3 py-2 text-emerald-400 text-right tabular-nums font-medium">${Number(o.amount || 0).toFixed(2)}</td>
                      <td className="px-3 py-2">
                        {isVoided ? (
                          <span className="text-zinc-500 text-[10px] px-1.5 py-0.5 bg-zinc-800/50 rounded uppercase tracking-wider font-semibold border border-zinc-700" title={`Voided ${new Date(o.voided_at).toLocaleString()}${o.voidedByEmail ? ' by ' + o.voidedByEmail : ''}${o.voided_reason ? ': ' + o.voided_reason : ''}`}>
                            Voided
                          </span>
                        ) : isRefunded ? (
                          <span
                            className="text-red-300 text-[10px] px-1.5 py-0.5 bg-red-500/10 rounded uppercase tracking-wider font-semibold border border-red-500/30"
                            title={`Refunded $${Number(o.refunded_amount || 0).toFixed(2)} on ${new Date(o.refunded_at).toLocaleString()}${o.refundedByEmail ? ' by ' + o.refundedByEmail : ''}${o.refunded_reason ? ': ' + o.refunded_reason : ''}${o.credits_deducted ? ' · ' + o.credits_deducted + ' tokens deducted' : ''}`}
                          >
                            Refunded {Number(o.refunded_amount) < Number(o.amount) ? '(partial)' : ''}
                          </span>
                        ) : Number(o.status) === 1 ? (
                          <span className="text-emerald-400 text-[10px] px-1.5 py-0.5 bg-emerald-400/10 rounded uppercase tracking-wider font-semibold border border-emerald-500/20">Paid</span>
                        ) : (
                          <span className="text-amber-400 text-[10px] px-1.5 py-0.5 bg-amber-400/10 rounded uppercase tracking-wider font-semibold border border-amber-500/20">Pending</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-zinc-400" title={o.createdAt}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {o.source === 'stripe' && (
                            <a
                              // Same logic as OrderDetailDrawer: cs_xxx sessions
                              // route via /search (resolves to underlying PI);
                              // in_xxx invoices have a working direct /invoices/ link.
                              href={
                                typeof o.orderNo === 'string' && o.orderNo.startsWith('in_')
                                  ? `https://dashboard.stripe.com/invoices/${o.orderNo}`
                                  : `https://dashboard.stripe.com/search?query=${encodeURIComponent(o.orderNo || '')}`
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 rounded text-[10px] font-medium bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 transition-colors flex items-center gap-1"
                              title="Open in Stripe Dashboard"
                            >
                              <ArrowSquareOut size={10} weight="bold" /> Stripe
                            </a>
                          )}
                          {/* Refund: only for stripe-sourced, paid, not-already-refunded, not-voided rows */}
                          {o.source === 'stripe' && Number(o.status) === 1 && !isRefunded && !isVoided && (
                            <button
                              onClick={() => setRefundOrder(o)}
                              disabled={isActing}
                              className="px-2 py-1 rounded text-[10px] font-medium bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                              title="Issue a Stripe refund for this payment"
                            >
                              <Receipt size={10} weight="bold" /> Refund
                            </button>
                          )}
                          <button
                            onClick={() => handleVoid(o)}
                            disabled={isActing || isRefunded}
                            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 ${
                              isVoided
                                ? 'bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-600/40'
                                : 'bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-600/40'
                            }`}
                            title={
                              isRefunded ? 'Refunded orders cannot be voided (refund is the source of truth)' :
                              isVoided ? 'Restore this order (re-count in KPIs)' :
                              'Void this order (soft-delete with audit trail — does NOT touch Stripe)'
                            }
                          >
                            {isVoided ? <><ArrowCounterClockwise size={10} weight="bold" /> Restore</> : <><Prohibit size={10} weight="bold" /> Void</>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-950 border-t border-zinc-800">
                <tr>
                  <td colSpan="3" className="px-3 py-2 text-[11px] text-zinc-500">
                    Showing {items.length} of {total} · {totals.activeCount} active, {totals.voidedCount} voided on this page
                  </td>
                  <td className="px-3 py-2 text-emerald-400 text-right tabular-nums font-medium text-xs">${totals.paidSum.toFixed(2)}</td>
                  <td colSpan="3" className="px-3 py-2 text-[11px] text-zinc-500">
                    paid this page
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-zinc-950 border-t border-zinc-800 px-4 py-2 flex items-center justify-between text-[11px] text-zinc-500">
              <div>Page {page} of {totalPages}</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                  className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  ‹ Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                  className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Refund modal ──────────────────────────────────────────────── */}
      {refundOrder && (
        <RefundModal
          order={refundOrder}
          onClose={() => setRefundOrder(null)}
          onDone={() => load()}
        />
      )}

      {/* ─── Order detail drawer ─────────────────────────────────────────
          Opens when admin clicks the order's first column (source badge +
          orderNo). Fetches deep Stripe data via /api/admin/orders/details
          so we can show payment method, refund history, receipt URL, full
          status, and raw JSON for debugging — all without leaving admin.
          Inline action buttons (Refund / Void / Restore) trigger the same
          handlers used by the row-level buttons so the flow is unified. */}
      {detailOrderNo && (
        <OrderDetailDrawer
          orderNo={detailOrderNo}
          onClose={() => setDetailOrderNo(null)}
          onRefund={(order) => setRefundOrder(order)}
          onVoid={(order) => handleVoid(order)}
          onRestore={(order) => handleVoid(order)}
        />
      )}

      {/* ─── Stripe reconcile modal ──────────────────────────────────────
          Cross-references Stripe with this list to find paid charges that
          our webhook missed. One-click import per row + bulk import all.
          On close: reloads OrdersView table AND notifies parent so the
          top KPI cards (Total Revenue / MRR / Active Subscribers) update. */}
      <ReconcileModal
        open={showReconcile}
        onClose={() => {
          setShowReconcile(false);
          load();
          if (onDataChanged) onDataChanged();
        }}
        onImported={() => { /* batched refresh on modal close */ }}
      />
    </div>
  );
};

const CloudflareStreamUploader = () => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [error, setError] = useState(null);

  const startUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setProgress(10); // Requesting ticket
    setError(null);
    setUploadResult(null);

    try {
      // Step 1: Request Direct Creator Upload URL from our secure worker proxy
      const workerDomain = '/api';
      const ticketRes = await fetch(`${workerDomain}/stream/direct_upload`, {
        method: 'POST',
      });
      
      const ticketData = await ticketRes.json();
      if (!ticketData.success || !ticketData.result || !ticketData.result.uploadURL) {
        throw new Error('Failed to obtain secure Stream upload ticket');
      }

      const { uploadURL, uid } = ticketData.result;
      setProgress(30);

      // Step 2: Push the raw file to Cloudflare directly via XMLHttpRequest for progress events
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = 30 + Math.round((event.loaded / event.total) * 60);
            setProgress(percentComplete);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            setUploadResult(uid);
            resolve();
          } else {
            reject(new Error(`Upload failed with status: ${xhr.status}`));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload'));

        xhr.open('POST', uploadURL, true);
        const formData = new FormData();
        formData.append('file', file);
        xhr.send(formData);
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
      setFile(null); // reset file input visually
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 mb-8 text-white relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-1 bg-zinc-800">
        <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
      </div>
      
      <div className="flex items-center gap-4 mb-4">
        <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
          <UploadSimple size={24} weight="bold" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Upload to Cloudflare Stream</h3>
          <p className="text-sm text-zinc-400">Directly bypass server limits for large video files</p>
        </div>
      </div>

      <div className="flex items-end gap-4 mt-6">
        <div className="flex-1">
          <label className="block text-xs font-medium text-zinc-400 mb-2">Select Video (.mp4, .mov)</label>
          <input
            type="file"
            accept="video/*"
            onChange={e => setFile(e.target.files[0])}
            disabled={isUploading}
            className="block w-full text-sm text-zinc-400
              file:mr-4 file:py-2.5 file:px-4
              file:rounded-lg file:border-0
              file:text-sm file:font-semibold
              file:bg-zinc-800 file:text-white
              hover:file:bg-zinc-700
              focus:outline-none cursor-pointer"
          />
        </div>
        <button
          onClick={startUpload}
          disabled={!file || isUploading}
          className="px-6 py-2.5 h-[42px] bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-lg transition-colors flex items-center justify-center min-w-[120px] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUploading ? 'Uploading...' : 'Start Upload'}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg flex items-center gap-2">
          <WarningCircle size={16} />
          {error}
        </div>
      )}
      
      {uploadResult && (
        <div className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-emerald-400 font-semibold text-sm flex items-center gap-2">
              <CheckCircle size={16} weight="fill" /> Upload Successful
            </span>
          </div>
          <div className="flex flex-col gap-2 font-mono text-xs">
            <div className="flex justify-between items-center bg-black/30 p-2 rounded">
              <span className="text-zinc-500">Stream UID</span>
              <span className="text-white select-all">{uploadResult}</span>
            </div>
            <div className="flex justify-between items-center bg-black/30 p-2 rounded">
              <span className="text-zinc-500">Iframe HLS URL</span>
              <span className="text-white select-all text-right max-w-full overflow-hidden text-ellipsis truncate ml-4">
                https://iframe.videodelivery.net/{uploadResult}
              </span>
            </div>
          </div>
          <div className="mt-4 rounded-xl overflow-hidden aspect-video bg-black max-w-lg mx-auto border border-zinc-800">
            {/* §2026-05-29 Leon round-102 — 迁移到 VideoPlayer composite。
             * kind="admin-preview" 自带 customControls + loadingOverlay +
             * showQualitySelector + autoPlay + allowDownload + showAutoplay=false
             * (loop 按钮隐藏,upload preview 单视频不需 loop)。 */}
            <VideoPlayer
              kind="admin-preview"
              src={`https://videodelivery.net/${uploadResult}/manifest/video.m3u8`}
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
};

const WorksView = ({ works, onDelete, onTogglePublish }) => {
  const [filter, setFilter] = useState('All');                 // All | Image | Video
  const [statusFilter, setStatusFilter] = useState('all');     // all | published | draft
  const [search, setSearch] = useState('');                    // 模糊搜索:标题 / 用户 / ID
  const [dateFrom, setDateFrom] = useState('');                // 创建时间范围起 yyyy-mm-dd
  const [dateTo, setDateTo] = useState('');                    // 创建时间范围止 yyyy-mm-dd
  const [viewMode, setViewMode] = useState('grid');            // grid 缩略图模式 | list 文件列表模式
  const [playingVideo, setPlayingVideo] = useState(null);

  // §2026-06-02 甲方需求 — 媒体列表模糊搜索 + 过滤(类型 / 状态 / 创建时间范围)。
  const q = search.trim().toLowerCase();
  // 本地时区边界:起 = 当天 00:00:00,止 = 当天 23:59:59.999(含两端)。
  const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() : null;
  const toTs   = dateTo   ? new Date(dateTo   + 'T23:59:59.999').getTime() : null;
  const filteredWorks = works.filter(item => {
    if (filter !== 'All' && item.category !== filter) return false;
    if (statusFilter !== 'all') {
      const isPub = item.status === 'published';
      if (statusFilter === 'published' && !isPub) return false;
      if (statusFilter === 'draft' && isPub) return false;
    }
    if (q) {
      const hay = `${item.title || ''} ${item.artist || ''} ${item.displayName || ''} ${item.userId || ''} ${item.id || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (fromTs != null || toTs != null) {
      const t = item.createdAt ? new Date(item.createdAt).getTime() : NaN;
      if (Number.isNaN(t)) return false;          // 无创建时间的,时间过滤生效时排除
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
    }
    return true;
  });
  const pagination = useAdminPagination(filteredWorks, 50);
  // 搜索/过滤变更回第 1 页(分页 hook 只在越界时回,这里显式回更直觉)。
  React.useEffect(() => { pagination.setPage(1); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, filter, statusFilter, dateFrom, dateTo]);

  return (
    <div>
      <CloudflareStreamUploader />
      
      <div className="flex items-center gap-1.5 mb-6 mt-4">
        {/* 类型过滤 */}
        <div className="flex shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {['All', 'Image', 'Video'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${filter === f ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
            >
              {f === 'All' ? 'All Works' : f + 's'}
            </button>
          ))}
        </div>
        {/* 状态过滤 */}
        <div className="flex shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {[{ id: 'all', label: 'All Status' }, { id: 'published', label: 'Published' }, { id: 'draft', label: 'Draft' }].map(s => (
            <button
              key={s.id}
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors cursor-pointer ${statusFilter === s.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        {/* 模糊搜索:标题 / 用户 / ID */}
        <div className="relative flex-1 min-w-[80px]">
          <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索标题 / 用户 / ID…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-8 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer"
              aria-label="清除搜索"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 创建时间范围过滤:yyyy-mm-dd 至 yyyy-mm-dd(按 createdAt,含两端)*/}
        <div className="flex shrink-0 items-center gap-1.5">
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={e => setDateFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 [color-scheme:dark] cursor-pointer"
            title="创建时间起"
          />
          <span className="text-zinc-500 text-sm">至</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={e => setDateTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 [color-scheme:dark] cursor-pointer"
            title="创建时间止"
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="text-zinc-500 hover:text-white cursor-pointer p-1"
              aria-label="清除时间范围"
              title="清除时间范围"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {/* 视图模式切换:缩略图 / 文件列表 */}
        <div className="flex shrink-0 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {[{ id: 'grid', label: '缩略图', Icon: SquaresFour }, { id: 'list', label: '文件列表', Icon: Rows }].map(v => (
            <button
              key={v.id}
              onClick={() => setViewMode(v.id)}
              className={`flex items-center justify-center px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${viewMode === v.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
              title={v.label + '模式'}
              aria-label={v.label + '模式'}
            >
              <v.Icon size={18} weight={viewMode === v.id ? 'fill' : 'regular'} />
            </button>
          ))}
        </div>
        {/* 结果计数 */}
        <span className="shrink-0 text-xs text-zinc-500 whitespace-nowrap tabular-nums">{filteredWorks.length} / {works.length}</span>
      </div>
      
      {filteredWorks.length === 0 ? (
        <div className="py-12 text-center text-zinc-500">
          No works match the current search / filter.
        </div>
      ) : viewMode === 'grid' ? (
      /* ─── 缩略图模式 ─── */
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {pagination.pageItems.map((item, idx) => (
        <div key={item.id || idx} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group">
          <div 
            className={`aspect-video bg-zinc-800 relative ${item.category === 'Video' ? 'cursor-pointer' : ''}`}
            onClick={() => {
              if (item.category === 'Video' && item.videoUrl) {
                setPlayingVideo(item.videoUrl);
              }
            }}
          >
            <img src={item.cover} alt={item.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
            <div className="absolute top-2 right-2 flex gap-2">
              <span className="px-2 py-1 bg-black/50 backdrop-blur-md rounded text-[10px] font-bold text-white uppercase tracking-wider">{item.category || item.type}</span>
            </div>
            {item.category === 'Video' && (
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                <div className="w-12 h-12 bg-blue-600/90 rounded-full flex items-center justify-center backdrop-blur-sm text-white shadow-lg">
                  <PlayCircle size={28} weight="fill" />
                </div>
              </div>
            )}
          </div>
          <div className="p-4 flex flex-col justify-between">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0 flex-1">
                <h4 className="text-white font-medium truncate mb-1">{item.title || 'Untitled Work'}</h4>
                <p className="text-zinc-400 text-sm truncate">{item.artist || 'Unknown User'}</p>
                <div className="flex mt-2 justify-between items-center text-xs">
                  <span className={`px-2 py-0.5 rounded ${item.status === 'published' ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-500/10 text-zinc-400'}`}>
                    {item.status === 'published' ? 'Published' : 'Draft'}
                  </span>
                  <span className="text-zinc-600">{new Date(item.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
              {onDelete && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                  className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors flex-shrink-0 mt-1"
                  title={`Delete ${item.category || 'Work'}`}
                >
                  <Trash size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      </div>
      ) : (
      /* ─── 文件列表模式 = 完整表格(§2026-06-10 甲方需求)─── */
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-xs border-b border-zinc-800">
            <tr className="text-left">
              <th className="px-3 py-2.5 font-medium w-20">封面</th>
              <th className="px-3 py-2.5 font-medium">作品ID</th>
              <th className="px-3 py-2.5 font-medium">名称</th>
              <th className="px-3 py-2.5 font-medium">创建者</th>
              <th className="px-3 py-2.5 font-medium">类型</th>
              <th className="px-3 py-2.5 font-medium">状态</th>
              <th className="px-3 py-2.5 font-medium">创建时间</th>
              <th className="px-3 py-2.5 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {pagination.pageItems.map((item, idx) => {
              const isVideo = item.category === 'Video';
              const canPlay = isVideo && item.videoUrl;
              const isPub = item.status === 'published';
              return (
                <tr key={item.id || idx} className="hover:bg-zinc-950/50">
                  {/* 封面(视频可点播放)*/}
                  <td className="px-3 py-2">
                    <div
                      className={`w-16 h-10 rounded-md bg-zinc-800 overflow-hidden relative group ${canPlay ? 'cursor-pointer' : ''}`}
                      onClick={() => { if (canPlay) setPlayingVideo(item.videoUrl); }}
                    >
                      {item.cover && <img src={item.cover} alt={item.title} className="w-full h-full object-cover" />}
                      {isVideo && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity text-white">
                          <PlayCircle size={18} weight="fill" />
                        </div>
                      )}
                    </div>
                  </td>
                  {/* 作品ID */}
                  <td className="px-3 py-2">
                    <code className="font-mono text-[11px] text-zinc-500" title={item.id}>
                      {item.id ? String(item.id).slice(0, 8) + '…' : '—'}
                    </code>
                  </td>
                  {/* 名称 */}
                  <td className="px-3 py-2 max-w-[200px]">
                    <div className="text-white truncate" title={item.title}>{item.title || 'Untitled Work'}</div>
                  </td>
                  {/* 创建者 — Display Name + copy id + 跳主页 */}
                  <td className="px-3 py-2">
                    <AdminUserChip
                      userId={item.userId}
                      displayName={item.displayName}
                      avatarUrl={item.creatorAvatarUrl}
                    />
                  </td>
                  {/* 类型 */}
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-zinc-400 uppercase tracking-wider">{item.category || item.type || '—'}</span>
                  </td>
                  {/* 状态 */}
                  <td className="px-3 py-2">
                    {isVideo ? (
                      <span className={`text-[11px] px-2 py-0.5 rounded ${isPub ? 'bg-blue-500/10 text-blue-400' : 'bg-zinc-500/10 text-zinc-400'}`}>
                        {isPub ? 'Published' : 'Draft'}
                      </span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-zinc-500/10 text-zinc-400 capitalize">{item.status || '—'}</span>
                    )}
                  </td>
                  {/* 创建时间 */}
                  <td className="px-3 py-2 text-xs text-zinc-500 tabular-nums whitespace-nowrap" title={item.createdAt}>
                    {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                  </td>
                  {/* 操作:播放 / 上架·下架(仅 Video)/ 删除 */}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {canPlay && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setPlayingVideo(item.videoUrl); }}
                          className="px-2 py-1 rounded text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer flex items-center gap-1"
                          title="播放"
                        >
                          <PlayCircle size={13} weight="fill" /> 播放
                        </button>
                      )}
                      {isVideo && onTogglePublish && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onTogglePublish(item); }}
                          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            isPub
                              ? 'bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-600/40'
                          }`}
                          title={isPub ? '下架(从 Discover 隐藏)' : '上架(发布到 Discover)'}
                        >
                          {isPub ? '下架' : '上架'}
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onDelete(item); }}
                          className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                          title={`删除${item.category || 'Work'}`}
                        >
                          <Trash size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {filteredWorks.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mt-4">
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="works"
          />
        </div>
      )}

      {playingVideo && (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
            {/* §2026-05-29 Leon round-102 — close button 走 VideoPlayer 的
             * closeButton slot,内部定位 top-3 right-3 + z-10。caller 只给样式 +
             * onClick,不需要自管 absolute 位置。 */}
            <VideoPlayer
              kind="admin-preview"
              src={playingVideo}
              /* §2026-05-29 Leon round-102 — works 列表点开是用户主动点 play,
               * autoPlay=true 保留旧 callsite (round-101 之前) 行为。upload preview
               * callsite (3962) 不传 autoPlay → 用 admin-preview default false。 */
              autoPlay
              className="w-full h-full object-contain"
              closeButton={
                <button
                  className="p-2 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white rounded-full transition-colors cursor-pointer"
                  onClick={() => setPlayingVideo(null)}
                  aria-label="Close video"
                >
                  <X size={20} weight="bold" />
                </button>
              }
            />
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── v2 (2026-04-20) 常量 ───────────────────────────────────────────────────
 * 2026-04-22 TAG_OPTIONS 上提到 src/data/videoTags.js（与 Explore chip 同源），
 * 任一端改动自动同步，避免双份硬编码走偏。当前 4 个：Trailer/Vlog/MV/Short Drama。
 *
 * 目前清单不按 media_kind 分组 — Image / Live 的 tag 清单待费后续提供再拆成
 * TAG_OPTIONS_BY_KIND。当前 admin 不论选哪个 media_kind 都显示这 4 个 Video 向 tag。
 * ────────────────────────────────────────────────────────────────────────── */

/* ─── Media AR probe (2026-04-22) ──────────────────────────────────────────
 * "Default (Match source)" 语义：上传视频/封面时本地读出实际尺寸，
 * round 到最接近的标准 AR 填进 formData.aspect_ratio。
 *
 * 只在用户 Display AR 为 Default（即 prev.aspect_ratio === ''）时覆盖；
 * 用户显式选过 16/9 / 9/16 / ... 任一值都不覆盖。
 *
 * probe 失败（读不到 dimensions、File 解码异常）→ 返回空串，维持 Default 语义
 * 走后端 TYPE_MAP fallback，不报错不阻断上传。
 * ──────────────────────────────────────────────────────────────────────── */
const STANDARD_ARS = [
  { ratio: '16/9', value: 16 / 9 },  // 1.778
  { ratio: '4/3',  value: 4 / 3  },  // 1.333
  { ratio: '1/1',  value: 1      },  // 1.000
  { ratio: '3/4',  value: 3 / 4  },  // 0.750
  { ratio: '9/16', value: 9 / 16 },  // 0.5625
];

function roundToStandardAR(w, h) {
  if (!w || !h) return '';
  const r = w / h;
  let best = STANDARD_ARS[0];
  let minDiff = Infinity;
  for (const s of STANDARD_ARS) {
    const d = Math.abs(s.value - r);
    if (d < minDiff) { minDiff = d; best = s; }
  }
  return best.ratio;
}

/** 读本地 File 的 video dimensions, round 到标准 AR; 失败返回空串 */
function probeVideoAR(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const cleanup = () => { URL.revokeObjectURL(url); };
    v.onloadedmetadata = () => {
      const ar = roundToStandardAR(v.videoWidth, v.videoHeight);
      cleanup();
      resolve(ar);
    };
    v.onerror = () => { cleanup(); resolve(''); };
    // 保险：8s 超时兜底（大多数 browser 读 metadata 在 1s 内完成）
    setTimeout(() => { cleanup(); resolve(''); }, 8000);
    v.src = url;
  });
}

/** 读本地 File 的 image dimensions, round 到标准 AR; 失败返回空串 */
function probeImageAR(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const cleanup = () => { URL.revokeObjectURL(url); };
    img.onload = () => {
      const ar = roundToStandardAR(img.naturalWidth, img.naturalHeight);
      cleanup();
      resolve(ar);
    };
    img.onerror = () => { cleanup(); resolve(''); };
    setTimeout(() => { cleanup(); resolve(''); }, 8000);
    img.src = url;
  });
}

/* formData 初值 — v2 字段为主，legacy 兼容保留
 * 2026-04-23：前端已停止消费 legacy `type` 列；canonical 分类 = media_kind + tags。
 * DB NOT NULL 占位由 adminService.typeColumnPlaceholder 自动写入，Step 2 由后端 DROP COLUMN。 */
const EMPTY_FORM = {
  // legacy
  title: '', artist: '', cover: '', video: '', aspect_ratio: '',
  // v2: classification (权威分类 — type 由此派生)
  media_kind: 'Video',
  tags: [],
  // v2: CTA
  cta_label: '',
  cta_url: '',
  cta_target: '_self',
  // v2: pinned
  pinned: false,
  pin_order: '',
  // v2: publish
  published: false,
  published_at: null,
};

/**
 * HelpArticlesView — admin CRUD for the Help Center knowledge base.
 *
 * Lists all help_articles (published + unpublished) grouped by category,
 * sorted by sort_order. Click an article to expand inline editor. New
 * article via "Add article" button. Markdown supported in `body` — the
 * user-facing renderer is the same one used by release-notes (basic).
 *
 * Backend: /api/admin/help/articles (GET/POST/PATCH/DELETE).
 * RLS: only service-role can write (which the worker uses); reads are
 * gated by the public help_articles_read_published policy for the
 * user-facing endpoint, and admin uses service-role for unpublished too.
 */
const HelpArticlesView = () => {
  const [articles, setArticles] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [editing, setEditing] = React.useState(null);  // article object or 'new'
  const [submitting, setSubmitting] = React.useState(false);
  const pagination = useAdminPagination(articles, 50);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/help/articles', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setArticles(d.articles || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const isCreate = !form.id;
      const url = isCreate
        ? '/api/admin/help/articles'
        : `/api/admin/help/articles/${form.id}`;
      const method = isCreate ? 'POST' : 'PATCH';
      const r = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category: form.category,
          title: form.title,
          body: form.body,
          sort_order: Number(form.sort_order) || 0,
          published: form.published !== false,
        })
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setEditing(null);
      await load();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id, title) => {
    if (!window.confirm(`Delete help article "${title}"?\n\nThis is a hard delete — there's no undo. If you just want to hide it, edit and uncheck "Published" instead.`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/admin/help/articles/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  // Group by category, preserve sort_order within each
  // §2026-05-15 page over the FLAT list, re-group within the page slice.
  // Means category headers may show fewer items than the total per category —
  // pagination footer states the absolute count for clarity.
  const grouped = React.useMemo(() => {
    const out = {};
    for (const a of pagination.pageItems) {
      if (!out[a.category]) out[a.category] = [];
      out[a.category].push(a);
    }
    return out;
  }, [pagination.pageItems]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-white mb-1">Help articles</h3>
          <p className="text-xs text-zinc-500">CRUD knowledge base entries shown in user Settings → Support.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
          >
            <ArrowsClockwise size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => setEditing({ category: '', title: '', body: '', sort_order: 0, published: true })}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Plus size={12} weight="bold" /> Add article
          </button>
        </div>
      </div>

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading articles…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}

      {!loading && !error && articles.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <Question size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">No help articles yet.</p>
          <p className="text-zinc-600 text-xs mt-1">Click "Add article" to create the first one.</p>
        </div>
      )}

      {!loading && !error && Object.keys(grouped).sort().map(category => (
        <div key={category} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <div className="bg-zinc-950 px-4 py-2 border-b border-zinc-800">
            <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-400">
              {category} <span className="text-zinc-600">({grouped[category].length})</span>
            </span>
          </div>
          <div className="divide-y divide-zinc-800">
            {grouped[category].map(article => (
              <div key={article.id} className="px-4 py-3 hover:bg-zinc-800/30 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-white truncate">{article.title}</span>
                    {!article.published && (
                      <span className="text-[9px] uppercase tracking-wider font-semibold text-zinc-500 bg-zinc-800 border border-zinc-700 px-1.5 py-0.5 rounded">
                        Hidden
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-600 tabular-nums">#{article.sort_order}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed">{article.body}</p>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Updated {article.updated_at ? new Date(article.updated_at).toLocaleString() : '—'}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => setEditing(article)}
                    className="px-2 py-1 text-[10px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded transition-colors flex items-center gap-1"
                    title="Edit"
                  >
                    <PencilSimple size={10} /> Edit
                  </button>
                  <button
                    onClick={() => handleDelete(article.id, article.title)}
                    className="px-2 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded transition-colors flex items-center gap-1"
                    title="Delete (hard)"
                  >
                    <Trash size={10} /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {articles.length > 50 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="articles"
          />
        </div>
      )}

      {/* Edit / Create modal */}
      {editing && (
        <HelpArticleEditor
          initial={editing}
          submitting={submitting}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

/* HelpArticleEditor — modal form. */
const HelpArticleEditor = ({ initial, submitting, onCancel, onSave }) => {
  const [form, setForm] = React.useState({
    id: initial.id,
    category: initial.category || '',
    title: initial.title || '',
    body: initial.body || '',
    sort_order: initial.sort_order ?? 0,
    published: initial.published !== false,
  });

  const update = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.category.trim() || !form.title.trim() || !form.body.trim()) {
      alert('Category, title and body are all required.');
      return;
    }
    onSave(form);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-medium text-white">
            {form.id ? 'Edit help article' : 'New help article'}
          </h3>
          <button onClick={onCancel} className="p-1.5 text-zinc-500 hover:text-white rounded">
            <X size={14} weight="bold" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 flex-1 overflow-y-auto">
          {/* Category + Sort order side by side */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Category</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => update({ category: e.target.value })}
                placeholder="e.g. getting-started, billing, troubleshooting"
                disabled={submitting}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50"
              />
              <p className="text-[10px] text-zinc-600 mt-1">Free-text. Lowercase + hyphens. Articles are grouped by this.</p>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Sort order</label>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => update({ sort_order: e.target.value })}
                disabled={submitting}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm focus:outline-none focus:border-blue-600 tabular-nums"
              />
              <p className="text-[10px] text-zinc-600 mt-1">Lower = higher in list.</p>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. How do I cancel my subscription?"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">
              Body <span className="text-zinc-600">(markdown — **bold**, [link](url), bullet lists, paragraphs)</span>
            </label>
            <textarea
              value={form.body}
              onChange={(e) => update({ body: e.target.value })}
              placeholder="Step 1. ...\n\nStep 2. ..."
              disabled={submitting}
              rows={14}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50 font-mono leading-relaxed"
            />
          </div>

          {/* Published toggle */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) => update({ published: e.target.checked })}
                disabled={submitting}
                className="accent-blue-600"
              />
              <span className="text-sm text-white flex items-center gap-1.5">
                {form.published
                  ? <><Eye size={14} className="text-emerald-400" /> Published (visible to users)</>
                  : <><EyeSlash size={14} className="text-zinc-500" /> Hidden (admin only)</>
                }
              </span>
            </label>
          </div>
        </form>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting
              ? <><ArrowsClockwise size={12} className="animate-spin" /> Saving…</>
              : <><Check size={12} weight="bold" /> {form.id ? 'Update' : 'Create'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * DevLogView — daily team activity log. Project policy says every
 * non-trivial day gets an entry. See docs/governance/DEV-LOG-POLICY.md.
 *
 * Cross-author visible — gives Leon (and any future contractors) a
 * single place to see what changed without git log + grep through
 * commits.
 *
 * Backend: /api/admin/dev-log (admin-only, service-role bypasses RLS).
 */
const DEV_LOG_TAG_STYLES = {
  release:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  feature:       'bg-blue-500/15 text-blue-300 border-blue-500/30',
  fix:           'bg-amber-500/15 text-amber-300 border-amber-500/30',
  refactor:      'bg-violet-500/15 text-violet-300 border-violet-500/30',
  devops:        'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  ops:           'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  ux:            'bg-pink-500/15 text-pink-300 border-pink-500/30',
  pricing:       'bg-orange-500/15 text-orange-300 border-orange-500/30',
  compliance:    'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  investigation: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};
const tagStyle = (t) => DEV_LOG_TAG_STYLES[t] || 'bg-zinc-700/30 text-zinc-300 border-zinc-700';

/* Reuse the same markdown component map as user-facing Help Center but
 * darker theme since admin runs on dark zinc. Kept inline because it's
 * tiny and only used here. */
const DEV_LOG_MD_COMPONENTS = {
  p:      (p) => <p className="text-sm text-zinc-300 leading-relaxed mb-2" {...p} />,
  ul:     (p) => <ul className="list-disc pl-5 text-sm text-zinc-300 leading-relaxed mb-2 space-y-0.5" {...p} />,
  ol:     (p) => <ol className="list-decimal pl-5 text-sm text-zinc-300 leading-relaxed mb-2 space-y-0.5" {...p} />,
  li:     (p) => <li className="leading-relaxed" {...p} />,
  strong: (p) => <strong className="font-semibold text-white" {...p} />,
  em:     (p) => <em className="italic" {...p} />,
  h1:     (p) => <h3 className="text-base font-semibold text-white mt-3 mb-2" {...p} />,
  h2:     (p) => <h4 className="text-sm font-semibold text-white mt-3 mb-1.5" {...p} />,
  h3:     (p) => <h5 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider mt-3 mb-1" {...p} />,
  a:      (p) => <a className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer" {...p} />,
  code:   ({ inline, ...p }) => inline
            ? <code className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-200 font-mono text-[11px]" {...p} />
            : <code className="block p-3 rounded bg-zinc-950 text-zinc-200 font-mono text-[11px] overflow-x-auto" {...p} />,
  blockquote: (p) => <blockquote className="border-l-2 border-zinc-700 pl-3 text-sm text-zinc-400 italic mb-2" {...p} />,
};

const DevLogView = () => {
  const [entries, setEntries] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [tagFilter, setTagFilter] = React.useState('all');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/dev-log', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setEntries(d.entries || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const isCreate = !form.id;
      const url = isCreate ? '/api/admin/dev-log' : `/api/admin/dev-log/${form.id}`;
      const method = isCreate ? 'POST' : 'PATCH';
      const r = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          entry_date: form.entry_date,
          title: form.title,
          body: form.body,
          authors: form.authors.split(',').map(s => s.trim()).filter(Boolean),
          tags:    form.tags.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        })
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setEditing(null);
      await load();
    } catch (e) {
      alert(`Save failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete dev log entry "${entry.title}" (${entry.entry_date})?\n\nThis is a hard delete — no undo.`)) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/admin/dev-log/${entry.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const allTags = React.useMemo(() => {
    const s = new Set();
    entries.forEach(e => (e.tags || []).forEach(t => s.add(t)));
    return ['all', ...Array.from(s).sort()];
  }, [entries]);

  const filteredEntries = React.useMemo(() => {
    if (tagFilter === 'all') return entries;
    return entries.filter(e => (e.tags || []).includes(tagFilter));
  }, [entries, tagFilter]);
  const pagination = useAdminPagination(filteredEntries, 50);

  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-medium text-white mb-1">Dev log</h3>
          <p className="text-xs text-zinc-500 leading-relaxed max-w-xl">
            Daily team activity log. Project policy: an entry on every non-trivial day —
            see <code className="font-mono px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">docs/governance/DEV-LOG-POLICY.md</code>.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded-md transition-colors flex items-center gap-1.5"
          >
            <ArrowsClockwise size={12} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => setEditing({
              entry_date: todayIso,
              title: '',
              body: '',
              authors: 'fei',  // sensible default
              tags: '',
            })}
            className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Plus size={12} weight="bold" /> New entry
          </button>
        </div>
      </div>

      {/* Tag filter */}
      {allTags.length > 1 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-950 border border-zinc-900 rounded-xl p-2">
          <Tag size={11} className="text-zinc-500 ml-1" />
          {allTags.map(t => (
            <button
              key={t}
              onClick={() => setTagFilter(t)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider font-semibold rounded transition-colors ${
                tagFilter === t
                  ? 'bg-blue-600 text-white'
                  : `border ${t === 'all' ? 'border-zinc-700 text-zinc-400 hover:text-white' : tagStyle(t)} hover:opacity-80`
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="text-zinc-400 p-6 text-sm">Loading entries…</div>}
      {error && <div className="text-red-400 p-6 text-sm">Failed: {error}</div>}

      {!loading && !error && filteredEntries.length === 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <FileText size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-400 text-sm">
            {entries.length === 0 ? 'No entries yet.' : 'No entries match this tag.'}
          </p>
        </div>
      )}

      {!loading && !error && pagination.pageItems.map(entry => (
        <article
          key={entry.id}
          className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
        >
          {/* Per-entry header */}
          <header className="px-5 py-3 border-b border-zinc-800 bg-zinc-950/50 flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-baseline gap-3 mb-1">
                <time className="text-xs font-mono text-zinc-500 tracking-wider tabular-nums">
                  {entry.entry_date}
                </time>
                {entry.authors?.length > 0 && (
                  <span className="text-[10px] text-zinc-600">
                    by {entry.authors.join(' · ')}
                  </span>
                )}
              </div>
              <h4 className="text-sm font-semibold text-white">{entry.title}</h4>
              {entry.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {entry.tags.map(t => (
                    <span
                      key={t}
                      className={`px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold border rounded ${tagStyle(t)}`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={() => setEditing({
                  id: entry.id,
                  entry_date: entry.entry_date,
                  title: entry.title,
                  body: entry.body,
                  authors: (entry.authors || []).join(', '),
                  tags:    (entry.tags || []).join(', '),
                })}
                className="px-2 py-1 text-[10px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded transition-colors flex items-center gap-1"
                title="Edit"
              >
                <PencilSimple size={10} /> Edit
              </button>
              <button
                onClick={() => handleDelete(entry)}
                className="px-2 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded transition-colors flex items-center gap-1"
                title="Delete"
              >
                <Trash size={10} /> Delete
              </button>
            </div>
          </header>

          {/* Body — markdown */}
          <div className="px-5 py-4">
            <ReactMarkdown components={DEV_LOG_MD_COMPONENTS}>
              {entry.body}
            </ReactMarkdown>
          </div>
        </article>
      ))}

      {filteredEntries.length > 50 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="dev log entries"
          />
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <DevLogEditor
          initial={editing}
          submitting={submitting}
          onCancel={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
};

/* DevLogEditor — modal form for create/edit. */
const DevLogEditor = ({ initial, submitting, onCancel, onSave }) => {
  const [form, setForm] = React.useState(initial);
  const update = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.entry_date || !form.title.trim() || !form.body.trim()) {
      alert('Date, title and body are all required.');
      return;
    }
    onSave(form);
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !submitting && onCancel()}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-medium text-white">
            {form.id ? 'Edit dev log entry' : 'New dev log entry'}
          </h3>
          <button onClick={onCancel} className="p-1.5 text-zinc-500 hover:text-white rounded">
            <X size={14} weight="bold" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Date</label>
              <input
                type="date"
                value={form.entry_date}
                onChange={(e) => update({ entry_date: e.target.value })}
                disabled={submitting}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm focus:outline-none focus:border-blue-600 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Authors</label>
              <input
                type="text"
                value={form.authors}
                onChange={(e) => update({ authors: e.target.value })}
                placeholder="fei, Leon, Claude"
                disabled={submitting}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
              />
              <p className="text-[10px] text-zinc-600 mt-1">Comma-separated handles.</p>
            </div>
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. 'v1.1.2 released + upload triage'"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600"
            />
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">
              Body <span className="text-zinc-600">(markdown — supports headings, lists, code, links)</span>
            </label>
            <textarea
              value={form.body}
              onChange={(e) => update({ body: e.target.value })}
              placeholder={`### Released v1.1.x\n\n- Item 1\n- Item 2\n\n### Bug fixes\n\n- ...\n\nCommits: abc1234 def5678`}
              disabled={submitting}
              rows={16}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono leading-relaxed"
            />
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1 block">Tags</label>
            <input
              type="text"
              value={form.tags}
              onChange={(e) => update({ tags: e.target.value })}
              placeholder="release, feature, fix, devops, ops, ux, pricing, compliance, investigation"
              disabled={submitting}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 font-mono text-xs"
            />
            <p className="text-[10px] text-zinc-600 mt-1">
              Comma-separated. Conventional tags: release · feature · fix · refactor · devops · ops · ux · pricing · compliance · investigation
            </p>
          </div>
        </form>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onCancel} disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-950 border border-zinc-800 rounded-md disabled:opacity-50">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}
            className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-md disabled:opacity-50 flex items-center gap-1.5">
            {submitting
              ? <><ArrowsClockwise size={12} className="animate-spin" /> Saving…</>
              : <><Check size={12} weight="bold" /> {form.id ? 'Update' : 'Create'}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * TeamChatView — admin team chat with Claude as a participant.
 *
 * Polls /api/admin/team-chat/messages every 5s for new entries; humans
 * type into the input and posts go through /api/admin/team-chat/send,
 * which synchronously invokes Anthropic if @claude is mentioned (or no
 * one is mentioned, defaulting to a Claude response).
 *
 * Cost cap: 100 Claude invocations/user/day, enforced server-side.
 *
 * See docs/governance/DECISION-OWNERSHIP.md for what Claude can decide vs escalate.
 */
const TeamChatView = () => {
  const [messages, setMessages] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [input, setInput] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [meId, setMeId] = React.useState(null);
  const [statusFilter, setStatusFilter] = React.useState('all');  // all | open | in_progress | done | wont_do
  const [hideRead, setHideRead] = React.useState(false);
  const scrollEndRef = React.useRef(null);
  const lastFetchAtRef = React.useRef(null);
  const markReadInFlightRef = React.useRef(new Set()); // dedupe in-flight POSTs

  // Initial load + me id
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('Not signed in');
        if (!cancelled) setMeId(session.user.id);
        const r = await fetch('/api/admin/team-chat/messages?limit=200', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const d = await r.json();
        if (!cancelled) {
          if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
          setMessages(d.messages || []);
          lastFetchAtRef.current = new Date().toISOString();
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll every 5s for new messages
  React.useEffect(() => {
    const id = setInterval(async () => {
      if (sending) return;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const since = lastFetchAtRef.current;
        const url = since
          ? `/api/admin/team-chat/messages?since=${encodeURIComponent(since)}`
          : '/api/admin/team-chat/messages?limit=200';
        const r = await fetch(url, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const d = await r.json();
        if (r.ok && d.success && Array.isArray(d.messages) && d.messages.length > 0) {
          setMessages(prev => {
            // De-dup by id
            const seen = new Set(prev.map(m => m.id));
            const fresh = d.messages.filter(m => !seen.has(m.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
          lastFetchAtRef.current = new Date().toISOString();
        }
      } catch (e) { /* silent poll error */ }
    }, 5000);
    return () => clearInterval(id);
  }, [sending]);

  // Auto-scroll to bottom when new messages arrive
  React.useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/team-chat/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: text }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id));
        const fresh = (d.messages || []).filter(m => !seen.has(m.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      lastFetchAtRef.current = new Date().toISOString();
      setInput('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  // ─── Status & read management ─────────────────────────────────────
  // Set status of one message (optimistic + server confirm). On error
  // we revert by reloading the row from the server response.
  const handleSetStatus = React.useCallback(async (messageId, status) => {
    // Optimistic update
    setMessages(prev => prev.map(m =>
      m.id === messageId
        ? { ...m, status, status_updated_at: new Date().toISOString(), status_updated_by: meId }
        : m
    ));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/team-chat/set-status', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_id: messageId, status }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      // Patch with authoritative server values
      setMessages(prev => prev.map(m => m.id === messageId ? { ...m, ...d.message } : m));
    } catch (e) {
      alert('Status update failed: ' + e.message);
      // Pessimistic reload to undo the optimistic update
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const rr = await fetch('/api/admin/team-chat/messages?limit=200', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        const dd = await rr.json();
        if (rr.ok && dd.success) setMessages(dd.messages || []);
      } catch { /* swallow */ }
    }
  }, [meId]);

  // Auto-mark messages as read when they're visible (i.e. mounted in the
  // list). Batched: collect unread ids and POST once after render. Tracked
  // via a ref so re-renders don't fire duplicate requests for the same ids.
  React.useEffect(() => {
    if (!meId || messages.length === 0) return;
    const unreadIds = messages
      .filter(m => m.author_id !== meId)                  // own messages don't need "read" marker
      .filter(m => m.author_kind !== 'system')            // system notices don't track read
      .filter(m => !(m.read_by || {})[meId])
      .filter(m => !markReadInFlightRef.current.has(m.id))
      .map(m => m.id);
    if (unreadIds.length === 0) return;

    unreadIds.forEach(id => markReadInFlightRef.current.add(id));

    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const r = await fetch('/api/admin/team-chat/mark-read', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message_ids: unreadIds }),
        });
        if (r.ok) {
          // Optimistically stamp read_by locally (server side already did)
          const now = new Date().toISOString();
          setMessages(prev => prev.map(m =>
            unreadIds.includes(m.id)
              ? { ...m, read_by: { ...(m.read_by || {}), [meId]: now } }
              : m
          ));
        }
      } catch (e) {
        // Silent: read tracking isn't critical, and we'll retry on next
        // poll cycle when the dedupe ref clears
        unreadIds.forEach(id => markReadInFlightRef.current.delete(id));
      }
    })();
  }, [messages, meId]);

  // Manual "Mark all read" — clears every unread for current user
  const handleMarkAllRead = async () => {
    const unread = messages
      .filter(m => m.author_id !== meId)
      .filter(m => m.author_kind !== 'system')
      .filter(m => !(m.read_by || {})[meId])
      .map(m => m.id);
    if (unread.length === 0) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/team-chat/mark-read', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message_ids: unread }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const now = new Date().toISOString();
      setMessages(prev => prev.map(m =>
        unread.includes(m.id) ? { ...m, read_by: { ...(m.read_by || {}), [meId]: now } } : m
      ));
    } catch (e) {
      alert('Mark-all-read failed: ' + e.message);
    }
  };

  // Apply filters for display
  const visibleMessages = React.useMemo(() => {
    return messages.filter(m => {
      if (statusFilter !== 'all' && m.author_kind !== 'system' && (m.status || 'open') !== statusFilter) return false;
      if (hideRead && m.author_id !== meId && m.author_kind !== 'system' && (m.read_by || {})[meId]) return false;
      return true;
    });
  }, [messages, statusFilter, hideRead, meId]);

  const unreadCount = React.useMemo(() => {
    return messages.filter(m =>
      m.author_id !== meId &&
      m.author_kind !== 'system' &&
      !(m.read_by || {})[meId]
    ).length;
  }, [messages, meId]);

  const openCount = React.useMemo(() => {
    return messages.filter(m =>
      m.author_kind !== 'system' && (m.status || 'open') === 'open'
    ).length;
  }, [messages]);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 220px)' }}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3 flex-shrink-0 gap-3 flex-wrap">
        <div>
          <h3 className="text-lg font-medium text-white mb-1 flex items-center gap-2">
            <ChatCircleDots size={20} weight="fill" className="text-blue-400" />
            Team Chat
            {unreadCount > 0 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40">
                📥 {unreadCount} new
              </span>
            )}
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
              🟢 {openCount} open
            </span>
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            实时聊天频道，<code className="font-mono px-1 py-0.5 bg-zinc-800 rounded text-zinc-300">@claude</code> 触发 AI 回复。
            点 status 胶囊切换状态 (open / WIP / done / won't)。
          </p>
        </div>

        {/* Filter + bulk-action toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'all',         label: 'All' },
            { id: 'open',        label: '🟢 Open' },
            { id: 'in_progress', label: '🟡 WIP' },
            { id: 'done',        label: '✅ Done' },
            { id: 'wont_do',     label: "⚪ Won't" },
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-colors ${
                statusFilter === f.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
          <label className="text-[10px] text-zinc-400 flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={hideRead} onChange={(e) => setHideRead(e.target.checked)} className="accent-blue-600" />
            Hide read
          </label>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="px-2 py-1 text-[10px] font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-600/40 rounded"
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Messages scroll area */}
      <div className="flex-1 overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
        {loading && (
          <div className="text-zinc-500 text-sm text-center py-8 flex items-center justify-center gap-2">
            <ArrowsClockwise size={14} className="animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded p-3">
            {error}
          </div>
        )}
        {!loading && messages.length === 0 && !error && (
          <div className="text-zinc-500 text-sm text-center py-8">No messages yet — start the conversation 👇</div>
        )}
        {!loading && messages.length > 0 && visibleMessages.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-8">
            No messages match the current filter.
            {statusFilter !== 'all' && <> Try <button className="text-blue-400 hover:underline" onClick={() => setStatusFilter('all')}>show all</button>.</>}
          </div>
        )}
        {visibleMessages.map(m => (
          <ChatMessageRow
            key={m.id}
            message={m}
            isMe={m.author_id === meId}
            meId={meId}
            onSetStatus={handleSetStatus}
          />
        ))}
        <div ref={scrollEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 mt-3 bg-zinc-900 border border-zinc-800 rounded-xl p-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (@claude to ping AI, Shift+Enter for newline)"
            disabled={sending}
            rows={2}
            className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 text-white rounded-md text-sm placeholder:text-zinc-600 focus:outline-none focus:border-blue-600 disabled:opacity-50 resize-none"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {sending
              ? <><ArrowsClockwise size={14} className="animate-spin" /> Sending…</>
              : <><PaperPlaneTilt size={14} weight="fill" /> Send</>
            }
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1.5">
          Tip: 不带 @mention 默认 Claude 回复。带 @fei / @leon 而不带 @claude 则只存消息不触发 AI。
        </p>
      </div>
    </div>
  );
};

/* Single chat message row. */
/**
 * Status pill for a team_messages row. Four states cycle on click:
 *   open → in_progress → done → wont_do → open
 * (Hold Shift while clicking to cycle backwards.)
 *
 * Optimistic: we call onSetStatus immediately; parent reverts on error.
 */
const STATUS_CONFIG = {
  open:        { label: 'Open',  glyph: '🟢', cls: 'bg-zinc-700/60 text-zinc-300 border-zinc-600' },
  in_progress: { label: 'WIP',   glyph: '🟡', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  done:        { label: 'Done',  glyph: '✅', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  wont_do:     { label: "Won't", glyph: '⚪', cls: 'bg-zinc-800/60 text-zinc-500 border-zinc-700 line-through' },
};
const STATUS_ORDER = ['open', 'in_progress', 'done', 'wont_do'];

const StatusPill = ({ status, disabled, onChange }) => {
  const cfg = STATUS_CONFIG[status || 'open'];
  const handleClick = (e) => {
    if (disabled || !onChange) return;
    const cur = status || 'open';
    const idx = STATUS_ORDER.indexOf(cur);
    const next = e.shiftKey
      ? STATUS_ORDER[(idx - 1 + STATUS_ORDER.length) % STATUS_ORDER.length]
      : STATUS_ORDER[(idx + 1) % STATUS_ORDER.length];
    onChange(next);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={`Click to cycle status (Shift+click to reverse). Current: ${cfg.label}.`}
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${cfg.cls} ${disabled ? 'opacity-50' : 'hover:brightness-110 cursor-pointer'}`}
    >
      <span className="mr-1">{cfg.glyph}</span>{cfg.label}
    </button>
  );
};

const ChatMessageRow = ({ message, isMe, meId, onSetStatus }) => {
  const isClaude = message.author_kind === 'claude';
  const isSystem = message.author_kind === 'system';
  const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Status / read indicators (skip for system messages — those are
  // ephemeral notifications, not actionable items).
  const status = message.status || 'open';
  const readBy = message.read_by || {};
  const isUnreadByMe = meId && !readBy[meId];
  const readByOthers = Object.keys(readBy).filter(uid => uid !== meId).length;
  const readByNames = Object.keys(readBy).length;
  const [statusBusy, setStatusBusy] = React.useState(false);

  // §2026-05-31 fei — copy-to-clipboard for each message.
  //   Copies the BODY (markdown source as authored) — not the rendered
  //   HTML — so what you paste into Claude / docs preserves formatting.
  //   Brief "Copied!" flash uses local state with a 1.5s timeout.
  const [copyFlash, setCopyFlash] = React.useState(false);
  const handleCopy = async () => {
    const text = message.body || '';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: hidden textarea + execCommand for older / non-HTTPS contexts
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopyFlash(true);
      setTimeout(() => setCopyFlash(false), 1500);
    } catch (e) {
      console.error('[ChatMessageRow] copy failed', e);
      alert('复制失败:' + (e?.message || e));
    }
  };

  const handleStatusChange = async (next) => {
    if (!onSetStatus || statusBusy) return;
    setStatusBusy(true);
    try {
      await onSetStatus(message.id, next);
    } finally {
      setStatusBusy(false);
    }
  };

  if (isSystem) {
    return (
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 my-3">
        <div className="text-[10px] uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
          <Terminal size={10} /> System · {time}
        </div>
        <div className="text-xs text-zinc-300">
          <ReactMarkdown components={DEV_LOG_MD_COMPONENTS}>{message.body}</ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
        isClaude ? 'bg-blue-500/20 text-blue-300' : isMe ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-700 text-zinc-300'
      }`}>
        {isClaude ? <Robot size={16} weight="fill" /> : <Users size={14} />}
      </div>

      {/* Bubble */}
      <div className={`min-w-0 max-w-[80%] ${isMe ? 'items-end' : 'items-start'} flex flex-col`}>
        <div className={`text-[10px] mb-1 ${isMe ? 'text-right justify-end' : 'text-left'} text-zinc-500 flex items-center gap-1.5 ${isMe ? 'flex-row-reverse' : ''}`}>
          <span className={isClaude ? 'text-blue-400 font-medium' : 'text-zinc-300 font-medium'}>
            {message.author_display_name || (isClaude ? 'Claude' : 'unknown')}
          </span>
          <span className="text-zinc-600">· {time}</span>
          {/* Status pill — click to cycle. Skip for own messages? No,
              you might want to mark your own message done after action. */}
          <StatusPill status={status} disabled={statusBusy} onChange={handleStatusChange} />
          {/* §2026-05-31 fei — copy-to-clipboard button. Brief flash
              ("Copied!") confirms success. Copies the markdown source so
              pasting into Claude / Notion / docs preserves formatting. */}
          <button
            type="button"
            onClick={handleCopy}
            title={copyFlash ? '已复制!' : '复制消息内容到剪贴板'}
            className={`text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors flex items-center gap-1 cursor-pointer ${
              copyFlash
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                : 'bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:text-white hover:border-zinc-600'
            }`}
          >
            {copyFlash ? <Check size={10} weight="bold" /> : <Copy size={10} />}
            {copyFlash ? '已复制' : '复制'}
          </button>
          {/* Unread marker (only for OTHER people's messages — you've
              clearly seen your own). */}
          {!isMe && isUnreadByMe && (
            <span className="text-blue-400 text-[9px]" title="Unread (will auto-mark on view)">📥</span>
          )}
          {/* Read-by indicator: number of distinct readers minus me */}
          {readByNames > 0 && (
            <span
              className="text-zinc-600"
              title={`Read by: ${Object.entries(readBy).map(([uid, t]) => `${uid.slice(0,8)} @ ${new Date(t).toLocaleString()}`).join(', ')}`}
            >
              👁️ {readByNames}
            </span>
          )}
        </div>
        <div className={`px-3.5 py-2.5 rounded-2xl text-sm ${
          isClaude
            ? 'bg-zinc-900 border border-blue-500/20 text-zinc-200 rounded-tl-sm'
            : isMe
              ? 'bg-emerald-600/20 border border-emerald-500/30 text-zinc-100 rounded-tr-sm'
              : 'bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-tl-sm'
        } ${status === 'done' ? 'opacity-60' : ''} ${status === 'wont_do' ? 'opacity-40' : ''}`}>
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown components={DEV_LOG_MD_COMPONENTS}>{message.body}</ReactMarkdown>
          </div>
          {/* Tool call audit chip */}
          {message.tool_calls && Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-700/50 text-[10px] text-zinc-500 space-y-0.5">
              {message.tool_calls.map((tc, i) => (
                <div key={i} className="flex items-center gap-1.5 font-mono">
                  <Terminal size={9} />
                  <span className="text-zinc-400">{tc.name}</span>
                  {tc.success === false && <span className="text-red-400">(failed)</span>}
                  {tc.row_count != null && <span className="text-zinc-500">→ {tc.row_count} rows</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ConfigView = ({ items, setItems }) => {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const pagination = useAdminPagination(items, 50);

  // Media upload states
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [coverProgress, setCoverProgress] = useState(0);
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  const resetForm = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowModal(false);
  };

  const handleAddNew = () => {
    setEditingId(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({
      // legacy (type 字段不再由 UI 编辑 —— 见 EMPTY_FORM 注释)
      title:  item.title  || '',
      artist: item.artist || '',
      cover:  item.cover  || '',
      video:  item.video  || '',
      aspect_ratio: item.aspect_ratio || '',
      // v2 — pull directly from the DB row (snake_case) with safe defaults
      media_kind:   item.media_kind   || 'Video',
      tags:         Array.isArray(item.tags) ? item.tags : [],
      cta_label:    item.cta_label    || '',
      cta_url:      item.cta_url      || '',
      cta_target:   item.cta_target   || '_self',
      pinned:       item.pinned === true,
      pin_order:    item.pin_order ?? '',
      published:    item.published === true,
      published_at: item.published_at || null,
    });
    setShowModal(true);
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this item completely from the database?')) return;
    try {
      const next = await deleteRecommendedContent(id);
      setItems(next);
    } catch(err) {
      alert("Failed to delete: " + err.message);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    /* ── v2 app-layer validation ──────────────────────────────────────────
     * CTA 两个字段必须同时有或同时无（避免只配了 label 没 URL 的半残状态）。
     * ────────────────────────────────────────────────────────────────── */
    const ctaLabel = (formData.cta_label || '').trim();
    const ctaUrl   = (formData.cta_url   || '').trim();
    if (ctaLabel && !ctaUrl) {
      alert('CTA Label is set but CTA URL is empty. Please fill both or clear both.');
      return;
    }
    if (!ctaLabel && ctaUrl) {
      alert('CTA URL is set but CTA Label is empty. Please fill both or clear both.');
      return;
    }

    setIsSubmitting(true);
    try {
      /* ── Normalize payload for DB ───────────────────────────────────────
       * - pin_order: empty string → null; otherwise cast to int
       * - published_at: auto-stamp on the first publish=true transition
       * - tags: ensure array shape (never string)
       * - CTA: only persisted for Video/Image media_kind; zeroed for Live
       *   to prevent stale CTA data leaking when admin changes media_kind
       *   after filling the CTA fieldset.
       * ──────────────────────────────────────────────────────────────── */
      const isCtaAllowed = formData.media_kind === 'Video' || formData.media_kind === 'Image';
      const payload = {
        ...formData,
        cta_label:  isCtaAllowed ? (ctaLabel || null) : null,
        cta_url:    isCtaAllowed ? (ctaUrl   || null) : null,
        cta_target: isCtaAllowed && ctaLabel ? (formData.cta_target || '_self') : null,
        pin_order:  formData.pin_order === '' || formData.pin_order == null
                      ? null
                      : Number(formData.pin_order),
        tags: Array.isArray(formData.tags) ? formData.tags : [],
        published_at: formData.published && !formData.published_at
                       ? new Date().toISOString()
                       : formData.published_at,
        // Hero-slot (pinned && pin_order===1) 强制 AR=16/9 — 与前端 HeroCard 的
        // aspect-video 渲染保持一致，运营误填也会被 normalize 掉。
        aspect_ratio: (formData.pinned && Number(formData.pin_order) === 1)
                        ? '16/9'
                        : (formData.aspect_ratio || null),
      };

      if (editingId) {
        const nextList = await updateRecommendedContent(editingId, payload);
        setItems(nextList);
      } else {
        const nextList = await addRecommendedContent(payload);
        setItems(nextList);
      }
      resetForm();
    } catch (err) {
      alert("Failed to save: " + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploadingCover(true);
    setCoverProgress(10);

    /* probe 本地 File 的实际 AR（round 到最近标准值）；仅在 Display AR = Default
     * (aspect_ratio === '') 时填入 formData，不覆盖用户显式选过的值。
     * 与上传并行：probe 走 createObjectURL 不消耗网络。 */
    const probedAR = await probeImageAR(file);

    try {
      const workerDomain = '/api';
      const objectKey = 'cover_' + Date.now().toString(36) + '_' + file.name.replace(/[^a-zA-Z0-9.\-_]/g, '');
      const xhr = new XMLHttpRequest();
      
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setCoverProgress(10 + Math.round((ev.loaded / ev.total) * 90));
      };

      const publicUrl = await new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const res = JSON.parse(xhr.responseText);
            resolve(res.url);
          } else {
            reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('PUT', `${workerDomain}/upload/${objectKey}`, true);
        xhr.setRequestHeader('Content-Type', file.type || 'image/jpeg');
        xhr.send(file);
      });
      
      setFormData(prev => ({
        ...prev,
        cover: publicUrl,
        aspect_ratio: prev.aspect_ratio || probedAR,  // 仅 Default 时填实测值
      }));
    } catch(err) {
      alert("Cover upload failed: " + err.message);
    } finally {
      setIsUploadingCover(false);
    }
  };

  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploadingVideo(true);
    setVideoProgress(10);

    /* 同 handleImageUpload：probe 视频 AR，Default 时填入 aspect_ratio */
    const probedAR = await probeVideoAR(file);

    try {
      /* 2026-04-23 改回 /api/stream/direct_upload（费 634f8365 当初为绕 CF Access
       * Zero Trust 改名到 /upload/stream_ticket，但 _worker.js 没同步加该路由 ——
       * POST 被 R2 catch-all 吞成 0-byte 文件，ticketData.success 永远 undefined，
       * 上传静默失败。现 Zero Trust 已不拦 /api/stream/direct_upload，切回即可。 */
      const workerDomain = '/api';
      const ticketRes = await fetch(`${workerDomain}/stream/direct_upload`, { method: 'POST' });
      const ticketData = await ticketRes.json();
      if (!ticketData.success) throw new Error('Could not get upload ticket');
      
      const { uploadURL, uid } = ticketData.result;
      setVideoProgress(30);

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) setVideoProgress(30 + Math.round((ev.loaded / ev.total) * 70));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
             resolve();
          } else {
             reject(new Error('Upload failed'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.open('POST', uploadURL, true);
        const fd = new FormData();
        fd.append('file', file);
        xhr.send(fd);
      });
      
      const hlsUrl = `https://iframe.videodelivery.net/${uid}`;
      setFormData(prev => {
        const newCover = prev.cover ? prev.cover : `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=0s`;
        return {
          ...prev,
          video: hlsUrl,
          cover: newCover,
          aspect_ratio: prev.aspect_ratio || probedAR,  // 仅 Default 时填实测值
        };
      });
    } catch (err) {
      alert("Video upload failed: " + err.message);
    } finally {
      setIsUploadingVideo(false);
    }
  };

  return (
    <div className="space-y-4 relative">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">Frontend Feed Content ({items.length})</h3>
        <button 
          onClick={handleAddNew}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer z-10 relative"
          style={{pointerEvents: 'auto'}}
        >
          <Plus size={16} />
          Add New Content
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {pagination.pageItems.map(item => (
          <div 
            key={item.id} 
            onClick={() => handleEdit(item)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 transition-all cursor-pointer"
          >
            <div className="aspect-video bg-zinc-800 relative">
              <img src={item.cover} alt={item.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
              {/* Top-right 双层徽章（admin 独有，homepage 只有单层 tag badge）
               * 顶 = tags[0]（WYSIWYG 与首页一致；为空时渲染 dashed 占位，提醒运营忘打 tag）
               * 下 = media_kind（常驻，backfill 后永远有值，'Video' 是兜底防御）
               * 2026-04-23 — 清除 legacy type 依赖，media_kind 为单一数据源 */}
              <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                {item.tags?.[0] ? (
                  <span className="px-2 py-1 bg-black/50 backdrop-blur-md rounded text-[10px] font-bold text-white tracking-wider">
                    {item.tags[0]}
                  </span>
                ) : (
                  <span
                    className="px-2 py-1 bg-black/20 backdrop-blur-md rounded text-[10px] font-medium text-amber-300/70 border border-dashed border-amber-300/40 tracking-wide"
                    title="此卡片未设置 #tag — 点击进入编辑器添加"
                  >
                    no tag
                  </span>
                )}
                <span className="px-2 py-0.5 bg-black/30 backdrop-blur-md rounded text-[10px] font-medium text-zinc-300 tracking-wide">
                  {item.media_kind || 'Video'}
                </span>
              </div>
            </div>
            <div className="p-4">
              <h4 className="text-white font-medium truncate mb-1">{item.title || 'Untitled'}</h4>
              <p className="text-zinc-400 text-sm truncate">{item.artist || 'Unknown User'}</p>
              
              <div className="flex mt-4 pt-4 border-t border-zinc-800 justify-between items-center">
                <span className="text-xs text-zinc-500 truncate w-32">ID: {item.id}</span>
                <button 
                  onClick={(e) => handleDelete(item.id, e)}
                  className="text-zinc-500 hover:text-red-400 p-1 rounded-md hover:bg-red-500/10 transition-colors"
                >
                  <Trash size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length > 50 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mt-4">
          <AdminPagination
            page={pagination.page}
            perPage={pagination.perPage}
            total={pagination.total}
            onChange={pagination.setPage}
            label="feed items"
          />
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-[448px] overflow-hidden my-auto max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-zinc-800 shrink-0">
              <h3 className="text-lg font-medium text-white">{editingId ? 'Edit Content' : 'Add New Content'}</h3>
              <button 
                onClick={() => setShowModal(false)}
                className="text-zinc-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 overflow-y-auto min-h-0 flex-1">
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">Title</label>
                <input 
                  type="text" 
                  required
                  value={formData.title}
                  onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. Cyberpunk City Walk"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-1">Artist / User Name</label>
                <input 
                  type="text" 
                  required
                  value={formData.artist}
                  onChange={e => setFormData(p => ({ ...p, artist: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-4 py-3 text-white focus:outline-none focus:border-blue-500"
                  placeholder="e.g. Studio_K"
                />
              </div>

              {/* Cover Image Uploader */}
              <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur">
                <label className="block text-sm font-medium text-white mb-2 flex justify-between items-center">
                  <span>Cover Image</span>
                  {isUploadingCover && <span className="text-xs text-blue-400">{coverProgress}%</span>}
                </label>
                {formData.cover && (
                  <div className="mb-3 relative group w-full aspect-video rounded-lg overflow-hidden border border-zinc-800">
                    <img src={formData.cover} alt="Cover Preview" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    disabled={isUploadingCover}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className={`w-full py-2.5 px-4 text-sm text-center rounded-full border border-dashed transition-colors ${isUploadingCover ? 'bg-zinc-800 border-zinc-700 text-zinc-500' : 'bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20'}`}>
                    {isUploadingCover ? 'Uploading Cover...' : formData.cover ? 'Change Cover Image' : 'Select Cover Image'}
                  </div>
                </div>
                {/* Fallback manual URL input */}
                <input 
                  type="url" 
                  value={formData.cover}
                  onChange={e => setFormData(p => ({ ...p, cover: e.target.value }))}
                  className="w-full mt-2 bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-400 focus:outline-none focus:border-blue-500 text-xs"
                  placeholder="Or paste Direct Image URL..."
                />
                
                {/* Cloudflare Stream Video Frame Extractor Helper */}
                {formData.cover && formData.cover.includes('videodelivery.net') && (
                  <div className="flex items-center gap-2 mt-3 p-2 bg-black/30 rounded-lg border border-zinc-800/80">
                     <span className="text-xs text-zinc-400 whitespace-nowrap">Extract Frame at:</span>
                     <input 
                       type="number"
                       min="0"
                       step="0.1"
                       value={formData.cover.match(/time=([0-9.]+)s/)?.[1] || "0"}
                       onChange={(e) => {
                         const t = e.target.value;
                         if (t || t === '0') {
                           setFormData(p => ({ 
                             ...p, 
                             cover: p.cover.includes('time=') 
                               ? p.cover.replace(/time=[0-9.]+s/, `time=${t}s`)
                               : `${p.cover}${p.cover.includes('?') ? '&' : '?'}time=${t}s` 
                           }));
                         }
                       }}
                       className="bg-transparent border-b border-zinc-700 text-white text-xs w-16 text-center focus:outline-none focus:border-blue-500"
                     />
                     <span className="text-xs text-zinc-500">seconds</span>
                  </div>
                )}
              </div>

              {/* Video Media Uploader */}
              <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur">
                <label className="block text-sm font-medium text-white mb-2 flex justify-between items-center">
                  <span>Source Video (Optional)</span>
                  {isUploadingVideo && <span className="text-xs text-blue-400">{videoProgress}%</span>}
                </label>
                {formData.video && (
                  <div className="mb-3 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 font-mono text-[10px] text-emerald-400 truncate">
                    {formData.video}
                  </div>
                )}
                <div className="relative">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleVideoUpload}
                    disabled={isUploadingVideo}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                  />
                  <div className={`w-full py-2.5 px-4 text-sm text-center rounded-full border border-dashed transition-colors ${isUploadingVideo ? 'bg-zinc-800 border-zinc-700 text-zinc-500' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'}`}>
                    {isUploadingVideo ? 'Streaming to Cloudflare...' : formData.video ? 'Change Source Video' : 'Upload Video to Stream'}
                  </div>
                </div>
                {/* Fallback manual URL input */}
                <input 
                  type="url" 
                  value={formData.video}
                  onChange={e => setFormData(p => ({ ...p, video: e.target.value }))}
                  className="w-full mt-2 bg-black border border-zinc-800 rounded px-3 py-2 text-zinc-400 focus:outline-none focus:border-blue-500 text-xs"
                  placeholder="Or paste M3U8 / MP4 URL..."
                />
              </div>

              {/* Legacy Classification Type dropdown removed 2026-04-21.
                  前端已不消费 `type` 列 (2026-04-23 起)；canonical = media_kind + tags。
                  DB 列仍由 adminService.typeColumnPlaceholder 写入占位值满足 NOT NULL，
                  后续由后端 DROP COLUMN 清除。 */}

              {/* Hero-slot (pinned && pin_order===1) 锁定 AR=16/9 — 保证 HeroCard 全宽 16:9 渲染 */}
              {(() => {
                const isHeroSlot = formData.pinned && Number(formData.pin_order) === 1;
                return (
                  <div>
                    <label className="block text-sm font-medium text-zinc-400 mb-1">
                      Display AR {isHeroSlot ? <span className="text-amber-400">· locked to 16:9 (hero slot)</span> : '(Optional override)'}
                    </label>
                    <select
                      value={isHeroSlot ? '16/9' : formData.aspect_ratio}
                      onChange={e => { if (!isHeroSlot) setFormData(p => ({ ...p, aspect_ratio: e.target.value })); }}
                      disabled={isHeroSlot}
                      className={`w-full bg-zinc-950 border border-zinc-800 rounded-full px-4 py-3 text-white focus:outline-none focus:border-blue-500 appearance-none ${isHeroSlot ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <option value="">Default — Match source</option>
                      <option value="16/9">16:9 Horizontal (PC/TV)</option>
                      <option value="9/16">9:16 Vertical (Mobile)</option>
                      <option value="1/1">1:1 Square (Posts)</option>
                      <option value="3/4">3:4 Portrait</option>
                      <option value="4/3">4:3 Desktop</option>
                    </select>
                    {isHeroSlot && (
                      <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
                        Hero 卡（pin_order=1）统一 16:9，与瀑布流顶部 banner 几何一致。需其他比例请先取消 pin 或改 pin_order。
                      </p>
                    )}
                  </div>
                );
              })()}

              {/* ═══════════════════════════════════════════════════════════════════
                   v2 (2026-04-20) — Classification / CTA / Pin / Publish
                   Additive fieldsets; leave these blank to preserve pre-v2 behavior.
                  ═══════════════════════════════════════════════════════════════════ */}

              {/* ① Classification — media_kind + tags */}
              <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur space-y-3">
                <label className="block text-sm font-medium text-white">Classification (v2)</label>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Media Kind</label>
                  <select
                    value={formData.media_kind}
                    onChange={e => setFormData(p => ({ ...p, media_kind: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-full px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none"
                  >
                    <option value="Video">Video</option>
                    <option value="Image">Image</option>
                    <option value="Live">Live</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                    Tags (optional) · <span className="text-zinc-500">首个为卡片徽章（可拖拽重排）</span>
                  </label>

                  {/* 已选 tags — 可拖拽重排，首个 = 卡片徽章，带 Star 角标 */}
                  {Array.isArray(formData.tags) && formData.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {formData.tags.map((tag, idx) => {
                        const isPrimary = idx === 0;
                        return (
                          <div
                            key={tag}
                            draggable
                            onDragStart={e => {
                              e.dataTransfer.setData('text/plain', String(idx));
                              e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={e => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={e => {
                              e.preventDefault();
                              const from = Number(e.dataTransfer.getData('text/plain'));
                              if (Number.isNaN(from) || from === idx) return;
                              setFormData(p => {
                                const next = [...(p.tags || [])];
                                const [moved] = next.splice(from, 1);
                                next.splice(idx, 0, moved);
                                return { ...p, tags: next };
                              });
                            }}
                            title={isPrimary ? '主标签（显示在卡片徽章上）— 拖拽可重排' : '拖到最前可设为主标签'}
                            className={`flex items-center gap-1 px-2 py-1 rounded-full border text-xs cursor-move select-none transition-colors ${
                              isPrimary
                                ? 'bg-blue-500/30 border-blue-400 text-blue-100 ring-1 ring-blue-400/60'
                                : 'bg-blue-500/15 border-blue-500/40 text-blue-300'
                            }`}
                          >
                            {isPrimary
                              ? <Star size={11} weight="fill" className="text-yellow-300" />
                              : <DotsSixVertical size={11} className="opacity-60" />}
                            <span>{tag}</span>
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setFormData(p => ({
                                  ...p,
                                  tags: (p.tags || []).filter(t => t !== tag)
                                }));
                              }}
                              className="ml-0.5 text-blue-200/50 hover:text-red-400 transition-colors"
                              aria-label={`Remove ${tag}`}
                            >
                              <X size={10} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mb-2 text-xs text-zinc-600 italic">暂无标签 — 从下方点击添加</div>
                  )}

                  {/* 可添加 tags — 点击追加到末尾 */}
                  <div className="flex flex-wrap gap-1.5">
                    {TAG_OPTIONS
                      .filter(tag => !(Array.isArray(formData.tags) && formData.tags.includes(tag)))
                      .map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => setFormData(p => ({
                            ...p,
                            tags: [...(Array.isArray(p.tags) ? p.tags : []), tag]
                          }))}
                          className="flex items-center gap-1 px-2 py-1 rounded-full border bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300 text-xs transition-colors"
                        >
                          <Plus size={10} />
                          <span>{tag}</span>
                        </button>
                      ))}
                    {TAG_OPTIONS.every(tag => Array.isArray(formData.tags) && formData.tags.includes(tag)) && (
                      <span className="text-xs text-zinc-600 italic self-center">全部标签已添加</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ② CTA — only shown for Video / Image media_kind this milestone */}
              {(formData.media_kind === 'Video' || formData.media_kind === 'Image') && (
                <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur space-y-3">
                  <label className="block text-sm font-medium text-white">
                    CTA (v2) <span className="text-zinc-500 font-normal text-xs">— optional, Video/Image only</span>
                  </label>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">CTA Label</label>
                    <input
                      type="text"
                      maxLength={32}
                      value={formData.cta_label}
                      onChange={e => setFormData(p => ({ ...p, cta_label: e.target.value }))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g. Watch Now"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">CTA URL</label>
                    <input
                      type="url"
                      value={formData.cta_url}
                      onChange={e => setFormData(p => ({ ...p, cta_url: e.target.value }))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="https://..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">CTA Target</label>
                    <select
                      value={formData.cta_target}
                      onChange={e => setFormData(p => ({ ...p, cta_target: e.target.value }))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-full px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500 appearance-none"
                    >
                      <option value="_self">Current tab (_self)</option>
                      <option value="_blank">New tab (_blank)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* ③ Pin — boolean + order */}
              <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.pinned}
                    onChange={e => setFormData(p => ({ ...p, pinned: e.target.checked }))}
                    className="h-4 w-4 accent-blue-500"
                  />
                  Pin to top (v2)
                </label>
                {formData.pinned && (
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-1">Pin Order <span className="text-zinc-600">(lower = earlier)</span></label>
                    <input
                      type="number"
                      min="0"
                      value={formData.pin_order}
                      onChange={e => setFormData(p => ({ ...p, pin_order: e.target.value }))}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-4 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="e.g. 1"
                    />
                  </div>
                )}
              </div>

              {/* ④ Publish — toggle + read-only timestamp */}
              <div className="bg-zinc-950/50 p-4 rounded-xl border border-zinc-800 backdrop-blur space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.published}
                    onChange={e => setFormData(p => ({ ...p, published: e.target.checked }))}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  Published (v2) <span className="text-zinc-500 font-normal text-xs">— unchecked rows only visible to admin</span>
                </label>
                {formData.published_at && (
                  <div className="text-xs text-zinc-500">
                    First published at: <span className="font-mono">{formData.published_at}</span>
                  </div>
                )}
              </div>

              <div className="pt-4 mt-2 border-t border-zinc-800">
                <button 
                  type="submit" 
                  disabled={isSubmitting || isUploadingCover || isUploadingVideo}
                  className="w-full bg-white text-black font-semibold rounded-xl px-4 py-3 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving to Database...' : editingId ? 'Update Feed Item' : 'Add to Feed Engine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Runtime settings card — backed by public.system_settings (DB) via
 * /api/admin/system-settings. Lets admins tune behaviors without a
 * redeploy. Currently exposes:
 *   - lite_price_cooldown_hours — Lite price decay step (default 3)
 *
 * New settings: add to the migration's seed + to the worker's editable
 * VALIDATORS allow-list, then add a row here with a friendly label/help.
 */
const RuntimeSettingsCard = () => {
  const [settings, setSettings] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [drafts, setDrafts] = React.useState({});  // { key: editingValue }
  const [savingKey, setSavingKey] = React.useState(null);
  const [savedAt, setSavedAt] = React.useState({}); // { key: timestamp }

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/admin/system-settings', {
        headers: { 'Authorization': `Bearer ${session.access_token}` }
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setSettings(d.settings || []);
      // Reset drafts. For NON-secret rows mirror the persisted value (so
      // admin can see + inline-edit). For SECRET rows, leave draft EMPTY —
      // admin must type the new value to save (no echo of "••••abcd" mask).
      const dr = {};
      for (const s of (d.settings || [])) {
        dr[s.key] = s.is_secret ? '' : (s.value ?? '');
      }
      setDrafts(dr);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const handleSave = async (key) => {
    setSavingKey(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/admin/system-settings/update', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key, value: drafts[key] }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.errMessage || `HTTP ${r.status}`);
      setSavedAt(prev => ({ ...prev, [key]: Date.now() }));
      // Reload to see updated_by/updated_at refresh
      load();
    } catch (e) {
      alert(`Save failed for ${key}: ${e.message}`);
    } finally {
      setSavingKey(null);
    }
  };

  // Human-friendly labels + units per known key. Falls back to raw key
  // for any setting we haven't given a custom label.
  // §2026-05-15: grouped — secrets at top with rotation-prominent UX,
  // non-secrets below as regular text inputs.
  const LABELS = {
    // ─── Lite pricing ─────────────────────────────────────────────
    lite_price_cooldown_hours: {
      title: 'Lite price cooldown',
      suffix: 'hours',
      help: 'After this many hours of no Lite purchases, the price decays one tier ($7.99 → $5.99 → $3.99). Set to 0 to disable decay (price only ever goes up, capped at $7.99).',
      placeholder: '3',
      group: 'Lite pricing',
    },
    // ─── CF Stream watermark ─────────────────────────────────────
    stream_watermark_uid: {
      title: 'CF Stream watermark UID',
      suffix: '',
      help: 'Cloudflare Stream watermark UID applied to free/lite tier video output (burn-in). 32-char lowercase hex. Generate via scripts/setup-stream-watermark.mjs.',
      placeholder: '32-char hex UID',
      group: 'Video output',
    },
    // ─── BytePlus Seedance endpoints (non-secret model IDs) ──────
    seedance_fast_endpoint: {
      title: 'Seedance 2.0 Fast endpoint',
      suffix: '',
      help: 'BytePlus model endpoint ID for the Fast model. Free tier is locked to this. Form: ep-<14-digit-timestamp>-<hash>.',
      placeholder: 'ep-20260507183959-d7mr2',
      group: 'Video output',
    },
    seedance_standard_endpoint: {
      title: 'Seedance 2.0 Standard endpoint',
      suffix: '',
      help: 'BytePlus model endpoint ID for the Standard / Pro model. Paid tier opt-in. Form: ep-<14-digit-timestamp>-<hash>.',
      placeholder: 'ep-20260507184058-tpr79',
      group: 'Video output',
    },
    // ─── BytePlus secrets ────────────────────────────────────────
    byteplus_ark_api_key: {
      title: 'BytePlus ARK API key',
      suffix: '',
      help: 'Bearer token for ark.ap-southeast.bytepluses.com (video gen). Get from BytePlus console → API Keys. Falls back to Cloudflare env ARK_API_KEY if unset here.',
      placeholder: 'Paste new key to rotate',
      group: 'BytePlus secrets',
    },
    byteplus_ark_ak: {
      title: 'BytePlus Trusted Asset Library — AK',
      suffix: '',
      help: 'Access Key ID for Trusted Asset Library (real-person upload bypass). Get from BytePlus console → IAM → Access Keys. Falls back to Cloudflare env ARK_AK.',
      placeholder: 'Paste new AK to rotate',
      group: 'BytePlus secrets',
    },
    byteplus_ark_sk: {
      title: 'BytePlus Trusted Asset Library — SK',
      suffix: '',
      help: 'Secret Access Key for Trusted Asset Library. Pairs with AK above. Falls back to Cloudflare env ARK_SK.',
      placeholder: 'Paste new SK to rotate',
      group: 'BytePlus secrets',
    },
    byteplus_asset_project: {
      title: 'BytePlus Asset Library project name',
      suffix: '',
      help: 'BytePlus IAM project name the AK/SK has scope on (the trn:iam::project/<name> resource). Default HKBAIZE-005. If real-person fallback fails with "AccessDenied on resource trn:iam::project/X", change this to match the X in the error.',
      placeholder: 'HKBAIZE-005',
      group: 'BytePlus secrets',
    },
    // ─── OpenAI GPT-image-2 storyboard pipeline (§2026-05-21) ────────
    openai_api_key: {
      title: 'OpenAI API key (GPT-image-2 storyboard)',
      suffix: '',
      help: 'Bearer token for OpenAI Images API. Get from https://platform.openai.com/api-keys with permissions: Models:Read + Image generation. Required for the new storyboard pipeline (image-to-video short flow).',
      placeholder: 'Paste OpenAI sk-... key to rotate',
      group: 'OpenAI storyboard',
    },
    openai_image_model: {
      title: 'OpenAI image model',
      suffix: '',
      help: 'Model name passed to OpenAI Images API. Default: gpt-image-2. Fallback: gpt-image-1, dall-e-3. Switch here for instant rollback if the chosen model returns "model not found".',
      placeholder: 'gpt-image-2',
      group: 'OpenAI storyboard',
    },
    openai_image_quality: {
      title: 'OpenAI image quality',
      suffix: '',
      help: 'gpt-image-2 enum: low ($0.011) | medium ($0.042) | high ($0.167) | auto (model picks). Use "high" for cinematic — matches the old "hd" intent and aligns with 草帽小蔡 wide-format bias. (Legacy gpt-image-1 used "standard"/"hd" — those will error against gpt-image-2.)',
      placeholder: 'high',
      group: 'OpenAI storyboard',
    },
    openai_image_size: {
      title: 'OpenAI image size',
      suffix: 'pixels',
      help: 'Output dimensions. 1792x1024 (wide cinematic) is default — triggers cinematic bias per 草帽小蔡. Other options: 1024x1024, 1024x1792 (vertical for shorts).',
      placeholder: '1792x1024',
      group: 'OpenAI storyboard',
    },
    use_storyboard_pipeline: {
      title: 'Use storyboard pipeline (feature flag)',
      suffix: '',
      help: 'true (default since 2026-05-22) → GPT-image-2 storyboard pipeline = canonical flow. false → legacy Gemini concept-image rollback path. Flip to false if OpenAI quota / key has issues and you need instant rollback to the old Gemini flow.',
      placeholder: 'true',
      group: 'OpenAI storyboard',
    },

    // ─── §2026-05-26 fei (audit #9) — Drama paywall global config ────
    // Pre-2026-05-26 these required SQL into Supabase to change. Now editable
    // via this UI. Worker reads them via getSystemSetting at request time
    // (60s cache TTL). JSON-typed keys (ucoins_packages, drama_member_tiers,
    // llm_token_prices) are stored as JSON strings — paste/edit raw JSON
    // here; worker JSON.parse on read.
    default_revenue_share_pct: {
      title: '创作者分成默认 %',
      suffix: '%',
      help: 'Default percentage of distributable revenue paid to content creators in monthly settlements. Per-series override available via DramaAdminViews → 编辑剧集配置 → 分成比例. Range 0-100.',
      placeholder: '50',
      group: 'Drama paywall',
    },
    default_channel_fee_pct_web: {
      title: '渠道费 % (Web/Stripe)',
      suffix: '%',
      help: 'Channel processing fee deducted from GMV before split. Stripe ≈ 3% (default). iOS App Store would be 30%; configure a separate key per channel when shipping mobile.',
      placeholder: '3',
      group: 'Drama paywall',
    },
    default_platform_service_pct: {
      title: '平台服务费 %',
      suffix: '%',
      help: 'Platform service fee skimmed from GMV (separate from channel fee + revenue share). Goes entirely to platform_earnings_cents in each settlement row.',
      placeholder: '10',
      group: 'Drama paywall',
    },
    ucoins_to_usd_cents: {
      title: 'Tokens → USD 汇率 (cents)',
      suffix: 'cents per Token',
      help: 'Conversion rate for settlement math (gmv_cents = tokens_consumed × rate). §2026-06-09 货币合并:现值 5 = 1 Token 值 5¢,即 $1 = 20 Tokens。Change here cascades through all FUTURE settlements; historical ones lock their rate at generation time.',
      placeholder: '5',
      group: 'Drama paywall',
    },
    default_include_acquisition_cost: {
      title: '结算时扣除投流成本 (true/false)',
      suffix: '',
      help: 'When true, monthly settlements deduct series_acquisition_costs.amount_usd_cents from distributable. When false, acquisition costs are tracked only for ROI reporting. Default true since 2026-05-25.',
      placeholder: 'true',
      group: 'Drama paywall',
    },
    ucoins_packages: {
      title: 'Tokens 充值档位 (JSON)',
      suffix: '',
      help: 'JSON array of {id, price_cents, ucoins, bonus?, first_charge?, label?}(字段名沿用 ucoins,值现为 Token,$1 = 20 Tokens)。Each becomes a Stripe checkout button in Wallet「Top up」. Example: [{"id":"pkg_099","price_cents":99,"ucoins":40,"bonus":20,"first_charge":true,"label":"$0.99 首充翻倍"}]',
      placeholder: '[{"id":"pkg_199","price_cents":199,"ucoins":40,"label":"$1.99"}, ...]',
      group: 'Drama paywall',
    },
    drama_member_tiers: {
      title: '会员免费观看 — 等级白名单 (JSON)',
      suffix: '',
      help: 'JSON array of tier names that get free access when a series has member_free=true. Default ["starter","creator","studio"]. Tiers outside this list still need Tokens.',
      placeholder: '["starter","creator","studio"]',
      group: 'Drama paywall',
    },
    llm_token_prices: {
      title: 'LLM token 单价 (JSON, per million)',
      suffix: '',
      help: 'JSON map of model → {input_per_million_usd, output_per_million_usd}. Used by Generation Logs cost_usd. Update when vendor prices change. Example: {"gemini-3-flash-preview":{"input_per_million_usd":0.075,"output_per_million_usd":0.30}}',
      placeholder: '{"default":{"input_per_million_usd":0.1,"output_per_million_usd":0.4}, ...}',
      group: 'Drama paywall',
    },
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          ⚙️ Runtime configuration
        </h3>
        <p className="text-sm text-zinc-400 mt-1">
          Values stored in <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">public.system_settings</code>.
          Changes take effect within ~1 minute globally (Worker isolate cache TTL).
        </p>
      </div>

      <div className="p-6 space-y-5">
        {loading && <div className="text-zinc-400 text-sm">Loading…</div>}
        {error && <div className="text-red-400 text-sm">Failed: {error}</div>}
        {!loading && !error && settings.length === 0 && (
          <div className="text-zinc-500 text-sm">
            No settings yet. Run migration <code>20260514_system_settings.up.sql</code> to seed defaults.
          </div>
        )}
        {!loading && !error && (() => {
          // §2026-05-15: group settings by their LABELS[].group so admin
          // sees logically clustered controls (Lite pricing / Video output /
          // BytePlus secrets) instead of one long list. Unknown keys go
          // under "Other".
          const grouped = {};
          for (const s of settings) {
            const meta = LABELS[s.key] || { group: 'Other' };
            const g = meta.group || 'Other';
            if (!grouped[g]) grouped[g] = [];
            grouped[g].push(s);
          }
          const GROUP_ORDER = ['Lite pricing', 'Video output', 'BytePlus secrets', 'OpenAI storyboard', 'Other'];
          const sortedGroups = Object.keys(grouped).sort((a, b) => {
            const ai = GROUP_ORDER.indexOf(a);
            const bi = GROUP_ORDER.indexOf(b);
            if (ai === -1 && bi === -1) return a.localeCompare(b);
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });

          return sortedGroups.map(group => (
            <div key={group} className="space-y-4">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-zinc-500 pt-2 border-t border-zinc-800/50 first:border-t-0 first:pt-0">
                {group}
              </div>
              {grouped[group].map(s => {
                const meta = LABELS[s.key] || { title: s.key, suffix: '', help: s.description || '', placeholder: '' };
                const isSecret = !!s.is_secret;
                const isConfigured = isSecret ? (s.configured || !!s.value) : !!s.value;
                // For secrets: dirty whenever draft is non-empty (user typed something).
                // For non-secrets: dirty when draft != saved value.
                const isDirty = isSecret
                  ? (drafts[s.key] || '').length > 0
                  : drafts[s.key] !== (s.value ?? '');
                const isSaving = savingKey === s.key;
                const justSaved = savedAt[s.key] && Date.now() - savedAt[s.key] < 2000;

                return (
                  <div key={s.key} className="space-y-2">
                    <label className="block">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <span className="text-sm font-medium text-white flex items-center gap-2">
                          {meta.title}
                          {isSecret && (
                            isConfigured ? (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/40">
                                ✓ configured
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40">
                                ⚠ not set (using Cloudflare env fallback)
                              </span>
                            )
                          )}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-mono">{s.key}</span>
                      </div>
                      {meta.help && (
                        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{meta.help}</p>
                      )}
                      {isSecret && isConfigured && (
                        <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                          Current: <span className="text-zinc-400">{s.value}</span>
                          {s.updated_at && <span className="ml-2 text-zinc-600">(set {new Date(s.updated_at).toLocaleDateString()})</span>}
                        </p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          type={isSecret ? 'password' : 'text'}
                          autoComplete={isSecret ? 'new-password' : 'off'}
                          value={drafts[s.key] ?? ''}
                          onChange={(e) => setDrafts(prev => ({ ...prev, [s.key]: e.target.value }))}
                          placeholder={meta.placeholder}
                          disabled={isSaving}
                          className="flex-1 px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 text-white rounded-md focus:outline-none focus:border-blue-600 disabled:opacity-50 font-mono"
                        />
                        {meta.suffix && (
                          <span className="text-xs text-zinc-500">{meta.suffix}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleSave(s.key)}
                          disabled={!isDirty || isSaving}
                          className={`px-4 py-2 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            justSaved
                              ? 'bg-emerald-600 text-white'
                              : isDirty
                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                : 'bg-zinc-800 text-zinc-500'
                          }`}
                        >
                          {isSaving ? 'Saving…' : justSaved ? '✓ Saved' : (isSecret && isConfigured ? 'Rotate' : 'Save')}
                        </button>
                      </div>
                    </label>
                    <div className="text-[10px] text-zinc-600 flex items-center gap-2">
                      {s.updated_at && !isSecret && (
                        <span>Last updated {new Date(s.updated_at).toLocaleString()}</span>
                      )}
                      {s.updated_by_user && (
                        <span>· by {s.updated_by_user.email || s.updated_by_user.name}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ));
        })()}
      </div>
    </div>
  );
};

/**
 * OpenAI GPT-image-2 connectivity test card.
 *
 * Triggers /api/admin/openai/test which calls OpenAI Images API with the
 * admin's currently-configured model + size + quality, stores result to
 * R2, and returns either:
 *   - success: image URL + revised prompt + cost + latency
 *   - failure: status + error + ACTIONABLE hint (model not found / 401 /
 *     rate limit / size unsupported)
 *
 * Designed as the "click this before flipping use_storyboard_pipeline"
 * confidence check. Made an early surfacing of issues like:
 *   - sk-proj-... key typo (truncation during paste)
 *   - "gpt-image-2" doesn't exist → tells admin to switch to gpt-image-1
 *   - quality+size combo unsupported by model
 *
 * Cost note: each test consumes real OpenAI quota at the configured
 * size+quality (~$0.04 standard 1024px / ~$0.17 HD 1792px). Button
 * label includes a cost estimate so admin doesn't accidentally spam.
 */
const OpenAITestCard = () => {
  const [isTesting, setIsTesting] = React.useState(false);
  const [result, setResult] = React.useState(null);  // { success, message, imageUrl?, hint?, ... }
  const [customPrompt, setCustomPrompt] = React.useState('');
  const [showPromptInput, setShowPromptInput] = React.useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setResult({ status: 'pending', message: 'Calling OpenAI Images API…' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/admin/openai/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(customPrompt.trim() ? { prompt: customPrompt.trim() } : {}),
      });
      const d = await r.json();
      setResult(d);
    } catch (e) {
      setResult({ success: false, message: 'Network error: ' + e.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          🎨 OpenAI GPT-image-2 connectivity
        </h3>
        <p className="text-sm text-zinc-400 mt-1">
          Verifies the configured <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">openai_api_key</code> + model + size combo works before you flip <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">use_storyboard_pipeline</code> in production. Real OpenAI call — consumes ~$0.04 (standard) to ~$0.17 (HD) per click.
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* Optional custom prompt — collapsed by default to keep UI calm */}
        <div>
          <button
            type="button"
            onClick={() => setShowPromptInput(s => !s)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showPromptInput ? '▼' : '▶'} Custom test prompt (optional)
          </button>
          {showPromptInput && (
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Leave blank to use the default minimalist prompt (red apple on wooden table). Override here to test a specific scene description."
              rows={3}
              className="mt-2 w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 text-white rounded-md focus:outline-none focus:border-blue-600 font-mono"
            />
          )}
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting}
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isTesting ? 'Generating…' : '🚀 Test OpenAI image gen'}
          </button>
          <span className="text-xs text-zinc-500">
            Uses your live configured model + size + quality.
          </span>
        </div>

        {/* Result panel */}
        {result?.status === 'pending' && (
          <div className="p-3 rounded-lg text-xs font-mono whitespace-pre-wrap border bg-zinc-950 border-zinc-700 text-zinc-400">
            ⏳ {result.message}
          </div>
        )}

        {result && result.status !== 'pending' && result.success && (
          <div className="p-3 rounded-lg text-xs border bg-emerald-500/10 border-emerald-500/20 text-emerald-300 space-y-2">
            <div className="font-mono">✅ {result.message}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-emerald-200/80">
              <div>Model: <span className="text-emerald-100">{result.model}</span></div>
              <div>Size: <span className="text-emerald-100">{result.size}</span></div>
              <div>Quality: <span className="text-emerald-100">{result.quality}</span></div>
              <div>Latency: <span className="text-emerald-100">{(result.elapsedMs / 1000).toFixed(1)}s</span></div>
              <div>File size: <span className="text-emerald-100">{result.fileSizeKb} KB</span></div>
              <div>Cost: <span className="text-emerald-100">~${result.costUsd?.toFixed(2)}</span></div>
            </div>
            {result.imageUrl && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 mb-2">Preview</div>
                <a
                  href={result.imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg overflow-hidden border border-emerald-500/30 hover:border-emerald-500/60 transition-colors"
                >
                  <img
                    src={result.imageUrl}
                    alt="OpenAI test output"
                    className="w-full max-h-[400px] object-contain bg-zinc-950"
                  />
                </a>
                <div className="mt-1.5 text-[10px] text-emerald-400/60 font-mono break-all">
                  {result.imageUrl}
                </div>
              </div>
            )}
            {result.revisedPrompt && (
              <details className="mt-2">
                <summary className="text-[10px] text-emerald-400 cursor-pointer hover:text-emerald-300">▶ Revised prompt (OpenAI rewrites prompts internally)</summary>
                <div className="mt-1 text-[10px] font-mono text-emerald-200/70 bg-emerald-950/30 p-2 rounded">
                  {result.revisedPrompt}
                </div>
              </details>
            )}
            <div className="mt-2 text-[10px] text-emerald-400/80">
              💡 Safe to flip <code className="bg-emerald-950/40 px-1 rounded">use_storyboard_pipeline = true</code> in Runtime configuration now.
            </div>
          </div>
        )}

        {result && result.status !== 'pending' && !result.success && (
          <div className="p-3 rounded-lg text-xs border bg-red-500/10 border-red-500/20 text-red-300 space-y-2">
            <div className="font-mono">
              ❌ {result.message}
              {result.status > 0 && <span className="text-red-400/60"> (HTTP {result.status})</span>}
              {result.errorCode && <span className="text-red-400/60"> [{result.errorCode}]</span>}
            </div>
            {result.hint && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                💡 <strong>Hint:</strong> {result.hint}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-red-300/60 mt-2">
              {result.model && <div>Model: <span className="text-red-200">{result.model}</span></div>}
              {result.size && <div>Size: <span className="text-red-200">{result.size}</span></div>}
              {result.quality && <div>Quality: <span className="text-red-200">{result.quality}</span></div>}
              {result.elapsedMs && <div>Latency: <span className="text-red-200">{(result.elapsedMs / 1000).toFixed(1)}s</span></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * BytePlus Trusted Asset Library connectivity test card.
 *
 * §2026-05-22 fei: parallels OpenAITestCard. Triggers
 * /api/admin/byteplus/test which does the full asset-library round-trip
 * (ListAssetGroups → CreateAssetGroup if needed → CreateAsset → poll
 * GetAsset until Active) with the currently-configured AK/SK + project.
 *
 * Use as the "click here when you switch BytePlus accounts" check.
 * Most common diagnosis: AK rotated but byteplus_asset_project still
 * points at the old account's project → IAM 403. Test surfaces the
 * actionable hint inline so admin can fix without digging through CF
 * Worker Logs.
 *
 * Cost: trivial. Each test uploads one tiny image to the asset library
 * + polls until Active. Asset library has plenty of headroom unless
 * you're shipping production at scale.
 */
const BytePlusTestCard = () => {
  const [isTesting, setIsTesting] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [customImageUrl, setCustomImageUrl] = React.useState('');
  const [showImageInput, setShowImageInput] = React.useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setResult({ status: 'pending', message: 'Round-tripping BytePlus Asset Library (ListGroups → CreateAsset → poll Active)…' });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const r = await fetch('/api/admin/byteplus/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(customImageUrl.trim() ? { imageUrl: customImageUrl.trim() } : {}),
      });
      const d = await r.json();
      setResult(d);
    } catch (e) {
      setResult({ success: false, message: 'Network error: ' + e.message });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          🗂️ BytePlus Trusted Asset Library
        </h3>
        <p className="text-sm text-zinc-400 mt-1">
          Verifies the configured <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">byteplus_ark_ak</code> / <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">byteplus_ark_sk</code> / <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">byteplus_asset_project</code> combo works. Run this after switching BytePlus accounts — the most common failure is "AK rotated but project name still pointing at the old account".
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* Optional custom test image URL — collapsed by default */}
        <div>
          <button
            type="button"
            onClick={() => setShowImageInput(s => !s)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showImageInput ? '▼' : '▶'} Custom test image URL (optional)
          </button>
          {showImageInput && (
            <input
              type="text"
              value={customImageUrl}
              onChange={(e) => setCustomImageUrl(e.target.value)}
              placeholder="https://... (must be publicly fetchable by BytePlus servers). Default: uvera.ai/styles/ghibli.jpg"
              className="mt-2 w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 text-white rounded-md focus:outline-none focus:border-blue-600 font-mono"
            />
          )}
        </div>

        <div className="flex gap-3 items-center flex-wrap">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting}
            className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            {isTesting ? 'Testing…' : '🚀 Test asset library upload'}
          </button>
          <span className="text-xs text-zinc-500">
            Uses your live AK/SK + project name.
          </span>
        </div>

        {/* Result panel */}
        {result?.status === 'pending' && (
          <div className="p-3 rounded-lg text-xs font-mono whitespace-pre-wrap border bg-zinc-950 border-zinc-700 text-zinc-400">
            ⏳ {result.message}
          </div>
        )}

        {result && result.status !== 'pending' && result.success && (
          <div className="p-3 rounded-lg text-xs border bg-emerald-500/10 border-emerald-500/20 text-emerald-300 space-y-2">
            <div className="font-mono">✅ {result.message}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-emerald-200/80">
              <div>Project: <span className="text-emerald-100">{result.project}</span></div>
              <div>AK: <span className="text-emerald-100">{result.akPrefix}</span></div>
              <div>Latency: <span className="text-emerald-100">{(result.elapsedMs / 1000).toFixed(1)}s</span></div>
              <div>Asset ID: <span className="text-emerald-100 break-all">{result.assetId}</span></div>
            </div>
            <details className="mt-2">
              <summary className="text-[10px] text-emerald-400 cursor-pointer hover:text-emerald-300">▶ Asset URI (use as image_url in Seedance API)</summary>
              <div className="mt-1 text-[10px] font-mono text-emerald-200/70 bg-emerald-950/30 p-2 rounded break-all">
                {result.assetUri}
              </div>
            </details>
            <div className="mt-2 text-[10px] text-emerald-400/80">
              💡 Real-person reference fallback path will work — when Seedance rejects a raw URL, worker auto-uploads to this library and retries with <code className="bg-emerald-950/40 px-1 rounded">asset://</code> URI.
            </div>
          </div>
        )}

        {result && result.status !== 'pending' && !result.success && (
          <div className="p-3 rounded-lg text-xs border bg-red-500/10 border-red-500/20 text-red-300 space-y-2">
            <div className="font-mono whitespace-pre-wrap">
              ❌ {result.message}
              {result.status > 0 && result.status !== 500 && <span className="text-red-400/60"> (HTTP {result.status})</span>}
            </div>
            {result.hint && (
              <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
                💡 <strong>Hint:</strong> {result.hint}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-red-300/60 mt-2">
              {result.project && <div>Project: <span className="text-red-200">{result.project}</span></div>}
              {result.akPrefix && <div>AK: <span className="text-red-200">{result.akPrefix}</span></div>}
              {result.elapsedMs && <div>Latency: <span className="text-red-200">{(result.elapsedMs / 1000).toFixed(1)}s</span></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * MigrateVideosCard — §2026-05-22 fei
 *
 * One-click batch migration of legacy non-Stream videos (R2 .mp4 / Volces
 * TOS) to Cloudflare Stream. Auto-grabs JWT from current admin session
 * via supabase.auth.getSession() — no manual copy/paste from devtools.
 *
 * Calls POST /api/admin/migrate-videos-to-stream in batches:
 *   1. dry-run first (preview candidates, no mutation)
 *   2. real migration in batches of 10 until no candidates left
 *   3. live progress + per-row results
 *
 * Mistakes are localized to a single row (CF Stream copy might fail for
 * expired TOS URLs); migration continues. Worker side returns per-row
 * status (migrated | failed) so we can show the user exactly what's
 * happening.
 */
const MigrateVideosCard = () => {
  const [phase, setPhase] = useState('idle');  // idle | preview | running | done
  const [preview, setPreview] = useState(null);  // dry-run result
  const [progress, setProgress] = useState({ batches: 0, migrated: 0, failed: 0, items: [] });
  const [error, setError] = useState('');
  // §2026-05-23 fei: elapsed-time ticker so user knows long batches (90s
  //   poll-until-ready × 2 rows) are actually progressing, not hung.
  //   We don't read `tick` directly — the setTick call triggers a re-render
  //   which causes `elapsed = (Date.now() - batchStartedAt) / 1000` to refresh.
  const [batchStartedAt, setBatchStartedAt] = useState(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== 'running' || !batchStartedAt) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [phase, batchStartedAt]);

  const getJwt = async () => {
    const { data, error: sessErr } = await supabase.auth.getSession();
    if (sessErr || !data?.session?.access_token) {
      throw new Error('Not logged in or session expired. Please refresh and re-login.');
    }
    return data.session.access_token;
  };

  const callBatch = async (jwt, opts) => {
    const res = await fetch('/api/admin/migrate-videos-to-stream', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(`HTTP ${res.status}: ${json?.errMessage || res.statusText}`);
    }
    return json;
  };

  // §2026-05-22 fei round-3: status-check for already-migrated videos.
  //   Diagnostic — answers "which of my Stream URLs are actually playable
  //   right now?" Useful for finding rows where the early migration
  //   PATCH'd DB before Stream finished transcoding (or where Stream
  //   itself errored). Calls /api/admin/check-stream-status and shows
  //   per-row state with errorReason if any.
  const [streamStatus, setStreamStatus] = useState(null);
  const runStatusCheck = async () => {
    setError('');
    setStreamStatus({ loading: true });
    try {
      const jwt = await getJwt();
      const res = await fetch('/api/admin/check-stream-status', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(`HTTP ${res.status}: ${json?.errMessage || res.statusText}`);
      setStreamStatus(json);
    } catch (err) {
      setError(err.message);
      setStreamStatus(null);
    }
  };

  const runPreview = async () => {
    setError('');
    setPreview(null);
    setPhase('preview');
    try {
      const jwt = await getJwt();
      const json = await callBatch(jwt, { dryRun: true, limit: 100 });
      setPreview(json);
    } catch (err) {
      setError(err.message);
    } finally {
      // §2026-05-23 fei: critical fix — runPreview previously left phase='preview'
      //   on success, so the spinner span forever and the preview panel (which
      //   only renders when phase==='idle' && preview) never appeared. Reset
      //   phase here in finally so both success + error paths return to idle.
      setPhase('idle');
    }
  };

  const runMigration = async () => {
    setError('');
    setPhase('running');
    setProgress({ batches: 0, migrated: 0, failed: 0, items: [] });
    setBatchStartedAt(Date.now());
    console.log('[MigrateVideos] starting…');
    try {
      const jwt = await getJwt();
      let batches = 0;
      let migrated = 0;
      let failed = 0;
      let allItems = [];
      // §2026-05-22 fei round-2: batch reduced 10 → 2.
      //   Worker now polls CF Stream 45s/video before PATCH (so DB never
      //   has non-playable URL). 2 videos × 45s = 90s per batch, fits
      //   inside CF Worker wall-time limits. Frontend loops batches —
      //   slower per batch but rock-solid playability after each.
      // Hard cap 250 batches × 2 rows = 500 videos max per session — defensive.
      while (batches < 250) {
        setBatchStartedAt(Date.now());  // reset timer per batch
        console.log(`[MigrateVideos] requesting batch ${batches + 1}…`);
        const json = await callBatch(jwt, { limit: 2 });
        console.log(`[MigrateVideos] batch ${batches + 1} response:`, json);
        if (!json.items || json.items.length === 0) {
          console.log('[MigrateVideos] no more candidates — done.');
          break;
        }
        batches++;
        migrated += json.migrated || 0;
        failed += json.failed || 0;
        allItems = [...allItems, ...json.items];
        setProgress({ batches, migrated, failed, items: allItems });
        if (json.migrated === 0 && json.failed === 0) {
          console.log('[MigrateVideos] batch returned items but 0 actionable — stopping.');
          break;  // nothing actionable left
        }
      }
      setPhase('done');
    } catch (err) {
      console.error('[MigrateVideos] error:', err);
      setError(err.message);
      setPhase('done');
    } finally {
      setBatchStartedAt(null);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800">
        <h3 className="text-lg font-medium text-white flex items-center gap-2">
          🎬 Migrate legacy videos → Cloudflare Stream
        </h3>
        <p className="text-sm text-zinc-400 mt-1">
          Pulls all <code className="text-amber-300 text-xs">recommended_content</code> rows whose
          <code className="text-amber-300 text-xs"> video</code> field is on R2 (<code className="text-xs">asset.uvera.ai</code>) or
          Volcengine (<code className="text-xs">volces.com</code>) and migrates them to Cloudflare Stream
          via Stream's copy-from-URL API. CF Stream pulls the source directly — zero bandwidth through this worker.
          DB <code className="text-amber-300 text-xs">video</code> column gets updated to the
          <code className="text-xs"> iframe.cloudflarestream.com/&lt;uid&gt;</code> URL immediately.
          Stream transcodes async (1-3 min); old playback URLs return "processing" until ready.
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* §2026-05-23 fei: action buttons ALWAYS visible. Previously gated
            by `phase === 'idle'`, which meant after any operation finished
            the entire card could go blank if no result-panel happened to
            match the current state. Now buttons stay put, just disabled
            while busy, so the user can always tell the card is alive. */}
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={runPreview}
            disabled={phase === 'preview' || phase === 'running'}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            🔍 Preview candidates (dry-run)
          </button>
          <button
            onClick={runMigration}
            disabled={phase === 'preview' || phase === 'running'}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            ▶️ Start migration
          </button>
          <button
            onClick={runStatusCheck}
            disabled={phase === 'preview' || phase === 'running' || streamStatus?.loading}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
            title="Check which of the already-migrated Stream URLs are actually playable right now"
          >
            🏥 Diagnose Stream URLs
          </button>
        </div>

        {/* Stream status check results */}
        {streamStatus?.loading && (
          <div className="text-sm text-zinc-300 flex items-center gap-2">
            <CircleNotch size={16} className="animate-spin text-zinc-400" />
            Checking Stream status for migrated videos...
          </div>
        )}
        {streamStatus && !streamStatus.loading && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-300 mb-2">
              Checked: <span className="text-blue-400">{streamStatus.checked}</span>
              <span className="mx-2">·</span>
              ✓ Ready: <span className="text-green-400">{streamStatus.ready}</span>
              <span className="mx-2">·</span>
              ⏳ Processing: <span className="text-amber-400">{streamStatus.processing}</span>
              {streamStatus.errored > 0 && (
                <>
                  <span className="mx-2">·</span>
                  ✘ Errored: <span className="text-red-400">{streamStatus.errored}</span>
                </>
              )}
            </div>
            <div className="text-xs max-h-72 overflow-y-auto space-y-0.5 font-mono">
              {streamStatus.items?.map(item => {
                const color = item.state === 'ready' ? 'text-green-300'
                            : item.state === 'error' || item.state === 'not-found' || item.state?.startsWith('http-') || item.state === 'fetch-failed' ? 'text-red-300'
                            : 'text-amber-300';
                const icon = item.state === 'ready' ? '✓'
                           : item.state === 'error' || item.state === 'not-found' ? '✘'
                           : '⏳';
                return (
                  <div key={item.id} className={color}>
                    {icon} {item.id.slice(0, 8)}{' '}
                    <span className="text-zinc-400">{item.title || '(no title)'}</span>{' '}
                    <span className="text-zinc-600">{item.uid?.slice(0, 12)}... [{item.state}]</span>
                    {item.errorReason && <span className="text-red-500"> · {item.errorReason}</span>}
                    {item.pctComplete != null && item.state !== 'ready' && (
                      <span className="text-zinc-500"> · {item.pctComplete}%</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setStreamStatus(null)}
              className="mt-3 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-xs font-medium transition-colors"
            >
              Close
            </button>
          </div>
        )}

        {phase === 'preview' && (
          <div className="text-sm text-zinc-300 flex items-center gap-2">
            <CircleNotch size={16} className="animate-spin text-blue-400" />
            Loading candidates...
          </div>
        )}

        {phase === 'running' && (() => {
          // §2026-05-23 fei: each batch waits up to 45s × 2 rows = ~90s
          //   for CF Stream poll-until-ready, so showing a live elapsed
          //   counter is essential — otherwise users think it's hung.
          const elapsed = batchStartedAt ? Math.floor((Date.now() - batchStartedAt) / 1000) : 0;
          const tooLong = elapsed > 120;  // soft warn threshold
          return (
            <div className={`text-sm flex items-center gap-2 ${tooLong ? 'text-red-300' : 'text-zinc-300'}`}>
              <CircleNotch size={16} className={`animate-spin ${tooLong ? 'text-red-400' : 'text-amber-400'}`} />
              Migrating batch {progress.batches + 1}... ({progress.migrated} done, {progress.failed} failed)
              <span className="text-zinc-500 ml-1">· {elapsed}s elapsed</span>
              {tooLong && <span className="text-red-400 ml-1">· batch taking longer than expected</span>}
            </div>
          );
        })()}

        {/* Preview result — always shown when preview is set, regardless of phase. */}
        {preview && phase !== 'preview' && (
          <div className={`border rounded-lg p-4 ${preview.processed === 0 ? 'bg-emerald-950/30 border-emerald-900' : 'bg-zinc-950 border-zinc-800'}`}>
            {preview.processed === 0 ? (
              <div className="text-sm text-emerald-300">
                ✓ Preview: <span className="font-medium">0 candidates</span> — all videos are already on Cloudflare Stream, nothing to migrate.
                {preview.skipped > 0 && <span className="text-emerald-400/70"> ({preview.skipped} already-on-Stream rows skipped.)</span>}
              </div>
            ) : (
              <>
                <div className="text-sm text-zinc-300 mb-2">
                  <span className="text-blue-400 font-medium">{preview.processed}</span> candidates found
                  {preview.skipped > 0 && <span className="text-zinc-500"> · {preview.skipped} already on Stream (skipped)</span>}
                </div>
                <div className="text-xs text-zinc-500 max-h-40 overflow-y-auto space-y-0.5">
                  {(preview.items || []).slice(0, 20).map(item => (
                    <div key={item.id} className="font-mono">
                      <span className="text-zinc-600">{item.id.slice(0, 8)}</span>{' '}
                      <span className="text-zinc-400">{item.title || '(no title)'}</span>{' '}
                      <span className="text-zinc-600">→ {item.oldUrl.slice(0, 50)}…</span>
                    </div>
                  ))}
                  {preview.items?.length > 20 && <div className="text-zinc-600 italic">+{preview.items.length - 20} more...</div>}
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={runMigration}
                    disabled={phase === 'running'}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    ▶️ Migrate {preview.processed} videos
                  </button>
                  <button
                    onClick={() => setPreview(null)}
                    className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Migration result — always shown when phase === 'done', even with 0 items. */}
        {phase === 'done' && progress.items.length === 0 && (
          <div className="bg-emerald-950/30 border border-emerald-900 rounded-lg p-4">
            <div className="text-sm text-emerald-300 mb-3">
              ✓ Migration complete — <span className="font-medium">0 videos migrated</span>.
              All videos are already on Cloudflare Stream, nothing left to do.
            </div>
            <button
              onClick={() => { setPhase('idle'); setProgress({ batches: 0, migrated: 0, failed: 0, items: [] }); setPreview(null); }}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {(phase === 'running' || phase === 'done') && progress.items.length > 0 && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-4">
            <div className="text-sm text-zinc-300 mb-2">
              Batches: <span className="text-blue-400">{progress.batches}</span>
              <span className="mx-2">·</span>
              ✓ Migrated: <span className="text-green-400">{progress.migrated}</span>
              {progress.failed > 0 && (
                <>
                  <span className="mx-2">·</span>
                  ✘ Failed: <span className="text-red-400">{progress.failed}</span>
                </>
              )}
            </div>
            <div className="text-xs max-h-60 overflow-y-auto space-y-0.5 font-mono">
              {progress.items.map(item => {
                /* §2026-05-22 fei round-2: 3 row states now:
                   · 'migrated' → ✅ green, ready to play immediately
                   · 'patched-while-processing' → ⏳ amber, DB patched
                     but Stream still transcoding (~30-90s more). Video
                     will work after Stream finishes async, no action needed.
                   · 'failed' → ✘ red, DB unchanged, retry later */
                const color = item.status === 'migrated' ? 'text-green-300'
                            : item.status === 'patched-while-processing' ? 'text-amber-300'
                            : 'text-red-300';
                const icon = item.status === 'migrated' ? '✓'
                           : item.status === 'patched-while-processing' ? '⏳'
                           : '✘';
                return (
                  <div key={item.id} className={color}>
                    {icon} {item.id.slice(0, 8)}{' '}
                    <span className="text-zinc-400">{item.title || '(no title)'}</span>{' '}
                    {item.status === 'failed'
                      ? <span className="text-red-500">{item.error?.slice(0, 80)}</span>
                      : <span className="text-zinc-600">→ {item.uid}{item.status === 'patched-while-processing' ? ' (transcoding...)' : ''}</span>}
                  </div>
                );
              })}
            </div>
            {phase === 'done' && (
              <button
                onClick={() => { setPhase('idle'); setProgress({ batches: 0, migrated: 0, failed: 0, items: [] }); setPreview(null); }}
                className="mt-3 px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Done · Run again
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-950/30 border border-red-900 rounded-lg p-3 text-sm text-red-300">
            ✘ {error}
          </div>
        )}
      </div>
    </div>
  );
};

const SystemSettingsView = () => {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState('');

  // No input / show / save UI for the ARK key — the key only lives in
  // Cloudflare Worker secrets (set via `wrangler secret put ARK_API_KEY`).
  // Storing or echoing it from the dashboard creates a leak vector for any
  // admin session that gets compromised. This view exposes only the read-
  // only "test the configured key" action, which never returns the key
  // itself, just whether the deployed Worker can reach BytePlus with it.

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult('⏳ Submitting a tiny test task to BytePlus Dreamina Seedance 2.0…');
    try {
      const res = await fetch('/api/volcengine/video/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'A tranquil lake at sunset, cinematic, 4k',
          duration: 5,
          ratio: '16:9',
          resolution: '480p',
          generateAudio: false
        })
      });
      const data = await res.json();
      if (data.success && data.taskId) {
        setTestResult(`✅ Worker secret is configured and BytePlus accepted the task. Task ID: ${data.taskId}`);
      } else {
        setTestResult('❌ Test failed: ' + (data.errMessage || JSON.stringify(data)));
      }
    } catch (err) {
      setTestResult('❌ Network error: ' + err.message);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="max-w-[672px] space-y-6">
      {/* Runtime configuration — DB-backed tunable values (Lite cooldown, etc.) */}
      <RuntimeSettingsCard />

      {/* OpenAI GPT-image-2 connectivity test — confidence check before
          flipping use_storyboard_pipeline=true. Uses the admin-configured
          model + quality + size so the test reflects real-world cost +
          behavior. Stores the result image to R2 for inline preview. */}
      <OpenAITestCard />

      {/* §2026-05-22 fei: BytePlus Trusted Asset Library round-trip test.
          Run after switching BytePlus accounts to verify AK/SK + project
          name match. The asset library is the real-person-reference
          bypass path — if it fails, all real-person video gens degrade
          to text-only fallback (no character match). */}
      <BytePlusTestCard />

      {/* §2026-05-22 fei: one-click migration of legacy R2/TOS videos to
          Cloudflare Stream. Auto-pulls JWT from current admin session
          (no manual copy-paste needed). Calls /api/admin/migrate-videos-
          to-stream in batches, shows live progress. */}
      <MigrateVideosCard />

      {/* ARK API Key — no input, no display, just a connectivity test. */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            🔑 BytePlus ARK API Key
          </h3>
          <p className="text-sm text-zinc-400 mt-1">
            The key is stored only as a Cloudflare Worker secret. It cannot be viewed or edited here — that's intentional, to keep the secret out of any admin session. To rotate, run{' '}
            <code className="bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-300">npx wrangler secret put ARK_API_KEY</code>{' '}
            from the project root.
          </p>
        </div>

        <div className="p-6 space-y-4">
          <div className="flex gap-3 items-center">
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            >
              {isTesting ? 'Testing…' : '🚀 Test connectivity'}
            </button>
            <span className="text-xs text-zinc-500">
              Submits a 5s 480p test render to verify the deployed key works.
            </span>
          </div>

          {testResult && (
            <pre className={`p-3 rounded-lg text-xs font-mono whitespace-pre-wrap border ${testResult.startsWith('✅') ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : testResult.startsWith('⏳') ? 'bg-zinc-950 border-zinc-700 text-zinc-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
              {testResult}
            </pre>
          )}
        </div>
      </div>

      {/* Config Info Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 space-y-3">
        <h4 className="text-sm font-medium text-white">Current video generation config</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            ['Model',          'dreamina-seedance-2-0'],
            ['Resolution',     '480p'],
            ['Duration',       '5 s'],
            ['Aspect ratio',   '16:9'],
            ['Audio',          'off'],
            ['Image model',    'gemini-3.1-flash-image-preview'],
            ['Image relay',    'ga.neodomain.cn'],
            ['Video storage',  'Cloudflare R2 (asset.uvera.ai)'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-2 border-b border-zinc-800">
              <span className="text-zinc-500">{label}</span>
              <span className="text-zinc-200 font-mono">{value}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-zinc-600 pt-1">
          To change resolution / duration / etc., edit{' '}
          <code className="text-zinc-400">StoryGeneratorPage.jsx</code> and{' '}
          <code className="text-zinc-400">_worker.js</code> directly.
        </p>
      </div>
    </div>
  );
};


export default function AdminDashboard() {
  const navigate = useNavigate();
  /* §2026-05-29 Leon round-104 — activeTab 从 URL ?tab=X 同步,刷新不丢 state。
   * 'users' 是默认 tab,URL 不写参数即 'users' (干净的 /admin/dashboard URL)。
   * setActiveTab 保持原 signature ((next) => void),所有现有调用点不动。 */
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const activeTab = VALID_ADMIN_TABS.has(tabFromUrl) ? tabFromUrl : 'users';
  const setActiveTab = useCallback((next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'users') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params);
  }, [searchParams, setSearchParams]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Data states
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [works, setWorks] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = async (isManualRefresh = false) => {
    const isAdmin = await checkAdminAuth();
    if (!isAdmin) {
      navigate('/admin');
      return;
    }
    // Two-tier role: super admins also see System Settings.
    // Resolved before first render so the tab list is stable.
    const superAdmin = await checkSuperAdmin();
    setIsSuperAdmin(superAdmin);
    if (isManualRefresh) {
      setLoading(true);
    }
    try {
      const [u, o, w, feed] = await Promise.all([
        fetchRegisteredUsers(),
        fetchPaymentOrders(),
        fetchUserWorks(),
        fetchRecommendedContentAdmin()
      ]);
      setUsers(u);
      setOrders(o);
      setWorks(w);
      setItems(feed);
    } catch (err) {
      console.error('Failed to load admin data', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [navigate]);

  // Defensive: if a non-super admin somehow lands on the System tab
  // (e.g. role downgrade in another tab), bounce them back to Users.
  useEffect(() => {
    if (!isSuperAdmin && activeTab === 'system') {
      setActiveTab('users');
    }
  }, [isSuperAdmin, activeTab]);

  const handleRefresh = () => {
    loadData(true);
  };

  const handleLogout = async () => {
    await logoutAdmin();
    navigate('/admin');
  };

  // System Settings is super-admin-only. Regular admins (the 6 ops
  // accounts seeded in migrations/20260507_admin_roles.up.sql) get
  // every other tab. The tab is also rendered conditionally below
  // so a stale `activeTab` state can't surface SystemSettingsView.
  const allMenuItems = [
    { id: 'admins', label: 'Admins', icon: ShieldCheck },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'orders', label: 'Payments & Orders', icon: CreditCard },
    { id: 'works', label: 'User Works', icon: PlayCircle },
    { id: 'videos', label: 'User Videos (Review)', icon: VideoCamera },
    { id: 'reports', label: 'Reports', icon: Flag },
    { id: 'logs', label: 'Generation Logs', icon: ChartBar },
    { id: 'config', label: 'Homepage Feed', icon: Database },
    // §2026-05-25 fei — Phase 1 / 2 短剧付费
    { id: 'drama-revenue',     label: '剧集收益',   icon: DramaCoin },
    { id: 'drama-series',      label: '剧集管理',   icon: FilmReel },
    { id: 'drama-settlements', label: '分成结算',   icon: ReceiptIcon },
    { id: 'drama-ledger',      label: '付费流水',   icon: WalletIcon },
    { id: 'drama-acquisition', label: '投流 ROI',   icon: Megaphone },
    { id: 'credits', label: 'Credit Grants', icon: Coins },
    { id: 'beta', label: 'Beta Requests', icon: PaintBrush },
    { id: 'help', label: 'Help Articles', icon: Question },
    { id: 'devlog', label: 'Dev Log', icon: FileText },
    { id: 'chat', label: 'Team Chat', icon: ChatCircleDots },
    { id: 'system', label: 'System Settings', icon: GearSix, requiresSuper: true },
  ];
  const menuItems = allMenuItems.filter(m => !m.requiresSuper || isSuperAdmin);

  if (loading) {
    return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-500">Loading dashboard...</div>;
  }

  return (
    <div className="flex h-screen bg-black text-white font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 border-r border-zinc-900 bg-zinc-950 flex flex-col">
        <div className="p-6">
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-indigo-400">
            Uvera Admin
          </h1>
        </div>
        
        {/* 2026-05-27 round-80 (Leon):侧边栏 menu items 超过 viewport 高度时
          * 直接 clip — 费加 Help/DevLog/Chat/System 等多 tab 后 viewport <
          * sidebar 内容总高就看不到底部 item。修复:nav 加 overflow-y-auto +
          * min-h-0(flex child 缺 min-h-0 不会 shrink 出 overflow space)。
          * 滚动条用 scrollbar-thin token (深色主题适配)。 */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-4 space-y-1 [scrollbar-width:thin] [scrollbar-color:rgb(63_63_70)_transparent]">
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                activeTab === item.id
                  ? 'bg-blue-600/10 text-blue-400'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
              }`}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-zinc-900">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-400/10 transition-colors"
          >
            <SignOut size={18} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-20 border-b border-zinc-900 bg-zinc-950/50 backdrop-blur flex items-center justify-between px-8 shrink-0">
          <h2 className="text-lg font-medium">{menuItems.find(i => i.id === activeTab)?.label}</h2>
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium transition-colors border border-zinc-800"
          >
            <ArrowsClockwise size={16} />
            Refresh Data
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 relative">
          {/* Top Stats — real metrics derived from orders + users tables.
              Stripe webhook (public/_worker.js) inserts a row into `orders`
              on every successful invoice.payment_succeeded, so all
              currency-denominated stats reflect actual paid revenue. */}
          {(() => {
            const now = Date.now();
            const D30 = 30 * 24 * 60 * 60 * 1000;
            const D35 = 35 * 24 * 60 * 60 * 1000;

            const successfulOrders = orders.filter(o => Number(o.status) === 1 || o.status == null);
            const totalRevenue = successfulOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);

            const recentOrders = successfulOrders.filter(o => {
              const t = o.createdAt ? new Date(o.createdAt).getTime() : 0;
              return now - t <= D30;
            });
            const mrr = recentOrders.reduce((sum, o) => sum + Number(o.amount || 0), 0);

            // Active subscribers = distinct userIds with a successful order in
            // the last ~35 days (one billing cycle + buffer for late renewals).
            const activeSubscribers = new Set(
              successfulOrders
                .filter(o => o.createdAt && now - new Date(o.createdAt).getTime() <= D35)
                .map(o => o.userId)
                .filter(Boolean)
            ).size;

            return (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
                <StatCard title="Total Users"        value={users.length}                    icon={Users}      color="blue"    />
                <StatCard title="Active Subscribers" value={activeSubscribers}                icon={Users}      color="blue"    />
                <StatCard title="MRR (last 30d)"     value={`$${mrr.toFixed(2)}`}             icon={CreditCard} color="emerald" />
                <StatCard title="Total Revenue"      value={`$${totalRevenue.toFixed(2)}`}    icon={CreditCard} color="emerald" />
                <StatCard title="Total Assets"       value={works.length}                    icon={Database}   color="purple"  />
                <StatCard title="Feed Items"         value={items.length}                    icon={PlayCircle} color="orange"  />
              </div>
            );
          })()}

          {/* Conditional Views */}
          {activeTab === 'admins' && <UsersView mode="admins" />}
          {activeTab === 'users' && <UsersView users={users} setUsers={setUsers} mode="users" />}
          {activeTab === 'orders' && (
            <OrdersView
              // Refetch parent's `orders` state after admin actions (reconcile
              // import, void, refund, etc.) so the top KPI cards (Total Revenue,
              // MRR, Active Subscribers) reflect the change immediately.
              // Without this, only OrdersView's internal table refreshes and
              // the KPIs go stale until the user clicks "Refresh Data".
              onDataChanged={async () => {
                try {
                  const o = await fetchPaymentOrders();
                  setOrders(o);
                } catch (e) {
                  console.warn('[admin] orders refetch after change failed:', e.message);
                }
              }}
            />
          )}
          {activeTab === 'credits' && <CreditGrantsView />}
          {activeTab === 'beta' && <BetaRequestsView />}
          {activeTab === 'videos' && <UserVideosReviewView />}
          {activeTab === 'reports' && <ContentReportsView />}
          {activeTab === 'logs' && <GenerationLogsView />}
          {activeTab === 'help' && <HelpArticlesView />}
          {activeTab === 'devlog' && <DevLogView />}
          {activeTab === 'chat' && <TeamChatView />}
          {activeTab === 'config' && <ConfigView items={items} setItems={setItems} />}
          {/* §2026-05-25 fei — Phase 1 / 2 短剧付费 admin views */}
          {activeTab === 'drama-revenue' && <DramaRevenueView />}
          {activeTab === 'drama-series' && <DramaSeriesView />}
          {activeTab === 'drama-settlements' && <SettlementsView />}
          {activeTab === 'drama-ledger' && <PaymentLedgerView />}
          {activeTab === 'drama-acquisition' && <AcquisitionCostsView />}
          {activeTab === 'works' && (
            <WorksView
              works={works}
              onDelete={async (id) => {
                if (window.confirm("Are you sure you want to completely delete this character/work? This cannot be undone.")) {
                  try {
                    const nextWorks = await deleteUserWork(id);
                    setWorks(nextWorks);
                  } catch(e) {
                    alert('Failed to delete character: ' + e.message);
                  }
                }
              }}
              /* §2026-06-10 — 上架/下架(仅 Video)。RLS recommended_content_admin_full
               * (is_admin()) 允许 admin 直接 update 任意行;乐观更新本地 state。 */
              onTogglePublish={async (item) => {
                const makePub = item.status !== 'published';
                try {
                  await togglePublishedStatus(item.id, makePub);
                  setWorks(prev => prev.map(w => w.id === item.id
                    ? { ...w, status: makePub ? 'published' : 'draft', published: makePub }
                    : w));
                } catch (e) {
                  alert('更新上架状态失败: ' + e.message);
                }
              }}
            />
          )}
          {activeTab === 'system' && isSuperAdmin && <SystemSettingsView />}
        </div>
      </main>
    </div>
  );
}

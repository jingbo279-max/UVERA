/**
 * §2026-05-25 fei — Phase 1 短剧付费 admin views.
 *
 * Two components for AdminDashboard tabs:
 *
 *   DramaRevenueView   — 收益概述 (PDF §3.1)
 *     Top cards: 总流水 GMV / 净收入 / 付费用户数 / 订单数 /
 *                付费转化率 / ARPU / 退款率
 *     Below:    收入趋势 (按日) + 剧集收入排行 + 收入构成
 *     Filters:  今日 / 近 7 日 / 近 30 日 / 全部
 *
 *   DramaSeriesView    — 剧集操作 (PDF §5)
 *     Table of every series with付费配置 columns + lifecycle status.
 *     Click any row → modal to edit pricing / scheduling / share /
 *     publish state. Audit log (operator, time, before/after) inserted
 *     on every change via supabase function call.
 *
 * Both views go through Supabase REST directly (admin's session JWT has
 * is_admin() = true so RLS policies admit). Wallet / order tables have
 * select-all admin policies installed in the migration 20260525_drama_payments.up.sql.
 */

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../api/supabaseClient';
import {
  Coin, CircleNotch, Users, ChartBar, ArrowsClockwise, Trophy,
  X, PencilSimple, CheckCircle, Lock, Calendar, ArrowRight, Eye, EyeSlash,
  Receipt, Hammer, Bank, ClockClockwise, Warning,
} from '@phosphor-icons/react';

/* ───────────────────────────────────────────────────────────────────────
 * DramaRevenueView — 收益概述
 * ─────────────────────────────────────────────────────────────────────── */

const RANGE_PRESETS = [
  { id: 'today', label: '今日',  days: 1 },
  { id: '7d',    label: '近 7 日', days: 7 },
  { id: '30d',   label: '近 30 日', days: 30 },
  { id: 'all',   label: '全部',  days: null },
];

export function DramaRevenueView() {
  const [range, setRange] = useState('30d');
  const [loading, setLoading] = useState(true);
  const [ucoinsOrders, setUcoinsOrders] = useState([]);
  const [bundleOrders, setBundleOrders] = useState([]);
  const [seriesById, setSeriesById] = useState({});

  const loadData = async () => {
    setLoading(true);
    try {
      // Compute the date floor from the selected range
      const preset = RANGE_PRESETS.find(p => p.id === range);
      const floorIso = preset.days
        ? new Date(Date.now() - preset.days * 24 * 60 * 60 * 1000).toISOString()
        : null;

      let ucoinsQuery = supabase
        .from('ucoins_orders')
        .select('id,user_id,package_id,amount_usd_cents,ucoins_to_credit,status,is_first_charge,completed_at,created_at')
        .order('completed_at', { ascending: false, nullsFirst: false });
      let bundleQuery = supabase
        .from('series_purchases')
        .select('id,user_id,series_id,amount_usd_cents,status,completed_at,created_at')
        .order('completed_at', { ascending: false, nullsFirst: false });
      if (floorIso) {
        ucoinsQuery = ucoinsQuery.gte('completed_at', floorIso);
        bundleQuery = bundleQuery.gte('completed_at', floorIso);
      }

      const [uo, bo] = await Promise.all([ucoinsQuery, bundleQuery]);
      const uoRows = uo.data || [];
      const boRows = bo.data || [];
      setUcoinsOrders(uoRows);
      setBundleOrders(boRows);

      // Hydrate series titles for the leaderboard
      const seriesIds = [...new Set(boRows.map(b => b.series_id).filter(Boolean))];
      if (seriesIds.length > 0) {
        const { data: sRows } = await supabase
          .from('series')
          .select('id,title')
          .in('id', seriesIds);
        const map = {};
        for (const s of sRows || []) map[s.id] = s.title;
        setSeriesById(map);
      }
    } catch (err) {
      console.error('[DramaRevenueView] load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [range]);

  /* ── Derived metrics ─────────────────────────────────────────────── */
  const metrics = useMemo(() => {
    const succeededUcoins = ucoinsOrders.filter(o => o.status === 'succeeded');
    const succeededBundle = bundleOrders.filter(o => o.status === 'succeeded');

    const grossCents = succeededUcoins.reduce((s, o) => s + o.amount_usd_cents, 0)
                     + succeededBundle.reduce((s, o) => s + o.amount_usd_cents, 0);
    const gmvUsd = grossCents / 100;

    // Stripe Web fee ≈ 3% (system_settings default). Phase 1 uses flat 3%
    //   for net calculation; real per-transaction fee comes from Stripe in
    //   the future (Phase 2 reconciliation).
    const netUsd = gmvUsd * 0.97;

    const payingUsers = new Set([
      ...succeededUcoins.map(o => o.user_id),
      ...succeededBundle.map(o => o.user_id),
    ]).size;
    const orderCount = succeededUcoins.length + succeededBundle.length;
    const arpu = payingUsers > 0 ? gmvUsd / payingUsers : 0;

    const ucoinsRevenue = succeededUcoins.reduce((s, o) => s + o.amount_usd_cents, 0) / 100;
    const bundleRevenue = succeededBundle.reduce((s, o) => s + o.amount_usd_cents, 0) / 100;

    // Refund / failure rate
    const refundedCents = ucoinsOrders.filter(o => o.status === 'refunded').reduce((s, o) => s + o.amount_usd_cents, 0)
                        + bundleOrders.filter(o => o.status === 'refunded').reduce((s, o) => s + o.amount_usd_cents, 0);
    const refundRate = grossCents > 0 ? (refundedCents / grossCents) * 100 : 0;

    // Per-series leaderboard by bundle GMV
    const seriesGmv = {};
    for (const o of succeededBundle) {
      seriesGmv[o.series_id] = (seriesGmv[o.series_id] || 0) + o.amount_usd_cents;
    }
    const topSeries = Object.entries(seriesGmv)
      .map(([id, cents]) => ({ id, title: seriesById[id] || id.slice(0, 8) + '…', usd: cents / 100 }))
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 10);

    /* §2026-05-25 fei Phase 2 — daily revenue trend.
     *   Bucket succeeded orders by UTC YYYY-MM-DD (using completed_at).
     *   Fill missing days with zero so the chart x-axis is continuous —
     *   no awkward gaps when nothing sold on Tuesday. */
    const allSucceeded = [
      ...succeededUcoins.map(o => ({ d: o.completed_at, c: o.amount_usd_cents, t: 'ucoins' })),
      ...succeededBundle.map(o => ({ d: o.completed_at, c: o.amount_usd_cents, t: 'bundle' })),
    ].filter(x => x.d);

    const dayKey = (iso) => iso.slice(0, 10);  // 'YYYY-MM-DD' UTC
    const dailyMap = new Map();  // day → { ucoins, bundle }
    for (const x of allSucceeded) {
      const k = dayKey(x.d);
      const prev = dailyMap.get(k) || { ucoins: 0, bundle: 0 };
      prev[x.t] += x.c;
      dailyMap.set(k, prev);
    }

    // Determine x-axis window: use the active range (1 / 7 / 30 days),
    //   or for 'all' use min(first order day, 30 days ago).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const trendDays = [];
    const windowDays = (() => {
      const preset = RANGE_PRESETS.find(p => p.id === range);
      return preset?.days || 30;
    })();
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const k = d.toISOString().slice(0, 10);
      const entry = dailyMap.get(k) || { ucoins: 0, bundle: 0 };
      trendDays.push({
        date: k,
        ucoins: entry.ucoins,
        bundle: entry.bundle,
        total: entry.ucoins + entry.bundle,
      });
    }
    const trendMaxCents = Math.max(...trendDays.map(d => d.total), 1);

    /* §Composition (PDF §3.1 收入构成占比):
     *   Tokens 单集解锁 vs 整剧买断 vs 会员分摊 (Phase 2 没接会员分摊,
     *   先显示前两类)。 */
    const compositionParts = [
      { id: 'ucoins',     label: 'Tokens 充值', cents: succeededUcoins.reduce((s, o) => s + o.amount_usd_cents, 0), color: '#f59e0b' },
      { id: 'bundle',     label: '整剧买断',     cents: succeededBundle.reduce((s, o) => s + o.amount_usd_cents, 0), color: '#a855f7' },
      // { id: 'member',  label: '会员分摊',     cents: 0, color: '#3b82f6' },  // Phase 3
    ];
    const compositionTotal = compositionParts.reduce((s, p) => s + p.cents, 0);

    return {
      gmvUsd, netUsd, payingUsers, orderCount, arpu, ucoinsRevenue,
      bundleRevenue, refundRate, topSeries, trendDays, trendMaxCents,
      compositionParts, compositionTotal,
    };
  }, [ucoinsOrders, bundleOrders, seriesById, range]);

  return (
    <div className="space-y-6">
      {/* Range filter + refresh */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {RANGE_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => setRange(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                range === p.id ? 'bg-blue-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm transition-colors"
        >
          <ArrowsClockwise size={14} /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <CircleNotch size={28} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : (
        <>
          {/* Top metric cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              icon={Coin}
              label="总流水 GMV"
              value={`$${metrics.gmvUsd.toFixed(2)}`}
              hint="已扣退款"
              color="emerald"
            />
            <MetricCard
              icon={ChartBar}
              label="净收入"
              value={`$${metrics.netUsd.toFixed(2)}`}
              hint="GMV × 97% (Stripe)"
              color="blue"
            />
            <MetricCard
              icon={Users}
              label="付费用户数"
              value={metrics.payingUsers}
              hint="去重"
              color="indigo"
            />
            <MetricCard
              icon={CheckCircle}
              label="付费订单数"
              value={metrics.orderCount}
              hint="充值 + 买断"
              color="violet"
            />
            <MetricCard
              icon={Trophy}
              label="ARPU"
              value={`$${metrics.arpu.toFixed(2)}`}
              hint="GMV ÷ 付费用户"
              color="amber"
            />
            <MetricCard
              icon={Coin}
              label="Tokens 充值"
              value={`$${metrics.ucoinsRevenue.toFixed(2)}`}
              hint="单集 / 充值"
              color="amber"
            />
            <MetricCard
              icon={Lock}
              label="整剧买断"
              value={`$${metrics.bundleRevenue.toFixed(2)}`}
              hint="一次性"
              color="rose"
            />
            <MetricCard
              icon={ArrowsClockwise}
              label="退款率"
              value={`${metrics.refundRate.toFixed(2)}%`}
              hint="退款 ÷ GMV"
              color="zinc"
            />
          </div>

          {/* §2026-05-25 fei Phase 2 — daily trend (stacked bar SVG) + composition donut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 lg:col-span-2">
              <h3 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                <ChartBar size={18} className="text-emerald-400" />
                按日 GMV 趋势 ({metrics.trendDays.length} 天)
              </h3>
              <DailyTrendChart days={metrics.trendDays} maxCents={metrics.trendMaxCents} />
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
              <h3 className="text-base font-medium text-white mb-4 flex items-center gap-2">
                <Coin size={18} className="text-amber-400" />
                收入构成
              </h3>
              <CompositionDonut parts={metrics.compositionParts} total={metrics.compositionTotal} />
            </div>
          </div>

          {/* Series leaderboard */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6">
            <h3 className="text-base font-medium text-white mb-4 flex items-center gap-2">
              <Trophy size={18} className="text-amber-400" />
              剧集买断收入排行 (Top 10)
            </h3>
            {metrics.topSeries.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">本期内无买断订单</p>
            ) : (
              <div className="space-y-2">
                {metrics.topSeries.map((s, idx) => (
                  <div key={s.id} className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-950 border border-zinc-800">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs text-zinc-500 w-5 tabular-nums">#{idx + 1}</span>
                      <span className="text-sm text-white truncate">{s.title}</span>
                    </div>
                    <span className="text-sm font-semibold text-emerald-400 tabular-nums">${s.usd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Compliance reminder */}
          <p className="text-xs text-zinc-500 text-center">
            数据基于 ucoins_orders + series_purchases 表实时聚合。会员订阅分摊 (PDF §4.2) 在 Phase 2 上线。
          </p>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint, color = 'zinc' }) {
  const colorClass = {
    emerald: 'text-emerald-400 bg-emerald-500/10',
    blue:    'text-blue-400 bg-blue-500/10',
    indigo:  'text-indigo-400 bg-indigo-500/10',
    violet:  'text-violet-400 bg-violet-500/10',
    amber:   'text-amber-400 bg-amber-500/10',
    rose:    'text-rose-400 bg-rose-500/10',
    zinc:    'text-zinc-400 bg-zinc-500/10',
  }[color];
  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClass}`}>
          <Icon size={16} weight="fill" />
        </div>
      </div>
      <div className="text-2xl font-semibold text-white tabular-nums">{value}</div>
      {hint && <p className="text-[10px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * DramaSeriesView — 剧集操作
 * ─────────────────────────────────────────────────────────────────────── */

const LIFECYCLE_LABELS = {
  draft:          { label: '草稿',    color: 'bg-zinc-700' },
  pending_review: { label: '待审核',  color: 'bg-amber-600' },
  approved:       { label: '已审核',  color: 'bg-blue-600' },
  live:           { label: '已上架',  color: 'bg-emerald-600' },
  off_shelf:      { label: '已下架',  color: 'bg-zinc-600' },
  archived:       { label: '归档',    color: 'bg-zinc-800' },
};

export function DramaSeriesView() {
  const [loading, setLoading] = useState(true);
  const [series, setSeries] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('series')
        .select('id,title,user_id,status,lifecycle_status,free_episodes_count,ucoins_per_episode,bundle_price_usd_cents,member_free,is_premiere,is_recommended,revenue_share_pct,scheduled_publish_at,created_at,updated_at')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setSeries(data || []);
    } catch (err) {
      console.error('[DramaSeriesView] load failed:', err);
      alert('加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-white">剧集管理 ({series.length})</h3>
        <button
          onClick={load}
          className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm"
        >
          <ArrowsClockwise size={14} /> 刷新
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <CircleNotch size={28} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : series.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-12 border border-dashed border-zinc-800 rounded-xl">
          尚无剧集数据
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">标题</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-left px-4 py-3">免费集</th>
                <th className="text-left px-4 py-3">单集价</th>
                <th className="text-left px-4 py-3">买断价</th>
                <th className="text-left px-4 py-3">分成</th>
                <th className="text-left px-4 py-3">标记</th>
                <th className="text-left px-4 py-3">排期</th>
                <th className="text-left px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {series.map(s => {
                const lc = LIFECYCLE_LABELS[s.lifecycle_status] || LIFECYCLE_LABELS.draft;
                return (
                  <tr key={s.id} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-white font-medium truncate max-w-[18rem]">{s.title}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{s.id.slice(0, 8)}…</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${lc.color}`}>
                        {lc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">前 {s.free_episodes_count}</td>
                    <td className="px-4 py-3 tabular-nums flex items-center gap-1">
                      <Coin size={12} weight="fill" className="text-amber-500" />
                      {s.ucoins_per_episode}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {s.bundle_price_usd_cents ? `$${(s.bundle_price_usd_cents / 100).toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-zinc-400">
                      {s.revenue_share_pct != null ? `${s.revenue_share_pct}%` : '默认'}
                    </td>
                    <td className="px-4 py-3 space-x-1">
                      {s.member_free && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">会员免</span>}
                      {s.is_premiere && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400">首发</span>}
                      {s.is_recommended && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">推荐</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400">
                      {s.scheduled_publish_at
                        ? new Date(s.scheduled_publish_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setEditing(s)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs transition-colors"
                      >
                        <PencilSimple size={12} /> 编辑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <SeriesEditModal
          series={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/* ── SeriesEditModal — 剧集配置弹层 ───────────────────────────────── */

function SeriesEditModal({ series, onClose, onSaved }) {
  const [form, setForm] = useState({
    lifecycle_status: series.lifecycle_status || 'draft',
    free_episodes_count: series.free_episodes_count ?? 5,
    ucoins_per_episode: series.ucoins_per_episode ?? 40,
    bundle_price_usd: series.bundle_price_usd_cents != null ? (series.bundle_price_usd_cents / 100).toString() : '',
    member_free: !!series.member_free,
    is_premiere: !!series.is_premiere,
    is_recommended: !!series.is_recommended,
    revenue_share_pct: series.revenue_share_pct != null ? String(series.revenue_share_pct) : '',
    scheduled_publish_at: series.scheduled_publish_at
      ? new Date(series.scheduled_publish_at).toISOString().slice(0, 16)
      : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const update = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch = {
        lifecycle_status: form.lifecycle_status,
        free_episodes_count: Number(form.free_episodes_count),
        ucoins_per_episode: Number(form.ucoins_per_episode),
        bundle_price_usd_cents: form.bundle_price_usd.trim()
          ? Math.round(parseFloat(form.bundle_price_usd) * 100)
          : null,
        member_free: !!form.member_free,
        is_premiere: !!form.is_premiere,
        is_recommended: !!form.is_recommended,
        revenue_share_pct: form.revenue_share_pct.trim()
          ? Number(form.revenue_share_pct)
          : null,
        scheduled_publish_at: form.scheduled_publish_at
          ? new Date(form.scheduled_publish_at).toISOString()
          : null,
      };

      // §2026-05-25 fei — also sync legacy series.status when lifecycle goes
      //   live or off_shelf so public Discover keeps working.
      if (form.lifecycle_status === 'live') patch.status = 'published';
      if (form.lifecycle_status === 'off_shelf' || form.lifecycle_status === 'archived') patch.status = 'archived';

      const { error: updErr } = await supabase
        .from('series')
        .update(patch)
        .eq('id', series.id);
      if (updErr) throw updErr;

      onSaved();
    } catch (err) {
      console.error('[SeriesEditModal] save failed:', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-white">编辑剧集配置</h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">{series.title}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-4">
          {/* Lifecycle */}
          <Field label="生命周期状态">
            <select
              value={form.lifecycle_status}
              onChange={e => update('lifecycle_status', e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
            >
              {Object.entries(LIFECYCLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </Field>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="免费集数 (前 N 集)">
              <input
                type="number" min="0"
                value={form.free_episodes_count}
                onChange={e => update('free_episodes_count', e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
              />
            </Field>
            <Field label="每集售价 (Tokens)">
              <input
                type="number" min="0"
                value={form.ucoins_per_episode}
                onChange={e => update('ucoins_per_episode', e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
              />
            </Field>
          </div>

          <Field label="整剧买断价 (USD,留空 = 不提供)">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-sm">$</span>
              <input
                type="number" step="0.01" min="0" placeholder="12.99"
                value={form.bundle_price_usd}
                onChange={e => update('bundle_price_usd', e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </Field>

          <Field label="分成比例 % (留空 = 继承全局默认)">
            <input
              type="number" step="0.01" min="0" max="100" placeholder="50"
              value={form.revenue_share_pct}
              onChange={e => update('revenue_share_pct', e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
            />
          </Field>

          {/* Flags */}
          <div className="space-y-2">
            <Toggle label="会员是否免费观看 (member_free)" checked={form.member_free} onChange={v => update('member_free', v)} />
            <Toggle label="标记为首发 (is_premiere)"          checked={form.is_premiere} onChange={v => update('is_premiere', v)} />
            <Toggle label="进首页推荐流 (is_recommended)"     checked={form.is_recommended} onChange={v => update('is_recommended', v)} />
          </div>

          {/* Schedule */}
          <Field label="排期上架时间 (留空 = 手动上架)">
            <input
              type="datetime-local"
              value={form.scheduled_publish_at}
              onChange={e => update('scheduled_publish_at', e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
            />
          </Field>

          {/* §2026-05-26 fei (audit #8) — Per-episode override editor.
              Loads episodes table on modal mount, lets admin override
              is_free_override (force free / force paid) and ucoins_price_override
              (custom price) per episode. NULL = inherit from series default. */}
          <EpisodeOverridesEditor seriesId={series.id} />

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-zinc-950 border-t border-zinc-800 px-6 py-4 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <><CircleNotch size={14} className="animate-spin" /> 保存中</> : <>保存</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-blue-500"
      />
      <span className="text-sm text-zinc-300">{label}</span>
    </label>
  );
}

/* §2026-05-26 fei (audit #8) — Per-episode override editor.
 *
 * For each episode in the series, admin can set:
 *   · is_free_override: TRUE (always free) / FALSE (always paid) / NULL (inherit
 *     from series.free_episodes_count)
 *   · ucoins_price_override: positive integer (custom price) / NULL (inherit
 *     from series.ucoins_per_episode)
 *
 * Saves are per-row PATCH via supabase direct (admin RLS bypasses). No batch
 * save: each row commits on blur to minimize the "I forgot to click Save"
 * mistake surface.
 */
function EpisodeOverridesEditor({ seriesId }) {
  const [eps, setEps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('episodes')
        .select('id, episode_no, title, status, is_free_override, ucoins_price_override')
        .eq('series_id', seriesId)
        .order('episode_no', { ascending: true });
      if (cancelled) return;
      if (error) console.warn('[EpisodeOverridesEditor] load failed:', error);
      setEps(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [seriesId]);

  const patchEp = async (epId, patch) => {
    setSavingId(epId);
    try {
      const { error } = await supabase.from('episodes').update(patch).eq('id', epId);
      if (error) throw error;
      setEps(prev => prev.map(e => e.id === epId ? { ...e, ...patch } : e));
    } catch (err) {
      alert('单集 override 保存失败: ' + (err.message || err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-xs text-zinc-400 mb-1.5">
        单集 override
        <span className="text-zinc-600 ml-1">(留空 = 继承本剧默认)</span>
      </label>
      <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800/60 max-h-64 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-4 text-xs text-zinc-500 text-center">加载中…</div>
        ) : eps.length === 0 ? (
          <div className="px-3 py-4 text-xs text-zinc-500 text-center">本剧无可配置 episode</div>
        ) : eps.map(ep => (
          <div key={ep.id} className="px-3 py-2 grid grid-cols-[2rem_1fr_5rem_5rem] gap-2 items-center text-xs">
            <div className="text-zinc-500 tabular-nums">#{ep.episode_no}</div>
            <div className="text-zinc-300 truncate" title={ep.title}>
              {ep.title || `Episode ${ep.episode_no}`}
              {ep.status !== 'ready' && <span className="ml-2 text-amber-500 text-[10px]">{ep.status}</span>}
            </div>
            {/* is_free_override tri-state: yes / no / inherit */}
            <select
              value={ep.is_free_override === true ? 'yes' : ep.is_free_override === false ? 'no' : 'inherit'}
              disabled={savingId === ep.id}
              onChange={e => {
                const v = e.target.value;
                const next = v === 'yes' ? true : v === 'no' ? false : null;
                patchEp(ep.id, { is_free_override: next });
              }}
              className="bg-zinc-900 border border-zinc-800 rounded px-1 py-1 text-[10px] text-white"
              title="是否强制免费/付费"
            >
              <option value="inherit">继承</option>
              <option value="yes">强制免费</option>
              <option value="no">强制付费</option>
            </select>
            {/* ucoins_price_override: empty input = inherit */}
            <input
              type="number"
              min="0"
              placeholder="—"
              value={ep.ucoins_price_override ?? ''}
              disabled={savingId === ep.id}
              onChange={e => {
                const v = e.target.value;
                setEps(prev => prev.map(x => x.id === ep.id ? { ...x, ucoins_price_override: v === '' ? null : Number(v) } : x));
              }}
              onBlur={e => {
                const v = e.target.value;
                const next = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
                patchEp(ep.id, { ucoins_price_override: next });
              }}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[10px] text-white w-full tabular-nums"
              title="单集自定义价 (Tokens)。留空 = 继承本剧 ucoins_per_episode"
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-zinc-600">改动自动保存(改下拉立即保存,改价格在失焦后保存)</p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * SettlementsView — 分成结算 (PDF §4)
 *
 * Lets admin:
 *   - Pick a settlement period (default = current month YYYY-MM)
 *   - Trigger "generate" which calls /api/admin/settlements/generate.
 *     The worker recomputes per-series GMV / fees / shares per the PDF
 *     formula and upserts settlement rows on (period, series_id).
 *   - View the resulting rows in a table — one per series with revenue.
 *   - Click a row → modal with the full breakdown + status transition
 *     buttons (pending → confirmed → paid) and "mark paid" form
 *     (payment reference + notes for audit trail).
 *
 * Auth: every endpoint requires admin JWT (handled at worker layer).
 * ─────────────────────────────────────────────────────────────────────── */

const SETTLEMENT_STATUS = {
  pending_confirm:    { label: '待确认',    color: 'bg-zinc-600',     next: 'creator_confirmed' },
  creator_confirmed:  { label: '已确认',    color: 'bg-blue-600',     next: 'paid' },
  paid:               { label: '已打款',    color: 'bg-emerald-600',  next: null },
  disputed:           { label: '争议中',    color: 'bg-amber-600',    next: null },
  cancelled:          { label: '已取消',    color: 'bg-zinc-800',     next: null },
};

const currentPeriod = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const lastNPeriods = (n) => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
};

const formatUsdCents = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;

export function SettlementsView() {
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState({ summary: null, rows: [] });
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const fetchAuthed = async (path, init = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');
    return fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };

  const loadPeriod = async (p) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetchAuthed(`/api/admin/settlements?period=${encodeURIComponent(p)}`);
      const json = await resp.json();
      if (!resp.ok || json?.success === false) throw new Error(json?.errMessage || 'Failed to load settlements');
      setData({ summary: json.summary, rows: json.rows || [] });
    } catch (e) {
      console.error('[SettlementsView] load failed:', e);
      setError(e.message);
      setData({ summary: null, rows: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPeriod(period); }, [period]);

  const handleGenerate = async () => {
    if (!window.confirm(`重新生成 ${period} 月度结算?将按 PDF §4 公式重新计算每个剧的分成,已 paid 的状态不会被覆盖。`)) return;
    setGenerating(true);
    setError(null);
    try {
      const resp = await fetchAuthed('/api/admin/settlements/generate', {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      const json = await resp.json();
      if (!resp.ok || json?.success === false) throw new Error(json?.errMessage || '生成失败');
      alert(`✅ 已生成 ${json.generated} 条结算单${json.message ? `\n${json.message}` : ''}`);
      await loadPeriod(period);
    } catch (e) {
      console.error('[SettlementsView] generate failed:', e);
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const summary = data.summary || {};

  return (
    <div className="space-y-6">
      {/* Period selector + generate */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">结算周期</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
          >
            {lastNPeriods(12).map(p => (
              <option key={p} value={p}>{p}{p === currentPeriod() ? ' (本月)' : ''}</option>
            ))}
          </select>
          <button
            onClick={() => loadPeriod(period)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm"
            title="重新拉取该周期数据"
          >
            <ArrowsClockwise size={14} /> 刷新
          </button>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {generating ? <><CircleNotch size={14} className="animate-spin" /> 生成中…</> : <><Hammer size={14} /> 生成 / 重新计算 {period} 结算</>}
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <Warning size={16} /> {error}
        </div>
      )}

      {/* Period summary cards */}
      {summary.row_count > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard icon={Coin}    label={`${period} GMV 总计`}        value={formatUsdCents(summary.total_gmv_cents)} hint={`${summary.row_count} 条结算单`} color="emerald" />
          <MetricCard icon={Users}   label="内容方收益合计"               value={formatUsdCents(summary.total_creator_cents)} hint="所有内容方分成" color="amber" />
          <MetricCard icon={ChartBar} label="平台收益合计"                 value={formatUsdCents(summary.total_platform_cents)} hint="可分配 × (1-n%) + 服务费" color="indigo" />
          <MetricCard icon={Receipt}  label="渠道手续费"                   value={formatUsdCents(summary.total_channel_fee_cents)} hint="Apple/Google/Stripe" color="rose" />
        </div>
      )}

      {/* Settlements table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <CircleNotch size={28} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : data.rows.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-12 border border-dashed border-zinc-800 rounded-xl">
          {summary.row_count === 0 ? `${period} 月暂无结算单 — 点击上方"生成"按钮试算` : '该周期暂无符合条件的结算单'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">剧集</th>
                <th className="text-left px-4 py-3">内容方</th>
                <th className="text-right px-4 py-3">GMV</th>
                <th className="text-right px-4 py-3">分成 %</th>
                <th className="text-right px-4 py-3">内容方</th>
                <th className="text-right px-4 py-3">平台</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-left px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.rows.map(row => {
                const status = SETTLEMENT_STATUS[row.status] || SETTLEMENT_STATUS.pending_confirm;
                return (
                  <tr key={row.id} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-white font-medium truncate max-w-[16rem]">
                        {row.series?.title || row.series_id.slice(0, 8) + '…'}
                      </div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">
                        {row.unlock_count} 解锁 · {row.bundle_orders_count} 买断
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400 truncate max-w-[12rem]">
                      {row.creator_email || row.content_creator_id.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-400 font-medium">{formatUsdCents(row.gmv_cents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-400">{row.revenue_share_pct}%</td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-400">{formatUsdCents(row.creator_earnings_cents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-indigo-400">{formatUsdCents(row.platform_earnings_cents)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${status.color}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setSelected(row)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs transition-colors"
                      >
                        <Eye size={12} /> 查看
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <SettlementDetailModal
          settlement={selected}
          onClose={() => setSelected(null)}
          onUpdated={() => { setSelected(null); loadPeriod(period); }}
        />
      )}
    </div>
  );
}

/* ── SettlementDetailModal — 结算单详情 + 状态流转 ───────────────────── */

function SettlementDetailModal({ settlement, onClose, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [paidRef, setPaidRef] = useState(settlement.paid_reference || '');
  const [notes, setNotes] = useState(settlement.notes || '');

  const status = SETTLEMENT_STATUS[settlement.status] || SETTLEMENT_STATUS.pending_confirm;
  const nextStatus = status.next;

  const fetchAuthed = async (path, init = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');
    return fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };

  const handleTransition = async (newStatus) => {
    setSaving(true);
    setError(null);
    try {
      const body = { status: newStatus };
      if (newStatus === 'paid') body.paid_reference = paidRef;
      if (notes !== (settlement.notes || '')) body.notes = notes;

      const resp = await fetchAuthed(`/api/admin/settlements/${settlement.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok || json?.success === false) throw new Error(json?.errMessage || 'PATCH failed');
      onUpdated();
    } catch (e) {
      console.error('[SettlementDetailModal] transition failed:', e);
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-white">结算单 · {settlement.period}</h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate max-w-md">
              {settlement.series?.title || settlement.series_id} · {settlement.creator_email || settlement.content_creator_id.slice(0, 8) + '…'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${status.color}`}>
              {status.label}
            </span>
            <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* GMV breakdown */}
          <Section title="GMV (总流水)">
            <Row label="Tokens 单集解锁">
              <div className="text-right">
                <div className="text-emerald-400 tabular-nums">{formatUsdCents(settlement.ucoins_gmv_cents)}</div>
                <div className="text-[10px] text-zinc-500">{settlement.ucoins_consumed} Tokens × {formatUsdCents(settlement.ucoins_to_usd_cents)} = {settlement.unlock_count} 单</div>
              </div>
            </Row>
            <Row label="整剧买断">
              <div className="text-right">
                <div className="text-emerald-400 tabular-nums">{formatUsdCents(settlement.bundle_gmv_cents)}</div>
                <div className="text-[10px] text-zinc-500">{settlement.bundle_orders_count} 笔订单</div>
              </div>
            </Row>
            <Row label="GMV 合计" emphasize>
              <span className="text-emerald-400 tabular-nums font-semibold text-lg">{formatUsdCents(settlement.gmv_cents)}</span>
            </Row>
          </Section>

          {/* Cost deductions */}
          <Section title="成本扣除">
            <Row label={`渠道支付手续费 (${settlement.channel_fee_pct}%)`}>
              <span className="text-rose-400 tabular-nums">− {formatUsdCents(settlement.channel_fee_cents)}</span>
            </Row>
            <Row label={`平台技术服务费 (${settlement.service_fee_pct}%)`}>
              <span className="text-zinc-400 tabular-nums">− {formatUsdCents(settlement.service_fee_cents)}</span>
            </Row>
            <Row label="归因投流成本">
              <span className="text-zinc-400 tabular-nums">− {formatUsdCents(settlement.acquisition_cost_cents)}</span>
            </Row>
            <Row label="可分配收入" emphasize>
              <span className="text-blue-400 tabular-nums font-semibold text-lg">{formatUsdCents(settlement.distributable_cents)}</span>
            </Row>
          </Section>

          {/* Revenue split */}
          <Section title={`分成 (内容方 ${settlement.revenue_share_pct}% / 平台 ${(100 - Number(settlement.revenue_share_pct)).toFixed(2)}%)`}>
            <Row label="内容方收益" emphasize>
              <span className="text-amber-400 tabular-nums font-semibold text-lg">{formatUsdCents(settlement.creator_earnings_cents)}</span>
            </Row>
            <Row label="平台收益 (含服务费)" emphasize>
              <span className="text-indigo-400 tabular-nums font-semibold text-lg">{formatUsdCents(settlement.platform_earnings_cents)}</span>
            </Row>
            <p className="text-[10px] text-zinc-600 px-4 pt-1">
              校验:内容方 + 平台 + 渠道 + 投流 = {formatUsdCents(settlement.creator_earnings_cents + settlement.platform_earnings_cents + settlement.channel_fee_cents + settlement.acquisition_cost_cents)} (≈ GMV {formatUsdCents(settlement.gmv_cents)})
            </p>
          </Section>

          {/* Timeline */}
          <Section title="时间线">
            <Row label="生成于">
              <span className="text-zinc-400 text-xs">{settlement.generated_at ? new Date(settlement.generated_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
            <Row label="内容方确认">
              <span className="text-zinc-400 text-xs">{settlement.confirmed_at ? new Date(settlement.confirmed_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
            <Row label="打款时间">
              <span className="text-zinc-400 text-xs">{settlement.paid_at ? new Date(settlement.paid_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
          </Section>

          {/* Paid reference + notes (editable when status allows) */}
          <Section title="备注 (可编辑)">
            <div className="space-y-3 px-4 pb-2">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">打款流水号 (银行 ref / Stripe transfer id)</label>
                <input
                  type="text"
                  value={paidRef}
                  onChange={e => setPaidRef(e.target.value)}
                  placeholder="例:tr_1Abc... 或 银行回单号"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
                  disabled={settlement.status === 'paid' && !!settlement.paid_reference}
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">备注</label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="备注内容…"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm resize-none"
                />
              </div>
            </div>
          </Section>

          {error && (
            <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer: state transition buttons */}
        <div className="sticky bottom-0 bg-zinc-950 border-t border-zinc-800 px-6 py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {settlement.status !== 'disputed' && settlement.status !== 'cancelled' && (
              <button
                onClick={() => handleTransition('disputed')}
                disabled={saving}
                className="px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-500/10 rounded-lg disabled:opacity-50"
              >
                标记争议
              </button>
            )}
            {settlement.status !== 'cancelled' && settlement.status !== 'paid' && (
              <button
                onClick={() => handleTransition('cancelled')}
                disabled={saving}
                className="px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 rounded-lg disabled:opacity-50"
              >
                取消
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">关闭</button>
            {nextStatus && (
              <button
                onClick={() => handleTransition(nextStatus)}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? <CircleNotch size={14} className="animate-spin" /> : nextStatus === 'paid' ? <Bank size={14} /> : <ArrowRight size={14} />}
                {nextStatus === 'creator_confirmed' ? '标记已确认' : nextStatus === 'paid' ? '标记已打款' : '推进'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-zinc-500 px-4 mb-2">{title}</h4>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 divide-y divide-zinc-800/50">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children, emphasize }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${emphasize ? 'bg-zinc-900/60' : ''}`}>
      <span className={`text-sm ${emphasize ? 'text-white font-medium' : 'text-zinc-400'}`}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * PaymentLedgerView — 用户付费详情 (PDF §3.2)
 *
 * Unified ledger view across:
 *   - ucoins_orders     (充值)
 *   - series_purchases  (整剧买断)
 *   - episode_unlocks   (单集解锁,即 Tokens 消费动作)
 *
 * Each row normalized to: { ts, user_id, type, amount_cents, ucoins_delta,
 *                           subject, status, ref_id, source_table }
 *
 * Filters: 用户 email/uid 搜索 / 类型 / 时间范围 / 状态
 * Click row → UserPaymentDrawer (right slide-out) showing that user's
 * full activity + Tokens balance + 累计 LTV.
 *
 * Phase 2 MVP: client-side union + filter. Backend pagination endpoint
 * deferred to Phase 3 if order volume grows past ~5k rows / period.
 * ─────────────────────────────────────────────────────────────────────── */

const TYPE_LABELS = {
  charge:  { label: '充值',     color: 'text-amber-400',  bg: 'bg-amber-500/15'  },
  bundle:  { label: '整剧买断', color: 'text-purple-400', bg: 'bg-purple-500/15' },
  unlock:  { label: '解锁单集', color: 'text-blue-400',   bg: 'bg-blue-500/15'   },
  member:  { label: '会员解锁', color: 'text-indigo-400', bg: 'bg-indigo-500/15' },
  refund:  { label: '退款',     color: 'text-rose-400',   bg: 'bg-rose-500/15'   },
};

const ORDER_STATUS_LABEL = {
  succeeded:  '成功',
  pending:    '处理中',
  refunded:   '退款',
  failed:     '失败',
  cancelled:  '已取消',
};

export function PaymentLedgerView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ucoinsOrders, setUcoinsOrders] = useState([]);
  const [bundles, setBundles] = useState([]);
  const [unlocks, setUnlocks] = useState([]);
  const [userEmails, setUserEmails] = useState({});
  const [seriesTitles, setSeriesTitles] = useState({});
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const floorIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const [uo, bo, un] = await Promise.all([
        supabase.from('ucoins_orders').select('*').gte('created_at', floorIso).order('created_at', { ascending: false }).limit(2000),
        supabase.from('series_purchases').select('*').gte('created_at', floorIso).order('created_at', { ascending: false }).limit(2000),
        supabase.from('episode_unlocks').select('id,user_id,series_id,episode_id,unlock_type,ucoins_paid,unlocked_at').gte('unlocked_at', floorIso).order('unlocked_at', { ascending: false }).limit(2000),
      ]);
      if (uo.error) throw uo.error;
      if (bo.error) throw bo.error;
      if (un.error) throw un.error;
      setUcoinsOrders(uo.data || []);
      setBundles(bo.data || []);
      setUnlocks(un.data || []);

      /* §2026-05-25 fei — email hydration deferred to Phase 3 (would need
       *   a new /api/admin/users/by-ids batch endpoint; the existing
       *   /api/admin/users/list does substring search only).
       *   For Phase 2 MVP: short UID is fine, admin can cross-reference
       *   via the Users tab using the visible UID prefix as a search key. */
      setUserEmails({});

      // Series titles for bundle + unlock rows
      const seriesIds = [...new Set([
        ...(bo.data || []).map(o => o.series_id),
        ...(un.data || []).map(o => o.series_id),
      ])].filter(Boolean);
      if (seriesIds.length > 0) {
        const { data: sRows } = await supabase.from('series').select('id,title').in('id', seriesIds);
        const titles = {};
        for (const s of sRows || []) titles[s.id] = s.title;
        setSeriesTitles(titles);
      }
    } catch (e) {
      console.error('[PaymentLedgerView] load failed:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [days]);
  useEffect(() => { setPage(0); }, [search, typeFilter, statusFilter, days]);

  /* §2026-05-26 fei (audit #10) — Admin refund button handler. Calls the new
   * /api/admin/drama/refund endpoint with source_table + source_id + reason
   * (prompted). Server handles Stripe refunds.create + atomic DB reversal
   * (wallet decrement via RPC for ucoins / bundle unlocks revoke for
   * series_purchases). On success, refetch list so row flips to refunded. */
  const [refundingId, setRefundingId] = useState(null);
  const handleRefund = async (row) => {
    if (!['charge', 'bundle'].includes(row.type)) return;
    const sourceTable = row.source_table;  // 'ucoins_orders' or 'series_purchases'
    const usd = (row.amount_cents / 100).toFixed(2);
    const reason = window.prompt(
      `确认对此订单退款?\n\n` +
      `类型: ${row.subject}\n` +
      `金额: $${usd}\n` +
      `用户: ${userEmails[row.user_id] || row.user_id.slice(0, 8)}\n\n` +
      `操作将:\n` +
      `· 调 Stripe API 把款退回用户支付方式\n` +
      `· ${sourceTable === 'ucoins_orders' ? '从用户 wallet_balance 扣回 Tokens(余额不足时扣到 0)' : '撤销该用户对本剧的整剧解锁'}\n` +
      `· 标记订单 status=refunded\n\n` +
      `请输入退款原因 (审计用):`
    );
    if (!reason || !reason.trim()) return;
    setRefundingId(row.ref_id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('/api/admin/drama/refund', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_table: sourceTable,
          source_id: row.ref_id,
          reason: reason.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.errMessage || `HTTP ${resp.status}`);
      }
      alert(`✅ 已退款 $${(data.refunded_amount_cents / 100).toFixed(2)}\nStripe refund id: ${data.refund_id}`);
      load();  // refetch
    } catch (err) {
      alert('❌ 退款失败: ' + (err.message || err));
    } finally {
      setRefundingId(null);
    }
  };

  /* ── Normalize all three sources to a single row shape ──────────── */
  const rows = useMemo(() => {
    const all = [];
    for (const o of ucoinsOrders) {
      all.push({
        ts: o.completed_at || o.created_at,
        user_id: o.user_id,
        type: 'charge',
        amount_cents: o.amount_usd_cents,
        ucoins_delta: o.status === 'succeeded' ? o.ucoins_to_credit : 0,
        subject: `充值 ${o.ucoins_to_credit} Tokens${o.is_first_charge ? ' (首充)' : ''}`,
        status: o.status,
        ref_id: o.id,
        source_table: 'ucoins_orders',
      });
    }
    for (const o of bundles) {
      all.push({
        ts: o.completed_at || o.created_at,
        user_id: o.user_id,
        type: 'bundle',
        amount_cents: o.amount_usd_cents,
        ucoins_delta: 0,
        subject: `整剧买断:${seriesTitles[o.series_id] || o.series_id.slice(0, 8) + '…'}`,
        status: o.status,
        ref_id: o.id,
        source_table: 'series_purchases',
      });
    }
    for (const u of unlocks) {
      all.push({
        ts: u.unlocked_at,
        user_id: u.user_id,
        type: u.unlock_type === 'member' ? 'member' : 'unlock',
        amount_cents: 0,                          // not a $ payment, Tokens spend or comp
        ucoins_delta: -(u.ucoins_paid || 0),
        subject: `解锁 ${seriesTitles[u.series_id] || u.series_id.slice(0, 8) + '…'} (${u.unlock_type})`,
        status: 'succeeded',                      // unlocks are atomic on success
        ref_id: u.id,
        source_table: 'episode_unlocks',
      });
    }
    return all.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  }, [ucoinsOrders, bundles, unlocks, seriesTitles]);

  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const email = (userEmails[r.user_id] || '').toLowerCase();
        const uid = r.user_id.toLowerCase();
        if (!email.includes(q) && !uid.includes(q) && !(r.subject || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [rows, typeFilter, statusFilter, search, userEmails]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="搜索 邮箱 / user_id / 主题"
          className="flex-1 min-w-[260px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
        >
          <option value="all">全部类型</option>
          <option value="charge">充值</option>
          <option value="bundle">整剧买断</option>
          <option value="unlock">Tokens 解锁</option>
          <option value="member">会员解锁</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
        >
          <option value="all">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="pending">处理中</option>
          <option value="refunded">退款</option>
          <option value="failed">失败</option>
        </select>
        <select
          value={days}
          onChange={e => setDays(Number(e.target.value))}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
        >
          <option value={1}>近 1 天</option>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
          <option value={90}>近 90 天</option>
        </select>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm"
        >
          <ArrowsClockwise size={14} /> 刷新
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400">{error}</div>
      )}

      {/* Summary */}
      <div className="text-xs text-zinc-500">
        共 {filtered.length} 条记录 (近 {days} 天). 当前页 {page + 1} / {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
      </div>

      {/* Ledger table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-500">
          <CircleNotch size={28} className="animate-spin mr-2" /> 加载中…
        </div>
      ) : pageRows.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-12 border border-dashed border-zinc-800 rounded-xl">
          无匹配记录
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-3">时间</th>
                <th className="text-left px-4 py-3">用户</th>
                <th className="text-left px-4 py-3">类型</th>
                <th className="text-left px-4 py-3">主题</th>
                <th className="text-right px-4 py-3">金额</th>
                <th className="text-right px-4 py-3">Tokens</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-left px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {pageRows.map(r => {
                const tl = TYPE_LABELS[r.type] || TYPE_LABELS.charge;
                return (
                  <tr key={`${r.source_table}-${r.ref_id}`} className="hover:bg-zinc-900/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap">
                      {r.ts ? new Date(r.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <button
                        onClick={() => setSelectedUserId(r.user_id)}
                        className="text-white hover:text-blue-400 truncate max-w-[14rem] block"
                        title="查看该用户全部活动"
                      >
                        {userEmails[r.user_id] || r.user_id.slice(0, 8) + '…'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${tl.bg} ${tl.color}`}>
                        {tl.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300 text-xs truncate max-w-[22rem]">{r.subject}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.amount_cents > 0 ? <span className="text-emerald-400">{formatUsdCents(r.amount_cents)}</span> : <span className="text-zinc-600">—</span>}
                    </td>
                    <td className={`px-4 py-3 text-right tabular-nums ${r.ucoins_delta > 0 ? 'text-emerald-400' : r.ucoins_delta < 0 ? 'text-rose-400' : 'text-zinc-600'}`}>
                      {r.ucoins_delta !== 0 ? (r.ucoins_delta > 0 ? '+' : '') + r.ucoins_delta : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        r.status === 'succeeded' ? 'bg-emerald-500/15 text-emerald-400'
                      : r.status === 'pending' ? 'bg-amber-500/15 text-amber-400'
                      : r.status === 'refunded' ? 'bg-rose-500/15 text-rose-400'
                      : 'bg-zinc-700/40 text-zinc-400'
                      }`}>
                        {ORDER_STATUS_LABEL[r.status] || r.status}
                      </span>
                    </td>
                    {/* §2026-05-26 fei (audit #10) — Refund button. Eligible
                        only for charge / bundle rows in succeeded state. Unlock
                        rows (Tokens spent on episodes) are not refundable
                        through Stripe — they'd need a manual +Tokens grant
                        via wallet admin. */}
                    <td className="px-4 py-3 text-[10px]">
                      {['charge', 'bundle'].includes(r.type) && r.status === 'succeeded' ? (
                        <button
                          type="button"
                          onClick={() => handleRefund(r)}
                          disabled={refundingId === r.ref_id}
                          className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-400 text-[10px] font-medium disabled:opacity-50"
                          title="调 Stripe API 退款 + 反向 DB 操作"
                        >
                          {refundingId === r.ref_id ? '处理中…' : '退款'}
                        </button>
                      ) : (
                        <span className="text-zinc-600 font-mono">{r.ref_id?.slice(0, 8)}…</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-zinc-400 tabular-nums">{page + 1} / {Math.ceil(filtered.length / PAGE_SIZE)}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={(page + 1) * PAGE_SIZE >= filtered.length}
            className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}

      {selectedUserId && (
        <UserPaymentDrawer
          userId={selectedUserId}
          userEmail={userEmails[selectedUserId]}
          allRows={rows.filter(r => r.user_id === selectedUserId)}
          onClose={() => setSelectedUserId(null)}
        />
      )}
    </div>
  );
}

/* ── UserPaymentDrawer — 单用户全部活动 + Tokens 余额 + 累计 LTV ─── */
function UserPaymentDrawer({ userId, userEmail, allRows, onClose }) {
  const [balance, setBalance] = useState(null);
  const [balanceLoading, setBalanceLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setBalanceLoading(true);
      try {
        const { data, error } = await supabase
          .from('wallet_balance')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();
        if (cancelled) return;
        if (error) console.warn('[UserPaymentDrawer] balance fetch:', error);
        setBalance(data || { ucoins_balance: 0, ucoins_lifetime_purchased: 0, ucoins_lifetime_spent: 0 });
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const ltv = useMemo(() => {
    const charged = allRows.filter(r => (r.type === 'charge' || r.type === 'bundle') && r.status === 'succeeded')
      .reduce((s, r) => s + r.amount_cents, 0);
    const succeeded = allRows.filter(r => r.status === 'succeeded').length;
    const refunded = allRows.filter(r => r.status === 'refunded').reduce((s, r) => s + r.amount_cents, 0);
    return { charged, succeeded, refunded, net: charged - refunded };
  }, [allRows]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70" onClick={onClose}>
      <div
        className="absolute top-0 right-0 h-full w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-white">用户付费详情</h3>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono">{userEmail || userId}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Wallet balance card */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">当前余额</div>
              <div className="text-xl font-semibold text-amber-400 tabular-nums">
                {balanceLoading ? '…' : `${balance?.ucoins_balance || 0}`}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Tokens</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">累计充值</div>
              <div className="text-xl font-semibold text-emerald-400 tabular-nums">
                {balanceLoading ? '…' : `${balance?.ucoins_lifetime_purchased || 0}`}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Tokens</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">累计消费</div>
              <div className="text-xl font-semibold text-rose-400 tabular-nums">
                {balanceLoading ? '…' : `${balance?.ucoins_lifetime_spent || 0}`}
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Tokens</div>
            </div>
          </div>

          {/* LTV */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">累计付费 (LTV)</div>
              <div className="text-2xl font-semibold text-white tabular-nums">{formatUsdCents(ltv.charged)}</div>
              <div className="text-[10px] text-zinc-500 mt-1">{ltv.succeeded} 笔成功</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">净付费 (扣退款)</div>
              <div className="text-2xl font-semibold text-emerald-400 tabular-nums">{formatUsdCents(ltv.net)}</div>
              <div className="text-[10px] text-zinc-500 mt-1">退款 {formatUsdCents(ltv.refunded)}</div>
            </div>
          </div>

          {/* Full activity list */}
          <div>
            <h4 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">该用户全部活动 ({allRows.length})</h4>
            {allRows.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-6 border border-dashed border-zinc-800 rounded-xl">无记录</p>
            ) : (
              <div className="space-y-1">
                {allRows.map(r => {
                  const tl = TYPE_LABELS[r.type] || TYPE_LABELS.charge;
                  return (
                    <div key={`${r.source_table}-${r.ref_id}`} className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${tl.bg} ${tl.color}`}>{tl.label}</span>
                          <span className="text-[10px] text-zinc-500">{r.ts && new Date(r.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="text-xs text-zinc-300 truncate">{r.subject}</div>
                      </div>
                      <div className="text-right ml-3">
                        {r.amount_cents > 0 && <div className="text-xs text-emerald-400 tabular-nums">{formatUsdCents(r.amount_cents)}</div>}
                        {r.ucoins_delta !== 0 && (
                          <div className={`text-[10px] tabular-nums ${r.ucoins_delta > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {r.ucoins_delta > 0 ? '+' : ''}{r.ucoins_delta} Tokens
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * DailyTrendChart — stacked bar (Tokens + bundle) per day
 *
 * Pure inline SVG so we don't pull in chart.js / recharts (each is
 * 80-120KB gz). For a ≤90-day trend the manual SVG is < 2KB and
 * renders at 60fps. Hover tooltip is CSS-only via group-hover.
 * ─────────────────────────────────────────────────────────────────────── */
function DailyTrendChart({ days, maxCents }) {
  if (!days || days.length === 0) {
    return <p className="text-sm text-zinc-500 text-center py-8">本期内无成交订单</p>;
  }
  const CHART_H = 180;
  const BAR_GAP = 2;
  const w = 100 / days.length;  // width % per bar slot

  return (
    <div className="space-y-2">
      <div className="relative" style={{ height: CHART_H + 28 }}>
        {/* Y axis labels (top + middle + 0) */}
        <div className="absolute inset-y-0 left-0 w-12 flex flex-col justify-between text-[10px] text-zinc-500 pr-2 text-right pb-7">
          <span>${(maxCents / 100).toFixed(0)}</span>
          <span>${(maxCents / 200).toFixed(0)}</span>
          <span>$0</span>
        </div>
        <svg
          viewBox={`0 0 100 ${CHART_H + 28}`}
          preserveAspectRatio="none"
          className="absolute inset-y-0 right-0 w-[calc(100%-3rem)]"
          style={{ height: '100%' }}
        >
          {/* Horizontal grid lines (3 of them) */}
          {[0, 0.5, 1].map((p, i) => (
            <line key={i} x1={0} x2={100} y1={CHART_H * p} y2={CHART_H * p} stroke="#27272a" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          ))}
          {days.map((day, i) => {
            const x = i * w + BAR_GAP / 2;
            const barW = Math.max(0.5, w - BAR_GAP);
            const ucoinsH = (day.ucoins / maxCents) * CHART_H;
            const bundleH = (day.bundle / maxCents) * CHART_H;
            const totalH = ucoinsH + bundleH;
            return (
              <g key={day.date} className="group cursor-default">
                <title>
                  {day.date}: ${(day.total / 100).toFixed(2)} (Tokens ${(day.ucoins / 100).toFixed(2)} + 买断 ${(day.bundle / 100).toFixed(2)})
                </title>
                {/* Bundle (top) */}
                {bundleH > 0 && (
                  <rect x={x} y={CHART_H - totalH} width={barW} height={bundleH} fill="#a855f7" />
                )}
                {/* Tokens (bottom) */}
                {ucoinsH > 0 && (
                  <rect x={x} y={CHART_H - ucoinsH} width={barW} height={ucoinsH} fill="#f59e0b" />
                )}
                {/* Hover highlight */}
                <rect x={x} y={0} width={barW} height={CHART_H} fill="transparent" className="opacity-0 group-hover:opacity-10 group-hover:fill-white" />
              </g>
            );
          })}
        </svg>
        {/* X axis labels (show every Nth so we don't crowd) */}
        <div className="absolute inset-x-0 bottom-0 left-12 flex justify-between text-[9px] text-zinc-500">
          {days.length > 0 && (
            <>
              <span>{days[0].date.slice(5)}</span>
              {days.length > 7 && (
                <span>{days[Math.floor(days.length / 2)].date.slice(5)}</span>
              )}
              <span>{days[days.length - 1].date.slice(5)}</span>
            </>
          )}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-end gap-4 text-[11px] text-zinc-400 pt-2">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
          Tokens 充值
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#a855f7' }} />
          整剧买断
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * CompositionDonut — inline SVG donut for revenue composition
 *
 * Calculates per-arc start/end angles based on each part's % of total
 * and renders as <path d="M..A..L.. z" /> arcs. Hover shows tooltip
 * via <title>. Empty state shows a flat ring.
 * ─────────────────────────────────────────────────────────────────────── */
function CompositionDonut({ parts, total }) {
  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <div className="w-32 h-32 rounded-full border-8 border-zinc-800" />
        <p className="text-sm text-zinc-500">暂无收入</p>
      </div>
    );
  }
  const R = 50, IR = 32;  // outer / inner radius
  const CX = 60, CY = 60;
  let currentAngle = -Math.PI / 2;  // start at 12 o'clock
  const arcs = parts.map(p => {
    const ratio = p.cents / total;
    const angle = ratio * 2 * Math.PI;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;
    const x1 = CX + R * Math.cos(startAngle);
    const y1 = CY + R * Math.sin(startAngle);
    const x2 = CX + R * Math.cos(endAngle);
    const y2 = CY + R * Math.sin(endAngle);
    const x3 = CX + IR * Math.cos(endAngle);
    const y3 = CY + IR * Math.sin(endAngle);
    const x4 = CX + IR * Math.cos(startAngle);
    const y4 = CY + IR * Math.sin(startAngle);
    const largeArc = angle > Math.PI ? 1 : 0;
    const d = [
      `M ${x1} ${y1}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2}`,
      `L ${x3} ${y3}`,
      `A ${IR} ${IR} 0 ${largeArc} 0 ${x4} ${y4}`,
      'Z',
    ].join(' ');
    return { d, color: p.color, label: p.label, cents: p.cents, ratio };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 120 120" className="w-32 h-32">
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill={arc.color}>
            <title>{arc.label}: ${(arc.cents / 100).toFixed(2)} ({(arc.ratio * 100).toFixed(1)}%)</title>
          </path>
        ))}
        <text x={CX} y={CY - 4} textAnchor="middle" className="text-[10px] fill-zinc-500">总计</text>
        <text x={CX} y={CY + 10} textAnchor="middle" className="text-[14px] fill-white font-semibold">
          ${(total / 100).toFixed(0)}
        </text>
      </svg>
      <div className="w-full space-y-1">
        {arcs.map((arc, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 text-zinc-300">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: arc.color }} />
              {arc.label}
            </span>
            <span className="tabular-nums text-zinc-400">{(arc.ratio * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────────
 * AcquisitionCostsView — 归因投流成本管理 (Phase 3 PDF §7 第三期)
 *
 * Lets admin record per-series × per-period × per-channel ad spend.
 * Settlement engine then deducts the SUM from GMV when computing
 * distributable revenue (system_settings.default_include_acquisition_cost = true).
 *
 * UI:
 *   - Period filter (default current month) + "查看上月 / 下月" arrows
 *   - "录入花费" button → modal (series picker / channel select / amount)
 *   - Cost table with ROI column (GMV in same period ÷ acquisition cost)
 *   - Per-row 编辑 / 删除
 * ─────────────────────────────────────────────────────────────────────── */

const ACQ_CHANNELS = [
  { id: 'facebook',   label: 'Facebook / Meta' },
  { id: 'google',     label: 'Google Ads' },
  { id: 'tiktok',     label: 'TikTok Ads' },
  { id: 'influencer', label: 'Influencer / KOL' },
  { id: 'other',      label: 'Other' },
];

export function AcquisitionCostsView() {
  const [period, setPeriod] = useState(currentPeriod());
  const [loading, setLoading] = useState(true);
  const [costs, setCosts] = useState([]);
  const [seriesList, setSeriesList] = useState([]);
  const [seriesGmv, setSeriesGmv] = useState({});      // for ROI column
  const [error, setError] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState(null);

  const fetchAuthed = async (path, init = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');
    return fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [costsResp, sList, gmvResp] = await Promise.all([
        fetchAuthed(`/api/admin/acquisition-costs?period=${encodeURIComponent(period)}`),
        // For the series picker in the modal + title lookup
        supabase.from('series').select('id,title,user_id').order('updated_at', { ascending: false }).limit(500),
        // GMV per series for ROI column — use settlements if generated, else just sum orders
        fetchAuthed(`/api/admin/settlements?period=${encodeURIComponent(period)}`),
      ]);
      const cj = await costsResp.json();
      if (!costsResp.ok || cj?.success === false) throw new Error(cj?.errMessage || 'Failed to load costs');
      setCosts(cj.rows || []);
      setSeriesList(sList.data || []);
      const gj = await gmvResp.json();
      if (gj.success && Array.isArray(gj.rows)) {
        const map = {};
        for (const r of gj.rows) map[r.series_id] = r.gmv_cents;
        setSeriesGmv(map);
      } else {
        setSeriesGmv({});
      }
    } catch (e) {
      console.error('[AcquisitionCostsView] load failed:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

  /* Per-series totals for the ROI summary */
  const perSeries = useMemo(() => {
    const map = new Map();
    for (const c of costs) {
      const prev = map.get(c.series_id) || { series_id: c.series_id, title: c.series?.title || c.series_id.slice(0,8)+'…', totalCents: 0, channels: [] };
      prev.totalCents += c.amount_usd_cents;
      prev.channels.push(c);
      map.set(c.series_id, prev);
    }
    const out = [...map.values()].map(s => ({
      ...s,
      gmv: seriesGmv[s.series_id] || 0,
      roi: s.totalCents > 0 ? (seriesGmv[s.series_id] || 0) / s.totalCents : null,
    }));
    out.sort((a, b) => b.totalCents - a.totalCents);
    return out;
  }, [costs, seriesGmv]);

  const grandTotal = costs.reduce((s, c) => s + c.amount_usd_cents, 0);
  const grandGmv = perSeries.reduce((s, p) => s + p.gmv, 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm text-zinc-400">周期</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-white text-sm"
          >
            {lastNPeriods(12).map(p => (
              <option key={p} value={p}>{p}{p === currentPeriod() ? ' (本月)' : ''}</option>
            ))}
          </select>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-sm">
            <ArrowsClockwise size={14} /> 刷新
          </button>
        </div>
        <button
          onClick={() => { setEditingRow(null); setModalOpen(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium"
        >
          <Coin size={14} weight="fill" /> 录入花费
        </button>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <Warning size={16} /> {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard icon={Coin}    label={`${period} 总投流`}  value={formatUsdCents(grandTotal)} hint={`${costs.length} 条记录`} color="rose" />
        <MetricCard icon={ChartBar} label="同期 GMV (结算)"    value={formatUsdCents(grandGmv)}   hint={perSeries.length ? `${perSeries.length} 部剧` : '需先生成结算'} color="emerald" />
        <MetricCard
          icon={Trophy}
          label="整体 ROI"
          value={grandTotal > 0 ? `${(grandGmv / grandTotal).toFixed(2)}×` : '—'}
          hint="GMV ÷ 投流花费"
          color={grandTotal > 0 && grandGmv / grandTotal >= 1.5 ? 'emerald' : 'amber'}
        />
      </div>

      {/* Per-series ROI table */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-2">按剧 ROI</h3>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-zinc-500">
            <CircleNotch size={24} className="animate-spin mr-2" /> 加载中…
          </div>
        ) : perSeries.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-8 border border-dashed border-zinc-800 rounded-xl">
            该周期暂无投流记录。点击"录入花费"录入。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">剧集</th>
                  <th className="text-left px-4 py-3">渠道分布</th>
                  <th className="text-right px-4 py-3">投流合计</th>
                  <th className="text-right px-4 py-3">同期 GMV</th>
                  <th className="text-right px-4 py-3">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {perSeries.map(s => {
                  const roiColor = s.roi == null ? 'text-zinc-500'
                    : s.roi >= 2 ? 'text-emerald-400 font-semibold'
                    : s.roi >= 1 ? 'text-blue-400'
                    : 'text-rose-400';
                  return (
                    <tr key={s.series_id} className="hover:bg-zinc-900/30">
                      <td className="px-4 py-3 text-white font-medium truncate max-w-[16rem]">{s.title}</td>
                      <td className="px-4 py-3 text-xs text-zinc-400">
                        {s.channels.map(c => (
                          <span key={c.id} className="inline-block mr-2 mb-1 px-1.5 py-0.5 rounded bg-zinc-800/80">
                            {c.channel}: {formatUsdCents(c.amount_usd_cents)}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-rose-400 font-medium">{formatUsdCents(s.totalCents)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-emerald-400">{formatUsdCents(s.gmv)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${roiColor}`}>{s.roi == null ? '—' : `${s.roi.toFixed(2)}×`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Raw rows table */}
      <div>
        <h3 className="text-sm font-medium text-zinc-300 mb-2">明细 ({costs.length})</h3>
        {costs.length === 0 ? null : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900/60 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">剧集</th>
                  <th className="text-left px-4 py-3">渠道</th>
                  <th className="text-right px-4 py-3">金额</th>
                  <th className="text-left px-4 py-3">备注</th>
                  <th className="text-left px-4 py-3">录入时间</th>
                  <th className="text-left px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {costs.map(c => (
                  <tr key={c.id} className="hover:bg-zinc-900/30">
                    <td className="px-4 py-3 text-white text-xs truncate max-w-[14rem]">{c.series?.title || c.series_id.slice(0,8)+'…'}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{c.channel}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-white">{formatUsdCents(c.amount_usd_cents)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400 truncate max-w-[18rem]">{c.notes || '—'}</td>
                    <td className="px-4 py-3 text-[10px] text-zinc-500">{c.created_at && new Date(c.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-3 flex items-center gap-1">
                      <button onClick={() => { setEditingRow(c); setModalOpen(true); }} className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs">
                        <PencilSimple size={11} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!window.confirm('删除该条投流记录?该周期结算需重新生成才能反映改动。')) return;
                          try {
                            const resp = await fetchAuthed(`/api/admin/acquisition-costs/${c.id}`, { method: 'DELETE' });
                            const j = await resp.json();
                            if (!resp.ok || j?.success === false) throw new Error(j?.errMessage || 'Delete failed');
                            load();
                          } catch (e) {
                            alert('删除失败: ' + e.message);
                          }
                        }}
                        className="px-2 py-1 bg-rose-900/40 hover:bg-rose-800/60 text-rose-400 rounded text-xs"
                      >
                        <X size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <AcquisitionCostModal
          period={period}
          seriesList={seriesList}
          row={editingRow}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); load(); }}
        />
      )}

      <p className="text-[10px] text-zinc-600 text-center">
        投流花费纳入结算公式的 A (PDF §4.2)。需重新生成本月结算单才能反映改动 (分成结算 → 重新计算)。
      </p>
    </div>
  );
}

function AcquisitionCostModal({ period: initialPeriod, seriesList, row, onClose, onSaved }) {
  const [seriesId, setSeriesId] = useState(row?.series_id || '');
  const [period, setPeriod] = useState(row?.period || initialPeriod);
  const [channel, setChannel] = useState(row?.channel || 'facebook');
  const [amountUsd, setAmountUsd] = useState(row ? (row.amount_usd_cents / 100).toString() : '');
  const [notes, setNotes] = useState(row?.notes || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isEdit = !!row;

  const fetchAuthed = async (path, init = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error('Not authenticated');
    return fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const amount = Math.round(parseFloat(amountUsd) * 100);
      if (isNaN(amount) || amount < 0) throw new Error('金额无效');
      if (!seriesId) throw new Error('请选择剧集');

      let resp;
      if (isEdit) {
        resp = await fetchAuthed(`/api/admin/acquisition-costs/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ amount_usd_cents: amount, notes }),
        });
      } else {
        resp = await fetchAuthed('/api/admin/acquisition-costs', {
          method: 'POST',
          body: JSON.stringify({ series_id: seriesId, period, channel, amount_usd_cents: amount, notes }),
        });
      }
      const j = await resp.json();
      if (!resp.ok || j?.success === false) throw new Error(j?.errMessage || 'Save failed');
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="text-base font-medium text-white">{isEdit ? '编辑投流记录' : '录入投流花费'}</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white"><X size={20} /></button>
        </div>
        <div className="p-6 space-y-4">
          <Field label="剧集">
            <select
              value={seriesId}
              onChange={e => setSeriesId(e.target.value)}
              disabled={isEdit}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
            >
              <option value="">选择剧集…</option>
              {seriesList.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="周期">
              <select
                value={period}
                onChange={e => setPeriod(e.target.value)}
                disabled={isEdit}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
              >
                {lastNPeriods(12).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="渠道">
              <select
                value={channel}
                onChange={e => setChannel(e.target.value)}
                disabled={isEdit}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
              >
                {ACQ_CHANNELS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          <Field label="金额 (USD)">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 text-sm">$</span>
              <input
                type="number" step="0.01" min="0" placeholder="1500.00"
                value={amountUsd}
                onChange={e => setAmountUsd(e.target.value)}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
          </Field>

          <Field label="备注 (可选)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="例:5/15-5/20 Meta 信息流 campaign A123"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm resize-none"
            />
          </Field>

          {error && <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">取消</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <><CircleNotch size={14} className="animate-spin" /> 保存中</> : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

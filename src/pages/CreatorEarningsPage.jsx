/**
 * §2026-05-25 fei — Phase 3 创作者自助后台:收益与结算
 *
 * Route: /creator/earnings (auth-gated)
 *
 * Surfaces:
 *   - Headline cards: 累计净收益 / 本月待打款 / 待我确认笔数
 *   - Month-by-month earnings list (one row per period × series)
 *   - Click row → settlement detail card (full breakdown per PDF §4.3)
 *   - "确认结算" button on pending_confirm rows (only the creator can call;
 *      moves to creator_confirmed via POST /api/creator/settlements/:id/confirm)
 *   - CSV download of all visible rows
 *
 * Access control:
 *   - settlements RLS policy `settlements_select_creator` already restricts
 *     SELECTs to rows where content_creator_id = auth.uid(), so no extra
 *     filter needed here — Supabase enforces it.
 *   - Confirm action goes through worker endpoint which re-verifies
 *     ownership server-side.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, CircleNotch, Coin, DownloadSimple, CheckCircle, ClockClockwise,
  Trophy, FilmReel, Bank, Wallet, ArrowRight, X,
} from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';

const STATUS_LABEL = {
  pending_confirm:   { label: '待我确认', color: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  creator_confirmed: { label: '已确认',   color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  paid:              { label: '已打款',   color: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  disputed:          { label: '争议中',   color: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  cancelled:         { label: '已取消',   color: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400' },
};

const formatUsdCents = (c) => `$${((c || 0) / 100).toFixed(2)}`;
const currentPeriod = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function CreatorEarningsPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settlements, setSettlements] = useState([]);
  const [seriesById, setSeriesById] = useState({});
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (!s) { setLoading(false); return; }

      // settlements RLS scopes to own rows
      const { data, error: sErr } = await supabase
        .from('settlements')
        .select('*')
        .order('period', { ascending: false })
        .order('gmv_cents', { ascending: false });
      if (sErr) throw sErr;
      setSettlements(data || []);

      // Hydrate series titles
      const seriesIds = [...new Set((data || []).map(r => r.series_id))];
      if (seriesIds.length > 0) {
        const { data: sRows } = await supabase
          .from('series')
          .select('id,title')
          .in('id', seriesIds);
        const map = {};
        for (const r of sRows || []) map[r.id] = r.title;
        setSeriesById(map);
      }
    } catch (e) {
      console.error('[CreatorEarningsPage] load failed:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  /* ── Derived summary ─────────────────────────────────────────────── */
  const summary = useMemo(() => {
    const paid = settlements.filter(s => s.status === 'paid');
    const pending = settlements.filter(s => s.status === 'pending_confirm');
    const confirmedUnpaid = settlements.filter(s => s.status === 'creator_confirmed');

    const lifetimePaidCents = paid.reduce((sum, r) => sum + r.creator_earnings_cents, 0);
    const pendingCents = pending.reduce((sum, r) => sum + r.creator_earnings_cents, 0);
    const confirmedUnpaidCents = confirmedUnpaid.reduce((sum, r) => sum + r.creator_earnings_cents, 0);

    // Current month's earnings (whatever status)
    const thisPeriod = currentPeriod();
    const thisMonth = settlements.filter(r => r.period === thisPeriod);
    const thisMonthCents = thisMonth.reduce((sum, r) => sum + r.creator_earnings_cents, 0);

    return {
      lifetimePaidCents,
      pendingCents,
      confirmedUnpaidCents,
      thisMonthCents,
      pendingCount: pending.length,
      seriesCount: new Set(settlements.map(r => r.series_id)).size,
    };
  }, [settlements]);

  /* ── CSV export of visible settlements ──────────────────────────── */
  const handleExportCsv = () => {
    const headers = ['period', 'series_title', 'series_id', 'gmv_usd', 'creator_earnings_usd', 'platform_earnings_usd', 'revenue_share_pct', 'status', 'generated_at', 'confirmed_at', 'paid_at', 'paid_reference'];
    const rows = settlements.map(r => [
      r.period,
      JSON.stringify(seriesById[r.series_id] || ''),
      r.series_id,
      (r.gmv_cents / 100).toFixed(2),
      (r.creator_earnings_cents / 100).toFixed(2),
      (r.platform_earnings_cents / 100).toFixed(2),
      r.revenue_share_pct,
      r.status,
      r.generated_at || '',
      r.confirmed_at || '',
      r.paid_at || '',
      JSON.stringify(r.paid_reference || ''),
    ].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uvera-earnings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <CircleNotch size={32} className="animate-spin text-accent" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <Wallet size={48} className="text-accent mb-4" weight="fill" />
        <h2 className="text-xl font-medium text-label mb-2">登录以查看创作者收益</h2>
        <button
          onClick={() => navigate('/login?next=/creator/earnings')}
          className="px-6 py-2.5 bg-accent text-white rounded-full font-medium hover:opacity-90 transition-opacity"
        >
          去登录
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 md:py-10">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-label-secondary hover:text-label mb-4"
      >
        <ArrowLeft size={16} /> 返回
      </button>

      <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-medium text-label mb-1">创作者收益</h1>
          <p className="text-sm text-label-tertiary">您发布的剧集每月分成结算明细</p>
        </div>
        {settlements.length > 0 && (
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 px-4 py-2 bg-background-secondary border border-background-tertiary text-label rounded-lg text-sm hover:bg-background-tertiary transition-colors"
          >
            <DownloadSimple size={14} /> 导出 CSV
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Headline cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <SummaryCard
          icon={Bank}
          color="emerald"
          label="累计已打款"
          value={formatUsdCents(summary.lifetimePaidCents)}
          hint={`${summary.seriesCount} 部剧`}
        />
        <SummaryCard
          icon={CheckCircle}
          color="blue"
          label="已确认待打款"
          value={formatUsdCents(summary.confirmedUnpaidCents)}
          hint="等平台支付"
        />
        <SummaryCard
          icon={ClockClockwise}
          color="amber"
          label="待我确认"
          value={formatUsdCents(summary.pendingCents)}
          hint={`${summary.pendingCount} 笔结算单`}
          highlight={summary.pendingCount > 0}
        />
        <SummaryCard
          icon={Coin}
          color="violet"
          label={`本月 (${currentPeriod()})`}
          value={formatUsdCents(summary.thisMonthCents)}
          hint="该月度结算合计"
        />
      </div>

      {/* Settlements list */}
      <h2 className="text-base font-medium text-label mb-3 flex items-center gap-2">
        <Trophy size={18} className="text-accent" /> 结算明细
      </h2>

      {settlements.length === 0 ? (
        <div className="border border-dashed border-background-tertiary rounded-xl p-12 text-center">
          <FilmReel size={36} className="text-label-tertiary mx-auto mb-3" />
          <p className="text-sm text-label-secondary">暂无结算单</p>
          <p className="text-xs text-label-tertiary mt-1">您的剧集产生收入后,管理员每月生成结算单后会出现在这里。</p>
          <Link
            to="/my-series"
            className="inline-flex items-center gap-1.5 mt-4 text-sm text-accent hover:underline"
          >
            去管理我的剧集 <ArrowRight size={14} />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {settlements.map(s => {
            const status = STATUS_LABEL[s.status] || STATUS_LABEL.pending_confirm;
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className="w-full text-left px-4 py-3 rounded-xl border border-background-tertiary bg-background-secondary hover:bg-background-tertiary transition-colors flex items-center gap-4"
              >
                <div className="text-xs text-label-tertiary tabular-nums w-20 shrink-0">{s.period}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-label truncate">{seriesById[s.series_id] || s.series_id.slice(0, 8) + '…'}</div>
                  <div className="text-[11px] text-label-tertiary mt-0.5">
                    GMV {formatUsdCents(s.gmv_cents)} · 分成 {s.revenue_share_pct}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-base font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {formatUsdCents(s.creator_earnings_cents)}
                  </div>
                  <span className={`inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                <ArrowRight size={16} className="text-label-tertiary shrink-0" />
              </button>
            );
          })}
        </div>
      )}

      {selected && (
        <SettlementDetailModal
          settlement={selected}
          seriesTitle={seriesById[selected.series_id]}
          onClose={() => setSelected(null)}
          onConfirmed={() => { setSelected(null); loadData(); }}
        />
      )}

      {/* Compliance footer */}
      <p className="mt-8 text-[11px] text-label-tertiary text-center">
        结算单按 Uvera 标准模型计算 (GMV − 渠道手续费 − 平台技术服务费 − 投流成本 = 可分配收入 × 分成比例)。
        如对数据有疑问可点击单条进入详情后选择"标记异议"通知运营。
      </p>
    </div>
  );
}

function SummaryCard({ icon: Icon, color, label, value, hint, highlight }) {
  const iconBg = {
    emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    blue:    'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    amber:   'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    violet:  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  }[color];
  return (
    <div className={`rounded-2xl border p-5 ${
      highlight
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-background-tertiary bg-background-secondary'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-label-tertiary uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          <Icon size={14} weight="fill" />
        </div>
      </div>
      <div className="text-2xl font-semibold text-label tabular-nums">{value}</div>
      {hint && <p className="text-[10px] text-label-tertiary mt-1">{hint}</p>}
    </div>
  );
}

/* ── Creator-facing settlement detail modal ─────────────────────────── */

function SettlementDetailModal({ settlement, seriesTitle, onClose, onConfirmed }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');

  const status = STATUS_LABEL[settlement.status] || STATUS_LABEL.pending_confirm;
  const canConfirm = settlement.status === 'pending_confirm';

  const handleConfirm = async () => {
    if (!window.confirm('确认本期结算金额无误?确认后将提交平台打款。')) return;
    setConfirming(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('请先登录');
      const resp = await fetch(`/api/creator/settlements/${settlement.id}/confirm`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ notes: note.trim() || undefined }),
      });
      const json = await resp.json();
      if (!resp.ok || json?.success === false) throw new Error(json?.errMessage || 'Confirm failed');
      onConfirmed();
    } catch (e) {
      console.error('[CreatorEarningsPage] confirm failed:', e);
      setError(e.message);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl shadow-2xl border border-background-tertiary"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-background border-b border-background-tertiary px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-medium text-label">{settlement.period} 结算单</h3>
            <p className="text-xs text-label-tertiary mt-0.5 truncate max-w-md">{seriesTitle || settlement.series_id}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded text-[10px] font-medium ${status.color}`}>{status.label}</span>
            <button onClick={onClose} className="text-label-tertiary hover:text-label"><X size={20} /></button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* GMV breakdown */}
          <Section title="GMV (总流水)">
            <Row label="Tokens 单集解锁">
              <div className="text-right">
                <div className="text-emerald-600 dark:text-emerald-400 tabular-nums">{formatUsdCents(settlement.ucoins_gmv_cents)}</div>
                <div className="text-[10px] text-label-tertiary">{settlement.unlock_count} 单 · {settlement.ucoins_consumed} Tokens</div>
              </div>
            </Row>
            <Row label="整剧买断">
              <div className="text-right">
                <div className="text-emerald-600 dark:text-emerald-400 tabular-nums">{formatUsdCents(settlement.bundle_gmv_cents)}</div>
                <div className="text-[10px] text-label-tertiary">{settlement.bundle_orders_count} 笔订单</div>
              </div>
            </Row>
            <Row label="GMV 合计" emphasize>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-semibold text-lg">{formatUsdCents(settlement.gmv_cents)}</span>
            </Row>
          </Section>

          <Section title="平台扣除">
            <Row label={`渠道支付手续费 (${settlement.channel_fee_pct}%)`}>
              <span className="text-label-tertiary tabular-nums">− {formatUsdCents(settlement.channel_fee_cents)}</span>
            </Row>
            <Row label={`平台技术服务费 (${settlement.service_fee_pct}%)`}>
              <span className="text-label-tertiary tabular-nums">− {formatUsdCents(settlement.service_fee_cents)}</span>
            </Row>
            <Row label="投流成本">
              <span className="text-label-tertiary tabular-nums">− {formatUsdCents(settlement.acquisition_cost_cents)}</span>
            </Row>
            <Row label="可分配收入" emphasize>
              <span className="text-blue-600 dark:text-blue-400 tabular-nums font-semibold">{formatUsdCents(settlement.distributable_cents)}</span>
            </Row>
          </Section>

          <Section title={`您的分成 (${settlement.revenue_share_pct}%)`}>
            <Row label="本期应得" emphasize>
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums font-bold text-xl">
                {formatUsdCents(settlement.creator_earnings_cents)}
              </span>
            </Row>
          </Section>

          {/* Timeline */}
          <Section title="进度">
            <Row label="生成时间">
              <span className="text-label-secondary text-xs">{settlement.generated_at ? new Date(settlement.generated_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
            <Row label="您确认时间">
              <span className="text-label-secondary text-xs">{settlement.confirmed_at ? new Date(settlement.confirmed_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
            <Row label="平台打款时间">
              <span className="text-label-secondary text-xs">{settlement.paid_at ? new Date(settlement.paid_at).toLocaleString('zh-CN') : '—'}</span>
            </Row>
            {settlement.paid_reference && (
              <Row label="打款流水">
                <span className="text-label-secondary text-xs font-mono">{settlement.paid_reference}</span>
              </Row>
            )}
            {settlement.notes && (
              <Row label="备注">
                <span className="text-label-secondary text-xs">{settlement.notes}</span>
              </Row>
            )}
          </Section>

          {canConfirm && (
            <Section title="确认结算">
              <div className="p-4 space-y-3">
                <p className="text-xs text-label-secondary leading-relaxed">
                  请仔细核对上面的金额。确认后将通知平台进入打款流程,确认后金额不可修改。
                </p>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={2}
                  placeholder="可选备注 (例:请按合同条款打款到 Stripe Connect xxx)"
                  className="w-full bg-background-secondary border border-background-tertiary rounded-lg px-3 py-2 text-sm text-label resize-none placeholder:text-label-tertiary"
                />
                {error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                )}
                <button
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="w-full px-4 py-2.5 bg-accent text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {confirming ? <><CircleNotch size={14} className="animate-spin" /> 确认中…</> : <><CheckCircle size={14} weight="fill" /> 确认本期结算</>}
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h4 className="text-xs uppercase tracking-wider text-label-tertiary px-4 mb-2">{title}</h4>
      <div className="rounded-xl border border-background-tertiary bg-background-secondary divide-y divide-background-tertiary">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children, emphasize }) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 ${emphasize ? 'bg-background' : ''}`}>
      <span className={`text-sm ${emphasize ? 'text-label font-medium' : 'text-label-secondary'}`}>{label}</span>
      <div>{children}</div>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import {
  Wallet, GearSix, Question, FileText, ArrowSquareOut,
  UserCircle, CheckCircle, WarningCircle, CaretRight, CaretDown, Sparkle as SparkleToken,
  VideoCamera, Image as ImageIcon, TextT, MagicWand, ArrowsClockwise, XCircle,
  Receipt, CreditCard, Prohibit,
  Coin, Crown, CircleNotch, SignOut,
} from '@phosphor-icons/react';
import ReactMarkdown from 'react-markdown';
import BackButton from '../design-system/composites/BackButton.jsx';

import { supabase, getUserProfile, claimDailyCredits } from '../api/supabaseClient';
import { pickAndUploadProfilePicture, PROFILE_PICTURE_KEY } from './profile/uploadProfilePicture';
// Ucoin 充值子面板复用订阅页实现(共享同一 wallet 缓存)。Wallet tab 下
// 现拆成 Subscription / Ucoin 两个子 tab,见 <WalletChannel> below。
import SubscriptionPage, { UcoinsTopupTab } from './SubscriptionPage';
import TokenBalanceCard from '../components/TokenBalanceCard';
import useUcoinsWallet from '../hooks/useUcoinsWallet';

const TABS = [
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Account', icon: GearSix },
  { id: 'help', label: 'Support', icon: Question },
  // 'legal' tab removed (2026-05-12): merged into Help Center as link list at bottom.
];

export default function SettingsPage({
  isSmallScreen,
  activeTab = 'wallet',
  onTabChange,
  darkMode,
  setDarkMode,
  isMuted,
  setIsMuted
}) {
  // Mobile layout uses full screens and back buttons, desktop uses sidebar navigation.
  const px = isSmallScreen ? 'px-4' : 'px-8';
  
  // Handlers for dynamic user data
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [credits, setCredits] = useState(0);
  const [tier, setTier] = useState('free');

  useEffect(() => {
    let cancelled = false;
    const fetchAll = () => {
      supabase.auth.getUser().then(({ data }) => {
        if (cancelled) return;
        const u = data?.user;
        if (u) {
          setUsername(u.user_metadata?.username || u.email?.split('@')[0] || '');
          setEmail(u.email || '');
        }
      });
      /* 2026-05-14 Leon — 静态 import getUserProfile,避免动态 import 的
         chunk-load 延迟造成 Wallet 显示 0 (Header 用静态 import 已经 fetch
         完 5M,Wallet 还卡在 useState(0) 默认值,甲方截图就抓到这个 transient
         state 报「Header/Wallet 不符」)。 */
      getUserProfile().then(profile => {
        if (cancelled) return;
        setCredits(profile.credits);
        setTier(profile.tier);
      });
    };
    fetchAll();

    /* 2026-05-13 Leon — Window focus refresh 已提到 supabaseClient.js 模块级
       singleton。此处只 listen TOKEN_REFRESHED 事件 + 首次 mount fetchAll。
       不再自己 call refreshSession 避免与全局 singleton 并发触发
       navigator.locks AbortError。 */
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (cancelled || !session?.user) return;
      fetchAll();
    });

    return () => {
      cancelled = true;
      subscription?.unsubscribe();
    };
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'wallet': return <WalletChannel isSmallScreen={isSmallScreen} credits={credits} tier={tier} />;
      case 'preferences': // backward-compat: 旧 'preferences' activeSection redirect 到合并后的 Account Settings
      case 'settings':
        return <AccountSettingsView
          username={username} setUsername={setUsername}
          email={email} setEmail={setEmail}
          darkMode={darkMode} setDarkMode={setDarkMode}
          isMuted={isMuted} setIsMuted={setIsMuted}
        />;
      case 'legal':  // 2026-05-12: 旧 'legal' tab 已合并入 Help Center,fallthrough
      case 'help': return <HelpView />;
      default: return null;
    }
  };

  return (
    <div className={`flex flex-col md:flex-row h-full w-full max-w-6xl mx-auto pb-16`}>
      {/* ── Mobile Page Header (Only visible on small screens to go back to explore) ── */}
      {isSmallScreen && (
        <div className={`pt-6 pb-2 ${px}`}>
          <BackButton className="mb-4" />
          <h2 className="text-3xl font-medium text-label tracking-tight" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>
            Settings
          </h2>
        </div>
      )}

      {/* ── Settings Sidebar ── */}
      <div className={`w-full md:w-[240px] flex-shrink-0 ${isSmallScreen ? 'mb-6 ' + px : 'border-r border-background-tertiary pr-6 pt-5 pb-8'}`}>
        {/* Desktop Header */}
        {!isSmallScreen && (
          <div className="mb-8">
            <h2 className="text-2xl font-medium text-label tracking-tight" style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}>
              Settings
            </h2>
            <p className="text-sm text-label-secondary mt-1">Manage your account</p>
          </div>
        )}
        <nav className={`flex ${isSmallScreen ? 'overflow-x-auto gap-2 no-scrollbar pb-2' : 'flex-col gap-1'}`}>
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-accent/10 text-accent dark:bg-accent/20'
                    : 'text-label-secondary hover:bg-background-secondary hover:text-label'
                }`}
              >
                <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* ── Settings Content ── */}
      <div className={`flex-1 min-w-0 ${isSmallScreen ? px : 'px-8 py-5'}`}>
        {renderTabContent()}
      </div>
    </div>
  );
}

/* ── Tab Views ── */

/* ─────────────────────────────────────────────────────────────────
 * Token activity row — one entry of the consumption history list.
 *
 * Sources data from public.generation_logs (one row per AI call). The
 * RLS policy generation_logs_self_read (migration 20260511) lets the
 * row owner read their own activity directly via supabase client.
 * ─────────────────────────────────────────────────────────────────── */
const GENERATION_TYPE_META = {
  video:           { icon: VideoCamera, label: 'Video' },
  concept_image:   { icon: ImageIcon,   label: 'Image' },
  script:          { icon: TextT,       label: 'Script' },
  asset_describe:  { icon: TextT,       label: 'Asset description' },
  optimize_prompt: { icon: MagicWand,   label: 'Prompt optimize' },
  random_ideas:    { icon: MagicWand,   label: 'Idea suggestions' },
};

const formatTimeAgo = (iso) => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return new Date(iso).toLocaleDateString();
  const min = Math.floor(ms / 60000);
  if (min < 1)  return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)   return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
};

/* §2026-06-09 — PurchaseHistoryRow / TokenActivityRow 已删除:Wallet 改用 credit_tx
   统一流水(右栏 Transactions),不再用 orders / generation_logs 双查的行组件。 */

/* §2026-06-09 — credit_tx 统一账本的过滤分类。每类 → 一组 tx_type;动态只显示
   有条目的 chip。值现全为 Token。 */
const TX_CATEGORIES = [
  { key: 'generation',   label: 'Generation',   types: ['spend_video', 'spend_storyboard', 'spend_image'] },
  { key: 'unlock',       label: 'Unlocks',      types: ['unlock_episode', 'unlock_bundle', 'tip'] },
  { key: 'topup',        label: 'Top-ups',      types: ['stripe_topup'] },
  { key: 'subscription', label: 'Subscription', types: ['stripe_subscription'] },
  { key: 'rewards',      label: 'Rewards',      types: ['daily', 'share', 'welcome', 'admin_grant'] },
  { key: 'refund',       label: 'Refunds',      types: ['refund'] },
];
const TX_TYPE_TO_CAT = Object.fromEntries(TX_CATEGORIES.flatMap(c => c.types.map(t => [t, c])));
const txCatLabel = (txType) => (TX_TYPE_TO_CAT[txType]?.label) || txType;

function WalletView({ isSmallScreen, credits = 0, tier = 'free' }) {
  const [localCredits, setLocalCredits] = useState(credits);
  // §2026-06-09 (Leon「数据同源同值」)— 余额 + lifetime 统一走共享 useUcoinsWallet
  //   缓存(与 Top up pane / 订阅浮窗同一来源:/api/wallet/balance → user_credits),
  //   不再各自从 getUserProfile().credits / 直查 user_credits 拉两条路。localCredits
  //   + lifetime 仅作首帧 fallback。
  const { wallet: sharedWallet, setWallet: setSharedWallet } = useUcoinsWallet({ withPackages: false });
  const [claiming, setClaiming] = useState(false);
  const [claimableToday, setClaimableToday] = useState(false);
  const [claimMessage, setClaimMessage] = useState(null);
  // §2026-06-06 — 右栏内容:'plans'(默认 plan 选择)| 'activity'(完整 Token 流水)。
  //   左栏 Token activity 只显示 1 条 + Show more(→ 'activity');Change plan(→ 'plans')。
  const [rightPane, setRightPane] = useState('plans');
  const isPaid = tier && tier !== 'free';

  // §2026-06-09 — 统一流水:credit_tx(已有 RLS select-own,前端直查),替代原
  //   purchases(orders)+ Token activity(generation_logs)两套。按分类过滤;
  //   累计取自 user_credits.lifetime_granted/spent。
  const TX_PAGE_SIZE = 25;
  const [tx, setTx] = useState([]);
  const [txLoading, setTxLoading] = useState(true);
  const [txError, setTxError] = useState(null);
  const [txPage, setTxPage] = useState(0);
  const [txHasMore, setTxHasMore] = useState(true);
  const [txTotal, setTxTotal] = useState(null);
  const [txFilter, setTxFilter] = useState('all');
  const [presentCats, setPresentCats] = useState([]);          // 有条目的分类 key
  const [lifetime, setLifetime] = useState({ granted: 0, spent: 0 });

  const loadTx = async (page = 0, append = false, filterKey = 'all') => {
    setTxLoading(true);
    setTxError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setTxError('Sign in to view transactions.'); return; }
      let qb = supabase
        .from('credit_tx')
        .select('id, amount, balance_after, tx_type, description, created_at', { count: 'exact' })
        .eq('user_id', session.user.id);
      if (filterKey !== 'all') {
        const cat = TX_CATEGORIES.find(c => c.key === filterKey);
        if (cat) qb = qb.in('tx_type', cat.types);
      }
      const from = page * TX_PAGE_SIZE;
      const to   = from + TX_PAGE_SIZE - 1;
      const { data, error, count } = await qb.order('created_at', { ascending: false }).range(from, to);
      if (error) throw error;
      const rows = data || [];
      setTx(prev => append ? [...prev, ...rows] : rows);
      setTxHasMore(rows.length >= TX_PAGE_SIZE);
      setTxPage(page);
      if (count !== null && count !== undefined) setTxTotal(count);
    } catch (e) {
      console.warn('credit_tx fetch failed:', e);
      setTxError(e.message || 'Failed to load transactions');
    } finally {
      setTxLoading(false);
    }
  };

  const applyTxFilter = (key) => { setTxFilter(key); loadTx(0, false, key); };

  // Mount:累计(lifetime)+ 哪些分类有条目(动态 chip)+ 首页流水
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data: uc } = await supabase
        .from('user_credits').select('lifetime_granted, lifetime_spent')
        .eq('user_id', session.user.id).maybeSingle();
      if (uc) setLifetime({ granted: uc.lifetime_granted || 0, spent: uc.lifetime_spent || 0 });
      const { data: types } = await supabase
        .from('credit_tx').select('tx_type').eq('user_id', session.user.id).limit(2000);
      const present = new Set((types || []).map(r => TX_TYPE_TO_CAT[r.tx_type]?.key).filter(Boolean));
      setPresentCats(TX_CATEGORIES.filter(c => present.has(c.key)).map(c => c.key));
    })();
    loadTx(0, false, 'all');
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  // Universal daily login bonus — every user (free + paid) can claim 6 credits/day.
  // Detect whether today's claim is still available.
  useEffect(() => {
    setLocalCredits(credits);
    supabase.auth.getUser().then(({ data }) => {
      const meta = data?.user?.user_metadata || {};
      const today = new Date().toISOString().slice(0, 10);
      setClaimableToday(meta.last_claim_date !== today);
    });
  }, [credits, tier]);

  const handleClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    setClaimMessage(null);
    try {
      const r = await claimDailyCredits();
      if (r.success && r.claimed) {
        setLocalCredits(r.credits);
        // §2026-06-09 — 同步共享 wallet 缓存(余额 + 累计获取),各处余额一起刷新。
        setSharedWallet(w => ({
          ...(w || { ucoins: 0, lifetime_purchased: 0, lifetime_spent: 0, recent_tx: [] }),
          ucoins: r.credits,
          lifetime_purchased: (w?.lifetime_purchased ?? lifetime.granted) + (r.added || 0),
        }));
        setClaimableToday(false);
        setClaimMessage(`+${r.added} tokens claimed for today.`);
      } else if (r.success && !r.claimed) {
        setClaimableToday(false);
        setClaimMessage(r.message || 'Already claimed today.');
      } else {
        setClaimMessage(r.errMessage || 'Failed to claim');
      }
    } catch (e) {
      setClaimMessage(e.message);
    } finally {
      setClaiming(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { alert('Please sign in first.'); return; }
      const res = await fetch('/api/stripe/customer-portal', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.errMessage || 'Portal failed');
      window.location.href = data.url;
    } catch (e) {
      alert('Could not open subscription management: ' + e.message);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* §2026-06-06 — Wallet 标题/描述已上移到 WalletChannel(Tab 之上、常驻)。 */}
      {/* §2026-06-06 Step 3 — 两栏:左=余额/当前套餐/购买记录/Token 流水,
          右=plan 选择(embedded SubscriptionPage,垂直可展开卡 + 每卡右上 Upgrade
          CTA 直接结账)。移动端 grid-cols-1 自动单列。 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* §2026-06-09 (Leon)— 主卡间距:desktop 24(space-y-6)/ mobile 16(space-y-4)。
            Claim 条用负 margin 抵到与上方余额卡 8px(见下 -mt-2 md:-mt-4)。 */}
        <section className="space-y-4 md:space-y-6 min-w-0">

      {/* §2026-06-09 — 复用共享 <TokenBalanceCard>(与订阅浮窗同一组件,保证统一)。
          原 inline 卡(indigo SparkleToken 气泡)已抽走。Top up → 右栏充值。 */}
      <TokenBalanceCard credits={sharedWallet?.ucoins ?? localCredits} onTopUp={() => setRightPane('topup')} />

      {/* §2026-06-06 — 每日领取:全宽条放余额卡正下方(仅可领时)。full-width +
          min-h-[48px] 满足 mobile 44pt 触控基线;领完整条消失。 */}
      {claimableToday && (
        <button
          onClick={handleClaim}
          disabled={claiming}
          className="w-full min-h-[48px] -mt-2 md:-mt-4 px-5 py-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-sm font-medium hover:bg-emerald-500/15 transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {/* §2026-06-09 (Leon)— icon 从 Sparkle(= Header token pill 同款)改 Coin,
              与合并后 Token=Coin 视觉统一(余额卡/packs 一致)。 */}
          <Coin size={16} weight="fill" />
          {claiming ? 'Claiming…' : 'Claim today’s +6 tokens'}
        </button>
      )}
      {claimMessage && (
        <p className="text-xs text-label-secondary -mt-4">{claimMessage}</p>
      )}

      {/* Ucoin 已拆到 Wallet → Ucoin 子 tab(WalletChannel),此处不再嵌 brief card */}

      <div className="space-y-4">
        {/* §2026-06-09 (Leon)— 「Current Plan」section 标题并入卡内,作 tier 名上方
            小标签(仿 Current Balance 卡:label + 大值);去掉外层 h4。 */}
        <div className="rounded-2xl border border-accent bg-accent/5 p-6 relative overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="min-w-0">
              {/* §2026-06-09 (Leon)— eyebrow→title 视觉间距收到 ~8px(同 Current Balance):
                  eyebrow mb-0.5(2px)+ title 行 leading-none(消 line-height 撑出的留白)。 */}
              <div className="text-sm text-label-secondary font-medium mb-0.5">Current Subscription</div>
              <div className="flex items-center gap-2 flex-wrap leading-none">
                <span className="text-xl font-medium text-label capitalize">{tier}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-background-tertiary text-label-secondary whitespace-nowrap">
                  {tier === 'free' ? 'Lifetime' : 'Monthly'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setRightPane('plans')}
              className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
            >
              {isPaid ? 'Change plan' : 'Top up tokens'}
            </button>
          </div>
          {/* 2026-05-13 甲方反馈: free 用户隐藏付费管理按钮 (无 Stripe customer
               record,点击 API 会失败)。改为 Upgrade plan CTA 引导。
               付费用户保留 Manage + View Invoices,都跳 Stripe Customer Portal。 */}
          {isPaid ? (
            /* §2026-06-09 (Leon)— Manage / View Invoices:等宽(grid-cols-2 列等分)、
               间距 16(gap-4)、作为一组居卡片水平中心(max-w-xs + mx-auto)。 */
            <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
              <button
                onClick={handleManageSubscription}
                className="px-4 py-2 bg-background border border-background-tertiary text-label-secondary rounded-xl text-sm font-medium hover:border-label-quaternary hover:text-label transition-colors cursor-pointer whitespace-nowrap text-center"
              >
                Manage
              </button>
              <button
                onClick={handleManageSubscription}
                className="px-4 py-2 bg-background border border-background-tertiary text-label-secondary rounded-xl text-sm font-medium hover:border-label-quaternary hover:text-label transition-colors cursor-pointer whitespace-nowrap text-center"
              >
                View Invoices
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRightPane('plans')}
              className="px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              Upgrade plan
            </button>
          )}
        </div>
      </div>

      {/* §2026-06-09 — 累计 Card(替代原 Purchase history + Token activity 两个折叠块)。
          累计获取/消费取自 user_credits.lifetime_*;明细统一在右栏流水(可过滤)。 */}
      <div className="space-y-4">
        {/* §2026-06-09 (Leon)— 「Lifetime」section 标题并入卡内顶部(同 Current Plan
            处理);去掉外层 h4。 */}
        <div className="rounded-2xl border border-background-tertiary bg-background-secondary p-5">
          {/* §2026-06-09 (Leon)— 顶行:eyebrow「Lifetime Transactions」(与 Current
              Balance 同级 text-sm secondary,Transactions 并入、不再单做大标题)+ 右上
              「View all」CTA(仿其他卡 Change plan/Top up 的位置,与 eyebrow 平行)。 */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="text-sm text-label-secondary font-medium min-w-0 truncate">Lifetime Transactions</div>
            <button
              onClick={() => setRightPane('transactions')}
              className="flex-shrink-0 px-4 py-2 rounded-xl bg-background border border-background-tertiary text-label-secondary text-sm font-medium hover:border-label-quaternary hover:text-label transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap"
            >
              View all{txTotal != null ? ` (${txTotal})` : ''} →
            </button>
          </div>
          {/* §2026-06-09 (Leon)— 784/183 字号降级(text-2xl→text-lg,不再与 Current
              Balance 601 同级);两列 + min-w-0/truncate 兜底大数值不撑爆。 */}
          {/* §2026-06-09 (Leon)— label→value 视觉间距收到 ~8px(同 Current Balance):
              label mb-0.5 + value leading-none。 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="text-xs text-label-tertiary mb-0.5">Earned</div>
              <div className="text-lg font-semibold text-label tabular-nums truncate leading-none">{(sharedWallet?.lifetime_purchased ?? lifetime.granted).toLocaleString()}<span className="text-xs text-label-tertiary font-normal"> Tokens</span></div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-label-tertiary mb-0.5">Spent</div>
              <div className="text-lg font-semibold text-label tabular-nums truncate leading-none">{(sharedWallet?.lifetime_spent ?? lifetime.spent).toLocaleString()}<span className="text-xs text-label-tertiary font-normal"> Tokens</span></div>
            </div>
          </div>
        </div>
      </div>
        </section>

        {/* 右栏:rightPane='plans' → plan 选择;'topup' → 充值档位;
            'transactions' → 统一流水(credit_tx,过滤 chips,限高滚动)。 */}
        <section className="min-w-0">
          {rightPane === 'plans' && (
            <SubscriptionPage embedded currentTier={tier} isSmallScreen={isSmallScreen} />
          )}

          {/* §2026-06-06 货币合并(壳)— Top up:右栏显示充值档位(compact 单列)。
              名字仍是 Ucoin(独立货币),等费汇率方案后再改名 Tokens + 合并余额。 */}
          {rightPane === 'topup' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-label uppercase tracking-wider">Top up</h4>
                <button type="button" onClick={() => setRightPane('plans')} className="text-xs font-medium text-accent hover:opacity-80 transition-opacity cursor-pointer">← Back to plans</button>
              </div>
              <UcoinsTopupTab px="" compact showBalance={false} />
            </div>
          )}

          {rightPane === 'transactions' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-label uppercase tracking-wider">Transactions</h4>
                <button type="button" onClick={() => setRightPane('plans')} className="text-xs font-medium text-accent hover:opacity-80 transition-opacity cursor-pointer">← Back to plans</button>
              </div>
              {/* 过滤 chips:All + 只显示有条目的分类 */}
              <div className="flex flex-wrap gap-2">
                {[{ key: 'all', label: 'All' }, ...TX_CATEGORIES.filter(c => presentCats.includes(c.key))].map(c => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => applyTxFilter(c.key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${txFilter === c.key ? 'bg-accent text-white' : 'bg-background-secondary text-label-secondary hover:text-label border border-background-tertiary'}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-background-tertiary bg-background-secondary overflow-hidden">
                {txLoading && tx.length === 0 && (
                  <div className="py-10 px-6 text-center text-sm text-label-tertiary flex items-center justify-center gap-2">
                    <ArrowsClockwise size={14} className="animate-spin" /> Loading…
                  </div>
                )}
                {txError && tx.length === 0 && (
                  <div className="py-8 px-6 text-center">
                    <XCircle size={24} className="text-red-400 mx-auto mb-2" />
                    <p className="text-sm text-label-secondary">{txError}</p>
                  </div>
                )}
                {!txLoading && !txError && tx.length === 0 && (
                  <div className="py-12 px-6 text-center">
                    <SparkleToken size={28} className="text-label-quaternary mx-auto mb-2" />
                    <p className="text-sm font-medium text-label mb-1">No transactions yet</p>
                  </div>
                )}
                {tx.length > 0 && (
                  <>
                    <div className="divide-y divide-background-tertiary max-h-[calc(100vh-320px)] overflow-y-auto overscroll-contain">
                      {tx.map(t => (
                        <div key={t.id} className="flex items-center justify-between px-4 py-3 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm text-label truncate">{t.description || txCatLabel(t.tx_type)}</p>
                            <p className="text-[11px] text-label-tertiary">
                              {t.created_at ? new Date(t.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · {txCatLabel(t.tx_type)}
                            </p>
                          </div>
                          <div className={`font-semibold tabular-nums text-sm flex-shrink-0 ${t.amount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-label'}`}>
                            {t.amount > 0 ? `+${t.amount}` : t.amount}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-background-tertiary px-4 py-3 flex items-center justify-between bg-background/50 gap-3 flex-wrap">
                      <div className="text-[11px] text-label-tertiary">
                        {txTotal != null ? <>Showing {tx.length} of {txTotal}</> : <>{tx.length} shown</>}
                      </div>
                      <div className="flex items-center gap-3">
                        {isPaid && (
                          <button onClick={handleManageSubscription} className="text-[11px] font-medium text-label-secondary hover:text-label transition-colors flex items-center gap-1 cursor-pointer" title="Stripe-hosted invoices + receipts">
                            <ArrowSquareOut size={11} /> Receipts / invoices
                          </button>
                        )}
                        {txHasMore && (
                          <button onClick={() => loadTx(txPage + 1, true, txFilter)} disabled={txLoading} className="px-3 py-1 text-xs font-medium text-accent hover:opacity-80 transition-opacity disabled:opacity-50 cursor-pointer">
                            {txLoading ? 'Loading…' : 'Load more →'}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * Account Settings — 2-col layout（2026-05-07 Leon 决策）：
 *   Desktop: 左 account info / 右 Preferences（合并自原 Preferences tab，
 *            Profile pill 已移除独立菜单，统一入口在此）
 *   Mobile:  单列堆叠，Account 在上 / Preferences 在下
 *
 * 旧 'preferences' activeSection 仍 route 到 SettingsPage，由 renderTabContent
 * fallthrough 到本视图 — 保持外部 link backward-compat。
 */
function AccountSettingsView({
  username, setUsername,
  email, setEmail,
  darkMode, setDarkMode,
  isMuted, setIsMuted,
}) {
  const [profilePictureUrl, setProfilePictureUrl] = useState('');
  const [uploadingPicture, setUploadingPicture] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      // Supabase-side property is `avatar_url` (OAuth providers auto-fill it);
      // product-side calls it "profile picture". Prefer our own key, fall back
      // to the Supabase default so OAuth users see their existing picture.
      const meta = data?.user?.user_metadata;
      setProfilePictureUrl(meta?.[PROFILE_PICTURE_KEY] || meta?.avatar_url || '');
    });
  }, []);

  const handleChangeProfilePicture = async () => {
    if (uploadingPicture) return;
    setUploadingPicture(true);
    try {
      const url = await pickAndUploadProfilePicture();
      if (url) setProfilePictureUrl(url);
    } catch (err) {
      console.error('Failed to update profile picture:', err);
      alert(err?.message || 'Failed to update profile picture');
    } finally {
      setUploadingPicture(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl">
      <div>
        <h3 className="text-lg font-medium text-label mb-1">Account</h3>
        <p className="text-sm text-label-secondary">Update your profile details, private information, and preferences.</p>
      </div>

      {/* 2-col layout (md+): Account left / Preferences right
       *   Mobile (single col): Account stacks above Preferences. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

        {/* ── Left: Account info ────────────────────────────── */}
        <section className="space-y-6">
          <div className="flex items-center gap-6 pb-6 border-b border-background-tertiary">
            <button
              type="button"
              onClick={handleChangeProfilePicture}
              disabled={uploadingPicture}
              aria-label="Change profile picture"
              className="relative w-20 h-20 rounded-full overflow-hidden flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity disabled:opacity-60"
            >
              {profilePictureUrl ? (
                <img src={profilePictureUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center">
                  <UserCircle size={44} weight="fill" className="text-white" />
                </div>
              )}
              {uploadingPicture && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </button>
            <div>
              <button
                onClick={handleChangeProfilePicture}
                disabled={uploadingPicture}
                className="px-4 py-2 bg-background-secondary border border-background-tertiary text-label rounded-xl text-sm font-medium hover:border-label-quaternary transition-colors cursor-pointer mb-2 disabled:opacity-60"
              >
                {uploadingPicture ? 'Uploading…' : 'Change profile picture'}
              </button>
              <p className="text-xs text-label-secondary">JPG, PNG or WebP. Auto-cropped to a square.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-label">Display Name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2.5 bg-background-secondary border border-background-tertiary rounded-xl text-label focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-label">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 bg-background-secondary border border-background-tertiary rounded-xl text-label focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button className="px-5 py-2.5 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer">
              Save Changes
            </button>
            <button className="px-5 py-2.5 border border-transparent text-label-secondary hover:bg-background-secondary rounded-xl text-sm font-medium transition-colors cursor-pointer">
              Cancel
            </button>
          </div>
        </section>

        {/* ── Right: Preferences (inlined from former PreferencesView) ── */}
        <section className="space-y-6">
          <div>
            <h4 className="text-sm font-semibold text-label uppercase tracking-wider mb-1">Preferences</h4>
            <p className="text-xs text-label-secondary">Customize your Uvera experience.</p>
          </div>

          {/* Theme Settings */}
          <div className="bg-background-secondary border border-background-tertiary rounded-2xl p-5">
            <h5 className="text-sm font-medium text-label mb-3">Appearance</h5>
            <div className="flex gap-3 relative">
              {['system', false, true].map(mode => {
                const isActive = darkMode === mode;
                const label = mode === 'system' ? 'System' : mode ? 'Dark' : 'Light';
                return (
                  <button
                    key={String(mode)}
                    onClick={() => setDarkMode && setDarkMode(mode)}
                    className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-background border-accent text-accent shadow-sm'
                        : 'bg-background hover:bg-background-tertiary border-background-tertiary text-label-secondary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Playback Settings */}
          <div className="bg-background-secondary border border-background-tertiary rounded-2xl p-5">
            <h5 className="text-sm font-medium text-label mb-4">Playback & Audio</h5>
            <label className="flex items-center justify-between cursor-pointer group gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-label group-hover:text-accent transition-colors">Start videos muted</div>
                <div className="text-xs text-label-secondary mt-0.5">Videos will not auto-play audio until clicked.</div>
              </div>
              <div className={`relative w-11 h-6 flex-shrink-0 rounded-full transition-colors duration-300 ${isMuted ? 'bg-accent' : 'bg-background-tertiary'}`}>
                <div className={`absolute top-1 bottom-1 w-4 bg-white rounded-full transition-transform duration-300 ${isMuted ? 'translate-x-6' : 'translate-x-1'}`} />
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={isMuted || false}
                onChange={(e) => setIsMuted && setIsMuted(e.target.checked)}
              />
            </label>
          </div>

          {/* Localization Settings */}
          <div className="bg-background-secondary border border-background-tertiary rounded-2xl p-5">
            <h5 className="text-sm font-medium text-label mb-4">Language & Region</h5>
            <div className="space-y-1.5 w-full">
              <select className="w-full px-4 py-2.5 bg-background border border-background-tertiary rounded-xl text-label focus:outline-none focus:border-accent transition-all cursor-pointer appearance-none">
                <option value="en">English (US)</option>
                <option value="zh">中文 (Simplified)</option>
                <option value="ja">日本語 (Japanese)</option>
              </select>
            </div>
          </div>
        </section>

      </div>

      {/* §2026-06-06 — 账户操作区:Sign out 放 Account 底部(Leon 决策)。
          signOut → 跳 '/' (镜像 index.jsx logout effect,避免 /logout 死循环)。 */}
      <div className="pt-6 border-t border-background-tertiary">
        <button
          type="button"
          onClick={() => { supabase.auth.signOut().then(() => { window.location.href = '/'; }).catch(console.error); }}
          className="px-4 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-colors cursor-pointer flex items-center gap-2"
        >
          <SignOut size={16} weight="bold" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * Help Center — master-detail（2026-05-07 方案）：
 * 左 1/3：5 个分类 cards（What's New 在最上，默认选中）
 * 右 2/3：根据选中项渲染对应内容
 * Release notes 来源 public/release-notes.json（编辑后 `npm run build` 会
 * 把最新条目镜像到 version.json 供 in-app update prompt 使用）。
 */
/* Humanize a category slug for the left-nav display.
 * 'getting-started' → 'Getting Started'   'billing' → 'Billing' */
const titleizeCategory = (slug) => {
  if (!slug) return '';
  return slug.split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

/* Help article body renderer — uses react-markdown so we get full
 * CommonMark coverage (headings, blockquotes, code blocks, tables,
 * inline code, etc.) for free instead of the brittle handwritten
 * parser we had pre-2026-05-12. Tailwind classes via the `components`
 * map keep visual style consistent with the rest of Help Center.
 *
 * Security: react-markdown disables raw HTML by default, so admin-
 * authored content can't inject <script> via the body field.
 * Links open in a new tab + rel="noopener" to protect window.opener. */
const HELP_MARKDOWN_COMPONENTS = {
  p:      ({ node, ...props }) => <p className="text-sm text-label-secondary leading-relaxed" {...props} />,
  ul:     ({ node, ...props }) => <ul className="space-y-1 list-disc pl-5 text-sm text-label-secondary leading-relaxed" {...props} />,
  ol:     ({ node, ...props }) => <ol className="space-y-1 list-decimal pl-5 text-sm text-label-secondary leading-relaxed" {...props} />,
  li:     ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node, ...props }) => <strong className="font-semibold text-label" {...props} />,
  em:     ({ node, ...props }) => <em className="italic" {...props} />,
  h1:     ({ node, ...props }) => <h2 className="text-base font-semibold text-label mt-3" {...props} />,
  h2:     ({ node, ...props }) => <h3 className="text-sm font-semibold text-label mt-3" {...props} />,
  h3:     ({ node, ...props }) => <h4 className="text-sm font-semibold text-label-secondary mt-3" {...props} />,
  a:      ({ node, ...props }) => <a className="text-indigo-600 dark:text-indigo-400 hover:underline" target="_blank" rel="noopener noreferrer" {...props} />,
  code:   ({ node, inline, ...props }) =>
            inline
              ? <code className="px-1 py-0.5 rounded bg-background-tertiary text-label font-mono text-[12px]" {...props} />
              : <code className="block p-3 rounded-lg bg-background-tertiary text-label font-mono text-[12px] overflow-x-auto" {...props} />,
  blockquote: ({ node, ...props }) => <blockquote className="border-l-2 border-label-quaternary pl-3 text-sm text-label-tertiary italic" {...props} />,
};

function renderArticleBody(text) {
  if (!text) return null;
  return (
    <ReactMarkdown components={HELP_MARKDOWN_COMPONENTS}>
      {String(text)}
    </ReactMarkdown>
  );
}

function HelpView() {
  const [releases, setReleases] = useState(null);
  const [releasesError, setReleasesError] = useState(null);
  const [articles, setArticles] = useState([]);
  const [articlesError, setArticlesError] = useState(null);
  const [activeItem, setActiveItem] = useState('whats-new'); // default selection
  /* What's New: 最近 5 条；single-select accordion — 同时只能 1 条展开，
   *  默认最新一条展开。点击其他条 → 当前条自动折叠。 */
  const [expandedVersion, setExpandedVersion] = useState(null);

  // Once releases load, expand the latest version by default.
  useEffect(() => {
    if (releases && releases.length > 0) {
      setExpandedVersion(releases[0].version);
    }
  }, [releases]);

  const toggleVersion = (version) => {
    setExpandedVersion(prev => prev === version ? null : version);
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`/release-notes.json?t=${Date.now()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data) => { if (!cancelled) setReleases(data.releases || []); })
      .catch((e) => { if (!cancelled) setReleasesError(String(e)); });

    // Fetch admin-managed help articles. The Worker endpoint is public
    // (only published rows) — no auth header needed.
    fetch('/api/help/articles')
      .then((r) => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data) => { if (!cancelled && data.success) setArticles(data.articles || []); })
      .catch((e) => { if (!cancelled) setArticlesError(String(e)); });

    return () => { cancelled = true; };
  }, []);

  // Build the left-nav items: pin "What's New" at top, then categories
  // from DB articles grouped+counted.
  const helpItems = React.useMemo(() => {
    /* Order:
     *   1. What's New (pinned top, static — release-notes.json)
     *   2. Dynamic categories sorted alpha,但 'about-us' 强制 pinned 在末尾
     *   3. (About Us) pinned bottom if 'about-us' category 存在
     * 这样最终 layout 与 Leon 2026-05-07 原意一致 (about-us 第 5 位),不被
     * 后续 DB-backed 重构打乱。 */
    const items = [
      { id: 'whats-new', title: "What's New", desc: 'Latest updates' },
    ];
    const byCategory = {};
    for (const a of articles) {
      if (!byCategory[a.category]) byCategory[a.category] = [];
      byCategory[a.category].push(a);
    }
    const PINNED_LAST = new Set(['about-us']);
    const otherCats   = Object.keys(byCategory).filter(c => !PINNED_LAST.has(c)).sort();
    const lastCats    = Object.keys(byCategory).filter(c =>  PINNED_LAST.has(c));
    [...otherCats, ...lastCats].forEach(cat => {
      items.push({
        id: cat,
        title: titleizeCategory(cat),
        desc: `${byCategory[cat].length} article${byCategory[cat].length === 1 ? '' : 's'}`,
        articles: byCategory[cat],
      });
    });
    return items;
  }, [articles]);

  const activeCategoryItem = helpItems.find(i => i.id === activeItem && i.id !== 'whats-new');

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-6xl">
      {/* Page header — title 左 · Contact Support CTA 右 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-label leading-tight">Support</h3>
          <p className="text-xs text-label-secondary mt-0.5">Find answers and get support from our team.</p>
        </div>
        <button className="flex-shrink-0 whitespace-nowrap px-4 py-2 bg-accent hover:bg-accent/90 text-white rounded-xl text-sm font-medium transition-colors cursor-pointer">
          Contact Support
        </button>
      </div>

      {/* ── master-detail layout (md+): nav 1/3 left · content 2/3 right
       *    Mobile (single col): nav stacks above content. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* ── Left nav: What's New (pinned) + categories from DB ── */}
        <aside className="space-y-2">
          {helpItems.map(item => {
            const isActive = activeItem === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveItem(item.id)}
                className={`w-full text-left px-3.5 py-2.5 rounded-2xl border transition-colors cursor-pointer ${
                  isActive
                    ? 'border-accent bg-accent/5'
                    : 'border-background-tertiary bg-background-secondary hover:border-label-quaternary'
                }`}
              >
                <h4 className={`text-sm font-medium transition-colors ${isActive ? 'text-accent' : 'text-label'}`}>
                  {item.title}
                </h4>
                <p className="text-xs text-label-secondary leading-relaxed truncate mt-0.5">{item.desc}</p>
              </button>
            );
          })}
          {articlesError && (
            <div className="px-4 py-3 rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
              Couldn't load articles: {articlesError}
            </div>
          )}

          {/* ── Terms & Legal — placed under help nav items (2026-05-12)
                Dedicated routes /terms /privacy /content-license remain SoT
                (LegalPage 渲染 public/legal/*.md). 这里只是 link 入口。 */}
          <div className="pt-4 mt-2 border-t border-background-tertiary space-y-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-label-tertiary mb-2 px-3 pt-2">
              Terms & Legal
            </p>
            {[
              { label: 'Terms of Service',  path: '/terms'           },
              { label: 'Privacy Policy',    path: '/privacy'         },
              { label: 'Content License',   path: '/content-license' },
            ].map(l => (
              <a
                key={l.path}
                href={l.path}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-3 py-2 text-sm text-label-secondary hover:text-label hover:bg-background-secondary rounded-lg transition-colors cursor-pointer"
              >
                <span>{l.label}</span>
                <ArrowSquareOut size={12} className="text-label-tertiary" />
              </a>
            ))}
          </div>
        </aside>

        {/* ── Right detail: content for the selected item.
         *    Desktop: 独立 max-h scroll,bottom 与左 Settings sidebar border-r
         *    底部对齐 (= viewport - 80 NavBar - 64 SettingsPage pb-16 - section top
         *    offset ≈ 240)。Mobile: 跟随页面整体滚动。
         *    2026-05-12 v2: rounded-b-2xl + 微 bg-secondary/30 给独立容器视觉
         *    边界,scroll 时底部圆角可见。 */}
        <section className="md:col-span-2 space-y-4 md:max-h-[calc(100vh-240px)] md:overflow-y-auto md:rounded-b-2xl md:bg-background-secondary/30 md:p-3 md:pb-6 md:pr-2">
          {/* What's New: render release notes */}
          {activeItem === 'whats-new' && (
            <>
              {releasesError && (
                <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
                  Couldn't load release notes: {releasesError}
                </div>
              )}

              {!releases && !releasesError && (
                <div className="text-sm text-label-tertiary">Loading…</div>
              )}

              {releases && releases.length === 0 && (
                <div className="text-sm text-label-tertiary">No release notes yet.</div>
              )}

              {/* Show only the most recent 5 releases. Latest expanded by default
               *  (effect on releases load); others collapse — click header to toggle. */}
              {releases && releases.slice(0, 5).map((rel, idx) => {
                const isExpanded = expandedVersion === rel.version;
                const hasHighlights = rel.highlights && rel.highlights.length > 0;
                return (
                  <article
                    key={rel.version}
                    className="rounded-2xl border border-background-tertiary bg-background-secondary overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => toggleVersion(rel.version)}
                      aria-expanded={isExpanded}
                      className="w-full text-left p-3.5 flex items-start gap-3 hover:bg-background-tertiary/40 transition-colors cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-3 mb-1 flex-wrap">
                          <span className="text-xs font-mono text-label-tertiary tracking-wider">v{rel.version}</span>
                          <span className="text-[11px] text-label-quaternary">{rel.date}</span>
                          {idx === 0 && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                              Latest
                            </span>
                          )}
                        </div>
                        <h5 className="text-sm font-medium text-label leading-tight">{rel.title}</h5>
                      </div>
                      {hasHighlights && (
                        <CaretDown
                          size={16}
                          className={`flex-shrink-0 mt-1 text-label-tertiary transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      )}
                    </button>
                    {isExpanded && hasHighlights && (
                      <ul className="space-y-1.5 px-3.5 pb-3.5">
                        {rel.highlights.map((h, i) => (
                          <li key={i} className="flex gap-2 text-sm text-label-secondary leading-relaxed">
                            <span className="text-accent flex-shrink-0">·</span>
                            <span>{h}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </>
          )}

          {/* Category articles — list of Q&A entries.
              Admin-managed via /api/admin/help/articles. */}
          {activeItem !== 'whats-new' && activeCategoryItem && activeCategoryItem.articles.length > 0 && (
            <>
              {activeCategoryItem.articles.map(article => (
                <article
                  key={article.id}
                  className="rounded-2xl border border-background-tertiary bg-background-secondary p-5 space-y-3"
                >
                  <h5 className="text-base font-medium text-label">{article.title}</h5>
                  <div className="space-y-3">
                    {renderArticleBody(article.body)}
                  </div>
                </article>
              ))}
            </>
          )}

          {/* Fallback: category exists in nav but somehow no articles
              (race condition between nav build and re-render). */}
          {activeItem !== 'whats-new' && (!activeCategoryItem || activeCategoryItem.articles.length === 0) && (
            <div className="rounded-2xl border border-dashed border-background-tertiary bg-background-secondary/50 p-8 text-center">
              <p className="text-sm text-label-secondary mb-1">No articles in this category yet.</p>
              <p className="text-xs text-label-tertiary">
                If you need help right now, click <span className="font-medium text-indigo-600 dark:text-indigo-400">Contact Support</span> above.
              </p>
            </div>
          )}
        </section>

      </div>

      {/* §2026-06-06 — 账户操作区:Sign out 放 Account 底部(Leon 决策)。
          signOut → 跳 '/'(镜像 index.jsx logout 流程,避免 /logout 死循环)。 */}
      <div className="pt-6 border-t border-background-tertiary">
        <button
          type="button"
          onClick={() => { supabase.auth.signOut().then(() => { window.location.href = '/'; }).catch(console.error); }}
          className="px-4 py-2 rounded-xl text-sm font-medium text-red-500 hover:bg-red-500/10 border border-red-500/20 hover:border-red-500/40 transition-colors cursor-pointer flex items-center gap-2"
        >
          <SignOut size={16} weight="bold" />
          Sign out
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * WalletChannel — Wallet tab 容器,拆成 Subscription / Ucoin 两个子 tab。
 *   Subscription = 会员 + Token(余额 + 每日领取 + Token 购买记录 + 管理订阅)
 *                  = <WalletView>(会员档位选择走其内 Upgrade plan → /subscription)
 *   Ucoin        = Ucoin 余额 + 充值 + 流水 = <UcoinsTopupTab>(复用订阅页实现,共享缓存)
 * 子 tab 切换器沿用 SubscriptionPage 同款 segmented pill 风格,保持一致。
 * ────────────────────────────────────────────────────────────────────── */
function WalletChannel({ isSmallScreen, credits, tier }) {
  // §2026-06-06 货币合并(壳)— 砍掉 Subscription/Ucoin 子 tab。Wallet 单视图:
  //   Ucoin 充值改由 WalletView 内 Current Balance 旁的「Top up」CTA 触发,在右栏
  //   显示(rightPane='topup')。Ucoin 名字暂不动(仍是独立货币),等费汇率方案。
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="mb-6">
        <h3 className="text-lg font-medium text-label mb-1">Wallet</h3>
        <p className="text-sm text-label-secondary">Manage your token balance and subscription plan.</p>
      </div>
      <WalletView isSmallScreen={isSmallScreen} credits={credits} tier={tier} />
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { supabase, getUserProfile } from '../api/supabaseClient';
import {
  Crown, RocketLaunch, Lightning, Star, Sparkle,
  Check, ArrowSquareOut, CaretRight, CaretDown, Gear, X,
  Coin, CircleNotch,
} from '@phosphor-icons/react';
import Footer from '../components/Footer.jsx';
import BackButton from '../design-system/composites/BackButton.jsx';
import GlassPane from '../design-system/composites/GlassPane.jsx';
import SegmentedControl from '../design-system/composites/SegmentedControl.jsx';
import TokenBalanceCard from '../components/TokenBalanceCard';
/* §2026-05-25 fei — Tokens tab (drama-pay topup) lives on this page now */
import { fetchWalletBalance, createUcoinsCheckout } from '../api/dramaPayService';
import useUcoinsWallet from '../hooks/useUcoinsWallet';

/* ─── Pricing data ───
 * `price` is the per-month figure for both billings (yearly tab renders the
 * annual total = price * 12). `save` is the dollar amount saved per year on
 * yearly billing vs. paying monthly. Stripe / payment gateway price IDs are
 * the backend source of truth and must be kept in sync separately.
 */
const PRICES = {
  monthly: { starter: { price: 25, save: null }, creator: { price: 69, save: null }, studio: { price: 189, save: null } },
  yearly:  { starter: { price: 20, save: 60 },   creator: { price: 55, save: 168 },  studio: { price: 151, save: 456 } },
};

/* §2026-06-06 — tier 等级序(用于 CTA 判定 Upgrade/Downgrade)。lite 是一次性
 * top-up(非订阅档,功能等同 free),不参与升/降级文案 —— 始终「Get Lite」。 */
const TIER_ORDER = { free: 0, lite: 1, starter: 2, creator: 3, studio: 4 };

/* §2026-06-09 (Leon)— 统一卡角徽标(Popular / First-time):同外观同位置 —— 右上角
   accent pill。两处共用此 class,避免再 drift(原 Popular 右上 pill、First-time
   左上方角 + 大写,不一致)。 */
const CARD_BADGE_CLASS = 'absolute -top-2 right-4 z-10 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-accent text-white whitespace-nowrap';

/* 2026-05-15 — features rewritten to reflect the ACTUAL tier differences
 * codified in src/data/plans.js PLAN_LIMITS. Removed bogus claims that
 * never shipped (lip sync, CapCut export, NanoBanana, voice cloning).
 * Real tier gates are: video resolution, AI model access (Seedance Fast
 * vs Pro), Actor allowance, watermark, Series/Flow editor.
 */
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    icon: Star,
    color: 'text-label-secondary',
    accent: 'stone',
    isFree: true,
    credits: '6 tokens / day',
    gen: null,
    desc: 'Free access to basic features',
    features: [
      '480p video output',
      '1 Actor',
      'Seedance 2.0 Fast model',
      'Watermarked output (uvera.ai)',
      '6 daily login tokens + 20 welcome tokens',
    ],
  },
  /* §2026-06-09 — Lite 一次性 token top-up 方案已删除:Tokens 充值(token packs)
   * 已覆盖其"一次性买 token"功能,重复。Lite 的后端/checkout 代码暂保留(无入口)。 */
  {
    id: 'starter',
    name: 'Starter',
    icon: Lightning,
    color: 'text-blue-600 dark:text-blue-400',
    accent: 'blue',
    isFree: false,
    credits: '500 tokens / month',
    gen: null,
    desc: null,
    features: [
      '720p video output',
      '2 Actors',
      'Seedance 2.0 Pro model',
      'No watermark',
      '500 monthly tokens + 6 daily login tokens',
      // §2026-05-25 fei Phase 2 — drama membership benefit. Per
      //   system_settings.drama_member_tiers, starter+ counts as drama
      //   member: free access to series where member_free=true.
      'Drama membership: watch "member-free" episodes at no cost',
    ],
  },
  {
    id: 'creator',
    name: 'Creator',
    icon: RocketLaunch,
    color: 'text-violet-600 dark:text-violet-400',
    accent: 'violet',
    isFree: false,
    credits: '1,500 tokens / month',
    gen: null,
    desc: null,
    popular: true,
    features: [
      '1080p video output',
      '3 Actors',
      'Seedance 2.0 Pro model',
      'No watermark',
      'Series creation enabled',
      '1,500 monthly tokens + 6 daily login tokens',
      'Drama membership: watch "member-free" episodes at no cost',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    icon: Crown,
    color: 'text-amber-600 dark:text-amber-400',
    accent: 'amber',
    isFree: false,
    credits: '5,000 tokens / month',
    gen: null,
    desc: null,
    features: [
      '1080p video output today · 4K upscale pipeline in development',
      '4 Actors',
      'Seedance 2.0 Pro model',
      'No watermark',
      'Series + Flow editor (full creative control)',
      '5,000 monthly tokens + 6 daily login tokens',
      'Drama membership: watch "member-free" episodes at no cost',
    ],
  },
];

/* §2026-06-06 — CTA_COPY(每档静态「Upgrade to X」文案 + 底部 CTA 块)已随旧
 * 5 列网格删除;改用 planSelector 每卡按 tier 方向智能显示 Upgrade/Downgrade。 */

/* ─── Component ─── */
export default function SubscriptionPage({ isSmallScreen, currentTier: initialTier = 'free', embedded = false, modal = false, onClose }) {
  const [billing, setBilling] = useState('monthly');
  const [selectedPlan, setSelectedPlan] = useState('creator');
  const [credits, setCredits] = useState(0);
  const [currentTier, setCurrentTier] = useState(initialTier);
  const [isProcessing, setIsProcessing] = useState(false);
  // §2026-06-09 (Leon「数据同源同值」)— 余额统一走共享 useUcoinsWallet 缓存
  //   (/api/wallet/balance → user_credits.balance,与 Top up tab 同一来源),
  //   不再用 getUserProfile().credits 单独那条路(两条 fetch 时序不一 → 601 vs 595)。
  //   getUserProfile 仅留作 tier + 首帧 fallback。
  const { wallet: sharedWallet } = useUcoinsWallet({ withPackages: false });

  /* §2026-05-25 fei — Tab switcher between subscription topup and
   * Tokens topup. Auto-select logic:
   *   1. URL ?tab=ucoins / ?tab=subscription  — explicit wins (used by
   *      the /wallet redirect + the PaywallModal's success_url)
   *   2. User tier is paid (starter/creator/studio/lite) → 'subscription'
   *      (likely came here to manage existing plan)
   *   3. Otherwise → 'subscription' (default tab for first-time visitors)
   *
   * Settled after currentTier + URL are known, so the auto-pick only
   * fires once on mount. User can still flip tabs manually after. */
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'ucoins' || p === 'subscription') return p;
    }
    return 'subscription';
  });
  // Re-pick once the live tier comes in (overrides default unless URL set)
  const [tabAutoPicked, setTabAutoPicked] = useState(false);
  useEffect(() => {
    if (tabAutoPicked) return;
    if (typeof window !== 'undefined') {
      const urlTab = new URLSearchParams(window.location.search).get('tab');
      if (urlTab) { setTabAutoPicked(true); return; }
    }
    if (currentTier && currentTier !== 'free') {
      setActiveTab('subscription');
    }
    setTabAutoPicked(true);
  }, [currentTier, tabAutoPicked]);

  // §2026-06-09 (Leon「数据同源」)— embedded:currentTier 跟随父级 prop(单一源,
  //   父级 SettingsPage 的 tier),不自拉,确保与同页 Current Plan 卡显示一致。
  useEffect(() => {
    if (embedded) setCurrentTier(initialTier);
  }, [embedded, initialTier]);

  // §2026-05-14 Lite tiered pricing — next-purchase price depends on
  // user's history. Fetched from /api/lite/next-price on mount.
  const [liteNextPrice, setLiteNextPrice] = useState({
    tier: 1, priceUsd: 3.99, completedCount: 0,
  });

  // §2026-05-14 Checkout success banner — shows when ?checkout=success in URL.
  // null = no banner; 'pending'|'confirmed'|'timeout' = visible.
  const [checkoutSuccess, setCheckoutSuccess] = useState(null);

  useEffect(() => {
    // §2026-06-09 (Leon「数据必须同源同值」)— embedded(Wallet 右栏)模式:
    //   currentTier/credits 由父级 SettingsPage 统一提供(下方 sync effect),不再
    //   自拉 getUserProfile → 避免与父级两条独立 fetch 时序不一致(Wallet 显示 Free
    //   而右栏标 Creator 的矛盾)。仅 standalone/modal 自拉。
    if (embedded) return;
    getUserProfile().then(profile => {
      setCredits(profile.credits);
      setCurrentTier(profile.tier);
    });

    // Fetch Lite tier price (only matters if user is considering Lite).
    // Fail-safe: if endpoint errors, the existing $3.99 default stays.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const r = await fetch('/api/lite/next-price', {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        });
        if (r.ok) {
          const data = await r.json();
          if (data.tier && data.priceUsd) {
            setLiteNextPrice({
              tier: data.tier,
              priceUsd: data.priceUsd,
              completedCount: data.completedCount || 0,
            });
          }
        }
      } catch { /* keep default $3.99 */ }
    })();

    // After Stripe Checkout, the user lands at /subscription?checkout=success.
    // Show a banner + poll user profile so user sees tokens arrive.
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setCheckoutSuccess({ phase: 'pending', baselineCredits: 0 });
      // Capture baseline credits, then poll for the bump.
      getUserProfile().then(baseline => {
        const baselineCredits = baseline.credits;
        let attempts = 0;
        const maxAttempts = 10;  // 10 × 1.5s = 15s budget
        const pollId = setInterval(async () => {
          attempts += 1;
          try {
            await supabase.auth.refreshSession();  // pick up fresh JWT
          } catch {}
          const p = await getUserProfile();
          if (p.credits > baselineCredits) {
            clearInterval(pollId);
            setCredits(p.credits);
            setCurrentTier(p.tier);
            setCheckoutSuccess({
              phase: 'confirmed',
              addedTokens: p.credits - baselineCredits,
              tier: p.tier,
            });
            setTimeout(() => setCheckoutSuccess(null), 6000);
            return;
          }
          if (attempts >= maxAttempts) {
            clearInterval(pollId);
            setCheckoutSuccess({ phase: 'timeout' });
          }
        }, 1500);
      });
      // Clean up the URL query so banner doesn't re-trigger on F5.
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleCheckout = async (planOverride) => {
    // §2026-06-06 — 支持按指定 plan 直接结账(embedded Wallet 右栏每卡 CTA)。
    //   兼容旧调用 onClick={handleCheckout}(事件对象当参数 → 忽略,回退 selectedPlan)。
    const planId = (typeof planOverride === 'string' ? planOverride : null) || selectedPlan;
    if (planId === 'free') return;

    setIsProcessing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Please sign in first.');
        setIsProcessing(false);
        return;
      }
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tier: planId, billing }),
      });
      const data = await res.json();

      // §2026-05-14: user already has an active subscription — the worker
      // returns code='EXISTING_SUBSCRIPTION' with a Customer Portal URL
      // instead of a new Checkout Session. Routing through the portal so
      // Stripe handles plan switching correctly (upgrade prorates now,
      // downgrade defers to current period's end — see Customer Portal
      // Subscription settings in Stripe Dashboard).
      if (!data.success && data.code === 'EXISTING_SUBSCRIPTION' && data.portalUrl) {
        // Tell the user what's happening before redirecting so the portal
        // doesn't look like a random Stripe page they didn't ask for.
        alert(
          data.message ||
          'You already have an active subscription. Opening the Customer Portal to switch plans — downgrades take effect at the end of your current billing period.'
        );
        window.location.href = data.portalUrl;
        return;
      }

      if (!data.success) throw new Error(data.errMessage || 'Checkout failed');
      // Hand off to Stripe — Stripe handles payment, redirects back to /subscription
      window.location.href = data.url;
    } catch (e) {
      alert('Checkout failed: ' + e.message);
      setIsProcessing(false);
    }
  };

  // §2026-06-06 — handleManageSubscription / cta(CTA_COPY)随旧 5 列网格+底部 CTA
  //   块一并删除(整页改用共用 planSelector,智能 Upgrade/Downgrade CTA)。Stripe
  //   订阅管理入口现由 Wallet 的 Current Plan 卡「Manage Subscription」承担。

  // Desktop: align with Discover (MasonryGrid inner section uses 92/56).
  // Mobile: matches MasonryGrid's px-4.
  // modal 模式下用常规内边距(不要整页那种 92px 左缩进);否则对齐 Discover。
  const px = modal ? 'px-5 sm:px-6' : (isSmallScreen ? 'px-4' : 'pl-[92px] pr-[56px]');

  // §2026-06-06 — embedded 变体:供 Settings → Wallet → Subscription tab 右栏复用。
  //   只渲染 billing 切换 + 垂直可展开 plan accordion;每卡右上角「Upgrade to X」直接
  //   结账(handleCheckout(plan.id))/当前套餐显示「Current plan」。不渲染独立页头/
  //   成功 banner/底部 CTA 块(外层 Wallet 提供)。复用 PLANS/PRICES/billing/checkout。
  /* §2026-06-06 — 垂直 plan accordion(原 embedded 专用)抽成 planSelector,
     供 Wallet 右栏(embedded)与独立 /subscription 整页/浮窗共用,统一智能 CTA。 */
  const planSelector = (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <span className="text-xs font-medium text-label-secondary uppercase tracking-wider">Choose a plan</span>
          <div className="flex bg-background-secondary border border-background-tertiary rounded-full p-[3px]">
            <button onClick={() => setBilling('monthly')} className={`px-3 py-1 rounded-full text-xs transition-all cursor-pointer ${billing === 'monthly' ? 'bg-background text-label font-medium shadow-sm' : 'text-label-secondary hover:text-label'}`}>Monthly</button>
            <button onClick={() => setBilling('yearly')} className={`px-3 py-1 rounded-full text-xs transition-all cursor-pointer flex items-center gap-1.5 ${billing === 'yearly' ? 'bg-background text-label font-medium shadow-sm' : 'text-label-secondary hover:text-label'}`}>
              Yearly
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">20% OFF</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isCurrent = currentTier === plan.id;
            const priceData = !plan.isFree && !plan.isOneTime ? PRICES[billing][plan.id] : null;
            return (
              <div key={plan.id} className="relative">
                {/* §2026-06-09 — Popular 徽标挂在非-material 外层 wrapper:material 的
                    `.material-* > *` 规则会把直接子元素强制 position:relative,绝对定位
                    徽标会被打回相对流跑到左上(折叠态 bug)。外层不带 material → 正常。 */}
                {plan.popular && (
                  <span className={CARD_BADGE_CLASS}>Popular</span>
                )}
                {/* §2026-06-09 (Leon)— selected fill 亮度提一档:accent-bg/30→/20
                    (dark /15→/10),紫调更淡更亮;紫来自品牌 token --color-accent-bg
                    #ecebff + 边框 --color-accent #5B53FF(合规)。 */}
                <div className={`rounded-2xl border transition-all ${isSelected ? 'border-accent bg-accent-bg/20 dark:bg-accent/10' : isCurrent ? 'material-thick border-transparent' : 'material-regular border-transparent'}`}>
                <button type="button" onClick={() => setSelectedPlan(isSelected ? '' : plan.id)} className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left cursor-pointer">
                  {/* 左:套餐名 + Current plan 徽标;下方 credits 额度 subline。
                      §2026-06-09 (Leon)— credits(如 1,500 tokens / month)提到卡头,
                      折叠态即可见(原仅展开 body 内显示)。 */}
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-lg font-medium text-label">{plan.name}</span>
                      {/* §2026-06-09 (Leon)— Current plan 是「状态」,改中性灰;绿色专留给
                          「省钱」语义(Save $/yr、20% OFF),消除色彩语义冲突。 */}
                      {isCurrent && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-background-tertiary text-label-secondary whitespace-nowrap">Current plan</span>
                      )}
                    </div>
                    {plan.credits && (
                      <span className="text-[11px] font-medium text-label-secondary">{plan.credits}</span>
                    )}
                  </div>
                  {/* 右:价格 + caret;下方 Save(yearly)与左栏额度 subline 等高对齐;
                      展开时 CTA 显示在价格下方。§2026-06-09 (Leon)— Save 从带 padding 的
                      pill 改纯文字 + gap 收紧,不再额外撑高(yearly/monthly 卡同高)。 */}
                  <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                    <div className="flex items-center gap-2">
                      {plan.isFree ? (
                        <span className="text-lg font-medium text-label-secondary">Free</span>
                      ) : plan.isOneTime ? (
                        <span className="text-lg font-medium text-label"><span className="text-sm">$</span>{liteNextPrice.priceUsd.toFixed(2)}<span className="text-xs font-normal text-label-secondary"> one-time</span></span>
                      ) : (
                        <span className="text-lg font-medium text-label"><span className="text-sm">$</span>{priceData.price}<span className="text-xs font-normal">/mo</span></span>
                      )}
                      <CaretDown size={16} weight="bold" className={`transition-transform duration-300 ${isSelected ? 'rotate-180 text-accent' : 'text-label-tertiary'}`} />
                    </div>
                    {billing === 'yearly' && priceData?.save && (
                      <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 whitespace-nowrap">Save ${priceData.save}/yr</span>
                    )}
                    {/* CTA:折叠不显示;展开(isSelected)且非当前/非免费时,显示在价格下方 */}
                    {isSelected && !isCurrent && !plan.isFree && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); handleCheckout(plan.id); }} disabled={isProcessing} className="mt-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40 whitespace-nowrap">
                        {isProcessing
                          ? '…'
                          : plan.isOneTime
                            ? `Get ${plan.name}`
                            : `${(TIER_ORDER[plan.id] ?? 0) < (TIER_ORDER[currentTier] ?? 0) ? 'Downgrade' : 'Upgrade'} to ${plan.name}`}
                      </button>
                    )}
                  </div>
                </button>
                <div className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${isSelected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                  <div className="overflow-hidden min-h-0">
                    <div className="px-4 pb-4 flex flex-col">
                      {/* §2026-06-09 — credits 已提到卡头 subline,展开 body 不再重复。 */}
                      {plan.desc && <div className="text-[11px] text-label-secondary mb-2 leading-relaxed">{plan.desc}</div>}
                      <div className="h-px bg-label-quaternary/60 my-2" />
                      <ul className="flex flex-col gap-1">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] text-label-secondary leading-relaxed">
                            <span className={`w-1 h-1 rounded-full mt-[5px] flex-shrink-0 ${isSelected ? 'bg-accent' : 'bg-label-quaternary'}`} />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
  );
  if (embedded) return planSelector;

  const pageContent = (
    <div className={modal ? 'pb-5' : 'pb-16'}>

      {/* ── Checkout success banner ──
       *  Triggered by ?checkout=success in URL (Stripe success_url redirect).
       *  Three phases:
       *    pending — webhook hasn't processed yet, polling profile
       *    confirmed — tokens visible, show count + auto-dismiss 6s
       *    timeout — 15s without credits bump, prompt user to refresh manually
       *  Comment from 2026-05-08 promised this banner but only the data-refresh
       *  was wired; user complained tokens "silently appeared" with no feedback. */}
      {checkoutSuccess && (
        /* 2026-05-14 Leon — top-4 (16px) 让 banner 与 Header (80px desktop / 52px
           mobile) 重叠遮住右侧 Go Studio / Lang / Theme / Mute 按钮。改 top-20
           (80px) = 紧贴 Header 底边,desktop 无缝衔接,mobile 留 28px 透气。
           z-50 (50) < Header overlay z-40 平级但 fixed top:20 与 Header 0..80
           不重叠,Header 控件不再被盖住。 */
        <div className="fixed top-20 right-4 z-50 max-w-md animate-in fade-in slide-in-from-top-2 duration-300">
          <div className={`rounded-xl p-4 shadow-xl border ${
            checkoutSuccess.phase === 'confirmed'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-100'
              : checkoutSuccess.phase === 'timeout'
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-100'
                : 'bg-blue-500/15 border-blue-500/40 text-blue-100'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                {checkoutSuccess.phase === 'pending' && (
                  <>
                    <div className="font-medium text-sm">Payment received</div>
                    <div className="text-xs mt-1 opacity-90">Adding tokens to your account…</div>
                  </>
                )}
                {checkoutSuccess.phase === 'confirmed' && (
                  <>
                    <div className="font-medium text-sm flex items-center gap-1.5">
                      <Check size={14} weight="bold" /> Payment confirmed
                    </div>
                    <div className="text-xs mt-1 opacity-90">
                      +{checkoutSuccess.addedTokens} tokens added · tier: {checkoutSuccess.tier}
                    </div>
                  </>
                )}
                {checkoutSuccess.phase === 'timeout' && (
                  <>
                    <div className="font-medium text-sm">Still processing</div>
                    <div className="text-xs mt-1 opacity-90">
                      Your tokens should appear within a few minutes. Refresh the page or check Settings → Wallet.
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={() => setCheckoutSuccess(null)}
                className="opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
              >
                <X size={14} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Page header ── */}
      {/* §2026-06-09 — modal(浮窗)下去掉 eyebrow/title/描述省纵向空间(Leon),
          只留 tab switcher;独立页保留完整 header。 */}
      <div className={`${px} ${modal ? 'pt-4 pb-4' : 'pt-6 pb-8'}`}>
        {!modal && (
          <>
            <BackButton className="mb-4" />
            <p className="text-xs font-semibold text-accent tracking-widest uppercase mb-2">Account</p>
            <h2
              className={`${isSmallScreen ? 'text-3xl' : 'text-4xl'} font-medium text-label tracking-tight`}
              style={{ fontFamily: "'Crimson Pro', 'Georgia', serif" }}
            >
              {activeTab === 'ucoins' ? 'Top up Tokens' : 'Subscription'}
            </h2>
            <p className="text-label-tertiary mt-2 text-sm leading-relaxed">
              {activeTab === 'ucoins'
                ? 'Top up Tokens to unlock paid drama episodes'
                : 'Manage your plan and tokens'}
            </p>
          </>
        )}

        {/* §2026-06-09 (Leon)— 切换器改用 design-system <SegmentedControl>(全站统一,
            dual-track iOS/visionOS + light/dark),水平居中。取代原 ad-hoc pill。 */}
        <div className={`${modal ? '' : 'mt-5'} flex justify-center`}>
          <SegmentedControl
            className="w-full max-w-[280px]"
            segments={[
              { value: 'subscription', label: 'Subscription' },
              { value: 'ucoins', label: 'Top up' },
            ]}
            value={activeTab}
            onChange={setActiveTab}
          />
        </div>
      </div>

      {/* §2026-05-25 fei — Tokens tab body */}
      {activeTab === 'ucoins' && <UcoinsTopupTab px={px} compact={modal} />}

      {/* ── Subscription tab body — original content (only shown when active) ── */}
      {activeTab === 'subscription' && <>

      {/* ── Token 余额 ──
          §2026-06-09 — 复用共享 <TokenBalanceCard>(与 Wallet 同一组件,Leon「沿用
          Wallet 现成块」)。原自造卡(假进度条 + One-time gift/Creator plan/Free access
          徽标动物园 + 重复当前套餐信息)整张移除:当前套餐已在下方 plan 列表标注;
          余额单位、Top up 入口由共享组件统一。Top up → 切 ucoins tab。 */}
      <div className={`${px} mb-5`}>
        {/* §2026-06-09 (Leon「两处 Top up 重叠」)— 不传 onTopUp:顶部已有「Top up」tab
            作唯一入口,余额卡再放 Top up 按钮重复。Wallet 无 tab → 那边仍传 onTopUp。 */}
        <TokenBalanceCard credits={sharedWallet?.ucoins ?? credits} />
      </div>


      {/* §2026-06-06 — plan 选择改用共用 planSelector(垂直 accordion + 智能
          Upgrade/Downgrade CTA),取代原 5 列网格 + 静态底部 CTA。 */}
      <div className={`${px}`}>
        {planSelector}
      </div>

      </>}{/* end subscription tab body */}

      {/* Page-bottom footer with legal-doc links — Subscription is a logical home
          since users see legal terms before/after committing to a paid plan.
          modal 模式不显示整页 footer。 */}
      {!modal && (
        <div className="mt-12">
          <Footer />
        </div>
      )}
    </div>
  );

  // §2026-06-06 Step 5 — modal 模式:把整页内容包进浮层(遮罩 + 关闭 X + 圆角卡)。
  //   点遮罩或 X 关闭(onClose);卡内 stopPropagation 防误关。付款仍整页跳 Stripe。
  // §2026-06-09 — 外壳改 <GlassPane> 磨砂浮层(visionOS Windows/Glass,radius 32 +
  //   157° SVG stroke,跟 SparkMode 右栏同款),取代原 solid bg-background 卡(Leon
  //   「套用我们的样式」)。close X 走轻量 icon-only(hover 才出底);contentClassName 做非滚动 flex 外框,
  //   内层单独 overflow-y-auto → close X 钉在右上不随内容滚走。
  if (modal) {
    return (
      <div
        className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto overscroll-contain bg-black/60 backdrop-blur-sm p-3 sm:p-6"
        onClick={onClose}
      >
        {/* §2026-06-09 (Leon)— 浮窗固定高度,两 tab 等高、切换不跳动(作为同一整体)。
            高度取 Apple HIG 封顶值(方案 A):桌面 min(760px, 90dvh)(8pt 对齐 760=8×95,
            < .large detent 上限 90dvh≈810@900vp;内容含 credits subline 后相应抬高)、
            移动 90dvh(≈ iOS .large detent);再叠 max-h 防顶边。内层 flex-1 滚动 →
            panel 立即整块占位,数据在原位填充。 */}
        <GlassPane
          radius={32}
          className="glass-pane-solid relative w-full max-w-lg my-auto shadow-2xl h-[90dvh] sm:h-[min(760px,90dvh)] max-h-[calc(100dvh-24px)]"
          contentClassName="relative z-[3] flex flex-col h-full"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 z-20 w-9 h-9 rounded-full flex items-center justify-center text-label-tertiary hover:text-label hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={18} weight="bold" />
          </button>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {pageContent}
          </div>
        </GlassPane>
      </div>
    );
  }

  return pageContent;
}

/* ──────────────────────────────────────────────────────────────────────
 * §2026-05-25 fei — UcoinsTopupTab
 *
 * Renders the Tokens balance card + 6-pack topup grid + tx history.
 * Mounted as the body of SubscriptionPage's "Tokens" tab. All packs
 * go through createUcoinsCheckout → Stripe Checkout → webhook credits
 * wallet_balance + writes wallet_tx (handled in worker).
 *
 * Detects ?checkout=success URL param (from PaywallModal's success_url)
 * and shows a "充值成功" banner + polls for balance change for ~30s.
 * ────────────────────────────────────────────────────────────────────── */
export function UcoinsTopupTab({ px, compact = false, showBalance = true }) {
  // 共享缓存 + SWR:切 tab / 重进页不再每次全屏 spinner 重拉(见 useUcoinsWallet)
  const { wallet, packages, loading, setWallet } = useUcoinsWallet();
  const [checkingOut, setCheckingOut] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [postCheckoutStatus, setPostCheckoutStatus] = React.useState(null);
  // Read once on mount — avoids re-firing the poll if user flips tabs
  const checkoutResult = React.useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('checkout');
  }, []);

  // Post-checkout polling (returned from Stripe with ?checkout=success)
  React.useEffect(() => {
    if (checkoutResult === 'cancelled') {
      setPostCheckoutStatus('cancelled');
      return;
    }
    if (checkoutResult !== 'success') return;
    setPostCheckoutStatus('waiting');
    const startBal = wallet?.ucoins ?? 0;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts += 1;
      try {
        const fresh = await fetchWalletBalance();
        if (fresh && fresh.ucoins > startBal) {
          setWallet(fresh);
          setPostCheckoutStatus('credited');
          clearInterval(interval);
        }
      } catch (_) {}
      if (attempts >= 15) clearInterval(interval);
    }, 2000);
    return () => clearInterval(interval);
  }, [checkoutResult, wallet?.ucoins]);

  const handleBuyPack = async (pkg) => {
    setCheckingOut(pkg.id);
    setError(null);
    try {
      const res = await createUcoinsCheckout({ packageId: pkg.id });
      if (res.session_url) {
        window.location.href = res.session_url;
      } else {
        throw new Error('No session URL');
      }
    } catch (e) {
      setError(e.message);
      setCheckingOut(null);
    }
  };

  if (loading) {
    // §2026-06-09 (Leon)— 骨架占位镜像最终布局(余额卡 + Buy Tokens + 档位),
    //   数据载入后在原位填充,不再缩成「Loading…」一条让浮窗塌掉。
    return (
      <div className={`${px} mb-8 space-y-5`}>
        {showBalance && (
          /* 骨架镜像 <TokenBalanceCard>:圆形 icon 气泡 + 标题行 + 大数字。 */
          <div className="rounded-2xl bg-background-secondary border border-background-tertiary p-6 flex items-center gap-5 animate-pulse">
            <div className="w-14 h-14 rounded-full bg-label-quaternary/15 flex-shrink-0" />
            <div className="flex-1">
              <div className="h-3 w-28 bg-label-quaternary/20 rounded mb-2" />
              <div className="h-8 w-32 bg-label-quaternary/25 rounded" />
            </div>
          </div>
        )}
        <div>
          <div className="h-3 w-20 bg-label-quaternary/20 rounded mb-3 animate-pulse" />
          <div className={compact ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-background-secondary border border-background-tertiary animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${px} mb-8 space-y-5`}>
      {/* Post-checkout banner */}
      {postCheckoutStatus === 'waiting' && (
        <div className="px-4 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-3">
          <CircleNotch size={18} className="animate-spin text-blue-500" />
          <p className="text-sm text-label">Payment confirmed — Tokens arriving (≤30s)…</p>
        </div>
      )}
      {postCheckoutStatus === 'credited' && (
        <div className="px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3">
          <Check size={18} weight="bold" className="text-emerald-500" />
          <p className="text-sm text-label">✅ Top-up successful — Tokens credited to your balance.</p>
        </div>
      )}
      {postCheckoutStatus === 'cancelled' && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
          <X size={18} weight="bold" className="text-amber-500" />
          <p className="text-sm text-label">Top-up cancelled — pick a package to try again.</p>
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* §2026-06-06 — 两栏(对齐 Subscription tab):左 余额(row1)+流水(row2) /
          右 充值档位(跨两行)。grid 显式定位,DOM 不重排。移动端 grid-cols-1 单列。
          compact(Wallet 右栏窄)→ 单列堆叠(余额→档位→流水)。 */}
      <div className={compact ? 'space-y-5' : 'grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 md:items-start'}>
      {/* Balance card。§2026-06-09 按"规律"统一:用共享 <TokenBalanceCard>(与
          订阅 tab / Wallet / Header 同款 Current Balance + accent Coin),不再自造
          TOKENS BALANCE/Earned/Spent 那套(累计明细在 Wallet 的 Lifetime 卡/流水)。
          Top up tab 已在充值场景 → 不带 Top up 按钮。showBalance:Wallet 内嵌=false
          (与左栏重复),modal/独立页=true。 */}
      {showBalance && (
        <div className="md:col-start-1 md:row-start-1">
          <TokenBalanceCard credits={wallet?.ucoins ?? 0} />
        </div>
      )}

      {/* Top-up packages (right, col2 spans both rows) */}
      <div className="md:col-start-2 md:row-start-1 md:row-span-2 min-w-0">
        <h3 className="text-sm font-semibold text-label uppercase tracking-wider mb-3">Buy Tokens</h3>
        {/* §2026-06-09 — compact(modal/Wallet)单列(1/行,Leon「不要分两列」);
            独立页两列。 */}
        <div className={compact ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
          {packages.map(pkg => {
            const isFirstChargeOnly = pkg.first_charge;
            const isProcessing = checkingOut === pkg.id;
            return (
              <button
                key={pkg.id}
                onClick={() => handleBuyPack(pkg)}
                disabled={isProcessing || !!checkingOut}
                className={`relative flex items-start justify-between gap-3 px-4 py-3 rounded-2xl border transition-all text-left ${
                  isFirstChargeOnly
                    ? 'border-accent bg-accent/5 hover:bg-accent/10'
                    : 'material-regular border-transparent hover:border-accent'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isFirstChargeOnly && (
                  <span className={CARD_BADGE_CLASS}>First-time 2×</span>
                )}
                {/* §2026-06-09 (Leon)— pack 卡布局参照 plan 折叠卡:左栏 数量+Tokens、
                    下方 +bonus subline;右栏 价格。一行内呈现。 */}
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <Coin size={18} weight="fill" className="text-accent" />
                    <span className="text-lg font-semibold text-label tabular-nums">{pkg.ucoins}</span>
                    <span className="text-xs text-label-secondary">Tokens</span>
                  </div>
                  {pkg.bonus > 0 && (
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">+{pkg.bonus} bonus</span>
                  )}
                </div>
                <div className="flex-shrink-0 flex items-center">
                  <span className="text-lg font-medium text-label"><span className="text-sm">$</span>{(pkg.price_cents / 100).toFixed(2)}</span>
                </div>
                {isProcessing && (
                  /* §2026-06-09 — inline position:absolute 兜底:material-regular 的
                     `> *` 规则会把此遮罩强制 relative,inline style 优先级最高确保覆盖。 */
                  <div style={{ position: 'absolute', inset: 0 }} className="flex items-center justify-center bg-background/80 rounded-2xl">
                    <CircleNotch size={20} className="animate-spin text-accent" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-label-tertiary mt-3">
          $1 = 20 Tokens · Secure payment via Stripe.
        </p>
      </div>

      {/* §2026-06-09 — 「近期流水」整块删除:充值页只做购买,不展示流水。
          Wallet(/settings)的右栏统一 Transactions 才是查流水的地方。 */}
      </div>{/* end two-column grid */}
    </div>
  );
}

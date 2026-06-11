/**
 * §2026-05-25 fei — PaywallModal
 *
 * Shown when a user tries to play a locked (paid) episode and doesn't yet
 * own it. Per PDF §2.4, surfaces THREE entry points side-by-side:
 *
 *   1. 解锁本集    (consume Tokens) — primary CTA when balance >= price
 *   2. 充值 Tokens → 充完再解锁    — when balance < price (or always offered)
 *   3. 整剧买断    (Stripe Checkout) — when bundle pricing available
 *
 * Props:
 *   open                  — bool, controls visibility
 *   onClose()             — called when user closes modal
 *   episode               — { id, episode_no, title }
 *   series                — { id, title, ucoins_per_episode,
 *                            bundle_price_usd_cents, member_free }
 *   locked                — { price, balance } from /access response
 *   onUnlocked(unlockRes) — called after successful unlock — caller
 *                           refetches access + starts playback
 *
 * Behavior:
 *   - Click "解锁本集" → calls unlockEpisode; on 402 insufficient,
 *     switches into "需要充值" mode and shows the topup CTAs.
 *   - Click any topup pack → calls createUcoinsCheckout, redirects to
 *     Stripe (window.location). Stripe success URL brings user back to
 *     /series/:id which re-fetches access.
 *   - Click "整剧买断" → createBundleCheckout, redirect.
 */

import { useState, useEffect } from 'react';
import { X, Coin, CircleNotch, ShieldCheck, ArrowRight, CheckCircle } from '@phosphor-icons/react';
import { unlockEpisode, createUcoinsCheckout, createBundleCheckout, fetchUcoinsPackages, fetchWalletBalance } from '../api/dramaPayService';

export default function PaywallModal({ open, onClose, episode, series, locked, onUnlocked }) {
  const [packages, setPackages] = useState([]);
  const [phase, setPhase] = useState('decide');  // 'decide' | 'unlocking' | 'topup' | 'bundleCheckout'
  const [error, setError] = useState(null);
  const [currentBalance, setCurrentBalance] = useState(locked?.balance ?? 0);

  // Lazy-load package list on first open
  useEffect(() => {
    if (open && packages.length === 0) {
      fetchUcoinsPackages().then(setPackages).catch(err => {
        console.warn('[PaywallModal] package fetch failed:', err);
      });
    }
  }, [open, packages.length]);

  // Reset phase + sync balance when modal reopens or episode changes.
  //   §2026-05-25 fei — ALSO fire fresh fetchWalletBalance() in background
  //   so the displayed currentBalance reflects what's actually in DB right
  //   now, not what the caller (SeriesDetailPage /access response) cached
  //   at page load time. Critical when user just returned from a Stripe
  //   top-up: /access cache says 0, DB has 200, paywall would otherwise
  //   show "insufficient balance" + topup options even though user has
  //   plenty. Background refresh; UI shows passed-in balance immediately
  //   then upgrades to the live value once the request lands.
  useEffect(() => {
    if (open) {
      setPhase('decide');
      setError(null);
      setCurrentBalance(locked?.balance ?? 0);
      // Fire-and-forget live balance refresh
      fetchWalletBalance().then(fresh => {
        if (typeof fresh?.ucoins === 'number') {
          setCurrentBalance(fresh.ucoins);
        }
      }).catch(err => {
        console.warn('[PaywallModal] balance refresh failed (using cached value):', err?.message || err);
      });
    }
  }, [open, locked?.balance, episode?.id]);

  if (!open) return null;

  const price = locked?.price ?? series?.ucoins_per_episode ?? 40;
  const insufficient = currentBalance < price;
  const bundleCents = series?.bundle_price_usd_cents;

  const handleUnlock = async () => {
    setError(null);
    setPhase('unlocking');
    try {
      const res = await unlockEpisode({ episodeId: episode.id });
      if (typeof res.balance_after === 'number') setCurrentBalance(res.balance_after);
      // Caller refetches access + starts playback
      onUnlocked && onUnlocked(res);
    } catch (err) {
      console.warn('[PaywallModal] unlock failed:', err);
      if (err.insufficient) {
        // Insufficient: shift to topup mode automatically
        if (typeof err.current === 'number') setCurrentBalance(err.current);
        setError(err.message);
        setPhase('topup');
      } else {
        setError(err.message || 'Unlock failed');
        setPhase('decide');
      }
    }
  };

  const handlePackPurchase = async (pkg) => {
    setError(null);
    setPhase('unlocking');  // generic "working" state
    try {
      const res = await createUcoinsCheckout({ packageId: pkg.id });
      if (res.session_url) {
        window.location.href = res.session_url;
      } else {
        throw new Error('No session URL returned');
      }
    } catch (err) {
      console.warn('[PaywallModal] checkout failed:', err);
      setError(err.message || 'Checkout failed');
      setPhase(insufficient ? 'topup' : 'decide');
    }
  };

  const handleBundle = async () => {
    if (!bundleCents) return;
    setError(null);
    setPhase('bundleCheckout');
    try {
      const res = await createBundleCheckout({ seriesId: series.id });
      if (res.session_url) {
        window.location.href = res.session_url;
      } else {
        throw new Error('No session URL returned');
      }
    } catch (err) {
      console.warn('[PaywallModal] bundle checkout failed:', err);
      if (err.already_owned) {
        // Race: another tab bought it — refresh
        onUnlocked && onUnlocked({ via_bundle: true });
      } else {
        setError(err.message || 'Bundle checkout failed');
        setPhase('decide');
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10000] bg-black/70 flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-background w-full max-w-md rounded-2xl shadow-2xl border border-background-tertiary overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-6 pb-4 border-b border-background-tertiary">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-label-tertiary hover:text-label transition-colors"
            aria-label="关闭"
          >
            <X size={20} />
          </button>
          <h2 className="text-lg font-medium text-label flex items-center gap-2">
            <Coin size={22} weight="fill" className="text-amber-500" />
            解锁第 {episode?.episode_no} 集
          </h2>
          <p className="text-xs text-label-tertiary mt-1 truncate">
            {series?.title} · {episode?.title || `Episode ${episode?.episode_no}`}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Balance + price summary */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-background-secondary border border-background-tertiary">
            <div className="text-xs text-label-secondary">本集价格</div>
            <div className="flex items-center gap-1.5 font-semibold text-label">
              <Coin size={14} weight="fill" className="text-amber-500" />
              {price} Tokens
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-background-secondary border border-background-tertiary">
            <div className="text-xs text-label-secondary">当前余额</div>
            <div className={`flex items-center gap-1.5 font-semibold ${insufficient ? 'text-amber-600 dark:text-amber-400' : 'text-label'}`}>
              <Coin size={14} weight="fill" className="text-amber-500" />
              {currentBalance} Tokens
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {/* Phase: decide — primary unlock + bundle */}
          {phase === 'decide' && !insufficient && (
            <>
              <button
                onClick={handleUnlock}
                className="w-full px-4 py-3 rounded-xl bg-accent text-white font-medium flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
              >
                <CheckCircle size={18} weight="fill" />
                花 {price} Tokens 解锁本集
              </button>
              {bundleCents && (
                <button
                  onClick={handleBundle}
                  className="w-full px-4 py-3 rounded-xl border border-accent/40 text-label font-medium flex items-center justify-center gap-2 hover:bg-accent/5 transition-colors"
                >
                  <ShieldCheck size={18} weight="fill" className="text-accent" />
                  整剧买断 ${(bundleCents / 100).toFixed(2)} 永久解锁
                </button>
              )}
              <p className="text-[11px] text-label-tertiary text-center">
                付费前请确认价格。Tokens 与美元的兑换比例:$1 = 20 Tokens。
              </p>
            </>
          )}

          {/* Phase: topup — insufficient balance, show packs */}
          {(phase === 'topup' || (phase === 'decide' && insufficient)) && (
            <>
              <p className="text-xs text-label-secondary">
                {insufficient
                  ? `还需 ${price - currentBalance} Tokens。充值后自动解锁。`
                  : '选一档充值'}
              </p>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {packages.map(pkg => (
                  <button
                    key={pkg.id}
                    onClick={() => handlePackPurchase(pkg)}
                    className="w-full px-4 py-3 rounded-xl border border-background-tertiary bg-background-secondary hover:border-accent hover:bg-accent/5 transition-colors flex items-center justify-between text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-label flex items-center gap-2">
                        <Coin size={14} weight="fill" className="text-amber-500" />
                        {pkg.ucoins} Tokens
                        {pkg.bonus > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 font-medium">
                            +{pkg.bonus} 赠
                          </span>
                        )}
                        {pkg.first_charge && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium">
                            首充
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-label-tertiary mt-0.5">{pkg.label || `$${(pkg.price_cents / 100).toFixed(2)}`}</div>
                    </div>
                    <div className="text-sm font-semibold text-label flex items-center gap-1">
                      ${(pkg.price_cents / 100).toFixed(2)} <ArrowRight size={14} />
                    </div>
                  </button>
                ))}
              </div>
              {bundleCents && (
                <button
                  onClick={handleBundle}
                  className="w-full mt-2 px-4 py-3 rounded-xl border border-accent/40 text-label font-medium flex items-center justify-center gap-2 hover:bg-accent/5 transition-colors"
                >
                  <ShieldCheck size={18} weight="fill" className="text-accent" />
                  或整剧买断 ${(bundleCents / 100).toFixed(2)}
                </button>
              )}
            </>
          )}

          {/* Phase: working states */}
          {(phase === 'unlocking' || phase === 'bundleCheckout') && (
            <div className="flex items-center justify-center gap-3 py-6 text-label-secondary">
              <CircleNotch size={20} className="animate-spin text-accent" />
              <span className="text-sm">{phase === 'bundleCheckout' ? '正在跳转支付…' : '处理中…'}</span>
            </div>
          )}
        </div>

        {/* Footer: compliance reminder per PDF §2.4 红线 */}
        <div className="px-6 py-3 border-t border-background-tertiary bg-background-secondary/40">
          <p className="text-[10px] text-label-tertiary text-center leading-relaxed">
            支付即视为接受
            {' '}<a href="/legal" className="underline hover:text-accent">用户协议</a>。
            自动续费默认关闭。如需退款请联系客服。
          </p>
        </div>
      </div>
    </div>
  );
}

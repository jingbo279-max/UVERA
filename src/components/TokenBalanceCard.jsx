import React from 'react';
import { Coin } from '@phosphor-icons/react';

/**
 * §2026-06-09 (Leon) — 共享 Token 余额卡。
 *
 * Wallet(SettingsPage WalletView)与订阅浮窗(SubscriptionPage)原本各画一张
 * 余额卡(Wallet「Current Balance」干净 vs 浮窗「Tokens remaining」带假进度条 +
 * 徽标动物园),重复且不一致。抽成单一组件两处复用,保证统一(Leon「不要重复
 * 造轮子」)。
 *
 * 图标统一用 accent Coin(原 Wallet 是 indigo SparkleToken,违反 accent token
 * 纪律 + 跟 Top up / Paywall 的 Coin 视觉不一致 —— 一并统一)。
 *
 * @param {number} credits   当前 Token 余额
 * @param {() => void} [onTopUp]  传则显示「Top up」按钮(Wallet→rightPane,浮窗→切 tab)
 * @param {string} [className]
 */
export default function TokenBalanceCard({ credits = 0, onTopUp, className = '' }) {
  return (
    <div className={`rounded-2xl border border-background-tertiary px-5 py-4 bg-background-secondary flex flex-row items-center gap-3 justify-between ${className}`}>
      {/* §2026-06-09 (Leon)— 卡高压缩 + CTA 始终右上(不在 mobile 全宽堆叠,与 Current
          Subscription 卡的 Change plan 位置一致)。 */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center border border-accent/20 flex-shrink-0">
          <Coin size={20} weight="fill" className="text-accent" />
        </div>
        <div className="min-w-0">
          {/* §2026-06-09 (Leon)— eyebrow→title 视觉间距:大头是 title line-height
              (30/24px 上方天然留白),非 margin。收 title 到 leading-none(24px)
              使视觉间距 ≈ 8px,与右侧 CTA 更工整。eyebrow margin 保持 mb-0.5(2px)。 */}
          <div className="text-xs text-label-secondary font-medium mb-0.5 whitespace-nowrap">Current Balance</div>
          <div className="text-2xl font-semibold text-label leading-none">
            {Number(credits).toLocaleString()} <span className="text-sm text-label-secondary font-normal">Tokens</span>
          </div>
        </div>
      </div>
      {onTopUp && (
        <button
          type="button"
          onClick={onTopUp}
          className="flex-shrink-0 px-4 py-2 bg-accent text-white rounded-xl text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer whitespace-nowrap"
        >
          Top up
        </button>
      )}
    </div>
  );
}

import React from 'react';
import { fetchWalletBalance, fetchUcoinsPackages } from '../api/dramaPayService';

/**
 * useUcoinsWallet — 共享的 Ucoin 钱包数据 hook(模块级缓存 + stale-while-revalidate)。
 *
 * 解决的问题(2026-06-06 甲方反馈):订阅页 Ucoin tab / 设置页余额卡每次
 * mount(切 tab、重进页)都从零串行拉 wallet + packages,且全屏 spinner 阻塞
 * → "切换很慢、每次都见 loading"。
 *
 * 策略:
 *  - wallet / packages 缓存到**模块作用域**,跨组件 mount/unmount 与 tab 切换
 *    存活(只有整页刷新才重置)。
 *  - 有缓存时立即返回缓存(loading=false),后台静默 revalidate(SWR);仅在
 *    完全无缓存时 loading=true 阻塞首拉。
 *  - wallet 加 TTL,短时间内反复切 tab 不重复打网络。
 *  - packages 是全站静态价目表,一旦取到长期缓存,且可用 withPackages:false
 *    跳过(余额卡只要 balance,不需要价目表)。
 *
 * 返回 { wallet, packages, loading, error, refreshWallet, setWallet }
 */

const ZERO_WALLET = { ucoins: 0, lifetime_purchased: 0, lifetime_spent: 0, recent_tx: [] };
const WALLET_TTL = 15000; // 15s 内的缓存视为新鲜,不后台 revalidate

// ── 模块级缓存(跨组件存活)──
let walletCache = null;
let walletCacheAt = 0;
let walletInflight = null;
let packagesCache = null;
let packagesInflight = null;

// §2026-06-09 (Leon「Header 也进统一缓存」)— 模块级订阅者集合,让所有挂载中的
//   consumer(Header / Wallet / 订阅浮窗)在余额变化时一起 re-render,真正单一
//   来源 + 实时同步(此前 setWallet 只更新调用方自己的 state,其它实例会滞后)。
const walletSubscribers = new Set();
function notifyWallet() { walletSubscribers.forEach((fn) => fn(walletCache)); }

function loadWallet() {
  if (!walletInflight) {
    walletInflight = fetchWalletBalance()
      .then((w) => { walletCache = w; walletCacheAt = Date.now(); notifyWallet(); return w; })
      .finally(() => { walletInflight = null; });
  }
  return walletInflight;
}

function loadPackages() {
  if (packagesCache) return Promise.resolve(packagesCache);
  if (!packagesInflight) {
    packagesInflight = fetchUcoinsPackages()
      .then((p) => { packagesCache = p; return p; })
      .finally(() => { packagesInflight = null; });
  }
  return packagesInflight;
}

export default function useUcoinsWallet({ withPackages = true } = {}) {
  const [wallet, setWalletState] = React.useState(walletCache);
  const [packages, setPackagesState] = React.useState(packagesCache || []);
  // 完全无缓存时才阻塞;有缓存立即渲染
  const [loading, setLoading] = React.useState(!walletCache);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;

    if (withPackages && !packagesCache) {
      loadPackages()
        .then((p) => { if (!cancelled) setPackagesState(p); })
        .catch(() => {});
    }

    const fresh = walletCache && (Date.now() - walletCacheAt < WALLET_TTL);
    if (fresh) {
      // 缓存新鲜,直接用,不打网络
      setLoading(false);
    } else {
      loadWallet()
        .then((w) => { if (!cancelled) setWalletState(w); })
        .catch((e) => {
          if (!cancelled) { setError(e); setWalletState((prev) => prev ?? ZERO_WALLET); }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }

    return () => { cancelled = true; };
  }, [withPackages]);

  // 订阅模块级缓存变化:任意 consumer 的 setWallet/refresh/load 后,全员同步
  //   re-render(Header / Wallet / 浮窗余额始终一致且实时)。
  React.useEffect(() => {
    const onChange = (w) => setWalletState(w);
    walletSubscribers.add(onChange);
    return () => { walletSubscribers.delete(onChange); };
  }, []);

  // 乐观/手动写余额(充值轮询拿到新值时用),回写模块缓存 + 通知全员
  const setWallet = React.useCallback((next) => {
    walletCache = typeof next === 'function' ? next(walletCache) : next;
    walletCacheAt = Date.now();
    notifyWallet();
  }, []);

  // 强制刷新(绕过 TTL,确保最新),通知全员
  const refreshWallet = React.useCallback(async () => {
    const w = await fetchWalletBalance();
    walletCache = w;
    walletCacheAt = Date.now();
    notifyWallet();
    return w;
  }, []);

  return { wallet, packages, loading, error, refreshWallet, setWallet };
}

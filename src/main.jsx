import './sentry.js'  // must run before anything else so init catches early errors
import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import IndexPage from '../index.jsx'
import AdminLogin from './pages/admin/AdminLogin.jsx'
import AdminDashboard from './pages/admin/AdminDashboard.jsx'
import HeroARTest from './pages/HeroARTest.jsx'
// Global version-update toast — was previously mounted only inside
// IndexPage, which meant standalone routes (/series/:id, /my-series,
// /admin, /terms, ...) never showed the prompt to refresh after deploys.
// Mounting at the Router root means every route gets it, including
// freshly-added pages without each having to remember to import it.
import VersionUpdater from './components/VersionUpdater.jsx'
import CookieBanner from './components/CookieBanner.jsx'
// LegalPage lazy-loaded — pulls react-markdown out of the main bundle (~130KB
// gzipped saved on initial load; only paid for by /terms /privacy /content-license visitors).
const LegalPage = lazy(() => import('./pages/LegalPage.jsx'))
// SeriesDetailPage lazy-loaded — only paid for by /series/:id visitors.
const SeriesDetailPage = lazy(() => import('./pages/SeriesDetailPage.jsx'))
const MySeriesPage = lazy(() => import('./pages/MySeriesPage.jsx'))
// §2026-06-06 — /wallet 不再重定向,改在 Settings 内渲染 Wallet 频道(见 routes
//   下方 /wallet → IndexPage)。原 WalletRedirect(v3 跳 /subscription?tab=ucoins)已删。
// §2026-05-25 fei — Creator earnings dashboard (Phase 3 短剧付费)
const CreatorEarningsPage = lazy(() => import('./pages/CreatorEarningsPage.jsx'))
import './design-system/tokens/index.css'

// Automatically reload when Vite chunk loading fails (usually due to a new
// deployment). Guarded against reload loops: if we've reloaded > 2 times
// in the last 30s for the same reason, the cache is probably stuck (stale
// SW or proxy serving old chunks) and another reload won't help. In that
// case unregister the SW, clear caches, then reload — that almost always
// breaks the loop. Without this guard, a Cloudflare cache lag + new build
// can put a user in an infinite reload state and they'll see the page
// flashing forever.
window.addEventListener('vite:preloadError', async (event) => {
  console.warn('Vite preload error (chunk missing). Reload count check…');
  const KEY = 'uvera_reload_attempts';
  const now = Date.now();
  let attempts = [];
  try {
    attempts = JSON.parse(sessionStorage.getItem(KEY) || '[]')
      .filter(ts => now - ts < 30_000);  // last 30s only
  } catch { attempts = []; }
  attempts.push(now);
  try { sessionStorage.setItem(KEY, JSON.stringify(attempts)); } catch { /* full storage */ }

  if (attempts.length > 2) {
    console.warn('Reload loop detected (>2 in 30s). Clearing SW + caches before reloading…');
    try {
      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      // Clear all caches
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch (err) {
      console.warn('SW/cache cleanup failed:', err);
    }
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    window.location.reload();
    return;
  }

  // First / second occurrence — just reload normally
  window.location.reload();
});

// Register Service Worker for PWA install support (production only)
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        {/* Global overlays — render on top of any route */}
        <VersionUpdater />
        <CookieBanner />
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/create" element={<IndexPage />} />
          <Route path="/create/short" element={<IndexPage />} />
          <Route path="/create/series" element={<IndexPage />} />
          <Route path="/create/flow" element={<IndexPage />} />
          <Route path="/discover" element={<IndexPage />} />
          <Route path="/discover/browse" element={<IndexPage />} />
          <Route path="/discover/s/:id" element={<IndexPage />} />
          <Route path="/library" element={<IndexPage />} />
          <Route path="/library/:tab" element={<IndexPage />} />
          <Route path="/studio" element={<IndexPage />} />
          <Route path="/subscription" element={<IndexPage />} />
          {/* 2026-05-06 Leon — User profile route stub. UserProfilePage
              组件由 Session 3 (scope-3-profile.md) 实现；当前 IndexPage
              fallback 走 catch-all 逻辑落到 discover，等 Session 3 加
              activeSection='user-profile' 处理 + 渲染 UserProfilePage。 */}
          <Route path="/u/:userId" element={<IndexPage />} />
          <Route path="/admin" element={<AdminLogin />} />
          <Route path="/admin/dashboard" element={<AdminDashboard />} />
          {/* Legal docs — slug maps to public/legal/<slug>.md.
              Wrapped in Suspense because LegalPage is lazy-loaded. */}
          <Route path="/terms" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><LegalPage /></Suspense>} />
          <Route path="/privacy" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><LegalPage /></Suspense>} />
          <Route path="/content-license" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><LegalPage /></Suspense>} />
          {/* Series detail + listing — added 2026-05-08 with publish flow */}
          <Route path="/series/:id" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><SeriesDetailPage /></Suspense>} />
          <Route path="/my-series" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><MySeriesPage /></Suspense>} />
          {/* §2026-06-06 — /wallet 在 Settings 内渲染 Wallet 频道(带设置侧栏),
              落实 fei 原注释本意「Wallet view lives inside Settings」。原
              WalletRedirect→/subscription?tab=ucoins 已移除(注释说 /settings、
              代码却跳 /subscription,不一致)。Stripe success_url 指向
              /subscription(见 worker L8410/8720),不经 /wallet,故无影响。 */}
          <Route path="/wallet" element={<IndexPage />} />
          {/* §2026-05-25 fei — Creator earnings (Phase 3 短剧付费) */}
          <Route path="/creator/earnings" element={<Suspense fallback={<div className="p-8 text-zinc-500">Loading…</div>}><CreatorEarningsPage /></Suspense>} />
          {/* Dev-only Hero AR 视觉实测页 — 决策确定后删除 */}
          <Route path="/test/hero-ar" element={<HeroARTest />} />
          <Route path="*" element={<IndexPage />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)

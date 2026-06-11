import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from '@phosphor-icons/react';

const STORAGE_KEY = 'uvera_cookie_acknowledged_v1';

/**
 * Minimal cookie / privacy notice banner.
 *
 * UVERA's actual cookie usage (as of v1.0.7):
 *   - Supabase auth session (HttpOnly cookies + localStorage)
 *   - Sentry error monitoring (uses sessionStorage, no third-party cookies)
 *   - localStorage for in-app state (drafts, preferences, version-toast
 *     dismissal, this banner's acknowledgement)
 *   - NO third-party analytics, NO marketing pixels, NO trackers
 *
 * Under GDPR, "strictly necessary" cookies (i.e. auth session) don't
 * require explicit consent — only **information**. Sentry can be
 * justified under "legitimate interest" for service reliability.
 *
 * That means we don't need the multi-toggle "Reject / Accept all"
 * pattern (which is for sites with marketing trackers). A single
 * "OK, got it" acknowledgement + a clear link to /privacy is sufficient
 * and avoids the dark-pattern fatigue most cookie banners cause.
 *
 * Bumping the storage key version (v1 → v2 → ...) when our cookie
 * policy materially changes will re-show the banner so users see the
 * updated text.
 */
export default function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Defer the check by one frame so SSR-style first paint stays clean
    // (we run in pure SPA but this also helps perceived perf).
    const t = setTimeout(() => {
      try {
        const dismissed = localStorage.getItem(STORAGE_KEY);
        if (!dismissed) setShow(true);
      } catch {
        // Privacy mode / storage disabled — show banner anyway. The user
        // can still dismiss it for the session even if it doesn't persist.
        setShow(true);
      }
    }, 800);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch { /* ignore */ }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookie notice"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-[90] animate-in slide-in-from-bottom-5 fade-in duration-500"
    >
      <div className="relative bg-background-secondary border border-background-tertiary rounded-2xl shadow-2xl p-4 pr-10">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex flex-shrink-0 items-center justify-center text-amber-600">
            <Cookie size={18} weight="bold" />
          </div>
          <div className="min-w-0 pt-0.5">
            <h4 className="text-sm font-medium text-label">A note on cookies</h4>
            <p className="text-xs text-label-secondary mt-1 leading-relaxed">
              We use essential cookies and local storage to keep you signed in
              and to detect crashes. We don't use marketing trackers or sell
              your data.{' '}
              <Link to="/privacy" className="text-accent hover:opacity-80 underline">
                Read our Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={dismiss}
            className="px-4 py-2 bg-accent hover:opacity-90 transition-opacity text-white text-xs font-medium rounded-lg shadow-sm"
          >
            OK, got it
          </button>
          <Link
            to="/privacy"
            onClick={dismiss}
            className="px-4 py-2 text-label-secondary hover:text-label hover:bg-background-tertiary transition-colors text-xs font-medium rounded-lg flex items-center"
          >
            Privacy Policy
          </Link>
        </div>

        <button
          onClick={dismiss}
          className="absolute top-3 right-3 p-1.5 text-label-tertiary hover:text-label hover:bg-background-tertiary transition-colors rounded-full z-10"
          aria-label="Dismiss"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}

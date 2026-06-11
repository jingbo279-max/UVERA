/**
 * Sentry error monitoring init.
 *
 * Set VITE_SENTRY_DSN env var (Cloudflare Pages → Settings → Env Vars,
 * AND in your local .env.local for dev) to enable. If unset, this module
 * is a no-op — Sentry stays inactive, no crashes from missing config.
 *
 * Get the DSN at sentry.io: New Project → React → copy the DSN string
 * (looks like https://xxx@oNNN.ingest.sentry.io/NNN).
 *
 * Imported by src/main.jsx before ReactDOM.render so init runs as early
 * as possible.
 */
import * as Sentry from '@sentry/react';

// Sentry DSN — public by design. Sentry DSNs only grant the client permission
// to send events to this specific project; they're meant to live in frontend
// bundles. Hardcoded here so deploys work without the operator needing to
// remember a build-time env var; can still be overridden via VITE_SENTRY_DSN
// if a fork wants to send to a different Sentry project.
const FALLBACK_DSN = 'https://21a3c47a7693d64560407794714ca82f@o4511337293479936.ingest.us.sentry.io/4511341588316160';

const dsn = import.meta.env.VITE_SENTRY_DSN || FALLBACK_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE, // 'production' | 'development'
    // §2026-05-31 — 用 vite.config.js 注入的全局 __APP_VERSION__(= package.json
    //   version)。之前读 import.meta.env.VITE_APP_VERSION(从没人设)→ 永远
    //   'unknown',导致 Sentry 无法按 release 归组 + source map 对不上。
    release: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown',

    // Performance monitoring — keep low until we know traffic shape.
    tracesSampleRate: 0.1,

    // Session Replay — disabled by default to keep bundle small + privacy-safe.
    // Enable later if we need to see user interactions before a crash.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // PII handling: DON'T auto-send IP addresses, emails, or other user
    // identifiers by default — that conflicts with our privacy posture
    // (docs/legal/PRIVACY.md doesn't list Sentry as a PII recipient). When we
    // need to debug a specific user's issue, attach context per-event
    // via Sentry.setUser({ id: ... }) explicitly.
    sendDefaultPii: false,

    // Filter out known noise to keep error budget meaningful.
    // §2026-05-31 — extended after first Sentry triage (P3 bug pipeline):
    // the three families below were drowning real bugs (~570 of ~600 events).
    ignoreErrors: [
      // ── Stale-deploy / chunk loading ─────────────────────────────────
      // A user on an old index.html requests a JS chunk whose hash no longer
      // exists post-deploy; the server returns the 404 HTML page, so the
      // browser refuses to run it as a module. We already auto-reload these
      // via the 'vite:preloadError' handler in main.jsx — but the error is
      // still thrown (and captured) before the reload, so silence it here.
      /Failed to fetch dynamically imported module/,
      /Importing a module script failed/,
      /error loading dynamically imported module/,
      /is not a valid JavaScript MIME type/,
      // ── React DOM reconciliation vs. external DOM mutation ────────────
      // Browser auto-translate (Google / QQ / in-app webviews) and some
      // extensions rewrite text nodes, then React can't find the node it
      // expected to remove/insert. Thrown from minified React internals,
      // userCount ~0, unactionable from our code. NOTE: if a page is VISIBLY
      // breaking (not just noisy in Sentry), re-enable to investigate a real
      // reconciliation regression — see docs/engineering/known-issues.md.
      /Failed to execute 'removeChild' on 'Node'/,
      /Failed to execute 'insertBefore' on 'Node'/,
      /The node to be removed is not a child of this node/,
      /The node before which the new node is to be inserted is not a child of this node/,
      /NotFoundError: The object can not be found here/,
      // ── Browser extension noise ──────────────────────────────────────
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
      // Third-party embed SDK (vendor iframe/oEmbed sdk.latest) postMessage
      // structured-clone failure inside their code, not ours.
      /DataCloneError: The object can not be cloned/,
      // ── Supabase Web Locks (auth token coordination) ─────────────────
      // Supabase uses the Web Locks API to coordinate token refresh across
      // tabs. Three benign variants, all auth-succeeds-anyway:
      //   • loser of a race sees the winner 'steal' the lock
      //   • the lock is released when the page is backgrounded/hidden (mobile
      //     tab switches, bfcache) and re-acquired on resume
      // See https://github.com/supabase/auth-js/issues/762 upstream.
      /Lock broken by another request with the 'steal' option/,
      /Lock acquired with the 'steal' option/,
      /Lock "lock:sb-.*?-auth-token" was released/,
      // Cross-tab navigation cancellations — Network errors on aborted fetches
      // when a user navigates away mid-request. Not actionable.
      /AbortError: signal is aborted without reason/,
      /AbortError: The operation was aborted/,
    ],
  });
}

export { Sentry };

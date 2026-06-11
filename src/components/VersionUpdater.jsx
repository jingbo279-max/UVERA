import React, { useState, useEffect } from 'react';
import { DownloadSimple, X, CaretDown, CaretUp } from '@phosphor-icons/react';

const LOCAL_STORAGE_KEY_DISMISSED = 'uvera_dismissed_version';

// __APP_VERSION__ is injected globally by Vite during build (see vite.config.js)
// Fallback for extreme edge cases where Vite didn't inject it:
const CURRENT_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';

// Polling interval: 10 minutes. Aggressive enough that users see new
// versions within 10 min of deploy, conservative enough to not hammer
// the CDN. Tuned for the post-launch high-iteration window — can be
// relaxed to 1 hour once the app is stable.
const POLL_INTERVAL_MS = 10 * 60 * 1000;

// Initial check delay after mount — keeps the first paint cheap.
const INITIAL_CHECK_DELAY_MS = 4000;

export default function VersionUpdater() {
  const [show, setShow] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState(null);
  const [latestRelease, setLatestRelease] = useState(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const checkVersion = async () => {
      try {
        const res = await fetch('/version.json?t=' + Date.now());
        if (!res.ok) return;

        const data = await res.json();
        const latestVersion = data.version;
        if (!latestVersion || !isMounted) return;

        const dismissedVersion = localStorage.getItem(LOCAL_STORAGE_KEY_DISMISSED);

        if (latestVersion !== CURRENT_VERSION && dismissedVersion !== latestVersion) {
          setRemoteVersion(latestVersion);
          setLatestRelease(data.latestRelease || null);
          setShow(true);
        }
      } catch (err) {
        // Silently skip — try again next interval
      }
    };

    const initialTimer = setTimeout(checkVersion, INITIAL_CHECK_DELAY_MS);
    const intervalTimer = setInterval(checkVersion, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, []);

  if (!show) return null;

  const handleUpdate = () => {
    /* 2026-05-09 Leon — 修复：之前 removeItem(dismissed) + reload 在 dev mode
     * (__APP_VERSION__ 未注入 → fallback '1.0.0') 或 prod hard-reload 失败时
     * 会再次弹 (dismissed 已清 + CURRENT_VERSION 仍旧 != latestVersion).
     *
     * 改为 set dismissed = remoteVersion 再 reload:
     * - 成功 reload (bundle 升级)：CURRENT_VERSION === latestVersion → 不弹
     * - 失败 / dev (bundle 未升)：dismissed === latestVersion → 不弹
     * 下次 deploy version.json 提升 → 新 latestVersion → dismissed 不匹配 → 弹 ✓ */
    if (remoteVersion) {
      localStorage.setItem(LOCAL_STORAGE_KEY_DISMISSED, remoteVersion);
    }
    // Hard reload to fetch the new bundle and re-register the service worker
    window.location.reload(true);
  };

  const handleDismiss = () => {
    if (remoteVersion) {
      localStorage.setItem(LOCAL_STORAGE_KEY_DISMISSED, remoteVersion);
    }
    setShow(false);
  };

  // Show top 3 highlights in the collapsed view; rest revealed on expand.
  const highlights = latestRelease?.highlights || [];
  const collapsedHighlights = highlights.slice(0, 3);
  const hasMore = highlights.length > collapsedHighlights.length;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-500">
      <div className="relative overflow-hidden bg-background-secondary border border-background-tertiary rounded-2xl shadow-2xl p-4 pr-10 w-[360px] max-w-[calc(100vw-3rem)]">
        {/* Background glow effect for premium feel */}
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-accent/20 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-accent/10 border border-accent/20 flex flex-shrink-0 items-center justify-center text-accent">
              <DownloadSimple size={18} weight="bold" />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-medium text-label">
                {latestRelease?.title || 'New version available'}
              </h4>
              <p className="text-xs text-label-tertiary mt-0.5">
                v{remoteVersion} {latestRelease?.date && `· ${latestRelease.date}`}
              </p>
            </div>
          </div>

          {highlights.length > 0 && (
            <ul className="text-xs text-label-secondary space-y-1 mb-3 leading-relaxed">
              {(expanded ? highlights : collapsedHighlights).map((h, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-accent flex-shrink-0">·</span>
                  <span>{h}</span>
                </li>
              ))}
              {hasMore && !expanded && (
                <li>
                  <button
                    onClick={() => setExpanded(true)}
                    className="text-xs text-accent hover:opacity-80 inline-flex items-center gap-1 mt-1"
                  >
                    Show {highlights.length - collapsedHighlights.length} more <CaretDown size={11} weight="bold" />
                  </button>
                </li>
              )}
              {hasMore && expanded && (
                <li>
                  <button
                    onClick={() => setExpanded(false)}
                    className="text-xs text-label-tertiary hover:text-label inline-flex items-center gap-1 mt-1"
                  >
                    Show less <CaretUp size={11} weight="bold" />
                  </button>
                </li>
              )}
            </ul>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleUpdate}
              className="px-4 py-2 bg-accent hover:opacity-90 transition-opacity text-white text-xs font-medium rounded-lg cursor-pointer shadow-sm"
            >
              Update now
            </button>
            <button
              onClick={handleDismiss}
              className="px-4 py-2 text-label-secondary hover:text-label hover:bg-background-tertiary transition-colors text-xs font-medium rounded-lg cursor-pointer"
            >
              Later
            </button>
          </div>
        </div>

        {/* Close (X) button — same as "Later" but visually distinct */}
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1.5 text-label-tertiary hover:text-label hover:bg-background-tertiary transition-colors rounded-full cursor-pointer z-10"
          aria-label="Dismiss update"
        >
          <X size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}

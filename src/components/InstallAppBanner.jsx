import React, { useState, useEffect } from 'react';
import { DownloadSimple, X, ShareNetwork, PlusSquare } from '@phosphor-icons/react';
import usePWAInstall from '../hooks/usePWAInstall';

/**
 * InstallAppBanner — a sleek, dismissible banner that appears when the app
 * can be installed as a PWA. On iOS Safari it shows manual instructions.
 *
 * Automatically hides if:
 *   - App is already installed (standalone mode)
 *   - User dismissed it (stored in localStorage for 7 days)
 */
export default function InstallAppBanner() {
  const { canInstall, isInstalled, isIOSSafari, promptInstall } = usePWAInstall();
  const [dismissed, setDismissed] = useState(true); // default hidden until check
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  /* Check if user previously dismissed */
  useEffect(() => {
    const dismissedAt = localStorage.getItem('uvera_install_dismissed');
    if (dismissedAt) {
      const elapsed = Date.now() - Number(dismissedAt);
      // Show again after 7 days
      if (elapsed < 7 * 24 * 60 * 60 * 1000) {
        setDismissed(true);
        return;
      }
    }
    setDismissed(false);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('uvera_install_dismissed', String(Date.now()));
  };

  const handleInstall = async () => {
    if (isIOSSafari) {
      setShowIOSGuide(true);
      return;
    }
    const accepted = await promptInstall();
    if (accepted) handleDismiss();
  };

  // Don't render if already installed, dismissed, or can't install
  if (isInstalled) return null;
  if (dismissed) return null;
  if (!canInstall && !isIOSSafari) return null;

  return (
    <>
      {/* ── Banner ──────────────────────────────────────────────────────── */}
      <div style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 80px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 'calc(100% - 32px)',
        maxWidth: 420,
        background: 'linear-gradient(135deg, rgba(99,102,241,0.95) 0%, rgba(139,92,246,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRadius: 16,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 8px 32px rgba(99,102,241,0.4), 0 2px 8px rgba(0,0,0,0.3)',
        animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        {/* Icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: 'rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src="/icons/icon-64x64.png" alt="UVERA" style={{ width: 32, height: 32, borderRadius: 6 }} />
        </div>

        {/* Text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
            Install UVERA
          </div>
          <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 500, lineHeight: 1.3, marginTop: 2 }}>
            {isIOSSafari ? 'Add to Home Screen for the best experience' : 'Install as app for a faster, full-screen experience'}
          </div>
        </div>

        {/* Install button */}
        <button
          onClick={handleInstall}
          style={{
            height: 36, padding: '0 16px', borderRadius: 18,
            background: 'white',
            color: '#6366f1',
            fontSize: 13, fontWeight: 700,
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            flexShrink: 0,
            transition: 'transform 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <DownloadSimple size={16} weight="bold" />
          Install
        </button>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss"
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <X size={14} weight="bold" style={{ color: 'white' }} />
        </button>

        <style>{`
          @keyframes slideUp {
            from { opacity: 0; transform: translateX(-50%) translateY(20px); }
            to   { opacity: 1; transform: translateX(-50%) translateY(0); }
          }
        `}</style>
      </div>

      {/* ── iOS Safari Guide Modal ──────────────────────────────────────── */}
      {showIOSGuide && (
        <div
          onClick={() => setShowIOSGuide(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 380,
              background: '#1C1E28',
              borderRadius: 20,
              padding: 24,
              marginBottom: 'env(safe-area-inset-bottom, 16px)',
              animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <h3 style={{ color: 'white', fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 20, textAlign: 'center' }}>
              Install UVERA
            </h3>

            {/* Step 1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: 'rgba(99,102,241,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <ShareNetwork size={22} weight="bold" style={{ color: '#818cf8' }} />
              </div>
              <div>
                <div style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>1. Tap the Share button</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
                  Find the <ShareNetwork size={12} weight="bold" style={{ color: '#818cf8', verticalAlign: 'middle' }} /> icon at the bottom of Safari
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: 'rgba(99,102,241,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <PlusSquare size={22} weight="bold" style={{ color: '#818cf8' }} />
              </div>
              <div>
                <div style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>2. Select "Add to Home Screen"</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
                  Scroll down in the share menu to find it
                </div>
              </div>
            </div>

            {/* Step 3 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: 'rgba(99,102,241,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <DownloadSimple size={22} weight="bold" style={{ color: '#818cf8' }} />
              </div>
              <div>
                <div style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>3. Tap "Add"</div>
                <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 2 }}>
                  UVERA will appear on your Home Screen
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              style={{
                width: '100%', height: 44, borderRadius: 12,
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: 'white', fontSize: 15, fontWeight: 700,
                border: 'none', cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useEffect, useCallback } from 'react';

/**
 * usePWAInstall — manages the "Add to Home Screen" / PWA install flow.
 *
 * Returns:
 *   canInstall       — true when the browser's install prompt is available
 *   isInstalled      — true when the app is already running as installed PWA
 *   isIOSSafari      — true on iOS Safari (needs manual "Add to Home Screen")
 *   promptInstall()  — triggers the native install prompt (Chrome/Edge/Samsung)
 */
export default function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  /* Detect if already running as installed PWA */
  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(isStandalone);
  }, []);

  /* Capture the `beforeinstallprompt` event (Chrome / Edge / Samsung Browser) */
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    /* Detect when app is installed */
    const installedHandler = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('appinstalled', installedHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  /* Trigger the native install prompt */
  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    return outcome === 'accepted';
  }, [deferredPrompt]);

  /* iOS Safari detection (no beforeinstallprompt — must guide user manually) */
  const isIOSSafari = /iP(hone|od|ad)/.test(navigator.userAgent) &&
    /Safari/.test(navigator.userAgent) &&
    !window.navigator.standalone;

  return {
    canInstall: !!deferredPrompt,
    isInstalled,
    isIOSSafari,
    promptInstall,
  };
}

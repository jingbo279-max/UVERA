/**
 * §2026-05-25 fei — InlineErrorBanner
 *
 * Replaces window.alert() for Seedance/upload/merge errors. Shown inside
 * the active section (Free Mode card, render station, segment timeline)
 * instead of blocking the whole page.
 *
 * Props:
 *   error      — Error | string | null. Null hides the banner.
 *   onDismiss  — () => void. Called when user clicks the X.
 *   onRetry    — () => void. Optional. Renders a "重试" button next to dismiss.
 *   retryLabel — string. Override the retry button label (default "重试").
 *   kind       — 'error' | 'warning' | 'info' (default 'error')
 *   title      — Optional one-line title above the error message. Use for
 *                user-facing context like "段 3 生成失败" — the raw error
 *                still appears as the message body.
 *   help       — Optional rich React node to render below the message
 *                (e.g., links to docs, "试试这个" suggestion).
 *
 * The component handles:
 *   · Normalizing Error/string into a single string for display
 *   · Color theming per `kind`
 *   · Dismiss + Retry button row
 *   · Multi-line wrap for long Seedance error bodies
 *   · Auto-dismiss after 12s for warning/info (errors stay until dismissed)
 *
 * Visual: a stack of rounded rows pinned at the top of the parent section.
 * Multiple banners can coexist (one per state bucket: renderError,
 * freeSegmentError, mergeError, uploadError…) so independent failures
 * don't overwrite each other.
 */

import { useEffect } from 'react';
import { Warning, WarningCircle, Info, X, ArrowsClockwise } from '@phosphor-icons/react';

const KIND_STYLES = {
  error: {
    bg:     'bg-red-50 dark:bg-red-950/40',
    border: 'border-red-300 dark:border-red-800/70',
    text:   'text-red-900 dark:text-red-100',
    detail: 'text-red-800 dark:text-red-200/90',
    icon:   'text-red-600 dark:text-red-400',
    Icon:   WarningCircle,
    btnBg:  'bg-red-600 hover:bg-red-500 text-white',
  },
  warning: {
    bg:     'bg-amber-50 dark:bg-amber-950/40',
    border: 'border-amber-300 dark:border-amber-800/70',
    text:   'text-amber-900 dark:text-amber-100',
    detail: 'text-amber-800 dark:text-amber-200/90',
    icon:   'text-amber-600 dark:text-amber-400',
    Icon:   Warning,
    btnBg:  'bg-amber-600 hover:bg-amber-500 text-white',
  },
  info: {
    bg:     'bg-blue-50 dark:bg-blue-950/40',
    border: 'border-blue-300 dark:border-blue-800/70',
    text:   'text-blue-900 dark:text-blue-100',
    detail: 'text-blue-800 dark:text-blue-200/90',
    icon:   'text-blue-600 dark:text-blue-400',
    Icon:   Info,
    btnBg:  'bg-blue-600 hover:bg-blue-500 text-white',
  },
};

const normalizeError = (e) => {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'object') return e.message || JSON.stringify(e).slice(0, 500);
  return String(e);
};

export default function InlineErrorBanner({
  error,
  onDismiss,
  onRetry,
  retryLabel = '重试',
  kind = 'error',
  title,
  help,
}) {
  const style = KIND_STYLES[kind] || KIND_STYLES.error;
  const { Icon } = style;
  const msg = normalizeError(error);

  // Auto-dismiss after 12s for non-blocking kinds.
  //   Errors stay until manually dismissed — they usually have a retry CTA.
  useEffect(() => {
    if (!error || kind === 'error') return;
    if (!onDismiss) return;
    const t = setTimeout(onDismiss, 12000);
    return () => clearTimeout(t);
  }, [error, kind, onDismiss]);

  if (!error) return null;

  return (
    <div
      role="alert"
      className={`my-3 rounded-xl border ${style.border} ${style.bg} px-4 py-3 flex items-start gap-3 animate-fade-in`}
    >
      <Icon size={18} weight="fill" className={`${style.icon} shrink-0 mt-0.5`} />
      <div className="min-w-0 flex-1">
        {title && (
          <div className={`text-sm font-medium ${style.text} mb-0.5`}>{title}</div>
        )}
        <div className={`text-sm ${style.detail} break-words whitespace-pre-line leading-snug`}>{msg}</div>
        {help && (
          <div className={`text-xs ${style.detail} mt-2 opacity-90`}>{help}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onRetry && (
          <button
            onClick={onRetry}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${style.btnBg}`}
          >
            <ArrowsClockwise size={12} weight="bold" /> {retryLabel}
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="关闭"
            className={`${style.icon} hover:opacity-70 p-1`}
          >
            <X size={16} weight="bold" />
          </button>
        )}
      </div>
    </div>
  );
}

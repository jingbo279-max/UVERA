import { useState } from 'react';
import { X, Warning, Check, CircleNotch } from '@phosphor-icons/react';
import { supabase } from '../api/supabaseClient';

/**
 * Generic report-content modal — used on Discover cards, series detail
 * pages, and anywhere else a user might want to flag inappropriate or
 * infringing content.
 *
 * Props:
 *   open: boolean
 *   onClose: () => void
 *   contentType: 'recommended_content' | 'series' | 'user_video_upload'
 *   contentId: uuid string
 *   contentTitle?: string  (for snapshot + display)
 *
 * Backend: POST /api/content-reports/submit
 *   - Anonymous reports allowed (DMCA from non-users)
 *   - Authenticated reports get reporter_user_id attribution
 *   - All reports capture IP + UA at the Worker
 *
 * The form is intentionally minimal:
 *   - Reason category (radio, fixed enum)
 *   - Optional detail textarea (≤ 4000 chars)
 *   - Submit
 *
 * Three states: editing → submitting → submitted.
 */

const REASONS = [
  {
    id: 'copyright',
    label: 'Copyright violation',
    blurb: 'I own the rights to this content (or represent the rights holder).',
  },
  {
    id: 'inappropriate',
    label: 'Inappropriate / harmful content',
    blurb: 'Sexual, violent, or otherwise harmful material that breaks the rules.',
  },
  {
    id: 'impersonation',
    label: 'Impersonation',
    blurb: 'This content uses my likeness or identity without permission.',
  },
  {
    id: 'spam',
    label: 'Spam or scam',
    blurb: 'Misleading content, scams, or commercial spam.',
  },
  {
    id: 'dangerous',
    label: 'Dangerous activity',
    blurb: 'Encourages real-world harm, dangerous challenges, or illegal acts.',
  },
  {
    id: 'other',
    label: 'Something else',
    blurb: 'Use the detail box below to explain.',
  },
];

export default function ReportContentModal({ open, onClose, contentType, contentId, contentTitle }) {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const reset = () => {
    setReason('');
    setDetail('');
    setError(null);
    setDone(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!reason) {
      setError('Please pick a reason.');
      return;
    }
    if (reason === 'other' && (!detail || detail.trim().length < 10)) {
      setError('When choosing "Something else", please describe the problem in at least 10 characters.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      // Best-effort attach JWT — if user is logged in we want attribution;
      // if not, the report still goes through anonymously (DMCA flow).
      const headers = { 'Content-Type': 'application/json' };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      } catch { /* anonymous OK */ }

      const res = await fetch('/api/content-reports/submit', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contentType,
          contentId,
          reason,
          detail: detail.trim() || null,
          reportedTitle: contentTitle || null,
          reportedUrl: typeof window !== 'undefined' ? window.location.href : null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.errMessage || `Submit failed (HTTP ${res.status})`);
      }
      setDone(true);
    } catch (err) {
      setError(err.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-label="Report content"
    >
      <div
        className="relative bg-background-secondary border border-background-tertiary rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background-secondary border-b border-background-tertiary px-5 py-3 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-amber-500" />
            <h3 className="text-sm font-medium text-label">Report content</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="p-1.5 text-label-tertiary hover:text-label hover:bg-background-tertiary rounded-full transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={14} weight="bold" />
          </button>
        </div>

        {done ? (
          /* ─── Success state ───────────────────────────────────────────── */
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 mx-auto flex items-center justify-center text-emerald-500 mb-4">
              <Check size={28} weight="bold" />
            </div>
            <h4 className="text-base font-medium text-label mb-2">Report submitted</h4>
            <p className="text-sm text-label-secondary mb-5 leading-relaxed">
              Thanks. Our team typically reviews reports within 48 hours and will
              take action if the content violates our policies. For copyright
              claims, we may follow up by email.
            </p>
            <button
              onClick={handleClose}
              className="px-5 py-2 bg-accent hover:opacity-90 text-white rounded-xl text-sm font-medium transition-opacity"
            >
              Close
            </button>
          </div>
        ) : (
          /* ─── Editing state ──────────────────────────────────────────── */
          <div className="p-5 space-y-4">
            {contentTitle && (
              <div className="text-xs text-label-tertiary">
                Reporting: <span className="text-label-secondary">{contentTitle}</span>
              </div>
            )}

            <div>
              <p className="text-sm text-label mb-3">Why are you reporting this?</p>
              <div className="space-y-2">
                {REASONS.map((r) => (
                  <label
                    key={r.id}
                    className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      reason === r.id
                        ? 'border-accent bg-accent/5'
                        : 'border-background-tertiary hover:border-background-tertiary hover:bg-background'
                    }`}
                  >
                    <input
                      type="radio"
                      name="report-reason"
                      value={r.id}
                      checked={reason === r.id}
                      onChange={(e) => setReason(e.target.value)}
                      className="mt-1 accent-accent"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-label">{r.label}</div>
                      <div className="text-xs text-label-secondary mt-0.5 leading-relaxed">{r.blurb}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-label-secondary mb-1.5">
                Details {reason === 'other' && <span className="text-red-500">*</span>}
                <span className="text-label-tertiary"> (optional for other reasons)</span>
              </label>
              <textarea
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={
                  reason === 'copyright'
                    ? 'Describe your copyrighted work and how this content infringes. Include URLs to your originals if possible.'
                    : reason === 'other'
                    ? 'Please explain the problem.'
                    : 'Add any context that would help our reviewers.'
                }
                disabled={submitting}
                className="w-full px-3 py-2 bg-background border border-background-tertiary rounded-xl text-sm text-label placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 resize-none"
              />
              <div className="text-[10px] text-label-tertiary mt-1">{detail.length} / 4000</div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-500">
                {error}
              </div>
            )}

            <p className="text-[11px] text-label-tertiary leading-relaxed">
              We log your IP address and browser to assist with abuse investigation
              and DMCA correspondence. By submitting, you confirm the report is
              made in good faith. False reports may result in account action.
            </p>

            <div className="flex gap-2 justify-end pt-2 border-t border-background-tertiary">
              <button
                onClick={handleClose}
                disabled={submitting}
                className="px-4 py-2 text-label-secondary hover:text-label hover:bg-background-tertiary rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !reason}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:bg-background-tertiary disabled:text-label-tertiary disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 min-w-[110px] justify-center"
              >
                {submitting ? (
                  <><CircleNotch size={14} className="animate-spin" /> Sending…</>
                ) : (
                  <>Submit report</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

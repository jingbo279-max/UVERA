-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-26 fei (audit #7) — Refund audit columns for drama orders.
--
-- Why: ucoins_orders + series_purchases status enum already allows 'refunded'
-- but there's no column to record WHEN the refund happened or WHICH Stripe
-- refund id triggered it. Without this, admin can see a row went refunded
-- but can't reconcile with Stripe Dashboard for disputes. Adding nullable
-- columns is non-breaking.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.ucoins_orders
  ADD COLUMN IF NOT EXISTS refunded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_refund_id  text;

ALTER TABLE public.series_purchases
  ADD COLUMN IF NOT EXISTS refunded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_refund_id  text;

COMMENT ON COLUMN public.ucoins_orders.refunded_at IS
  'Timestamp the order transitioned to status=refunded. Set by Stripe charge.refunded webhook or admin refund endpoint.';
COMMENT ON COLUMN public.ucoins_orders.stripe_refund_id IS
  'Stripe re_... id of the refund operation. Use to look up the refund in Stripe Dashboard for reconciliation.';
COMMENT ON COLUMN public.series_purchases.refunded_at IS
  'Timestamp the bundle purchase was refunded. Cascading effect: corresponding episode_unlocks with unlock_type=bundle were deleted.';
COMMENT ON COLUMN public.series_purchases.stripe_refund_id IS
  'Stripe re_... id of the refund operation.';

COMMIT;

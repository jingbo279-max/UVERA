-- 20260509_orders_refund.up.sql
-- Adds Stripe refund tracking to public.orders.
--
-- Why: admins need to issue refunds without leaving UVERA. Previously
-- the only path was switching to Stripe Dashboard, refunding there, and
-- the order in our DB stayed marked "Paid" forever — KPIs lied.
--
-- Now: admins click "Refund" in OrdersView. POST /api/admin/orders/refund
-- calls Stripe's Refunds API and writes these audit columns. KPIs filter
-- by `refunded_at IS NULL` so net revenue is accurate.
--
-- The webhook also handles `charge.refunded` events so refunds issued
-- directly in Stripe Dashboard sync back here automatically.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS refunded_at        timestamp with time zone,
  ADD COLUMN IF NOT EXISTS refunded_by        uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS refunded_reason    text,
  ADD COLUMN IF NOT EXISTS refunded_amount    numeric,             -- USD; may be < amount for partial refunds
  ADD COLUMN IF NOT EXISTS stripe_refund_id   text,                -- re_xxx — for cross-system audit
  ADD COLUMN IF NOT EXISTS credits_deducted   integer DEFAULT 0;   -- how many tokens we subtracted from user

-- Partial index for "active orders" queries (paid AND not refunded AND not voided).
-- The voided index already exists from 20260509_orders_void.up.sql.
CREATE INDEX IF NOT EXISTS idx_orders_refunded_at
  ON public.orders (refunded_at)
  WHERE refunded_at IS NULL;

COMMENT ON COLUMN public.orders.refunded_at IS
  'Set when a refund is issued (full or partial). NULL = no refund.';
COMMENT ON COLUMN public.orders.refunded_by IS
  'auth.users.id of the admin who issued the refund.';
COMMENT ON COLUMN public.orders.refunded_amount IS
  'Refunded USD amount. May be less than orders.amount for partial refunds.';
COMMENT ON COLUMN public.orders.stripe_refund_id IS
  'Stripe refund object ID (re_xxx). Use to look up the refund in Stripe Dashboard.';
COMMENT ON COLUMN public.orders.credits_deducted IS
  'Tokens we subtracted from user_metadata.credits as part of this refund. 0 if admin chose not to deduct.';

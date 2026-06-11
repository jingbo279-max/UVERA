-- 20260509_orders_refund.down.sql
DROP INDEX IF EXISTS public.idx_orders_refunded_at;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS credits_deducted,
  DROP COLUMN IF EXISTS stripe_refund_id,
  DROP COLUMN IF EXISTS refunded_amount,
  DROP COLUMN IF EXISTS refunded_reason,
  DROP COLUMN IF EXISTS refunded_by,
  DROP COLUMN IF EXISTS refunded_at;

-- 20260509_orders_void.down.sql
DROP INDEX IF EXISTS public.idx_orders_voided_at;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS voided_reason,
  DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS voided_at;

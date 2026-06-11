-- 20260509_orders_void.up.sql
-- Adds soft-delete / void capability to public.orders.
--
-- Why: previously the admin "Payments & Orders" tab had a hard-delete
-- button. One misclick = lost revenue audit trail forever (the Stripe
-- payment in their account is real, but our records would lose it).
--
-- Now: admins click "Void" instead of "Delete". The row stays, marked
-- voided, with who/when/why. Reports and KPIs filter out voided rows
-- by default but you can still see the trail.
--
-- Restoring is just UPDATE … SET voided_at = NULL.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS voided_at     timestamp with time zone,
  ADD COLUMN IF NOT EXISTS voided_by     uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS voided_reason text;

-- Index on voided_at for fast "active orders only" queries
CREATE INDEX IF NOT EXISTS idx_orders_voided_at
  ON public.orders (voided_at)
  WHERE voided_at IS NULL;

COMMENT ON COLUMN public.orders.voided_at IS
  'Set when an admin marks this order as voided (soft-delete). NULL = active.';
COMMENT ON COLUMN public.orders.voided_by IS
  'auth.users.id of the admin who voided this order.';
COMMENT ON COLUMN public.orders.voided_reason IS
  'Free-form reason supplied by the admin at void time. Audit trail.';

-- 20260513_phase1_credits_to_tokens.up.sql
-- §A Phase 1: schema-level dual-write infrastructure for the
-- credits → tokens rename (Leon's v1.2 spec).
--
-- This migration ONLY adds new columns + new mirror table + backfills
-- existing data. Application-level dual-writes (Stripe webhook,
-- admin grant flow, daily claim, etc.) are deployed in the same
-- commit as this migration. After 1-2 weeks of clean dual-write
-- operation + frontend Phase 2 cutover, Phase 4 drops the old
-- column/table.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.

BEGIN;

-- ── 1. orders.tokens_deducted (mirrors credits_deducted) ──
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS tokens_deducted int;

UPDATE public.orders
   SET tokens_deducted = credits_deducted
 WHERE tokens_deducted IS NULL
   AND credits_deducted IS NOT NULL;

-- ── 2. generation_logs.tokens_charged (mirrors credits_charged) ──
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS tokens_charged int;

UPDATE public.generation_logs
   SET tokens_charged = credits_charged
 WHERE tokens_charged IS NULL
   AND credits_charged IS NOT NULL;

-- ── 3. token_grants table (mirrors credit_grants 1:1) ──
-- Cannot use CREATE TABLE LIKE because that doesn't carry FK refs.
-- We replicate the schema explicitly.
CREATE TABLE IF NOT EXISTS public.token_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK (amount > 0),
  tier varchar(32),
  reason text,
  stripe_invoice_id text,
  granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.token_grants ENABLE ROW LEVEL SECURITY;

-- Same RLS policies as credit_grants
DROP POLICY IF EXISTS "token_grants_admin_full" ON public.token_grants;
CREATE POLICY "token_grants_admin_full" ON public.token_grants
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "token_grants_select_own" ON public.token_grants;
CREATE POLICY "token_grants_select_own" ON public.token_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_token_grants_user_at
  ON public.token_grants(user_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_grants_at
  ON public.token_grants(granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_grants_invoice
  ON public.token_grants(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

-- Mirror existing credit_grants rows → token_grants
INSERT INTO public.token_grants (id, user_id, granted_by, amount, tier, reason, stripe_invoice_id, granted_at)
SELECT id, user_id, granted_by, amount, tier, reason, stripe_invoice_id, granted_at
  FROM public.credit_grants
ON CONFLICT (id) DO NOTHING;

-- ── 4. (Note) user_metadata.credits → tokens migration is
--     NOT done here. That happens via the admin endpoint
--     /api/admin/migrate-credits-key in Phase 3 because it needs
--     service_role to enumerate auth.users and rewrite metadata.

-- ── 5. Audit summary ──
DO $$
DECLARE
  orders_count int;
  logs_count int;
  grants_count int;
BEGIN
  SELECT count(*) INTO orders_count FROM public.orders WHERE tokens_deducted IS NOT NULL;
  SELECT count(*) INTO logs_count FROM public.generation_logs WHERE tokens_charged IS NOT NULL;
  SELECT count(*) INTO grants_count FROM public.token_grants;
  RAISE NOTICE 'Phase 1 schema migration complete:';
  RAISE NOTICE '  orders.tokens_deducted: % rows backfilled', orders_count;
  RAISE NOTICE '  generation_logs.tokens_charged: % rows backfilled', logs_count;
  RAISE NOTICE '  token_grants: % rows mirrored from credit_grants', grants_count;
END$$;

COMMIT;

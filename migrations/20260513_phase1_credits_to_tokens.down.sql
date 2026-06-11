-- 20260513_phase1_credits_to_tokens.down.sql
-- Removes Phase 1 schema additions. Note: token_grants drops cascade
-- everything; orders.tokens_deducted + generation_logs.tokens_charged
-- get dropped as columns. Application code's dual-writes will fail
-- after this until reverted to credits-only paths.

BEGIN;

DROP INDEX IF EXISTS public.idx_token_grants_invoice;
DROP INDEX IF EXISTS public.idx_token_grants_at;
DROP INDEX IF EXISTS public.idx_token_grants_user_at;
DROP POLICY IF EXISTS "token_grants_admin_full" ON public.token_grants;
DROP POLICY IF EXISTS "token_grants_select_own" ON public.token_grants;
DROP TABLE IF EXISTS public.token_grants;

ALTER TABLE public.generation_logs DROP COLUMN IF EXISTS tokens_charged;
ALTER TABLE public.orders DROP COLUMN IF EXISTS tokens_deducted;

COMMIT;

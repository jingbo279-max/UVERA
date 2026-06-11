-- Rollback the credit_grants audit trail.
DROP POLICY IF EXISTS "credit_grants_admin_full" ON public.credit_grants;
DROP POLICY IF EXISTS "credit_grants_select_own" ON public.credit_grants;
DROP INDEX IF EXISTS idx_credit_grants_user_at;
DROP INDEX IF EXISTS idx_credit_grants_at;
DROP INDEX IF EXISTS idx_credit_grants_invoice;
DROP TABLE IF EXISTS public.credit_grants;

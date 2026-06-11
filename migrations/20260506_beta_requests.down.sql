-- Rollback: drops the beta_requests table and its policies.
DROP POLICY IF EXISTS "beta_requests_admin_full"  ON public.beta_requests;
DROP POLICY IF EXISTS "beta_requests_select_own"  ON public.beta_requests;
DROP POLICY IF EXISTS "beta_requests_insert_own"  ON public.beta_requests;
DROP TABLE IF EXISTS public.beta_requests;

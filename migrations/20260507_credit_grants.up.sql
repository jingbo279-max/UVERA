-- =============================================================================
-- Manual credit-grant audit trail
--
-- Backs the AdminDashboard "Credit Grants" tab. Every time an admin adds
-- credits to a user (e.g. compensating for a Stripe webhook that didn't
-- fire) a row lands here recording who-granted-what-when, optionally
-- linked to a Stripe invoice for reconciliation against the Stripe
-- side ledger.
--
-- Reconciliation flow:
--   1. Admin sees a Stripe payment in dashboard with no matching credit
--   2. Goes to AdminDashboard → Credit Grants → fills the form
--      (target email, amount, tier, Stripe invoice ID)
--   3. Worker /api/admin/grant-credits updates user_metadata + inserts
--      a credit_grants row
--   4. Reconciliation report = LEFT JOIN orders ↔ credit_grants on
--      stripe_invoice_id; mismatches are visible
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.credit_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- granted_by NULL = system (e.g. Stripe webhook). Not NULL = manual admin grant.
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount integer NOT NULL CHECK (amount > 0),
  tier varchar(32), -- optional: also bump tier (free/starter/creator/studio)
  reason text,
  stripe_invoice_id text, -- optional: links a manual grant back to the Stripe charge
  granted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_grants ENABLE ROW LEVEL SECURITY;

-- Admins can see + insert any grant
CREATE POLICY "credit_grants_admin_full" ON public.credit_grants
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Users can see grants targeted at themselves (transparency: "what credits did I get?")
CREATE POLICY "credit_grants_select_own" ON public.credit_grants
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Indexes for the admin UI's two main queries:
--   ORDER BY granted_at DESC for the audit log
--   WHERE stripe_invoice_id = X for reconciliation lookups
CREATE INDEX IF NOT EXISTS idx_credit_grants_user_at
  ON public.credit_grants(user_id, granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_grants_at
  ON public.credit_grants(granted_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_grants_invoice
  ON public.credit_grants(stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;

COMMIT;

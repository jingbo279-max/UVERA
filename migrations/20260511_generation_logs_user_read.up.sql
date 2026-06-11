-- 20260511_generation_logs_user_read.up.sql
-- Adds a per-user SELECT policy on generation_logs so the Wallet page
-- in SettingsPage can query and display each user's own consumption
-- history (e.g. "May 11, Video 480p, -20 tokens, Succeeded").
--
-- Why: the original 20260508_generation_logs migration explicitly
-- marked the table "backend log, not user-facing" with admin-only
-- SELECT (policy generation_logs_admin_full). Now we DO want users to
-- see their own activity — but ONLY their own rows. Admin's policy
-- (broader) and the new self-read policy coexist on the table; either
-- can grant a row.
--
-- Privacy note: rows contain prompt text + request_params (user's own
-- inputs). Exposing these to the row owner is fine — they typed them
-- in. The frontend SELECT in WalletView only pulls a safe column
-- subset (id, generation_type, credits_charged, started_at, status)
-- but the policy authorizes the full row if anything queries it.

BEGIN;

DROP POLICY IF EXISTS "generation_logs_self_read" ON public.generation_logs;
CREATE POLICY "generation_logs_self_read"
  ON public.generation_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;

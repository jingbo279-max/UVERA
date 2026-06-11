-- =============================================================================
-- Migration: strict RLS policies (replace "allow public all access" with
-- per-row authorization)
-- Date: 2026-05-05
-- Severity: 🚨 CRITICAL — pre-migration state leaks all PII (orders, users)
-- and allows any anonymous visitor to wipe all production data via the
-- exposed Supabase anon key. This is the only real protection layer for
-- the database; admin login UI is decoration without it.
--
-- Tables affected:
--   - characters         (was: ALL using true → owner-only + admin)
--   - orders             (was: ALL using true → own-only read, admin write)
--   - recommended_content (was: ALL using true → public read published,
--                          author edit own, admin full)
--   - system_configs     (was: ALL using true → admin only)
--   - users              (was: ALL using true → own profile + admin)
--
-- Already-correct tables (NOT touched):
--   - user_likes, user_saves (already enforce auth.uid() = user_id)
--
-- Execution:
--   Paste into Supabase Dashboard → SQL Editor → Run.
--   Wrapped in BEGIN/COMMIT for atomicity. Includes a pre-flight check
--   that aborts if no admin user exists (prevents lockout).
--
-- Rollback: paired 20260505_strict_rls_policies.down.sql
-- =============================================================================

BEGIN;

-- ── 0. Pre-flight: ensure admin accounts have is_admin flag ─────────────────
-- Without this, applying RLS would lock everyone out of the dashboard.
-- Edit the email list below to match your real admin accounts.

UPDATE auth.users
SET raw_user_meta_data =
  COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
WHERE email IN ('longvv.dev@gmail.com', 'feifeixp@gmail.com');

DO $$
DECLARE
  admin_count int;
BEGIN
  SELECT COUNT(*) INTO admin_count
  FROM auth.users
  WHERE (raw_user_meta_data ->> 'is_admin')::boolean = true;

  IF admin_count = 0 THEN
    RAISE EXCEPTION
      'No admin user found. Aborting RLS migration to prevent lockout. '
      'Either create a Supabase auth user with email longvv.dev@gmail.com '
      'or feifeixp@gmail.com, or edit step 0 above to use the right email.';
  END IF;

  RAISE NOTICE 'Pre-flight OK: % admin user(s) found', admin_count;
END $$;


-- ── 1. Helper: is_admin() reads JWT user_metadata.is_admin ──────────────────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT COALESCE(
    ((auth.jwt() -> 'user_metadata') ->> 'is_admin')::boolean,
    false
  );
$$;


-- ── 2. Drop the dangerous "allow all" policies ──────────────────────────────
DROP POLICY IF EXISTS "Allow public all access to characters"          ON public.characters;
DROP POLICY IF EXISTS "Allow public all access to orders"              ON public.orders;
DROP POLICY IF EXISTS "Allow public all access to recommended_content" ON public.recommended_content;
DROP POLICY IF EXISTS "Allow public all access to system_configs"      ON public.system_configs;
DROP POLICY IF EXISTS "Allow public all access to users"               ON public.users;

-- Defensive: ensure RLS is enabled
ALTER TABLE public.characters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommended_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;


-- ── 3. users — own profile + admin ──────────────────────────────────────────
CREATE POLICY "users_select_own_or_admin" ON public.users
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_admin());

CREATE POLICY "users_insert_own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_admin_full" ON public.users
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 4. orders — own read only, admin full ───────────────────────────────────
-- Real payment confirmations should land via service_role from a backend
-- Edge Function; client-side INSERT is admin-only as a safety floor.
CREATE POLICY "orders_select_own_or_admin" ON public.orders
  FOR SELECT TO authenticated
  USING ("userId" = auth.uid() OR public.is_admin());

CREATE POLICY "orders_admin_full" ON public.orders
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 5. recommended_content — public read published, author edit own ────────
-- Public (anon + authenticated): can SELECT only published rows.
CREATE POLICY "recommended_content_select_published" ON public.recommended_content
  FOR SELECT
  USING (published = true);

-- Authors can read their own (incl. unpublished drafts).
CREATE POLICY "recommended_content_select_own" ON public.recommended_content
  FOR SELECT TO authenticated
  USING (artist = auth.uid()::text);

-- Authors can publish/edit/delete their own work.
CREATE POLICY "recommended_content_insert_own" ON public.recommended_content
  FOR INSERT TO authenticated
  WITH CHECK (artist = auth.uid()::text);

CREATE POLICY "recommended_content_update_own" ON public.recommended_content
  FOR UPDATE TO authenticated
  USING (artist = auth.uid()::text)
  WITH CHECK (artist = auth.uid()::text);

CREATE POLICY "recommended_content_delete_own" ON public.recommended_content
  FOR DELETE TO authenticated
  USING (artist = auth.uid()::text);

-- Admin: full access (sees drafts, edits any work, etc.)
CREATE POLICY "recommended_content_admin_full" ON public.recommended_content
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 6. system_configs — admin only (read + write) ───────────────────────────
-- If a specific key needs to be public, add a targeted policy later.
CREATE POLICY "system_configs_admin_full" ON public.system_configs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ── 7. characters — owner only + admin ──────────────────────────────────────
CREATE POLICY "characters_select_own" ON public.characters
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "characters_insert_own" ON public.characters
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "characters_update_own" ON public.characters
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "characters_delete_own" ON public.characters
  FOR DELETE TO authenticated
  USING (user_id = auth.uid()::text);

CREATE POLICY "characters_admin_full" ON public.characters
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


COMMIT;


-- ── Post-migration verification (read-only, run after COMMIT) ───────────────
-- Expected: every table has policies that scope to auth.uid() / is_admin()
-- and no policy uses `using (true)` except recommended_content_select_published
-- (which is gated by published=true, not unconditional).

-- SELECT tablename, policyname, cmd,
--        COALESCE(qual, '-') AS qual,
--        COALESCE(with_check, '-') AS with_check
-- FROM pg_policies
-- WHERE schemaname='public'
-- ORDER BY tablename, cmd, policyname;

-- SELECT t.table_name, c.relrowsecurity AS rls_enabled
-- FROM information_schema.tables t
-- JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = 'public'::regnamespace
-- WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
-- ORDER BY t.table_name;

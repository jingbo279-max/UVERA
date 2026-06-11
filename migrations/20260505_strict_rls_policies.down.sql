-- =============================================================================
-- Rollback: 20260505_strict_rls_policies.up.sql
--
-- ⚠️ WARNING: This restores the previous "allow public all access" state,
-- which is a CRITICAL data security hole. Use only as an emergency unblock
-- if the strict policies break a production flow you can't fix forward
-- within minutes. Forward-fix is always preferred.
-- =============================================================================

BEGIN;

-- Drop strict policies
DROP POLICY IF EXISTS "users_select_own_or_admin" ON public.users;
DROP POLICY IF EXISTS "users_insert_own"          ON public.users;
DROP POLICY IF EXISTS "users_update_own"          ON public.users;
DROP POLICY IF EXISTS "users_admin_full"          ON public.users;

DROP POLICY IF EXISTS "orders_select_own_or_admin" ON public.orders;
DROP POLICY IF EXISTS "orders_admin_full"          ON public.orders;

DROP POLICY IF EXISTS "recommended_content_select_published" ON public.recommended_content;
DROP POLICY IF EXISTS "recommended_content_select_own"       ON public.recommended_content;
DROP POLICY IF EXISTS "recommended_content_insert_own"       ON public.recommended_content;
DROP POLICY IF EXISTS "recommended_content_update_own"       ON public.recommended_content;
DROP POLICY IF EXISTS "recommended_content_delete_own"       ON public.recommended_content;
DROP POLICY IF EXISTS "recommended_content_admin_full"       ON public.recommended_content;

DROP POLICY IF EXISTS "system_configs_admin_full" ON public.system_configs;

DROP POLICY IF EXISTS "characters_select_own"  ON public.characters;
DROP POLICY IF EXISTS "characters_insert_own"  ON public.characters;
DROP POLICY IF EXISTS "characters_update_own"  ON public.characters;
DROP POLICY IF EXISTS "characters_delete_own"  ON public.characters;
DROP POLICY IF EXISTS "characters_admin_full"  ON public.characters;

DROP FUNCTION IF EXISTS public.is_admin();

-- Restore the dangerous "allow all" policies
CREATE POLICY "Allow public all access to characters"          ON public.characters          FOR ALL USING (true);
CREATE POLICY "Allow public all access to orders"              ON public.orders              FOR ALL USING (true);
CREATE POLICY "Allow public all access to recommended_content" ON public.recommended_content FOR ALL USING (true);
CREATE POLICY "Allow public all access to system_configs"      ON public.system_configs      FOR ALL USING (true);
CREATE POLICY "Allow public all access to users"               ON public.users               FOR ALL USING (true);

COMMIT;

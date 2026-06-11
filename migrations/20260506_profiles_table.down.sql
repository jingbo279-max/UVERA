-- 2026-05-06 — rollback profiles table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
DROP FUNCTION IF EXISTS public.profiles_set_updated_at();
DROP TABLE IF EXISTS public.profiles CASCADE;

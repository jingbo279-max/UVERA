-- 2026-05-06 — public.profiles table mirroring auth.users metadata
-- Motivation: Spark right pane needs to display authors' real avatars,
-- but auth.users RLS blocks cross-user reads. profiles table is a
-- public-readable mirror that holds avatar_url + username for all
-- registered users.
-- Decision authorized by Leon (frontend right pane Phase A: user photo
-- 真实化), backend authority normally Fei but this schema is standard
-- Supabase profiles pattern, low-risk and self-contained.

-- ── 1. Schema ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text,
  avatar_url  text,
  bio         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profiles_username_idx ON public.profiles (username);

-- updated_at auto-touch trigger
CREATE OR REPLACE FUNCTION public.profiles_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_set_updated_at();

-- ── 2. RLS ──────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Anyone can read all profiles (authors' avatars displayed publicly)
DROP POLICY IF EXISTS "profiles_read_public" ON public.profiles;
CREATE POLICY "profiles_read_public"
  ON public.profiles FOR SELECT
  USING (true);

-- Only owner can insert their own row (profile auto-created via trigger
-- but allow manual creation as fallback)
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
CREATE POLICY "profiles_insert_self"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Only owner can update their profile
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Only owner can delete their profile (cascade from auth.users handled
-- by FK ON DELETE CASCADE)
DROP POLICY IF EXISTS "profiles_delete_self" ON public.profiles;
CREATE POLICY "profiles_delete_self"
  ON public.profiles FOR DELETE
  USING (auth.uid() = id);

-- ── 3. Auto-create profile on signup ────────────────────────────────
-- Picks avatar_url / picture / profile_picture_url from raw_user_meta_data
-- (covering Google OAuth, generic OAuth, and self-uploaded avatars).
-- Username falls back through username → name → full_name → email-prefix.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      NEW.raw_user_meta_data->>'name',
      NEW.raw_user_meta_data->>'full_name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture',
      NEW.raw_user_meta_data->>'profile_picture_url'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 4. Backfill existing auth.users → profiles ──────────────────────
INSERT INTO public.profiles (id, username, avatar_url)
SELECT
  u.id,
  COALESCE(
    u.raw_user_meta_data->>'username',
    u.raw_user_meta_data->>'name',
    u.raw_user_meta_data->>'full_name',
    split_part(u.email, '@', 1)
  ) AS username,
  COALESCE(
    u.raw_user_meta_data->>'avatar_url',
    u.raw_user_meta_data->>'picture',
    u.raw_user_meta_data->>'profile_picture_url'
  ) AS avatar_url
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ── 5. Grants ────────────────────────────────────────────────────────
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.profiles TO authenticated;

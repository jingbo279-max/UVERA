-- =============================================================================
-- Series (连载) — multi-episode containers
--
-- A "Series" is a user-created container with title, description, cast
-- (array of character IDs), and an ordered list of episodes. Episodes are
-- stored inline as JSONB rather than a separate table because:
--   - They're tightly coupled to their series (no cross-series queries)
--   - Episode reordering = single jsonb_array op, no row movement
--   - Episode count per series is bounded (typical: 3–20)
-- If we ever need cross-series episode queries (e.g. "all episodes from
-- creator X"), we can promote to a separate table later.
--
-- Lifecycle:
--   draft     — user is editing; not visible to anyone but owner
--   published — visible on user's profile / Discover (v1.1)
--   archived  — owner hid it; not visible anywhere
--
-- v1.0.6 GA scope: only `draft` save is wired up via UI. Publishing is
-- v1.1 candidate; the schema is forward-compatible.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 4000),

  -- Array of character UUIDs from public.characters. We deliberately
  -- DON'T enforce FK because characters can be deleted and we want the
  -- series to survive (with a stale ID we'd render as "[deleted]").
  cast_ids uuid[] NOT NULL DEFAULT '{}',

  -- Ordered episode list. Each entry shape:
  --   { id, title, status, url?, streamUid?, thumbnailUrl? }
  -- where status ∈ {empty, uploading, ready}, and either url+streamUid+
  -- thumbnailUrl (Stream-hosted) or just url (R2-hosted .mp4) is set.
  -- Schema lives in app code (StoryGeneratorPage.jsx); we keep it as
  -- jsonb here for flexibility during the v1.0.6 → v1.1 evolution.
  episodes jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','archived')),

  cover_url text,                  -- optional series cover image (v1.1)
  published_at timestamptz,        -- set when status flipped to 'published'

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- "My series" listing on user's profile / dashboard
CREATE INDEX IF NOT EXISTS idx_series_user_updated
  ON public.series(user_id, updated_at DESC);

-- Public Discover query for published series (v1.1)
CREATE INDEX IF NOT EXISTS idx_series_published
  ON public.series(published_at DESC) WHERE status = 'published';

-- ── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_series_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_series_updated_at ON public.series;
CREATE TRIGGER trg_series_updated_at
  BEFORE UPDATE ON public.series
  FOR EACH ROW EXECUTE FUNCTION public.touch_series_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;

-- Owner has full access to their own series (draft + published + archived)
CREATE POLICY "series_owner_full" ON public.series
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin override
CREATE POLICY "series_admin_full" ON public.series
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- v1.1: anyone can SELECT published series (for Discover):
-- CREATE POLICY "series_public_read" ON public.series
--   FOR SELECT TO anon, authenticated
--   USING (status = 'published');

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'series' ORDER BY ordinal_position;
--
-- SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.series'::regclass;

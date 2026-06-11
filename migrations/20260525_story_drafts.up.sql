-- §2026-05-25 fei: persist creation-flow drafts to Supabase.
--
-- Background: StoryGeneratorPage's auto-save effect writes a snapshot to
-- localStorage every time relevant state changes (transcript, segments,
-- script, etc.). That solves "I refreshed mid-creation" but loses every
-- draft when the user switches device / browser / clears site data.
--
-- This table mirrors the localStorage shape (one row per user per
-- generation_mode) so Library → Drafts can pull from a server source
-- and continuity holds across devices.
--
-- Design choices:
--   · UNIQUE (user_id, generation_mode) — single draft per mode per user.
--     User can have a Quick Mode draft AND a Free Mode draft simultaneously
--     (different rows). Starting a new draft of the same mode overwrites
--     the old one via UPSERT — matches current localStorage one-slot
--     behaviour, no surprises.
--   · `data` JSONB — keeps the schema flexible. Frontend versions the
--     shape, server just stores bytes. Typical row is < 50 KB.
--   · updated_at trigger so Library can sort recent-first.
--   · RLS scopes everything to the row's own user.

BEGIN;

CREATE TABLE IF NOT EXISTS public.story_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation_mode text NOT NULL CHECK (generation_mode IN ('quick', 'free', 'upload', 'series')),
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT story_drafts_user_mode_unique UNIQUE (user_id, generation_mode)
);

CREATE INDEX IF NOT EXISTS idx_story_drafts_user_updated
  ON public.story_drafts (user_id, updated_at DESC);

-- Updated_at auto-bump on UPDATE.
CREATE OR REPLACE FUNCTION public.story_drafts_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_story_drafts_updated_at ON public.story_drafts;
CREATE TRIGGER trg_story_drafts_updated_at
  BEFORE UPDATE ON public.story_drafts
  FOR EACH ROW EXECUTE FUNCTION public.story_drafts_set_updated_at();

-- RLS — own rows only. Anonymous users can't access at all.
ALTER TABLE public.story_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS story_drafts_select_own ON public.story_drafts;
CREATE POLICY story_drafts_select_own ON public.story_drafts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS story_drafts_insert_own ON public.story_drafts;
CREATE POLICY story_drafts_insert_own ON public.story_drafts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS story_drafts_update_own ON public.story_drafts;
CREATE POLICY story_drafts_update_own ON public.story_drafts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS story_drafts_delete_own ON public.story_drafts;
CREATE POLICY story_drafts_delete_own ON public.story_drafts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

COMMIT;

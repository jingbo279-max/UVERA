-- §2026-05-25 fei: rollback for 20260525_story_drafts.up.sql
BEGIN;
DROP TRIGGER IF EXISTS trg_story_drafts_updated_at ON public.story_drafts;
DROP FUNCTION IF EXISTS public.story_drafts_set_updated_at();
DROP TABLE IF EXISTS public.story_drafts;
COMMIT;

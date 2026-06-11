-- =============================================================================
-- Add description column to recommended_content.
--
-- recommended_content was originally a "card with title + cover + video"
-- structure (per the v2 migration on 2026-04-20). When we added
-- 'series' and 'user-upload' content sources in v1.0.6, the publish
-- pipelines tried to write a description field that didn't exist —
-- producing PGRST204 "Could not find the 'description' column" errors
-- when users hit Publish.
--
-- This migration adds the column. Existing rows get NULL (renderers
-- already tolerate missing description — they just skip the
-- description block in the card layout).
-- =============================================================================

BEGIN;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS description text
  CHECK (description IS NULL OR length(description) <= 4000);

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'recommended_content' AND column_name = 'description';
-- -- Expected: 1 row with data_type='text'

-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-31 Leon round-103 Phase B — video download permission.
-- Mirror of migrations/20260531_recommended_content_allow_download.up.sql.
--
-- Adds creator-controlled allow_download flag to recommended_content.
-- Drama (series/episodes) intentionally NOT given the field — paywall model
-- conflicts with viewer downloads; isOwner already covers creator access.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recommended_content.allow_download IS
  'Creator opt-in: lets non-owner viewers download the video via the player''s download icon. Default false (hide button). isOwner gets the button regardless of this flag — implemented in the player caller, not the DB. Drama (series/episodes) intentionally does NOT have this column; it''s hardcoded false in the frontend caller for that path.';

NOTIFY pgrst, 'reload schema';

COMMIT;

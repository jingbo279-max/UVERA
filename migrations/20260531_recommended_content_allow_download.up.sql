-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-31 Leon round-103 Phase B (Claude on fei-side) — video download permission.
--
-- Phase A (Leon main branch): VideoPlayer composite + PlayerActionBar gained
--   showDownload / onDownload props. Default behavior: hidden.
-- Phase B (this migration + frontend/backend wiring):
--   1. recommended_content.allow_download — creator-controlled flag (default OFF)
--   2. StoryGeneratorPage publish flow → toggle in UI, written into insert payload
--   3. LibraryPage work settings → toggle to flip the flag post-publish
--
-- Caller code (Leon's player once round-95~104 lands on main):
--   <VideoPlayer
--     showDownload={isOwner || (work.allow_download === true)}
--     onDownload={() => downloadVideo(work)}
--   />
--
-- ─── Drama (series / episodes) decision: NO equivalent field ────────────
-- The drama paywall product is intentionally NOT given this opt-in. Reasons:
--   1. Letting viewers download drama episodes breaks the paywall model.
--   2. Creators viewing their OWN drama are already covered by isOwner check
--      in the caller — no DB field needed.
--   3. YAGNI — if creators eventually demand it, we can add a column to
--      series/episodes and a per-episode-vs-series policy decision later.
--      Adding now = extra UI + admin moderation surface for no current demand.
-- For drama callers, the frontend hardcodes `allow_download: false` in the
-- props evaluation so the Download button is hidden unless isOwner.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recommended_content.allow_download IS
  'Creator opt-in: lets non-owner viewers download the video via the player''s download icon. Default false (hide button). isOwner gets the button regardless of this flag — implemented in the player caller, not the DB. Drama (series/episodes) intentionally does NOT have this column; it''s hardcoded false in the frontend caller for that path.';

-- No index needed: column is filtered by frontend after the standard
-- creator-page-or-immerse fetch lands, not used as a query predicate.

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- Migration: recommended_content v2
-- Date: 2026-04-20
-- Purpose: Add CTA / Pinned / Publish / media_kind + tags support to the
--          homepage feed (internally named recommended_content).
--
-- Execution method:
--   Paste this file into Supabase Dashboard → SQL Editor → Run.
--   (This project does not use a managed migration framework; SQL is applied
--    manually, same pattern as alter_table.sql.)
--
-- Safety:
--   - All changes are ADDITIVE. No column or index is dropped or altered.
--   - Existing `type` column is preserved as legacy — media_kind is additive.
--   - Safe defaults (NULL or false) ensure existing rows are unaffected until
--     the explicit backfill UPDATE statements below.
--   - Paired with 20260420_recommended_content_v2.down.sql for one-click
--     rollback.
--
-- Rationale for each field: see plan file
--   /Users/sunjingbo/.claude/plans/polished-bubbling-yao.md
-- =============================================================================


-- ── 0. Pre-flight probe (read-only, results visible in SQL Editor) ───────────
-- Run this BEFORE executing the ALTER/UPDATE statements to verify field-name
-- collisions and to evaluate the `type` distribution so you can judge whether
-- the MUSIC/STORY heuristic in step 2 is acceptable.
--
-- (Commented out so the whole file can be pasted & run; uncomment to probe.)
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'recommended_content'
-- ORDER BY ordinal_position;
--
-- SELECT type,
--        COUNT(*) AS total,
--        COUNT(*) FILTER (WHERE video IS NOT NULL) AS has_video,
--        COUNT(*) FILTER (WHERE cover IS NOT NULL) AS has_cover
-- FROM recommended_content
-- GROUP BY type
-- ORDER BY type;


-- ── 1. Schema additions (9 new columns + 1 partial index) ───────────────────

-- CTA (Video + Image types this milestone; Live/Music/Design/Story columns
-- exist but ignored in admin UI until a future milestone)
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS cta_label    varchar(32);
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS cta_url      text;
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS cta_target   varchar(8);   -- '_self' | '_blank' (app-layer enforced)

-- Pinned (operation-controlled top-of-feed ordering)
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS pinned       boolean DEFAULT false;
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS pin_order    integer;

-- Publish control (draft / public toggle)
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS published    boolean;      -- NULL initially; backfilled below
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Classification: media_kind (rendering) + tags (format labels)
-- Title Case chosen deliberately — aligns with next-milestone casing unification.
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS media_kind   varchar(16);  -- 'Video' | 'Image' | 'Live'
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS tags         text[] DEFAULT '{}';

-- Partial index for pinned sort — only indexes rows that are pinned,
-- keeping the index tiny and irrelevant rows out of it.
CREATE INDEX IF NOT EXISTS idx_recommended_content_pinned
  ON public.recommended_content (pinned, pin_order)
  WHERE pinned = true;


-- ── 2. Backfill existing rows (one-shot, idempotent) ────────────────────────

-- 2a. Treat all pre-existing cards as already published so the
-- new WHERE published = true filter doesn't blank the public feed.
UPDATE public.recommended_content
SET published    = true,
    published_at = COALESCE("createdAt", now())
WHERE published IS NULL;

-- 2b. Derive media_kind from legacy `type`.
--     VIDEO/IMAGE/LIVE  → direct mapping (Title Case).
--     DESIGN            → Image (always a still graphic; kept separate from MV bucket).
--     MUSIC/AUDIO       → Video (all music-like content presents as MV per 2026-04-21
--                         pre-flight decision; both categories have cover + audio +
--                         optional video, and render as music-video cards).
--     STORY             → Video if a source video is attached, else Image (narrative
--                         heuristic retained; STORY rows can be either form).
--
-- Pre-flight probe (2026-04-21) counts on production:
--     VIDEO=5, IMAGE=3, AUDIO=2, MUSIC=1, DESIGN=1, STORY=0, LIVE=0 — total 12 rows.
-- MUSIC+AUDIO all have video attached, so explicit 'Video' mapping is accurate.
UPDATE public.recommended_content
SET media_kind = CASE
    WHEN type = 'VIDEO'            THEN 'Video'
    WHEN type = 'IMAGE'            THEN 'Image'
    WHEN type = 'LIVE'             THEN 'Live'
    WHEN type = 'DESIGN'           THEN 'Image'
    WHEN type IN ('MUSIC','AUDIO') THEN 'Video'
    WHEN type = 'STORY' AND video IS NOT NULL THEN 'Video'
    WHEN type = 'STORY' AND video IS NULL     THEN 'Image'
    ELSE 'Image'
END
WHERE media_kind IS NULL;


-- ── 3. Post-migration verification (read-only) ──────────────────────────────
-- Run these after the migration completes to sanity-check the result.
--
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'recommended_content'
-- ORDER BY ordinal_position;
--
-- SELECT published, media_kind, COUNT(*)
-- FROM public.recommended_content
-- GROUP BY published, media_kind
-- ORDER BY published DESC, media_kind;
-- -- Expected: no NULL in either column; every row has published=true and a
-- -- non-null media_kind.

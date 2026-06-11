-- =============================================================================
-- Rollback: recommended_content v2
-- Date: 2026-04-20
-- Pair of: 20260420_recommended_content_v2.up.sql
--
-- Drops the 9 columns + 1 index added by the up migration.
-- Safe to re-run (all statements use IF EXISTS).
-- The legacy `type` column is NOT restored because the up migration never
-- touched it — it was intentionally preserved as legacy.
--
-- After running this, existing cards will have no `published` filter applied
-- (public feed returns all rows as before). The front-end code relies on a
-- fallback: `item.mediaKind ?? mapLegacyType(item.type)`, so rendering still
-- works with just the legacy `type` column.
-- =============================================================================

-- Drop the partial index first (depends on the pinned column).
DROP INDEX IF EXISTS public.idx_recommended_content_pinned;

-- Drop columns in reverse order (order doesn't matter for DROP COLUMN, but
-- keeps this symmetric with the up.sql).
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS tags;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS media_kind;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS published_at;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS published;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS pin_order;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS pinned;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS cta_target;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS cta_url;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS cta_label;


-- ── Post-rollback verification (read-only) ──────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'recommended_content'
-- ORDER BY ordinal_position;
-- -- Expected: the 9 new columns are gone; id/title/artist/cover/video/audio/
-- -- type/aspect_ratio/createdAt/metadata remain.

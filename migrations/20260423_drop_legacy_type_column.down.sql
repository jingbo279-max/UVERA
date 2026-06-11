-- =============================================================================
-- Rollback: restore legacy `type` column on recommended_content
-- Date: 2026-04-23
-- Purpose: Undo 20260423_drop_legacy_type_column.up.sql.
--          Reconstructs the column using inverse of deriveCardMeta (see
--          src/utils/normalizeRecommended.js#VIDEO_META_BY_TAG).
--
-- Note: 只在需要回滚时执行。执行前确认前端也回滚到 5e08399 之前的 commit，
--       否则写回 `type` 后前端仍不会读它（Step 1 的 normalize 层已用 media_kind
--       + tags 派生，不消费 type）。
-- =============================================================================


-- ── 1. Re-add the column (nullable first, backfill, then NOT NULL) ──────────
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS type text;


-- ── 2. Backfill from v2 canonical fields (media_kind + tags[0]) ────────────
-- Mirrors src/utils/normalizeRecommended.js derivation:
--   Live                         → 'LIVE'
--   Image                        → 'IMAGE'
--   Video + '#MV'                → 'MUSIC'
--   Video + '#Trailer'           → 'FILM'
--   Video + '#Vlog'/'#Short Drama'/'#ShortDrama' → 'STORY'
--   Video + '#TVC'/'#Promo'      → 'VIDEO'
--   Video (no/unknown tag)       → 'VIDEO'
UPDATE public.recommended_content
SET type = CASE
    WHEN media_kind = 'Live'  THEN 'LIVE'
    WHEN media_kind = 'Image' THEN 'IMAGE'
    WHEN tags[1] = '#MV'                                        THEN 'MUSIC'
    WHEN tags[1] = '#Trailer'                                   THEN 'FILM'
    WHEN tags[1] IN ('#Vlog', '#Short Drama', '#ShortDrama')    THEN 'STORY'
    WHEN tags[1] IN ('#TVC', '#Promo')                          THEN 'VIDEO'
    ELSE 'VIDEO'
END
WHERE type IS NULL;


-- ── 3. Restore NOT NULL constraint ─────────────────────────────────────────
ALTER TABLE public.recommended_content ALTER COLUMN type SET NOT NULL;

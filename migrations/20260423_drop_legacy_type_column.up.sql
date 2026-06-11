-- =============================================================================
-- Migration: drop legacy `type` column from recommended_content
-- Date: 2026-04-23
-- Purpose: Complete the v2 classification cleanup (Step 2).
--          Step 1 (2026-04-23 commit 5e08399) removed all frontend consumption
--          of the column; this step removes the column itself.
--
-- Execution method:
--   Paste this file into Supabase Dashboard → SQL Editor → Run.
--
-- Safety:
--   - Feifei confirmed 2026-04-21 (docs/asks/2026-04-21-legacy-type-column.md)
--     that no DB function / trigger / view / webhook depends on `type`.
--   - Frontend no longer reads `type` (since commit 5e08399).
--   - Paired with 20260423_drop_legacy_type_column.down.sql for rollback.
--   - Pre-flight probe in step 0 documents current state before drop.
-- =============================================================================


-- ── 0. Pre-flight probe (read-only — run FIRST, uncomment one at a time) ────
-- Verify no dependencies exist before dropping.

-- Check column still exists & its current distribution:
-- SELECT type, COUNT(*) FROM public.recommended_content GROUP BY type ORDER BY type;

-- Confirm no views reference the column:
-- SELECT table_name FROM information_schema.view_column_usage
-- WHERE column_name = 'type' AND table_name = 'recommended_content';

-- Confirm no functions reference the column:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_definition ILIKE '%recommended_content%type%';


-- ── 1. Drop the column ──────────────────────────────────────────────────────
-- Idempotent via IF EXISTS — safe to re-run.
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS type;


-- ── 2. Post-migration verification (read-only) ──────────────────────────────
-- Uncomment to confirm column is gone:
--
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'recommended_content' ORDER BY ordinal_position;
-- -- Expected: no row with column_name = 'type'.

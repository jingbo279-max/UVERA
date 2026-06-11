-- =============================================================================
-- Public read access for published series.
--
-- Without this, the SeriesDetailPage at /series/:id would 404 for anyone
-- who isn't the owner — including signed-out visitors who landed via a
-- shared Discover link. Adding a SELECT policy with `status='published'`
-- USING clause means:
--   - anon users can SELECT published series (Discover detail page)
--   - authenticated users can SELECT published series + their own
--     drafts/archived (existing series_owner_full policy)
--   - owners and admins still see everything (existing policies)
--
-- This was deliberately commented out in 20260508_series.up.sql so that
-- v1.0.6 GA could ship draft-only without exposing public read paths
-- before the SeriesDetailPage existed. Now that the detail page is
-- live, we open it up.
-- =============================================================================

BEGIN;

-- Drop if it already exists from a previous run, then create fresh
DROP POLICY IF EXISTS "series_public_read" ON public.series;

CREATE POLICY "series_public_read" ON public.series
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT polname, polcmd, polroles::regrole[]
-- FROM pg_policy
-- WHERE polrelid = 'public.series'::regclass;
-- -- Expected rows include 'series_public_read' with cmd='r' (SELECT)

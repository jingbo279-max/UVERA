-- Rollback the series feature.
DROP POLICY IF EXISTS "series_owner_full" ON public.series;
DROP POLICY IF EXISTS "series_admin_full" ON public.series;
DROP TRIGGER IF EXISTS trg_series_updated_at ON public.series;
DROP FUNCTION IF EXISTS public.touch_series_updated_at();
DROP INDEX IF EXISTS idx_series_user_updated;
DROP INDEX IF EXISTS idx_series_published;
DROP TABLE IF EXISTS public.series;

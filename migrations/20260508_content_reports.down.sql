DROP POLICY IF EXISTS "content_reports_select_own" ON public.content_reports;
DROP POLICY IF EXISTS "content_reports_admin_full" ON public.content_reports;
DROP TRIGGER IF EXISTS trg_content_reports_updated_at ON public.content_reports;
DROP FUNCTION IF EXISTS public.touch_content_reports_updated_at();
DROP INDEX IF EXISTS idx_content_reports_status;
DROP INDEX IF EXISTS idx_content_reports_target;
DROP INDEX IF EXISTS idx_content_reports_reporter;
DROP TABLE IF EXISTS public.content_reports;

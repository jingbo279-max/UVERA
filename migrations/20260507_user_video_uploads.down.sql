-- Rollback the user_video_uploads admin-review system.
DROP POLICY IF EXISTS "user_video_uploads_select_own" ON public.user_video_uploads;
DROP POLICY IF EXISTS "user_video_uploads_admin_full" ON public.user_video_uploads;
DROP INDEX IF EXISTS idx_user_video_uploads_pending;
DROP INDEX IF EXISTS idx_user_video_uploads_user;
DROP TABLE IF EXISTS public.user_video_uploads;

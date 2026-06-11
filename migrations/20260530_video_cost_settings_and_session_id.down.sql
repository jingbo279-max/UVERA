-- Reverse of 20260530_video_cost_settings_and_session_id.up.sql
--
-- Drop the column + index. Preserve system_settings rows — admin may have
-- customized the values; preserving on rollback is safer than re-seeding.

BEGIN;

DROP INDEX IF EXISTS public.idx_generation_logs_render_session;

ALTER TABLE public.generation_logs
  DROP COLUMN IF EXISTS render_session_id;

NOTIFY pgrst, 'reload schema';

COMMIT;

BEGIN;
ALTER TABLE public.generation_logs
  DROP COLUMN IF EXISTS actual_completion_tokens,
  DROP COLUMN IF EXISTS actual_video_duration_seconds,
  DROP COLUMN IF EXISTS cost_basis,
  DROP COLUMN IF EXISTS byteplus_response;
-- Preserve system_settings rows on rollback (admin may have customized them).
NOTIFY pgrst, 'reload schema';
COMMIT;

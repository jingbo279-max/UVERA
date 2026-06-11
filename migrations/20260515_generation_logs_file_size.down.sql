-- 20260515_generation_logs_file_size.down.sql
-- 回滚 file_size_bytes 列。已记录的 size 数据会丢失。

BEGIN;

DROP INDEX IF EXISTS public.generation_logs_file_size_idx;

ALTER TABLE public.generation_logs
  DROP COLUMN IF EXISTS file_size_bytes;

NOTIFY pgrst, 'reload schema';

COMMIT;

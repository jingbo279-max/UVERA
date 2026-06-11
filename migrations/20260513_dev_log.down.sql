-- 20260513_dev_log.down.sql
DROP TRIGGER IF EXISTS dev_log_entries_updated_at ON public.dev_log_entries;
DROP FUNCTION IF EXISTS public.dev_log_entries_set_updated_at;
DROP TABLE IF EXISTS public.dev_log_entries;

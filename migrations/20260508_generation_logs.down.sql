-- Rollback the generation_logs table.
DROP POLICY IF EXISTS "generation_logs_admin_full" ON public.generation_logs;
DROP INDEX IF EXISTS idx_generation_logs_started_at;
DROP INDEX IF EXISTS idx_generation_logs_user;
DROP INDEX IF EXISTS idx_generation_logs_status;
DROP INDEX IF EXISTS idx_generation_logs_task;
DROP INDEX IF EXISTS idx_generation_logs_cost_window;
DROP TABLE IF EXISTS public.generation_logs;

-- §2026-05-25 fei — rollback for 20260525_drama_acquisition_costs.up.sql
BEGIN;
DROP TABLE IF EXISTS public.series_acquisition_costs;
UPDATE public.system_settings SET value = 'false' WHERE key = 'default_include_acquisition_cost';
COMMIT;

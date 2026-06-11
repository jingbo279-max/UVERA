-- Revert the v1.0.7 extension of generation_logs.
DROP INDEX IF EXISTS idx_generation_logs_endpoint;

ALTER TABLE public.generation_logs DROP CONSTRAINT IF EXISTS generation_logs_generation_type_check;
ALTER TABLE public.generation_logs ADD CONSTRAINT generation_logs_generation_type_check
  CHECK (generation_type IN ('video', 'concept_image', 'script', 'asset_describe'));

ALTER TABLE public.generation_logs
  DROP COLUMN IF EXISTS endpoint,
  DROP COLUMN IF EXISTS request_params,
  DROP COLUMN IF EXISTS http_status,
  DROP COLUMN IF EXISTS response_size_bytes;

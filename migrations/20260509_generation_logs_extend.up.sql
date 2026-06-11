-- =============================================================================
-- Extend generation_logs to capture every AI API call, not just video.
--
-- Original 20260508_generation_logs.up.sql shipped only with video generation
-- in mind. v1.0.7 expanded what we want to track:
--   - concept image generation (Gemini)
--   - script generation (Neodomain LLM)
--   - prompt optimization
--   - random ideas
--   - asset description
--   - any future AI / paid endpoint
--
-- Added columns:
--   endpoint             — the actual route hit (e.g. '/api/generate-concept-image')
--   request_params       — full sanitized request body / query (JSONB)
--   http_status          — HTTP status code returned to client
--   response_size_bytes  — size of response body for cost / health analysis
--
-- The existing CHECK constraint on generation_type already includes
-- 'video' / 'concept_image' / 'script' / 'asset_describe' — extended further
-- below to include 'optimize_prompt' / 'random_ideas' / 'user_video_upload' /
-- 'admin_grant_credits'.
-- =============================================================================

BEGIN;

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS endpoint text,
  ADD COLUMN IF NOT EXISTS request_params jsonb,
  ADD COLUMN IF NOT EXISTS http_status int,
  ADD COLUMN IF NOT EXISTS response_size_bytes int;

-- Drop + recreate the type enum check so older rows keep validating but
-- new types are accepted. Using DROP + ADD CHECK rather than altering in
-- place because Postgres has no syntax to mutate a check constraint.
ALTER TABLE public.generation_logs DROP CONSTRAINT IF EXISTS generation_logs_generation_type_check;
ALTER TABLE public.generation_logs ADD CONSTRAINT generation_logs_generation_type_check
  CHECK (generation_type IN (
    'video',
    'concept_image',
    'script',
    'asset_describe',
    'optimize_prompt',
    'random_ideas',
    'user_video_upload',
    'admin_grant_credits'
  ));

-- Index endpoint for "which API got the most calls today" admin queries.
CREATE INDEX IF NOT EXISTS idx_generation_logs_endpoint
  ON public.generation_logs(endpoint, started_at DESC) WHERE endpoint IS NOT NULL;

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'generation_logs'
--   AND column_name IN ('endpoint', 'request_params', 'http_status', 'response_size_bytes');
-- -- Expected: 4 rows.
--
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.generation_logs'::regclass
--   AND conname = 'generation_logs_generation_type_check';
-- -- Should show the 8-value enum.

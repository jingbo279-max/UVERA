-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-31 fei — cost_usd 仍不准 (round-2 fix).
-- Mirror of migrations/20260531_video_actual_usage.up.sql (archive copy).
--
-- Bug remaining after 2026-05-30 fix: cost_usd was estimated from REQUESTED
--   duration + flat per-sec rate. Never read BytePlus's actual usage in the
--   task status response.
--
-- Adds actual_completion_tokens + actual_video_duration_seconds + cost_basis
--   + byteplus_response columns and token-rate settings so worker can
--   reconcile cost_usd with actual BytePlus billing on status-poll terminal.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS actual_completion_tokens     bigint
    CHECK (actual_completion_tokens IS NULL OR actual_completion_tokens >= 0),
  ADD COLUMN IF NOT EXISTS actual_video_duration_seconds numeric
    CHECK (actual_video_duration_seconds IS NULL OR actual_video_duration_seconds >= 0),
  ADD COLUMN IF NOT EXISTS cost_basis text
    CHECK (cost_basis IS NULL OR cost_basis IN ('estimate', 'actual')),
  ADD COLUMN IF NOT EXISTS byteplus_response jsonb;

COMMENT ON COLUMN public.generation_logs.actual_completion_tokens IS
  'Completion tokens reported by BytePlus Ark in the task status response (usage.completion_tokens or usage.total_tokens). NULL until status poll lands. True BytePlus billing unit for Seedance 2.0.';

COMMENT ON COLUMN public.generation_logs.actual_video_duration_seconds IS
  'Actual rendered video duration reported by BytePlus (content.duration or content.video.duration). May differ from requested duration_seconds. NULL until status poll lands.';

COMMENT ON COLUMN public.generation_logs.cost_basis IS
  'estimate = cost_usd from rate table × requested duration × multiplier. actual = cost_usd reconciled from BytePlus actual usage × per-million-token rate.';

COMMENT ON COLUMN public.generation_logs.byteplus_response IS
  'Raw BytePlus task status response payload (debug + future reparse). NULL for older rows + non-Seedance endpoints.';

INSERT INTO public.system_settings (key, value, description, is_secret) VALUES
  (
    'seedance_fast_usd_per_million_tokens',
    '',
    'BytePlus Seedance 2.0 Fast token rate in USD per million completion tokens. SET from actual BytePlus invoice to enable token-based cost_basis=actual reconciliation. Empty = keep per-second estimate.',
    false
  ),
  (
    'seedance_standard_usd_per_million_tokens',
    '',
    'BytePlus Seedance 2.0 Standard token rate in USD per million completion tokens. Empty = keep per-second estimate.',
    false
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

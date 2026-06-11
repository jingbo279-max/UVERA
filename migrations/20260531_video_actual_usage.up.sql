-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-31 fei — cost_usd 仍不准 (round-2 fix)
--
-- Problem: Even after 2026-05-30 Bug 1+2 fix (model multiplier + admin-tunable
--   rates), admin's cost_usd column for video rows is still ESTIMATED from
--   the REQUESTED duration + flat per-sec rate. It never reads BytePlus's
--   actual response, which contains:
--     · usage.total_tokens / usage.completion_tokens (true billing unit)
--     · content.duration (actual rendered seconds, may differ from requested)
--
-- Solution:
--   1. Add actual_* columns: actual_completion_tokens, actual_video_duration_seconds
--   2. Add cost_basis text column ('estimate' | 'actual') so admin can tell
--      at a glance whether the row's cost_usd was reconciled with BytePlus
--      reality or is still the pre-render estimate
--   3. Add raw BytePlus response JSONB column (byteplus_response) so future
--      regressions in the parse path are debuggable without re-querying
--   4. Seed seedance_*_usd_per_million_tokens settings — when present + a
--      row has actual_completion_tokens, worker recomputes cost_usd using
--      token-based math (matches BytePlus's actual billing model)
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
  'Completion tokens reported by BytePlus Ark in the task status response (usage.completion_tokens or usage.total_tokens). NULL until status poll lands. This is the TRUE BytePlus billing unit for Seedance 2.0.';

COMMENT ON COLUMN public.generation_logs.actual_video_duration_seconds IS
  'Actual rendered video duration as reported by BytePlus (content.duration or content.video.duration). May differ from the requested duration_seconds (e.g. BytePlus rounds or trims). NULL until status poll lands.';

COMMENT ON COLUMN public.generation_logs.cost_basis IS
  'estimate = cost_usd was computed at submit time from the rate table (resolution × requested duration × model multiplier). actual = cost_usd was recomputed from BytePlus actual_completion_tokens × per-million-token rate. Admin UI can show a badge so you can tell at a glance which rows are reconciled.';

COMMENT ON COLUMN public.generation_logs.byteplus_response IS
  'Raw BytePlus task status response payload. Stored so future cost-parse regressions are debuggable without re-querying BytePlus. NULL for older rows + non-Seedance endpoints.';

-- Token-based pricing settings. When set + actual_completion_tokens is
--   populated, worker uses token-based math (matches BytePlus's actual
--   billing model) instead of the per-second estimate. Leave NULL/unset
--   to keep using the per-second estimate (current behavior).
-- Default values are placeholders — admin must verify with their actual
--   BytePlus invoice + override via System Settings panel.
INSERT INTO public.system_settings (key, value, description, is_secret) VALUES
  (
    'seedance_fast_usd_per_million_tokens',
    '',
    'BytePlus Seedance 2.0 Fast token rate in USD per million completion tokens. SET this from your actual BytePlus invoice to enable token-based cost_basis="actual" reconciliation. Empty = use per-second estimate (current behavior).',
    false
  ),
  (
    'seedance_standard_usd_per_million_tokens',
    '',
    'BytePlus Seedance 2.0 Standard token rate in USD per million completion tokens. Same semantics as the Fast key. Empty = use per-second estimate.',
    false
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-26 fei — Accurate per-call cost tracking for generation_logs.
--
-- Problem (root cause of fei's complaint "Generation Logs 的价格 USD 不对"):
--   All LLM-based endpoints (random_ideas, optimize_prompt, multi-segment
--   script, describe-image, expand-character, etc.) currently hardcode
--   `cost_usd: 0.0001` regardless of how many tokens the call actually
--   used. With Gemini 3 Flash @ $0.075/M input + $0.30/M output, a
--   single multi-segment script call (~3K input + ~2K output) really
--   costs ~$0.00083 — 8× the placeholder. At fleet scale we're flying
--   blind on real LLM spend.
--
-- Solution:
--   1. Add input_tokens / output_tokens columns (NULL-safe, additive).
--   2. Worker parses usageMetadata.promptTokenCount + candidatesTokenCount
--      from Gemini responses (and equivalent fields for other vendors)
--      and writes them to these columns alongside cost_usd.
--   3. Worker computes cost_usd from per-model per-million-token rates
--      configurable via system_settings (so price changes don't need
--      a redeploy).
--   4. Admin "Generation Logs" UI can now show token counts + accurate
--      cost; Phase-1 backend ROI dashboards can compute real margin.
--
-- Backfill (separate migration / SQL operator script): for old rows
--   where we don't have stored token counts, leave NULL — those rows
--   keep their (likely incorrect) cost_usd placeholder rather than
--   show a fake recomputed value.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Both nullable: existing rows + non-LLM endpoints (video, image) stay NULL.
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS input_tokens  integer
    CHECK (input_tokens IS NULL OR input_tokens >= 0);

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS output_tokens integer
    CHECK (output_tokens IS NULL OR output_tokens >= 0);

COMMENT ON COLUMN public.generation_logs.input_tokens IS
  'Token count for input/prompt side of the LLM call (Gemini promptTokenCount, OpenAI prompt_tokens). NULL for non-LLM endpoints (video, image-gen) or pre-2026-05-26 rows.';

COMMENT ON COLUMN public.generation_logs.output_tokens IS
  'Token count for output/completion side of the LLM call (Gemini candidatesTokenCount, OpenAI completion_tokens). NULL for non-LLM endpoints or pre-2026-05-26 rows.';

-- Index for fleet-level analytics: "total tokens spent on Gemini this month"
-- queries can use this without a full seq scan.
CREATE INDEX IF NOT EXISTS idx_generation_logs_tokens
  ON public.generation_logs (vendor, created_at)
  WHERE input_tokens IS NOT NULL OR output_tokens IS NOT NULL;

-- ── Seed default LLM token prices into system_settings ──────────────────────
-- Per-million-token rates (USD). Worker reads these; admin can override via
-- /admin/dashboard → Settings tab without a redeploy when prices move.
-- Source: https://ai.google.dev/pricing + https://openai.com/api/pricing
--
-- gemini-3-flash-preview: $0.075/M input, $0.30/M output (text-only)
-- gemini-3-pro:           $1.25/M input, $5.00/M output
-- gpt-4o-mini:            $0.15/M input, $0.60/M output
-- gpt-image-2 LOW:        ~$0.011 / image (already handled per-image)
-- value is TEXT not JSONB in this schema — store as JSON string. Worker
-- parses with JSON.parse on read (see getSystemSetting in _worker.js).
INSERT INTO public.system_settings (key, value, description)
VALUES (
  'llm_token_prices',
  '{"gemini-3-flash-preview":{"input_per_million_usd":0.075,"output_per_million_usd":0.30},"gemini-3-flash":{"input_per_million_usd":0.075,"output_per_million_usd":0.30},"gemini-3.1-flash":{"input_per_million_usd":0.075,"output_per_million_usd":0.30},"gemini-3-pro":{"input_per_million_usd":1.25,"output_per_million_usd":5.00},"gemini-2.0-flash":{"input_per_million_usd":0.075,"output_per_million_usd":0.30},"default":{"input_per_million_usd":0.10,"output_per_million_usd":0.40}}',
  'LLM token pricing per million tokens. Worker uses for cost_usd calc on text-gen endpoints. Update without redeploy when vendor prices change.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;

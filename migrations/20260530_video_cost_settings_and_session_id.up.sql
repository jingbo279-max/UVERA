-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-30 fei — admin cost_usd display bugs (4 in total)
--
-- Bug 1: Video cost_usd missed model multiplier (Standard charged 1.5x credits
--        but cost_usd same as Fast → admin saw inflated margin on Standard).
-- Bug 2: Cost rates were hardcoded constants ("estimates calibrated as of
--        2026-05; revise quarterly") instead of admin-tunable settings.
-- Bug 3: Character board cost_usd=$0.042 but credits_charged=NULL (subsidized).
--        Admin couldn't tell "subsidized item" from "logging bug" at a glance.
-- Bug 4: No render_session_id — admin couldn't see total cost of one
--        Quick-Mode render (1 char board + 1 storyboard + N video logs).
--
-- This migration handles Bugs 1+2+4 (Bug 3 is purely UI).
--   · render_session_id column + index (Bug 4)
--   · Seed video_cost_usd_per_sec_{480p,720p,1080p} settings (Bug 2)
--   · Seed seedance_*_cost_multiplier settings (Bug 1 — multipliers were
--     already read by worker but never exposed in admin UI metadata).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── render_session_id column ────────────────────────────────────────────────
-- Nullable: older rows + future non-Quick endpoints stay NULL safely.
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS render_session_id text;

COMMENT ON COLUMN public.generation_logs.render_session_id IS
  'UUID grouping all logs from one Quick-Mode render (character_board + storyboard_image + N video segments). NULL for older rows or non-Quick endpoints. Admin can aggregate cost/credit by session for one-render-total view.';

-- Partial index — most rows have NULL session id, no point indexing them.
CREATE INDEX IF NOT EXISTS idx_generation_logs_render_session
  ON public.generation_logs (render_session_id, started_at)
  WHERE render_session_id IS NOT NULL;

-- ── system_settings seeds ───────────────────────────────────────────────────
-- Video cost USD/sec: was hardcoded in worker (COST_USD_PER_SECOND constant);
--   now admin-tunable so quarterly BytePlus price changes don't need a redeploy.
-- Multiplier keys: already READ by worker (computeVideoCost, /api/video-models)
--   but never SEEDED with description metadata. Seeding now so they appear in
--   admin System Settings panel alongside the related cost rates.
INSERT INTO public.system_settings (key, value, description, is_secret) VALUES
  (
    'video_cost_usd_per_sec_480p',
    '0.015',
    'Estimated BytePlus Seedance USD cost per second for 480p video output. Used for admin generation_logs.cost_usd. Multiplied by the model''s cost multiplier (Fast=1.0 / Standard=1.5) automatically. Calibrated 2026-05; revisit when BytePlus pricing changes.',
    false
  ),
  (
    'video_cost_usd_per_sec_720p',
    '0.025',
    'Estimated BytePlus Seedance USD cost per second for 720p video output. Same multiplier semantics as 480p key.',
    false
  ),
  (
    'video_cost_usd_per_sec_1080p',
    '0.06',
    'Estimated BytePlus Seedance USD cost per second for 1080p video output. Same multiplier semantics as 480p key.',
    false
  ),
  (
    'seedance_fast_cost_multiplier',
    '1.0',
    'Cost multiplier for Seedance 2.0 Fast model. Applied to BOTH user-facing token cost AND admin cost_usd column. Default 1.0.',
    false
  ),
  (
    'seedance_standard_cost_multiplier',
    '1.5',
    'Cost multiplier for Seedance 2.0 Standard model. Applied to BOTH user-facing token cost AND admin cost_usd column. Default 1.5 (Standard uses roughly 1.5x BytePlus compute vs Fast).',
    false
  )
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;

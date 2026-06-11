-- =============================================================================
-- Detailed generation log for cost analysis + future pricing decisions.
--
-- Captures every Volcengine (Seedance) video generation: who, when, what
-- they asked for, how long it took, what it cost us in API fees, what we
-- charged the user in credits. Powers the AdminDashboard "Generation Logs"
-- tab + CSV export for offline finance analysis.
--
-- Lifecycle:
--   /api/volcengine/video/submit  → INSERT row with status='started',
--                                    started_at=now(), all input params
--   /api/volcengine/video/status  → UPDATE on first poll where upstream
--                                    returns 'succeeded' or 'failed':
--                                    set finished_at, duration_ms, status,
--                                    output_url, error_message
--   (subsequent polls no-op via WHERE status='started')
--
-- Cost computation:
--   cost_usd = duration_seconds * COST_RATE[resolution]
--   Rates are intentionally hardcoded in the Worker, not in this table —
--   if we ever need to replay historical cost with new rates, we can
--   recompute from the immutable inputs (resolution + duration_seconds).
--
-- This is a *backend log*, not user-facing. RLS is admin-only.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.generation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who. user_id NULL = anonymous / unauthenticated submit (shouldn't
  -- happen in normal flow but we don't want to lose log lines).
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,    -- denormalized for fast admin filtering / CSV export

  -- What kind of generation. v1: only video. Future: 'concept_image',
  -- 'script', 'asset_describe' etc — schema is forward-compatible.
  generation_type text NOT NULL DEFAULT 'video'
    CHECK (generation_type IN ('video','concept_image','script','asset_describe')),
  vendor text NOT NULL DEFAULT 'volcengine'
    CHECK (vendor IN ('volcengine','gemini','neodomain','cloudflare')),
  model text,                -- e.g. 'ep-20260423195810-cx7nc' (Seedance fast)
  task_id text,              -- BytePlus / vendor task ID, lets us correlate later

  -- Output spec — what user asked for
  resolution text,           -- '480p' | '720p' | '1080p'
  duration_seconds int,
  ratio text,                -- '16:9' | '9:16' | '1:1' | etc
  generate_audio boolean,

  -- Inputs / references — what user supplied
  prompt text,
  prompt_length int,                                -- chars; helpful for spotting outliers
  reference_image_count int NOT NULL DEFAULT 0,
  has_video_reference boolean NOT NULL DEFAULT false,

  -- Money
  credits_charged int,                              -- what user paid (business)
  cost_usd numeric(10,4),                           -- our API spend (estimated from rate table)

  -- Lifecycle
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started','succeeded','failed','timeout')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms int,                                  -- finished_at - started_at (in ms)
  output_url text,                                  -- final R2 URL when succeeded
  error_message text,                               -- when failed

  -- Diagnostics
  client_ip inet,
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes for the admin queries we know we'll do ─────────────────────────
-- Default sort: most recent first
CREATE INDEX IF NOT EXISTS idx_generation_logs_started_at
  ON public.generation_logs(started_at DESC);

-- "Show me X user's history"
CREATE INDEX IF NOT EXISTS idx_generation_logs_user
  ON public.generation_logs(user_id, started_at DESC);

-- "Show me failed generations" / "show me running ones"
CREATE INDEX IF NOT EXISTS idx_generation_logs_status
  ON public.generation_logs(status, started_at DESC);

-- Look up a row by upstream task_id (for status update on poll)
CREATE INDEX IF NOT EXISTS idx_generation_logs_task
  ON public.generation_logs(task_id) WHERE task_id IS NOT NULL;

-- Time-bucketed cost analysis: "what did we spend in last 30 days?"
CREATE INDEX IF NOT EXISTS idx_generation_logs_cost_window
  ON public.generation_logs(started_at DESC) WHERE status = 'succeeded';

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.generation_logs ENABLE ROW LEVEL SECURITY;

-- Admin-only. Users do NOT need to read this (their credits balance lives
-- on user_metadata; if we want a user-facing history we'll add it later
-- via a separate view / endpoint to avoid leaking cost_usd).
CREATE POLICY "generation_logs_admin_full" ON public.generation_logs
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Worker uses service_role to insert/update, which bypasses RLS — that's
-- intended (logging must be unblockable by RLS edge cases).

COMMIT;

-- ── Verify (run separately) ────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'generation_logs' ORDER BY ordinal_position;
--
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.generation_logs'::regclass;

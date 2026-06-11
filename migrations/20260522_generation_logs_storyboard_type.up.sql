-- 20260522_generation_logs_storyboard_type.up.sql
--
-- §2026-05-22 fei: admin Logs tab 少了 GPT-image-2 的记录。
--
-- Root cause: worker's /api/generate-storyboard calls
--   logApiStart(env, request, 'storyboard_image', ...)
-- but the CHECK constraint added in 20260509_generation_logs_extend doesn't
-- include 'storyboard_image' — only 8 legacy values. Postgres rejects every
-- INSERT with constraint violation; logApiStart's fail-open catch swallows
-- the error and returns null. → ZERO storyboard log rows ever written.
--
-- 9b53b36 (first storyboard pipeline commit, 2026-05-21) added the
-- 'storyboard_image' literal in the worker but never extended this
-- constraint. The bug has been silent for the whole storyboard pipeline
-- lifetime.
--
-- Fix: DROP + ADD CHECK with the new value included. Same pattern as
-- 20260509 (Postgres has no "ALTER CHECK ADD VALUE" syntax).
--
-- Idempotent — if storyboard_image is already in the constraint (e.g.,
-- manual fix), DROP+ADD just no-ops.

BEGIN;

-- ── generation_type ────────────────────────────────────────────────────────
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
    'admin_grant_credits',
    -- §2026-05-21 GPT-image-2 storyboard pipeline (commit 9b53b36)
    -- §2026-05-22 constraint extension (this migration)
    'storyboard_image'
  ));

-- ── vendor ────────────────────────────────────────────────────────────────
-- §2026-05-22 fei: same class of silent bug — worker uses vendor='openai'
-- for storyboard gen but old CHECK only allowed volcengine/gemini/neodomain/
-- cloudflare. Every storyboard INSERT would have been rejected by BOTH
-- constraints (generation_type AND vendor) even if I'd only fixed
-- generation_type. Fix both atomically in this migration.
ALTER TABLE public.generation_logs DROP CONSTRAINT IF EXISTS generation_logs_vendor_check;
ALTER TABLE public.generation_logs ADD CONSTRAINT generation_logs_vendor_check
  CHECK (vendor IS NULL OR vendor IN (
    'volcengine',
    'gemini',
    'neodomain',
    'cloudflare',
    -- §2026-05-21 OpenAI for GPT-image-2 storyboard pipeline
    'openai'
  ));

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.generation_logs'::regclass
--   AND conname = 'generation_logs_generation_type_check';
-- -- Should show 9 values, with 'storyboard_image' last.
--
-- Backfill check (logs that SHOULD exist but were rejected):
-- SELECT generation_type, COUNT(*) FROM public.generation_logs
-- WHERE generation_type = 'storyboard_image'
-- GROUP BY generation_type;
-- -- Pre-migration: 0 rows. After migration runs + new gens fire, should grow.
-- -- Historical storyboard gens are LOST — no way to recover them.

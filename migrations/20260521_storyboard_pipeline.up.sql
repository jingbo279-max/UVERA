-- 20260521_storyboard_pipeline.up.sql
-- 新 image-gen 管道：GPT-image-2 (OpenAI) one-shot 替换 Gemini 旧 concept design
-- 流程：NeoAI Script → GPT-image-2 (style+character+storyboard 全在 prompt) →
--      Seedance image-to-video (极简 prompt) → 短片
--
-- 这次 migration 包含：
--   1. system_settings 加 OpenAI 配置 keys (1 secret + 3 public)
--   2. generation_logs 加 storyboard 元数据列
--   3. system_settings 加 feature flag (use_storyboard_pipeline) 灰度切换/回滚开关
--
-- 不影响旧 flow：feature flag 默认 false → 走旧 Gemini concept design；admin
-- 在 UI 翻 true → 走新 GPT-image-2 storyboard。Risk 可控。

BEGIN;

-- 0. Allow NULL on value column (Phase A defense — the old NOT NULL was a
--    legacy assumption when only public settings existed. Now that we have
--    secrets that admin fills via UI on first use, NULL ≡ "not configured
--    yet" is a valid state distinct from "" empty string).
--    Safe: drops NOT NULL only; existing rows with non-null values unaffected.
ALTER TABLE public.system_settings
  ALTER COLUMN value DROP NOT NULL;

-- 1. system_settings non-secret defaults (secret openai_api_key NOT seeded
--    here — admin creates the row on first save in UI. Worker GET endpoint
--    synthesizes a "not configured" placeholder via ALL_KNOWN_KEYS).
INSERT INTO public.system_settings (key, value, description, is_secret) VALUES
  (
    'openai_image_model',
    'gpt-image-2',
    'OpenAI image model name. Default: gpt-image-2 (fei 2026-05-21). Fallback options: gpt-image-1, dall-e-3. Switch via admin UI for instant rollback if model unavailable.',
    false
  ),
  (
    'openai_image_quality',
    'hd',
    'Image quality: standard ($0.04/1024px) | hd ($0.17/1792px, recommended — cinematic bias trigger per 草帽小蔡).',
    false
  ),
  (
    'openai_image_size',
    '1792x1024',
    'Output size. 1792x1024 (cinematic 16:9) is default — per 草帽小蔡, wide-format triggers GPT cinematic bias and reduces fragmented detail. Other options: 1024x1024, 1024x1792 (vertical).',
    false
  ),
  (
    'use_storyboard_pipeline',
    'true',
    'Feature flag: true → GPT-image-2 storyboard pipeline (DEFAULT since 2026-05-22 per fei — promoted from "opt-in trial" to canonical flow after admin connectivity test passed). false → legacy Gemini concept-image flow as rollback path. Frontend session-cached — page reload picks up new value.',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- 2. generation_logs 加 storyboard 元数据
ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS storyboard_image_url text,
  ADD COLUMN IF NOT EXISTS storyboard_reference_url text,
  ADD COLUMN IF NOT EXISTS storyboard_prompt_summary text;

COMMENT ON COLUMN public.generation_logs.storyboard_image_url IS
  'R2 URL of the GPT-image-2 storyboard key frame output. NULL for legacy concept-image flow OR non-storyboard gens (text/etc).';
COMMENT ON COLUMN public.generation_logs.storyboard_reference_url IS
  'R2 URL of the input reference image used as sequel/continuation anchor. NULL for first-time generations.';
COMMENT ON COLUMN public.generation_logs.storyboard_prompt_summary IS
  'First 500 chars of the full prompt sent to GPT-image-2. For debugging + audit.';

NOTIFY pgrst, 'reload schema';

COMMIT;

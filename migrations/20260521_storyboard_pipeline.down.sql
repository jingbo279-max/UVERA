-- 20260521_storyboard_pipeline.down.sql
-- 回滚 storyboard pipeline migration。已配置的 OpenAI key + 历史 storyboard
-- 元数据会丢失。

BEGIN;

DELETE FROM public.system_settings WHERE key IN (
  'openai_api_key',
  'openai_image_model',
  'openai_image_quality',
  'openai_image_size',
  'use_storyboard_pipeline'
);

ALTER TABLE public.generation_logs
  DROP COLUMN IF EXISTS storyboard_image_url,
  DROP COLUMN IF EXISTS storyboard_reference_url,
  DROP COLUMN IF EXISTS storyboard_prompt_summary;

NOTIFY pgrst, 'reload schema';

COMMIT;

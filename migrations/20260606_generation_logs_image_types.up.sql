-- 20260606_generation_logs_image_types.up.sql  (历史归档副本)
--
-- 见 supabase/migrations/20260606000001_generation_logs_image_types.sql。
-- CLI push 用 supabase/migrations 版本;本文件为旧路径归档(CLAUDE.md 约定:两份)。
--
-- §2026-06-06 fei — 扩展 generation_logs.generation_type CHECK,加入:
--   · 'freemode_image'  — Free Mode 纯多模态出图 /api/generate-image
--   · 'character_board'  — 补 5/25 起一直被 CHECK 静默拒绝的角色设定图日志
--
-- 模式同 20260522_generation_logs_storyboard_type(DROP + ADD,幂等)。

BEGIN;

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
    'storyboard_image',   -- §2026-05-21 GPT-image-2 storyboard pipeline
    'character_board',    -- §2026-06-06 fix latent silent-reject (logged since 5/25)
    'freemode_image'      -- §2026-06-06 Free Mode multimodal image gen (/api/generate-image)
  ));

COMMIT;

-- 20260606000001_generation_logs_image_types.sql
--
-- §2026-06-06 fei — 扩展 generation_logs.generation_type CHECK 约束,加入两个图像类型:
--
--   1. 'freemode_image' — Free Mode 纯多模态出图新端点 /api/generate-image
--      (修复:Free Mode 出图过去复用 /api/generate-storyboard,被故事板系统
--       提示词覆盖,产出角色故事板而非按用户图+文出的图)。
--
--   2. 'character_board' — /api/generate-character-board 自 2026-05-25 起就用
--      logApiStart(env, request, 'character_board', ...) 记日志,但 CHECK 约束
--      从未包含它 → 每条 INSERT 被 Postgres 拒绝,logApiStart 的 fail-open catch
--      吞掉错误返回 null → 角色设定图的成本/用量日志从来没写进去过(latent bug,
--      与 5/22 storyboard_image 完全同类)。本次一并补上。
--
-- 模式同 20260522_generation_logs_storyboard_type:Postgres 无 "ALTER CHECK ADD
-- VALUE" 语法,只能 DROP + ADD。幂等 —— 已含这两个值则 DROP+ADD no-op。
-- 必须列全所有现存值,否则会误删旧枚举。

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

-- ── Verify ──────────────────────────────────────────────────────────────────
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.generation_logs'::regclass
--   AND conname = 'generation_logs_generation_type_check';
-- -- Should list 11 values, ending in 'freemode_image'.

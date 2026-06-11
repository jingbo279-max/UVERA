-- =============================================================================
-- Migration ROLLBACK: Branch / Recast 授权字段 + 源作品追溯
-- Date: 2026-04-25
-- Pairs with: 20260425_branch_recast_authorization.up.sql
--
-- ⚠️ Destructive — 删除字段会丢失已有数据。仅在确认 up 迁移需回滚时执行。
-- =============================================================================


-- ── 1. 删除 partial index ────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_recommended_content_branch_of_id;
DROP INDEX IF EXISTS idx_recommended_content_recast_of_id;


-- ── 2. 删除源作品追溯字段 (FK 自动随列删除) ───────────────────────────────────

ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS branch_of_id;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS recast_of_id;


-- ── 3. 删除 authorization opt-in 字段 ─────────────────────────────────────────

ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS allow_branch;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS allow_recast;


-- ── 4. 验证回滚 (read-only) ───────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'recommended_content'
--   AND column_name IN ('allow_branch', 'allow_recast', 'branch_of_id', 'recast_of_id');
-- 期望：0 行返回（4 个字段已全部删除）

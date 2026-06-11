-- =============================================================================
-- Migration: Branch / Recast 授权字段 + 源作品追溯
-- Date: 2026-04-25
-- Purpose: 落地 Branch 接龙 / Recast 出镜 两个 feature 所需的发布时授权 opt-in
--          字段 + 源作品反向引用，配合前端 Publishing Settings UI 接线。
--
-- Execution method:
--   Paste this file into Supabase Dashboard → SQL Editor → Run.
--   (Same pattern as 20260420_recommended_content_v2.up.sql)
--
-- Authorization:
--   2026-04-25 费 同意按 ask 文档（docs/asks/2026-04-25-branch-recast-schema.md）
--   方案 1A（两列 boolean）+ 方案 2A（源列加在作品表）落地。
--
-- Safety:
--   - 全部 ADDITIVE。NOT NULL 列带默认值（false / NULL），存量行不受影响。
--   - branch_of_id / recast_of_id ON DELETE SET NULL：源作品被删时，分支/出镜
--     作品保留为孤立条目（不级联删除，避免误连带损失）。
--   - 配套 down migration：20260425_branch_recast_authorization.down.sql
--
-- 业务约束（应用层 / RLS 层后续补）:
--   - 创建 branch_of_id 非空的 row 时，必须校验源作品 allow_branch === true
--   - 创建 recast_of_id 非空的 row 时，必须校验源作品 allow_recast === true
--     AND recaster 使用的 avatar.owner === auth.uid() OR avatar.is_official === true
--   详见 docs/COMPLIANCE.md §2 / §3
-- =============================================================================


-- ── 1. Authorization opt-in 字段 (作者发布时勾选) ──────────────────────────

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS allow_branch BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS allow_recast BOOLEAN NOT NULL DEFAULT false;


-- ── 2. 源作品追溯字段 (Branch / Recast 反查 + social proof 计数) ──────────

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS branch_of_id UUID
    REFERENCES public.recommended_content(id)
    ON DELETE SET NULL;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS recast_of_id UUID
    REFERENCES public.recommended_content(id)
    ON DELETE SET NULL;


-- ── 3. Partial index 加速反向计数 (SparkMode social proof "X branches so far") ─
-- Branch / Recast 是稀疏关系（多数作品不是 branch/recast 出来的），用 partial
-- index 只索引 NOT NULL 的行，索引大小可控。

CREATE INDEX IF NOT EXISTS idx_recommended_content_branch_of_id
  ON public.recommended_content (branch_of_id)
  WHERE branch_of_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recommended_content_recast_of_id
  ON public.recommended_content (recast_of_id)
  WHERE recast_of_id IS NOT NULL;


-- ── 4. Post-migration 验证 (read-only) ──────────────────────────────────────
-- 跑完上面后 uncomment 这些 SELECT 检查结果：
--
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'recommended_content'
--   AND column_name IN ('allow_branch', 'allow_recast', 'branch_of_id', 'recast_of_id')
-- ORDER BY ordinal_position;
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'recommended_content'
--   AND indexname LIKE '%_of_id';
--
-- 期望：4 个新列存在；2 个 partial index 存在；存量行 allow_branch=false / allow_recast=false。

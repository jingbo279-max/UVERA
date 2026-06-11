-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-27 fei — Single Library row per multi-segment story.
--
-- Background: Quick Mode + Free Mode 多段合并都会 INSERT 合并视频 + 用户/系统
-- 偶尔也会 INSERT 各分段 row, Library 出现 N+1 行 (合并版 + N 段) 混乱。
-- 用户期望: 一个故事 = Library 一行, 行内可切换 "合并版 / 分段 1 / 分段 2..."
-- 查看。
--
-- 方案: 给 recommended_content 加一个 JSONB segment_videos 列, 数组形式
-- 存所有分段的 video URL + 时长 + index。NULL = 单段视频(legacy / 普通模式)。
-- video 列继续是合并版的播放主源。LibraryPage 详情视图按这一列展开下拉。
--
-- 兼容性: NULLABLE 列, 老数据保持原状; 新代码 INSERT 多段合并时写入数组;
-- 老代码继续可工作(不读这个字段就当单段视频处理)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.recommended_content
  ADD COLUMN IF NOT EXISTS segment_videos jsonb;

COMMENT ON COLUMN public.recommended_content.segment_videos IS
  '§2026-05-27 fei — array of segment objects for multi-segment works.
   Format: [{index: int, video: text, duration_sec: int, title?: text}, ...].
   NULL = single-segment work (legacy/normal). The merged video itself
   stays in the `video` column as primary playback source. Frontend
   LibraryPage detail view exposes a dropdown to switch between merged
   and each segment.';

COMMIT;

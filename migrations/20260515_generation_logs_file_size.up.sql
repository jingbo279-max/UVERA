-- 20260515_generation_logs_file_size.up.sql
-- 给 generation_logs 加 file_size_bytes — AI 生成视频的实际文件大小
--
-- 背景:
-- v1.1.x 周期 fei audit 发现 generation_logs 只记 response_size_bytes
-- (Volcengine API 响应 JSON 大小,通常 < 300 字节),没记真正生成的视频
-- 文件大小。这导致:
-- - 成本核算不准 (CF Stream 按 stored min 计费,但 R2 / 带宽按 byte)
-- - 用户消耗对比 (一个 5s 480p ≈ 1-3 MB, 5s 1080p ≈ 8-15 MB) 没有数据
-- - 流量异常检测做不了 (找不到突然变大的输出)
--
-- worker /api/stream/upload-from-url 现在已经知道 videoBuffer.byteLength,
-- 这次 migration 同时改 worker 把这个值 PATCH 回 generation_logs (按
-- task_id 关联;column 设可 null 是因为 task_id 是后期才有的,某些 endpoint
-- (text gen 等) 不产生视频,值正常为 NULL).

BEGIN;

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

COMMENT ON COLUMN public.generation_logs.file_size_bytes IS
  'Generated output file size in bytes (video / image). NULL for text-only gens. Captured by worker /api/stream/upload-from-url after downloading from BytePlus and storing to R2/CF Stream.';

-- 给 file_size_bytes IS NOT NULL 加 partial index 让"未来出现 size 异常视频"的
-- 巡检 query 不需要全表扫描
CREATE INDEX IF NOT EXISTS generation_logs_file_size_idx
  ON public.generation_logs (file_size_bytes)
  WHERE file_size_bytes IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;

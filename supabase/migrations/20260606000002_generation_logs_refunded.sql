-- 20260606000002_generation_logs_refunded.sql
--
-- §2026-06-06 fei — 在 generation_logs 行上记录「失败已退款」,让后台 Generation
-- Logs 界面的 FAILED 行直接显示「已退款 N」,无需另查 credit_tx。
--
-- 背景:失败退款一直写进 credit_tx(tx_type='refund'),但 admin 的 Generation
-- Logs 看的是 generation_logs 表,两张表不互通 → 运营在那个界面看不到退款,
-- 误以为没退。本次给 generation_logs 加退款标记列,退款时一并 PATCH。

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS refunded         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at      timestamptz;

-- 说明:
--   refunded         — 该次生成失败后是否已把扣的积分退还
--   refunded_credits — 退还的积分数(= 当初 tokens_charged)
--   refunded_at      — 退款时间
-- 历史行保持 refunded=false(无法回溯;以 credit_tx 为准)。新失败从此可见。

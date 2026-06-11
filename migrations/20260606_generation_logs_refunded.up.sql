-- 20260606_generation_logs_refunded.up.sql  (历史归档副本)
--
-- 见 supabase/migrations/20260606000002_generation_logs_refunded.sql。
--
-- §2026-06-06 fei — generation_logs 加退款标记列,后台 FAILED 行可直接显示
-- 「已退款 N」(退款本体仍在 credit_tx;这是给运营可见用)。

ALTER TABLE public.generation_logs
  ADD COLUMN IF NOT EXISTS refunded         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refunded_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at      timestamptz;

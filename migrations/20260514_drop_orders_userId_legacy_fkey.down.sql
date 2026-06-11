-- 20260514_drop_orders_userId_legacy_fkey.down.sql
-- ⚠️ 回滚此 migration 几乎肯定会失败：legacy public.users 表里没有
-- 通过 Supabase Auth 注册的新用户,任何指向他们的 orders 行都会让
-- ADD CONSTRAINT 报 23503。
--
-- 如果真要还原,先要把 auth.users 的所有 id 同步到 public.users:
--   INSERT INTO public.users (id) SELECT id FROM auth.users
--     ON CONFLICT (id) DO NOTHING;
-- 然后再加 FK。但这违背了我们把 public.users 当 legacy 弃用的方向,
-- 强烈不建议执行。

ALTER TABLE public.orders
  ADD CONSTRAINT "orders_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public.users(id);

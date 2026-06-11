-- 20260514_drop_orders_userId_legacy_fkey.up.sql
-- 删掉 public.orders.userId 指向 legacy public.users 表的外键
--
-- 历史背景：
-- - 项目初期 (v0.x) public.users 是用户主表，公开可见 + 应用维护
-- - 中期 (~2026-04) 切到 Supabase Auth，所有用户改存 auth.users
-- - public.users 变成"stale mirror"：新用户通过 Supabase Auth 注册时
--   只进 auth.users,不会自动 mirror 到 public.users
-- - 但 orders.userId 的 FK 还指向 public.users,导致：
--     ✗ 任何 Stripe webhook 给新用户(只存在于 auth.users)插入 orders
--       行都会 23503 FK violation
--     ✗ Worker 把 INSERT 失败标记为 non-fatal (会继续给 user_metadata
--       加 tokens),所以 webhook 整体返回 200,Stripe 那边看不出错,但
--       orders 表永远是空的
-- - 2026-05-14 用户测试 live mode 首笔 Lite $3.99 时撞墙发现这个问题
--
-- 解决方案：drop FK,不替换。
-- 为什么不替换为 auth.users(id)：
--   1. auth schema 通常不允许 public schema 的对象 reference 它
--      (Supabase 强烈不建议这样做,会绕过 RLS 引发 leak 风险)
--   2. 业务层已经验证：worker INSERT orders 前会通过
--      resolveSupabaseUserFromStripeCustomer 在 auth.users 查到 userId
--      才会继续。FK 在数据库层不是必需的。
--   3. 同 schema 的 credit_grants / generation_logs / team_messages
--      都是没有 FK 到 auth.users 的(因为同样的 schema 隔离限制)。
--      orders 跟它们对齐即可。

BEGIN;

-- Defensive: only drop if exists (重跑安全)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'orders_userId_fkey'
       AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders DROP CONSTRAINT "orders_userId_fkey";
    RAISE NOTICE 'Dropped orders_userId_fkey';
  ELSE
    RAISE NOTICE 'orders_userId_fkey not found, skipping';
  END IF;
END$$;

COMMIT;

-- 20260514_system_settings.up.sql
-- 全局运行时配置表。用作"不想每次改值都重新部署 worker"的简易 KV。
--
-- 设计原则：
--   - 极简：key/value 都是 text。需要复杂结构 → 存 JSON 字符串自行解析。
--   - 缓存友好：worker 端会用 60s 内存缓存避免每个请求都查库。
--   - 审计可读：updated_at + updated_by 让我们能追溯谁什么时候改的配置。
--
-- 首批 seed 的 key：
--   - lite_price_cooldown_hours  — Lite 阶梯价格衰减周期（小时）
--                                  每过这么久没买，价格降一档（$7.99→$5.99→$3.99）
--                                  详见 docs/decisions/2026-05-14-lite-trial-plan.md

BEGIN;

CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- RLS：只服务角色（worker SERVICE_ROLE_KEY）能读写。前端用户直接走 worker
-- /api/admin/system-settings 端点，不直连这个表。
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
-- 没有任何 grant policy → 默认全部拒绝。SERVICE_ROLE 绕过 RLS 仍可用。

-- 用 updated_at 自动维护
CREATE OR REPLACE FUNCTION public.system_settings_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_settings_touch_updated_at ON public.system_settings;
CREATE TRIGGER system_settings_touch_updated_at
  BEFORE UPDATE ON public.system_settings
  FOR EACH ROW EXECUTE FUNCTION public.system_settings_touch_updated_at();

-- Seed initial values. ON CONFLICT 让重跑无害。
INSERT INTO public.system_settings (key, value, description) VALUES
  (
    'lite_price_cooldown_hours',
    '3',
    'Hours of no Lite purchases before the price decays one tier (e.g. $7.99 → $5.99). Default 3. Set to 0 to disable decay (prices never come back down).'
  )
ON CONFLICT (key) DO NOTHING;

-- PostgREST 需要 reload schema 才能看到新表
NOTIFY pgrst, 'reload schema';

COMMIT;

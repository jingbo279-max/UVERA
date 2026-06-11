-- 20260514_system_settings.down.sql
-- 回滚 system_settings 表
-- ⚠️ 会丢失所有运行时配置，包括 admin 在后台调过的值。
-- 通常不应该回滚——如果某个 key 不再用了，单独 DELETE 即可。

BEGIN;

DROP TRIGGER IF EXISTS system_settings_touch_updated_at ON public.system_settings;
DROP FUNCTION IF EXISTS public.system_settings_touch_updated_at();
DROP TABLE IF EXISTS public.system_settings;

NOTIFY pgrst, 'reload schema';

COMMIT;

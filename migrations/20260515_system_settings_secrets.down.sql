-- 20260515_system_settings_secrets.down.sql
-- 回滚 is_secret 列。删除前 admin 配置过的所有 secret 值会丢失。

BEGIN;

DELETE FROM public.system_settings WHERE key IN (
  'seedance_fast_endpoint',
  'seedance_standard_endpoint',
  'byteplus_ark_api_key',
  'byteplus_ark_ak',
  'byteplus_ark_sk'
);

ALTER TABLE public.system_settings
  DROP COLUMN IF EXISTS is_secret;

NOTIFY pgrst, 'reload schema';

COMMIT;

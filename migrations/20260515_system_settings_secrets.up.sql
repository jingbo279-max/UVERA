-- 20260515_system_settings_secrets.up.sql
-- 给 system_settings 加 is_secret 列 + seed Seedance endpoint IDs
--
-- 背景:
-- v1.1.4 ship 完后,fei 要求 admin 后台能配置所有 BytePlus 相关 key/endpoint
-- 而不是依赖 Cloudflare wrangler secret put (CLI 操作不方便,且 endpoint ID
-- 升级时不应该需要重新部署 worker)。
--
-- 设计:
-- - 非密 setting (endpoint IDs, watermark UID, cooldown 时长等): 已有的
--   system_settings 即可,value 字段明文存储 + admin UI 明文展示
-- - 密 setting (ARK_API_KEY, ARK_AK, ARK_SK 等): 同表存储,加 is_secret=true 标记
--   admin UI 看到 is_secret=true 时:
--     * GET 时只返回 "configured" + last 4 chars,不返回完整 value
--     * UPDATE 时接受新 value (覆盖)
--     * 永远不在前端展示完整值
-- - Worker 读 secret 时同样走 getSystemSetting,与非密 setting 一致
-- - 老的 Cloudflare env vars (ARK_API_KEY 等) 作为 fallback 保留,
--   admin 还没配置时 worker 仍能跑;一旦 admin 配置了,DB 值优先
--
-- seed:
-- - 非密 endpoint IDs 直接 seed (新值,fei 提供的)
-- - 密 setting 不 seed,留给 admin 在 UI 里填 (避免空字符串入库)

BEGIN;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS is_secret boolean NOT NULL DEFAULT false;

-- 非密 Seedance endpoint IDs (fei 2026-05-15 提供的最新版本,替换 4 月旧版本)
INSERT INTO public.system_settings (key, value, description, is_secret) VALUES
  (
    'seedance_fast_endpoint',
    'ep-20260507183959-d7mr2',
    'BytePlus Seedance 2.0 Fast model endpoint ID. Used for Free tier (locked) and as default for paid tier. Updated 2026-05-15 from older ep-20260423195810-cx7nc.',
    false
  ),
  (
    'seedance_standard_endpoint',
    'ep-20260507184058-tpr79',
    'BytePlus Seedance 2.0 Standard model endpoint ID. Available to paid tiers only. New in 2026-05-15 — replaces fake placeholder ep-20260423195810-pro that was never deployed.',
    false
  )
ON CONFLICT (key) DO NOTHING;

-- 注:secret rows (byteplus_ark_api_key / byteplus_ark_ak / byteplus_ark_sk)
-- 故意不 seed,admin 在 UI 第一次填写时会创建。Worker 在那之前 fallback 到
-- 现有的 Cloudflare env vars (ARK_API_KEY / ARK_AK / ARK_SK)。

NOTIFY pgrst, 'reload schema';

COMMIT;

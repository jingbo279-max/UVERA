-- §2026-05-25 fei — rollback for 20260525_drama_payments.up.sql
--
-- 注意:这个 rollback 会 DROP 所有 U-Coins 余额 / 订单数据。生产上跑
-- rollback 前先备份 wallet_balance / wallet_tx / ucoins_orders /
-- series_purchases / episode_unlocks 这五张表。

BEGIN;

-- 1) 删 series 扩展字段 (按相反顺序,先 drop 索引)
DROP INDEX IF EXISTS public.idx_series_recommended_live;
DROP INDEX IF EXISTS public.idx_series_lifecycle_schedule;

ALTER TABLE public.series
  DROP COLUMN IF EXISTS lifecycle_status,
  DROP COLUMN IF EXISTS scheduled_publish_at,
  DROP COLUMN IF EXISTS revenue_share_pct,
  DROP COLUMN IF EXISTS is_recommended,
  DROP COLUMN IF EXISTS is_premiere,
  DROP COLUMN IF EXISTS member_free,
  DROP COLUMN IF EXISTS bundle_price_usd_cents,
  DROP COLUMN IF EXISTS ucoins_per_episode,
  DROP COLUMN IF EXISTS free_episodes_count;

-- 2) 删订单 + 解锁表 (FK 依赖顺序:先依赖方,后被依赖方)
DROP TABLE IF EXISTS public.ucoins_orders;
DROP TABLE IF EXISTS public.series_purchases;
DROP TABLE IF EXISTS public.episode_unlocks;
DROP TABLE IF EXISTS public.episodes;

-- 3) 删钱包流水 + 余额表 (wallet_tx 引用 wallet_balance via user_id,但都引用 auth.users,所以独立)
DROP TABLE IF EXISTS public.wallet_tx;
DROP TABLE IF EXISTS public.wallet_balance;

-- 4) 删 system_settings 里写入的默认值 (保守:仅删本次插入的 key)
DELETE FROM public.system_settings
  WHERE key IN (
    'default_revenue_share_pct',
    'default_channel_fee_pct_web',
    'default_channel_fee_pct_ios',
    'default_platform_service_pct',
    'default_include_acquisition_cost',
    'ucoins_packages'
  );

COMMIT;

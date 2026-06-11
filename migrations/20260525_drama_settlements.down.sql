-- §2026-05-25 fei — rollback for 20260525_drama_settlements.up.sql
--
-- 注意:rollback 会丢失所有结算单数据。生产上先备份 settlements 表再跑。

BEGIN;

DROP TABLE IF EXISTS public.settlements;

DELETE FROM public.system_settings
  WHERE key = 'ucoins_to_usd_cents';

COMMIT;

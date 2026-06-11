-- §2026-05-25 fei — rollback for 20260525_drama_member_config.up.sql
BEGIN;
DELETE FROM public.system_settings
  WHERE key IN ('drama_member_tiers', 'drama_lite_counts_as_member');
COMMIT;

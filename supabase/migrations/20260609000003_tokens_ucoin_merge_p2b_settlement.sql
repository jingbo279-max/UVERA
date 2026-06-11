-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-06-09 Tokens × Ucoin 合并 P2b(结算汇率 + 历史 unlock 折算)
--
-- 合并后短剧价/解锁记录都以 Token 计;1 Token = 4¢(= 4 Ucoin × 1¢)。
--   1. 结算汇率 system_settings.ucoins_to_usd_cents:1 → 4(键名暂沿用,值现为
--      "每 Token 多少分")。结算 GMV = ucoins_paid(Token)× 4¢ 保持原 USD 口径。
--   2. 历史 episode_unlocks.ucoins_paid(合并前的 Ucoin 价)÷4 对齐 Token,
--      使新旧解锁记录同口径。用 tokens_ucoin_unlocks_migrated 哨兵守卫,幂等。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) 结算汇率 → 4(幂等:设同值无害)
UPDATE public.system_settings SET value = '4', updated_at = now()
WHERE key = 'ucoins_to_usd_cents';

-- 2) 历史 unlock 价 ÷4(哨兵守卫防二次折算)
UPDATE public.episode_unlocks
SET ucoins_paid = CEIL(ucoins_paid / 4.0)::int
WHERE unlock_type = 'ucoins'
  AND ucoins_paid > 0
  AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'tokens_ucoin_unlocks_migrated' AND value = 'true');

INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES ('tokens_ucoin_unlocks_migrated', 'true', '§2026-06-09 历史 episode_unlocks.ucoins_paid ÷4 已执行', now())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-06-09 Tokens × Ucoin 合并 — 汇率修正 4:1 → 5:1
--
-- 费最终定 $1 = 20 Tokens → 1 Token = 5¢ = 5 Ucoin(原按 4:1 已应用,需改 5:1)。
-- 把已用 ÷4 的结果改成 ÷5:
--   · 用户合并到账:80÷4=20 → 80÷5=16(扣回多给的 4);修正 credit_tx 记录。
--   · series 单集价:40÷4=10 → 40÷5=8。
--   · 历史 unlock:40÷4=10 → 40÷5=8。
--   · 结算汇率 ucoins_to_usd_cents:4 → 5。
--   · 充值档位 packages:÷4 → ÷5。
-- 幂等:余额扣减用 tokens_ucoin_rate_corrected 哨兵;其余绝对值/带值守卫。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) 用户余额扣回多给的 4(÷4=20 → ÷5=16)。哨兵防二次扣。
UPDATE public.user_credits
SET balance = balance - 4,
    lifetime_granted = GREATEST(0, lifetime_granted - 4),
    updated_at = now()
WHERE user_id = '533d5650-b15e-4333-857a-f0d337f3a631'
  AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'tokens_ucoin_rate_corrected' AND value = 'true');

-- 修正合并流水(amount=20 → 16;balance_after -4;描述)。带值守卫幂等。
UPDATE public.credit_tx
SET amount = 16,
    balance_after = balance_after - 4,
    description = 'Ucoin→Token 合并(5:1):80 Ucoin ÷5 = 16 Tokens'
WHERE idempotency_key = 'ucoin-merge:533d5650-b15e-4333-857a-f0d337f3a631'
  AND amount = 20;

-- 2) series 单集价 10 → 8(绝对值,幂等)
UPDATE public.series SET ucoins_per_episode = 8 WHERE ucoins_per_episode = 10;

-- 3) 历史 unlock 10 → 8
UPDATE public.episode_unlocks SET ucoins_paid = 8 WHERE unlock_type = 'ucoins' AND ucoins_paid = 10;

-- 4) 结算汇率 → 5
UPDATE public.system_settings SET value = '5', updated_at = now() WHERE key = 'ucoins_to_usd_cents';

-- 5) 充值档位 ÷5(绝对值)
UPDATE public.system_settings
SET value = '[
     {"id":"pkg_099_first","price_cents":99,"ucoins":40,"bonus":20,"first_charge":true,"label":"$0.99 首充翻倍"},
     {"id":"pkg_199","price_cents":199,"ucoins":40,"bonus":0,"label":"$1.99"},
     {"id":"pkg_499","price_cents":499,"ucoins":104,"bonus":4,"label":"$4.99"},
     {"id":"pkg_999","price_cents":999,"ucoins":220,"bonus":20,"label":"$9.99"},
     {"id":"pkg_1999","price_cents":1999,"ucoins":460,"bonus":60,"label":"$19.99"},
     {"id":"pkg_4999","price_cents":4999,"ucoins":1200,"bonus":200,"label":"$49.99"}
   ]',
    updated_at = now()
WHERE key = 'ucoins_packages';

-- 6) 修正哨兵
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES ('tokens_ucoin_rate_corrected', 'true', '§2026-06-09 汇率 4:1→5:1 修正($1=20 Tokens)', now())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-06-09 Tokens × Ucoin 合并 P1(数据迁移)
--
-- 决策(docs/decisions/2026-06-06-tokens-ucoin-merge.md,Leon 锁定):
--   · 汇率 4 Ucoin = 1 Token(Token = 4¢ ≈ Lite 3.99¢)
--   · 存量全是内测数据,不补偿,按 ÷4 折算
--   · 档位方案 B:价格不变、token = ucoins÷4
--
-- 本迁移只动数据,不改 RPC / schema:
--   1. wallet_balance.ucoins_balance ÷4 → 加进 user_credits.balance(+ lifetime_granted),
--      记一条 credit_tx,然后把 ucoins_balance 清零(lifetime 字段保留作历史归档)。
--   2. series.ucoins_per_episode ÷4(CEIL,避免付费集变 0);episodes.ucoins_price_override 同。
--   3. system_settings.ucoins_packages 的 ucoins/bonus ÷4(价格 price_cents 不变)。
--
-- ⚠️ 配套:P2(worker 短剧解锁 RPC 改扣 user_credits、Ucoin order 到账记 Token、结算转
--   Token)与 P3(前端改名/去独立 Ucoin 余额)必须随后落地;cutover 期间内测可短暂 broken。
-- 应用:supabase db push --linked(费/有 linked CLI 的环境)。migration 系统保证只跑一次。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 0) 确保每个有 Ucoin 钱包的用户都有 user_credits 行
INSERT INTO public.user_credits (user_id, balance, lifetime_granted)
SELECT user_id, 0, 0 FROM public.wallet_balance
ON CONFLICT (user_id) DO NOTHING;

-- 1a) 先记流水(balance_after = 折算前余额 + 折算所得;FLOOR 不超发)
INSERT INTO public.credit_tx (user_id, amount, balance_after, tx_type, reference, idempotency_key, description)
SELECT wb.user_id,
       FLOOR(wb.ucoins_balance / 4.0)::int,
       uc.balance + FLOOR(wb.ucoins_balance / 4.0)::int,
       'admin_grant',
       'ucoin-merge-2026-06',
       'ucoin-merge:' || wb.user_id::text,
       'Ucoin→Token 合并(4:1):' || wb.ucoins_balance || ' Ucoin ÷4 = ' || FLOOR(wb.ucoins_balance / 4.0)::int || ' Tokens'
FROM public.wallet_balance wb
JOIN public.user_credits uc ON uc.user_id = wb.user_id
WHERE wb.ucoins_balance > 0
-- credit_tx_idem 是部分唯一索引(WHERE idempotency_key IS NOT NULL),ON CONFLICT 须带同 predicate
ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

-- 1b) 加进 Token 余额
UPDATE public.user_credits uc
SET balance          = uc.balance + FLOOR(wb.ucoins_balance / 4.0)::int,
    lifetime_granted = uc.lifetime_granted + FLOOR(wb.ucoins_balance / 4.0)::int,
    updated_at       = now()
FROM public.wallet_balance wb
WHERE uc.user_id = wb.user_id AND wb.ucoins_balance > 0;

-- 1c) 清零 ucoins 余额(lifetime_purchased/spent 保留作历史)
UPDATE public.wallet_balance SET ucoins_balance = 0 WHERE ucoins_balance > 0;

-- 2) 短剧单集价 ÷4(CEIL:付费集不会被折成 0)。
--    ⚠️ ÷4 非幂等 → 用哨兵守卫:已合并过(tokens_ucoin_merged=true)则跳过,
--    防任何通道(raw API / db push)重复跑导致二次 ÷4。
UPDATE public.series
SET ucoins_per_episode = CEIL(ucoins_per_episode / 4.0)::int
WHERE ucoins_per_episode > 0
  AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'tokens_ucoin_merged' AND value = 'true');

UPDATE public.episodes
SET ucoins_price_override = CEIL(ucoins_price_override / 4.0)::int
WHERE ucoins_price_override IS NOT NULL AND ucoins_price_override > 0
  AND NOT EXISTS (SELECT 1 FROM public.system_settings WHERE key = 'tokens_ucoin_merged' AND value = 'true');

-- 3) 充值档位:ucoins/bonus ÷4(price_cents 不变;字段名沿用 ucoins/bonus,值现为 Token)
UPDATE public.system_settings
SET value = '[
     {"id":"pkg_099_first","price_cents":99,"ucoins":50,"bonus":25,"first_charge":true,"label":"$0.99 首充翻倍"},
     {"id":"pkg_199","price_cents":199,"ucoins":50,"bonus":0,"label":"$1.99"},
     {"id":"pkg_499","price_cents":499,"ucoins":130,"bonus":5,"label":"$4.99"},
     {"id":"pkg_999","price_cents":999,"ucoins":275,"bonus":25,"label":"$9.99"},
     {"id":"pkg_1999","price_cents":1999,"ucoins":575,"bonus":75,"label":"$19.99"},
     {"id":"pkg_4999","price_cents":4999,"ucoins":1500,"bonus":250,"label":"$49.99"}
   ]',
    updated_at = now()
WHERE key = 'ucoins_packages';

-- 4) 记一个哨兵 setting(防误手再跑 + 给 worker/admin 参考)
INSERT INTO public.system_settings (key, value, description, updated_at)
VALUES ('tokens_ucoin_merged', 'true', '§2026-06-09 Tokens×Ucoin 合并(4:1)已执行 P1 数据迁移', now())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now();

COMMIT;

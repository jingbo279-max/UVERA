-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-06-09 Tokens × Ucoin 合并 P2(钱包 RPC 切到 user_credits)
--
-- P1 已把 Ucoin 余额 ÷4 并进 user_credits(Token),wallet_balance 清零。
-- 本迁移把三个 SECURITY DEFINER RPC 从操作 wallet_balance/wallet_tx(Ucoin)
-- 改为操作 user_credits/credit_tx(Token)。
--
-- 关键:函数【签名不变】→ CREATE OR REPLACE 仅换 body,worker 调用零改。
-- 返回 jsonb keys 也保持一致(spent_ucoins/credited_ucoins 等键名沿用,值现为 Token)。
--
-- episode_unlocks:unlock_type 仍 'ucoins'(CHECK 允许);ucoins_paid 存 Token 价;
--   wallet_tx_id 改写为 NULL(原 FK→wallet_tx,现 tx 落 credit_tx,链接不再用此列)。
-- FOR UPDATE 行锁 + unique_violation 回滚的并发安全语义全部保留(锁对象改 user_credits 行)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. wallet_unlock_episode → 扣 user_credits ──────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_unlock_episode(
  p_user_id      uuid,
  p_episode_id   uuid,
  p_series_id    uuid,
  p_price        integer,
  p_description  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing_unlock uuid;
  v_current_balance integer;
  v_current_lifetime integer;
  v_new_balance integer;
  v_tx_id uuid;
  v_unlock_id uuid;
BEGIN
  IF p_price IS NULL OR p_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid price');
  END IF;

  SELECT id INTO v_existing_unlock
  FROM public.episode_unlocks
  WHERE user_id = p_user_id AND episode_id = p_episode_id
  LIMIT 1;
  IF v_existing_unlock IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_unlocked', true, 'unlock_id', v_existing_unlock);
  END IF;

  -- 锁 user_credits 行(没有则建)
  SELECT balance, COALESCE(lifetime_spent, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_credits(user_id, balance, lifetime_spent)
    VALUES (p_user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
    SELECT balance, COALESCE(lifetime_spent, 0)
      INTO v_current_balance, v_current_lifetime
    FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);
  IF v_current_balance < p_price THEN
    RETURN jsonb_build_object('success', false, 'insufficient', true, 'required', p_price, 'current', v_current_balance);
  END IF;

  v_new_balance := v_current_balance - p_price;
  UPDATE public.user_credits
  SET balance = v_new_balance, lifetime_spent = v_current_lifetime + p_price, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, description)
  VALUES (p_user_id, -p_price, v_new_balance, 'unlock_episode', p_episode_id::text, COALESCE(p_description, 'Unlock episode'))
  RETURNING id INTO v_tx_id;

  -- wallet_tx_id = NULL(原 FK→wallet_tx;现 tx 在 credit_tx)
  INSERT INTO public.episode_unlocks(user_id, episode_id, series_id, unlock_type, ucoins_paid, wallet_tx_id)
  VALUES (p_user_id, p_episode_id, p_series_id, 'ucoins', p_price, NULL)
  RETURNING id INTO v_unlock_id;

  RETURN jsonb_build_object('success', true, 'unlock_id', v_unlock_id, 'wallet_tx_id', v_tx_id,
                            'balance_after', v_new_balance, 'spent_ucoins', p_price);
EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_existing_unlock FROM public.episode_unlocks
  WHERE user_id = p_user_id AND episode_id = p_episode_id LIMIT 1;
  RETURN jsonb_build_object('success', true, 'already_unlocked', true, 'unlock_id', v_existing_unlock, 'race_caught', true);
END;
$$;

-- ── 2. wallet_credit_purchase → 加 user_credits ─────────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_credit_purchase(
  p_user_id        uuid,
  p_ucoins_amount  integer,     -- 现为 Token 数(face + bonus),键名沿用
  p_tx_type        text,
  p_reference_type text,
  p_reference_id   uuid,
  p_description    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_balance integer;
  v_current_lifetime integer;
  v_new_balance integer;
  v_tx_id uuid;
BEGIN
  IF p_ucoins_amount IS NULL OR p_ucoins_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid amount');
  END IF;

  SELECT balance, COALESCE(lifetime_granted, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.user_credits(user_id, balance, lifetime_granted)
    VALUES (p_user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
    SELECT balance, COALESCE(lifetime_granted, 0)
      INTO v_current_balance, v_current_lifetime
    FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);
  v_new_balance := v_current_balance + p_ucoins_amount;

  UPDATE public.user_credits
  SET balance = v_new_balance, lifetime_granted = v_current_lifetime + p_ucoins_amount, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, description)
  VALUES (p_user_id, p_ucoins_amount, v_new_balance, COALESCE(p_tx_type, 'stripe_topup'), p_reference_id::text, p_description)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', true, 'wallet_tx_id', v_tx_id, 'balance_after', v_new_balance, 'credited_ucoins', p_ucoins_amount);
END;
$$;

-- ── 3. wallet_refund_purchase → 从 user_credits 扣回 ────────────────────────
CREATE OR REPLACE FUNCTION public.wallet_refund_purchase(
  p_user_id        uuid,
  p_ucoins_amount  integer,     -- 现为 Token 数,键名沿用
  p_reference_type text,
  p_reference_id   uuid,
  p_description    text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_current_balance integer;
  v_current_lifetime integer;
  v_actual_deduction integer;
  v_new_balance integer;
  v_tx_id uuid;
BEGIN
  IF p_ucoins_amount IS NULL OR p_ucoins_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid amount');
  END IF;

  SELECT balance, COALESCE(lifetime_granted, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, description)
    VALUES (p_user_id, 0, 0, 'refund', p_reference_id::text, p_description || ' (no credits row — refund deducted 0)')
    RETURNING id INTO v_tx_id;
    RETURN jsonb_build_object('success', true, 'wallet_tx_id', v_tx_id, 'balance_after', 0,
                              'requested_refund', p_ucoins_amount, 'actually_deducted', 0);
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);
  v_actual_deduction := LEAST(p_ucoins_amount, v_current_balance);
  v_new_balance := v_current_balance - v_actual_deduction;

  UPDATE public.user_credits
  SET balance = v_new_balance,
      lifetime_granted = GREATEST(0, v_current_lifetime - p_ucoins_amount),
      updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, description)
  VALUES (p_user_id, -v_actual_deduction, v_new_balance, 'refund', p_reference_id::text,
          p_description || CASE WHEN v_actual_deduction < p_ucoins_amount
                                THEN format(' (requested %s, capped at %s)', p_ucoins_amount, v_actual_deduction)
                                ELSE '' END)
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object('success', true, 'wallet_tx_id', v_tx_id, 'balance_after', v_new_balance,
                            'requested_refund', p_ucoins_amount, 'actually_deducted', v_actual_deduction);
END;
$$;

GRANT EXECUTE ON FUNCTION public.wallet_unlock_episode(uuid, uuid, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_credit_purchase(uuid, integer, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_refund_purchase(uuid, integer, text, uuid, text) TO service_role;

COMMIT;

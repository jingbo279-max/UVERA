-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-26 fei (audit #7) — Refund-side RPC for atomic wallet ops.
--                              Companion to wallet_credit_purchase /
--                              wallet_unlock_episode from 20260526000002.
--
-- Use cases:
--   1. Stripe charge.refunded webhook fires for a ucoins_order → we need to
--      decrement the user's wallet_balance (reverse the credit) atomically
--      with the refund tx insert and prevent racing with a concurrent
--      unlock_episode call.
--   2. Admin clicks "Refund" on a ucoins_order in PaymentLedgerView → same
--      reverse-credit operation, plus we record the Stripe refund id.
--   3. Bundle/episode refunds DO NOT use this RPC because they don't touch
--      wallet_balance (they touch series_purchases / episode_unlocks);
--      worker handles those tables directly.
--
-- Safety:
--   - Refund amount must be positive (we negate it inside the txn).
--   - If user's balance is INSUFFICIENT (they spent the U-Coins already),
--     we still reverse what's available — the resulting balance is 0, NOT
--     negative. This matches consumer-finance norm: refund a $10 gift card
--     you already spent → you get $0 back, not an IOU. The refund tx logs
--     the actual deducted amount in `amount` and what we owed in
--     `description` so audit can see.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.wallet_refund_purchase(
  p_user_id           uuid,
  p_ucoins_amount     integer,        -- positive; the U-Coins to remove
  p_reference_type    text,           -- 'ucoins_order' typically
  p_reference_id      uuid,
  p_description       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance   integer;
  v_current_lifetime  integer;
  v_actual_deduction  integer;
  v_new_balance       integer;
  v_tx_id             uuid;
BEGIN
  IF p_ucoins_amount IS NULL OR p_ucoins_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid ucoins_amount');
  END IF;

  SELECT ucoins_balance, COALESCE(ucoins_lifetime_purchased, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.wallet_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- User never had a wallet row → nothing to refund from. Log a 0-amount
    -- refund tx for audit trail and return success with deducted=0.
    INSERT INTO public.wallet_tx(
      user_id, amount, balance_after, tx_type, reference_type, reference_id, description
    )
    VALUES (
      p_user_id, 0, 0, 'refund', p_reference_type, p_reference_id,
      p_description || ' (no wallet row — refund deducted 0)'
    )
    RETURNING id INTO v_tx_id;
    RETURN jsonb_build_object(
      'success', true,
      'wallet_tx_id', v_tx_id,
      'balance_after', 0,
      'requested_refund', p_ucoins_amount,
      'actually_deducted', 0
    );
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  -- Floor at 0: don't take user into negative if they spent the credits.
  v_actual_deduction := LEAST(p_ucoins_amount, v_current_balance);
  v_new_balance := v_current_balance - v_actual_deduction;

  UPDATE public.wallet_balance
  SET ucoins_balance            = v_new_balance,
      -- Reduce lifetime_purchased so analytics reflect the refund.
      -- Floor at 0 in case multiple refunds exceed historical purchases.
      ucoins_lifetime_purchased = GREATEST(0, v_current_lifetime - p_ucoins_amount),
      updated_at                = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_tx(
    user_id, amount, balance_after, tx_type, reference_type, reference_id, description
  )
  VALUES (
    p_user_id, -v_actual_deduction, v_new_balance, 'refund',
    p_reference_type, p_reference_id,
    p_description ||
      CASE WHEN v_actual_deduction < p_ucoins_amount
           THEN format(' (requested %s, balance allowed %s — capped at 0)', p_ucoins_amount, v_actual_deduction)
           ELSE '' END
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_tx_id', v_tx_id,
    'balance_after', v_new_balance,
    'requested_refund', p_ucoins_amount,
    'actually_deducted', v_actual_deduction
  );
END;
$$;

COMMENT ON FUNCTION public.wallet_refund_purchase(uuid, integer, text, uuid, text) IS
  '§2026-05-26 fei (audit #7) — Atomic U-Coins refund. Locks wallet_balance, deducts up to current balance (floors at 0 — does not allow negative), logs refund tx. Caller (worker) must enforce idempotency at the order level (stripe_refund_id check). Returns jsonb {success, wallet_tx_id, balance_after, requested_refund, actually_deducted}.';

GRANT EXECUTE ON FUNCTION public.wallet_refund_purchase(uuid, integer, text, uuid, text) TO service_role;

COMMIT;

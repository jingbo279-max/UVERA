-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-26 fei (audit #5) — Atomic wallet balance ops via SECURITY DEFINER
--                              RPC functions. Closes the race-condition money
--                              hole in /api/episodes/:id/unlock + Stripe
--                              webhook U-Coins credit.
--
-- The bug (current production behavior):
--   Worker pay-with-ucoins flow:
--     1. SELECT wallet_balance.ucoins_balance into v_balance
--     2. PATCH wallet_balance SET ucoins_balance = v_balance - price
--     3. INSERT wallet_tx
--     4. INSERT episode_unlocks  (UNIQUE constraint catches dupes)
--     5. On UNIQUE conflict at step 4: PATCH wallet_balance SET
--        ucoins_balance = v_balance  (OVERWRITE — not increment!)
--
--   Concurrent scenarios that lose money:
--     A) Two unlocks for DIFFERENT episodes hit simultaneously:
--          Both read balance=100. Both PATCH balance=60. Result: 60
--          (should be 20). User charged for 1 ep, got 2.
--     B) Unlock + Stripe topup webhook hit simultaneously:
--          Unlock reads 100. Topup adds 200 → balance=300. Unlock PATCHes
--          balance=60 (overwrites!). User loses the 200 topup.
--     C) Unlock fails at step 4 (race), refund at step 5 overwrites with
--          stale value, losing whatever other operations updated balance
--          in the meantime.
--
-- The fix:
--   Two SECURITY DEFINER functions that wrap the whole sequence in a single
--   transaction with SELECT FOR UPDATE row lock. PostgreSQL serializes
--   concurrent writers on the same wallet_balance row, so all reads see the
--   latest committed value and all writes are sequential. INSERT
--   episode_unlocks UNIQUE conflict is caught + transaction auto-rolls back
--   the deduction (no manual refund needed — Postgres does it for free).
--
-- Backward compat:
--   Old worker code continues to work (these are NEW functions, not
--   replacements). Worker will be migrated in the same deploy to call these
--   via supabaseAdmin('/rpc/wallet_*', ...).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. wallet_unlock_episode ────────────────────────────────────────────────
-- Atomic: check balance → deduct → insert wallet_tx → insert episode_unlocks
-- Idempotent on (user_id, episode_id) via UNIQUE constraint on episode_unlocks.
-- Returns jsonb so caller (worker) can branch on success/insufficient/already.
CREATE OR REPLACE FUNCTION public.wallet_unlock_episode(
  p_user_id      uuid,
  p_episode_id   uuid,
  p_series_id    uuid,
  p_price        integer,
  p_description  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- 1. Idempotency check: already unlocked? Return existing unlock row id.
  SELECT id INTO v_existing_unlock
  FROM public.episode_unlocks
  WHERE user_id = p_user_id AND episode_id = p_episode_id
  LIMIT 1;

  IF v_existing_unlock IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_unlocked', true,
      'unlock_id', v_existing_unlock
    );
  END IF;

  -- 2. Lock the user's wallet_balance row (SELECT FOR UPDATE). Concurrent
  --    unlock or topup ops on the same user wait here until we commit.
  --    Create the row if missing (free new users start at 0).
  SELECT ucoins_balance, COALESCE(ucoins_lifetime_spent, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.wallet_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_balance(user_id, ucoins_balance, ucoins_lifetime_spent)
    VALUES (p_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    -- Re-fetch with lock now that the row exists.
    SELECT ucoins_balance, COALESCE(ucoins_lifetime_spent, 0)
      INTO v_current_balance, v_current_lifetime
    FROM public.wallet_balance
    WHERE user_id = p_user_id
    FOR UPDATE;
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);

  -- 3. Sufficient balance?
  IF v_current_balance < p_price THEN
    RETURN jsonb_build_object(
      'success', false,
      'insufficient', true,
      'required', p_price,
      'current', v_current_balance
    );
  END IF;

  -- 4. Deduct (use computed delta — equivalent to increment by -price under
  --    row lock, but explicit for clarity).
  v_new_balance := v_current_balance - p_price;
  UPDATE public.wallet_balance
  SET ucoins_balance        = v_new_balance,
      ucoins_lifetime_spent = v_current_lifetime + p_price,
      updated_at            = now()
  WHERE user_id = p_user_id;

  -- 5. Insert wallet_tx (negative amount).
  INSERT INTO public.wallet_tx(
    user_id, amount, balance_after, tx_type,
    reference_type, reference_id, description
  )
  VALUES (
    p_user_id, -p_price, v_new_balance, 'unlock_episode',
    'episode', p_episode_id,
    COALESCE(p_description, 'Unlock episode')
  )
  RETURNING id INTO v_tx_id;

  -- 6. Insert episode_unlocks. UNIQUE (user_id, episode_id) protects
  --    against double-unlock. Caught by EXCEPTION below — full transaction
  --    rolls back including the deduction (Postgres atomicity), so we don't
  --    need to manually refund anymore (the old "race refund" code is dead).
  INSERT INTO public.episode_unlocks(
    user_id, episode_id, series_id, unlock_type, ucoins_paid, wallet_tx_id
  )
  VALUES (
    p_user_id, p_episode_id, p_series_id, 'ucoins', p_price, v_tx_id
  )
  RETURNING id INTO v_unlock_id;

  RETURN jsonb_build_object(
    'success', true,
    'unlock_id', v_unlock_id,
    'wallet_tx_id', v_tx_id,
    'balance_after', v_new_balance,
    'spent_ucoins', p_price
  );

EXCEPTION
  WHEN unique_violation THEN
    -- Concurrent request beat us to the unlock. Outer transaction rolls
    -- back automatically (the deduction never happened). Return idempotent
    -- success referencing the winner's unlock row.
    SELECT id INTO v_existing_unlock
    FROM public.episode_unlocks
    WHERE user_id = p_user_id AND episode_id = p_episode_id
    LIMIT 1;
    RETURN jsonb_build_object(
      'success', true,
      'already_unlocked', true,
      'unlock_id', v_existing_unlock,
      'race_caught', true
    );
END;
$$;

COMMENT ON FUNCTION public.wallet_unlock_episode(uuid, uuid, uuid, integer, text) IS
  '§2026-05-26 fei (audit #5) — Atomic episode unlock with U-Coins. SECURITY DEFINER bypasses RLS; row-locks wallet_balance via FOR UPDATE so concurrent unlocks/topups serialize correctly. Catches unique_violation on episode_unlocks and rolls back deduction (no manual refund). Returns jsonb {success, unlock_id?, balance_after?, insufficient?, already_unlocked?, race_caught?}.';

GRANT EXECUTE ON FUNCTION public.wallet_unlock_episode(uuid, uuid, uuid, integer, text) TO service_role;


-- ── 2. wallet_credit_purchase ───────────────────────────────────────────────
-- Atomic: lock wallet_balance → add credit → insert wallet_tx.
-- Used by Stripe webhook (U-Coins purchase) so concurrent unlock can't
-- overwrite the topup.
--
-- Caller (worker) is responsible for ucoins_orders idempotency check (we don't
-- re-check it here; the webhook code does that before calling this RPC).
CREATE OR REPLACE FUNCTION public.wallet_credit_purchase(
  p_user_id           uuid,
  p_ucoins_amount     integer,        -- positive; total credited (face + bonus)
  p_tx_type           text,           -- 'purchase' | 'first_charge' | 'admin_grant'
  p_reference_type    text,           -- 'ucoins_order' | 'admin' | ...
  p_reference_id      uuid,
  p_description       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_balance integer;
  v_current_lifetime integer;
  v_new_balance integer;
  v_tx_id uuid;
BEGIN
  IF p_ucoins_amount IS NULL OR p_ucoins_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid ucoins_amount');
  END IF;

  -- Lock + read (create row if missing).
  SELECT ucoins_balance, COALESCE(ucoins_lifetime_purchased, 0)
    INTO v_current_balance, v_current_lifetime
  FROM public.wallet_balance
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.wallet_balance(user_id, ucoins_balance, ucoins_lifetime_purchased)
    VALUES (p_user_id, 0, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT ucoins_balance, COALESCE(ucoins_lifetime_purchased, 0)
      INTO v_current_balance, v_current_lifetime
    FROM public.wallet_balance
    WHERE user_id = p_user_id
    FOR UPDATE;
  END IF;

  v_current_balance := COALESCE(v_current_balance, 0);
  v_new_balance := v_current_balance + p_ucoins_amount;

  UPDATE public.wallet_balance
  SET ucoins_balance            = v_new_balance,
      ucoins_lifetime_purchased = v_current_lifetime + p_ucoins_amount,
      updated_at                = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.wallet_tx(
    user_id, amount, balance_after, tx_type,
    reference_type, reference_id, description
  )
  VALUES (
    p_user_id, p_ucoins_amount, v_new_balance, p_tx_type,
    p_reference_type, p_reference_id, p_description
  )
  RETURNING id INTO v_tx_id;

  RETURN jsonb_build_object(
    'success', true,
    'wallet_tx_id', v_tx_id,
    'balance_after', v_new_balance,
    'credited_ucoins', p_ucoins_amount
  );
END;
$$;

COMMENT ON FUNCTION public.wallet_credit_purchase(uuid, integer, text, text, uuid, text) IS
  '§2026-05-26 fei (audit #5) — Atomic U-Coins credit. Used by Stripe webhook + admin grant. Row-locks wallet_balance so concurrent unlock cannot overwrite the topup. Caller must enforce order idempotency (we do not re-check ucoins_orders.status here). Returns jsonb {success, wallet_tx_id, balance_after, credited_ucoins}.';

GRANT EXECUTE ON FUNCTION public.wallet_credit_purchase(uuid, integer, text, text, uuid, text) TO service_role;

COMMIT;

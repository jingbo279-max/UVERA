-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-29 fei — 服务端权威积分(token)余额。
--
-- 背景 / 漏洞:
--   旧实现把余额存在 auth.users.user_metadata.credits/tokens。但 user_metadata
--   是【用户可写】的(supabase.auth.updateUser({data}) 直接改),任何登录用户
--   都能把自己余额改成任意值 → 免费烧 BytePlus / OpenAI / Gemini。
--
-- 修复:
--   余额搬到这张表。RLS 只给 SELECT-own,【没有】任何 insert/update/delete 策略
--   → 普通用户 / 匿名一律不能写。唯一写入路径是 service_role(worker)或
--   SECURITY DEFINER RPC(见 20260529000002)。镜像现有钱包范式(wallet_balance)。
--
-- credit_tx 流水:
--   每次增减都记一行。idempotency_key 唯一索引(部分索引,仅非 NULL)防双花/双退/
--   webhook 重放 —— daily:uid:date / refund:taskid / stripe:eventid / share:uid:date:n。
--
-- 回填:
--   从 user_metadata(tokens 优先,fallback credits)。非破坏:不动 user_metadata,
--   过渡期两边都在(冷路径 grant 仍镜像回 meta 作 rollback 保险)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_credits (
  user_id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance          integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_granted integer NOT NULL DEFAULT 0,
  lifetime_spent   integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

-- 只读自己。无 insert/update/delete 策略 → 普通用户/匿名一律不能写。
DROP POLICY IF EXISTS user_credits_select_own ON public.user_credits;
CREATE POLICY user_credits_select_own ON public.user_credits
  FOR SELECT USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.credit_tx (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount          integer NOT NULL,            -- 负=扣,正=增/退
  balance_after   integer NOT NULL,
  tx_type         text NOT NULL,               -- spend_video|spend_storyboard|refund|welcome|daily|share|admin_grant|stripe_subscription|stripe_topup
  reference       text,                         -- task_id / logId / 业务引用
  idempotency_key text,                         -- daily:uid:date | refund:taskid | stripe:eventid | share:uid:date:n
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS credit_tx_idem
  ON public.credit_tx (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_tx_user ON public.credit_tx (user_id, created_at DESC);

ALTER TABLE public.credit_tx ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS credit_tx_select_own ON public.credit_tx;
CREATE POLICY credit_tx_select_own ON public.credit_tx
  FOR SELECT USING (user_id = auth.uid());

-- 回填:从 user_metadata(tokens 优先,fallback credits)。非破坏,不动 user_metadata。
INSERT INTO public.user_credits (user_id, balance, lifetime_granted)
SELECT id,
       COALESCE((raw_user_meta_data->>'tokens')::int, (raw_user_meta_data->>'credits')::int, 0),
       COALESCE((raw_user_meta_data->>'tokens')::int, (raw_user_meta_data->>'credits')::int, 0)
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

COMMENT ON TABLE public.user_credits IS
  '§2026-05-29 fei — 服务端权威 token 余额。RLS 仅 SELECT-own,无写策略;唯一写入路径 = service_role / SECURITY DEFINER RPC(spend_credits/grant_credits/ensure_user_credits)。取代用户可写的 user_metadata.credits/tokens。';
COMMENT ON TABLE public.credit_tx IS
  '§2026-05-29 fei — 积分流水。idempotency_key 唯一(部分)索引防双花/双退/webhook 重放。';

COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
-- §2026-05-29 fei — 原子积分 RPC(镜像 wallet_unlock_episode/wallet_credit_purchase)。
--
--   spend_credits   — 扣费,FOR UPDATE 行锁防并发双扣,校验余额(不足返回
--                     insufficient,不抛)。service_role only(worker 调)。
--   grant_credits   — 加币/退款。带 idempotency_key 时去重(已存在→幂等成功,
--                     不重复加)；并发同 key 由 credit_tx_idem 唯一索引兜底
--                     (unique_violation → 幂等返回)。service_role only。
--   ensure_user_credits — 首登欢迎金(幂等,固定额)。授 authenticated:用户自助
--                     创建,no-op if exists,无 delete 策略 → 无法刷。
--
-- 所有函数 SECURITY DEFINER + SET search_path = public,绕 RLS 写表。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1) spend_credits — 扣费(校验余额)。service_role only(worker 调)。
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user_id     uuid,
  p_amount      integer,
  p_tx_type     text,
  p_reference   text DEFAULT NULL,
  p_description text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance integer; v_spent integer; v_new integer; v_tx uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid amount');
  END IF;

  SELECT balance, lifetime_spent INTO v_balance, v_spent
  FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.user_credits(user_id, balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT balance, lifetime_spent INTO v_balance, v_spent
    FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  v_balance := COALESCE(v_balance, 0);
  IF v_balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'insufficient', true,
                              'required', p_amount, 'current', v_balance);
  END IF;

  v_new := v_balance - p_amount;
  UPDATE public.user_credits
  SET balance = v_new, lifetime_spent = COALESCE(v_spent,0) + p_amount, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, description)
  VALUES (p_user_id, -p_amount, v_new, p_tx_type, p_reference, p_description)
  RETURNING id INTO v_tx;

  RETURN jsonb_build_object('success', true, 'balance_after', v_new,
                           'spent', p_amount, 'credit_tx_id', v_tx);
END; $$;
GRANT EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,text,text) TO service_role;

COMMENT ON FUNCTION public.spend_credits(uuid,integer,text,text,text) IS
  '§2026-05-29 fei — 原子扣费。FOR UPDATE 行锁;余额不足返回 {success:false,insufficient:true,required,current}(不抛)。返回 {success,balance_after,spent,credit_tx_id}。';

-- 2) grant_credits — 加币/退款。带 idempotency_key 时去重(已存在→幂等成功不重复加)。
CREATE OR REPLACE FUNCTION public.grant_credits(
  p_user_id         uuid,
  p_amount          integer,
  p_tx_type         text,
  p_reference       text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_description     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance integer; v_granted integer; v_new integer; v_tx uuid; v_existing uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Invalid amount');
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM public.credit_tx
    WHERE idempotency_key = p_idempotency_key LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT balance INTO v_balance FROM public.user_credits WHERE user_id = p_user_id;
      RETURN jsonb_build_object('success', true, 'idempotent', true,
                               'balance_after', COALESCE(v_balance,0), 'credit_tx_id', v_existing);
    END IF;
  END IF;

  SELECT balance, lifetime_granted INTO v_balance, v_granted
  FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.user_credits(user_id, balance) VALUES (p_user_id, 0)
    ON CONFLICT (user_id) DO NOTHING;
    SELECT balance, lifetime_granted INTO v_balance, v_granted
    FROM public.user_credits WHERE user_id = p_user_id FOR UPDATE;
  END IF;

  v_balance := COALESCE(v_balance, 0);
  v_new := v_balance + p_amount;
  UPDATE public.user_credits
  SET balance = v_new, lifetime_granted = COALESCE(v_granted,0) + p_amount, updated_at = now()
  WHERE user_id = p_user_id;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, reference, idempotency_key, description)
  VALUES (p_user_id, p_amount, v_new, p_tx_type, p_reference, p_idempotency_key, p_description)
  RETURNING id INTO v_tx;

  RETURN jsonb_build_object('success', true, 'balance_after', v_new,
                           'credited', p_amount, 'credit_tx_id', v_tx);
EXCEPTION
  WHEN unique_violation THEN  -- 并发同 idempotency_key:对手赢,幂等返回
    SELECT id INTO v_existing FROM public.credit_tx
    WHERE idempotency_key = p_idempotency_key LIMIT 1;
    SELECT balance INTO v_balance FROM public.user_credits WHERE user_id = p_user_id;
    RETURN jsonb_build_object('success', true, 'idempotent', true,
                             'balance_after', COALESCE(v_balance,0), 'credit_tx_id', v_existing);
END; $$;
GRANT EXECUTE ON FUNCTION public.grant_credits(uuid,integer,text,text,text,text) TO service_role;

COMMENT ON FUNCTION public.grant_credits(uuid,integer,text,text,text,text) IS
  '§2026-05-29 fei — 原子加币/退款。p_idempotency_key 非空时去重(已存在→{idempotent:true});并发同 key 由 credit_tx_idem 唯一索引兜底。返回 {success,balance_after,credited?,idempotent?,credit_tx_id}。';

-- 3) ensure_user_credits — 首登欢迎金(幂等)。授 authenticated:用户自助创建,
--    固定额、no-op if exists、无 delete 策略 → 无法刷。
CREATE OR REPLACE FUNCTION public.ensure_user_credits(p_welcome integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_balance integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errMessage', 'Not authenticated');
  END IF;

  SELECT balance INTO v_balance FROM public.user_credits WHERE user_id = v_uid;
  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'created', false, 'balance', v_balance);
  END IF;

  INSERT INTO public.user_credits(user_id, balance, lifetime_granted)
  VALUES (v_uid, p_welcome, p_welcome) ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.credit_tx(user_id, amount, balance_after, tx_type, idempotency_key, description)
  VALUES (v_uid, p_welcome, p_welcome, 'welcome', 'welcome:'||v_uid, 'Welcome gift')
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT balance INTO v_balance FROM public.user_credits WHERE user_id = v_uid;
  RETURN jsonb_build_object('success', true, 'created', true, 'balance', COALESCE(v_balance, p_welcome));
END; $$;
GRANT EXECUTE ON FUNCTION public.ensure_user_credits(integer) TO authenticated;

COMMENT ON FUNCTION public.ensure_user_credits(integer) IS
  '§2026-05-29 fei — 首登欢迎金(幂等,固定额)。auth.uid() 自助;no-op if exists;welcome:uid 幂等键防重复。返回 {success,created,balance}。';

COMMIT;

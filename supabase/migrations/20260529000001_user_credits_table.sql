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

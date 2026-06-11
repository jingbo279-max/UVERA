---
title: 生成积分服务端化 + 鉴权 Implementation Plan
type: plan
status: active
owner: fei
created: 2026-05-30
updated: 2026-05-30
tags: [credit, enforcement, backend]
---

# 生成积分服务端化 + 鉴权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把用户积分(token)权威余额从可被用户篡改的 `user_metadata` 搬到服务端只写的 `user_credits` 表 + 原子 RPC,4 个生成端点全部加鉴权,视频路径服务端原子扣费 + 失败退款。

**Architecture:** 照搬现有钱包范式(`wallet_unlock_episode` SECURITY DEFINER + FOR UPDATE 行锁 + jsonb 返回)。新表 `user_credits` + 流水 `credit_tx`(唯一 idempotency_key 防双花/双退)。worker 经 `supabaseAdmin('/rpc/...')` 调 RPC。所有积分增减点统一切到 RPC;冷路径 grant best-effort 镜像回 `user_metadata.tokens` 作过渡保险。

**Tech Stack:** Supabase Postgres(plpgsql,SECURITY DEFINER RPC,RLS)、Cloudflare Worker(`public/_worker.js`)、React/Vite 前端、`supabase-js`。

**测试现实:** 本项目无单元测试框架(无 vitest/jest)。验证 = ①SQL 断言片段(Supabase SQL editor / psql 跑)②`npm run preview`(= build + `wrangler dev` 本地起 Worker)+ `curl` 打端点 ③`npm run build` 必须过 ④手动冒烟。每个任务的"验证"步骤按此设计。

**部署纪律(CLAUDE.md):** DB migration 先 `supabase db push --linked`,再 `npm run deploy`(走 main 分支护栏)。**绝不用 `wrangler pages ...`。**

**关键参考(已读过的现状,行号为写计划时的快照,实现前用 grep 复核):**
- video/submit handler:`public/_worker.js:1884`;成本估算常量 `CREDITS_PER_SEC{480p:4,720p:6,1080p:12}`:2209;generation_logs INSERT(`tokens_charged`):2215-2265;成功 return:2273;catch:2280。
- video status handler:`public/_worker.js:4852`;SELECT `id,started_at`(加 `status=eq.started`):4882;PATCH started→terminal:4920。
- storyboard:3487(start)/3794(ok)/3817-3823(fail);character-board:3850/4016/4031;multi-segment-script:4631/4650(400)/4822/4826。
- `/api/video-models` 成本来源:6963;`seedance_standard_endpoint` 默认 `ep-20260507184058-tpr79`;`seedance_fast_cost_multiplier`(1.0)/`seedance_standard_cost_multiplier`(1.5):6980-6983。
- 钱包 RPC helper `supabaseAdmin(path,init)`:7401;`/rpc/wallet_unlock_episode` 调用:7824。
- claim-daily:8946(写 user_metadata:8979-8989);Stripe 月度 grant:8370-8374;Stripe 充值 grant:8684-8690;admin grant 端点:9020(写:9089-9100)。
- 前端:`getUserProfile`/`updateCredits`/`handleShareCredits`:`src/api/supabaseClient.js:44/71/128`;读余额点:`NavigationBar.jsx:99/105`、`SubscriptionPage.jsx`、`SettingsPage.jsx`、`StoryGeneratorPage.jsx:938/945`;客户端扣费:`StoryGeneratorPage.jsx:1943/2354/2683`,退款:1960/2457;成本常量 `STORYBOARD_TOKEN_COST=3`:`src/data/plans.js:100`。

---

## File Structure

**新建:**
- `supabase/migrations/20260529000001_user_credits_table.sql` — 表 + RLS + 回填
- `supabase/migrations/20260529000002_user_credits_rpc.sql` — `spend_credits` / `grant_credits` / `ensure_user_credits`
- `migrations/20260529_user_credits.up.sql` — 上述两份合并的历史归档(CLAUDE.md 双份约定)
- `docs/engineering/sql-tests/credit_rpc_smoke.sql` — RPC 断言冒烟脚本

**修改:**
- `public/_worker.js` — 新增 credit helper 块;改 4 个生成端点 + video status;改 claim-daily / admin-grant / Stripe webhook;新增 `/api/credits/claim-share`;admin 用户列表 join 余额
- `src/api/supabaseClient.js` — `getUserProfile` 读 user_credits;删 `updateCredits` 的客户端扣费语义;`handleShareCredits` 改调 worker
- `src/pages/StoryGeneratorPage.jsx` — 删客户端扣费/退款,保留软预检,insufficient 走服务端,响应回带余额刷新

---

## Phase 1 — DB 基础

### Task 1: 建 `user_credits` + `credit_tx` 表 + RLS + 回填

**Files:**
- Create: `supabase/migrations/20260529000001_user_credits_table.sql`

- [ ] **Step 1: 写 migration 文件**

```sql
-- §2026-05-29 — 服务端权威积分余额。user_metadata.credits/tokens 用户可写,
-- 不可信;余额搬到这里,仅 service_role / SECURITY DEFINER 可写。
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

COMMIT;
```

- [ ] **Step 2: 本地验证 SQL 语法(dry-run,不连 prod)**

Run: `npx supabase db lint --linked 2>/dev/null || echo "lint 不可用,跳过 — 在 Step 3 由 push 校验"`
Expected: 无语法报错(或提示 lint 不可用)。

- [ ] **Step 3: push 到 Supabase**

Run: `supabase db push --linked`
Expected: 显示 apply `20260529000001_user_credits_table` 成功,无错误。

- [ ] **Step 4: 验证表 + 回填结果**

在 Supabase SQL editor / psql 跑:
```sql
SELECT count(*) AS rows,
       (SELECT count(*) FROM auth.users) AS users
FROM public.user_credits;
-- 抽样核对回填正确
SELECT u.id,
       (u.raw_user_meta_data->>'tokens') AS meta_tokens,
       (u.raw_user_meta_data->>'credits') AS meta_credits,
       c.balance
FROM auth.users u JOIN public.user_credits c ON c.user_id = u.id
LIMIT 10;
```
Expected: `rows == users`;每行 `balance == COALESCE(meta_tokens, meta_credits, 0)`。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260529000001_user_credits_table.sql
git commit -m "feat(credits): user_credits + credit_tx tables, RLS, backfill from user_metadata"
```

---

### Task 2: 建 `spend_credits` / `grant_credits` / `ensure_user_credits` RPC

**Files:**
- Create: `supabase/migrations/20260529000002_user_credits_rpc.sql`

- [ ] **Step 1: 写 RPC migration**

```sql
-- §2026-05-29 — 原子积分 RPC(镜像 wallet_*)。FOR UPDATE 行锁防并发双扣;
-- credit_tx.idempotency_key 唯一索引防双退/重放。
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

-- 3) ensure_user_credits — 首登欢迎金(幂等)。授 authenticated:用户自助创建,固定额、no-op if exists、无 delete 策略 → 无法刷。
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

COMMIT;
```

- [ ] **Step 2: push**

Run: `supabase db push --linked`
Expected: apply `20260529000002_user_credits_rpc` 成功。

- [ ] **Step 3: 写 RPC 冒烟断言脚本**

Create `docs/engineering/sql-tests/credit_rpc_smoke.sql`:
```sql
-- 用一个真实测试用户 id 替换 :uid(从 auth.users 取一个)。在 SQL editor 跑。
-- 1) grant 100,余额应 +100
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 100, 'admin_grant', null, null, 'test');
-- 2) spend 30,余额应 70,返回 success
SELECT public.spend_credits('00000000-0000-0000-0000-000000000000'::uuid, 30, 'spend_video', 'task-x', 'test');
-- 3) spend 9999,应 insufficient
SELECT public.spend_credits('00000000-0000-0000-0000-000000000000'::uuid, 9999, 'spend_video', 'task-y', 'test');
-- 4) grant 幂等:同 key 两次,余额只 +5 一次
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 5, 'refund', 'task-x', 'refund:task-x', 'test');
SELECT public.grant_credits('00000000-0000-0000-0000-000000000000'::uuid, 5, 'refund', 'task-x', 'refund:task-x', 'test'); -- idempotent:true
-- 5) 最终余额 = 100 - 30 + 5 = 75
SELECT balance FROM public.user_credits WHERE user_id = '00000000-0000-0000-0000-000000000000';
-- 清理
DELETE FROM public.credit_tx WHERE user_id = '00000000-0000-0000-0000-000000000000';
DELETE FROM public.user_credits WHERE user_id = '00000000-0000-0000-0000-000000000000';
```

- [ ] **Step 4: 跑冒烟脚本验证**

用一个真实测试用户 uuid 替换占位,在 Supabase SQL editor 逐段跑。
Expected: ②返回 `balance_after:70`;③返回 `insufficient:true`;④第二次返回 `idempotent:true`;⑤`balance == 75`。

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260529000002_user_credits_rpc.sql docs/engineering/sql-tests/credit_rpc_smoke.sql
git commit -m "feat(credits): atomic spend/grant/ensure RPCs (mirror wallet pattern)"
```

---

## Phase 2 — Worker credit helpers

### Task 3: 新增 credit helper 块(`requireUser` / `creditSpend` / `creditGrant` / `computeVideoCost` / `mirrorBalanceToMeta`)

**Files:**
- Modify: `public/_worker.js`(在 `supabaseAdmin` 定义附近,约 7401 之后,放进同一作用域,使各端点可调用;若作用域不便,放在文件顶部 helper 区并传 env)

> 注:`supabaseAdmin` 是请求作用域内闭包(7401)。这些 helper 同样要能访问 `env`。实现前 grep `const supabaseAdmin` 确认作用域,把下面的函数定义放在它**之后、所有端点 if 链之前**的同一作用域里(纯函数式,显式传 env)。

- [ ] **Step 1: 复核作用域**

Run: `grep -n "const supabaseAdmin" public/_worker.js`
Expected: 找到定义行(约 7401);确认它在主 fetch handler 内、端点 if 链之前。helper 紧随其后插入。

- [ ] **Step 2: 插入 helper 代码**

在 `supabaseAdmin` 定义之后插入:
```js
// ─── §2026-05-29 积分服务端化 helpers ───────────────────────────────────────
const SUPA_URL = env.SUPABASE_URL || 'https://wjhdsodlxekvhpahascs.supabase.co';

// 解析 JWT → 用户。无/无效 → 抛(端点 catch 返回 401)。
async function requireUser(req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) { const e = new Error('Authentication required'); e.httpStatus = 401; throw e; }
  const r = await fetch(`${SUPA_URL}/auth/v1/user`, {
    headers: { 'Authorization': authHeader, 'apikey': env.SUPABASE_ANON_KEY || '' }
  });
  if (!r.ok) { const e = new Error('Invalid session'); e.httpStatus = 401; throw e; }
  const u = await r.json();
  if (!u?.id) { const e = new Error('Invalid session'); e.httpStatus = 401; throw e; }
  return { id: u.id, email: u.email || null, tier: u?.user_metadata?.tier || 'free', meta: u.user_metadata || {} };
}

// 原子扣费。返回 {success, balance_after} 或抛 insufficient(httpStatus 402)。
async function creditSpend(userId, amount, txType, reference, description) {
  const r = await supabaseAdmin('/rpc/spend_credits', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_user_id: userId, p_amount: amount, p_tx_type: txType, p_reference: reference || null, p_description: description || null })
  });
  const j = await r.json();
  if (!r.ok) throw new Error('spend_credits RPC failed: ' + JSON.stringify(j).slice(0,200));
  if (j && j.insufficient) {
    const e = new Error(`Insufficient credits (need ${j.required}, have ${j.current})`);
    e.httpStatus = 402; e.insufficient = true; e.required = j.required; e.current = j.current; throw e;
  }
  if (!j || !j.success) throw new Error('spend_credits failed: ' + JSON.stringify(j).slice(0,200));
  return j; // {success, balance_after, spent, credit_tx_id}
}

// 原子加币/退款(可幂等)。best-effort 不抛(失败只 log,避免阻断主流程)。返回 j 或 null。
async function creditGrant(userId, amount, txType, reference, idempotencyKey, description) {
  try {
    const r = await supabaseAdmin('/rpc/grant_credits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_amount: amount, p_tx_type: txType, p_reference: reference || null, p_idempotency_key: idempotencyKey || null, p_description: description || null })
    });
    const j = await r.json();
    if (!r.ok || !j?.success) { console.error('[credits] grant_credits non-OK', JSON.stringify(j).slice(0,200)); return null; }
    return j;
  } catch (e) { console.error('[credits] grant_credits exception', e.message); return null; }
}

// 冷路径过渡镜像:把权威余额写回 user_metadata.tokens+credits(best-effort)。
async function mirrorBalanceToMeta(userId, balance, currentMeta) {
  try {
    await fetch(`${SUPA_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_metadata: { ...(currentMeta || {}), tokens: balance, credits: balance } })
    });
  } catch (e) { console.error('[credits] mirror to user_metadata failed', e.message); }
}

// 服务端权威视频成本(镜像 StoryGeneratorPage computeFreeModeCredits)。
async function computeVideoCost(resolution, duration, modelId) {
  const CREDITS_PER_SEC = { '480p': 4, '720p': 6, '1080p': 12 };
  const standardEndpoint = await getSystemSetting(env, 'seedance_standard_endpoint', 'ep-20260507184058-tpr79');
  const fastMul = Number(await getSystemSetting(env, 'seedance_fast_cost_multiplier', '1.0')) || 1.0;
  const stdMul = Number(await getSystemSetting(env, 'seedance_standard_cost_multiplier', '1.5')) || 1.5;
  const mul = (modelId && modelId === standardEndpoint) ? stdMul : fastMul;
  const base = (CREDITS_PER_SEC[resolution || '480p'] || 6) * (duration || 5);
  return Math.ceil(base * mul);
}
```

- [ ] **Step 3: build 校验语法**

Run: `npm run build`
Expected: build 成功(无语法错误)。helper 暂未被调用,只验证可编译。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): worker helpers — requireUser, creditSpend/Grant, computeVideoCost, mirror"
```

---

## Phase 3 — Gate 四个生成端点

### Task 4: `video/submit` 加鉴权 + 服务端原子扣费 + 同步失败退款

**Files:**
- Modify: `public/_worker.js`(handler `1884`,catch `2280`,generation_logs INSERT `2215`)

- [ ] **Step 1: 复核 handler 当前结构**

Run: `grep -n "video/submit\|submitToArk\|Render pipeline encountered" public/_worker.js | head`
Expected: 确认 handler 起点、submitToArk 首次调用行、catch 行。扣费必须在 submitToArk(调 BytePlus)**之前**。

- [ ] **Step 2: 把"可选鉴权"改为"必须鉴权 + 扣费"**

在 handler 内,把现有 best-effort 鉴权块(约 1899-1917,`let callerId=null...try{...}catch{}`)替换为强制鉴权 + 扣费。在 `const { prompt, imageUrl, ... } = await request.json();` 之后、`submitToArk` 调用之前插入/替换:
```js
// §2026-05-29 必须登录(挡匿名烧 BytePlus)
const caller = await requireUser(request);          // 无 JWT → 抛 401(下方 catch 处理)
const callerId = caller.id, callerEmail = caller.email, callerTier = caller.tier;

// 服务端权威成本 + 原子扣费(BytePlus 调用前)
const videoCost = await computeVideoCost(resolution, duration, model);
let spendInfo = null;
try {
  spendInfo = await creditSpend(callerId, videoCost, 'spend_video', null, `Video gen ${resolution||'480p'} ${duration||5}s`);
} catch (e) {
  if (e.httpStatus === 402) {
    return new Response(JSON.stringify({ success:false, insufficient:true, required:e.required, current:e.current, errMessage:e.message }),
      { status: 402, headers: { 'Content-Type':'application/json', ...corsHeaders } });
  }
  throw e;
}
const chargedCredits = spendInfo.spent;
```
> 注:删掉原 `callerTier='free'` 默认 + best-effort try/catch;watermark enforcement 块(1932)继续用 `callerTier`(现在来自可信 JWT,更好)。

- [ ] **Step 3: generation_logs 记录真实扣费额**

把 INSERT(2240-2241)的 `credits_charged`/`tokens_charged` 从估算 `creditsCharged` 改为真实 `chargedCredits`:
```js
              credits_charged: chargedCredits,
              tokens_charged: chargedCredits,
```
> 删除/保留 2197-2210 的 `COST_USD_PER_SECOND`/`CREDITS_PER_SEC`/`creditsCharged` 估算块:`estimatedCostUsd`(cost_usd 用)保留;`creditsCharged` 不再用于扣费,但仍被 cost log 引用处替换为 `chargedCredits`。grep 确认无其它引用后删 `CREDITS_PER_SEC`/`creditsCharged`。

- [ ] **Step 4: catch 块补同步失败退款**

把 catch(2280)改为:submit 阶段(BytePlus 拒绝等)失败时,若已扣费则退回。
```js
      } catch (err) {
        console.error('Render pipeline encountered an error:', err);
        // 鉴权失败 → 401
        if (err.httpStatus === 401) {
          return new Response(JSON.stringify({ success:false, errMessage: err.message }),
            { status: 401, headers: { 'Content-Type':'application/json', ...corsHeaders } });
        }
        // 已扣费但 BytePlus 提交失败 → 同步退款(同请求内,无幂等键即可)
        if (typeof callerId !== 'undefined' && callerId && typeof chargedCredits !== 'undefined' && chargedCredits > 0) {
          await creditGrant(callerId, chargedCredits, 'refund', null, null, 'Refund: video submit failed');
        }
        return new Response(JSON.stringify({ success: false, errMessage: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
```
> 变量作用域:`callerId`/`chargedCredits` 用 `let` 声明在 try 顶部(Step 2 用 `const`,改为在 try 外 `let callerId, chargedCredits;` 再在 try 内赋值),以便 catch 可见。调整声明位置。

- [ ] **Step 5: 本地起 Worker 验证**

Run: `npm run preview`(build + wrangler dev;需 `.dev.vars` 有 SUPABASE_SERVICE_ROLE_KEY 等)
然后另开终端:
```bash
# 匿名 → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/api/volcengine/video/submit -H 'Content-Type: application/json' -d '{"prompt":"x","resolution":"480p","duration":5}'
# 带测试用户 JWT(从浏览器 localStorage 取 access_token)→ 余额足:200 并扣费;余额不足:402
curl -s -X POST http://localhost:8787/api/volcengine/video/submit -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{"prompt":"x","resolution":"480p","duration":5}'
```
Expected: 匿名 `401`;有效 JWT 余额足 → `200 {success,taskId}` 且 SQL 查 `user_credits.balance` 已扣 20(480p×5×1.0);余额不足 → `402 {insufficient:true}`。
> wrangler dev 默认端口 8787;若 `npm run preview` 用别的端口以实际为准。

- [ ] **Step 6: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): video/submit require auth + server-side atomic charge + sync refund"
```

---

### Task 5: video status 端点异步失败退款

**Files:**
- Modify: `public/_worker.js`(status handler `4852`,SELECT `4882`,PATCH `4920`)

- [ ] **Step 1: SELECT 增列**

把 4883 的 select 从 `select=id,started_at` 改为带退款所需字段:
```js
              `${supabaseUrl}/rest/v1/generation_logs?task_id=eq.${encodeURIComponent(taskId)}&status=eq.started&select=id,started_at,user_id,tokens_charged`,
```

- [ ] **Step 2: PATCH 成功翻转后退款(failed/timeout)**

在 PATCH 块(4920-4938)**之后**、`if (!updResp.ok)` 校验内/外都可,插入退款逻辑。在 `updResp.ok` 为真且 `normalizedStatus === 'failed'` 时退款,幂等键 `refund:<taskId>`:
```js
              // §2026-05-29 异步失败退款。credit_tx 唯一 idempotency_key 防重复退;
              // status=eq.started 过滤 + 幂等键 双保险。
              if (updResp.ok && normalizedStatus === 'failed' && row.user_id && Number(row.tokens_charged) > 0) {
                await creditGrant(row.user_id, Number(row.tokens_charged), 'refund',
                  taskId, `refund:${taskId}`, 'Refund: video generation failed');
              }
```
> `creditGrant` 在 Task 3 定义于主作用域,status handler 在同作用域内可调用 —— grep 确认 status handler 在 helper 定义之后(if 链内,helper 在 if 链之前 → 可见)。

- [ ] **Step 3: timeout 路径同样退款(若存在独立写点)**

Run: `grep -n "status.*timeout\|'timeout'\|\"timeout\"" public/_worker.js`
若有把 generation_logs 写成 `timeout` 的独立代码点,在那里同样调用 `creditGrant(userId, tokens_charged, 'refund', taskId, 'refund:'+taskId, 'Refund: video timeout')`(同幂等键,与 failed 互斥不会双退)。若无独立写点(timeout 仅前端展示),跳过。
Expected: 记录是否存在 timeout 写点并相应处理。

- [ ] **Step 4: 验证(模拟失败)**

本地难真触发 BytePlus failed。改用 SQL 模拟:对一个 `status='started'` 且 `tokens_charged>0` 的测试 generation_logs 行,手动构造一次退款调用验证幂等:
```sql
-- 连续两次同 key,只退一次
SELECT public.grant_credits('<uid>'::uuid, 20, 'refund', 'tasktest', 'refund:tasktest', 'sim');
SELECT public.grant_credits('<uid>'::uuid, 20, 'refund', 'tasktest', 'refund:tasktest', 'sim'); -- idempotent:true
SELECT count(*) FROM credit_tx WHERE idempotency_key='refund:tasktest'; -- = 1
```
Expected: 第二次 `idempotent:true`;`count == 1`。清理测试行。

- [ ] **Step 5: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): refund video credits on async failed/timeout (idempotent)"
```

---

### Task 6: `generate-storyboard` 加鉴权 + 扣 3 + 失败退款

**Files:**
- Modify: `public/_worker.js`(handler `3487`,ok `3794`,fail `3817-3823`)

- [ ] **Step 1: 复核 handler + 排查免费调用方**

Run: `grep -n "generate-storyboard" public/_worker.js src/ -r`
Expected: 列出所有调用方。按 spec 决策:**统一扣 3**(原免费调用方一律改为扣 3)。记录前端调用点以便 Task 14 删除其客户端扣费。

- [ ] **Step 2: 插入鉴权 + 扣费**

在 handler 解析 body 之后、调 OpenAI 之前插入:
```js
        const caller = await requireUser(request);
        const STORYBOARD_COST = 3;
        let sbSpend;
        try {
          sbSpend = await creditSpend(caller.id, STORYBOARD_COST, 'spend_storyboard', null, 'Storyboard image');
        } catch (e) {
          if (e.httpStatus === 402) {
            return new Response(JSON.stringify({ success:false, insufficient:true, required:e.required, current:e.current, errMessage:e.message }),
              { status: 402, headers: { 'Content-Type':'application/json', ...corsHeaders } });
          }
          throw e;
        }
```
> corsHeaders 变量名以该 handler 实际为准(grep handler 内的 `corsHeaders`)。

- [ ] **Step 3: 失败退款 + 401**

在该 handler 的 catch(3817 附近)开头插入:
```js
        if (err.httpStatus === 401)
          return new Response(JSON.stringify({ success:false, errMessage: err.message }),
            { status: 401, headers: { 'Content-Type':'application/json', ...corsHeaders } });
        if (caller?.id) await creditGrant(caller.id, 3, 'refund', null, null, 'Refund: storyboard failed');
```
> `caller` 需在 try 外 `let caller;` 声明以便 catch 可见。调整声明位置。

- [ ] **Step 4: 验证**

`npm run preview` 后:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/api/generate-storyboard -H 'Content-Type: application/json' -d '{}'   # 匿名→401
curl -s -X POST http://localhost:8787/api/generate-storyboard -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' -d '{...有效 body...}'  # 扣3
```
Expected: 匿名 401;有效请求成功且 `user_credits.balance` 减 3;余额不足 402。

- [ ] **Step 5: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): generate-storyboard require auth + charge 3 + refund on failure"
```

---

### Task 7: `generate-character-board` 加鉴权(不扣费)

**Files:**
- Modify: `public/_worker.js`(handler `3850`,catch `4031`)

- [ ] **Step 1: 插入鉴权**

在 handler 解析 body 后、调 OpenAI 前插入:
```js
        const caller = await requireUser(request);  // §2026-05-29 挡匿名;character board 维持免费,不扣费
```
> `let caller;` 在 try 外声明。

- [ ] **Step 2: catch 处理 401**

catch(4031 附近)开头:
```js
        if (err.httpStatus === 401)
          return new Response(JSON.stringify({ success:false, errMessage: err.message }),
            { status: 401, headers: { 'Content-Type':'application/json', ...corsHeaders } });
```

- [ ] **Step 3: 验证**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/api/generate-character-board -H 'Content-Type: application/json' -d '{}'  # →401
```
Expected: 匿名 401;有效 JWT 正常(不扣费,余额不变)。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): generate-character-board require auth (stays free)"
```

---

### Task 8: `generate-multi-segment-script` 加鉴权(不扣费)

**Files:**
- Modify: `public/_worker.js`(handler `4631`,400 校验 `4650`,catch `4826`)

- [ ] **Step 1: 插入鉴权**

在 handler 入参校验(4650)之前或之后、调 Gemini 之前插入:
```js
        const caller = await requireUser(request);  // §2026-05-29 挡匿名烧 Gemini;脚本维持免费
```
> `let caller;` 在 try 外声明。

- [ ] **Step 2: catch 处理 401**

catch(4826 附近)开头加 401 分支(同 Task 7 Step 2,用该 handler 的 corsHeaders)。

- [ ] **Step 3: 验证**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8787/api/generate-multi-segment-script -H 'Content-Type: application/json' -d '{}'  # →401
```
Expected: 匿名 401;有效 JWT 正常(不扣费)。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): generate-multi-segment-script require auth (stays free)"
```

---

## Phase 4 — 积分增减点统一切到 RPC(防 split-brain)

### Task 9: claim-daily 改走 grant_credits + 冷路径镜像

**Files:**
- Modify: `public/_worker.js`(handler `8946`,原写 user_metadata `8979-8989`)

- [ ] **Step 1: 复核 handler**

Run: `grep -n "claim-daily\|DAILY_LOGIN_BONUS" public/_worker.js`
Expected: 确认 handler 范围。

- [ ] **Step 2: 改为 grant_credits(幂等键=每日)**

把 8960-9004 的"读 meta → admin PUT"逻辑替换为:解析用户后,`grant_credits(uid, 6, 'daily', null, 'daily:'+uid+':'+today, 'Daily login bonus')`,根据返回 `idempotent` 判断是否"已领"。
```js
        const caller = await requireUser(request);
        const today = new Date().toISOString().slice(0, 10);
        const g = await creditGrant(caller.id, DAILY_LOGIN_BONUS, 'daily', null, `daily:${caller.id}:${today}`, 'Daily login bonus');
        if (!g) throw new Error('Daily claim failed');
        const claimed = !g.idempotent;
        const balance = g.balance_after;
        if (claimed) await mirrorBalanceToMeta(caller.id, balance, { ...caller.meta, last_claim_date: today });
        return new Response(JSON.stringify({
          success: true, claimed, credits: balance, tokens: balance,
          last_claim_date: today, ...(claimed ? { added: DAILY_LOGIN_BONUS } : { message: 'Already claimed today' })
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
```
> 删除原 `meta.last_claim_date === today` 手判 + admin PUT 块;幂等键替代它。`requireUser` 替代原 `/auth/v1/user` 手解析。

- [ ] **Step 3: 验证**

```bash
curl -s -X POST http://localhost:8787/api/credits/claim-daily -H "Authorization: Bearer $JWT"   # 第一次 claimed:true added:6
curl -s -X POST http://localhost:8787/api/credits/claim-daily -H "Authorization: Bearer $JWT"   # 第二次 claimed:false
```
Expected: 第一次 `claimed:true`,`user_credits.balance` +6,`user_metadata.tokens` 镜像同步;第二次 `claimed:false` 余额不变。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): claim-daily via grant_credits (idempotent) + cold-path mirror"
```

---

### Task 10: 分享加币改服务端端点 `/api/credits/claim-share`

**Files:**
- Modify: `public/_worker.js`(新增端点,放在 claim-daily handler 之后)
- Modify: `src/api/supabaseClient.js`(`handleShareCredits` `128-150`)

- [ ] **Step 1: 新增 worker 端点**

在 claim-daily handler 之后插入:
```js
    // §2026-05-29 分享加币(服务端限频 +10,≤3/日)
    if (url.pathname === '/api/credits/claim-share' && request.method === 'POST') {
      const corsHeaders = { 'Access-Control-Allow-Origin': '*' };
      const SHARE_BONUS = 10, MAX_PER_DAY = 3;
      try {
        const caller = await requireUser(request);
        const today = new Date().toISOString().slice(0, 10);
        // 当天已领次数:数 credit_tx 当天 share 行
        const cntResp = await supabaseAdmin(
          `/credit_tx?user_id=eq.${caller.id}&tx_type=eq.share&created_at=gte.${today}T00:00:00Z&select=id`, { method: 'GET' });
        const rows = cntResp.ok ? await cntResp.json() : [];
        const used = rows.length;
        if (used >= MAX_PER_DAY) {
          return new Response(JSON.stringify({ success:false, reason:'daily_limit_reached' }),
            { status: 200, headers: { 'Content-Type':'application/json', ...corsHeaders } });
        }
        const n = used + 1;
        const g = await creditGrant(caller.id, SHARE_BONUS, 'share', null, `share:${caller.id}:${today}:${n}`, 'Share bonus');
        if (!g) throw new Error('Share grant failed');
        await mirrorBalanceToMeta(caller.id, g.balance_after, caller.meta);
        return new Response(JSON.stringify({ success:true, newCredits: g.balance_after, newCount: n }),
          { status: 200, headers: { 'Content-Type':'application/json', ...corsHeaders } });
      } catch (err) {
        const code = err.httpStatus === 401 ? 401 : 500;
        return new Response(JSON.stringify({ success:false, errMessage: err.message }),
          { status: code, headers: { 'Content-Type':'application/json', ...corsHeaders } });
      }
    }
```
> 限频用"数当天 share tx"而非客户端 count。幂等键 `share:uid:date:n` 防同一次重复提交。轻度并发下两次同时读 used 可能各拿同 n → 幂等键唯一索引让其一失败回幂等(少给一次,可接受;不会超发)。

- [ ] **Step 2: 前端 `handleShareCredits` 改调端点**

替换 `src/api/supabaseClient.js:128-150` 整个函数:
```js
export const handleShareCredits = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, reason: 'not_signed_in' };
  try {
    const res = await fetch('/api/credits/claim-share', {
      method: 'POST', headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const body = await res.json();
    if (body?.success) { try { await supabase.auth.refreshSession(); } catch {} }
    return body;
  } catch (err) { return { success: false, errMessage: err.message }; }
};
```

- [ ] **Step 3: 验证**

```bash
for i in 1 2 3 4; do curl -s -X POST http://localhost:8787/api/credits/claim-share -H "Authorization: Bearer $JWT"; echo; done
```
Expected: 前 3 次 `success:true newCount:1/2/3` 各 +10;第 4 次 `daily_limit_reached`。SQL 查当天 share tx 行数 = 3。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js src/api/supabaseClient.js
git commit -m "feat(credits): server-side share bonus endpoint + frontend wire-up"
```

---

### Task 11: admin 手动发放改走 grant_credits + 镜像

**Files:**
- Modify: `public/_worker.js`(handler `9020`,原写 `9089-9100`)

- [ ] **Step 1: 复核 handler**

Run: `grep -n "grant-credits\|grant-tokens" public/_worker.js`
Expected: 确认端点 + is_admin 校验位置(约 9036)。

- [ ] **Step 2: 替换写逻辑**

保留 is_admin 校验;把"读目标 meta → admin PUT credits/tokens"(9089-9100)替换为:
```js
        const g = await creditGrant(targetUserId, amount, 'admin_grant', null, null, `Admin grant by ${caller.email || caller.id}`);
        if (!g) throw new Error('Admin grant failed');
        // 读目标用户当前 meta 做镜像(admin 操作的是他人,需先取 meta)
        const tu = await fetch(`${SUPA_URL}/auth/v1/admin/users/${targetUserId}`, {
          headers: { 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': env.SUPABASE_SERVICE_ROLE_KEY }
        });
        const tMeta = tu.ok ? (await tu.json())?.user_metadata || {} : {};
        await mirrorBalanceToMeta(targetUserId, g.balance_after, tMeta);
        return new Response(JSON.stringify({ success:true, credits: g.balance_after, tokens: g.balance_after }),
          { status: 200, headers: { 'Content-Type':'application/json', ...corsHeaders } });
```
> 变量名 `targetUserId`/`amount`/`caller` 以 handler 实际为准(grep 确认它怎么解析目标用户和数量;`amount` 支持正数发放——若原支持负数扣减,负数走 `creditSpend` 或保留;本任务只处理正数发放,负数发放属罕见 admin 操作,若存在则 grep 后补 spend 分支)。

- [ ] **Step 3: 验证**

用 admin JWT:
```bash
curl -s -X POST http://localhost:8787/api/admin/grant-credits -H "Authorization: Bearer $ADMIN_JWT" -H 'Content-Type: application/json' -d '{"userId":"<target>","amount":50}'
```
Expected: `success` 且目标 `user_credits.balance` +50,`user_metadata.tokens` 镜像同步。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): admin grant via grant_credits + mirror"
```

---

### Task 12: Stripe webhook 月度 + 充值 改走 grant_credits(幂等=event_id)

**Files:**
- Modify: `public/_worker.js`(月度 `8370-8374`,充值 `8684-8690`)

- [ ] **Step 1: 复核两处 + 找 event id**

Run: `grep -n "monthly_credits\|invoice.payment_succeeded\|updateSupabaseMeta\|event.id\|stripeEvent" public/_worker.js | head`
Expected: 确认月度发放、充值发放代码,以及 webhook event id 变量名(用作幂等键)。

- [ ] **Step 2: 月度发放替换**

把 8370-8374 的"`newBalance = meta.credits + monthly_credits` → updateSupabaseMeta"替换为:
```js
        const g = await creditGrant(targetUserId, monthlyCredits, 'stripe_subscription', subscriptionId || null, `stripe:${eventId}`, 'Monthly subscription credits');
        if (g && !g.idempotent) await mirrorBalanceToMeta(targetUserId, g.balance_after, currentMeta);
        // tier 仍按原逻辑写 user_metadata(本轮不动 tier);若原 updateSupabaseMeta 同时写 tier+credits,
        // 改为只写 tier(credits 已由 grant 处理),避免覆盖权威余额。
```
> 关键:**tier 写入保留,credits 写入移除**(原 `updateSupabaseMeta({tier,credits})` → 只 `{tier}`)。grep 确认 updateSupabaseMeta 调用,拆出 tier-only。

- [ ] **Step 3: 充值发放替换**

把 8684-8690 的充值加 credits 逻辑替换为 `grant_credits(uid, topupAmount, 'stripe_topup', sessionId, 'stripe:'+eventId, 'Top-up')` + 镜像。变量名以实际为准。
> 注意:这是 **credits/tokens 充值**,与 U-Coin 钱包(`wallet_credit_purchase`)是两套,别混。grep 确认这段确实写 user_metadata.credits/tokens 而非 wallet_balance。

- [ ] **Step 4: 验证(幂等)**

无法本地真发 Stripe webhook。用 SQL 验证幂等键:
```sql
SELECT public.grant_credits('<uid>'::uuid, 300, 'stripe_subscription', null, 'stripe:evt_test', 'sim');
SELECT public.grant_credits('<uid>'::uuid, 300, 'stripe_subscription', null, 'stripe:evt_test', 'sim'); -- idempotent:true
SELECT count(*) FROM credit_tx WHERE idempotency_key='stripe:evt_test'; -- =1
```
Expected: 第二次 `idempotent:true`;count=1(重放 webhook 不重复发)。清理。

- [ ] **Step 5: Commit**

```bash
git add public/_worker.js
git commit -m "feat(credits): Stripe subscription+topup via grant_credits (idempotent on event_id), tier-only meta write"
```

---

## Phase 5 — 前端读余额 + 移除客户端扣费

### Task 13: `getUserProfile` 读 user_credits + 欢迎金 ensure

**Files:**
- Modify: `src/api/supabaseClient.js`(`getUserProfile` `44-66`,`updateCredits` `71-83`)

- [ ] **Step 1: 重写 getUserProfile**

```js
export const getUserProfile = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return { credits: 0, tier: 'free' };

  let tier = user.user_metadata?.tier;
  if (tier === undefined) {
    tier = 'free';
    try { await supabase.auth.updateUser({ data: { tier } }); } catch {}
  }

  // 权威余额:user_credits(RLS 只读自己)。无行 → 首登,ensure 欢迎金。
  let balance = 0;
  const { data: rows } = await supabase.from('user_credits').select('balance').eq('user_id', user.id).limit(1);
  if (rows && rows.length > 0) {
    balance = rows[0].balance;
  } else {
    try {
      const { data: ens } = await supabase.rpc('ensure_user_credits', { p_welcome: 20 });
      balance = ens?.balance ?? 20;
    } catch { balance = 0; }
  }

  return {
    credits: balance, tokens: balance, tier,
    lastShareDate: user.user_metadata?.lastShareDate,
    dailyShareCount: user.user_metadata?.dailyShareCount,
  };
};
```
> 不再在 user_metadata 写 credits。`ensure_user_credits` 已 GRANT 给 authenticated(Task 2)。

- [ ] **Step 2: 废弃 updateCredits 的写语义**

`updateCredits` / `updateTierAndCredits` 不再写 user_metadata.credits(权威在服务端)。把 `updateCredits` 改为只读返回当前余额(兼容残留调用方,直到 Task 14 删完),或直接删除并清理调用方。推荐:
```js
// @deprecated 余额改由服务端 RPC 管理。保留为只读返回当前余额,Task 14 清理调用方后删除。
export const updateCredits = async () => {
  const { credits } = await getUserProfile();
  return credits;
};
```
`updateTierAndCredits`:tier 仍可客户端写(本轮不动 tier),credits 部分删除:
```js
export const updateTierAndCredits = async (tier) => {
  await supabase.auth.updateUser({ data: { tier } });
  const { credits } = await getUserProfile();
  return { tier, credits };
};
```

- [ ] **Step 3: 验证读路径**

`npm run dev`,登录测试用户,打开侧栏 / Subscription / Settings 页。
Expected: 余额显示 == SQL 里 `user_credits.balance`;新用户首登显示 20 且 user_credits 出现新行。

- [ ] **Step 4: Commit**

```bash
git add src/api/supabaseClient.js
git commit -m "feat(credits): getUserProfile reads user_credits; deprecate client-side credit writes"
```

---

### Task 14: StoryGeneratorPage 删客户端扣费/退款,改用服务端余额

**Files:**
- Modify: `src/pages/StoryGeneratorPage.jsx`(扣费 `1943/2354/2683`,退款 `1960/2457`,credits state `938/945`)

- [ ] **Step 1: 删除客户端扣费调用**

把三处 `await updateCredits(-cost)`(1943/2354/2683)删除。扣费现在由 worker 端点自动完成(video/submit、storyboard)。**保留**成本计算(`computeFreeModeCredits` 等)用于 UI 预览 + 软预检。

- [ ] **Step 2: 删除客户端退款调用**

把退款 `await updateCredits(cost)`(1960/2457)删除——退款由 worker 同步/异步处理。

- [ ] **Step 3: 保留软预检 + 处理服务端 insufficient**

预检(`if (credits < cost)` 弹 paywall,1891/1904/1927)保留作为 UX 提前拦截。生成端点返回 402/`insufficient` 时,沿用现有错误映射(287)弹 paywall。在调用 video/submit、storyboard 的 fetch 后,若 `res.status===402 || body.insufficient`,触发与预检相同的 paywall。grep 这些 fetch 调用点,统一加判断。

- [ ] **Step 4: 生成后用响应余额刷新**

worker video/submit / storyboard 成功响应可回带 `balance_after`(Task 4/6 的 success 响应已含 spendInfo;若未含则在 success JSON 加 `balance_after: spendInfo.balance_after`)。前端成功后 `setCredits(body.balance_after ?? (await getUserProfile()).credits)`。替换原 `setCredits(c => c - cost)`(1945/1961 等)。
> 若 Task 4/6 success 响应未含 balance,在那两个端点的 success Response JSON 里补 `balance_after`。回到 worker 加一行。

- [ ] **Step 5: 验证完整流程**

`npm run dev`,登录余额充足用户:
- Quick Mode 渲染 → storyboard 扣 3 + 视频扣视频成本,UI 余额按响应刷新,总额与旧逻辑一致。
- 余额不足用户 → 弹 paywall,不发起生成。
Expected: 余额变化正确;无客户端直接改余额;insufficient 正常拦截。

- [ ] **Step 6: Commit**

```bash
git add src/pages/StoryGeneratorPage.jsx public/_worker.js
git commit -m "feat(credits): StoryGeneratorPage drop client-side deduct/refund, use server balance"
```

---

### Task 15: 核对其余读余额点 + AdminDashboard 看他人余额

**Files:**
- Modify: `public/_worker.js`(admin 用户列表 handler `5628`)
- Verify: `src/components/NavigationBar.jsx:99/105`、`src/pages/SubscriptionPage.jsx`、`src/pages/SettingsPage.jsx`(经 getUserProfile,应自动正确,只需核对)

- [ ] **Step 1: 核对自动迁移的读点**

Run: `grep -rn "getUserProfile" src/`
Expected: 确认 NavigationBar/Subscription/Settings/StoryGenerator 都经 getUserProfile 读余额(Task 13 已改),无需额外改;若有直接读 `user_metadata.credits` 的,改为 getUserProfile。

- [ ] **Step 2: AdminDashboard 用户列表 join 余额**

admin 用户列表(worker 5628 拉 `/auth/v1/admin/users`)目前余额来自 user_metadata,会陈旧。在返回前用 service_role 批量查 user_credits 合并:
```js
        // §2026-05-29 余额改读 user_credits(user_metadata 仅过渡镜像,可能陈旧)
        const ids = pageUsers.map(u => u.id);
        let balMap = {};
        if (ids.length) {
          const inList = ids.map(encodeURIComponent).join(',');
          const bResp = await supabaseAdmin(`/user_credits?user_id=in.(${inList})&select=user_id,balance`, { method: 'GET' });
          if (bResp.ok) for (const r of await bResp.json()) balMap[r.user_id] = r.balance;
        }
        // 在组装每个 user 的返回对象时:credits/tokens 用 balMap[u.id] ?? (meta fallback)
```
> grep handler 内组装 user 对象的位置(约 5727 `const meta = u.user_metadata`),把 credits/tokens 字段改为 `balMap[u.id] ?? meta.tokens ?? meta.credits ?? 0`。

- [ ] **Step 3: 验证**

`npm run dev` 用 admin 账号看用户列表。
Expected: 列表余额 == 各用户 `user_credits.balance`(对手动改过 user_credits 的测试用户尤其能看出差异)。

- [ ] **Step 4: Commit**

```bash
git add public/_worker.js src/
git commit -m "feat(credits): admin user list reads authoritative user_credits balance"
```

---

## Phase 6 — 上线

### Task 16: 全量验证 + 部署 + 线上冒烟

**Files:** 无(部署 + 验证)

- [ ] **Step 1: 全量 build**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 2: 确认 DB migration 已 push**

Run: `supabase migration list --linked 2>/dev/null | tail` (或 SQL 查 `\df spend_credits`)
Expected: `20260529000001` + `20260529000002` 已 applied;`spend_credits/grant_credits/ensure_user_credits` 存在。

- [ ] **Step 3: 本地 preview 端到端冒烟**

Run: `npm run preview`,逐项 curl(用真实 JWT):
- 匿名打 4 端点 → 全 401
- video/submit / storyboard 余额足 → 扣费正确;余额不足 → 402
- claim-daily 两次 → claimed true/false
- claim-share 4 次 → 3 次成功 + 1 次 limit
Expected: 全部符合。

- [ ] **Step 4: 部署 production(CLAUDE.md 链路)**

Run: `git checkout main && git pull && npm run deploy`
> 必须 main 分支(check-deploy-branch.mjs 护栏)。**绝不用 wrangler pages。**
Expected: `wrangler deploy` 成功,Worker + assets 上 uvera.ai。

- [ ] **Step 5: 线上冒烟**

```bash
curl -sI https://uvera.ai/ | grep -iE "cf-mitigated|HTTP"          # 200,无 challenge
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://uvera.ai/api/volcengine/video/submit -H 'Content-Type: application/json' -d '{"prompt":"x","resolution":"480p","duration":5}'  # 401(匿名)
curl -sL https://uvera.ai/ | grep -oE 'index-[A-Za-z0-9_]+\.js' | head -1   # 与本地 dist 一致
```
浏览器登录真实账号:看余额显示正常、跑一次生成扣费正确、刷新后余额持久。
Expected: 匿名生成端点 401;登录用户余额正确扣减;无 split-brain(刷新/换设备余额一致)。

- [ ] **Step 6: 回填复核(线上)**

SQL:抽样 10 个活跃用户,对比 `user_credits.balance` 与他们近期行为合理性;确认无人余额异常归零。
Expected: 无异常。如个别用户 user_credits 缺行(回填后新增但未 ensure),登录一次即 ensure 补 20——或手动 grant 修正。

---

## Self-Review(已对照 spec 自检)

- **Spec §3 数据模型** → Task 1/2 ✅(表 + RLS + credit_tx 唯一 idem 索引)
- **Spec §4 RPC** → Task 2 ✅(spend/grant/ensure;退款复用 grant + idemKey)
- **Spec §5 worker** → Task 3(helper)/4(video 扣费+同步退款)/5(异步退款)/6-8(端点鉴权)✅
- **Spec §6 增减点切换** → Task 9(daily)/10(share)/11(admin)/12(stripe)✅;欢迎金 → Task 2 ensure + Task 13 ✅
- **Spec §7 前端** → Task 13(读)/14(删客户端扣费)/15(读点核对 + admin)✅
- **Spec §8 迁移/镜像** → Task 1 回填;冷路径镜像 `mirrorBalanceToMeta` 用于 daily/share/admin/stripe(grant),热路径 spend 不镜像 ✅
- **Spec §10 决策** → 拆分扣费(Task 14 总额不变分两次)✅;storyboard 统一扣 3(Task 6)✅;冷路径镜像 ✅;tier 洞不并入(全程未动 tier 写,仅在 stripe 处保留 tier-only 写)✅
- **类型一致性**:`creditSpend` 返回 `{balance_after, spent}`、`creditGrant` 返回 `{balance_after, idempotent?}`、RPC 入参 `p_*` 命名 worker 调用处一致 ✅
- **占位扫描**:无 TBD;所有 SQL/JS 代码块完整;行号标注为快照并要求实现前 grep 复核 ✅
- **已知执行注意**:多处 worker 编辑需把 `let caller/callerId/chargedCredits` 声明提到 try 外以便 catch 可见(各 Task 已注明);各 handler 的 `corsHeaders` 变量名以实际为准(已注明 grep)。

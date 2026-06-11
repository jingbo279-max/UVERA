---
title: 生成积分服务端化 + 鉴权 — Design Spec
type: spec
status: active
owner: fei
created: 2026-05-30
updated: 2026-05-30
tags: [credit, enforcement, backend]
---

# 生成积分服务端化 + 鉴权 — Design Spec

> 2026-05-29 · 作者 Claude(接 fei 指令)· 状态:待 fei 评审
> 对应扫查发现:G1(无服务端配额)/ G2(扣费非原子)/ G3(退款丢失)/ G7(video/submit 无鉴权)

---

## 1. 问题与目标

### 病因
用户"积分/token"权威余额存在 Supabase `user_metadata.credits` / `user_metadata.tokens`。**`user_metadata` 用户自己就能写**(`supabase.auth.updateUser({ data: { credits } })`),所以服务端任何"读 user_metadata 余额再校验"都无意义——用户一句 `updateUser` 即可把自己改到任意值。

叠加三个洞:
- **G7**:`/api/volcengine/video/submit`(`public/_worker.js:1884`)鉴权可选,匿名也放行,直接调 BytePlus(真计费)。`/api/generate-storyboard`(3487)/`/api/generate-character-board`(3850)/`/api/generate-multi-segment-script`(4631)同样**不要求登录**,匿名即可烧 OpenAI/Gemini。
- **G1**:4 个端点全部**不做服务端余额校验/扣费**,扣费 100% 在前端(`updateCredits`)。
- **G2**:`updateCredits`(`src/api/supabaseClient.js:71`)是 `user_metadata` 的读-改-写,并发双扣/丢扣。
- **G3**:生成失败退款只在前端 try/catch,关 tab / session 失效 → 退款静默丢失。

### 目标
1. 权威余额搬到服务端只写的存储,前端无法篡改。
2. 4 个生成端点全部**要求登录**(挡匿名烧钱)。
3. 真正花钱的生成(视频)**服务端原子扣费**,失败(含异步终态)**服务端原子退款**。
4. 不制造余额 split-brain:所有积分增减点统一切到新存储。

### 非目标(本轮不做,单列后续)
- `user_metadata.tier` 同样用户可写 → watermark/会员越权洞(**相关高危**,见 §9)。
- 结算/钱包 W1/W2/W3、播放器 PL1/PL2 等其它扫查项。
- 给"脚本生成 / character-board"**新增收费**(目前产品免费,本轮只加鉴权,不改定价)。

---

## 2. 方案根基(已与 fei 对齐)

- **存储**:新表 `user_credits` + SECURITY DEFINER RPC(照搬钱包 `wallet_unlock_episode` / `wallet_refund_purchase` 范式)。
- **范围**:全部 4 个生成端点加鉴权;视频路径服务端扣费+退款。
- **退款**:本轮一起做服务端退款(含 video 异步 `/status` 终态)。

---

## 3. 数据模型

### 3.1 `user_credits`(权威余额)
```sql
CREATE TABLE public.user_credits (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  lifetime_granted integer NOT NULL DEFAULT 0,
  lifetime_spent   integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;
-- 只读自己;无 insert/update/delete 策略 → 仅 service_role / SECURITY DEFINER 能写
CREATE POLICY user_credits_select_own ON public.user_credits
  FOR SELECT USING (user_id = auth.uid());
```

### 3.2 `credit_tx`(流水 + 幂等锚点,镜像 wallet_tx)
```sql
CREATE TABLE public.credit_tx (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount        integer NOT NULL,           -- 负=扣,正=增/退
  balance_after integer NOT NULL,
  tx_type       text NOT NULL,              -- spend_video | spend_storyboard | refund | welcome | daily | share | admin_grant | stripe_subscription | stripe_topup
  reference     text,                       -- task_id / logId / 业务引用
  idempotency_key text,                     -- 幂等锚点(见下)
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_tx_idem ON public.credit_tx (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```
幂等键约定:退款 `refund:<task_id>`;每日 `daily:<uid>:<YYYY-MM-DD>`;分享 `share:<uid>:<YYYY-MM-DD>:<n>`;Stripe `stripe:<event_id>`。`credit_tx` 唯一索引 = 防双花/双退/重放的最终防线。

---

## 4. RPC(SECURITY DEFINER,GRANT 给 service_role)

全部 `RETURNS jsonb`、`SET search_path=public`、`SELECT ... FOR UPDATE` 行锁、缺行则建(与钱包一致)。worker 经 `supabaseAdmin('/rpc/<fn>')` 调用(`public/_worker.js:7401`)。

### 4.1 `spend_credits(p_user_id, p_amount, p_tx_type, p_reference, p_description)`
锁 `user_credits` 行 → `balance >= p_amount` 校验 → 扣 → 写 `credit_tx`。
返回 `{success, balance_after, spent}` 或 `{success:false, insufficient:true, required, current}`。

### 4.2 `grant_credits(p_user_id, p_amount, p_tx_type, p_reference, p_idempotency_key, p_description)`
锁 → 加 → 写 `credit_tx`。带 `p_idempotency_key` 时,若已存在该键的 tx → 直接返回幂等成功(不重复加)。用于退款/每日/分享/Stripe/admin。
返回 `{success, balance_after, credited, idempotent?}`。

### 4.3 `ensure_user_credits(p_user_id, p_welcome)`
缺行则 INSERT(`balance=p_welcome`,写一条 `welcome` tx);已存在则 no-op。用于欢迎金(替代 getUserProfile 里的 +20 初始化)。

> 说明:退款复用 `grant_credits`(正数加回)+ 幂等键 `refund:<task_id>`,无需单独 refund 函数;floor 不适用(我们加回的是确切扣过的额度)。

---

## 5. Worker 改动(`public/_worker.js`)

### 5.1 公共 helper(新增)
- `requireUser(request, env)`:解析 JWT(`/auth/v1/user`),无效/缺失 → 抛 401。复用现有解析逻辑(1903-1916)抽出来。
- `creditSpend(env, userId, amount, txType, ref, desc)` / `creditGrant(env, userId, amount, txType, ref, idemKey, desc)`:封装 `supabaseAdmin('/rpc/spend_credits'|'/rpc/grant_credits')`,统一错误。
- `computeVideoCost(resolution, duration, modelId, env)`:服务端权威成本 = `ceil(CREDITS_PER_SEC[res] × duration × modelMultiplier)`。`CREDITS_PER_SEC{480p:4,720p:6,1080p:12}` 已存在(2209);`modelMultiplier` 从 worker 的 video-models 源取(与 `/api/video-models` 同源,客户端不可覆盖)。

### 5.2 四个端点
| 端点 | 鉴权 | 扣费 | 退款 |
|---|---|---|---|
| `video/submit` (1884) | **必须登录**(匿名 401) | `spend_credits(computeVideoCost)` 在调 BytePlus **之前** | submit 同步失败(2282)→ `grant_credits` 退;**异步终态见 5.3** |
| `generate-storyboard` (3487) | 必须登录 | `spend_credits(3)` 调 OpenAI 前 | 同步失败(3817)→ 退 |
| `generate-character-board` (3850) | 必须登录 | **不扣**(维持免费) | — |
| `generate-multi-segment-script` (4631) | 必须登录 | **不扣**(维持免费) | — |

成本由服务端按请求参数(resolution/duration/model)计算,客户端传的成本一律忽略。

### 5.3 video 异步失败退款(挂在 `/status`)
`GET /api/volcengine/video/status/:taskId`(4852)在把 `(task_id, status='started')` PATCH 成 `failed`/`timeout`(4920-4938)时:**当且仅当该 PATCH 实际翻转了一行**,调 `grant_credits(amount, 'refund', task_id, idemKey='refund:'+task_id)`。退款额从生成时记录取:扣费时把 `spent` 写进 `generation_logs.tokens_charged`(已有列),退款读它。`credit_tx` 唯一索引 + `status=eq.started` 过滤 = 双重幂等,轮询多次只退一次。

---

## 6. 积分增减点统一切换(防 split-brain)

所有写余额的地方改成走 RPC / user_credits:

| 来源 | 现状 | 改为 |
|---|---|---|
| 欢迎金 +20 | `getUserProfile` 客户端(supabaseClient.js:57/62) | `ensure_user_credits(uid, 20)`(首次读时由 worker 触发,或注册时) |
| 每日 +6 | worker claim-daily 已服务端(8979 改 user_metadata) | `grant_credits(6,'daily',idem='daily:uid:date')`,去掉 last_claim_date 手判(靠幂等键) |
| 分享 +10(≤3/日) | `handleShareCredits` 客户端(supabaseClient.js:140) | **新 worker 端点** `/api/credits/claim-share`,服务端限频 + `grant_credits` |
| admin 发放 | worker grant-credits(9089 改 user_metadata) | `grant_credits('admin_grant')` |
| Stripe 月度 | webhook 8370-8374 | `grant_credits('stripe_subscription', idem='stripe:'+event_id)` |
| Stripe 充值 | webhook 8684-8690 | `grant_credits('stripe_topup', idem='stripe:'+event_id)` |

---

## 7. 前端改动

- `getUserProfile`(supabaseClient.js):balance 改为查 `user_credits`(RLS 只读自己,PK 查询快);`tier` 仍读 session。新增内存/localStorage 乐观缓存,避免侧栏闪 0(沿用 2026-05-08 的"先显示缓存再更新")。
- 删除客户端扣费/退款:`updateCredits(-cost)`(1943/2354/2683)与对应退款(1960/2457)、`handleShareCredits` 客户端加币逻辑。保留**软预检**(用已知余额提前弹 paywall,改善 UX),服务端为准。
- "余额不足"错误:由 `spend_credits` 返回 → worker 返 402/明确 message,前端已有 insufficient 映射(StoryGeneratorPage.jsx:287)复用。
- 读余额点同步更新:`NavigationBar.jsx:99/105`、`SubscriptionPage.jsx`、`SettingsPage.jsx`、`StoryGeneratorPage.jsx:938/945`。生成/领取响应回带 `balance_after`,前端 `setCredits` 即时刷新。
- AdminDashboard 看他人余额(1727/1756/2180/2315/2873):管理员用户列表需 join `user_credits` 余额(worker 端点合并返回),否则显示陈旧。
- 分享:`handleShareCredits` 改调新 `/api/credits/claim-share`。

---

## 8. 迁移、回填、上线顺序

1. **DB migration**(两份:`supabase/migrations/<ts>_user_credits_rpc.sql` + `migrations/` 归档):建表 + RPC + 回填。
   回填(非破坏,不动 user_metadata):
   ```sql
   INSERT INTO public.user_credits (user_id, balance, lifetime_granted)
   SELECT id, COALESCE((raw_user_meta_data->>'tokens')::int,
                       (raw_user_meta_data->>'credits')::int, 0) AS bal,
          COALESCE((raw_user_meta_data->>'tokens')::int,
                   (raw_user_meta_data->>'credits')::int, 0)
   FROM auth.users
   ON CONFLICT (user_id) DO NOTHING;
   ```
2. `supabase db push --linked` 先于 worker 部署(worker 要调 RPC)。
3. `npm run deploy`(worker + 前端同 bundle,原子)。
4. curl 验证 + 冒烟:登录态生成扣费、匿名 401、失败退款、每日/分享幂等。

### 上线安全(已定:冷路径 grant 镜像)
**过渡镜像**:在**冷路径 grant**(每日/分享/Stripe/admin/欢迎金)best-effort 把 balance 镜像回 `user_metadata.tokens`(失败不阻断);**热路径 spend(视频扣费)不镜像**(省延迟)。同时确保 §7 所有读点已迁移到 `user_credits`。好处:遗漏读点 / 回滚到旧代码时仍读到大致正确余额而非 0。镜像仅为过渡保险,下一个 release 可移除。

---

## 9. 相关高危(已定:下一轮单独处理)
`user_metadata.tier` 同样用户可写 → 用户可自设 `tier:'studio'` 绕过 watermark(video/submit:1932 用 callerTier 判)+ 越权 drama 会员内容。**与本洞同源**(信任 user_metadata)。**本轮不并入**(聚焦烧钱洞按时上线);tier 洞紧随其后单独一轮(搬到 `app_metadata`,只 service_role 可写、进 JWT 仍可前端读)。

---

## 10. 已定决策(2026-05-29 fei 拍板)
1. **拆分扣费**:✅ 接受。Quick Mode 由"入口一次性预扣"改为 storyboard 端点扣 3 + video 端点扣视频成本(总额不变,按消耗分两次)。
2. **原免费 storyboard 调用方**:✅ 统一收费 3(每次都真烧 OpenAI,原免费=在亏损;实现时排查到的免费流程一律改为扣 3)。
3. **过渡镜像**:✅ 冷路径 grant 镜像回 user_metadata.tokens,热路径 spend 不镜像(见 §8)。
4. **tier 越权洞**:✅ 下一轮单独处理(见 §9)。

---

## 11. 测试要点
- RPC:并发 spend(无双扣)、insufficient、grant 幂等键去重、ensure 欢迎金一次性。
- 端点:匿名 401;余额不足 402;扣费后余额准确;同步失败退款;video 异步 `failed`/`timeout` 退一次(轮询多次不重复);成本由服务端算(客户端传假成本无效)。
- 增减点:每日/分享幂等;Stripe 重放 webhook 不重复发;admin 发放。
- 前端:读余额无闪 0;insufficient 弹 paywall;响应回带余额即时刷新。
- 回填:抽样核对 user_credits.balance == 旧 user_metadata 余额。

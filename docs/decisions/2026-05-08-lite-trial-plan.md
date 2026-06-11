---
title: Lite Plan — 后端协作清单（费）
type: decision
status: active
owner: Leon
created: 2026-05-08
updated: 2026-05-14
tags: [decision, adr]
---

# Lite Plan — 后端协作清单（费）

> **Status**: ✅ **SHIPPED 2026-05-09**, **UPDATED 2026-05-14**.
> - 2026-05-09: pivoted from "paid trial that auto-converts to Starter"
>   → **simple one-time $3.99 purchase** (no trial, no auto-conversion).
>   Stripe `mode='payment'`, webhook handles `checkout.session.completed`.
> - 2026-05-14: 加入**阶梯定价**修复 unit-economics 反转 —— 重复购买价格
>   递增（$3.99 → $5.99 → $7.99），让 Starter $25/mo 变成长期使用
>   的理性选择。详见底部 "Tiered Pricing 2026-05-14"。
> **Decision date**: 2026-05-08 (frontend stub) / 2026-05-09 (pivot to
> one-time purchase per Leon: 自动跳转高级会员 unreasonable)
> **Stakeholders**: Leon (frontend / design), 费 (backend / Stripe / DB)

## 概览

新增 **Lite trial plan**，在 `Free` 与 `Starter` 之间作为 paid entry：

- **价格**：$3.99（一次性 trial 费）
- **Trial 期**：7 天
- **Token 额度**：**100 tokens / 7 天**（占位数值，待甲方/费给最终值）
- **到期行为**：**自动转 Starter $25/月**（不退订则正常计费）
- **取消**：trial 7 天内取消 → 不收费 + 不进入 Starter；trial 后取消走标准 Starter 取消流程

## Frontend 已落地（Leon）

`src/pages/SubscriptionPage.jsx`：

1. `PLANS` 数组 free 与 starter 之间插入 lite plan 卡片：
   ```js
   {
     id: 'lite',
     name: 'Lite',
     icon: Sparkle,
     color: 'text-indigo-500 dark:text-indigo-400',
     accent: 'indigo',
     isFree: false,
     isTrial: true,
     trialPrice: 3.99,
     trialDays: 7,
     backendReady: false,
     credits: '100 tokens / 7-day trial',
     desc: '7-day taste · auto-converts to Starter ($25/mo)',
     features: [
       '100 trial tokens',
       'Watermark-free export',
       'Voice cloning (Basic)',
       'Auto-converts to Starter $25/mo after 7 days',
       'Cancel anytime in 7 days to avoid the charge',
     ],
   }
   ```

2. `CTA_COPY.lite`：
   ```js
   lite: {
     label: 'Try Lite — $3.99',
     heading: '100 tokens · 7-day trial then $25/mo Starter',
     desc: 'Quick taste of paid features for $3.99. After 7 days, auto-converts to Starter at $25/mo. Cancel anytime in the 7-day window to avoid the charge.',
     btn: 'Coming soon',
     disabled: true,  // ← backend 就绪后改 false
   }
   ```

Checkout 按钮当前 `disabled: true`，标 "Coming soon"。点击无操作。

## 后端 TODO（费）

### 1. Stripe Product / Price 创建

- 新建 Product `Uvera Lite Trial` (或类似命名)
- Price 设计：选其一
  - **方案 A**: Stripe `setup_intent` + `subscription` with `trial_period_days: 7`，trial 结束自动 charge Starter recurring price ($25/mo)，trial 期收 $3.99 setup fee
  - **方案 B**: 一次性 $3.99 charge + 用 webhook 在 7 天后创建 Starter subscription（更复杂）

> **建议方案 A**（Stripe-native trial 流程更稳）

需要新建：
- `STRIPE_PRICE_LITE_TRIAL_FEE`：$3.99 one-time / setup fee
- 复用现有 `STRIPE_PRICE_STARTER_MONTHLY` 作为 trial 后 recurring price

### 2. `/api/stripe/checkout` endpoint 扩展

目前 frontend 调用：
```js
POST /api/stripe/checkout
Body: { tier: 'starter' | 'creator' | 'studio', billing: 'monthly' | 'yearly' }
```

需扩展：
```js
Body: { tier: 'lite' | 'starter' | 'creator' | 'studio', billing: 'monthly' | 'yearly' }
```

`tier === 'lite'` 时：
- 创建 Stripe Checkout Session with `mode: 'subscription'`
- 设置 `subscription_data.trial_period_days: 7`
- 添加 line item: Lite trial fee $3.99 (one-time) + Starter monthly subscription
- success_url / cancel_url 与现有一致（落 `/subscription?checkout=success`）

### 3. Webhook trial conversion 处理

`POST /api/stripe/webhook` 监听以下事件：

| Event | 行为 |
|---|---|
| `customer.subscription.trial_will_end` | 提前 3 天发邮件提示 user trial 将到期（可选）|
| `customer.subscription.updated` (status 从 `trialing` → `active`) | trial 结束转 Starter，更新 `user_metadata.tier = 'starter'` |
| `customer.subscription.deleted` (trial 期内) | 用户 7 天内取消，更新 `user_metadata.tier = 'free'` |
| `invoice.payment_failed` | trial 后第一笔 Starter charge 失败 → 降级 free |

### 4. DB schema 变更

`user.user_metadata.tier` enum **加 `'lite'` 值**（trial 期内 user.tier = 'lite'）：

```sql
-- supabase auth schema 不直接管 enum，但应用层校验需更新
-- src/api/supabaseClient.js 里 getUserProfile / updateTierAndCredits 等需支持 'lite'
```

App 层 enum 检查点（费需更新）：
- `getUserProfile()` default value list
- `updateTierAndCredits()` accept 'lite'
- 任何 tier-gated feature check（mutate access / advanced features）需决定 lite 与 starter 等同还是 lite-restricted

> **token 配额发放**：trial 期内 `credits = 100`（一次性 grant，不重置）。
> 到期转 starter 后 standard 月度 500 token grant 启动。

### 5. Frontend 一并需调整（费完成后告知 Leon）

- `PLANS[lite].backendReady = true`
- `CTA_COPY.lite.btn = 'Start Lite trial — $3.99 →'`
- `CTA_COPY.lite.disabled = false`
- handleCheckout 自动覆盖 lite tier (走 `/api/stripe/checkout` body tier='lite')

## 数值待确认（甲方 / 费）

| 项 | 占位值 | 待定 |
|---|---|---|
| Trial 价格 | $3.99 | 是否调整 |
| Trial 天数 | 7 | 是否调整 |
| Trial token 额度 | 100 | **甲方/费定** |
| Auto-convert 目标 plan | Starter $25/mo | 是否需要选 plan? |
| 用户能否多次 trial | 限制（一个邮箱一次）| 默认 yes，DB 加 `has_used_lite_trial: true` 标记 |

## 关联

- `src/pages/SubscriptionPage.jsx` — frontend 落地位置
- `src/api/supabaseClient.js` — backend metadata 读写
- `wrangler.jsonc` — Cloudflare Workers env vars (Stripe price IDs)
- `docs/decisions/2026-04-29-subscription-into-session-3.md` — Subscription scope 上下文

---

## Implementation 2026-05-09 (pivot to one-time purchase)

### Why we pivoted

Initially shipped the canonical Stripe paid-trial pattern (subscription
mode + `trial_period_days=7` + `add_invoice_items[$3.99]`). Leon flagged
that the auto-conversion to $25/mo Starter "对用户不合理" — users buying
a $3.99 product don't expect to be auto-enrolled in a $25 recurring
charge, even with a 7-day cancellation window. High refund / dispute
risk, also bad ToS optics.

Pivoted same-day to a **clean one-time purchase**: $3.99 buys 100 tokens,
sets tier='lite', no subscription is ever created. User can re-purchase
or upgrade to Starter/Creator/Studio (which DO become subscriptions) at
their own initiative.

### Implementation

```js
// public/_worker.js — /api/stripe/checkout when tier === 'lite'
const sessionParams = {
  mode: 'payment',  // ← key change: not 'subscription'
  customer: stripeCustomerId,
  'line_items[0][price]': env.STRIPE_PRICE_LITE_TRIAL,  // $3.99 one-time price
  'line_items[0][quantity]': '1',
  'metadata[uvera_plan]': 'lite',
  // ...success_url / cancel_url
};
// (No subscription_data, no trial_period_days, no add_invoice_items)
```

```js
// public/_worker.js — webhook
else if (event.type === 'checkout.session.completed') {
  const session = event.data.object;
  if (session.mode !== 'payment') return ok;  // subs go through invoice.payment_succeeded
  if (session.payment_status !== 'paid') return ok;
  // Resolve plan: metadata.uvera_plan='lite' → +100 tokens, tier='lite'
  // Idempotency: dedup on session.id (no invoice exists for one-time)
  // Same orders-table insert (orderNo = session.id)
}
```

Subscription tiers (Starter/Creator/Studio) still flow through
`invoice.payment_succeeded` exactly as before — that path is unchanged.

### Webhook line-scanning fix (defensive, kept from earlier work)

Subscription invoices may have multiple lines (plan changes, prorations).
Switched from `invoice.lines.data[0]` to scanning for the line whose
amount matches `invoice.amount_paid`:

```js
const matchingLine =
  lines.find(l => l.amount === amountPaidCents) ||
  lines.find(l => l.amount > 0) ||
  lines[0];
```

Less critical now that Lite is one-time (one-time invoices have a single
line), but a good general-purpose defensive fix kept in.

### ⚙️ Required Stripe Dashboard setup

Before this can be used in production:

1. **Stripe Dashboard → Products** → create a product "UVERA Lite" (or
   add a price to an existing product).
2. **Add a price**:
   - Pricing model: **One-time** (NOT recurring)
   - Price: USD **$3.99**
   - Description: "100 tokens — one-time top-up"
3. **Copy the price ID** (starts with `price_…`)
4. **Cloudflare Dashboard → Workers → uvera-pages → Settings → Variables**:
   - Add encrypted env var `STRIPE_PRICE_LITE_TRIAL` = the price ID
   - (Env var name kept for backward compat with the trial-pattern
     attempt; semantically it's now "Lite one-time price".)
5. **Stripe Dashboard → Webhooks**: ensure the webhook endpoint listens
   for `checkout.session.completed` in addition to `invoice.payment_succeeded`
   and `customer.subscription.deleted`.

If env var is missing, checkout returns:
> "STRIPE_PRICE_LITE_TRIAL not configured — create a $3.99 one-time
> price in Stripe Dashboard and set the env var"

so you'll know immediately on the first attempted Lite checkout.

### What's NOT done (deferred to later)

- **Re-buy throttling**. User can buy Lite as many times as they want,
  no rate limit. If we see abuse (someone buying 50x to spam tokens at
  cost-effective price), add a per-user-per-day cap.
- **Lite-restricted features**. Currently Lite users get the same
  feature access as paid tiers (no `tier === 'free'` gate anywhere
  blocks them). Acceptable — they paid $3.99 for tokens, not for a
  feature subset.

### Reconciliation for failed webhook

If for any reason the webhook misses a Lite payment, the
amount-fallback in priceMap recognizes 399 / 599 / 799 cents → lite/100
tokens. Plus the admin can use the new "+ Tokens" button in Users tab to
manually grant 100 + set tier='lite' with the Stripe invoice ID for audit.

---

## Tiered Pricing 2026-05-14 (UPDATE)

### Why this happened

费在生产环境测试 Lite 时反馈："3.99 的买完后，还可以继续买？" —— 暴露
出一个被忽视的 unit-economics 问题：

| 套餐 | 单价 | 每 token |
|------|------|---------|
| **Lite (one-time)** | $3.99 / 100 | **$0.0399** ← 最便宜 |
| Starter monthly | $25 / 500 | $0.0500 |
| Creator monthly | $69 / 1500 | $0.0460 |
| Studio monthly | $189 / 5000 | $0.0378 |

Lite 是**全套餐里第二便宜**的（仅次于 Studio），但又是 one-time 无承诺
的。结果就是：一个聪明用户应该一直买 Lite，永远不会升级到 Starter，
等需要更多再考虑 Studio —— Lite 在 Starter / Creator 之间形成了一个
**反虹吸**。

### 决定 (费 2026-05-14)

**保留多次购买能力，但价格阶梯递增**：

| 第 N 次购买 | 单价 | 每 token | 注解 |
|------------|------|---------|------|
| 1st | $3.99 | $0.0399 | 入门价 —— 首次体验 cheap |
| 2nd | $5.99 | $0.0599 | 涨价 50% |
| 3rd+ | $7.99 | $0.0799 | 与 Starter 平齐之上 —— 用户自己应该
                            意识到 "不如订阅" |

### 实现细节 (Worker)

**Tier 计数逻辑**：query `orders` 表，找当前用户的已完成（status=1、
非 voided、非 refunded）Lite 订单数 N。下次购买 tier = N+1，套用
价格表 `LITE_PRICE_TIERS_CENTS = [399, 599, 799]`，索引 `min(N, 2)`。

退款 / 作废订单**不计**入 tier —— 用户没拿到价值，再买仍是首次价。

**Stripe 实现**：使用 Stripe Checkout 的 ad-hoc price_data 参数，**不需要**
在 Stripe Dashboard 创建多个 price/product。同一个 product（保留
原 STRIPE_PRICE_LITE_TRIAL 关联的 product），每次 checkout 时
动态指定 unit_amount。

```js
sessionParams['line_items[0][price_data][currency]'] = 'usd';
sessionParams['line_items[0][price_data][product]'] = liteProductId;
sessionParams['line_items[0][price_data][unit_amount]'] = String(litePriceCents);
sessionParams['metadata[uvera_lite_tier]'] = String(tierIndex);
```

`liteProductId` 通过缓存的 `getLiteProductId(env)` helper 从 Stripe
Price API 取一次得到（runtime cache）—— 减少 Stripe API roundtrip。

**Webhook 兼容**：Webhook 已经按 `metadata.uvera_plan === 'lite'` 路径
判定 plan，与价格无关 —— **不需要改**。AMOUNT_FALLBACK 表补了 599 和
799 两条作为防御，万一 metadata 丢失也能正确归类。

### 实现细节 (Frontend)

**新端点** `GET /api/lite/next-price`：登录用户调用，返回下次购买的
tier、价格、已完成次数。SubscriptionPage 在 mount 时调用，更新 Lite
卡片的价格显示 + CTA 文案。

**Lite 卡片显示**根据 tier 动态：
- tier 1: "$3.99 one-time · No recurring charge"
- tier 2: "$5.99 one-time · Your 2nd top-up · price increases on each repeat"
- tier 3+: "$7.99 one-time · Your Nth top-up · upgrade for better unit price"

**CTA 文案**类似动态：
- tier 1: 'Buy 100 tokens — $3.99'
- tier 2: 'Buy 100 tokens — $5.99' + desc 提示考虑 Starter
- tier 3+: 'Buy 100 tokens — $7.99' + desc 强调 Starter 性价比

### 配套：支付成功 banner（同次发布）

费同时反馈："支付完成后回到页面没有显示支付成功等字样"。代码之前
有 comment 说要 show banner 但**实际没实装**。

修法：当 `?checkout=success` 在 URL 中时：
1. 立刻显示蓝色 banner "Payment received · Adding tokens..."
2. 后台轮询 user profile，捕获 credits 余额增加的瞬间
3. credits 增加后 banner 切绿色 "Payment confirmed · +N tokens added"
4. 6 秒后自动消失，用户可手动点 × 提前关掉
5. 15 秒还没到账 → 切橙色 "Still processing · check Settings → Wallet"

URL `?checkout=success` 参数立刻被 `history.replaceState` 清掉，刷新
不会重复触发 banner。

### 不变的部分

- 100 tokens / 次（无论哪个 tier，量不变，只是单价变）
- Tier='lite' 不变
- Webhook 流程不变
- Refund 机制不变
- 退款后再买仍从 tier 1 开始（refunded 行不计入）

### 不在本次范围

- **退款影响 tier** 的高级规则（比如：refund × 3 累计后封禁购买）—— 不做，
  现有 RefundModal 已有 abuse signals
- **rate limit**（"每天最多 N 次 Lite"）—— 不做，价格阶梯本身就限制
  了滥用经济动机
- **Tier 4+**（更高单价）—— 不做，3rd+ 一律 $7.99 即可

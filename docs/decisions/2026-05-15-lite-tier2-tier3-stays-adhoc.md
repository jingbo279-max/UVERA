---
title: Lite 二档/三档保持 ad-hoc pricing，不建独立 Stripe Price 对象
type: decision
status: active
owner: Leon
created: 2026-05-15
updated: 2026-05-15
tags: [decision, adr]
---

# Lite 二档/三档保持 ad-hoc pricing，不建独立 Stripe Price 对象

**日期**: 2026-05-15
**决策**: fei
**状态**: 已决定，**不实施**
**关联代码**: `public/_worker.js` `LITE_PRICE_TIERS_CENTS` 常量 + `/api/stripe/checkout` Lite 分支
**历史关联**: 2026-05-14 阶梯定价方案落地（commit `25a84f7`）

## 背景

Lite 阶梯定价目前是：

| 档次 | 金额 | 实现 |
|---|---|---|
| Tier 1 | $3.99 | Stripe Price 对象 `STRIPE_PRICE_LITE_TRIAL`（真存在）|
| Tier 2 | $5.99 | **没有** Stripe Price 对象，worker 用 `price_data.unit_amount` 动态指定 |
| Tier 3 | $7.99 | 同上 |

费 2026-05-15 问："Lite 另外两档的价格代码应该用什么变量名" → 引发是否要把二档/三档也建成 Stripe Price 对象的讨论。

## 选项

### 方案 A：保持现状（ad-hoc pricing）✓ 选这个

Stripe Dashboard 只有 1 条 Lite product/price。Worker 在 checkout 时根据 `computeLiteElevation` 算出 elevation 0/1/2，从 `LITE_PRICE_TIERS_CENTS = [399, 599, 799]` 取金额，作为 `line_items[0][price_data][unit_amount]` 传给 Stripe。

### 方案 B：建独立 Price 对象

去 Stripe Dashboard 建 `$5.99 Lite Top-up Mid` + `$7.99 Lite Top-up High` 两个 Price，分别拿 `price_xxxxx` ID 存到 Cloudflare env：

```bash
STRIPE_PRICE_LITE_TIER_1=price_xxxxx  # 现 $3.99
STRIPE_PRICE_LITE_TIER_2=price_yyyyy  # $5.99
STRIPE_PRICE_LITE_TIER_3=price_zzzzz  # $7.99
```

worker 改成 `line_items[0][price]` 走 Price ID 路径。

## 决策：方案 A（ad-hoc）

### 选 A 的理由

1. **零摩擦加阶梯**：未来想加第四档 $9.99 → 改 `LITE_PRICE_TIERS_CENTS` 数组一个元素即可，不动 Stripe。
2. **后台干净**：Stripe Dashboard Products 列表保持 1 条 Lite，不被 N 条同名同概念的 Price 撑爆。
3. **改价灵活**：市场反馈降价（比如 $3.99/$4.99/$6.99）时只改代码一次性 push，不用同步去 Stripe 删建 Price。
4. **现阶段紧急修 bug 期，新增 Stripe config + env var = 多个出错点**：v1.1.x 这两天已经因为 Stripe 配置漂移撞过 23503 / webhook 订阅缺失 / 双订阅风险等多个事故。少改 = 少风险。

### 不选 B 的代价（接受）

- Stripe 财务报表按 Product 维度分组时，三档 Lite 都聚合到 "Lite Trial" 一条。
  **缓解**：报表按金额维度过滤（$3.99 / $5.99 / $7.99）依然能区分。
- 不能给单独某一档绑 Stripe Coupon / Promotion code。
  **缓解**：当前业务上没这个需求，未来真要做促销可以临时建一个 Price 切过去。

### 何时重新评估方案 B

当且仅当出现以下情形之一：

- 财务/会计要求按"产品"维度报表（不能用金额维度凑合）
- 营销要给某一档 Lite 单独打折促销（Stripe Coupon 需要绑 Price）
- 阶梯定价稳定半年以上，金额不再变动（动态修改的优势消失）

## 代码现状参考（不动，仅记录）

```js
// public/_worker.js
const LITE_PRICE_TIERS_CENTS = [399, 599, 799];  // 1st / 2nd / 3rd+

function getLitePriceCentsForElevation(elevation) {
  const idx = Math.min(Math.max(elevation, 0), LITE_PRICE_TIERS_CENTS.length - 1);
  return LITE_PRICE_TIERS_CENTS[idx];
}

// /api/stripe/checkout Lite 分支
if (isLite) {
  const elevation = await computeLiteElevation(env, user.id);
  const litePriceCents = getLitePriceCentsForElevation(elevation);
  const liteProductId = await getLiteProductId(env);  // 反查 STRIPE_PRICE_LITE_TRIAL.product
  sessionParams['line_items[0][price_data][currency]'] = 'usd';
  sessionParams['line_items[0][price_data][product]'] = liteProductId;
  sessionParams['line_items[0][price_data][unit_amount]'] = String(litePriceCents);
  sessionParams['metadata[uvera_lite_tier]'] = String(elevation + 1);
}
```

Webhook 兜底依然在位（`AMOUNT_FALLBACK[399/599/799] → tier='lite'`），所以即使 metadata 丢失，金额匹配也能正确归一。

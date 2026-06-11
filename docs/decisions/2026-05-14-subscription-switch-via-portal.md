---
title: 订阅切换走 Customer Portal（不走 Checkout）
type: decision
status: active
owner: Leon
created: 2026-05-14
updated: 2026-05-14
tags: [decision, adr]
---

# 订阅切换走 Customer Portal（不走 Checkout）

**日期**: 2026-05-14
**决策**: fei
**状态**: 已实现 (commit 即将 push)
**关联代码**: `public/_worker.js` `/api/stripe/checkout` 端点 + `src/pages/SubscriptionPage.jsx` `handleCheckout`

## 背景：原本的 bug 是什么

`/api/stripe/checkout` 一直无条件创建 **新的** Checkout Session，不管用户是否已经有订阅。
导致两种坏情况：

1. **双重计费**：Creator 用户点 "Buy Starter" → 旧 Creator $69/月 + 新 Starter $25/月 同时扣
2. **无意降级 / 越权升级**：用户点 "Switch" 想等期末再切，但代码立即扣下一档钱并立即变更 tier

费的明确要求：

> 用户要购买 starter 套餐降级时，也应该是当前会员到期后自动续费改为下一档会员

## 决策：用 Stripe Customer Portal 处理"切换订阅"

凡是用户已有 active subscription + 想买另一档 subscription → 强制走 Stripe 官方
Customer Portal，不要自己拼 subscription_schedule。理由：

- Stripe 的 Portal 早就支持"升级立即生效（带 proration）+ 降级期末生效"，配置即可
- 写自己的 subscription_schedule 要处理多 phase / billing_cycle_anchor / proration 边界，
  bug 多、维护贵
- 走 Portal 顺便给用户付款方式更新、发票下载、取消订阅等功能，UX 完整

Lite（一次性 $3.99）**不受此约束**：它是 `mode=payment`，跟订阅不冲突，可以同时存在。

## 实现细节

### 后端（`public/_worker.js` ~line 3845）

```js
if (!isLite) {
  const subsResp = await fetch(
    `https://api.stripe.com/v1/subscriptions?customer=${stripeCustomerId}&status=active&limit=10`,
    ...
  );
  const activeSubs = (await subsResp.json()).data || [];
  if (activeSubs.length > 0) {
    // 拿 Portal session URL 返回
    const portalResp = await fetch('https://api.stripe.com/v1/billing_portal/sessions', ...);
    return new Response(JSON.stringify({
      success: false,
      code: 'EXISTING_SUBSCRIPTION',
      portalUrl: portalData.url,
      message: '...',
    }), { status: 200 });
  }
}
```

`status: 200` 不是错误响应（HTTP 200 + body.success=false）— 前端按 code 分流。

**Fail-safe**: Subscription 查询或 Portal 创建失败 → 继续走原 Checkout 流程，不阻塞用户。
最坏情况是创建两个订阅（可通过 admin 退款 + 取消修复），比"用户付不了款"好。

### 前端（`src/pages/SubscriptionPage.jsx` `handleCheckout`）

```js
if (!data.success && data.code === 'EXISTING_SUBSCRIPTION' && data.portalUrl) {
  alert(data.message);                       // 告知用户为什么不是直接付款
  window.location.href = data.portalUrl;      // 跳 Portal
  return;
}
```

## ⚠️ 操作员配置（Stripe Dashboard，**必须配**）

代码部署后，**必须**去 Stripe Dashboard 配置 Customer Portal，否则用户进 Portal 看不到"切换计划"
按钮，会很困惑。

### 步骤

1. 打开 **Stripe Dashboard → Settings → Customer Portal**
   （直连：https://dashboard.stripe.com/settings/billing/portal）

2. **Functionality → Subscriptions**：

   - [ ] **Customers can switch plans** — ✅ 勾上
   - **Allowed plans to switch to** — 全选 Starter / Creator / Studio 的 monthly + yearly 价
     （把所有 6 个 price 都加进来）
   - **Proration behavior**:
     - **Upgrades**: `Prorate immediately` ✓（升级立即生效 + 按比例补差价）
     - **Downgrades**: `At end of period` ✓（**关键** — 降级等到当前周期结束才生效）

3. **Functionality → Cancellations**:
   - [ ] **Customers can cancel subscriptions** — ✅ 勾上
   - **Cancellation behavior**: `At end of period`（取消也是期末生效，已付的当期保留服务）
   - **Cancellation reasons**: 可选，建议开（数据有助分析流失）

4. **Branding** (可选): 改成 UVERA 的 logo + 主色调

5. 页面底部 **Save**

### 验证（创建测试场景）

- 任何**已经是订阅用户**的账号，去 /subscription 点另一档套餐
- 应该看到 alert "You already have an active subscription..."
- 然后跳转到 `billing.stripe.com/...` 的 Portal 页面
- 在 Portal 看到 **"Update plan"** 按钮 → 点开能看到 Starter/Creator/Studio 三档
- 选个降级（Creator → Starter）→ 应该提示 **"Changes will apply on [当前周期结束日]"**

## 后续可优化（非阻塞）

- 在 SubscriptionPage 直接预先检测用户是否已有订阅（用 user_metadata.tier ≠ free 近似判断）→
  非 Lite 卡片的 CTA 直接改为 "Manage subscription" 文案（少一次 API 调用 + 更清晰）
- Portal 配置如果没设置，应该在 worker 检测并报错（目前是 fail-open 默认）

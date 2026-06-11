---
title: 不接入 Stripe Connect 决定
type: decision
status: active
owner: Leon
created: 2026-05-14
updated: 2026-05-14
tags: [decision, adr]
---

# 不接入 Stripe Connect 决定

> **决策日期**：2026-05-14
> **决策方**：费（项目负责人）
> **触发**：Stripe Dashboard Go Live 流程到 "Confirm your integration choices"
> 时选择 Marketplace 模型后，要求确认 Connect Platform Agreement。

## 决定

**UVERA 不接入 Stripe Connect**。即使将来要做创作者分账 / 多方付款，
也采用自己的协议体系（如自建分账逻辑 + 银行直接转账，或集成
PayPal / Wise / 其他汇款服务）**而非 Stripe Connect**。

## 背景

Stripe Connect 是 Stripe 的多方付款 / 平台 / 市场架构产品，能让平台
方收钱后分账给多个 sellers / creators / recipients。Sandbox 默认选了
Platform 模型，Go Live 时 Stripe 询问要 commit Platform 还是
Marketplace。

我（Claude）一开始建议"选 Marketplace + Confirm 给未来留口子"。
费看完 Connect Platform Agreement 之后否决了，理由是：

1. **法律 lock-in 太重** —— Connect Platform Agreement 是真实合同，
   UGHF 承担 Stripe 平台运营方的所有责任（KYC、AML、tax reporting、
   creator dispute mediation 等），即使你**永远不开始用**也已经签下了。
2. **现在不需要** —— UVERA 当前业务是 B2C SaaS subscriptions，
   没有任何第三方收款方，规则化的 Stripe Payments / Subscriptions
   已经覆盖所有需求。
3. **未来需要时也未必走 Stripe** —— 如果以后做创作者激励 / 分账，
   "自己的协议"更灵活：可以选择走自建逻辑、PayPal Payouts、
   Wise Multi-currency、或者干脆手动银行转账给白名单创作者。**不
   绑死在 Stripe 生态**。
4. **当前代码已经是这个状态** —— `public/_worker.js` 里没有任何
   Connect 相关代码（没有 account_id、transfer_destination、
   Account Link API 调用）。维持现状 = 零工程成本。

## 含义

- ✅ **保留 Stripe** 用于 Subscriptions (Starter / Creator / Studio) +
  one-time payments (Lite top-up)
- ✅ Live mode 启用后照常收 SaaS 订阅费
- ✅ 退款 / 争议 / chargeback 走标准 Stripe 流程
- ❌ **不签** Connect Platform Agreement
- ❌ **不创建** Express / Custom Connect accounts
- ❌ **不调** Transfer / Account Link / Account Onboarding API
- ❌ Go Live checklist 上的 "Confirm your integration choices" 一直留空

## 给运营 / 客服的处理建议

如果 Stripe Go Live 因为这一步卡住：

1. 联系 Stripe support（Dashboard 内 chat 或 support@stripe.com）
2. 明确说："We are not using Connect. Please disable Connect on our
   account so we can complete Go Live for standard Subscriptions only."
3. 一般 24h 内 Stripe 会从账户上摘掉 Connect feature
4. 之后 Go Live 流程只剩 "Verify your identity" + "Get your API keys"
   两步

## 未来如果反悔

如果哪天发现确实需要 Connect 而且不想自建：

1. 在 Stripe Dashboard 重新开启 Connect feature（向 support 申请）
2. 跑完 Connect onboarding（包括 Confirm Platform Agreement）
3. 添加 Connect 相关代码（参考 Stripe docs Connect Quickstart）

反向不容易：**签了 Connect Platform Agreement 之后退出**需要更复杂
的法务流程，所以"不签"是更可逆的默认。

## 关联文档

- `docs/decisions/2026-05-12-recommendation-strategy.md` —— 推荐策略
  里没有提到任何分账机制，符合"现阶段不做创作者货币化"的产品边界
- `docs/legal/COMPLIANCE.md` —— 退款 / chargeback 流程现状（不依赖 Connect）
- `public/_worker.js` Stripe 集成 —— 所有 Stripe 调用都是标准
  Subscription / Payment / Refund API，无 Connect 调用

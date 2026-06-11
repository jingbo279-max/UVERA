---
title: Refund Abuse Defenses
type: decision
status: active
owner: Leon
created: 2026-05-09
updated: 2026-05-09
tags: [decision, adr]
---

# Refund Abuse Defenses

> **Status**: P0 shipped 2026-05-09 (in-modal usage signals + pro-rate
> suggestion). P1 / P2 deferred — see "What's NOT done" at bottom.
> **Why this exists**: token-based products are uniquely exposed to
> "use-then-refund" abuse. Each refund costs UVERA real money beyond the
> refund amount itself.

## The risk

For every $25 Starter subscription that gets refunded after the user has
already consumed most of the 500 tokens:

| Cost item | Amount lost |
|---|---|
| Stripe processing fee (already deducted, NOT returned) | ~$1.40 |
| AI API costs (Gemini, BytePlus per generation) | $0.X – several $ depending on usage |
| R2/Stream storage already provisioned | a few cents |
| Chargeback fee if user goes around admin to bank | +$15 |

A user who consumes 90% of their tokens and then refunds $25 costs UVERA:
- ~$1.40 Stripe fee + several $ in AI API + opportunity cost
- That $25 was never really revenue — it was a loan against their usage

## Defense layers (current + planned)

### Layer 1 — Admin sees usage before refunding ✅ (shipped 2026-05-09)

`GET /api/admin/orders/refund-context?orderNo=…` returns:
- Tokens granted by this order (derived from `subject` → tier)
- Tokens consumed since (sum of `generation_logs.credits_charged` where
  `started_at >= orders.createdAt` for this user)
- Number of generations in that window
- Current credit balance
- **Prior refunds by this user** (count of orders with `refunded_at` set)
- A risk level: `low` / `medium` / `high`
- A **pro-rated suggested refund amount** (= original × % unused)

The RefundModal renders a colored panel:
- 🟢 **Low** — <30% used, no prior refunds → "Safe to refund"
- 🟡 **Medium** — 30-70% used OR 1 prior refund → "Review carefully"
- 🔴 **High** — >70% used OR 2+ prior refunds → "High refund-abuse risk"

If usage > 30%, the modal pre-fills the amount field with the suggested
pro-rated value, and shows a one-click "Use suggested refund" link.

This is a **signal, not a block** — admin can still issue any refund
amount they want. The point is informed decisions, not policy enforcement.

### Layer 2 — Token deduction on refund ✅ (shipped earlier)

The RefundModal's "Deduct N tokens from user" checkbox (default on)
subtracts the refunded portion of the grant from the user's balance,
clamped to ≥ 0. If they've already consumed everything, deducting does
nothing — but it prevents the case where they keep tokens they didn't pay for.

### Layer 3 — Refund policy in ToS (TODO)

The user-facing Terms of Service should state explicitly:
- "Refunds at our discretion. Tokens already used are non-refundable."
- "Refunds may be denied or reduced if substantial usage has occurred."
- "Repeated refund requests may result in account suspension."

This is the **legal foundation** for our admin-side decisions, especially
when responding to chargeback disputes. Without this language in ToS, a
chargeback dispute comparing "user consumed 400/500 tokens" vs "user
demanded full refund" could go either way. With it, we have grounds.

**Action**: update `docs/legal/TERMS-OF-SERVICE.md` next time we touch legal —
add a "Refunds & cancellations" section with the language above. Lawyer
to review before publishing.

### Layer 4 — Stripe Radar (TODO)

Stripe Radar (built into the standard plan) auto-blocks high-fraud
attempts at payment time. Default rules cover most known bad-card /
high-velocity patterns. Custom rules to consider:

- Block customers who have ever issued a chargeback against us
- Block payment methods that have funded refunded UVERA accounts
- Require 3DS for first-time customers from high-fraud countries

Configure under Stripe Dashboard → Radar → Rules. No code changes needed;
the webhook still fires the same on success, but blocked attempts never
hit it.

### Layer 5 — Re-purchase block after refund (TODO)

Currently a user who got refunded can re-buy the same plan immediately,
get another 500 tokens, use them, and refund again. Mitigation:

```js
// In /api/stripe/checkout, before creating the session:
const recentRefunds = await query orders WHERE userId=user.id AND refunded_at > now() - 30 days
if (recentRefunds.length >= 1) {
  // Allow but log + flag for admin review, OR
  // Refuse with "We're sorry, we can't process new orders for this account
  // until 30 days after your most recent refund."
}
```

Defer until we see this pattern in the wild. For MVP, the admin will
catch serial refunders manually via the modal's "Prior refunds: N"
warning.

## Chargeback response readiness

When a user goes around admin to bank-initiated chargeback (especially
common with the $3.99 Lite tier — low friction to dispute):

1. **Stripe Dashboard → Disputes** shows the case with a deadline (~7 days)
2. **Evidence to submit** (Stripe lets you upload):
   - Receipt email we sent (Resend logs)
   - `generation_logs` rows showing exactly what they generated and when
   - Any user-uploaded videos / outputs as proof of service delivered
   - ToS link showing they agreed to "use = non-refundable"
3. **Win rate**: with good evidence, ~50% of disputes are reversed in
   merchant's favor. Without evidence, ~0%.

To make this turnkey, future work:
- Admin "Export evidence pack" button on a refunded order → ZIP of
  generation_logs CSV + email logs + receipt copies
- Auto-submit standard evidence template

For now: when a dispute arrives in Stripe Dashboard, manually pull
evidence from the admin Generation Logs tab + Resend dashboard.

## What's NOT done (deferred)

- ⏸ ToS language update — needs lawyer review
- ⏸ Stripe Radar custom rules — set up after first live abuse case
- ⏸ Re-purchase 30-day cooldown for refunded users
- ⏸ Auto-evidence ZIP export for chargeback disputes
- ⏸ User-initiated refund flow (currently admin-only) — adding
  user-facing refunds without these defenses would be reckless
- ⏸ Per-user refund cap (e.g. "max 1 refund per lifetime")
- ⏸ Email warning to user on 2nd refund attempt

## Operational guidance

When admin receives a refund request:

1. **Open the order in Payments & Orders → click Refund**
2. **Read the colored panel at top of modal** — risk level + usage signals
3. **For 🟢 low**: issue full refund, accept the small loss as cost of doing business
4. **For 🟡 medium**: consider partial. Click "Use suggested refund" and add a Note explaining
5. **For 🔴 high**: strongly consider declining or only refunding the unused portion. Reply to the user explaining "we can offer $X as a partial refund based on your usage of N out of N tokens"
6. **Always fill in Reason** — this is your audit trail if a chargeback comes later
7. **Keep deduct-tokens checkbox on** unless there's a specific reason not to (e.g. UVERA bug caused the issue, refund is goodwill)

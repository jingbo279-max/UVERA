---
title: Resend Transactional Email — Setup & Wiring
type: decision
status: active
owner: Leon
created: 2026-05-09
updated: 2026-05-09
tags: [decision, adr]
---

# Resend Transactional Email — Setup & Wiring

> **Status**: ✅ Shipped 2026-05-09 — sendEmail() helper + 4 wired hooks +
> admin test endpoint.
> **Why HTTP API not SMTP**: Cloudflare Workers cannot open raw TCP
> sockets (no `net` module), so SMTP is impossible. Resend's HTTP API
> uses the same `re_xxx` key as SMTP_PASS, so the credentials the user
> provided work as-is.

## Cloudflare env vars

Set in **Cloudflare Dashboard → Workers → uvera-pages → Settings → Variables**
(use **Encrypted** for the API key):

| Var | Value (as provided) | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_huzrPL7n_KgU36UVZscsWwogCMQbQN4Vy` | Same as SMTP_PASS — sendEmail() accepts either name |
| `FROM_EMAIL` | `noreply@send.uvera.ai` | Must match a Resend-verified domain |
| `FROM_NAME` | `Uvera` | Display name in inbox |
| `SUPPORT_EMAIL` | (optional) `support@uvera.ai` | Used as Reply-To on refund emails |

The `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` env vars Resend gave us are
unused — we don't speak SMTP. Set them anyway if you want to keep the
record together; the code ignores them.

## Resend Dashboard setup (one-time)

1. **Verify the domain** `send.uvera.ai` (or whatever subdomain hosts
   FROM_EMAIL) under **Resend → Domains → Add Domain**. Resend will
   give you DNS records to add at your DNS provider:
   - **MX** (for bounces)
   - **SPF** (TXT record allowing Resend IPs)
   - **DKIM** (TXT records — usually two `resend._domainkey` entries)
   - **DMARC** (optional but recommended — `v=DMARC1; p=none; ...`)
2. Wait for "Verified" status (usually <15 min after DNS propagates).
3. **Without verified DNS, Resend refuses to send** in production —
   you'll see HTTP 403 from `/v1/emails`.

## Wired hooks (auto-sent emails)

| Trigger | Email subject | Recipient | Tag |
|---|---|---|---|
| `invoice.payment_succeeded` (subscription paid) | "Payment received — N tokens added" | The paying user | `payment_receipt` |
| `checkout.session.completed` (one-time Lite paid) | "Top-up complete — N tokens added" | The paying user | `one_time_receipt` |
| `POST /api/admin/orders/refund` (admin issued refund) | "Refund processed — $X.XX" | The refunded user | `refund_confirmation` |
| `POST /api/admin/grant-credits` (admin +Tokens button) | "N tokens added to your account" | The granted user | `manual_grant` |

All emails are **fire-and-forget** — they're wrapped in try/catch and
NEVER fail the parent operation. If Resend is misconfigured, payments
still go through and credits still land; you just see warnings in
Workers logs (`[stripe-webhook] receipt email failed: …`).

### Skipping the user notification on internal grants

If you use the +Tokens flow for an internal reconciliation that the
user shouldn't be told about (e.g. fixing a bug-induced grant they
already have), prefix the **Reason** field with `internal:` —
sendEmail will be skipped:

> Reason: `internal: backfilling missed grants from Stripe webhook bug 2026-05-09`

## Admin test endpoint

Verify Resend is wired correctly:

```bash
curl -X POST https://uvera.ai/api/admin/email/test \
  -H "Authorization: Bearer $YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{ "to": "your-personal-email@example.com" }'
```

Returns `{ success: true, resendId: "..." }` on success, or a structured
error pointing to the missing env var / verification issue.

## Email template

`renderEmail({ heading, paragraphs, cta?, footerNote? })` produces a
minimal table-based HTML email + plain-text fallback. Inline styles
only (most clients ignore `<style>` blocks). Branding is intentionally
plain — looks like a normal transactional notification rather than
marketing.

## What's NOT done (deferred)

- **Welcome email on signup** — Supabase emits a confirmation email
  natively (via Supabase SMTP); we'd want to replace that with a
  branded version via Resend after the user confirms. Skip for now.
- **Subscription renewal reminder** (3 days before next billing).
  Stripe sends this natively — opt-in under Customer Portal settings.
- **Trial expiration warning** — N/A, Lite is one-time now.
- **Cancellation confirmation** — could wire `customer.subscription.deleted`
  to send "Sorry to see you go" email.
- **Beta access approval / video review notification** — admin actions
  don't currently email the user. Add when those flows get more traffic.
- **Per-user email preferences (opt-out)** — all 4 wired emails are
  transactional under CAN-SPAM/CASL/GDPR (receipts + service updates),
  so opt-out isn't legally required. Add if we add marketing later.

## Cost notes

Resend free tier: 3,000 emails/month, 100/day. At UVERA's expected MVP
volume (≤50 users × ≤5 emails each per month) we're well under. Paid
tier kicks in at $20/mo for 50k emails — not a concern for a while.

## Operational tips

- All email failures log to Cloudflare Workers logs with prefix
  `[stripe-webhook] receipt email failed:` or similar — grep there
  first when debugging.
- Resend dashboard → Logs shows every email sent + bounce/complaint
  status. Tag-based filtering (`category:refund_confirmation`) makes
  audits easy.
- If you change FROM_EMAIL domain, re-verify DNS in Resend AND update
  the Cloudflare env var.

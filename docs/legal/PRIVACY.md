---
title: UVERA Privacy Policy
type: legal
status: active
owner: 律师
created: 2026-05-05
updated: 2026-05-05
tags: [legal, privacy]
---

# UVERA Privacy Policy

**Version 0.1 — DRAFT for legal counsel review**
**Effective Date:** [REVIEW NEEDED]
**Last Updated:** 2026-05-05

---

> ⚠️ **Lawyer Review Checklist**:
> 1. GDPR Articles 13/14 disclosure completeness
> 2. CCPA/CPRA disclosures for California residents — sensitive PI categories, do-not-sell notice
> 3. International data transfer mechanism — Standard Contractual Clauses (SCCs) / EU-US Data Privacy Framework where applicable (§8)
> 4. Retention period schedule (§7) — confirm ranges per data category meet record-keeping obligations
> 5. AI training disclosure (§9) — alignment with [Content License Terms](./CONTENT-LICENSE.md) §4
> 6. Cookie list (§10) — verify against actual production deployment
> 7. Children's data (§12) — under-16 cutoff vs. lower thresholds for specific EU member states
> 8. EU representative / DPO appointment under Art. 27 GDPR if processing scale triggers it
> 9. Need for ICO (UK) registration

---

## 1. Who We Are

This Privacy Policy describes how **longVV Ltd**, a [REVIEW NEEDED — Delaware] corporation operating UVERA (the "**Service**"), collects, uses, shares, and protects your personal information.

- **Data Controller:** longVV Ltd
- **Privacy Contact:** [legal@uvera.ai](mailto:legal@uvera.ai)
- [REVIEW NEEDED: appoint EU representative under Art. 27 GDPR if EU users exceed materiality threshold; designate DPO if Art. 37 GDPR applies.]

## 2. Geographic Scope

This Service is **not offered to residents of mainland China**. We do not knowingly collect personal information from users in mainland China. If you are accessing the Service from mainland China, please discontinue use.

For users in the EU, the European Economic Area, the United Kingdom, the United States, and other supported regions, this Privacy Policy applies in full.

## 3. Information We Collect

### 3.1 Information You Provide

| Category | Examples |
|---|---|
| **Account information** | Email address, password (hashed), display name, optional profile picture |
| **OAuth profile** | When you sign in with Google: email, name, profile photo |
| **User Content** | Text prompts, uploaded images, generated and uploaded audio/video, comments, character configurations, Avatars |
| **Payment information** | Handled by Stripe — we receive only the last 4 digits of your card and transaction metadata, not the full card number |
| **Communications** | Emails sent to legal@uvera.ai or via in-app forms |

### 3.2 Automatically Collected

| Category | Examples |
|---|---|
| **Device & connection** | IP address, browser user-agent, device type, operating system, language |
| **Usage data** | Pages visited, features used, generation prompts, timestamps |
| **Cookies & local storage** | See §10 |

### 3.3 From Third Parties

| Source | Data |
|---|---|
| **Google OAuth** | Email, name, profile picture |
| **Stripe** | Transaction status, country, card-issuing country (for fraud prevention) |

## 4. How We Use Your Information

We use your information to:

(a) Provide, maintain, and improve the Service
(b) Process AI generation requests through internal and third-party models
(c) Process payments and manage subscriptions
(d) Communicate with you about your account, security, and updates
(e) Detect, prevent, and respond to fraud, abuse, and security incidents
(f) Comply with legal obligations

**We do not sell or rent your personal information to third parties for their independent marketing.**

## 5. Legal Bases for Processing (GDPR)

Where GDPR applies, our legal bases are:

| Activity | Legal Basis |
|---|---|
| Account creation, service delivery | Performance of contract — Art. 6(1)(b) |
| Payment processing | Performance of contract — Art. 6(1)(b) |
| Marketing communications (if any) | Consent — Art. 6(1)(a), opt-in |
| Fraud prevention, security | Legitimate interest — Art. 6(1)(f) |
| Legal compliance | Legal obligation — Art. 6(1)(c) |

## 6. Sharing With Third Parties

We share your information only with the processors listed below:

| Provider | Purpose | Data Shared | Region |
|---|---|---|---|
| **Supabase, Inc.** | Database, authentication | Account, User Content metadata | United States |
| **Cloudflare, Inc.** | CDN, hosting, R2 file storage, Workers, Stream | Static assets, generated media files, IP addresses for delivery | Global edge network |
| **Stripe, Inc.** | Payment processing | Card metadata, billing address, transaction records | United States |
| **Google LLC (Gemini API)** | AI image / text generation | Prompts, optional reference images | United States |
| **BytePlus / Volcengine (ModelArk)** | AI video generation (Seedance) | Prompts, generated assets | Singapore (Southeast Asia region) |
| **Neodomain (project AI partner)** | AI screenwriting backend | Prompts, generated scripts | [REVIEW NEEDED: confirm region] |

We require each processor to handle your information consistent with this Privacy Policy and applicable data protection laws.

[REVIEW NEEDED: confirm formal Data Processing Addenda (DPAs) are executed with each processor; identify whether Neodomain processing requires additional disclosure or contractual safeguards if it operates infrastructure in jurisdictions with weaker data protection regimes.]

### 6.1 Disclosures Required by Law

We may disclose information if required by law, subpoena, or court order, or if necessary to protect our rights, users, or the public.

## 7. Data Retention

We retain personal information only as long as needed for the purposes described above:

| Data Category | Retention |
|---|---|
| Account data | Until account deletion + 30 days |
| User Content | Until you delete it OR account deletion + 30 days |
| Payment / transaction records | 7 years (US tax / accounting requirement) |
| Server logs | 90 days |
| Backups | 30 days rolling |

[REVIEW NEEDED: confirm 7-year transaction retention against state-specific requirements; confirm 90-day server log retention against CCPA/GDPR proportionality.]

## 8. International Data Transfers

The Service is hosted on Cloudflare's global edge network and Supabase (United States). When you access the Service from outside the United States, your information will be transferred to and processed in the United States and other countries that may have data protection regimes different from yours.

For users in the EU/EEA/UK, we rely on **Standard Contractual Clauses (SCCs)** with our processors, plus supplementary measures, as the transfer mechanism.

[REVIEW NEEDED: list specific SCC modules in place per processor; confirm participation in EU-US Data Privacy Framework where applicable.]

## 9. AI Training & Content Use

We respect your content. **We do not use your User Content (prompts, uploaded media, generated outputs, or private Avatars) to train AI models.**

The only exception is our curated **Official Avatar** library, where we hold separate model release and IP agreements with the depicted persons. Official Avatars and content explicitly published as Official may be used in training data.

This boundary is contractually binding under our [Content License Terms](./CONTENT-LICENSE.md).

## 10. Cookies & Local Storage

We use cookies and browser local storage strictly for service functionality:

| Cookie / Storage Key | Purpose | Type | Retention |
|---|---|---|---|
| `sb-access-token` | Auth session (Supabase) | Strictly necessary | Session |
| `sb-refresh-token` | Auth session refresh | Strictly necessary | 1 year |
| `uvera_story_draft` (localStorage) | In-progress story drafts | Strictly necessary | Until cleared |
| `uvera_pending_video_task` (localStorage) | Track ongoing AI generation | Strictly necessary | Until task completes |

[REVIEW NEEDED: enumerate any analytics, ad-tracking, or CSRF cookies actually deployed, and any service worker storage.]

We currently do **not** use third-party analytics or advertising cookies. If we add any, we will update this Privacy Policy and present a cookie-consent banner before deployment.

## 11. Your Rights

### 11.1 Universal

Regardless of jurisdiction, you may:

- Access, export, correct, or delete your account data via account settings
- Withdraw consent at any time where consent is the legal basis
- Lodge a complaint with your local data protection authority

### 11.2 GDPR (EU / EEA / UK Users)

You additionally have the right to:

- Restrict or object to processing (Art. 18, 21)
- Receive your data in a portable, machine-readable format (Art. 20)
- Lodge a complaint with your supervisory authority (Art. 77)

### 11.3 CCPA / CPRA (California Users)

You additionally have the right to:

- Know what categories of personal information we have collected and the purposes
- Request deletion of your personal information
- Opt out of "sale" or "sharing" — we do not currently sell or share for cross-context advertising
- Limit use of sensitive personal information — we do not currently process sensitive PI for incidental purposes

To exercise any right, email [legal@uvera.ai](mailto:legal@uvera.ai) with proof of identity. We will respond within 30 days (extendable to 90 days where complexity requires, with notice).

## 12. Children

The Service is **not intended for users under 16 years of age**. We do not knowingly collect personal information from children under 16. If you believe a child has provided us with personal information, please contact [legal@uvera.ai](mailto:legal@uvera.ai) and we will delete it promptly.

[REVIEW NEEDED: some EU member states set the digital consent threshold at 13, 14, or 15. Confirm the chosen 16-year floor against per-member-state law where users may reside; consider whether age-gating mechanism is needed.]

## 13. Security

We implement industry-standard administrative, technical, and physical safeguards:

- TLS encryption for data in transit
- Encrypted storage at rest (Supabase managed encryption, Cloudflare R2 server-side encryption)
- Row-level security (RLS) policies for database access enforcing per-user authorization
- Hashed passwords (bcrypt or stronger)
- Periodic security reviews

No system is perfectly secure. In case of a data breach affecting your information, we will notify you and applicable authorities consistent with legal requirements (typically within 72 hours under GDPR).

## 14. Changes

We may update this Privacy Policy. Material changes will be announced by email and in-app at least thirty (30) days in advance. Your continued use after the effective date indicates acceptance.

## 15. Contact

**longVV Ltd**
Privacy & Data Protection Inquiries: [legal@uvera.ai](mailto:legal@uvera.ai)

[REVIEW NEEDED: physical address required by some jurisdictions; appoint EU representative if applicable.]

---

**This is a v0.1 DRAFT prepared 2026-05-05 for legal counsel review.**

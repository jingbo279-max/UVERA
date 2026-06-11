---
title: UVERA Pre-Launch Smoke Test Checklist
type: doc
status: active
owner: Claude
created: 2026-05-06
updated: 2026-05-06
tags: [guide, launch, checklist]
---

# UVERA Pre-Launch Smoke Test Checklist

> Run before **2026-05-08 GA**. Each `[ ]` is a single test. Mark ✅ as you go. Anything red → tell me, we fix.
>
> **Test on**: Chrome (primary) + Safari (iOS) + Firefox if time. Desktop + mobile both.
>
> **Test accounts**: at least 2 — one fresh free account, one paid (Stripe test 4242 card).

---

## P0 — Must work for 5/8

### 1. First-time user signup → first creation

- [ ] **Open https://uvera.ai in incognito.** Should land on /auth (not /create).
- [ ] **Sign up with a new email.** Email verification flow works (or auto-confirm if Supabase Settings allows).
- [ ] **After signup** → land on / (Discover/home). Hero + feed loads with at least 1 video.
- [ ] **Click "Create" tab** → see 3 mode-selection cards (Series / Quick Create / Creative Canvas).
- [ ] **Click Quick Create** → Step 0 "Select Character" appears.
- [ ] **No characters yet** → empty state shows "Capture a photo to create your first character".
- [ ] **Click "Open camera to create character"** → camera modal opens, can capture / upload, character created and selected.
- [ ] **Click Next: Story Idea** → Step 1 with transcript textarea + emoji prompt bubbles.
- [ ] **Type a 1-sentence English transcript**, click Next: Visual Style.
- [ ] **Step 2: Choose Visual Style** → category tabs (All / Animation Classics / Traditional Crafts / Avant-garde / Modern) work, switching filters the grid.
- [ ] **Pick a style** → click "Summon the AI screenwriter".
- [ ] **Step 3: Review Script** → loading state shows "Screenwriter model is drafting your script..." then renders summary + shots.
  - **Critical**: dialogue + narration are in **English** (matching input language).
- [ ] **Click "Confirm and enter Render Station"** → renderProgress=1 (concept generation).
- [ ] **Concept image renders** → preview shown, "Confirm image & generate video" button.
- [ ] **Click confirm → video render starts**:
  - [ ] Elapsed time counter ticks (`MM:SS elapsed`)
  - [ ] Progress bar fills gradually
  - [ ] Eventually completes (typically 30s-3min)
- [ ] **Final video plays** in the Render Station.
- [ ] **Publishing Settings** card: Allow Branch / Allow Recast checkboxes work.
- [ ] **Click "Publish to World Feed"** → success card appears (NOT alert), green Confetti icon, 2 buttons.
  - [ ] **Click "Continue creating"** → wizard resets to Step 0, no stale state.
- [ ] **Repeat publish flow** → click "Go home" instead → lands on /, work appears in feed.

### 2. Returning user — daily credit claim

- [ ] **Sign in with existing account.**
- [ ] **Go to Settings → Wallet & Credits.**
- [ ] **"Claim today's credits (+6)" button visible** for ALL users (free + paid).
- [ ] **Click claim** → balance increments by 6, button disappears.
- [ ] **Refresh page → button still gone** (already claimed today, idempotent).
- [ ] **Free users**: also see "20 welcome credits (one-time)" feature on Subscription page.

### 3. Stripe payment (test mode)

- [ ] **Go to Subscription page** (logged in).
- [ ] **Tier selector** shows Free / Starter / Creator (popular badge) / Studio.
- [ ] **Toggle Monthly / Yearly** → prices update ($25/$69/$189 monthly · $20/$55/$151 yearly).
- [ ] **Pick Creator + Monthly + click "Upgrade to Creator →"** → redirects to Stripe Checkout.
- [ ] **Stripe page has orange "TEST MODE" banner.**
- [ ] **Pay with `4242 4242 4242 4242`**, any future expiry, any CVC, any zip → submits.
- [ ] **Redirect back to `/subscription?checkout=success`.** Wait ~3 seconds.
- [ ] **Tier displays as "Creator plan"** (auto-refreshed).
- [ ] **Settings → Wallet → Credits balance increased by 1500** (Creator monthly allocation).
- [ ] **Click "Manage Subscription"** → opens Stripe Customer Portal (different test mode banner).
- [ ] **In Customer Portal**: cancel subscription → return to app → Sentry Dashboard should not show errors.
- [ ] **Verify in Stripe Dashboard** → Customers → see your test customer with active subscription.

### 4. Admin dashboard

- [ ] **https://uvera.ai/admin** → AdminLogin page (NOT redirect to /).
- [ ] **Try to enter dashboard via direct URL** (`/admin/dashboard`) without auth → redirected back to /admin.
- [ ] **Sign in with `longvv.dev@gmail.com` or `feifeixp@gmail.com`** (admin email + password).
- [ ] **Sign in with a non-admin email** → "Account is not authorized for admin access" error.
- [ ] **All 6 tabs load**:
  - [ ] Users — shows registered users
  - [ ] Payments & Orders — empty or has Stripe test data
  - [ ] User Works — shows characters + videos
  - [ ] Homepage Feed — shows admin feed (drafts visible)
  - [ ] **Beta Requests** — shows the Creative Canvas request you submitted earlier
  - [ ] System Settings — loads
- [ ] **Beta Requests tab**: Approve a pending request → status changes to "approved" + reset works.

---

## P1 — Important but recoverable

### 5. Legal docs accessibility

- [ ] **/terms loads** — Crimson Pro headers, English content, scrollable.
- [ ] **/privacy loads** — full GDPR/CCPA structure visible.
- [ ] **/content-license loads** — Branch/Recast/AI training sections visible.
- [ ] **Subscription page → Footer** → 3 legal links, each opens correct page.
- [ ] **Settings → Terms & Legal tab** → 3 buttons, each opens correct page in new tab.

### 6. RLS data isolation (security smoke)

In incognito, **without logging in**, open https://uvera.ai and Console:

```js
const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
const sb = createClient(
  'https://wjhdsodlxekvhpahascs.supabase.co',
  '<anon key from supabaseClient.js>'
);

console.log('users:',     (await sb.from('users').select()).data?.length ?? 'BLOCKED');
console.log('orders:',    (await sb.from('orders').select()).data?.length ?? 'BLOCKED');
console.log('characters:',(await sb.from('characters').select()).data?.length ?? 'BLOCKED');
console.log('configs:',   (await sb.from('system_configs').select()).data?.length ?? 'BLOCKED');
console.log('drafts:',    (await sb.from('recommended_content').select('id').eq('published', false)).data?.length ?? 'BLOCKED');
console.log('published:', (await sb.from('recommended_content').select('id').eq('published', true)).data?.length, '条');
```

- [ ] **First 5 lines all show 0 / null / BLOCKED** (RLS denies anon access).
- [ ] **Last line ("published")** shows non-zero (public feed works).

### 7. Version update toast

- [ ] **Set localStorage flag manually** to simulate stale bundle:
  ```js
  localStorage.removeItem('uvera_dismissed_version');
  ```
- [ ] **Wait 4 sec** after page load → if remote version differs from `__APP_VERSION__`, toast appears bottom-right.
- [ ] **Toast shows release title + 3 highlights + "Show 6 more" expander.**
- [ ] **"Update now" button** → hard-reloads, picks up new bundle.
- [ ] **"Later" button + X close** → dismisses, doesn't reappear for same version.
- [ ] **Settings → What's New tab** → full timeline of releases, latest with green badge.

### 8. AI script language matching

- [ ] **Create a video with Chinese transcript**: `咖啡师在午后阳光下煮一杯特别的咖啡，最后抬头微笑`
  - Generated dialogue + narration **in Chinese** (not English).
- [ ] **Create a video with Japanese transcript**: `バリスタが午後の光の中で完璧なエスプレッソを淹れる`
  - Generated dialogue + narration **in Japanese**.
- [ ] **Create a video with English transcript** → English script (default).

### 9. Mobile responsive (iPhone Safari minimum)

- [ ] **Sign up + create flow** works on phone.
- [ ] **Bottom tab bar** visible (Discover / Library / Create / Spark / Profile).
- [ ] **Subscription page**: 4 plans render in 2-col grid, billing toggle works.
- [ ] **Header buttons** don't overflow.
- [ ] **Video Renderer**: progress bar visible without horizontal scroll.

### 10. Error monitoring (Sentry)

- [ ] **Console**: `throw new Error('Sentry smoke test from prod')` on any page.
- [ ] **Open https://sentry.io → uvera project** → see this error within 30 sec.
- [ ] **Stack trace + browser metadata visible.**
- [ ] **No PII in event** (sendDefaultPii: false).

### 11. Creative Canvas beta request

- [ ] **Create page → Creative Canvas card** → click → "Request submitted" alert.
- [ ] **Card label changes** from "Beta" to "Requested", description changes.
- [ ] **Click again** → no submit (already requested).
- [ ] **Admin → Beta Requests tab** → see this request, can approve/decline.

---

## P2 — Nice to have, not blocking

### 12. Cross-browser

- [ ] **Safari**: video playback (WebM compatibility), Stripe checkout works.
- [ ] **Firefox**: layout doesn't break.
- [ ] **Edge / Chromium variants**: same as Chrome.

### 13. Performance / load

- [ ] **First load `/` LCP under 3s** on broadband.
- [ ] **Bundle size acceptable** (main < 1MB gzipped).
- [ ] **No console errors / warnings** on first paint.

### 14. SEO / sharing

- [ ] **`<head>` has reasonable `<title>`** — currently "UVERA"?
- [ ] **No `<meta description>`** = meh, can fix post-launch.
- [ ] **No OG image** = meh, can fix post-launch.

### 15. Operational (admin / team)

- [ ] **Both admin emails** can log in to /admin.
- [ ] **Stripe Dashboard webhook** → check Event log → recent invoice.payment_succeeded events all show "Succeeded" (no failed deliveries).
- [ ] **Supabase logs** → `pg_policies` query confirms strict RLS active.

---

## Found issues — log here

| # | Path / step | What broke | Severity (P0/P1/P2) | Fixed? |
|---|---|---|---|---|
|   |   |   |   |   |

---

## After full pass

- [ ] All P0 items are ✅
- [ ] At least 80% of P1 items are ✅
- [ ] Found-issues table either empty or all marked Fixed
- [ ] Get green light from Leon on overall feel

**Ready for 5/8 GA.** 🚀

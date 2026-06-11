---
title: Admin Recommendation / Targeted Push Strategy
type: decision
status: active
owner: Leon
created: 2026-05-12
updated: 2026-05-12
tags: [decision, adr]
---

# Admin Recommendation / Targeted Push Strategy

> **Status**: Strategy doc only — NOT yet implemented. Leon flagged
> the gap on 2026-05-12 ("admin should be able to do directed push or
> preference-based push for user video/music recommendations"). User
> deferred build, asked for strategy first.
> **Decision date**: 2026-05-12
> **Owner**: 费 to implement; Leon to spec rules/UX

## What problem are we solving?

Today the Discover feed is a single global shuffle of all
`recommended_content` rows with no boost/promotion mechanism beyond:
- `pinned=true + pin_order=N` for HeroCard (1 slot, top of grid)
- Tag chip filtering (user-driven, not admin-driven)

We can't:
- Boost specific work for high-paying tiers ("show this campaign to Studio users")
- Push series N+1 to fans of series N ("you watched ep 1, here's ep 2")
- A/B test ranking algorithms
- Geo-target (assuming we add region later)
- Throttle a work that's getting too much exposure
- Reward creators who pay for premium placement

## Three layers of targeting (build in this order)

### Layer 1 — Manual admin pins per audience segment (MVP)

**Time to build**: ~2 days  
**Complexity**: Low — DB + worker + simple admin UI

The minimum that gives ops meaningful control. Admin picks a content
row and assigns it to one or more "audiences":

| Audience | Definition |
|---|---|
| `tier:free` | `user_metadata.tier === 'free'` |
| `tier:starter` | tier === 'starter' |
| `tier:creator` | tier === 'creator' |
| `tier:studio` | tier === 'studio' |
| `new_users` | account created in last 7 days |
| `inactive` | no generation in last 30 days |
| `liked_tag:cinematic` | any like on item with tag #cinematic |
| `followed:<user_id>` | follows a specific creator |

**Schema:**

```sql
CREATE TABLE content_audience_pins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id    uuid REFERENCES recommended_content(id) ON DELETE CASCADE,
  audience      text NOT NULL,        -- 'tier:starter' etc.
  weight        smallint NOT NULL DEFAULT 100,   -- higher = more prominent
  starts_at     timestamptz,          -- NULL = immediate
  ends_at       timestamptz,          -- NULL = never expires
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now(),
  UNIQUE (content_id, audience)
);
CREATE INDEX content_audience_pins_audience_idx ON content_audience_pins (audience, weight DESC);
```

**Discover feed query becomes:**

```sql
-- Step 1: load standard feed (current shuffled list)
-- Step 2: load admin pins that match this user's audiences:
SELECT cap.content_id, cap.weight
  FROM content_audience_pins cap
 WHERE cap.audience = ANY($user_audiences)
   AND (cap.starts_at IS NULL OR cap.starts_at <= now())
   AND (cap.ends_at IS NULL OR cap.ends_at > now())
 ORDER BY cap.weight DESC;
-- Step 3: insert pinned rows into top N positions of the feed
--          (interleaved every 4-5 cards so it doesn't feel "all ads")
```

**Computing user_audiences server-side** (in the discover worker endpoint):

```js
const audiences = ['tier:' + user.tier];
if ((Date.now() - new Date(user.created_at)) < 7*86400_000) audiences.push('new_users');
if (lastGenAt && (Date.now() - lastGenAt) > 30*86400_000) audiences.push('inactive');
for (const tag of mostLikedTags(user.id, 3)) audiences.push(`liked_tag:${tag}`);
for (const fid of followedUserIds(user.id)) audiences.push(`followed:${fid}`);
return audiences;
```

**Admin UI** (new tab in AdminDashboard):

- "Promotions" tab listing all active pins
- Per pin: content thumbnail, target audience, weight slider, scheduled window, "remove" button
- "+ Promote content" button → modal: pick from recommended_content list → pick audience (multi-select) → weight (10-1000 slider) → schedule (optional dates) → save
- Bulk operations: select multiple → end now / extend / change weight

**Limitations** (acceptable for MVP):
- No per-user override (all `tier:starter` users see the same pins)
- No exclusion ("show this to starter EXCEPT users who liked X") — that's V2
- No conversion tracking — admin guesses if the push worked

---

### Layer 2 — Preference-based ranking (3-4 weeks)

**Time to build**: ~3-4 weeks  
**Complexity**: Medium — needs feature store + ranking job

After Layer 1, admin manual pins solve "I want this content boosted".
Layer 2 solves "give each user content they're more likely to like" —
no admin action required.

**Approach: tag-cosine-similarity ranking**

For each user, compute a preference vector from their behavior:

```
likes_vec[tag] = count of liked items with that tag
saves_vec[tag] = count of saved items with that tag * 1.5   (saves > likes signal)
watched_vec[tag] = count of immerse-mode-watched items with that tag * 0.5
follows_vec[tag] = sum over followed creators of avg(their works' tag distribution)

user_pref_vec = normalize(likes + saves + watched + follows)
```

For each candidate content row:

```
content_vec = tags one-hot
score = cosine_similarity(user_pref_vec, content_vec)
final_rank = score * 0.7 + recency_decay * 0.2 + popularity * 0.1
```

This is **content-based filtering** (not collaborative). Cheap, no
ML infra needed, no cold-start problem.

**Implementation:**

- Nightly cron job (Cloudflare Cron Trigger): for each active user, recompute pref vector → store in `user_preferences` table (jsonb)
- Discover endpoint: on each request, JOIN content with user_preferences → compute scores → return ranked
- Cache rankings for 1h per user (Cloudflare KV) to keep p99 low

**Schema:**

```sql
CREATE TABLE user_preferences (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tag_vec    jsonb NOT NULL,            -- { "cinematic": 0.45, "anime": 0.12, ... }
  computed_at timestamptz DEFAULT now()
);
```

**Layer 1 pins still override** — admin pinning a row sets weight high
enough to beat preference ranking. So promotional content reaches the
target audience even if the system thinks they wouldn't like it.

---

### Layer 3 — Adaptive ranking + A/B test framework (6-8 weeks, future)

**Time to build**: 6-8 weeks once we have Layer 2 data flowing  
**Complexity**: High — needs experiment infra

After 3-6 months of Layer 2 production data, we can:

1. **Implicit feedback ML** — train a lightweight collaborative filter
   (item embeddings via ALS or LightFM) to surface "users like you also
   watched". Cold-start for new users falls back to Layer 2.
2. **A/B testing** — assign users to ranking variants (control vs
   experimental algorithm), measure DAU/retention/conversion at 1w 2w 4w
3. **Bandits for promotional pins** — instead of fixed weight, learn
   which pinned content + audience combos drive most engagement
4. **Diversity penalty** — avoid showing the same creator/tag/style
   too many times in a row (the current feed sometimes does this badly)

This is real infra. Defer until growth justifies (probably post-GA when
we have 10k+ DAU).

---

## What I'd recommend building first (concretely)

**Phase 0 (this week, ~4 hours)**: Schema-only prep
- `content_audience_pins` migration (Layer 1 schema)
- `user_preferences` migration (placeholder, empty)
- No UI yet — just lock the data model

**Phase 1 (next 1-2 days)**: Layer 1 MVP
- Admin "Promotions" tab with simple manual pin CRUD
- Audience computation in `/api/discover` worker endpoint
- Interleave pins into feed (every 4th slot)
- Ship

**Phase 2 (after ops gets value from Layer 1, 2-3 weeks later)**: Layer 2
- Nightly cron to populate user_preferences
- Discover endpoint reads + ranks
- Toggle in admin to disable per-user personalization (debug knob)

**Phase 3 (after 3+ months of Layer 2 data)**: Layer 3
- Experiment framework
- Switch from rule-based to learned ranker
- This is post-GA optimization, not MVP

---

## Open questions for Leon

1. **What's the first concrete promotion you want to run?**
   Pinning content for new users? Pushing Starter to Free users? This
   anchors the Layer 1 audience definitions.

2. **Should creators pay for placement?** (sponsored content)
   - If yes → revenue stream, but blocks creator UI changes (creators
     would need a "boost my work" purchase flow with Stripe)
   - If no → Layer 1 is pure admin tool, simpler scope

3. **How aggressive should pin interleaving be?**
   - 1 of 4 cards (25%) — high impact, may feel spammy
   - 1 of 8 cards (12.5%) — subtle
   - Adjustable in admin tab as a global "ad density" slider?

4. **Audience refresh cadence?**
   - On-the-fly per request (slower, always fresh)
   - Cached per user for 1h (faster, stale by max 1h)
   - Pre-computed nightly batch (fastest, stale by max 24h)
   - I'd default to 1h cache — good balance for MVP

5. **Geo targeting**: defer until we have multi-region users + see usage patterns. Not in v1.

---

## Cost / risk summary

| Layer | Build cost | Maintenance | User UX risk |
|---|---|---|---|
| 1: Admin pins | 2 days | Low (manual) | Low — pins feel like editorial picks |
| 2: Pref ranking | 3-4 weeks | Medium (cron, vector storage) | Low if interleaved with diverse rows |
| 3: ML + A/B | 6-8 weeks | High (experiment framework, model ops) | Medium — can degrade UX if model misbehaves |

**Recommendation**: ship Layer 1 within 2 days of getting the green light. Defer 2 and 3 until we see whether Layer 1 alone moves the needle.

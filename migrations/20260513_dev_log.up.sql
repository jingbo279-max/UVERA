-- 20260513_dev_log.up.sql
-- Internal daily dev log for the UVERA team. Each entry covers one day
-- of activity (releases, features, fixes, ops actions, decisions). Lives
-- in admin backend; team policy requires an entry on every non-trivial
-- day. See docs/DEV-LOG-POLICY.md for the discipline.
--
-- Why a table not a markdown file?
--   - Cross-author edits without merge conflicts
--   - Search/filter from admin UI (by date / tag / author)
--   - Visible to non-engineering team members (Leon) who don't have
--     repo access
--   - Audit trail (created_by / updated_by) for accountability

BEGIN;

CREATE TABLE IF NOT EXISTS public.dev_log_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date   date NOT NULL,                                -- the day this entry covers (UTC)
  title        text NOT NULL,                                -- short headline
  body         text NOT NULL,                                -- markdown body
  authors      text[] NOT NULL DEFAULT '{}',                 -- free-text contributor handles
  tags         text[] NOT NULL DEFAULT '{}',                 -- e.g. 'release', 'fix', 'feature', 'devops', 'ops', 'ux', 'pricing'
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dev_log_entries_date_idx
  ON public.dev_log_entries (entry_date DESC);

CREATE INDEX IF NOT EXISTS dev_log_entries_tags_idx
  ON public.dev_log_entries USING GIN (tags);

CREATE OR REPLACE FUNCTION public.dev_log_entries_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dev_log_entries_updated_at ON public.dev_log_entries;
CREATE TRIGGER dev_log_entries_updated_at
  BEFORE UPDATE ON public.dev_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.dev_log_entries_set_updated_at();

-- ── RLS ── internal-only. No public/anon read. Service-role bypasses.
ALTER TABLE public.dev_log_entries ENABLE ROW LEVEL SECURITY;
-- Default deny (no policies) = nobody can SELECT/INSERT/UPDATE/DELETE
-- via PostgREST. Admin worker uses SUPABASE_SERVICE_ROLE_KEY which
-- bypasses RLS entirely. If we later want to expose to logged-in
-- non-admins (e.g. transparency for paid users), add a SELECT policy.

-- ── Seed: last 3 days ──
-- May 11-13, 2026. Manual seed; future entries via admin UI.

INSERT INTO public.dev_log_entries (entry_date, title, body, authors, tags) VALUES

('2026-05-11', 'Profile depth, recast unblock, reliability',
E'### Released v1.1.1\n\n**Profile (#6 #7)**\n- New Saved tab on SelfProfilePage (Works · Recasts · Liked · Saved)\n- Followers/Following counts clickable → modal listing actual users with avatars\n- New components/FollowListModal.jsx + worksService.js + extended followService.js\n- Follower counts now read from live `follows` table (was stale user_metadata)\n\n**Recast unblock (#2 #3 #5 — user bug reports)**\n- LightboxPlayer gates Recast button on `item.allowRecast` (was always shown)\n- StoryGeneratorPage no longer auto-skips step 0 in Recast mode — user can now pick character + style + edit script\n- 5 LightboxPlayer crashes fixed (missing VideoCamera icon import)\n\n**Engagement counts (#4)**\n- Migration `20260511_likes_saves_count_triggers` adds DB triggers to auto-maintain `recommended_content.likes_count/saves_count`\n- One-time backfill so existing engagements register\n- New Save button in LightboxPlayer parallel to Like\n\n**Wallet (#1)**\n- Settings → Wallet & Tokens gets a Token activity section\n- Paginated history from `generation_logs` (50/page, Load more)\n- Migration `20260511_generation_logs_user_read` adds RLS policy so user can read their own rows\n\n**Pricing**\n- Video credits +60%: 480p 2→4 / 720p 3→6 / 1080p 7→12 (cr/sec)\n- 2 files updated in lockstep (worker + StoryGeneratorPage)\n\n**Gemini resilience**\n- gemini-3.1-flash → gemini-3-flash-preview (Neodomain rotated again)\n- Added `geminiFetch()` wrapper with auto-fallback chain — model_not_found auto-walks env-configured candidates and warns ops loudly\n\nCommits: 99fa9f3 839b2dd ef18677 8345c6c 5addcc8 b3f16da 9b0ac4c 57ba9b5 4c237d4',
ARRAY['fei', 'Claude'],
ARRAY['release', 'feature', 'fix', 'pricing']),

('2026-05-12', 'Admin upgrades and v1.1.2',
E'### Released v1.1.2\n\n**Privacy controls (#2)**\n- Public/Private toggle on user works\n- Detail view (LightboxPlayer) + card hover (MasonryGrid) both have Globe/Lock chip for owners\n- Backend: simple direct supabase write — RLS already enforces owner-only\n- Owner-gated client-side too (currentUserId === item.artist)\n\n**Admin order detail (#1)**\n- New right-side drawer when admin clicks any orderNo in Payments & Orders\n- Worker `/api/admin/orders/details` does deep Stripe fetch:\n  - invoice → payment_intent → latest_charge → payment_method_details\n  - customer\n  - refunds list (cumulative, multi-step partial refunds visible)\n- UI sections: source/status pills · customer · money · payment method (brand/last4/exp/country) · refunds · admin audit · Stripe Dashboard link · raw JSON\n- Inline Refund / Void / Restore action buttons added to drawer (polish batch)\n\n**Help Center (#4)**\n- New `help_articles` table (admin-managed knowledge base)\n- 4 worker endpoints (public read + admin CRUD)\n- New admin tab "Help Articles" with editor modal\n- SettingsPage HelpView reads from DB, replaces hardcoded HELP_ITEMS\n- Migration seeds 4 starter articles covering existing categories\n\n**Polish batch**\n- MasonryGrid privacy toggle (was only in detail player)\n- Order drawer inline action buttons (refund/void/restore)\n- Help body switched from hand-rolled markdown parser to `react-markdown` — full CommonMark support\n\n**Strategy doc**\n- docs/decisions/2026-05-12-recommendation-strategy.md\n- 3-layer plan for admin-targeted push (Layer 1: manual pins ~2 days, Layer 2: pref ranking 3-4 weeks, Layer 3: ML + A/B post-GA)\n- Awaiting Leon spec on Layer 1 audience rules before build\n\nMigrations applied (5/12 batch): 20260509_orders_void, 20260509_orders_refund, 20260512_help_articles\n\nCommits: e4b11f1 c0c023a 17d244c e457010 8e59f3f',
ARRAY['fei', 'Claude'],
ARRAY['release', 'feature', 'refactor', 'devops']),

('2026-05-13', 'Production deploy + upload regression triage',
E'### Operations\n\n- **Ran 5 DB migrations in production** (Leon confirmed)\n  - 20260509_orders_void\n  - 20260509_orders_refund\n  - 20260511_likes_saves_count_triggers (incl. backfill)\n  - 20260511_generation_logs_user_read\n  - 20260512_help_articles (incl. 4 seed articles)\n- v1.1.2 deployed via CI\n- Resend domain `send.uvera.ai` Verified after SPF/DKIM/DMARC propagated (Leon configured DNS in Cloudflare)\n- Email pipeline test passed (admin endpoint `/api/admin/email/test`)\n\n### Bug triage\n\n- **Tester report: video upload broken** (mid-day)\n- Reviewed upload code — no recent commits touched `/api/user-videos/init-upload` or `/api/internal-video/init-upload` paths\n- Hypothesis ranked by likelihood:\n  1. `CF_API_TOKEN` env var not set in Cloudflare → falls through to hardcoded fallback in worker line 2601 → token may have been rotated/revoked\n  2. Cloudflare Stream account billing issue (new UGHF Technology Inc account)\n  3. Migration side-effect (low — uploads use separate tables)\n  4. Service Worker cached old JS (user side)\n- Waiting on tester DevTools console error to confirm root cause\n- Quick test path: ops to verify `CF_API_TOKEN` is set in Cloudflare → Workers → Variables\n\n### New work started\n\n- Dev log feature (this entry is the first one) — admin-managed daily log table + CRUD + project policy doc\n- Migration: `20260513_dev_log` (this file)',
ARRAY['fei', 'Claude'],
ARRAY['devops', 'ops', 'investigation']);

COMMIT;

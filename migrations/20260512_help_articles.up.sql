-- 20260512_help_articles.up.sql
-- Help Center Q&A — admin-managed knowledge base entries shown to users
-- in SettingsPage → Help Center. Replaces the previously hardcoded
-- HELP_ITEMS stub array with a real DB table so non-engineering staff
-- (Leon / support) can add/edit/remove articles via the admin dashboard.
--
-- Categories are FREE-TEXT strings rather than an enum so the team can
-- coin new categories (e.g. 'troubleshooting', 'payments', 'account')
-- without schema migrations. The frontend groups by category for display.

BEGIN;

CREATE TABLE IF NOT EXISTS public.help_articles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text NOT NULL,            -- e.g. 'getting-started', 'billing'
  title        text NOT NULL,
  body         text NOT NULL,            -- markdown supported in renderer
  sort_order   integer NOT NULL DEFAULT 0,  -- lower = higher in list
  published    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS help_articles_category_idx
  ON public.help_articles (category, sort_order);

CREATE INDEX IF NOT EXISTS help_articles_published_idx
  ON public.help_articles (published)
  WHERE published = true;

-- updated_at auto-touch trigger
CREATE OR REPLACE FUNCTION public.help_articles_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS help_articles_updated_at ON public.help_articles;
CREATE TRIGGER help_articles_updated_at
  BEFORE UPDATE ON public.help_articles
  FOR EACH ROW EXECUTE FUNCTION public.help_articles_set_updated_at();

-- ── RLS ──
-- Public can read published articles; admins manage everything via
-- worker endpoints (service-role bypasses RLS for writes).
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "help_articles_read_published" ON public.help_articles;
CREATE POLICY "help_articles_read_published"
  ON public.help_articles
  FOR SELECT
  USING (published = true);

-- Note: admin write access is intentionally NOT via RLS — admin worker
-- endpoints use SUPABASE_SERVICE_ROLE_KEY which bypasses RLS entirely.
-- Direct PostgREST writes from the frontend are blocked (no INSERT/
-- UPDATE/DELETE policy = denied).

GRANT SELECT ON public.help_articles TO anon, authenticated;

-- Seed: migrate the four hardcoded HELP_ITEMS stub categories so
-- existing UI shells get content immediately without an empty state.
INSERT INTO public.help_articles (category, title, body, sort_order, published)
VALUES
  ('getting-started', 'Generate your first video',
   E'1. Open the **Create** page from the main navigation.\n2. Type a story prompt (English or Chinese both work).\n3. Pick a character avatar — yours or a default.\n4. Pick a visual style.\n5. Review the auto-generated script, then click **Render**.\n\nFirst-time users get 20 welcome tokens. Each 5-second 480p video costs 20 tokens.',
   10, true),
  ('billing', 'How do tokens work?',
   E'Tokens are UVERA''s usage credit. Each AI generation costs tokens — videos, concept images, scripts, etc.\n\n**Token sources:**\n- 20 welcome tokens on signup\n- 6 free tokens per day for everyone (claim from Wallet page)\n- Monthly tokens from your subscription (Starter 500 / Creator 1500 / Studio 5000)\n- One-time top-ups (Lite plan: $3.99 for 100 tokens)',
   10, true),
  ('billing', 'Cancel or change my subscription',
   E'Open **Settings → Wallet & Tokens** → click **Manage Subscription** to open the Stripe customer portal. From there you can:\n- Change plan (upgrade/downgrade)\n- Update payment method\n- Cancel subscription (effective at the end of the current billing period — you keep using paid features until then)\n- View past invoices and download receipts',
   20, true),
  ('report-issue', 'How to report a bug or content issue',
   E'**For technical bugs**: email support@uvera.ai with steps to reproduce + your browser + a screenshot.\n\n**For inappropriate content** in the Discover feed: click the **flag** icon on the content card to file a report. Our team reviews reports within 24 hours.\n\n**For copyright takedown requests**: see our [DMCA policy](/legal/dmca) for the formal notice process.',
   10, true);

COMMIT;

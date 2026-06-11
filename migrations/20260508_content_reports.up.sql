-- =============================================================================
-- Content reports — DMCA takedown + abuse reporting infrastructure.
--
-- One row per report. A user (or anonymous visitor) clicks "Report" on
-- a Discover card / series detail page → fills the modal → POST to
-- /api/content-reports/submit → row inserted here with status='open'.
--
-- Admin triages from the AdminDashboard "Reports" tab; can mark each
-- report as resolved (took action), dismissed (no violation), or under
-- investigation (waiting on more info).
--
-- The reported_content_id is a free-text reference: typically a
-- recommended_content.id (Discover card), but for series it can be a
-- series.id, and we leave it open for future content surfaces (user
-- profiles, comments) so we don't have to migrate this table on every
-- new content type. The `content_type` discriminator tells the admin
-- UI which table to look up details from.
--
-- Why anonymous reports are allowed (reporter_user_id NULL):
-- DMCA takedown notices can come from non-users (e.g. a copyright
-- holder who isn't on uvera.ai). Worker captures their IP + UA to
-- support eventual legal correspondence. Authenticated users get
-- proper attribution.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who reported. NULL = anonymous (still captures IP/UA below).
  reporter_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reporter_email text,    -- denormalized for admin UI + DMCA correspondence

  -- What was reported.
  --   content_type ∈ {recommended_content, series, user_video_upload}
  --   reported_content_id = the row's id in the corresponding table
  content_type text NOT NULL
    CHECK (content_type IN ('recommended_content','series','user_video_upload')),
  reported_content_id uuid NOT NULL,
  -- Snapshot of context at time of report (what the reporter was looking at).
  -- Lets admin understand the report even if the original row was edited
  -- or deleted between report and triage.
  reported_title text,
  reported_url text,

  -- The report itself.
  --   reason: enum (front-end picks from a fixed set)
  --   detail: optional free-text the user supplies
  reason text NOT NULL
    CHECK (reason IN ('copyright','inappropriate','spam','impersonation','dangerous','other')),
  detail text CHECK (detail IS NULL OR length(detail) <= 4000),

  -- Status / review trail
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','resolved','dismissed')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  action_taken text,    -- e.g. 'unpublished', 'archived', 'no_action'

  -- Diagnostics
  reporter_ip inet,
  reporter_user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ────────────────────────────────────────────────────────────────
-- Admin's primary query: open reports newest first
CREATE INDEX IF NOT EXISTS idx_content_reports_status
  ON public.content_reports(created_at DESC)
  WHERE status = 'open';

-- "Show me all reports for this content" (when admin clicks into a Discover row)
CREATE INDEX IF NOT EXISTS idx_content_reports_target
  ON public.content_reports(content_type, reported_content_id);

-- "Show me my submissions" (a user pivots from My Reports later)
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter
  ON public.content_reports(reporter_user_id, created_at DESC)
  WHERE reporter_user_id IS NOT NULL;

-- ── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_content_reports_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_reports_updated_at ON public.content_reports;
CREATE TRIGGER trg_content_reports_updated_at
  BEFORE UPDATE ON public.content_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_content_reports_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;

-- Reporters see their own reports (transparency on what's been triaged)
CREATE POLICY "content_reports_select_own" ON public.content_reports
  FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid());

-- Admins see + manage all
CREATE POLICY "content_reports_admin_full" ON public.content_reports
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- INSERT path is via Worker /api/content-reports/submit (service_role),
-- which validates content_type / reason / target existence. We
-- deliberately don't add a user-INSERT policy so abuse like flooding
-- reports with garbage isn't trivial.

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'content_reports' ORDER BY ordinal_position;
--
-- SELECT polname FROM pg_policy WHERE polrelid = 'public.content_reports'::regclass;

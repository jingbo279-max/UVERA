-- =============================================================================
-- User-uploaded videos with mandatory admin review + copyright attestation
--
-- Flow:
--   1. User in Quick Create → "Upload Video" mode → ticks copyright checkbox
--      → uploads video file directly to Cloudflare Stream (bypasses Worker
--      100 MB body limit; Stream supports up to 30 GB per video).
--   2. Worker /api/user-videos/init-upload creates Stream Direct Upload URL
--      and inserts a row here with status='uploading' + copyright_acknowledged_at.
--   3. Browser PUTs file to Stream URL. After completion, browser calls
--      /api/user-videos/finalize → row flips to status='pending_review'.
--   4. Admin sees the video in AdminDashboard → User Videos tab.
--      Approve → status='approved' + a row is inserted in recommended_content
--                so the video shows on Discover (per product decision 2026-05-07).
--      Reject  → status='rejected' + rejection_reason filled.
--
-- Why a separate table (vs. extending recommended_content):
--   - recommended_content has zero RLS-on-write because admin uses service role
--     to manage the homepage feed. Letting users insert there directly would
--     break that model.
--   - The pending → approved → rejected lifecycle is specific to user uploads
--     and doesn't fit the homepage feed's content model (which has CTAs,
--     pin order, etc. that aren't user-controlled).
--
-- Legal trail (per project_legal_lawyer.md / external counsel review):
--   - copyright_acknowledged_at is NOT NULL — must have a real timestamp,
--     proves user clicked the checkbox.
--   - copyright_text_version captures which version of the disclaimer was shown
--     (so future text revisions don't undermine old records' admissibility).
--   - submitter_ip + submitter_user_agent assist with subpoena response if a
--     DMCA / 著作权法 takedown leads to litigation.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_video_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Cloudflare Stream identifiers. UID is set when init-upload returns;
  -- playback_url + thumbnail filled after finalize so admin can preview.
  stream_uid text UNIQUE,
  playback_url text,            -- iframe.cloudflarestream.com/<uid>
  thumbnail_url text,           -- videodelivery.net/<uid>/thumbnails/thumbnail.jpg

  -- User-supplied metadata. Title is required; description is optional.
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  original_filename text,
  file_size_bytes bigint,
  duration_seconds int,

  -- Lifecycle. Initial state from init-upload is 'uploading'; transitions
  -- to 'pending_review' on finalize, then 'approved' or 'rejected'.
  status text NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','pending_review','approved','rejected')),

  -- Legal attestation
  copyright_acknowledged_at timestamptz NOT NULL,
  copyright_text_version text NOT NULL,
  submitter_ip inet,
  submitter_user_agent text,

  -- Review trail
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,

  -- If approved AND we mirrored into recommended_content, store the FK
  -- so a future "unpublish from Discover" admin action can find the row.
  recommended_content_id uuid,

  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
-- Admin's "pending review" query: WHERE status='pending_review' ORDER BY created_at
CREATE INDEX IF NOT EXISTS idx_user_video_uploads_pending
  ON public.user_video_uploads(created_at DESC)
  WHERE status = 'pending_review';
-- User's "my submissions" query
CREATE INDEX IF NOT EXISTS idx_user_video_uploads_user
  ON public.user_video_uploads(user_id, created_at DESC);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_video_uploads ENABLE ROW LEVEL SECURITY;

-- Users see their own submissions (status transparency)
CREATE POLICY "user_video_uploads_select_own" ON public.user_video_uploads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admins see + manage everything
CREATE POLICY "user_video_uploads_admin_full" ON public.user_video_uploads
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Note: user INSERTs go through the Worker (which uses service_role),
-- not via direct PostgREST, so we deliberately don't add a user-INSERT
-- policy. This keeps users from forging copyright_acknowledged_at on
-- the client and ensures every insert is attached to a Stream UID
-- the Worker just minted.

COMMIT;

-- ── Verify (run separately) ────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'user_video_uploads' ORDER BY ordinal_position;
--
-- SELECT polname, polcmd FROM pg_policy
-- WHERE polrelid = 'public.user_video_uploads'::regclass;

-- =============================================================================
-- Migration: beta_requests table for early-access feature requests
-- Date: 2026-05-06
-- Purpose: Capture user requests to try Pro / under-construction features
--          (Creative Canvas first; pattern is reusable for future features).
-- Execution: Paste into Supabase Dashboard → SQL Editor → Run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.beta_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature     varchar(64) NOT NULL,
  status      varchar(32) NOT NULL DEFAULT 'pending', -- pending | approved | declined
  created_at  timestamptz NOT NULL DEFAULT now(),
  notes       text,
  UNIQUE (user_id, feature)
);

ALTER TABLE public.beta_requests ENABLE ROW LEVEL SECURITY;

-- Users can submit their own request
CREATE POLICY "beta_requests_insert_own" ON public.beta_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can read their own requests (to know if they've already submitted)
CREATE POLICY "beta_requests_select_own" ON public.beta_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Admins can do anything (read all, update status, decline, etc.)
CREATE POLICY "beta_requests_admin_full" ON public.beta_requests
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Indices for the admin list query
CREATE INDEX IF NOT EXISTS idx_beta_requests_user_id ON public.beta_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_beta_requests_status_created ON public.beta_requests(status, created_at DESC);

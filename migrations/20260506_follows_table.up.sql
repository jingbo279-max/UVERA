-- 2026-05-06 — public.follows table for user follow graph
-- Spark right pane "+ Follow" button needs persistence beyond client
-- state. Mirrors user_likes / user_saves pattern.
-- Authorized by Leon (right pane Phase B: +follow 实).

CREATE TABLE IF NOT EXISTS public.follows (
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CONSTRAINT follows_no_self_follow CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS follows_following_idx ON public.follows(following_id);
CREATE INDEX IF NOT EXISTS follows_follower_idx  ON public.follows(follower_id);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Anyone can read the follow graph (public follower/following counts)
DROP POLICY IF EXISTS "follows_read_public" ON public.follows;
CREATE POLICY "follows_read_public"
  ON public.follows FOR SELECT
  USING (true);

-- Only insert as yourself (follower_id must match auth.uid)
DROP POLICY IF EXISTS "follows_insert_self" ON public.follows;
CREATE POLICY "follows_insert_self"
  ON public.follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

-- Only delete your own follow rows
DROP POLICY IF EXISTS "follows_delete_self" ON public.follows;
CREATE POLICY "follows_delete_self"
  ON public.follows FOR DELETE
  USING (auth.uid() = follower_id);

GRANT SELECT ON public.follows TO anon, authenticated;
GRANT INSERT, DELETE ON public.follows TO authenticated;

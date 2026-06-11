-- 20260511_likes_saves_count_triggers.up.sql
-- Maintains recommended_content.likes_count and .saves_count automatically
-- via triggers on user_likes / user_saves tables.
--
-- Bug context: the count columns existed on recommended_content (used by
-- MasonryGrid hover badge + LightboxPlayer like button label) but had no
-- mechanism keeping them fresh. interactionService.toggleLikeStatus does
-- INSERT/DELETE on user_likes only — the count column on
-- recommended_content stayed at its default (NULL or 0) forever, so no
-- count ever showed in the UI (display gates on count > 0).
--
-- Fix: trigger functions that increment/decrement on INSERT/DELETE.
-- Idempotent — ON CONFLICT DO NOTHING / INSERT failure inside transaction
-- won't fire the trigger (PostgreSQL trigger semantics). Same for DELETE
-- on non-existent row.
--
-- Backfill at the end syncs existing rows so old likes/saves count too.

BEGIN;

-- ─── 1. Ensure columns exist with default 0 (safety: some older rows may have NULL)
ALTER TABLE public.recommended_content
  ALTER COLUMN likes_count SET DEFAULT 0,
  ALTER COLUMN saves_count SET DEFAULT 0;

UPDATE public.recommended_content SET likes_count = 0 WHERE likes_count IS NULL;
UPDATE public.recommended_content SET saves_count = 0 WHERE saves_count IS NULL;

ALTER TABLE public.recommended_content
  ALTER COLUMN likes_count SET NOT NULL,
  ALTER COLUMN saves_count SET NOT NULL;

-- ─── 2. Trigger functions
CREATE OR REPLACE FUNCTION public.bump_likes_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recommended_content
       SET likes_count = likes_count + 1
     WHERE id = NEW.content_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE recommended_content
       SET likes_count = GREATEST(likes_count - 1, 0)
     WHERE id = OLD.content_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.bump_saves_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE recommended_content
       SET saves_count = saves_count + 1
     WHERE id = NEW.content_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE recommended_content
       SET saves_count = GREATEST(saves_count - 1, 0)
     WHERE id = OLD.content_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ─── 3. Wire triggers (drop-and-recreate so this migration is idempotent)
DROP TRIGGER IF EXISTS user_likes_count_bump ON public.user_likes;
CREATE TRIGGER user_likes_count_bump
  AFTER INSERT OR DELETE ON public.user_likes
  FOR EACH ROW EXECUTE FUNCTION public.bump_likes_count();

DROP TRIGGER IF EXISTS user_saves_count_bump ON public.user_saves;
CREATE TRIGGER user_saves_count_bump
  AFTER INSERT OR DELETE ON public.user_saves
  FOR EACH ROW EXECUTE FUNCTION public.bump_saves_count();

-- ─── 4. Backfill counts from current table state
-- One-time sync so existing engagements show their correct counts after
-- triggers go live. Future inserts/deletes maintain via triggers.
UPDATE public.recommended_content rc
   SET likes_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT content_id, COUNT(*) AS cnt
      FROM public.user_likes
     GROUP BY content_id
  ) sub
 WHERE rc.id = sub.content_id;

UPDATE public.recommended_content rc
   SET saves_count = COALESCE(sub.cnt, 0)
  FROM (
    SELECT content_id, COUNT(*) AS cnt
      FROM public.user_saves
     GROUP BY content_id
  ) sub
 WHERE rc.id = sub.content_id;

COMMIT;

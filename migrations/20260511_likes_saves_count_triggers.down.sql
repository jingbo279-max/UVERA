-- 20260511_likes_saves_count_triggers.down.sql
DROP TRIGGER IF EXISTS user_likes_count_bump ON public.user_likes;
DROP TRIGGER IF EXISTS user_saves_count_bump ON public.user_saves;
DROP FUNCTION IF EXISTS public.bump_likes_count;
DROP FUNCTION IF EXISTS public.bump_saves_count;
-- Note: leave likes_count / saves_count columns + their values intact —
-- they're still readable by the UI even without triggers, just won't
-- update on new engagements.

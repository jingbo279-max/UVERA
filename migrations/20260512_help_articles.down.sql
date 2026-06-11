-- 20260512_help_articles.down.sql
DROP TRIGGER IF EXISTS help_articles_updated_at ON public.help_articles;
DROP FUNCTION IF EXISTS public.help_articles_set_updated_at;
DROP TABLE IF EXISTS public.help_articles;

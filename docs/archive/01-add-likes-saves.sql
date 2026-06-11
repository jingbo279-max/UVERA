-- 1. Add metrics columns to recommended_content
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS likes_count integer DEFAULT 0;
ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS saves_count integer DEFAULT 0;

-- 2. Create user_likes table
CREATE TABLE IF NOT EXISTS public.user_likes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    content_id uuid REFERENCES public.recommended_content(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, content_id)
);

-- 3. Create user_saves table
CREATE TABLE IF NOT EXISTS public.user_saves (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    content_id uuid REFERENCES public.recommended_content(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, content_id)
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.user_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_saves ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for user_likes
CREATE POLICY "Users can read their own likes" ON public.user_likes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own likes" ON public.user_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own likes" ON public.user_likes FOR DELETE USING (auth.uid() = user_id);

-- 6. RLS Policies for user_saves
CREATE POLICY "Users can read their own saves" ON public.user_saves FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own saves" ON public.user_saves FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own saves" ON public.user_saves FOR DELETE USING (auth.uid() = user_id);

-- 7. Triggers to auto-update likes_count and saves_count
CREATE OR REPLACE FUNCTION update_content_metrics()
RETURNS trigger AS $$
BEGIN
    IF TG_TABLE_NAME = 'user_likes' THEN
        IF TG_OP = 'INSERT' THEN
            UPDATE public.recommended_content SET likes_count = likes_count + 1 WHERE id = NEW.content_id;
        ELSIF TG_OP = 'DELETE' THEN
            UPDATE public.recommended_content SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.content_id;
        END IF;
    ELSIF TG_TABLE_NAME = 'user_saves' THEN
        IF TG_OP = 'INSERT' THEN
            UPDATE public.recommended_content SET saves_count = saves_count + 1 WHERE id = NEW.content_id;
        ELSIF TG_OP = 'DELETE' THEN
            UPDATE public.recommended_content SET saves_count = GREATEST(saves_count - 1, 0) WHERE id = OLD.content_id;
        END IF;
    END IF;
    RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_likes_count ON public.user_likes;
CREATE TRIGGER trg_update_likes_count
AFTER INSERT OR DELETE ON public.user_likes
FOR EACH ROW EXECUTE FUNCTION update_content_metrics();

DROP TRIGGER IF EXISTS trg_update_saves_count ON public.user_saves;
CREATE TRIGGER trg_update_saves_count
AFTER INSERT OR DELETE ON public.user_saves
FOR EACH ROW EXECUTE FUNCTION update_content_metrics();

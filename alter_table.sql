ALTER TABLE public.recommended_content ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

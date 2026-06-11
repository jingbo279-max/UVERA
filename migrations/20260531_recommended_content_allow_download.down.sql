BEGIN;
ALTER TABLE public.recommended_content DROP COLUMN IF EXISTS allow_download;
NOTIFY pgrst, 'reload schema';
COMMIT;

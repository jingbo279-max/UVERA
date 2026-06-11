-- docs/archive/02-add-aspect-ratio.sql

-- Add the aspect_ratio column to recommended_content
ALTER TABLE public.recommended_content
ADD COLUMN aspect_ratio text DEFAULT NULL;

-- Note: The new column is optional. If left NULL, the frontend will automatically
-- fall back to the default mapped aspect ratio based on the content `type` (e.g. 9/16 for VIDEO).

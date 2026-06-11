-- 20260513_source_character_to_actor_rename.down.sql
-- Reverses the source_actor_id → source_character_id rename.
-- Only affects rows that have source_actor_id but no source_character_id
-- (i.e. rows where backward-compat dual-write wasn't active when row was
-- created — won't happen in practice during the rename window, but safe).

BEGIN;

UPDATE public.characters
SET identity_features = to_jsonb(
  (
    ((identity_features #>> '{}')::jsonb - 'source_actor_id')
    || jsonb_build_object(
         'source_character_id',
         (identity_features #>> '{}')::jsonb ->> 'source_actor_id'
       )
  )::text
)
WHERE identity_features IS NOT NULL
  AND jsonb_typeof(identity_features) = 'string'
  AND (identity_features #>> '{}')::jsonb ? 'source_actor_id'
  AND NOT ((identity_features #>> '{}')::jsonb ? 'source_character_id');

COMMIT;

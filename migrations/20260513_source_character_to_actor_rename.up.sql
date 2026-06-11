-- 20260513_source_character_to_actor_rename.up.sql
-- §B of the v1.2 命名整改 (Leon's 2026-05-13 spec).
--
-- The `characters.identity_features` JSONB column stores a JSON STRING
-- (not a JSON object) because frontend does `JSON.stringify(...)` before
-- POST. So column value looks like:
--   "{\"style\":\"Cinematic\",\"source_character_id\":\"abc\",...}"
-- (a JSONB string scalar, not a JSONB object).
--
-- To read the inner key:
--   1. Unwrap the outer string: identity_features #>> '{}'
--   2. Cast the resulting text to jsonb to access keys
--
-- The inner key `source_character_id` actually points to the root Actor
-- (created from a real avatar), not a "source Character". Misleading
-- name accumulated over time. Renaming to `source_actor_id` to match
-- the data semantics.
--
-- Frontend already writes BOTH keys for backward compat (dual-write)
-- since Leon's 2026-05-13 commit. This migration backfills OLD rows
-- (created before dual-write) that have only `source_character_id`.
-- WHERE clause makes it idempotent — safe to re-run.

BEGIN;

UPDATE public.characters
SET identity_features = to_jsonb(
  (
    -- Step 1: unwrap outer JSON string, parse to JSONB object
    -- Step 2: remove old key
    -- Step 3: re-add value under new key
    ((identity_features #>> '{}')::jsonb - 'source_character_id')
    || jsonb_build_object(
         'source_actor_id',
         (identity_features #>> '{}')::jsonb ->> 'source_character_id'
       )
  )::text
)
WHERE identity_features IS NOT NULL
  AND identity_features <> 'null'::jsonb
  AND jsonb_typeof(identity_features) = 'string'
  AND (identity_features #>> '{}')::jsonb ? 'source_character_id'
  AND NOT ((identity_features #>> '{}')::jsonb ? 'source_actor_id');

-- Audit: how many rows did we migrate?
DO $$
DECLARE
  remaining_count int;
BEGIN
  SELECT count(*) INTO remaining_count
    FROM public.characters
   WHERE identity_features IS NOT NULL
     AND jsonb_typeof(identity_features) = 'string'
     AND (identity_features #>> '{}')::jsonb ? 'source_character_id'
     AND NOT ((identity_features #>> '{}')::jsonb ? 'source_actor_id');
  IF remaining_count > 0 THEN
    RAISE WARNING 'After migration, % rows still have source_character_id but no source_actor_id — investigate before Phase 4 cleanup', remaining_count;
  ELSE
    RAISE NOTICE 'Migration complete: all rows with source_character_id now also have source_actor_id';
  END IF;
END$$;

COMMIT;

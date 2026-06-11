-- §2026-05-25 fei — One-shot cleanup: clear Seedance TOS temp URLs from
-- existing generation_logs.output_url rows.
--
-- Context: prior to commit eb3f941, the worker /api/volcengine/video/status
-- endpoint wrote the BytePlus TOS signed URL (e.g.
-- https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com/...)
-- to generation_logs.output_url. The signed URL expires in 24h, making old
-- admin Generation Logs entries useless (link 404s).
--
-- New worker behavior (commit after this migration): status endpoint leaves
-- output_url NULL on success; only the subsequent /api/stream/upload-from-url
-- call PATCHes it to the permanent R2 / CF Stream URL.
--
-- This migration nulls out existing TOS URLs so admin sees consistent state
-- (NULL = "no permanent URL available" instead of a dead link).
-- Permanent R2 / CF Stream URLs (asset.uvera.ai, videodelivery.net,
-- cloudflarestream.com) are kept untouched.
--
-- Idempotent: re-running this migration is a no-op once the rows are nulled.

BEGIN;

UPDATE public.generation_logs
   SET output_url = NULL
 WHERE output_url IS NOT NULL
   AND (
        output_url LIKE '%tos-ap-southeast%volces.com%'
     OR output_url LIKE '%tos-ap-southeast-1%volces.com%'
     OR output_url LIKE '%ark-acg-%'
     OR (output_url LIKE '%volces.com%' AND output_url LIKE '%X-Tos-Signature%')
   );

COMMIT;

-- Verify after run:
--   SELECT count(*) FROM public.generation_logs
--    WHERE output_url LIKE '%volces.com%';
-- Should return 0.

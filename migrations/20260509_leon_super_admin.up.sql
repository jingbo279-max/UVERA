-- =============================================================================
-- Add Leon (product lead) as super_admin.
--
-- Background: 20260507_admin_roles.up.sql seeded 2 super_admins
-- (feifeixp + longvv.dev) and 6 ops admins. Leon was unintentionally
-- omitted — product lead should also be a super_admin so he can verify
-- System Settings / connectivity tests etc.
--
-- super_admin = is_admin: true + is_super_admin: true
-- (mirrors original migration's pattern; client-side gate, see
--  src/api/adminService.js checkSuperAdmin())
-- =============================================================================

BEGIN;

UPDATE auth.users
SET raw_user_meta_data =
  COALESCE(raw_user_meta_data, '{}'::jsonb)
  || '{"is_admin": true, "is_super_admin": true}'::jsonb
WHERE email = 'leonsuen@gmail.com';

COMMIT;

-- ── Verify ────────────────────────────────────────────────────────────────
-- SELECT email,
--        raw_user_meta_data->>'is_admin' AS is_admin,
--        raw_user_meta_data->>'is_super_admin' AS is_super_admin
-- FROM auth.users
-- WHERE email = 'leonsuen@gmail.com';
--
-- Expected: 1 row, both = 'true'.
-- If 0 rows: Leon hasn't completed Google OAuth login yet — have him
-- visit https://uvera.ai/auth and sign in once, then re-run this.

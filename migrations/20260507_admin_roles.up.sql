-- =============================================================================
-- Two-tier admin model: super_admin + admin
--
-- Existing model: user_metadata.is_admin = true → full admin access.
-- New model:
--   user_metadata.is_admin = true        → can access AdminDashboard
--   user_metadata.is_super_admin = true  → ALSO can access System Settings tab
--
-- Both roles pass the existing public.is_admin() SQL helper, so RLS gating
-- is unchanged. The super-admin distinction is enforced client-side only
-- (System Settings tab hidden from non-super admins). This is acceptable
-- because System Settings doesn't expose secrets anymore — it only has the
-- non-destructive "test connectivity" button.
-- =============================================================================

BEGIN;

-- ─── Super admins (existing operators) ──────────────────────────────────────
UPDATE auth.users
SET raw_user_meta_data =
  COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true, "is_super_admin": true}'::jsonb
WHERE email IN ('feifeixp@gmail.com', 'longvv.dev@gmail.com');

-- ─── Regular admins (new — no System Settings access) ───────────────────────
UPDATE auth.users
SET raw_user_meta_data =
  COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"is_admin": true}'::jsonb
WHERE email IN (
  'yazhongliu186@gmail.com',
  'tuaiai20260304@gmail.com',
  'jessiehuang9215@gmail.com',
  'hquanbin662@gmail.com',
  'jingbo279@gmail.com',
  'bachbanana@gmail.com'
);

COMMIT;

-- ─── Verify (run separately to inspect) ─────────────────────────────────────
SELECT
  email,
  raw_user_meta_data ->> 'is_admin'       AS is_admin,
  raw_user_meta_data ->> 'is_super_admin' AS is_super_admin
FROM auth.users
WHERE (raw_user_meta_data ->> 'is_admin')::boolean = true
ORDER BY (raw_user_meta_data ->> 'is_super_admin')::boolean DESC NULLS LAST, email;

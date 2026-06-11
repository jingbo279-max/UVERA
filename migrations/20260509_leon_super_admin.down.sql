-- Revoke Leon's admin status.
UPDATE auth.users
SET raw_user_meta_data = (raw_user_meta_data - 'is_admin' - 'is_super_admin')
WHERE email = 'leonsuen@gmail.com';

-- ============================================================
-- Migration 20260402200002: Allow authenticated users to read admin_users
-- The RLS hardening in 20260402000001 locked admin_users to service_role only,
-- which broke the admin portal — loadAdminUser() needs SELECT on admin_users
-- to resolve display_name and role from the logged-in user's email.
-- ============================================================

-- Keep service_role full access (already exists), add authenticated SELECT
DROP POLICY IF EXISTS "Authenticated read own admin_users" ON admin_users;
CREATE POLICY "Authenticated read own admin_users"
  ON admin_users FOR SELECT
  USING (auth.jwt() ->> 'email' = email);

-- Also allow authenticated to read admin_roles (needed for join)
DROP POLICY IF EXISTS "Authenticated read admin_roles" ON admin_roles;
CREATE POLICY "Authenticated read admin_roles"
  ON admin_roles FOR SELECT
  USING (true);

-- Allow authenticated to read role_permissions (needed for permission check)
DROP POLICY IF EXISTS "Authenticated read role_permissions" ON role_permissions;
CREATE POLICY "Authenticated read role_permissions"
  ON role_permissions FOR SELECT
  USING (true);

-- Allow authenticated to read admin_permissions (needed for hasPerm)
DROP POLICY IF EXISTS "Authenticated read admin_permissions" ON admin_permissions;
CREATE POLICY "Authenticated read admin_permissions"
  ON admin_permissions FOR SELECT
  USING (true);

-- Allow admin to update own last_login
DROP POLICY IF EXISTS "Admin update own login" ON admin_users;
CREATE POLICY "Admin update own login"
  ON admin_users FOR UPDATE
  USING (auth.jwt() ->> 'email' = email)
  WITH CHECK (auth.jwt() ->> 'email' = email);

SELECT 'MIGRATION 20260402200002 COMPLETE — admin_users read policy for authenticated' AS result;

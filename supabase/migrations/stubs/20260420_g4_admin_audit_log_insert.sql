-- ============================================================
-- STUB: Admin INSERT-policy på admin_audit_log
-- Källa: [20260402000001_fix_rls_security.sql:154-156] låste
--         admin_audit_log till service_role only. Admin.html
--         använder authenticated JWT ([admin.html:1237]) →
--         alla 33+ auditLog()-anrop misslyckas tyst.
-- Regel #27-fix: återställ authenticated-admin INSERT.
-- ============================================================

BEGIN;

-- Behåll service_role-policy (sätts redan i 20260402000001)
-- Lägg till authenticated-INSERT för admin:

DROP POLICY IF EXISTS "Admin INSERT audit log" ON admin_audit_log;

CREATE POLICY "Admin INSERT audit log"
  ON admin_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.jwt() ->> 'email' IN (
      SELECT email FROM admin_users
    )
  );

-- Även SELECT för admin för att kunna visa audit-historik i UI:
DROP POLICY IF EXISTS "Admin SELECT audit log" ON admin_audit_log;

CREATE POLICY "Admin SELECT audit log"
  ON admin_audit_log FOR SELECT
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (
      SELECT email FROM admin_users
    )
  );

COMMIT;

-- Verifiering efter deploy:
-- 1. Logga in som admin i admin.html
-- 2. Gör en cleaner-update eller annan loggad action
-- 3. Kör: SELECT COUNT(*) FROM admin_audit_log WHERE created_at > NOW() - INTERVAL '5 minutes';
--    Förväntat: ≥ 1 (innan fix: 0)

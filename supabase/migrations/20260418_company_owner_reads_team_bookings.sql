-- ============================================================
-- Migration 20260418: Company owner reads team bookings
-- ============================================================
-- Dokumenterar policy som finns i prod sedan tidigare men
-- saknades i repo. Möjliggör att stadare-dashboard.html
-- (rad 6171-6175) visar team-bokningar för VD.
--
-- Uppdaterad 2026-04-22 (§2.4): inner-subquery alias `c2` → `owner`
-- för match mot prod (prod-schema.sql rad 4970-4974 använder `owner`).
-- Semantiskt identisk till tidigare version.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del C.2
-- Samma mönster som "Company owner can read team members" på
-- cleaners-tabellen (docs/archive/sql-legacy/companies-and-teams.sql:55-61).
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "Company owner reads team bookings" ON bookings;

CREATE POLICY "Company owner reads team bookings"
  ON bookings FOR SELECT
  TO authenticated
  USING (
    cleaner_id IN (
      SELECT c.id FROM cleaners c
      WHERE c.company_id IN (
        SELECT owner.company_id FROM cleaners owner
        WHERE owner.auth_user_id = auth.uid()
          AND owner.is_company_owner = true
      )
    )
  );

COMMIT;

-- Verifiering:
-- Logga in som VD (Zivar) i stadare-dashboard.html.
-- Kontrollera att "Teamets bokningar" visar bokningar
-- med cleaner_id inom Zivars företag.

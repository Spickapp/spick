-- ============================================================
-- Migration 20260418: Company owner reads team bookings
-- ============================================================
-- Dokumenterar policy som finns i prod sedan tidigare men
-- saknades i repo. Möjliggör att stadare-dashboard.html
-- (rad 6171-6175) visar team-bokningar för VD.
--
-- Referens: docs/audits/2026-04-18-rls-full-audit.md Del C.2
-- Samma mönster som "Company owner can read team members" på
-- cleaners-tabellen (sql/companies-and-teams.sql:55-61).
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
        SELECT c2.company_id FROM cleaners c2
        WHERE c2.auth_user_id = auth.uid()
          AND c2.is_company_owner = true
      )
    )
  );

COMMIT;

-- Verifiering:
-- Logga in som VD (Zivar) i stadare-dashboard.html.
-- Kontrollera att "Teamets bokningar" visar bokningar
-- med cleaner_id inom Zivars företag.

-- ============================================================
-- Fas 0.2b Paket 4: booking_checklists + service_checklists grants + RLS
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
--
-- Kritiskt fynd före Paket 4: Båda tabellerna saknade helt grants för
-- authenticated/anon/service_role. Endast postgres hade rättigheter.
-- Detta betyder att befintliga RLS-policies aldrig kunde utvärderas —
-- 42501 permission denied triggades på grant-nivå innan RLS.
--
-- Konsekvens: Hela check-out-flödet med checklistor har varit tyst
-- trasig sedan tabellerna skapades. Städares checkbox-klick svaldes
-- utan feedback (Paket 1 gör detta synligt via toast). booking_checklists
-- hade 0 rader i prod — inga checklists har någonsin kunnat skapas.
--
-- Pre-requisite: Paket 1 (commit 5ca40ba) — loadChecklist + toggleChecklistItem
-- använder nu auth.headers + _friendlyAuthMsg-toast så framtida fel
-- synliggörs direkt.
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för Paket 4-sektionen.
-- ============================================================

-- 1) GRANTS ─────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON booking_checklists TO authenticated;
GRANT ALL ON booking_checklists TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON service_checklists TO authenticated;
GRANT ALL ON service_checklists TO service_role;
GRANT SELECT ON service_checklists TO anon;

-- 2) DROP oanvändbara policies ─────────────────────────────
DROP POLICY IF EXISTS "Anon read booking_checklists" ON booking_checklists;
DROP POLICY IF EXISTS "Auth insert booking_checklists" ON booking_checklists;
DROP POLICY IF EXISTS "Auth update booking_checklists" ON booking_checklists;
DROP POLICY IF EXISTS "Anon read checklists" ON service_checklists;

-- 3) booking_checklists policies (Cleaner-own via booking-join) ──
CREATE POLICY "Cleaner manages own booking_checklists"
  ON booking_checklists FOR ALL TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings
       WHERE cleaner_id IN (
         SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
       )
    )
  )
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings
       WHERE cleaner_id IN (
         SELECT id FROM cleaners WHERE auth_user_id = auth.uid()
       )
    )
  );

CREATE POLICY "VD manages team booking_checklists"
  ON booking_checklists FOR ALL TO authenticated
  USING (
    booking_id IN (
      SELECT id FROM bookings WHERE cleaner_id IN (
        SELECT c.id FROM cleaners c WHERE c.company_id IN (
          SELECT company_id FROM cleaners
           WHERE auth_user_id = auth.uid() AND is_company_owner = true
        )
      )
    )
  )
  WITH CHECK (
    booking_id IN (
      SELECT id FROM bookings WHERE cleaner_id IN (
        SELECT c.id FROM cleaners c WHERE c.company_id IN (
          SELECT company_id FROM cleaners
           WHERE auth_user_id = auth.uid() AND is_company_owner = true
        )
      )
    )
  );

CREATE POLICY "Admin manages all booking_checklists"
  ON booking_checklists FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Service role manages booking_checklists"
  ON booking_checklists FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4) service_checklists policies (mallar — publik SELECT OK) ────
CREATE POLICY "Public read service_checklists"
  ON service_checklists FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "VD manages own company service_checklists"
  ON service_checklists FOR ALL TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM cleaners
       WHERE auth_user_id = auth.uid() AND is_company_owner = true
    )
  );

CREATE POLICY "Admin manages all service_checklists"
  ON service_checklists FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY "Service role manages service_checklists"
  ON service_checklists FOR ALL TO service_role
  USING (true) WITH CHECK (true);

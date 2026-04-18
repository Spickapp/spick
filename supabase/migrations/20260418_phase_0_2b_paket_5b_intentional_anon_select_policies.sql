-- ============================================================
-- Fas 0.2b Paket 5b: Konsolidera SELECT-dubletter till
-- medvetna "Public ... intentional"-policies
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
--
-- Bakgrund: Efter Paket 5a-rensning (DROP 6 oanvända + 5 duplicerade
-- policies) kvarstod 3 tabeller med multipla SELECT-policies som alla
-- var medveten design för publika flöden (SMS-länkade sidor). Denna
-- migration konsoliderar dem till 1 policy per tabell med tydlig
-- "intentional"-namngivning som signalerar till framtida auditörer
-- att anon-läsning är by design, inte en läcka.
--
-- Se docs/architecture/INTENTIONAL_ANON_POLICIES.md för motivering,
-- exponering, mitigation och omprövnings-datum per policy.
-- ============================================================

BEGIN;

-- 1) booking_status_log: 2 SELECT-dubletter → 1 ─────────────
DROP POLICY IF EXISTS "Anyone can read status log" ON booking_status_log;
DROP POLICY IF EXISTS "Authenticated read booking status log" ON booking_status_log;
CREATE POLICY "Public read booking_status_log — intentional"
  ON booking_status_log FOR SELECT TO anon, authenticated
  USING (true);

-- 2) messages: konsolidera SELECT (INSERT bevaras separat) ──
-- "Anyone can insert messages" BEHÅLLS — by design: kunder skriver
-- via SMS-länkad min-bokning utan auth.
DROP POLICY IF EXISTS "Anyone can read messages" ON messages;
CREATE POLICY "Public read messages — intentional"
  ON messages FOR SELECT TO anon, authenticated
  USING (true);

-- 3) subscriptions: konsolidera SELECT ──────────────────────
DROP POLICY IF EXISTS "Anon read subscriptions" ON subscriptions;
CREATE POLICY "Public read subscriptions — intentional"
  ON subscriptions FOR SELECT TO anon, authenticated
  USING (true);

COMMIT;

-- ============================================================
-- Post-check SQL för Farhad att köra i Supabase Studio:
--
-- Förvänta 1 "— intentional"-policy per tabell + 0 dubletter:
--   SELECT tablename, policyname, cmd, roles, qual
--     FROM pg_policies
--    WHERE tablename IN ('booking_status_log','messages','subscriptions')
--    ORDER BY tablename, policyname;
--
-- Förvänta att "Anyone can insert messages" fortfarande finns:
--   SELECT policyname FROM pg_policies
--    WHERE tablename = 'messages' AND cmd = 'INSERT';
--
-- Förvänta att tre nya "— intentional" finns (exakt text):
--   SELECT tablename, policyname FROM pg_policies
--    WHERE policyname LIKE '%— intentional%'
--    ORDER BY tablename;
-- ============================================================

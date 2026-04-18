-- ============================================================
-- Fas 0.2b Paket 8: Slutaudit + platform_settings-städning
-- ============================================================
-- Kördes mot prod 2026-04-18 kväll (post-hoc dokumentation).
--
-- Slutaudit resultat (8a-inventering):
-- - 67/67 public-tabeller har RLS aktivt (förutom spatial_ref_sys PostGIS)
-- - 0 qual=true-läckor på skriv-operationer till public/anon
-- - 0 OR-true-bakdörrar
-- - Anon-grants endast INSERT-only där legitima
--
-- Åtgärder i Paket 8b:
-- 1. platform_settings: DROP redundant misleading "Service role manage"
--    (qual korrekt men på {public}), ersätts av riktig {service_role}-version
-- 2. platform_settings: Byt namn "Public read" -> "Public read... — intentional"
--    enligt Paket 5b-konvention
--
-- Se docs/incidents/2026-04-18-paket-1-2-auth-hardening-and-v1-rls.md
-- för Paket 8-sektionen med FAS 0 SLUTSAMMANFATTNING.
-- ============================================================

DROP POLICY IF EXISTS "Service role manage platform_settings" ON platform_settings;
DROP POLICY IF EXISTS "Public read platform_settings" ON platform_settings;

CREATE POLICY "Public read platform_settings — intentional"
  ON platform_settings FOR SELECT TO anon, authenticated
  USING (true);

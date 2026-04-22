-- ============================================================
-- Sprint 1 Dag 2 (2026-04-24): Seed platform_settings.min_hourly_rate
-- ============================================================
-- Syfte: Förhindra upprepning av hygien #30 (pricing-resolver
--        föll tillbaka på cleaner.hourly_rate=100 istället för
--        services.default_hourly_price=349 → kund debiterades 100 kr/h
--        för Fönsterputs-testbokning 681aaa93 den 2026-04-23).
--
-- Min-pris-guard: pricing-resolver läser denna nyckel och hoppar över
-- cleaners.hourly_rate om värdet är < min_hourly_rate, fallback till
-- services.default_hourly_price eller platform_settings.base_price_per_hour.
--
-- Primärkälla: docs/v3-phase1-progress.md hygien #29 + #30
-- Regler:
--   #27 — scope: bara seed, ingen kolumn-refactor
--   #28 — central config, inga hardcoded min-pris i kod
--   #30 — 200 kr/h är Spicks marknadsfloor (cleaners sätter 250-600 kr/h)
-- ============================================================

BEGIN;

-- 200 kr/h som marknadsfloor. Cleaners som lagt lägre pris (testdata eller
-- misstag) blir "oskyddade" i resolvern och faller till services.default_hourly_price.
-- Justerbart via UPDATE utan kod-deploy.
INSERT INTO platform_settings (key, value)
VALUES ('min_hourly_rate', '200')
ON CONFLICT (key) DO NOTHING;

-- Verifiering: nyckeln finns
DO $$
DECLARE
  seeded_value text;
BEGIN
  SELECT value INTO seeded_value FROM platform_settings WHERE key = 'min_hourly_rate';
  IF seeded_value IS NULL THEN
    RAISE EXCEPTION 'Sprint 1 Dag 2 migration failed: min_hourly_rate saknas';
  END IF;
  RAISE NOTICE 'OK: min_hourly_rate seed:ad (%)', seeded_value;
END $$;

COMMIT;

-- ============================================================
-- Post-check (Supabase Studio):
--   SELECT key, value, updated_at FROM platform_settings WHERE key = 'min_hourly_rate';
--   -- Förväntat: value='200', updated_at=NOW()
-- ============================================================

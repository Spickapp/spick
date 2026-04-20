-- ============================================================
-- Fas 1.2 Dag 1: Seed saknade platform_settings-nycklar
-- ============================================================
-- Syfte: Aktivera money-layer-arkitekturen (design-dok:
--        docs/architecture/money-layer.md commit 7236bee).
-- Regler: #27 — seed:ar bara saknade nycklar (ON CONFLICT DO NOTHING)
--         #28 — central config, inga hardcoded varden
--         #30 — inga framtida regulator-gissningar
-- Kalla:  Skatteverket 2026-04 (verifierad via web_search 20 apr 2026)
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- RUT-regler (Skatteverket 2026, oforandrat sen 2025)
-- ────────────────────────────────────────────────────────────
-- RUT-procenten: 50% av arbetskostnaden
INSERT INTO platform_settings (key, value)
VALUES ('rut_pct', '50')
ON CONFLICT (key) DO NOTHING;

-- RUT/ROT gemensamt tak: 75 000 kr per person och ar.
-- OBS: Taket DELAS med ROT. Om kunden anvant ROT samma ar,
-- reduceras tillgangligt RUT. Spick hanterar inte ROT idag,
-- sa hela 75000-potten ar tillganglig for RUT-tjanster.
-- Kunden ansvarar sjalv for att inte overstiga taket
-- (Skatteverket fangar overclaim vid deklaration).
-- Separat max-ROT inom taket ar 50000 kr (ej relevant for Spick).
INSERT INTO platform_settings (key, value)
VALUES ('rut_yearly_cap_kr', '75000')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Feature flags (alla false tills verifierat aktiverade)
-- ────────────────────────────────────────────────────────────
-- Money-layer: aktiveras efter Fas 1.3-1.9 verifierade i staging
INSERT INTO platform_settings (key, value)
VALUES ('money_layer_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Smart Trappstege (17→15→13→12% baserat pa completed_jobs):
-- Inaktiv tills data samlats for att kalibrera tiers.
INSERT INTO platform_settings (key, value)
VALUES ('smart_trappstege_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Escrow (Fas 8 — separate-charges-and-transfers)
INSERT INTO platform_settings (key, value)
VALUES ('escrow_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- Verifiering: alla 5 finns nu
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  required_keys text[] := ARRAY[
    'rut_pct', 'rut_yearly_cap_kr',
    'money_layer_enabled', 'smart_trappstege_enabled', 'escrow_enabled'
  ];
  missing_count int;
BEGIN
  SELECT COUNT(*)
    INTO missing_count
    FROM unnest(required_keys) AS k
    WHERE NOT EXISTS (
      SELECT 1 FROM platform_settings WHERE key = k
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % nycklar saknas', missing_count;
  END IF;

  RAISE NOTICE 'OK: alla 5 platform_settings-nycklar seed:ade';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt
-- ============================================================
-- SELECT key, value, updated_at FROM platform_settings
--  WHERE key IN ('rut_pct', 'rut_yearly_cap_kr',
--                'money_layer_enabled', 'smart_trappstege_enabled',
--                'escrow_enabled')
--  ORDER BY key;

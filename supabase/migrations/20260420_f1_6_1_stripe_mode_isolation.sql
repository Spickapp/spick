-- ============================================================
-- Fas 1.6.1: Stripe mode isolation (live vs test)
-- ============================================================
-- Syfte: Tillåt live- och test-Stripe att samexistera i samma kodbas.
--        - Global default: platform_settings.stripe_mode='live'
--        - Per-cleaner override: cleaners.is_test_account=true
-- Källa: docs/architecture/fas-1-6-stripe-transfer-design.md §3.6
-- Regler: #27 — primärkälla §3.6, ingen memory-användning
--         #28 — central konfig, ingen fragmentering
--         #30 — Stripe API-version 2023-10-16 bibehålls
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Global Stripe-mode (platform_settings)
-- ────────────────────────────────────────────────────────────
-- 'live' = prod-default, 'test' = staging/failover för hela plattformen.
-- Per-cleaner override via cleaners.is_test_account (nedan).
INSERT INTO platform_settings (key, value)
VALUES ('stripe_mode', 'live')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Per-cleaner test-flagga
-- ────────────────────────────────────────────────────────────
-- Sätt till true för test-cleaners (farrehagge+test7 m.fl.).
-- getStripeClient() väljer STRIPE_SECRET_KEY_TEST när sann.
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN cleaners.is_test_account IS
  'Fas 1.6.1: om true, Stripe-anrop för denna cleaner går mot test mode.';

-- ────────────────────────────────────────────────────────────
-- 3. Verifiering
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_setting int;
  has_column int;
BEGIN
  SELECT COUNT(*) INTO has_setting
    FROM platform_settings WHERE key = 'stripe_mode';
  IF has_setting = 0 THEN
    RAISE EXCEPTION 'Migration failed: stripe_mode saknas i platform_settings';
  END IF;

  SELECT COUNT(*) INTO has_column
    FROM information_schema.columns
    WHERE table_name = 'cleaners' AND column_name = 'is_test_account';
  IF has_column = 0 THEN
    RAISE EXCEPTION 'Migration failed: cleaners.is_test_account saknas';
  END IF;

  RAISE NOTICE 'OK: Fas 1.6.1 mode-isolation seed + kolumn klar';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt
-- ============================================================
-- SELECT key, value FROM platform_settings WHERE key = 'stripe_mode';
-- -- Expected: 1 row, value='live'
--
-- SELECT column_name, data_type, column_default, is_nullable
--   FROM information_schema.columns
--  WHERE table_name='cleaners' AND column_name='is_test_account';
-- -- Expected: boolean, default false, NOT NULL
--
-- Manuellt markera test-cleaners:
--   UPDATE cleaners SET is_test_account=true WHERE email LIKE '%+test%';
-- ============================================================

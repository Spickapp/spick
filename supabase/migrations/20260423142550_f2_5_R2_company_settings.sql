-- ============================================================
-- Fas 2.5-R2: Företagsuppgifter i platform_settings + kvitto-idempotens
-- ============================================================
-- Syfte: R2 (bokföringslag-kompatibelt kund-kvitto via mejl) kräver:
--        1. Företagsuppgifter som single source of truth (Regel #28,
--           ingen fragmentering). Tidigare hardcodade i 3-4 filer.
--        2. Idempotens-flagga på bokning så generate-receipt kan
--           skicka om kvittomejl utan att dubblera HTML-genereringen
--           (F-R2-7, 3-stegs-logik).
-- Beslut:  Farhad, projektchef, 2026-04-23 (Fas B-godkännande).
-- Scope:   R2-isolerat. Inga faktura.html-ändringar, inga nya
--          fakturanr-serier (det är R3/R4), ingen kreditnota (R5).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Seed 9 nycklar för företagsuppgifter (Haghighi Consulting AB)
--    Source of truth för alla framtida dokument. Regel #28.
-- ────────────────────────────────────────────────────────────

INSERT INTO platform_settings (key, value)
VALUES ('company_legal_name', 'Haghighi Consulting AB')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_trade_name', 'Spick')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_org_number', '559402-4522')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_vat_number', 'SE559402452201')
ON CONFLICT (key) DO NOTHING;

-- "Solna, Sverige" som fallback tills registrerad postadress finns
-- (hygien-task #23 uppdaterar via UPDATE när Bolagsverket-registrering verifierad).
INSERT INTO platform_settings (key, value)
VALUES ('company_address', 'Solna, Sverige')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_sni_code', '81.210')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_f_skatt', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_email', 'hello@spick.se')
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_settings (key, value)
VALUES ('company_website', 'spick.se')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Idempotens-kolumn på bookings (F-R2-7)
--    3-stegs-logik i generate-receipt:
--      (a) receipt_email_sent_at IS NOT NULL     → return early
--      (b) receipt_url IS NOT NULL AND
--          receipt_email_sent_at IS NULL          → skip HTML-gen, skicka mejl, UPDATE
--      (c) annars                                 → full flow + UPDATE båda
-- ────────────────────────────────────────────────────────────

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS receipt_email_sent_at timestamp with time zone;

COMMENT ON COLUMN bookings.receipt_email_sent_at IS
  'Fas 2.5-R2: Satt när kund-kvitto-mejl bekräftat skickat. Idempotens-flagga för generate-receipt-EF. NULL = mejl aldrig skickat (eller att skicka om).';

-- ────────────────────────────────────────────────────────────
-- 3. Verifiering: alla 9 nycklar + kolumnen ska finnas
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  required_keys text[] := ARRAY[
    'company_legal_name', 'company_trade_name', 'company_org_number',
    'company_vat_number', 'company_address', 'company_sni_code',
    'company_f_skatt', 'company_email', 'company_website'
  ];
  missing_count int;
  col_exists boolean;
BEGIN
  SELECT COUNT(*)
    INTO missing_count
    FROM unnest(required_keys) AS k
    WHERE NOT EXISTS (
      SELECT 1 FROM platform_settings WHERE key = k
    );

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % nycklar saknas av 9 company_* i platform_settings', missing_count;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bookings'
      AND column_name = 'receipt_email_sent_at'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RAISE EXCEPTION 'Migration failed: bookings.receipt_email_sent_at saknas';
  END IF;

  RAISE NOTICE 'OK: 9 company_* platform_settings seed:ade + bookings.receipt_email_sent_at skapad';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt
-- ============================================================
-- SELECT key, value FROM platform_settings WHERE key LIKE 'company_%' ORDER BY key;
-- \d+ bookings | grep receipt_email_sent_at
-- ============================================================

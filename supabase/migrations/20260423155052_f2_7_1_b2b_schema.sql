-- ============================================================
-- §2.7.1 — B2B-kompatibilitet (kort-only): DB-schema
-- ============================================================
-- Syfte: Lägger till 7 kolumner på bookings + ny sequence +
--        config-driven RPC för B2B-fakturanummer (F-YYYY-NNNNN).
--        Förbereder schema. Inga EF-ändringar, inga UI-ändringar.
--
-- Primärkälla: docs/planning/fas-2-7-b2b-kompatibilitet.md §4.
-- Beslutsfattare: Farhad Haghighi 2026-04-23.
-- Research-verifiering (Fas A 2026-04-23):
--   A1: invoice_number_seq + generate_b2b_invoice_number saknas
--       → säkra att skapa. generate_invoice_number() finns men
--         returnerar SF- (städarfaktura) — namnkollision undvikas
--         genom B2B-specifikt namn.
--   A2: 7 nya kolumner saknas på bookings → säkra att ADD.
--   A5: company_timezone saknas i platform_settings → seed i denna
--       migration + config-driven RPC (Regel #28).
--
-- Idempotent: IF NOT EXISTS på alla CREATE. ON CONFLICT på INSERT.
-- GRANTs matchar §2.5-R2-lärdom (sequences kräver explicit USAGE).
-- ============================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. B2B-kolumner på bookings
--    Alla NULL-able. Populeras bara när customer_type='foretag'.
--    Befintliga B2B-kolumner (business_name, business_org_number,
--    business_reference, customer_type) rörs EJ.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS business_vat_number text,
  ADD COLUMN IF NOT EXISTS business_contact_person text,
  ADD COLUMN IF NOT EXISTS business_invoice_email text,
  ADD COLUMN IF NOT EXISTS invoice_address_street text,
  ADD COLUMN IF NOT EXISTS invoice_address_city text,
  ADD COLUMN IF NOT EXISTS invoice_address_postal_code text,
  ADD COLUMN IF NOT EXISTS invoice_number text;

-- Partial unique index: F-YYYY-NNNNN måste vara unik när satt.
-- B2C-rader (invoice_number IS NULL) är undantagna — de har
-- receipt_number istället. Skyddar F-serien utan att blockera KV-.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_invoice_number_unique
  ON public.bookings(invoice_number)
  WHERE invoice_number IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. B2B-fakturanummer sequence
--    Monotoniskt ökande genom alla år. År-delen i prefix är
--    kosmetisk (juridiskt kravet "obruten sekvens" uppfylls av
--    sequence-monotoniciteten, inte av årtalet).
--    Skiljer sig från befintliga generate_invoice_number() som
--    räknar MAX()+1 per år på self_invoices — den designen
--    återupprepas INTE här (se arkitekturdok §5).
-- ────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.b2b_invoice_number_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE;

-- GRANTs (lärdom från §2.5-R2-hygien: sequences utan explicit
-- GRANT USAGE kraschar service_role-anrop med "permission denied").
GRANT USAGE, SELECT ON SEQUENCE public.b2b_invoice_number_seq
  TO service_role, authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. company_timezone seed (Regel #28, single source of truth)
--    RPC:n nedan läser värdet istället för att hårdkoda.
--    Fallback 'Europe/Stockholm' om nyckel saknas vid körning.
--
--    Observation: 4 befintliga 'Europe/Stockholm'-hardcodes i
--    calendar-EFs (se hygien-task #36) — inte blockerare för §2.7.1.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.platform_settings (key, value)
VALUES ('company_timezone', 'Europe/Stockholm')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 4. generate_b2b_invoice_number() RPC
--    Namn-motivering: "b2b" i namn undviker kollision med
--    befintliga generate_invoice_number() (returnerar SF-prefix
--    för städarfakturor, används av generate-self-invoice EF).
--    SECURITY DEFINER + fast search_path matchar Spick-konvention.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_b2b_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tz text;
  year_part text;
  seq_part text;
BEGIN
  -- Läs timezone från platform_settings (Regel #28).
  -- Fallback säkerställer RPC fungerar även om seed inte körts.
  SELECT value INTO tz FROM platform_settings WHERE key = 'company_timezone';
  IF tz IS NULL THEN
    tz := 'Europe/Stockholm';
  END IF;

  year_part := TO_CHAR(NOW() AT TIME ZONE tz, 'YYYY');
  seq_part := LPAD(NEXTVAL('public.b2b_invoice_number_seq')::text, 5, '0');
  RETURN 'F-' || year_part || '-' || seq_part;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_b2b_invoice_number()
  TO service_role, authenticated;

-- ────────────────────────────────────────────────────────────
-- 5. Kommentarer för framtida devs
-- ────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.bookings.business_vat_number IS
  'Momsregistreringsnr för B2B-kund (SE559402452201-format). Obligatoriskt om momsbelopp >= 2000 kr enligt MervL 11 kap 8§. NULL för B2C.';

COMMENT ON COLUMN public.bookings.business_contact_person IS
  'Fakturareferent — t.ex. "Anna Andersson, ekonomi". Visas som "Att: ..."-rad på fakturan.';

COMMENT ON COLUMN public.bookings.business_invoice_email IS
  'Separat fakturamottagnings-mejl. Om NULL, skickas fakturan till customer_email.';

COMMENT ON COLUMN public.bookings.invoice_address_street IS
  'Fakturaadress street — kan skilja sig från tjänsteadress (huvudkontor vs. städadress).';

COMMENT ON COLUMN public.bookings.invoice_address_city IS
  'Ort för fakturaadress. Används på F-fakturan.';

COMMENT ON COLUMN public.bookings.invoice_address_postal_code IS
  'Postnummer för fakturaadress. Används på F-fakturan.';

COMMENT ON COLUMN public.bookings.invoice_number IS
  'F-YYYY-NNNNN för B2B. NULL för B2C (som har receipt_number istället). Partial unique index skyddar F-serien.';

COMMENT ON SEQUENCE public.b2b_invoice_number_seq IS
  'Sequence för B2B-fakturanummer (§2.7.1). Monotoniskt ökande genom alla år. Juridiskt krav "obruten sekvens" uppfylls av sequence-monotonicitet.';

COMMENT ON FUNCTION public.generate_b2b_invoice_number() IS
  'B2B-fakturanummer. Format F-YYYY-NNNNN (5-siffrig serienummerdel). Läser timezone från platform_settings.company_timezone. Unique genom tiden (skiljer sig från SF-serien som återanvänder per år).';

-- ────────────────────────────────────────────────────────────
-- 6. Verifiering
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  required_columns text[] := ARRAY[
    'business_vat_number', 'business_contact_person', 'business_invoice_email',
    'invoice_address_street', 'invoice_address_city', 'invoice_address_postal_code',
    'invoice_number'
  ];
  col text;
  missing_count int := 0;
  tz_exists boolean;
  rpc_exists boolean;
  seq_exists boolean;
BEGIN
  -- 6.1 Kolumner
  FOREACH col IN ARRAY required_columns LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'bookings'
        AND column_name = col
    ) THEN
      missing_count := missing_count + 1;
      RAISE WARNING 'Migration warning: saknar kolumn bookings.%', col;
    END IF;
  END LOOP;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'Migration failed: % av 7 B2B-kolumner saknas', missing_count;
  END IF;

  -- 6.2 Sequence
  SELECT EXISTS (
    SELECT 1 FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND sequence_name = 'b2b_invoice_number_seq'
  ) INTO seq_exists;
  IF NOT seq_exists THEN
    RAISE EXCEPTION 'Migration failed: b2b_invoice_number_seq skapades inte';
  END IF;

  -- 6.3 RPC
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'generate_b2b_invoice_number'
  ) INTO rpc_exists;
  IF NOT rpc_exists THEN
    RAISE EXCEPTION 'Migration failed: generate_b2b_invoice_number() skapades inte';
  END IF;

  -- 6.4 platform_settings.company_timezone
  SELECT EXISTS (
    SELECT 1 FROM platform_settings WHERE key = 'company_timezone'
  ) INTO tz_exists;
  IF NOT tz_exists THEN
    RAISE EXCEPTION 'Migration failed: platform_settings.company_timezone saknas';
  END IF;

  RAISE NOTICE 'OK: 7 B2B-kolumner + b2b_invoice_number_seq + generate_b2b_invoice_number() + company_timezone seed:ade';
END $$;

COMMIT;

-- ============================================================
-- Efter commit: verifiera manuellt i Studio SQL
-- ============================================================
--
-- -- 1. Kolumner
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'bookings'
--   AND column_name IN ('business_vat_number', 'business_contact_person',
--                       'business_invoice_email', 'invoice_address_street',
--                       'invoice_address_city', 'invoice_address_postal_code',
--                       'invoice_number')
-- ORDER BY column_name;
-- -- Förväntat: 7 rader, alla text, YES (nullable).
--
-- -- 2. Sequence
-- SELECT sequence_name, start_value, increment
-- FROM information_schema.sequences
-- WHERE sequence_schema = 'public' AND sequence_name = 'b2b_invoice_number_seq';
-- -- Förväntat: 1 rad, start 1, increment 1.
--
-- -- 3. RPC
-- SELECT generate_b2b_invoice_number();
-- -- Förväntat: 'F-2026-00001' (första gången, i Europe/Stockholm-tid).
--
-- -- 4. platform_settings
-- SELECT key, value FROM platform_settings WHERE key = 'company_timezone';
-- -- Förväntat: 'Europe/Stockholm'.
--
-- -- 5. Unique index
-- SELECT indexname FROM pg_indexes
-- WHERE tablename = 'bookings' AND indexname = 'idx_bookings_invoice_number_unique';
-- -- Förväntat: 1 rad.
-- ============================================================

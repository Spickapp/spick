-- ═══════════════════════════════════════════════════════════════
-- SPICK – bookings.company_id (Company-bokning-flow)
-- ═══════════════════════════════════════════════════════════════
--
-- BAKGRUND
-- Kund som bokar via /foretag.html?slug=X ska få:
-- - cleaner_id = NULL (ingen specifik städare)
-- - company_id = <företaget>
-- - status = 'awaiting_company_proposal'
-- - Visar BARA företagsnamn mot kund tills VD tilldelar
--
-- VD ser inkommande bokning + tilldelar via existing
-- company-propose-substitute EF.
--
-- REGLER #26-#33:
-- #28 SSOT — FK till companies(id) ON DELETE SET NULL
-- #31 Curl-verified bookings.company_id saknas i prod (HTTP 400)
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS company_id UUID
    REFERENCES public.companies(id) ON DELETE SET NULL;

-- Tillåt cleaner_id NULL (för awaiting_company_proposal-bokningar tills VD tilldelar)
ALTER TABLE public.bookings
  ALTER COLUMN cleaner_id DROP NOT NULL;

COMMENT ON COLUMN public.bookings.company_id IS
  'FK till företag som bokningen riktar sig mot. Sätts när kund bokar via /foretag.html. NULL för direkt-cleaner-bokning. Vid awaiting_company_proposal: VD ser bokningen + tilldelar specifik cleaner.';

CREATE INDEX IF NOT EXISTS idx_bookings_company_pending
  ON public.bookings(company_id, status, booking_date)
  WHERE company_id IS NOT NULL AND status = 'awaiting_company_proposal';

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE v_exists BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='company_id') INTO v_exists;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRATION 20260427230000 — bookings.company_id';
  RAISE NOTICE '  company_id-kolumn: %', CASE WHEN v_exists THEN '✓ ADDED' ELSE '✗ FAIL' END;
  RAISE NOTICE '  Index för pending company-bookings: ✓';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- ════════════════════════════════════════════════════════════════════
-- Phase-2 data-hygiene (P2-4, audit-fix 2026-04-26)
-- ════════════════════════════════════════════════════════════════════
-- Datum: 2026-04-26
-- Trigger: Audit fynd (test-admin-flow.md #5 + curl-bevis 2026-04-26):
--   1. companies.owner_cleaner_id läcker till anon (curl bevisade
--      att GET /rest/v1/companies?select=id,name,owner_cleaner_id
--      returnerar verklig data inklusive interna cleaner_id-kopplingar).
--   2. companies.commission_rate har MIXED format i prod:
--      - "[TEST] Test VD AB" har 0.17 (legacy decimal)
--      - "Haghighi Consulting AB" har 12 (canonical procent)
--      - "GoClean Nordic AB" har 12 (canonical procent)
--      Detta är inkonsistent med platform_settings.commission_standard=12
--      (procent-format, regel #28).
--
-- DETTA MIGRATION GÖR:
--   1. REVOKE SELECT (owner_cleaner_id) ON public.companies FROM anon
--      → kirurgisk fix (övriga publika kolumner som id, name, slug,
--      org_number, logo_url etc kvarstår tillgängliga).
--   2. Normalisera commission_rate < 1 till canonical procent-format
--      (0.x → x*100, eg 0.17 → 17). Endast rader där värdet är
--      mellan 0 och 1 (uteslutande legacy decimal-format).
--   3. COMMENT ON COLUMN för att dokumentera canonical format.
--
-- DETTA MIGRATION GÖR INTE:
--   - Inga RLS-policy-ändringar (column-level REVOKE räcker)
--   - Inga andra kolumner REVOKE:as (separat migration vid behov)
--   - Inga ändringar på cleaners.commission_rate (separat audit krävs
--     — det är ett känt problem dokumenterat i memory project_commission_format.md)
--
-- VERIFIERING (rule #31, curl 2026-04-26):
--   companies-tabell verifierad LIVE — tre rader, owner_cleaner_id
--   läckte till anon. commission_rate-värden 0.17, 12, 12 verifierade.
--
-- ROLLBACK (om behövs):
--   GRANT SELECT (owner_cleaner_id) ON public.companies TO anon;
--   -- Notera: commission_rate-normaliseringen är NOT rollbackable
--   -- automatiskt (vi vet inte vilka rader som var 0.x originellt).
--   -- Ta backup först: prod-schema-2026-04-21-backup.sql finns.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. REVOKE owner_cleaner_id från anon (kirurgisk column-level fix)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='companies'
      AND column_name='owner_cleaner_id'
  ) THEN
    REVOKE SELECT (owner_cleaner_id) ON public.companies FROM anon;
    RAISE NOTICE 'REVOKE SELECT (owner_cleaner_id) ON companies FROM anon — applicerat';
  ELSE
    RAISE NOTICE 'companies.owner_cleaner_id finns ej — REVOKE skippad';
  END IF;
END $$;

-- 2. Normalisera commission_rate < 1 → procent-format
-- (legacy decimal 0.17 → canonical 17)
-- Vi loggar count via NOTICE för observability.
DO $$
DECLARE
  v_normalized_count INT;
BEGIN
  WITH updated AS (
    UPDATE public.companies
    SET commission_rate = commission_rate * 100
    WHERE commission_rate IS NOT NULL
      AND commission_rate > 0
      AND commission_rate < 1
    RETURNING id
  )
  SELECT COUNT(*) INTO v_normalized_count FROM updated;
  RAISE NOTICE 'Normaliserade commission_rate på % företag (decimal → procent)', v_normalized_count;
END $$;

-- 3. Dokumentera canonical format
COMMENT ON COLUMN public.companies.commission_rate IS
  'Procent (0-100). Legacy 0.x-decimal-format normaliserat 2026-04-26 (migration 20260429000004). Canonical källa: platform_settings.commission_standard=12. Per cleaner/company-override OK för avtals-edge-cases men ska följa procent-format.';

-- 4. Dokumentera ny REVOKE-status
COMMENT ON TABLE public.companies IS
  'Companies-tabell. REVOKE-list (anon): owner_cleaner_id (2026-04-29 P2-4), firmatecknare_personnr_hash, firmatecknare_full_name, stripe_account_id, payment_trust_level, total_overdue_count (2026-04-26). Anon ser id, name, slug, org_number, logo, beskrivning, social-länkar.';

COMMIT;

SELECT 'MIGRATION 20260429000004 COMPLETE — companies data-hygiene (REVOKE owner_cleaner_id + normalize commission_rate)' AS result;

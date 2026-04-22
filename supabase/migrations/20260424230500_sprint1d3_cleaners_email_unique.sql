-- ============================================================
-- Sprint 1 Dag 3 (2026-04-24): Unique constraint cleaners(email, company_id)
-- ============================================================
-- Syfte: Förhindra upprepning av hygien #29 (Farhad existerade som två
--        cleaner-rader: solo hourly_rate=100 + företag hourly_rate=350).
--        Dubletten orsakade att pricing-resolver valde fel rad
--        → kund debiterades 100 kr/h för Fönsterputs (hygien #30).
--
-- Design: UNIQUE(lower(email), COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
--         — email case-insensitive + NULL-säker via COALESCE.
--         Samma email FÅR finnas på flera företag (ägare med flera bolag),
--         men samma email + företag = unik.
--
-- Säkerhet: Migrationen DROPPAR INTE rader. Om dubletter kvarstår blockeras
--           constraint-create med felmeddelande. Då behövs manuell cleanup
--           INNAN denna migration kan köras (se handoff-fil för SQL).
--
-- Primärkälla: docs/v3-phase1-progress.md hygien #29
-- Regler:
--   #26 — verifiera dubletter FÖRST (blockerar constraint-create vid kvarvarande)
--   #27 — scope: bara constraint, ingen data-rensning
--   #31 — primärkälla är data i prod, inte memory
-- ============================================================

BEGIN;

-- Steg 1: Pre-check — räkna dubletter. Abortera med tydligt fel om de finns.
DO $$
DECLARE
  dup_count int;
  dup_sample record;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT lower(email) AS email_lc, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid) AS comp
    FROM cleaners
    WHERE email IS NOT NULL
    GROUP BY email_lc, comp
    HAVING COUNT(*) > 1
  ) d;

  IF dup_count > 0 THEN
    -- Log första 3 dubletter för felsökning
    FOR dup_sample IN (
      SELECT lower(email) AS email_lc,
             COALESCE(company_id::text, 'NULL') AS comp,
             COUNT(*) AS n,
             array_agg(id::text ORDER BY created_at) AS ids
      FROM cleaners
      WHERE email IS NOT NULL
      GROUP BY lower(email), COALESCE(company_id::text, 'NULL')
      HAVING COUNT(*) > 1
      LIMIT 3
    ) LOOP
      RAISE NOTICE 'Dublett: email=% company=% count=% ids=%',
        dup_sample.email_lc, dup_sample.comp, dup_sample.n, dup_sample.ids;
    END LOOP;

    RAISE EXCEPTION 'Sprint 1 Dag 3: % dubletter i cleaners(email, company_id). Rensa manuellt innan constraint. Se docs/sessions/SESSION-HANDOFF_2026-04-24-sprint-1.md för SQL.', dup_count;
  END IF;

  RAISE NOTICE 'OK: 0 dubletter. Constraint kan skapas.';
END $$;

-- Steg 2: Skapa UNIQUE INDEX (används som constraint + snabbar upp lookups)
-- Använder UNIQUE INDEX istället för constraint för bättre NULL-hantering
-- + möjlighet till partial index vid framtida behov.
CREATE UNIQUE INDEX IF NOT EXISTS cleaners_email_company_unique_idx
  ON cleaners (lower(email), COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE email IS NOT NULL;

-- Steg 3: Kommentar för framtida utvecklare
COMMENT ON INDEX cleaners_email_company_unique_idx IS
  'Sprint 1 Dag 3 (2026-04-24) — förhindrar dubletter efter hygien #29. '
  'Email case-insensitive + NULL-säker via COALESCE. Samma email får '
  'finnas på flera företag (ägare med flera bolag) men ej samma email '
  'i samma företag.';

COMMIT;

-- ============================================================
-- Post-check (Supabase Studio):
--   SELECT pg_size_pretty(pg_relation_size('cleaners_email_company_unique_idx'));
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'cleaners_email_company_unique_idx';
-- ============================================================
-- Rollback (om behövs):
--   DROP INDEX IF EXISTS cleaners_email_company_unique_idx;
-- ============================================================

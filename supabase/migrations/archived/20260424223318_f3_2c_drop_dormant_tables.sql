-- =========================================================
-- §3.2c / §48 Fas 48.3 — Drop DORMANT tables (jobs + relaterade)
-- =========================================================
-- Primärkälla: docs/audits/2026-04-24-infrastructure-audit-diagnos.md
-- Regel #27 verifiering: cleanup_expired_jobs schedulerad pg_cron
--                        (jobid 1, 8), måste avregistreras först.
-- Deploy-metod: MANUELL via Studio SQL Editor. Ej CI/db push.
--               Se docs/deploy/2026-04-24-f3-2c-manual-apply.md
--
-- Denna migration är idempotent (IF EXISTS överallt) och kan köras
-- om utan fel. Ordning följer beroendekedjan:
--   1. pg_cron-schedules → cleanup_expired_jobs har ingen roll
--   2. cleanup_expired_jobs-funktion → orfan
--   3. Triggers på jobs/job_matches → sluta lyssna
--   4. Trigger-funktioner → orfaner efter steg 3
--   5. FK-kolumner på bookings/notifications → NULL (historiska pekare)
--   6. FK-constraints → kan droppas utan data-skada
--   7. Själva tabellerna → slutlig cleanup
-- =========================================================

BEGIN;

-- ────────────────────────────────────────────────────────
-- 1. Avregistrera pg_cron-scheman (måste göras av superuser)
--    OBS: Kräver Studio SQL-körning. Denna SQL fungerar bara
--    om utföraren har pg_cron-behörigheter.
-- ────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Försök unschedule. Om cron-schema saknas (redan raderat), ignorera.
  BEGIN
    PERFORM cron.unschedule(1);
    RAISE NOTICE 'Unscheduled pg_cron jobid=1';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Kunde inte unschedule jobid=1: %', SQLERRM;
  END;

  BEGIN
    PERFORM cron.unschedule(8);
    RAISE NOTICE 'Unscheduled pg_cron jobid=8';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Kunde inte unschedule jobid=8: %', SQLERRM;
  END;
END $$;

-- ────────────────────────────────────────────────────────
-- 2. Drop cleanup_expired_jobs-funktionen (orfan efter unschedule)
-- ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.cleanup_expired_jobs();

-- ────────────────────────────────────────────────────────
-- 3. Drop triggers på jobs + job_matches
-- ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_portal_status ON public.jobs;
DROP TRIGGER IF EXISTS trg_update_cleaner_stats ON public.jobs;
DROP TRIGGER IF EXISTS trg_response_time ON public.job_matches;

-- ────────────────────────────────────────────────────────
-- 4. Drop trigger-funktionerna (orfaner efter drop triggers)
-- ────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.sync_portal_to_booking();
DROP FUNCTION IF EXISTS public.update_cleaner_stats();
DROP FUNCTION IF EXISTS public.update_response_time();

-- ────────────────────────────────────────────────────────
-- 5. Nullställ FK-kolumner på historisk data
--    (annars kraschar DROP CONSTRAINT på non-null rader)
-- ────────────────────────────────────────────────────────
UPDATE public.bookings
   SET portal_job_id = NULL
 WHERE portal_job_id IS NOT NULL;
-- Förväntat: 22 rader uppdaterade (alla terminal-state)

UPDATE public.notifications
   SET job_id = NULL
 WHERE job_id IS NOT NULL;
-- Förväntat: 39 rader uppdaterade

-- ratings.job_id: 0 non-null (verifierat)
-- customer_selections.job_id: 0 non-null (verifierat)

-- ────────────────────────────────────────────────────────
-- 6. Drop FK-constraints (pekare till jobs finns inte längre)
-- ────────────────────────────────────────────────────────
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_portal_job_id_fkey;

ALTER TABLE public.ratings
  DROP CONSTRAINT IF EXISTS ratings_job_id_fkey;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_job_id_fkey;

ALTER TABLE public.customer_selections
  DROP CONSTRAINT IF EXISTS customer_selections_job_id_fkey;

-- job_matches.job_id_fkey har ON DELETE CASCADE, tas via DROP TABLE

-- ────────────────────────────────────────────────────────
-- 7. Drop själva tabellerna
--    Ordning: customer_selections → job_matches → cleaner_job_types → jobs
--    Men CASCADE hanterar alla beroenden oavsett.
-- ────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.customer_selections CASCADE;
DROP TABLE IF EXISTS public.job_matches CASCADE;
DROP TABLE IF EXISTS public.cleaner_job_types CASCADE;
DROP TABLE IF EXISTS public.jobs CASCADE;

COMMIT;

-- ────────────────────────────────────────────────────────
-- Verifierings-SQL (köras manuellt efter COMMIT)
-- ────────────────────────────────────────────────────────
--
-- 1. Bekräfta att tabellerna är borta
-- SELECT tablename FROM pg_tables
--  WHERE schemaname = 'public'
--    AND tablename IN ('jobs', 'job_matches', 'cleaner_job_types', 'customer_selections');
-- Förväntat: 0 rader
--
-- 2. Bekräfta att cron-scheman är avregistrerade
-- SELECT jobid FROM cron.job
--  WHERE command ILIKE '%cleanup_expired_jobs%';
-- Förväntat: 0 rader
--
-- 3. Bekräfta att funktionerna är borta
-- SELECT proname FROM pg_proc
--  WHERE proname IN ('cleanup_expired_jobs', 'sync_portal_to_booking',
--                    'update_cleaner_stats', 'update_response_time');
-- Förväntat: 0 rader
--
-- 4. Bekräfta att FK-constraints är borta
-- SELECT constraint_name FROM information_schema.table_constraints
--  WHERE constraint_name IN (
--    'bookings_portal_job_id_fkey', 'ratings_job_id_fkey',
--    'notifications_job_id_fkey', 'customer_selections_job_id_fkey'
--  );
-- Förväntat: 0 rader
--
-- 5. Bekräfta att find_nearby_cleaners fortfarande fungerar
-- SELECT id, full_name, match_score
--   FROM find_nearby_cleaners(59.3293::double precision, 18.0686::double precision)
--  LIMIT 3;
-- Förväntat: städare returnerade, inga fel

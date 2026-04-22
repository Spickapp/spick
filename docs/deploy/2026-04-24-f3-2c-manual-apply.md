# Manuell Deploy: §3.2c DORMANT DROP

**Datum:** 2026-04-24
**Migration:** `supabase/migrations/20260424223318_f3_2c_drop_dormant_tables.sql`
**Metod:** Studio SQL Editor (ej CI pga schema_migrations ur sync, se §48 Fas 48.1-rapport)

## Pre-flight checklista

Kör dessa queries i Studio INNAN migrationen. Verifiera att inget har ändrats sedan §48 Fas 48.1-diagnosen (2026-04-24):

```sql
-- 1. jobs fortfarande dead? (0 uppdateringar)
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE created_at = updated_at) AS aldrig_uppdaterade,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS senaste_dygnet
FROM jobs;
-- Förväntat: 39, 39, 0

-- 2. job_matches rowcount
SELECT COUNT(*) AS rader FROM job_matches;
-- Förväntat: 39 (per diagnos-rapport)

-- 3. cleaner_job_types + customer_selections fortfarande tomma
SELECT 'cjt' AS t, COUNT(*) FROM cleaner_job_types
UNION ALL
SELECT 'cs', COUNT(*) FROM customer_selections;
-- Förväntat: 0, 0

-- 4. bookings.portal_job_id fortfarande bara terminal-state?
SELECT status, payment_status, COUNT(*)
FROM bookings WHERE portal_job_id IS NOT NULL
GROUP BY status, payment_status;
-- Förväntat: alla cancelled/refunded/timed_out, inga nya aktiva

-- 5. pg_cron-scheman fortfarande aktiva?
SELECT jobid, active FROM cron.job
WHERE command ILIKE '%cleanup_expired_jobs%';
-- Förväntat: jobid 1 och 8, båda active=true
```

**Om något svar avviker → STOPP.** Nya rader kan betyda att en writer återaktiverats, eller att kundflöden rör tabellerna. Utred innan migration.

## Deploy-steg

1. Kopiera migrationsfilens innehåll till urklipp:

```powershell
Get-Content supabase\migrations\20260424223318_f3_2c_drop_dormant_tables.sql -Raw | Set-Clipboard
```

2. Öppna Studio SQL Editor → ny query.

3. Ctrl+V, verifiera första raden är `-- ===` och sista är `COMMIT;` (radera allt efter COMMIT om verifierings-SQL:en klistrades in, den ska köras separat).

4. Run. Förväntat output: några NOTICE-rader + "Success".

## Post-deploy verifiering

Kör den 5-punktiga verifierings-SQL:en som finns i slutet av migration-filen. Alla ska returnera 0 rader (utom punkt 5, som ska returnera städare).

## Rollback-strategi

**DROP TABLE är irreversibelt.** Men all data var redan dead:
- jobs-rader: 0 uppdaterade sedan skapande, kopplade till terminal-bookings
- FK-pekare: nullställd data, aldrig använd efter 19 april

Om rollback krävs av oväntad anledning:
1. Återskapa tabellerna via git show på prod-schema.sql (CREATE TABLE-sektionerna)
2. Seed:a historiska 39 rader från backup (Supabase point-in-time recovery om aktiverat)
3. Återaktivera cron + functions

Men detta är inte förväntat. Diagnosen är solid.

## Efter deploy

1. Verifiera enligt instruktioner ovan
2. Notifiera i commit att migrationen är körd i prod
3. Planera Fas 48.2 (schema_migrations-repair) för att täcka både denna och alla andra migrations

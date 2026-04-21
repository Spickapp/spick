# Infrastructure Audit — Diagnos-rapport

**Datum:** 2026-04-24
**Sprint:** Hygien #48 Fas 48.1
**Status:** Diagnos klar. Fix-faser följer.

## Två upptäckter konsoliderade

### Upptäckt 1: supabase_migrations.schema_migrations ur sync med repo

**Observation:**
- `supabase_migrations.schema_migrations` i prod: 1 rad (version `20260401000001`)
- Repo `supabase/migrations/`: 52 filer

**Mekanism som förklarar drift:**

`.github/workflows/run-migrations.yml` har ett "Markera alla befintliga migrationer som applied"-steg som försöker repair:a migrations-statusen. Men hårdkodad lista täcker bara ~40 migrations från 25-28 mars. Alla migrations från 30 mars + framåt är osynliga för repair-steget.

Sedan kör `supabase db push`, som försöker applicera ~30 migrations CI tror är "nya" (men är redan körda manuellt i Studio). De kraschar. `|| exit 0` sväljer felet. Workflow rapporterar success.

**Effekt:** Ingen synk mellan repo-tillstånd och CI-registrerat tillstånd. Alla sedan 30 mars tillämpade migrations är "osynliga" för CLI-mekaniken.

**Riskprofil:**
- Lokal dev fungerar inte (ny utvecklare/disaster recovery kan inte köra migrations i ordning)
- Schema-drift-check (hygien #12) meningslös utan sanning i schema_migrations
- Framtida `supabase db push` kommer alltid krascha tyst

### Upptäckt 2: jobs-tabellen är inte dormant — men skrivaren finns inte i repot

**Observation:**
- 39 rader i jobs
- 0 rader uppdaterade (`created_at = updated_at` för samtliga)
- 22 rader i bookings har FK `portal_job_id != NULL`
- Alla 22 bookings är i terminal-state: avbokade (17 cancelled + 3 refunded), timed_out (1 refunded), cancelled (1 refunded)
- 39 rader i notifications har FK `job_id != NULL`
- Datum-intervall alla rader: 3 apr - 19 apr 2026

**Eliminering av writers:**

Varje källa greppad för `INSERT INTO jobs`, `.from("jobs")` med `.insert()`, `public.jobs`:
- 52 migrationsfiler: 0 träffar
- Alla EFs (inklusive historiska via git show): 0 träffar
- Frontend-filer (*.html, js/): 0 träffar
- prod-schema functions: 0 träffar
- prod-schema triggers: 0 träffar (inga AFTER/BEFORE INSERT ON bookings → INSERT INTO jobs)

**Slutsats:** Ingenting i kodbasen skriver till jobs-tabellen.

**Sannolik förklaring:** Manuell Studio-INSERT eller ad-hoc-skript under utvecklingsperiod 3-19 april har skapat testdata som aldrig städats. Bookings bokades via Spick-flödet, vilket triggade någon historisk mekanism (sedan borttagen) som kopierade booking-data till jobs. Sedan 19 april: 0 nya jobs-rader, 0 uppdateringar.

**Riskprofil för drop:**
- LÅG. Alla kopplade bookings är terminal-state (ingen aktiv verksamhet)
- Triggers `trg_sync_portal_status` och `trg_update_cleaner_stats` aldrig aktiverats (0 UPDATEs)
- DROP TABLE med DROP CONSTRAINT-sekvens är säker

## Fas-plan

### Fas 48.1 — DIAGNOS (denna commit) — KLAR 2026-04-24

Konsoliderad rapport. Ingen kod.

### Fas 48.2 — schema_migrations-repair — 2-4h

**Mål:** Synka `supabase_migrations.schema_migrations` med repo-tillstånd.

**Åtgärder:**
1. Expandera `.github/workflows/run-migrations.yml` `repair`-listan att inkludera alla 52 migrations
2. Trigga manuell workflow-run för att applicera repairen
3. Verifiera: `SELECT COUNT(*) FROM supabase_migrations.schema_migrations` → 52
4. Commit: uppdaterad workflow-fil

**Risk:** Låg. Repair är idempotent (lägger till status utan att röra schema).

### Fas 48.3 — DORMANT-tabell-radering (§3.2c i ny form) — 1-2h

**Mål:** Radera jobs, job_matches, cleaner_job_types + cleaner ner FK-skulden.

**Åtgärder:**
1. Verifiera (igen) att inga nya jobs-rader skapats
2. UPDATE bookings SET portal_job_id = NULL WHERE portal_job_id IS NOT NULL (22 rader)
3. UPDATE notifications SET job_id = NULL WHERE job_id IS NOT NULL (39 rader)
4. ALTER TABLE bookings DROP CONSTRAINT bookings_portal_job_id_fkey
5. ALTER TABLE notifications DROP CONSTRAINT notifications_job_id_fkey
6. ALTER TABLE ratings DROP CONSTRAINT ratings_job_id_fkey (kolumn är 100% null, så säker)
7. ALTER TABLE customer_selections DROP CONSTRAINT customer_selections_job_id_fkey (kolumn och tabell är 0 rader)
8. DROP TRIGGER trg_sync_portal_status, trg_update_cleaner_stats ON jobs
9. DROP TRIGGER trg_response_time ON job_matches
10. DROP TABLE cleaner_job_types, job_matches, jobs CASCADE
11. Migration-fil + manuell Studio-körning (analogt med §3.2a-mönster)

**Risk:** Låg givet bekräftat dead data. Inte medium som misstänkt igår.

### Fas 48.4 — CI-härdning — 1-2h

**Mål:** Ta bort tyst fel-swallowning.

**Åtgärder:**
1. Ta bort `|| exit 0` från "Kör nya migrationer"-steget i run-migrations.yml
2. Lägg till post-deploy verifiering: `SELECT COUNT(*) FROM supabase_migrations.schema_migrations` och fail om mismatch med filantal
3. Notification vid drift (GitHub issue eller email)

### Fas 48.5 — Schema-drift-check (§2.8 + hygien #12) — 2-3h

**Mål:** Automatisk drift-detektering CI.

**Åtgärder:**
1. Pg_dump schema från prod
2. Jämför mot förväntat schema från repot (t.ex. senaste migrations applicerade deterministiskt)
3. CI-jobb som kör dagligen/vid push
4. Fail om drift detekteras

**Risk:** Moderat (kräver testning av drift-detektering-algoritm).

### Fas 48.6 — Retrospektiv + preventiv — 30 min

**Mål:** Dokumentera hur driften uppstod + förhindra recurrence.

**Åtgärder:**
1. Uppdatera `docs/architecture/timezone-convention.md`-mönster för fler arkitektur-konventioner (migrations-flöde, kod-vs-data-separation, etc.)
2. Ny konvention: "ingen Studio SQL Editor för strukturella ändringar utan motsvarande migration-fil"
3. Commit konventions-filen

## Kvarvarande öppna frågor (defer:ade)

**F1 — varför upphörde jobs-skrivningar 19 april?**

Hypotes: Auto-delegation-systemet gick live 16 april. Det tog över matching-flödet från tidigare mekanism som skrev till jobs. Men utan att ha källkoden för den tidigare mekanismen kan vi inte verifiera.

**Svar:** Inte värt att gräva. Skrivaren är död oavsett orsak. Fas 48.3 tar bort datan.

**F2 — vilken manuell process skapade de 39 jobs-raderna?**

Hypotes: Studio-INSERT under utvecklingsfas. Eventuellt hårdkodade tester.

**Svar:** Inte värt att gräva. Datan raderas i Fas 48.3.

## Tidstotal

- Fas 48.1: ~3h diagnos (denna commit)
- Fas 48.2-48.6: 5-11h framåt

**Totalt: 8-14h** för komplett infrastructure-audit.

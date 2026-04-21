# Infrastructure Audit — Diagnos-rapport

**Datum:** 2026-04-24
**Sprint:** Hygien #48 Fas 48.1
**Status:** Diagnos klar. Fix-faser följer.

## Två upptäckter konsoliderade

### Upptäckt 1: supabase_migrations.schema_migrations ur sync med repo

**Observation (korrigerad 2026-04-24 sen eftermiddag):**

Föregående version av denna rapport påstod "schema_migrations har 1 rad". Detta var felaktigt — queryn som producerade det värdet gav fel resultat (troligen korrupt query-körning eller filter-bugg i Studio). Verifierad primärkälla visar:

- `supabase_migrations.schema_migrations`: **46 rader** (inte 1)
- Alla 46 registrerade migrations är från 25 mars - 1 april 2026
- Alla migrations från 2 april och framåt saknas helt i registret
- Kategorier i registret:
  - 10 tidiga (versioner 001-010)
  - 33 från 25-28 mars
  - 3 från 30-31 mars
  - 1 från 1 april (`20260401000001 / sprint1_missing_tables`)

Repo innehåller 52 `.sql`-filer, varav 35 har version-prefix som KOLLIDERAR med andra filer:

| Prefix | Antal filer | Exempel |
|---|---|---|
| `20260401000001` | 2 | `create_missing_views` + `sprint1_missing_tables` |
| `20260418` | 15 | `admin_cleaner_update`, `customer_reads_own_row`, ... 13 till |
| `20260419` | 7 | `f1_dag1_services_tables`, `fas_1_1_cleaners_pii_lockdown`, ... |
| `20260420` | 7 | `f1_2_seed_platform_settings`, `f1_6_payout_attempts`, ... |
| `20260423` | 4 | `f2_5_R2_company_settings`, `f2_7_1_b2b_schema`, ... |

**Supabase CLI använder version-prefix som primary key i `schema_migrations`.** Två filer med samma prefix kan därför inte båda registreras. 35 filer är permanent exkluderade från CLI:s migration-mekanism tills de omdöps till kanoniska format (`YYYYMMDDHHMMSS_namn.sql`).

**Mekanism som förklarar drift:**

`.github/workflows/run-migrations.yml` har ett "Markera alla befintliga migrationer som applied"-steg med en hårdkodad repair-lista som täcker ~40 korrekt namngivna migrations från 25-28 mars. Alla migrations från 30 mars framåt är osynliga för repair-steget. Sedan kör `supabase db push`, som försöker applicera migrations som inte finns i schema_migrations. För filer utan kollision funkar detta — för de 35 kollisions-filerna fallerar registrering permanent. `|| exit 0` sväljer felet. Workflow rapporterar success.

**Effekt:**
- Alla 35 kollisions-filer har körts manuellt i Studio SQL Editor (prod-schemat speglar deras innehåll), men saknas i registret
- Några korrekt-namngivna april-migrations (20260401000002, 20260401000003, 20260402xxxxx, 20260414xxxxx, 20260416120000) är också okörda eller okörda-och-oregistrerade — kräver separat verifiering
- Schema-drift-check (hygien #12) meningslös utan sanning i schema_migrations

**Riskprofil:**
- Lokal dev fungerar inte (ingen pålitlig migration-historik)
- Disaster recovery kräver manuell rekonstruktion
- Framtida `supabase db push` kraschar tyst på kollisioner

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

### Fas 48.2 — schema_migrations-repair + migration-filnamn-refaktorering — 4-6h

**Mål:** Synka `supabase_migrations.schema_migrations` med repo-tillstånd. Detta kräver fil-rename:ar av 35 filer med kollisions-prefix.

**Åtgärder:**

1. **Rename 35 kollisions-filer** till kanoniskt format `YYYYMMDDHHMMSS_namn.sql`:
   - Använd filens `LastWriteTime` för att välja HHMMSS-suffix (eller numrera 000001, 000002, etc per dag baserat på logisk körordning)
   - Verifiera att ingen annan fil refererar till original-namnen (grep scripts, docs, CI-configs)
   - Commit rename:ar separat från repair-skript

2. **Bygg expanderad repair-lista** i `.github/workflows/run-migrations.yml`:
   - Dynamisk approach: shell-skript som loopar över `supabase/migrations/*.sql` och repair:ar varje
   - Alternativt: hårdkodad full lista av 52 nu-unika versions

3. **Ta bort `|| exit 0`** från "Kör nya migrationer"-steget (Regel: sluta svälja fel)

4. **Manuell Studio-INSERT** till schema_migrations för alla 52 filer (efter rename):
```sql
   INSERT INTO supabase_migrations.schema_migrations (version, name)
   VALUES ('20260401000002', 'loyalty_points'), ...
   ON CONFLICT (version) DO NOTHING;
```

5. **Verifiera:** `SELECT COUNT(*) FROM supabase_migrations.schema_migrations` → **52**

6. **Trigga workflow-run** för att bekräfta ren deploy nästa gång migration-fil ändras.

**Risk:**
- **Medium.** Rename:ar påverkar git-historik. Framtida rollback via `git revert` på en rename-commit kan vara förvillande.
- Manuell INSERT till schema_migrations är irreversibel utan backup av tabellen.
- CI-workflow-ändringar kan bryta framtida auto-deploy om inte testat ordentligt.

**Mitigering:**
- Backup schema_migrations-tabellen innan INSERT (via Studio export).
- Rename:ar görs i en enda commit så historik är tydlig.
- Test-run av workflow med manuell trigger innan första push.

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

**Status (2026-04-24):** ✓ KLAR. Migration `20260424_f3_2c_drop_dormant_tables.sql` kördes via Studio SQL Editor. Allt verifierat (se "Fas 48.3 deploy-anteckning"-sektion nedan). §3.2c formellt stängd.

### Fas 48.3 deploy-anteckning (2026-04-24)

Migrationen kördes framgångsrikt mot prod via Studio SQL Editor. Studio returnerade felmeddelande `42P01: relation "public.jobs" does not exist` mot slutet av körningen, men primärkälla-verifiering efter körning bekräftade komplett exekvering:

- 4 tabeller borta ✓
- 2 pg_cron-scheman avregistrerade ✓
- 4 functions borta ✓
- 4 FK-constraints borta ✓
- FK-kolumner nullställda (22 bookings + 39 notifications) ✓
- find_nearby_cleaners fungerar (Zivar 0.695, Farhad 0.657) ✓

Troligaste förklaring: Studio tolkade verifierings-SQL-kommentar-blocket efter `COMMIT` som faktisk SQL och försökte köra `SELECT tablename FROM pg_tables WHERE ...` eller liknande — då kraschade den på jobs-referens som inte längre fanns. Kommentar-SQL i migrations-filer bör undvikas, eller dokumenteras separat i deploy-filer.

**Lärdom för framtida migrations:** Håll verifierings-queries i separat deploy-dokument, inte som kommentarer i migration-filen. Vissa klienter (Studio) parsar ibland kommentar-block fel.

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

## Tidstotal (uppdaterad 2026-04-24 sen eftermiddag)

- **Fas 48.1:** ~3h diagnos KLAR (denna commit uppdaterar med korrigerade fynd)
- **Fas 48.2:** 4-6h (uppskjuten — större scope än ursprunglig estimate pga 35 filnamn-kollisioner)
- **Fas 48.3:** ✓ KLAR (§3.2c DORMANT DROP exekverad)
- **Fas 48.4:** 1-2h CI-härdning
- **Fas 48.5:** 2-3h schema-drift-check
- **Fas 48.6:** 30 min retrospektiv

**Totalt kvar: 7-12h.** (Tidigare estimate 5-11h, utökat pga Fas 48.2-scope.)

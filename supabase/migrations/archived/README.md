# Archived Migrations

Denna mapp innehåller migrations som har körts historiskt mot prod men
som INTE ska köras vid `supabase db reset` eller `supabase db push`
pga deras innehåll är obsolete mot nuvarande prod-schema.

Supabase CLI ignorerar underkataloger av `supabase/migrations/`,
så filerna stannar för audit-trail men påverkar inte replay.

## Arkiverade filer

### 007_rls.sql (arkiverad 2026-04-22)

**Varför:** 007_rls.sql var en tidig RLS-setup-migration. Alla dess 23
policies + 2 triggers + 2 functions har sedan dess ersatts av nyare
migrations eller Studio-operationer. Verifierat via grep mot
prod-schema.sql (2026-04-22): 0 av 23 policies existerar i prod.

**Dessutom:** Filen innehöll felaktig SQL (`CREATE POLICY IF NOT EXISTS`
är inte PG-syntax) och refererade `bookings.email` som inte existerar
i nuvarande prod.

**Fas 2.X Replayability:** Filen blockerade db reset på rad 35 med
"column email does not exist". Arkiverad för att låta replay fortsätta.

**Om du behöver återställa någon policy:** Titta i
`20260422130000_fas_2_1_1_all_policies.sql` — det är nuvarande
bookings/customer_profiles-policies konsoliderade.

### 20260325000002_rls_bookings.sql (arkiverad 2026-04-22)

**Varför:** Samma situation som 007_rls.sql — 100% dead code mot nuvarande
prod. Alla 4 CREATE POLICY-satser saknas i prod-schema.sql (verifierat
via grep 2026-04-22):

- "Public can insert bookings" — SAKNAS
- "Customer can read own bookings by email" — SAKNAS
- "Public can read bookings by id" — SAKNAS
- "Customer can update own booking" — SAKNAS

Dessutom refererar 2 av policies `bookings.email` som inte längre
existerar i prod (prod har `customer_email` sedan schema-ändring).

**Fas 2.X Replayability:** Filen blockerade db reset på rad 14 med
"column email does not exist". Arkiverad för att låta replay fortsätta.

**Om du behöver återställa någon policy:** Titta i
`20260422130000_fas_2_1_1_all_policies.sql` — det är nuvarande
bookings-policies (14 st) konsoliderade från prod.

### 20260325000003_rut_claims.sql (arkiverad 2026-04-22)

**Varför:** Hela migrationen är dead code mot nuvarande prod:

1. Skapar `rut_claims`-tabell som inte finns i prod (RUT-infrastruktur
   är avstängd tills Fas 7.5, se userMemories).
2. ADD:ar 4 kolumner till bookings: `rut_claim_id`, `rut_claim_status`,
   `rut_claim_error`, `rut_submitted_at` — alla saknas i prod.
3. Använder ogiltig PG-syntax: `CREATE POLICY IF NOT EXISTS`.

Prod-bookings har istället `rut_amount` (integer) +
`rut_application_status` (text med CHECK constraint) — dessa finns
i `00005_fas_2_1_bookings.sql` från retroaktiv §2.1.1-audit.

**Fas 2.X Replayability:** Filen blockerade db reset på rad 30 med
"syntax error at or near NOT". Arkiverad för att låta replay fortsätta.

**När RUT-infrastruktur ska byggas (Fas 7.5):**
- Bygg ny migration med fräsch rut_claims-schema
- Matcha aktuellt Skatteverket-API-kontrakt
- Se `docs/audits/2026-04-23-rut-infrastructure-decision.md`

### 20260326000002_add_sqm_bookings.sql (arkiverad 2026-04-22)

**Varför:** Hela migrationen är dead code mot prod:

- `ADD COLUMN sqm INTEGER` på bookings → prod har `square_meters`
  (annat kolumnnamn), inte `sqm`. `sqm` existerar inte i prod.
- `CREATE INDEX idx_bookings_email` → `bookings.email` finns inte
  i prod (ersatt av `customer_email`).
- `CREATE INDEX idx_bookings_customer_email/date` → dessa index-namn
  existerar inte i prod.
- `cleaners.terms_accepted/terms_accepted_at/terms_version` — alla 3
  kolumner saknas i prod. Prod har istället `terms_version_accepted` på
  BOOKINGS (inte cleaners).

Filen representerar tidig prototyp av kolumn-namngivning som helt
omarbetades innan prod-deploy.

**Fas 2.X Replayability:** Blockerade db reset på rad 4 med
"column email does not exist". Arkiverad.

**Observation:** `20260326000005_all_missing_columns.sql` gör också
`ADD COLUMN sqm` — hanteras när replay når den.

### 20260326000003_referrals_table.sql (arkiverad 2026-04-22)

**Varför:** Migrationen skapar en `referrals`-tabell som skiljer sig
från prod:

- Migration: 9 kolumner inkl `ref_code` (NOT NULL), `converted_at`,
  `reward_sent`
- Prod (rad 2553): 5 kolumner — id, referrer_email, referred_email,
  status, created_at + CHECK constraint på status
- Migrationens 2 index + 1 policy: alla saknas i prod (prod har bara
  "Service role manages referrals"-policy)

CREATE TABLE IF NOT EXISTS skippas (tabellen finns redan), men sedan
failar `CREATE INDEX ... ON referrals(ref_code)` eftersom den
kolumnen aldrig blev del av prod-schemat.

Tabellen i prod måste ha skapats via annan migration eller Studio-
operation. Migrationen representerar en övergiven prototyp.

**Fas 2.X Replayability:** Blockerade db reset på rad 12. Arkiverad.

**Om referrals-hantering ska uppdateras:** Skapa ny migration som
matchar nuvarande prod-schema (5 kolumner). Aktuella referrals-
policies finns i 20260422130000_fas_2_1_1_all_policies.sql (om några)
annars i fresh prod-dump.

### 20260326000005_all_missing_columns.sql (arkiverad 2026-04-22)

**Varför:** Hela filen är praktiskt dead mot prod trots den skapar flera
schema-objekt:

1. **ALTER TABLE bookings (24 rader):** ADD COLUMN-operationer som alla
   antingen redan finns i `00005_fas_2_1_bookings.sql` (retroaktiv
   prod-snapshot) eller saknas i prod. Redundant.

2. **8 CREATE INDEX:** 6 saknas i prod, 2 med fel kolumnnamn.
   - idx_bookings_email → bookings har inte 'email' (har 'customer_email')
   - idx_bookings_date → prod har index men på 'booking_date', inte 'date'
   - 5 andra index: alla saknas helt i prod

3. **CREATE TABLE customer_reports:** Hela tabellen saknas i prod.

4. **2 CREATE POLICY:** Båda saknas i prod.

Migrationens INTENT reflekterar en prototyp-fas som omfattande
reviderades innan prod-deploy.

**Fas 2.X Replayability:** Blockerade db reset på rad 25. Arkiverad.

### 20260326100001_customers_rls.sql (arkiverad 2026-04-22)

**Varför:** Migrationen refererar tabellen `customers` som aldrig
existerat i prod. Prod har alltid använt `customer_profiles`-
tabellen (rad 2200 i prod-schema.sql, skapas i `00002_fas_2_1_customer_profiles.sql`).

Filen har `ALTER TABLE IF EXISTS customers ENABLE RLS` (skippas),
men `CREATE POLICY "..." ON customers` saknar motsvarande guard
och failar.

**Fas 2.X Replayability:** Blockerade db reset på rad 9. Arkiverad.

Aktuella customer_profiles-policies finns i
`20260422130000_fas_2_1_1_all_policies.sql`.

### 20260326400001_realistic_cleaners_seed.sql (arkiverad 2026-04-22)

**Varför:** Ren test-seed-data (3 INSERT-statements, 0 schema-operationer).

Filen INSERT:ar testdata för cleaners + cleaner_availability med
kolumnen `jobs_completed` som inte existerar i prod (prod har
`completed_jobs` + `total_jobs` — duplikatpar dokumenterat i
progress-filens hygien-task #15).

Test-data hör inte hemma i migrations. Arkiverad av Fas 2.X-principer:
migrations ska bara hantera schema-förändringar som ska replikeras
mellan miljöer.

**Om du behöver test-cleaners lokalt:** Skapa dem via lokal Studio
eller `supabase/seed.sql` (separat från migrations).

### 20260326600001_fix_applications_rls_and_update.sql (arkiverad 2026-04-22)

**Varför:** 100% dead code + ogiltig SQL-syntax.

- Använder `CREATE POLICY IF NOT EXISTS` (ej PG-syntax)
- 2 policies saknas i prod:
  - "Autentiserad kan uppdatera ansökningar"
  - "Anon kan uppdatera ansökningar"

Aktuella cleaner_applications-policies finns i
`20260422130000_fas_2_1_1_all_policies.sql` (8 policies från prod).

### 20260326800001_booking_time_slots.sql (arkiverad 2026-04-22)

**Varför:** 100% dead code. Skapar hel time_end-infrastruktur som inget
av finns i prod:
- time_end-kolumn på bookings
- set_booking_time_end function + trigger
- idx_bookings_date_time
- 4 policies på cleaner_availability/blocked_dates

Dessutom använder obsoleta kolumnnamn: date/time/hours istället för
prod:s booking_date/booking_time/booking_hours.

Representerar tidigt försök att bygga tidsbaserad bokningsspärr som
ersattes helt före prod-deploy.

### 20260327200001_performance_indexes.sql (arkiverad 2026-04-22)

**Varför:** 89% dead. Av 18 CREATE INDEX + 1 UNIQUE constraint:

FINNS i prod (2):
- idx_bookings_date (rad 3708) — skapas också i 20260325000001
- idx_bookings_status (rad 3744) — skapas i 00005_fas_2_1_bookings.sql

SAKNAS i prod (16):
- idx_bookings_cleaner_date, idx_bookings_payment, idx_bookings_email
- idx_bookings_customer_email
- idx_cleaners_city/status/city_status (alla 3)
- idx_applications_status/email
- idx_availability_cleaner/active
- idx_blocked_dates_cleaner/date
- idx_reviews_cleaner (reviews är VIEW — kan inte ha index)
- idx_emails_status/category
- uq_booking_cleaner_slot UNIQUE constraint

Dessutom använder flera rader obsoleta kolumnnamn (date, email, time)
som inte existerar i prod-bookings.

Filen representerar prototyp "Kör mot Supabase SQL Editor" som
aldrig applicerades.

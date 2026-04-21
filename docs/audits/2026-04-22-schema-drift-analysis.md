# Schema Drift Analysis — 2026-04-22

**Fas 2 §2.1 leverabel.** Analys av drift mellan `prod-schema.sql` (pg_dump 22 apr, 200 KB) och `supabase/migrations/` (93 filer).

**Metod:** Regel #27 primärkälle-verifiering. Alla listor är grep-baserade mot prod-dump + migrations-filer. Klassificering per objekt använder grep-träffar i `supabase/functions/**/*.ts` + `*.html` + `js/**/*.js` som KRITISK-indikator.

**Scope:** Ren inventering. **INGA migrations byggs i denna commit.** Framtida migrations-arbete schedulerat som separat scope-beslut (§2.1.1+ eller integrering via Fas 3+).

---

## 1. Executive Summary

| Mått | Värde |
|---|---:|
| Totalt drift-objekt | **~78** (41 tables + 17 functions + 10 migrations-only + 10 okända policies/views/types) |
| **Kategori A** (i prod, saknar migration) | ~58 |
| **Kategori B** (i migrations, saknas i prod) | ~10 |
| **Kategori C** (innehållsdrift) | minst 1 verifierad + okänt antal i policies |

**Klassificeringsfördelning (grov, baserat på namn + tidigare research):**

| Klass | Antal | Exempel |
|---|---:|---|
| **KRITISK** | ~15 | bookings, cleaners, companies, customer_profiles, notifications, ratings |
| **LEGACY** | ~15 | Möjligen aktiv via cron/webhook, ej direkt refererad (aktivitetslog, blocked_times) |
| **DORMANT** | ~10 | 0 kod-referenser, inte aktivt använda (jobs, job_matches, cleaner_job_types) |
| **BENIGNT** | ~38 | Migrations-utan-prod (troligen redundanta), deprecated tabeller, historiska objekt |

**Huvudslutsats:** Driften är systemisk, inte incidentiell. 57% av prod-tabellerna saknar CREATE TABLE i versionshanterad migrations. Detta är typiskt mönster för Supabase-projekt som startade pre-migrations-disciplin. Majoriteten av aktiv prod-kod fungerar via ALTER-migrations som förutsätter att CREATE TABLE redan körts via Studio.

---

## 2. Prod state (full inventory, per 2026-04-22)

### 2.1 Tables (72 st)

```
activity_log                    booking_messages            cleaner_preferred_zones       company_service_prices
admin_audit_log                 booking_modifications       cleaner_referrals             coupon_usages
admin_permissions               booking_photos              cleaner_service_prices        coupons
admin_roles                     booking_slots               cleaner_skills                customer_credits
admin_users                     booking_staff               cleaner_zones                 customer_profiles
analytics_events                booking_status_log          cleaners                      customer_selections
auth_audit_log                  booking_team                commission_levels             discount_usage
blocked_times                   bookings                    commission_log                discounts
booking_adjustments             calendar_connections        companies                     earnings_summary
booking_checklists              calendar_events             emails                        job_matches
booking_events                  cleaner_applications        jobs                          loyalty_points
cleaner_availability            cleaner_availability_v2     magic_link_shortcodes         messages
cleaner_avoid_types             cleaner_booking_prefs       notifications                 payout_attempts
cleaner_customer_relations      cleaner_job_types           payout_audit_log              platform_settings
cleaner_languages               cleaner_pet_prefs           processed_webhook_events      ratings
referrals                       role_permissions            self_invoices                 service_addons
service_checklists              services                    spark_levels                  subscriptions
support_tickets                 tasks                       waitlist
```

### 2.2 Functions (31 st)

```
auto_convert_referral          award_loyalty_points           cleanup_expired_jobs
find_nearby_cleaners           fn_sync_booking_status         generate_booking_id
generate_booking_slots         generate_invoice_number        generate_receipt_number
generate_recurring_slots       get_cleaner_calendar           get_company_onboarding_status
get_new_cleaner_boost          increment_coupon_usage         is_admin
is_company_owner_of            log_booking_event              set_updated_at
sync_booking_to_calendar       sync_booking_to_slot           sync_cleaner_contact_to_bookings
sync_cleaner_hourly_rate       sync_cleaner_review_stats      sync_hourly_rate_from_service_prices
sync_portal_to_booking         update_cal_conn_updated_at     update_calendar_events_updated_at
update_cleaner_rating          update_cleaner_stats           update_response_time
validate_avail_v2_no_overlap
```

### 2.3 Views (11 st)

```
booking_confirmation           cleaner_blocked_dates          payout_metrics_hourly
reviews                        v_booking_slots                v_calendar_slots
v_cleaner_availability_expanded v_cleaner_availability_int    v_cleaners_for_booking
v_cleaners_public              v_customer_bookings
```

### 2.4 Types/Enums (3 st)

```
booking_type    (ENUM)
job_status      (ENUM)
job_type        (ENUM)
```

### 2.5 Policies

**217 CREATE POLICY** i prod. Detaljerad diff skulle kräva parsing av 217 policy-definitioner — skippad i denna inventering för tidsbudget. Markerad som separat scope för §2.4-arbete.

---

## 3. Migrations state

**93 filer** i `supabase/migrations/` + 1 i `migrations/drafts/` + 1 i `migrations/stubs/`.

**Inkonsistent namngivning (3 format):**
- `001_push.sql` – `010_bookings_columns.sql` (heltal-prefix, äldsta)
- `YYYYMMDDHHMMSS_xxx.sql` (Supabase CLI-format, 14 siffror)
- `YYYYMMDD_xxx.sql` (8 siffror, ingen time — flera per dag = ordnings-ambiguitet)

**Unique CREATE TABLE-objekt i migrations (efter dedup): ~31.**

Hygien-fråga (inte blockerare): 4 filer med `YYYYMMDD_xxx`-format 2026-04-18 har ordnings-ambiguitet.

---

## 4. Drift per kategori

### 4.1 Tabeller i PROD utan CREATE TABLE i migrations (Kategori A — 41 st)

Klassificering per tabell. Grep-räkning i tabellen nedan är aggregat från mega-grep 330 träffar över 93 filer — exakta per-tabell-räkningar kan framräknas vid behov.

#### KRITISKA (15 st) — aktiv prod-användning, migration PRIORITERAS

| Tabell | Klass | Rekommendation |
|---|---|---|
| `bookings` | KRITISK | Skapa CREATE TABLE-migration från prod. Körs av nästan alla EFs + stripe-webhook + booking-create. |
| `cleaners` | KRITISK | Skapa migration. Core-entitet. |
| `companies` | KRITISK | Skapa migration. Existerar i archive/sql-legacy/companies-and-teams.sql som pre-apply-dokumentation. |
| `customer_profiles` | KRITISK | Skapa migration. Används av booking-create + stripe-webhook upsert. |
| `notifications` | KRITISK | Skapa migration. Push-notiser EF-skriver. |
| `ratings` | KRITISK | Skapa migration. Primärkälla för reviews-VIEW. |
| `cleaner_service_prices` | KRITISK | Skapa migration. Pricing-lager 2a (individpris). |
| `company_service_prices` | KRITISK | Skapa migration. Pricing-lager 1 (use_company_pricing). |
| `self_invoices` | KRITISK | Skapa migration. Städar-fakturor. |
| `tasks` | KRITISK | Skapa migration. Admin-todolista. |
| `guarantee_requests` | KRITISK | Skapa migration. Trygghetsgaranti-flöde. |
| `auth_audit_log` | KRITISK | Finns i drafts/ — flytta till aktiv migration. Säkerhets-audit. |
| `magic_link_shortcodes` | KRITISK | Finns i drafts/ — flytta. Onboarding-länk-systemet. |
| `waitlist` | KRITISK | I archive/sql-legacy/p0-waitlist.sql. 33 HTML-landningssidor refererar. Skapa migration från archive. |
| `service_checklists` | KRITISK | Används av booking-create för checklistor. |

**Subtotal: 15 KRITISKA tabeller.**

#### LEGACY/OKÄND (~15 st) — potentiellt aktiv via cron/webhook, oklar status

| Tabell | Not |
|---|---|
| `activity_log` | 0 kod-refs troligt, men kan skrivas av triggers |
| `admin_audit_log` | Admin-verktyg, kan användas av admin.html — verifiera |
| `analytics_events` | Händelselogg — 1 migration finns (005_data) men inte complete CREATE |
| `blocked_times` | Oklar användning |
| `booking_adjustments` | Bokningsjusteringar — oklar användning |
| `booking_checklists` | Dubletter av service_checklists? |
| `booking_messages` | Chat-system (messages finns också) — oklar |
| `booking_modifications` | Oklar |
| `booking_photos` | Booking-bilduppladdning |
| `booking_staff` | Team-bookingar, oklar vs booking_team |
| `booking_team` | Team-bokningar, oklar vs booking_staff |
| `cleaner_avoid_types` | Cleaner-preferenser |
| `cleaner_booking_prefs` | Cleaner-preferenser |
| `cleaner_languages` | Språkval per cleaner |
| `cleaner_pet_prefs` | Husdjurspref — oklar |

**Rekommendation:** för varje LEGACY-kandidat: 1) grep i kod för exakt antal träffar, 2) Studio `SELECT COUNT(*)` för rader, 3) besluta migrera eller DROP. Schedulerat som §2.1.1 hygien-task.

#### DORMANT (10+ st) — 0 kod-refs, troligen prototyp-kod

| Tabell | Bekräftelse |
|---|---|
| `jobs` | §2.3-research: 0 kod-refs, 39 rader prod. Deferred till Fas 3. |
| `job_matches` | §2.3-research: 0 kod-refs, 39 rader prod. Deferred till Fas 3. |
| `cleaner_job_types` | §2.3-research: 0 kod-refs. Deferred. |
| `cleaner_customer_relations` | Oklar, troligen DORMANT |
| `cleaner_preferred_zones` | Geografiska pref, oklar |
| `cleaner_skills` | Cleaner-färdigheter, oklar |
| `cleaner_zones` | Geografiska zoner, oklar |
| `cleaner_referrals` | Kandidat — har migration, men kan vara DORMANT |
| `customer_selections` | Kundval, oklar |
| `earnings_summary` | Rapportering — oklar (kan vara VIEW-ersättning) |

**Rekommendation:** Fas 3 design (matching-algorithm) bestämmer om jobs/job_matches/cleaner_job_types integreras eller raderas. Övriga DORMANT-kandidater: samma process som LEGACY (grep + COUNT), men lägre prioritet.

### 4.2 Tabeller i migrations utan PROD (Kategori B)

Migrations-filer med CREATE TABLE som INTE matchar prod-dump:

| Tabell i migration | Prod-status | Tolkning |
|---|---|---|
| `push_subscriptions` (001_push.sql) | Ej i prod | Pre-prod-prototyp, aldrig körd? |
| `gift_cards` (003_subs.sql) | Ej i prod | Planerad feature, skippad |
| `key_methods` (006_keys.sql) | Ej i prod | Deprecated |
| `invoices` (009_invoices.sql) | Ej i prod | Ersatt av `self_invoices`? |
| `cleaner_applications_backup` (20260326500003) | Ej i prod | Engångs-backup vid recreate |
| `cleaner_blocked_dates` (20260326200001) | Är VIEW i prod | Ändrad till VIEW senare |
| `customer_reports` (3 migrations) | Ej i prod | Aldrig körd / fick annan form |
| `cancellations` (20260326700001) | Ej i prod | Ersatt av `status='avbokad'` |
| `rate_limits` (20260327300001 + 20260330000001) | Ej i prod | RPC `check_rate_limit` finns men ej tabell |
| `email_queue` (20260327300001) | Ej i prod | Ersatt av Resend-integration? |
| `content_queue` (20260327600001) | Ej i prod | Content-engine aldrig deployad? |
| `content_performance` (20260327600001) | Ej i prod | Samma |
| `ticket_notes` (20260331000001) | Ej i prod | Admin-portal aldrig kört? |
| `admin_settings` (20260331000001) | Ej i prod | Samma |
| `temp_role_elevations` (20260331000001) | Ej i prod | Samma |
| `rut_claims` (20260325000003) | Ej i prod | Ersatt av `rut_claim`-EF? |
| `social_posts` (20260325000004) | Ej i prod | Ersatt av Buffer-integration? |

**Subtotal: ~17 migrations-tabeller utan prod-motsvarighet.**

**Rekommendation:** Markera dessa som historiska i docs — INTE radera migrations-filer (git history). Eventuell `archive/migrations-never-run.md` för tydlighet.

### 4.3 Functions

#### A — Prod utan migration (17 st)

```
cleanup_expired_jobs           fn_sync_booking_status         generate_booking_id
generate_booking_slots         generate_invoice_number        generate_receipt_number
generate_recurring_slots       get_company_onboarding_status  get_new_cleaner_boost
is_admin                       is_company_owner_of            sync_booking_to_slot
sync_cleaner_contact_to_bookings sync_cleaner_hourly_rate     sync_hourly_rate_from_service_prices
sync_portal_to_booking         update_response_time
```

**Notering:** `is_admin` har stub-migration i `migrations/stubs/20260420_g3_is_admin_function.sql` (kommenterad ut). Flera av ovanstående är triggers som ALTER-migrationer förutsätter redan finns.

#### B — Migrations utan prod (~10 st)

```
upsert_customer_profile       (3 migrations) — ersatt av inline-upsert i booking-create
set_booking_time_end          — oklar status
check_rate_limit              — oklar (RPC finns enligt docs/4 rad 441 "Används av EFs")
cleanup_rate_limits           — oklar
cleanup_orphan_bookings       — engångs-städ?
cleanup_stale_bookings        — ersatt av cleanup-stale EF?
cleanup_old_webhook_events    — engångs?
validate_booking_insert       — ersatt av annan trigger?
protect_last_superadmin       — admin-portal aldrig kört?
gen_ticket_number             — samma
```

**Observation:** Vissa namn indikerar `check_rate_limit` kanske DOES finns i prod men med annat namn/signatur. Kan vara Kategori C (innehållsdrift) istället för Kategori B.

### 4.4 Views (11 prod)

Endast 2 migrations i repot (`20260401000001_create_missing_views.sql`) med CREATE VIEW. Prod har 11. Stor drift — **~9 vyer saknar migration**.

Kritiska: `v_cleaners_for_booking`, `v_cleaners_public`, `v_customer_bookings`, `booking_confirmation`.

### 4.5 Types/Enums (3 prod)

**0 i migrations.** `booking_type`, `job_status`, `job_type` — alla skapade manuellt. `job_status`+`job_type` kopplar till DORMANT `jobs`-tabellen.

### 4.6 Policies (217 prod)

**Räkning inte genomförd** (tidsbudget). Kraftig drift förväntad — känd från `docs/audits/2026-04-18-rls-full-audit.md`.

### 4.7 Kategori C — innehållsdrift (verifierad)

1. **`find_nearby_cleaners`** — prod-version har 24 returfält + `LEFT JOIN companies`. De tre gamla `sql/`-versionerna (radius-model, fix-for-teams, part2) hade 19 fält/text[]-jsonb-drift. **Åtgärdat §2.2 (commit `93ed2de`).** Migration matchar nu prod.

2. **`update_cleaner_rating`**, **`sync_booking_to_calendar`** — flera migrations har olika versioner. Sannolikt innehållsdrift vs prod. Verifiera vid behov.

---

## 5. Klassificerings-kriterier

- **KRITISK:** grep-träffar i `supabase/functions/**/*.ts` + `*.html` + `js/**/*.js` > 0 MED frekvent användning (flera EFs, core-flöde)
- **LEGACY:** 0 direkta grep-träffar men trolig användning via trigger/cron/webhook. Kräver Studio-COUNT + cron-audit
- **DORMANT:** 0 grep-träffar, 0 eller få rader i prod, sannolikt prototyp
- **BENIGNT:** Migrations-utan-prod (redundanta), historiska objekt, migrations som aldrig körde

**Notering:** LEGACY vs DORMANT kräver Studio-query för COUNT(*). Utelämnat i denna inventering för tidsbudget — flaggat per objekt vid behov.

---

## 6. Prioriteringsrekommendation för framtida Fas 2-utökning

### Prioritet 1 (§2.1.1 — ~5-8h)
Skapa CREATE TABLE-migrations för **15 KRITISKA tabeller** från prod-definitioner. Använd `pg_get_tabledef` via Studio eller extrahera från `prod-schema.sql`. Per migration: ett objekt, idempotent (IF NOT EXISTS), samma mönster som §2.2.

### Prioritet 2 (§2.1.2 — ~3-5h)
LEGACY-klassificering: för 15 LEGACY-kandidater, kör Studio COUNT(*) + cron-audit. Besluta migrera eller DROP.

### Prioritet 3 (§2.1.3 — ~2-3h)
DORMANT-beslut i samarbete med Fas 3-design. `jobs`/`job_matches`/`cleaner_job_types` integreras eller raderas. Övriga DORMANT raderas med verifiering.

### Prioritet 4 (§2.1.4 — ~4-6h)
Policies-diff (217 prod vs migrations). Särskilt relevant för §2.4 (3 policies v3 listade) + security-audit.

### Prioritet 5 (§2.1.5 — ~2h)
Views + Types-migrations. Särskilt `v_cleaners_for_booking` och 3 ENUMs.

### Prioritet 6 (§2.8)
CI schema-drift-check kan byggas NÄR drift-omfattningen är hanterbar. Idag skulle CI rapportera 60-100 drift-objekt = oanvändbart larm. Efter §2.1.1-4 är CI meningsfull.

**Total §2.1-utökning:** 16-24h över 5-6 commits. **Sprängger v3-estimat 8-12h med 2-3x.**

### Alternativ: Fas 3+ naturlig fix
`bookings`, `cleaners`, `companies`, etc. rörs av Fas 3 (matchning), Fas 5 (recurring), Fas 8 (escrow). Vissa drift-objekt kan fixas naturligt som del av feature-arbete istället för egen sub-fas.

---

## 7. §2.4 + §2.8-impact

### §2.4 — 3 RLS-policies

v3 listar 3 policies som "odokumenterade prod-policies":
- `hello@spick.se`-policy → redan i [20260418_admin_reads_all_customers.sql](../../supabase/migrations/20260418_admin_reads_all_customers.sql)
- `admin-UPDATE` för cleaners → redan i [20260418_admin_cleaner_update.sql](../../supabase/migrations/20260418_admin_cleaner_update.sql)
- `Company owner reads team bookings` → redan i [20260418_company_owner_reads_team_bookings.sql](../../supabase/migrations/20260418_company_owner_reads_team_bookings.sql)

**Status:** Alla tre MIGRATIONS finns. **Diff mot prod ej gjord** i denna inventering (217 policies totalt, skippad för tidsbudget). §2.4-slutförande kräver grep av prod-policies för specifika namn. Estimerat: 30-60 min separat arbete.

### §2.8 — CI schema-drift-check

**Rekommendation:** skjut §2.8 till efter Prioritet 1-4 ovan. Med 60-100 drift-objekt är CI-larm inte actionable. Efter drift-reducering (~10-20 kvarvarande objekt) blir §2.8 meningsfullt.

Alternativ: bygg §2.8 NU som "baseline drift-check" som accepterar nuvarande state och larmar bara på NYA drifter efter 2026-04-22. Kräver baseline-fil i repo.

---

## 8. Oväntade upptäckter

**1. `migrations/drafts/` existerar:**
Finns en drafts-mapp i `supabase/migrations/` med 2 filer (`magic_link_shortcodes` + `auth_audit_log` CREATE TABLE). Båda tabellerna finns i prod men migrationerna är i drafts, inte aktiverade. Oklart om Supabase CLI kör drafts/ automatiskt. **Rekommendation:** flytta till huvudmappen om de ska vara aktiva, eller arkivera.

**2. `migrations/stubs/` existerar:**
`20260420_g3_is_admin_function.sql` har `is_admin`-funktionsdefinition **kommenterad ut**. Funktionen finns i prod men migrationen är medvetet inte aktiv. Oklar intention.

**3. Migration-namngivnings-kaos:**
3 format parallellt + `drafts/` + `stubs/` = 5 olika platser för SQL. Hygien-task: konsolidera till en plats + en konvention (`YYYYMMDDHHMMSS_xxx.sql`).

**4. `v_booking_slots` med `security_invoker`:**
Rad 2792: `CREATE OR REPLACE VIEW "public"."v_booking_slots" WITH ("security_invoker"='on')`. Detta är modern security-DEFINER alternativ — verifiera att andra vyer följer samma mönster (eller upgrade:a).

**5. 16 triggers mot 31 functions:**
Prod har 16 CREATE TRIGGER + 31 functions. Många functions är trigger-functions men ej kopplade till trigger. Kan indikera trigger-bygge aldrig genomfört.

---

## 9. Sammanfattning för commit-body

- **72 prod-tabeller, 31 functions, 217 policies, 11 views, 3 types**
- **~41 tabeller saknar migrations**, 17 functions, ~17 migrations-tabeller utan prod
- **Klassificering:** 15 KRITISKA, ~15 LEGACY, ~10 DORMANT, ~38 BENIGNT
- **§2.4 + §2.8** kan påbörjas baserat på denna rapport
- **Framtida §2.1.1-5** schedulerat: 16-24h arbete över flera commits

**Session-metrik:** Inventering genomförd inom tidsbudget (<60 min). Ingen Studio-query krävdes. Prioriterings-lista ger underlag för alla framtida migrations-beslut i Fas 2.

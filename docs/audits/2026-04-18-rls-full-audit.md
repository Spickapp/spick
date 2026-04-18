# Full RLS-audit — Vecka 1 Fas 0.1

**Datum:** 2026-04-18 (påbörjad 2026-04-19)
**Plan-referens:** [Arkitekturplan v2](docs/planning/spick-arkitekturplan-v2.md) Fas 0.1
**Metod:** Regel #26 + #27 + #28 — fil:rad för varje påstående, SQL mot prod för divergens-verifikation.
**Status:** 🟡 Pågående — repo-del klar, SQL-del pausad i väntan på prod-output.

---

## Begränsning (Regel #27-transparens)

`supabase`-CLI och `psql` saknas i Claude Codes miljö. **Denna rapport är repo-sidan av sanningen.** Prod-sidan fylls i när Farhad kör SQL-queries i Supabase Studio och klistrar in resultatet.

Två kända divergenser bekräftades i tidigare audits:
1. `"hello@spick.se"`-policy för UPDATE på `cleaners` (finns i prod, saknas i repo)
2. `"Company owner reads team bookings"` (finns i prod, saknas i repo)

Denna audit är framework för att hitta alla liknande divergenser systematiskt.

---

## Executive summary

### Repo-sidan (verifierat via grep)

- **Totalt CREATE POLICY-statements i repo:** ~192 rader över 30+ SQL-filer
- **Unika policies** (efter DROP/CREATE-cykler): svårt att räkna exakt utan SQL
- **Tabeller med RLS aktiverat i repo:** ~55
- **CLAUDE.md nämner 78 tabeller i prod** → ~23 tabeller saknar sannolikt repo-RLS-definition

### Problem-kategorier (från repo-grep)

| Kategori | Antal | Källor |
|----------|-------|--------|
| **P0 — `qual=true` SELECT på PII-lik tabell** | ≥10 | Se Del A |
| **P1 — Redundanta/duplicerade policies** | ≥8 | Se Del B |
| **P1 — Odokumenterade prod-policies** | ≥2 bekräftade | Se Del C |
| **P1 — Saknad admin-access** | ≥5 tabeller | Se Del D |
| **P1 — `is_admin()`-funktion saknas definition i repo** | 1 kritiskt | Se Del D.4 |

**Total: minst 26 identifierade policy-problem från repo-audit.** Prod kan ha fler.

---

## Del A: Farliga policies (P0) — qual=true på SELECT

Policies med `USING (true)` på SELECT låter alla (inklusive `anon`) läsa hela tabellen. OK för publik metadata. **Inte OK för PII-lika tabeller.**

### A.1 — Bekräftat farliga (PII eller kontaktuppgifter)

| Tabell | Policy | Fil:rad | Risk |
|--------|--------|---------|------|
| `booking_staff` | `anon_read_booking_staff` USING(true) | [add-booking-architecture-tables.sql:22](supabase/add-booking-architecture-tables.sql:22) | Exponerar cleaner_id-tilldelning till anon |
| `booking_adjustments` | `anon_read_adjustments` USING(true) | [add-booking-architecture-tables.sql:54](supabase/add-booking-architecture-tables.sql:54) | Exponerar prisändringar + skäl |
| `booking_messages` | `anon_read_messages` USING(true) | [add-booking-architecture-tables.sql:69](supabase/add-booking-architecture-tables.sql:69) | Privatmeddelanden kund↔cleaner publika |
| `booking_photos` | `anon_read_photos` USING(true) | [add-booking-architecture-tables.sql:85](supabase/add-booking-architecture-tables.sql:85) | Foton från jobb publika |
| `booking_modifications` | `anon_read_modifications` USING(true) | [add-booking-architecture-tables.sql:107](supabase/add-booking-architecture-tables.sql:107) | Ändringshistorik publik |
| `cleaner_availability` (v1) | `Public read availability` USING(true) | [20260326200001_availability.sql:33](supabase/migrations/20260326200001_availability.sql:33), [20260326300002:42](supabase/migrations/20260326300002_seed_availability_fix_rls.sql:42), [20260326800001:42](supabase/migrations/20260326800001_booking_time_slots.sql:42), [20260327400001:33](supabase/migrations/20260327400001_nuclear_rls_hardening.sql:33) | Exponerar scheman (4 dubbletter!) |
| `cleaner_blocked_dates` | `Public read blocked dates` USING(true) | [20260326200001_availability.sql:34](supabase/migrations/20260326200001_availability.sql:34) | Exponerar semester/sjukdagar |
| `calendar_events` | `Anon can read calendar_events` USING(true) | [20260414000001_calendar_events.sql:154](supabase/migrations/20260414000001_calendar_events.sql:154) | Exponerar hela kalendern för anon |
| `cleaner_availability_v2` | `Anon can read availability_v2` USING(true) | [20260414000001_calendar_events.sql:172](supabase/migrations/20260414000001_calendar_events.sql:172) | Samma som v1 |
| `reviews` | `Public read reviews` USING(true) | [003_subs.sql:74](supabase/migrations/003_subs.sql:74), [007_rls.sql:82](supabase/migrations/007_rls.sql:82), [20260325000001:69](supabase/migrations/20260325000001_production_ready.sql:69), [20260327400001:30](supabase/migrations/20260327400001_nuclear_rls_hardening.sql:30) | OK för publikt men 4 dubbletter (Del B) |
| `invoices` | `Anon read invoices` USING(true) | [008_admin_policies.sql:52](supabase/migrations/008_admin_policies.sql:52), [009_invoices.sql:30](supabase/migrations/009_invoices.sql:30) | Fakturor till alla kunder exponerade |
| `emails` | `Anon read emails` USING(true) | [20260327000001_emails_inbox.sql:38](supabase/migrations/20260327000001_emails_inbox.sql:38) | Alla inkommande mejl publika |
| `customer_reports` | `Anon read reports` USING(true) | [20260327100001_fix_missing_tables.sql:25](supabase/migrations/20260327100001_fix_missing_tables.sql:25) | Rapporter om kunder publika |
| `guarantee_requests` | `Anon read guarantee requests` USING(true) | [008_admin_policies.sql:43](supabase/migrations/008_admin_policies.sql:43) | Missnöjesanmälningar publika |
| `gift_cards` | `Public read gift_cards` USING(true) | [003_subs.sql:77](supabase/migrations/003_subs.sql:77) | Presentkortskoder publika |
| `booking_status_log` | `Anon read log` USING(true) | [009_invoices.sql:46](supabase/migrations/009_invoices.sql:46) | Overridas senare av service-only-policy |

### A.2 — OK (publikt i design)

| Tabell | Policy | Varför OK |
|--------|--------|-----------|
| `cleaners` | `Anyone can read cleaner slug` USING(true) | Publika profiler |
| `platform_settings` | `Public read platform_settings` USING(true) | Konfig som ändå exponeras via EF |
| `spark_levels`, `commission_levels` | `Anyone can read` | Tierinfo — publikt |
| `admin_roles`, `role_permissions`, `admin_permissions` | `Authenticated read` USING(true) | RBAC-catalog — OK för autentiserade |

### A.3 — Verifiera i prod

**Kör SQL-query #1 nedan** för att se vilka av A.1 som faktiskt är aktiva (DROP POLICY IF EXISTS-cykler kan ha städat bort några).

---

## Del B: Redundanta policies (P1) — konsolideringskandidater

Policies i repo med identiskt beteende som senare ersätts. Upptäck via `policyname, qual` i prod.

### B.1 — Bekräftad redundans i repo (samma namn, flera filer)

| Policy-namn | Duplicerad i |
|-------------|--------------|
| `"Public read availability"` | [20260326200001:33](supabase/migrations/20260326200001_availability.sql:33), [20260326300002:42](supabase/migrations/20260326300002_seed_availability_fix_rls.sql:42), [20260326800001:42](supabase/migrations/20260326800001_booking_time_slots.sql:42), [20260327400001:33](supabase/migrations/20260327400001_nuclear_rls_hardening.sql:33) |
| `"Public read reviews"` | [003_subs.sql:74](supabase/migrations/003_subs.sql:74), [007_rls.sql:82](supabase/migrations/007_rls.sql:82), [20260325000001:69](supabase/migrations/20260325000001_production_ready.sql:69), [20260327400001:30](supabase/migrations/20260327400001_nuclear_rls_hardening.sql:30) |
| `"Service role manage availability"` | [20260326200001:35](supabase/migrations/20260326200001_availability.sql:35), [20260326300002:46](supabase/migrations/20260326300002_seed_availability_fix_rls.sql:46) |
| `"Public insert bookings"` | [007_rls.sql:30](supabase/migrations/007_rls.sql:30), [20260325000002:10](supabase/migrations/20260325000002_rls_bookings.sql:10), [20260327100001:94](supabase/migrations/20260327100001_fix_missing_tables.sql:94) |
| `"Anon insert applications"` | [20260327400001:29](supabase/migrations/20260327400001_nuclear_rls_hardening.sql:29), [007_rls.sql:62](supabase/migrations/007_rls.sql:62) |
| `"Anon kan insertera referral"` | [20260326000003:18](supabase/migrations/20260326000003_referrals_table.sql:18), [20260326000005:67](supabase/migrations/20260326000005_all_missing_columns.sql:67) |
| `"Städare kan rapportera"` | [20260326000004:27](supabase/migrations/20260326000004_security_tables.sql:27), [20260326000005:47](supabase/migrations/20260326000005_all_missing_columns.sql:47) |

CREATE POLICY utan DROP POLICY IF EXISTS först → i Postgres antingen ignoreras (om finns) eller genererar fel. De flesta av dessa är idempotenta via `DO $$ BEGIN ... IF NOT EXISTS`-wrapper. **Resultatet i prod kan ändå vara en av varje — men det är svårt att veta utan SQL.**

### B.2 — Konsolidera bookings-policies

[20260327500001_final_rls_bookings_fix.sql:19-22](supabase/migrations/20260327500001_final_rls_bookings_fix.sql:19) anger att bookings ska ha 4 policies:
- `insert_bookings` (anon, authenticated)
- `select_bookings` (service_role)
- `update_bookings` (service_role)
- `delete_bookings` (service_role)

Men senare migrations lägger till:
- [20260402000001:21-47](supabase/migrations/20260402000001_fix_rls_security.sql:21): `"Auth read own bookings"`, `"Anon read booking by uuid header"`, `"Auth update own bookings"`, `"Service role all bookings"`
- [20260330000001:64](supabase/migrations/20260330000001_security_hardening.sql:64): `"Approved cleaner claims open bookings"`
- [20260327300001:44](supabase/migrations/20260327300001_rate_limiting_email_queue.sql:44): `"Rate limited insert bookings"`

**Förväntat i prod: 7-10 policies på bookings.** Konsolidera till 4-5 max.

---

## Del C: Odokumenterade prod-policies (P1)

Bekräftade att finnas i prod men **saknar motsvarande migration-fil**:

### C.1 — Admin UPDATE-policy på cleaners (`"hello@spick.se"`-policy)

**Symptom:** Admin-UI uppdaterar cleaners framgångsrikt i prod. Men repo har bara:
- `"Service role full access cleaners"` ([007_rls.sql:19-21](supabase/migrations/007_rls.sql:19)) — admin är ej service_role
- `"Cleaners can update own profile columns"` ([20260402100001:70-73](supabase/migrations/20260402100001_slug_languages.sql:70)) — USING `auth.uid() = id` (förmodligen self-update, ej admin)

**Hypotes:** En policy skapad direkt i Supabase Dashboard som tillåter admin UPDATE baserat på email eller admin_users-lookup.

**Regel #27-brott.** Verifieras via SQL #3.

### C.2 — `"Company owner reads team bookings"` på bookings

**Symptom:** VD ser team-bokningar i stadare-dashboard.html:6171-6175 via OR-filter. RLS måste tillåta detta.

**Repo har bara:**
- `"Company owner can read team members"` på **cleaners**-tabell ([sql/companies-and-teams.sql:55-61](sql/companies-and-teams.sql:55)) — not on bookings

**Hypotes:** En motsvarande policy på bookings skapad direkt i Dashboard.

**Regel #27-brott.** Verifieras via SQL #4.

### C.3 — Eventuellt andra

SQL #1 kommer returnera alla prod-policies — diff mot repo-inventarium identifierar fler odokumenterade.

---

## Del D: Saknade policies (P1)

### D.1 — Admin SELECT-access saknas på 5 tabeller

Tidigare audit ([2026-04-19-view-as-impersonate-analys.md](docs/audits/2026-04-19-view-as-impersonate-analys.md) Uppgift 4) bekräftade 401-errors på:

| Tabell | Problem |
|--------|---------|
| `customer_profiles` | Endast self-read (`auth.jwt()->>'email' = email`) — admin får 401 |
| `companies` | Endast owner/service_role — admin ej täckt |
| `admin_audit_log` | Service_role only — admin-audit-calls från admin.html misslyckas tyst |
| `cleaner_service_prices` | Endast company_owner_manage_team_prices — admin ej täckt |
| `cleaner_availability` (v1) | Public read USING(true) — borde funka; 401 kan bero på att v1 är ENABLE ROW LEVEL SECURITY men inga policies i prod |

### D.2 — `is_admin()`-funktionen saknas i repo

**Refereras i 5 policies** ([add-booking-architecture-tables.sql:34](supabase/add-booking-architecture-tables.sql:34), [55](supabase/add-booking-architecture-tables.sql:55), [71](supabase/add-booking-architecture-tables.sql:71), [87](supabase/add-booking-architecture-tables.sql:87), [108](supabase/add-booking-architecture-tables.sql:108)) men **funktionen definieras INGENSTANS i repo**.

Grep `CREATE.*FUNCTION.*is_admin` → **0 träffar i hela repo**.

**Status:** Antingen finns funktionen i prod (odokumenterad, Regel #27-brott) ELLER policies misslyckas med "function does not exist".

Verifieras via SQL #5.

### D.3 — Tabeller utan RLS aktiverat

Lista från `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false`. Se SQL #6.

Kandidater som troligen saknar RLS (från grep — ingen `ENABLE ROW LEVEL SECURITY` hittad):
- `activity_log` (refereras i admin.html men ingen policy i repo)
- `jobs` (tabell nämnd av Farhad som 37 rader, ingen policy i repo)
- `v_available_jobs_with_match` (view, men view-level RLS är ovanligt)
- Möjligen: `companies` (har policies i sql/companies-and-teams.sql men `ALTER TABLE` är i samma fil — kan ha missats i prod)

### D.4 — Admin bulk-pattern

Ingen policy som baseras på admin_users-lookup. Det gäller 10+ tabeller. Se Del G för stub.

---

## Del E: Sammanfattning per tabell (repo-sidan)

**Notation:** `[SR]` = Service role, `[A]` = Anon, `[Auth]` = Authenticated, `[CO]` = Company owner, `[Admin]` = is_admin()

| Tabell | Policies i repo | Risker |
|--------|----------------|--------|
| `bookings` | INSERT×4, SELECT×4, UPDATE×3, DELETE×1 (redundant) | Konsolidera (Del B.2) |
| `cleaners` | SELECT ×3 (public_read, anon_active, slug), UPDATE×2 (service_role, own_cols) | Admin UPDATE saknas (Del C.1) |
| `customer_profiles` | SELECT×3, UPDATE×2, INSERT×2 | Admin SELECT saknas (Del D.1) |
| `cleaner_applications` | INSERT×3, SELECT×3, UPDATE×1 | Konsolidera |
| `reviews` | INSERT×2, SELECT×2 | OK efter konsolidering |
| `companies` | SELECT×2 (owner, service_role), UPDATE×1 (owner) | Admin SELECT saknas |
| `cleaner_availability` (v1) | SELECT×4 (PUBLIC_READ duplicerad), ALL×1 (service_role) | P0 — dubbletter (Del B.1) |
| `cleaner_availability_v2` | SELECT×1 (anon read, qual=true), ALL×2 | P0 — qual=true |
| `calendar_events` | SELECT×1 (anon, qual=true), ALL×2 | P0 |
| `cleaner_blocked_dates` | SELECT×1, ALL×1 | qual=true flaggad |
| `booking_staff` | SELECT×1, ALL×3 (auth, CO, Admin) | P0 qual=true + död kod |
| `booking_adjustments` | SELECT×1, ALL×1 (admin) | P0 qual=true |
| `booking_messages` | SELECT×1, INSERT×1, ALL×1 | P0 qual=true |
| `booking_photos` | SELECT×1, INSERT×1, ALL×1 | P0 qual=true |
| `booking_modifications` | SELECT×1, ALL×1 | P0 qual=true |
| `booking_status_log` | SELECT×2 (anon + auth), INSERT×2, ALL×1 (service_role) | Två paradigm i repo |
| `booking_events` | ALL×1 (service_role) | OK — endast audit |
| `cleaner_service_prices` | ALL×1 (CO) | Admin + Cleaner SELECT saknas |
| `company_service_prices` | **INGA i repo** | Osäkert om RLS alls finns |
| `commission_log` | SELECT×1 (cleaner own), INSERT×1 | OK |
| `commission_levels`, `spark_levels` | SELECT×1 (public) | OK |
| `admin_users` | SELECT×1 (own) + UPDATE×1 (own login) + ALL×1 (service_role) | OK |
| `admin_audit_log` | ALL×1 (service_role only) | Admin-skriv saknas (Del D.1) |
| `admin_roles`, `admin_permissions`, `role_permissions` | SELECT×1 (authenticated, qual=true) | OK |
| `admin_settings`, `support_tickets`, `ticket_notes`, `temp_role_elevations` | ALL×1 (service_role only) | Admin UI kräver EF-proxy |
| `push_subscriptions` | INSERT×1, SELECT×1 (false!), DELETE×1 | Fungerar? False SELECT är udda |
| `subscriptions` | INSERT×2, SELECT×1 (auth true), UPDATE×1 (auth true) | Auth USING(true) på UPDATE är farligt |
| `rut_claims`, `social_posts`, `customers` | Få policies | Kan sakna i prod |
| `cancellations` | **INGA i repo** | Verifiera |
| `coupons`, `coupon_usages` | SELECT×1, ALL×1 | OK |
| `cleaner_referrals`, `referrals`, `gift_cards` | Blandade | P0 gift_cards qual=true |
| `loyalty_points`, `customer_credits` | OK | |
| `notifications`, `messages`, `emails` | Blandade | P0 anon-read på emails |
| `rate_limits`, `email_queue`, `processed_webhook_events` | Service role only | OK |
| `content_queue`, `content_performance` | Service role | OK |
| `platform_settings`, `discounts`, `discount_usage` | Public read / SR manage | OK |
| `waitlist` | Anon insert / admin read | OK |
| `calendar_connections` | User-scoped | OK |
| `analytics_events` | Public insert, SR read, anon insert | Dubblett — Anon insert duplicerar Public insert |
| `jobs` (prod: 37 rader) | **INGA i repo** | Verifiera RLS-status |
| `activity_log` | **INGA i repo** | Admin-cleaner-actions loggas hit? |

---

## Del F: Prioriterad åtgärdslista

### 🔴 P0 — Vecka 1 (DEMO CRITICAL)

1. **Fixa `qual=true` på PII-tabeller** — se Del A.1 (15 tabeller). Ersätt med scoped USING-klausuler.
2. **Dokumentera `hello@spick.se`-policy** från prod → migration-fil (Del G.1 stub)
3. **Dokumentera `Company owner reads team bookings`** från prod → migration (Del G.2 stub)
4. **Definiera `is_admin()`-funktionen** i repo om den finns i prod (Del G.3 stub)
5. **Fixa admin_audit_log** — authenticated admin kan inte skriva (Del G.4 stub)

### 🟡 P1 — Vecka 1-2

6. Lägg till admin SELECT-policies på 5 tabeller (Del D.1) — stängs 401-errors
7. Konsolidera 4 redundanta `Public read availability`-policies till 1
8. Konsolidera 4 redundanta `Public read reviews`-policies till 1
9. Konsolidera 3 redundanta `Public insert bookings`-policies till 1
10. Aktivera RLS på `jobs`, `activity_log` om de saknar det

### 🟢 P2 — Backlog

11. Ersätt alla `Public read` med scoped policies där PII exponeras
12. Utrota legacy-policies från v1-tabeller efter v2-migration (cleaner_availability v1)

---

## Del G: Migration-stubs

Separata filer skapade — fyll i baserat på SQL-resultat. Se [supabase/migrations/stubs/](supabase/migrations/stubs/):
- `20260420_g1_admin_update_cleaners.sql` — admin-update-policy
- `20260420_g2_company_owner_reads_team_bookings.sql` — company-bookings-policy
- `20260420_g3_is_admin_function.sql` — is_admin() stub
- `20260420_g4_admin_audit_log_insert.sql` — audit-log insert-policy
- `20260420_g5_admin_select_missing_tables.sql` — SELECT-policies för 5 tabeller

Stubs har platshållare för `USING`-klausul med kommentarer "FYLL I FRÅN PROD".

---

## 🔵 SQL-queries för Farhad att köra

Kör i [Supabase Studio SQL Editor](https://supabase.com/dashboard/project/urjeijcncsyuletprydy/sql). Klistra tillbaka hela outputen under varje query.

### SQL #1 — Komplett policy-inventarium

```sql
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #2 — Tabeller UTAN RLS aktiverat

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #3 — Hitta `hello@spick.se`-policy på cleaners

```sql
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'cleaners'
ORDER BY cmd, policyname;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #4 — Hitta `Company owner reads team bookings` på bookings

```sql
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY cmd, policyname;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #5 — Verifiera `is_admin()`-funktion

```sql
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'is_admin';
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #6 — qual=true SELECT-policies

```sql
SELECT tablename, policyname, roles
FROM pg_policies
WHERE cmd = 'SELECT'
  AND (qual::text = 'true' OR qual IS NULL)
ORDER BY tablename, policyname;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

### SQL #7 — Admin-kritiska tabeller, policy-täckning

```sql
SELECT
  t.tablename,
  t.rowsecurity,
  COUNT(p.policyname) AS policy_count,
  string_agg(p.policyname || ' [' || p.cmd || ']', ', ' ORDER BY p.cmd) AS policies
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.schemaname = 'public'
  AND t.tablename IN (
    'cleaners', 'companies', 'bookings', 'customer_profiles',
    'cleaner_availability', 'cleaner_availability_v2',
    'cleaner_service_prices', 'company_service_prices',
    'admin_audit_log', 'notifications', 'jobs',
    'self_invoices', 'commission_log', 'activity_log'
  )
GROUP BY t.tablename, t.rowsecurity
ORDER BY t.tablename;
```

**Klistra output här:**
```
[VÄNTAR PÅ FARHAD]
```

---

## Nästa steg när SQL är kört

När du klistrat in SQL #1-7, fyller jag i:
1. **Del C** — exakta odokumenterade policies → färdiga migration-filer (ej bara stubs)
2. **Del D.3** — faktiska tabeller utan RLS
3. **Del E** — uppdaterad per-tabell-matris med prod-sanning
4. **Del F** — skarpa åtgärdsnummer
5. **Executive summary** — slutliga P0/P1/P2-räknare

Rapporten markeras sedan som 🟢 Klar.

---

## Referenser

- [Arkitekturplan v2](docs/planning/spick-arkitekturplan-v2.md) — Fas 0.1
- [view_as-audit](docs/audits/2026-04-19-view-as-impersonate-analys.md) — 401-bekräftelser
- [admin-impersonation-audit](docs/audits/2026-04-19-admin-impersonation-vs-editing.md) — RLS-analys
- [E2E Moment 1](docs/audits/2026-04-19-e2e-moment-1-bokning.md) — bookings-flöde
- [E2E Moment 2](docs/audits/2026-04-19-e2e-moment-2-tilldelning.md) — tilldelning + RLS-beroende

# Paket 1 + Paket 2: Auth-hardening + cleaner_availability v1 RLS

**Datum:** 2026-04-18 sen kväll
**Status:** Empiriskt verifierad mot prod
**Commits:** [5ca40ba](../../) (Paket 1) + post-hoc Paket 2 (denna dokumentation)

---

## Paket 1: Auth-felhantering hardening

### Problem

`_authHeaders()` / `_adminHeaders()` föll tyst tillbaka till `ANON_KEY` när session var utgången. 10+ platser svalde 401/403 tyst (`saveTeamMemberSchedule`, `loadChecklist`, `toggleChecklistItem`, `adminSaveSchedule` v1-block, m.fl.). Användare såg "Schema sparat!" medan DB-skrivningar faktiskt misslyckades.

### Fix i [stadare-dashboard.html](../../stadare-dashboard.html) och [admin.html](../../admin.html)

- `_authHeaders()` / `_adminHeaders()` returnerar nu `{ headers, isAuthenticated }`
- `_authHeadersLegacy()` / `_adminHeadersLegacy()` bevarar backward compat
- R/AR-klienter returnerar `{ status, message }` med `_friendlyAuthMsg`
- Kritiska callers uppgraderade med auth-check + `res.ok` + toast

### Empiriskt verifierat mot prod

- **Test 1 — 0.4a-flöde:** Admin sparar schema för Test Testsson, v1+v2 skrivs korrekt. ✅
- **Test 2 — Team-medlem utan schedule-UI:** By design (UI gömt för employee-role). ✅
- **Test 3 — Utgången session:** `_sessionToken=null` + localStorage-rensning → `"Din session har gått ut"` toast visas, DB-skrivning avvisas. Screenshot-bevisat. ✅

---

## Paket 2: cleaner_availability v1 RLS-skärpning

### Problem

Policy `"Cleaners can manage own availability"` hade `qual=true` till `{public}` för `FOR ALL` — alla inloggade cleaners kunde skriva till alla cleaners availability-rader. Plus två dublett SELECT-policies (`"Anon reads availability"` + `"Auth reads cleaner_availability"`).

### Fix kördes mot prod

1. **DROP** `"Cleaners can manage own availability"` (qual=true ALL, skrivläcka)
2. **DROP** `"Anon reads availability"` (dublett SELECT)
3. **DROP** `"Auth reads cleaner_availability"` (dublett SELECT)
4. **CREATE** `"VD manages team availability"` — FOR ALL TO authenticated, USING company-join via `is_company_owner=true`
5. **CREATE** `"Admin manages all availability"` — FOR ALL TO authenticated, USING `is_admin()`
6. **CREATE** `"Public read cleaner_availability"` — FOR SELECT TO anon, authenticated, USING (true) — konsoliderad läspolicy

Policy `"Cleaner sees own availability"` BEHÅLLS — redan scoped via `cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid())`, täcker cleaner själv.

Post-hoc migration: [`20260418_phase_0_2b_paket_2_cleaner_availability_rls.sql`](../../supabase/migrations/20260418_phase_0_2b_paket_2_cleaner_availability_rls.sql).

### Logiktest (pre-DROP)

Before-state verifierat via SQL mot prod:

- **Rafael Arellano VD** → `"VD manages team availability"` täcker 3 cleaners (sig själv + Daniella + Lizbeth)
- **Zivar Majid VD** → täcker 5 cleaners (sig själv + Dildora + Nilufar + Nasiba + Odilov)
- **Rafaels egen cleaner-row** via `"Cleaner sees own availability"` = 1 rad

Kombinationen "VD-policy + egen-policy" täcker både team-redigering och self-redigering utan gap.

### Empiriskt verifierat mot prod (post-fix)

Admin via AR-klient skriver till Test Testsson schema:
- `PATCH /rest/v1/cleaner_availability` → **204** (`"Admin manages all availability"` släpper igenom via `is_admin()`)
- `DELETE + POST /rest/v1/cleaner_availability_v2` → **204 + 201**
- SQL bekräftar: `day_sun/mon/sat/tue/wed/thu/fri` alla = true efter toggle
- Toast: `"Schema sparat!"`

Paket 1 + Paket 2 tillsammans bevisade att auth-hardening fångar tomma sessions och att de nya RLS-policies släpper igenom rätt rolls skrivningar.

---

## Fynd utanför scope (flaggade)

- **Zivars `status='aktiv'`** kördes av Farhad tidigare under kvällen (utanför plan). `stripe_onboarding_status` fortfarande `'none'`. Hon är osynlig för kunder tills Stripe BankID imorgon. Se [Solid Service-blockerare](2026-04-18-solid-service-onboarding-status-blocker.md).

---

## Paket 3: cleaner_availability_v2 RLS-konsistens (kompletterar Paket 2)

### Problem

v2 hade inga qual=true-skriv-läckor men policies var på `{public}`-roll istället för specifika roller. Plus saknad VD-team-policy för framtida UI som riktar mot v2.

### Fix kördes mot prod

1. **DROP** 4 befintliga policies (kosmetisk omskrivning till rätt roller):
   - `"Admin can manage availability"`
   - `"Authenticated users manage own availability_v2"`
   - `"Service role manages availability_v2"`
   - `"Anon can read availability_v2"`
2. **CREATE** 5 nya policies med matching hierarki till v1:
   - `"Cleaner manages own availability_v2"` (authenticated)
   - `"VD manages team availability_v2"` (authenticated, NY policy)
   - `"Admin manages all availability_v2"` (authenticated)
   - `"Service role manages availability_v2"` (service_role)
   - `"Public read availability_v2"` (anon, authenticated)

Post-hoc migration: [`20260418_phase_0_2b_paket_3_cleaner_availability_v2_rls.sql`](../../supabase/migrations/20260418_phase_0_2b_paket_3_cleaner_availability_v2_rls.sql).

### Empiriskt verifierat mot prod

Admin via `adminSaveSchedule` skriver till Test Testssons v2-rader:
- `DELETE /rest/v1/cleaner_availability_v2` → **204**
- `POST /rest/v1/cleaner_availability_v2` → **201**
- Toast: `"Schema sparat!"`
- v2-rader bytte ID (bekräftas implicit av lyckad DELETE+INSERT)

v1 och v2 har nu samma policy-struktur. När Fas 1 droppar v1 är v2 redo med identiska patterns.

---

## Paket 4: booking_checklists + service_checklists grants + RLS

### Kritiskt fynd

Båda tabellerna saknade grants för `authenticated`/`anon`/`service_role`. Endast `postgres` hade rättigheter. Detta betydde att befintliga RLS-policies **aldrig utvärderades** — `42501 permission denied` triggades på grant-nivå innan RLS ens kördes.

### Symptom i prod

- `booking_checklists` hade **0 rader** sedan tabellen skapades
- Inga checklists har någonsin kunnat skapas från frontend
- Städares checkbox-klick i stadare-dashboard svaldes tyst (före Paket 1)
- Paket 1 gör nu eventuella fel synliga via toast

### Kördes mot prod

1. `GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated` på båda
2. `GRANT ALL TO service_role` på båda
3. `GRANT SELECT TO anon` på `service_checklists` (mallar är publika)
4. **DROP** 3 oanvändbara policies på `booking_checklists` (`"Anon read booking_checklists"`, `"Auth insert booking_checklists"`, `"Auth update booking_checklists"`)
5. **DROP** `"Anon read checklists"` på `service_checklists`
6. **CREATE** 4 policies `booking_checklists`: Cleaner-own (via booking-join), VD-team, Admin, Service role
7. **CREATE** 4 policies `service_checklists`: Public-read, VD-own (via company-id), Admin, Service role

Post-hoc migration: [`20260418_phase_0_2b_paket_4_checklists_grants_and_rls.sql`](../../supabase/migrations/20260418_phase_0_2b_paket_4_checklists_grants_and_rls.sql).

### Empirisk verifiering

Skjuts till naturlig användning — nästa gång Rafa eller Daniella markerar en bokning som klar. Paket 1 (`_friendlyAuthMsg` + auth-guard) gör eventuella fel tydligt synliga via toast snarare än att svälja dem.

### Backlog flaggat

- [`stadare-dashboard.html:8736`](../../stadare-dashboard.html:8736) (`service_checklists`-läsning) använder fortfarande `H` anon-headers utan `res.ok`-check. Fungerar efter Paket 4 (anon har grant på `service_checklists`) men bör uppgraderas till `auth.headers` + `_friendlyAuthMsg` i Paket 5+.
- **Båda tabellerna saknade ursprunglig CREATE TABLE-migration** — odokumenterade prod-artefakter (Regel #27-brott). Paket 8 (slutaudit) ska fånga alla sådana.

---

## Paket 6: Duplicerade policies + OR-true-bakdörr

**Scope:** 6 tabeller med dubletter. Oväntat kritiskt fynd under POST-CHECK.

### Exakta dubletter (behåll 1 per cluster)

- `blocked_times`: 3 `qual=true` SELECT → 1 `"Public read blocked_times — intentional"`
- `booking_slots`: 3 `qual=true` SELECT → 1 `"Public read booking_slots — intentional"`
- `companies`: `"Service role full access on companies"` + `"Owner can read own company"` borttagna (överflödiga)
- `customer_profiles`: `"Owner updates own profile"` UPDATE-dublett borttagen

### `cleaner_applications` SKÄRPNING + OR-true-bakdörr

Tidigare hade `cleaner_applications` tre SELECT-läckor:

1. `"Anyone can read applications"` (`qual=true`) — droppad
2. `"Service role can read all applications"` (misleading-named, `qual=true` till public) — droppad
3. **`"Users can read own application by email"`** — hittades under POST-CHECK

Punkt 3 hade `qual`:

```sql
(email = auth.jwt() ->> 'email')
OR (email = current_setting('request.headers')::json ->> 'x-user-email')
OR true
```

Den sista `OR true` gjorde policyn effektivt `USING(true)` — **alla fyra nya scopade policies jag skapade i Paket 6 var meningslösa förrän denna bakdörr droppades**.

Verifierat via grep-audit att ingen frontend-kod skickar `x-user-email`-header (0 träffar i HTML/JS/TS). Policy droppad. POST-CHECK 3 bekräftar 0 andra `OR true`-mönster i prod-RLS.

Nya policies efter skärpning:

- `"Cleaner reads own application"` — `email = auth.jwt() ->> 'email'`
- `"VD reads team applications"` — `invited_by_company_id` via company-join
- `"Admin reads all applications"` — `is_admin()`
- `"Service role reads applications"` — service_role

Post-hoc migration: [`20260418_phase_0_2b_paket_6_duplicate_consolidation.sql`](../../supabase/migrations/20260418_phase_0_2b_paket_6_duplicate_consolidation.sql).

### `jobs` (0 frontend-konsumenter)

Tidigare: 3 `qual=true` SELECT-policies (Anon/Auth/Cleaner).
Grep-audit bekräftade: tabellen används inte från frontend.
Nu: Admin ALL + Service role ALL + Cleaner SELECT egna.
Flaggad för Fas 1-beslut (deprecate eller integrera).

### Flaggat för senare (utanför Paket 6-scope)

- **`cleaners`-tabellen läcker PII** via [data-dashboard.html:295](../../data-dashboard.html:295) (`select=*` på godkända) och [stadare-profil.html:311](../../stadare-profil.html:311) (full katalog med `home_lat/lng, bio, city`). Kräver kod-fix (safe kolumn-set eller `v_cleaners_public` view) — **hög prioritet**.
- [`rls_fix.sql`](../../rls_fix.sql) finns i repo-rot utanför `supabase/migrations/` — oklar status (körd eller ej mot prod?). Flaggad för Paket 8-audit.
- Andra custom-header-policies (`x-booking-id` i `bookings`, `x-forwarded-for` i `rate_limits`) är troligen legitima men bör auditas i Paket 8.

### Regel #27-lärdom (andra gången denna session)

POST-CHECK räddade oss från tyst regression. Efter 4 DROP + 4 CREATE verkade allt OK tills POST-CHECK 1 visade 5 policies istället för 4. Den 5:e hade varit `OR true`-bakdörr som gjort hela Paket 6 meningslös. **Alltid POST-CHECK efter DROP/CREATE.**

---

## Nästa steg (0.2b forts.)

- **Paket 7:** 3 tabeller utan RLS
- **Paket 8:** Slutaudit inkl [`rls_fix.sql`](../../rls_fix.sql)-utredning + cleaners PII-kolumn-exposure + custom-header-audit

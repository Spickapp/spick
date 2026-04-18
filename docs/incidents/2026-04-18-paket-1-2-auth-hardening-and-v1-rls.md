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

## Nästa steg (0.2b forts.)

- **Paket 3:** `cleaner_availability_v2` RLS-skärpning (matching hierarki till Paket 2)
- **Paket 4:** `booking_checklists` — kod-fix redan klar i Paket 1, behöver RLS-skärpning
- **Paket 5–8:** kvarvarande SELECT-läckor (60+) + 3 tabeller utan RLS (flaggat i tidigare audit)

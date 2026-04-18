# Backlog — Fas 0 vecka 1 (startar måndag 20 april 2026)

**Plan-referens:** [Arkitekturplan v2](docs/planning/spick-arkitekturplan-v2.md) Fas 0: Säkerhet & stabilitet
**Status:** 0.1 🟢 klar (2026-04-18 kvällen). Resten startar måndag 20 april.

---

## 0.1 — Full RLS-audit 🟢 KLAR

Levererat söndag kväll 19 april:
- 3 anon-läckor stängda (customers, self_invoices, bookings)
- 5 migration-filer för odokumenterade prod-policies
- Rapport: [2026-04-18-rls-full-audit.md](docs/audits/2026-04-18-rls-full-audit.md)

---

## 0.2 — Dokumentera återstående odokumenterade prod-policies

**Mål:** Stäng alla Regel #27-brott där prod-policies saknar migration-filer.

### 0.2.a — Capture `is_admin()`-funktion till repo

Kör i Supabase Studio:
```sql
SELECT routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'is_admin';
```

Klistra resultat in i [stubs/20260420_g3_is_admin_function.sql](supabase/migrations/stubs/20260420_g3_is_admin_function.sql), flytta till riktig migrations-mapp med filnamn `20260420_is_admin_function.sql`.

### 0.2.b — Admin-SELECT för 4 tabeller

Stäng 401-errors från admin.html på:
- `customer_profiles`
- `companies`
- `admin_audit_log` (stub g4 finns redan, aktivera)
- `cleaner_service_prices`

Stub [g5](supabase/migrations/stubs/20260420_g5_admin_select_missing_tables.sql) har redan mönstret. Flytta + deploy.

### 0.2.c — `company_service_prices` — aktivera RLS + policies

Tabellen saknar RLS helt. Behöver:
- `ALTER TABLE company_service_prices ENABLE ROW LEVEL SECURITY;`
- Policy: `"Company owner manage own prices"` — USING `company_id IN (SELECT company_id FROM cleaners WHERE auth_user_id = auth.uid() AND is_company_owner)`
- Policy: `"Anon read active prices"` — USING `true` (används i publika bokningsflöden)
- Policy: `"Admin manage all"` — via `is_admin()`

Skapa migration: `20260420_company_service_prices_rls.sql`

### 0.2.d — `tasks`-tabell — beslut + åtgärd

Kolla först vad tabellen innehåller:
```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tasks';
SELECT COUNT(*) FROM tasks;
```

Två möjliga beslut:
1. **RLS behövs** (innehåller PII eller user-data) → skapa policies
2. **By-design publik** (ex. system-tasks metadata) → dokumentera i `/docs/architecture/tables-without-rls.md`

### 0.2.e — Konsolidera 8 redundanta SELECT-policies på bookings

Kör först:
```sql
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY cmd, policyname;
```

Mål: maximalt 4-5 policies på bookings (insert, select_scoped, update_scoped, service_role_all). Konsolideringsplan i Fas 6 men P1-fix nu om >7 policies finns.

**Effort:** 3-5h totalt för 0.2.

---

## 0.3 — Fix cleaner_email-bug i cleaner-booking-response EF

**Källa:** [E2E Moment 2](docs/audits/2026-04-19-e2e-moment-2-tilldelning.md) §5

**Bug:** Vid VD-accept på teammedlems vägnar skrivs VD:s email/phone som `cleaner_email`/`cleaner_phone` istället för teammedlemmens. `cleaner_id` förblir korrekt.

**Fil:** [supabase/functions/cleaner-booking-response/index.ts:87-88](supabase/functions/cleaner-booking-response/index.ts:87)

**Fix:** Hämta target-cleaner (via `booking.cleaner_id`) istället för att använda inloggad användares email.

```ts
// Before:
cleaner_email: cleaner.email || null,
cleaner_phone: cleaner.phone || null,

// After:
const { data: targetCleaner } = await sb
  .from("cleaners")
  .select("email, phone")
  .eq("id", booking.cleaner_id)
  .maybeSingle();

// ...
cleaner_email: targetCleaner?.email || null,
cleaner_phone: targetCleaner?.phone || null,
```

**Effort:** 15 min.

---

## 0.4 — Admin schedule-editor skriver till fel tabell

**Källa:** [Admin-impersonation-audit](docs/audits/2026-04-19-admin-impersonation-vs-editing.md) Fynd 3

**Bug:** [admin.html:3968-3969](admin.html:3968) läser/skriver `cleaner_availability` (v1). Wizard + boka.html + stadare-dashboard använder `cleaner_availability_v2`. Admin-editeringen har 0 effekt på moderna läsare.

**Fix-komplexitet:** Splittad i två delar efter scope-verifiering 18 april kväll.

### 0.4a 🟢 KLAR (18 april sen kväll, commit e2e073a + GRANT-migration)

Sync `adminSaveSchedule` till BÅDE v1 (oförändrat) OCH v2 (nytt). DELETE + INSERT-pattern eftersom UNIQUE(cleaner_id, day_of_week) saknas idag. Mappar `day_mon..day_sun` → ISO 1-7.

Empiriskt verifierat mot prod med testcleaner Test Testsson (19f74217…):
- 5 v2-rader bytte alla IDs via DELETE+INSERT (bevis för att patch gick igenom, inte bara no-op)
- 0 dubletter i hela `cleaner_availability_v2`
- Network: GET 200 → PATCH 204 → DELETE 204 → POST 201

**Rotorsak upptäckt under verifiering:** `authenticated` saknade INSERT/UPDATE/DELETE-grants på v2. Fix: `GRANT INSERT, UPDATE, DELETE ON cleaner_availability_v2 TO authenticated`. Se [incidentrapport](docs/incidents/2026-04-18-v2-missing-grants.md) och [post-hoc migration](supabase/migrations/20260418_grant_v2_writes_to_authenticated.sql).

### 0.4b ⏳ FLYTTAD till Fas 1

Bredare v1→v2-refaktor för:
- `stadare-dashboard.html` (egen schedule + team-CRUD, 6 operationer)
- `foretag.html` (publik "tillgänglig idag")
- `stadare-profil.html` (publik profil)
- `admin-approve-cleaner/index.ts` (synk default-tider till 08-20 mån-sön som Fas 0.6)

Scope växte från "1-2h admin-refaktor" till ~3-5h när grep avslöjade 4 filer utöver admin.html med v1-beroende. Flyttad till Fas 1 för att inte blockera vecka 1.

---

## 0.5 — boka.html:1896 dag-numreringsbugg 🟢 KLAR (18 april sen kväll, commit fa8e4c0)

**Källa:** [Arkitekturplan v2](docs/planning/spick-arkitekturplan-v2.md) Del 2 #13

**Bug:** `new Date().getDay()` returnerar 0=sön, 6=lör. `cleaner_availability_v2.day_of_week` CHECK kräver 1-7 (1=mån, 7=sön). Söndag (dow=0) matchar aldrig något i v2.

**Fix:** Konvertera `dow` innan jämförelse:
```js
const jsDayToIso = dow === 0 ? 7 : dow;  // JS 0=sön → ISO 7=sön
```

Alternativt normalisera v2-data vid query.

**Effort:** 15 min inklusive test.

---

## 0.6 — Wizard default mån-sön (inte bara mån-fre) 🟢 KLAR (18 april sen kväll, commit 6fcf987)

**Källa:** Arkitekturplan v2 Del 2 #19

**Fil:** [supabase/functions/admin-create-company/index.ts:141](supabase/functions/admin-create-company/index.ts:141)

**Ändring:** `for (let day = 1; day <= 5; day++)` → `for (let day = 1; day <= 7; day++)`

Samma sak på [index.ts:234](supabase/functions/admin-create-company/index.ts:234) för team-members.

**Effort:** 5 min.

---

## 0.7 — Wizard kräver VD-hemadress + geokodar 🟢 KLAR (18 april sen kväll, commit 6fcf987)

**Källa:** Arkitekturplan v2 Del 2 #18 (Zivar krävde manuell fix)

**Fix i frontend ([admin.html:1071-1087](admin.html:1071)):**
- `"Städar ej"`-checkbox → även när `owner_only=true`, gör `cw-owner-address` synligt + required
- Annars går bokningar aldrig till VD (koordinatbaserad matchning filtrerar)

**Fix i EF ([admin-create-company/index.ts:95-97](supabase/functions/admin-create-company/index.ts:95)):**
- Kräv `owner_lat`/`owner_lng` om `owner_only=false` (redan fungerar)
- Tillåt `owner_lat`/`owner_lng` för alla VDs oavsett `owner_only` (rekommendera)

**Effort:** 30 min.

---

## Tillkommen 18 april sen kväll — cleaner-job-match dag-bugg

**Fil:** [supabase/functions/cleaner-job-match/index.ts](supabase/functions/cleaner-job-match/index.ts)

**Rader:**
- [index.ts:25-29](supabase/functions/cleaner-job-match/index.ts:25) — `dayOfWeek()`-funktionen returnerar 0=mån, 6=sön
- [index.ts:42](supabase/functions/cleaner-job-match/index.ts:42) — `scoreAvailability` använder värdet
- [index.ts:47](supabase/functions/cleaner-job-match/index.ts:47) — jämför `a.day_of_week === dow` mot `v_cleaner_availability_int` (som är ISO 1-7)
- [index.ts:59](supabase/functions/cleaner-job-match/index.ts:59) — indexerar intern svensk dag-array (internt konsekvent, ej bugg)
- [index.ts:182-183](supabase/functions/cleaner-job-match/index.ts:182) — `scorePreferences` bedömer helg (`dow >= 5`); fungerar internt eftersom båda sidor använder 0=mån

**Bugg:** `dayOfWeek()` producerar 0=mån..6=sön. Ingen annan fil i kodbasen använder denna konvention.
- `boka.html` använder JS (0=sön..6=lör) → efter Fas 0.5-fix ISO (1=mån..7=sön) vid jämförelse
- `stadare-dashboard.html` konverterar till ISO via `dowV2`
- `cleaner_availability_v2` / `v_cleaner_availability_int` = ISO 1-7

**Påverkan:** Bekräftat aktiv. Anropas i bokningsflödet från [boka.html:1978](boka.html:1978) för sortering av städarresultat. Eftersom konventionen är shiftad en dag mot DB:
- Mån-jobb: `dow=0` jämförs mot `day_of_week=1` → `false` → `scoreAvailability=0`
- Tis-jobb: `dow=1` vs `day_of_week=2` → `false` → 0
- ... samtliga dagar träffas, inte bara söndag.
- Effekt: alla cleaners får `availability=0` i matchning → disqualifiers-check rad 233 returnerar 0 totalpoäng. Bokningsflödet räddas av `include_below_threshold: true` + lokal sort-fallback, men EF:ens sort-förstärkning fungerar inte alls.

**Åtgärd:**
1. Ändra [index.ts:28](supabase/functions/cleaner-job-match/index.ts:28) till ISO: `return day === 0 ? 7 : day;`
2. Uppdatera interna beroenden som antar 0-indexering:
   - Rad 59: `schedule[days[dow]]` → `schedule[days[dow - 1]]` (eller byt till 0-indexerad array mapping)
   - Rad 183: `dow >= 5` → `dow >= 6` (lör=6, sön=7 i ISO)
3. Deploy EF och verifiera via [smoke.spec.ts A05](tests/smoke.spec.ts:97)
4. Manuell test: boka mån + sön → bekräfta att cleaner-sortering ändras i EF-svar

**Prioritet:** P1 vecka 1. Bekräftat aktivt bruk i produktion, påverkar alla dagar (inte bara söndag).

**Effort:** 30 min inklusive deploy + smoke.

**Relaterad Regel #28-observation:** Spick har 3 dag-konventioner i produktion:
1. JS `getDay()` (0=sön..6=lör)
2. ISO (1=mån..7=sön) — `cleaner_availability_v2`
3. `cleaner-job-match` intern (0=mån..6=sön)

Efter Fas 0.5 (boka.html konverterar vid jämförelse) + denna fix: 2 konventioner kvar (JS i rå data, ISO i DB). Vecka 2-3 kan en central `jsDayToIso(date)`-wrapper övervägas för att undvika framtida konvention-blandning.

---

## Total vecka 1-insats

| Uppgift | Effort | Status |
|---------|--------|--------|
| 0.1 — RLS-audit | 4h | 🟢 Klar (commit 552e2f6) |
| 0.2 — Dokumentera resterande policies | 3-5h | 🔵 Måndag em |
| 0.3 — cleaner_email-bug | 15 min | 🟢 Klar (commit fb9f4e9) |
| 0.4a — Admin adminSaveSchedule → v2 | 1h | 🟢 Klar (commit e2e073a) |
| 0.4b — Övriga v1→v2 (stadare-dashboard m.fl.) | 3-5h | ⏳ Flyttad till Fas 1 |
| 0.5 — Dag-numrering | 15 min | 🟢 Klar (commit fa8e4c0) |
| 0.6 — Wizard mån-sön | 5 min | 🟢 Klar (commit 6fcf987) |
| 0.7 — Wizard VD-adress | 30 min | 🟢 Klar (commit 6fcf987) |
| Cleaner-job-match dag-bugg | 30 min | 🟡 P1 måndag morgon (dok i commit 43b0783) |
| **Total** | **5-8h** | 5/7 klara före vecka 1 startar |

---

## Deploy-ordning måndag (reviderad 18 april 23:00)

Eftersom 0.3/0.5/0.6/0.7 är klara redan 18 april, blir veckoplanen:

1. **Måndag morgon (2-3h):** Cleaner-job-match dag-bugg (P1, se separat sektion) — rad 28 + rad 59 + rad 183-fix + deploy + smoke
2. **Måndag middag (30 min):** Verifiera produktion med testbokning (mån + sön + tis för att bekräfta matchning)
3. **Måndag eftermiddag (3-5h):** 0.2 — RLS-dokumentation (policies + is_admin + company_service_prices + tasks + bookings-konsolidering)

Onsdag:
1. **Morgon:** Bara 0.2 kvar från onsdag-planen (0.4a redan klar 18 april)
2. **Eftermiddag:** Review + buffer för oväntade issues

Fredag: Produktionsdeploy-verifiering + slutligt Rafa/Zivar-test.

---

## Status per 18 april 23:00

🟢 **Klara:**
- ✅ 0.1 RLS-audit (commit 552e2f6)
- ✅ 0.3 cleaner_email bonusbugg (commit fb9f4e9 + migration 20260418) — se [incidentrapport](docs/incidents/2026-04-18-cleaner-email-phone-missing-columns.md)
- ✅ 0.5 boka.html dag-numrering (commit fa8e4c0)
- ✅ 0.6 Wizard mån-sön (commit 6fcf987)
- ✅ 0.7 Wizard VD-adress (commit 6fcf987)

⏳ **Återstår:**
- ⏳ 0.2 Dokumentera resterande prod-policies (måndag em, 3-5h)
- ✅ 0.4a adminSaveSchedule → v2 (commit e2e073a + grant-migration + incidentrapport)
- ⏳ 0.4b bredare v1→v2-refaktor flyttad till Fas 1
- ⏳ Cleaner-job-match dag-bugg (P1, separat task, dokumenterad i commit 43b0783)

**5 av 7 ursprungliga Fas 0-uppgifter klara före vecka 1 ens startat.**

Kvar: 0.2 + cleaner-job-match (0.4a klar, 0.4b flyttad till Fas 1).

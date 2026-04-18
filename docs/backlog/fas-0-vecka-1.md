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

**Bug:** [admin.html:3968-3969](admin.html:3968) läser/skriver `cleaner_availability` (v1). Wizard + boka.html + stadare-dashboard använder `cleaner_availability_v2`. Admin-editeringen har 0 effekt.

**Fix-komplexitet:** Ej trivial. Strukturen skiljer:
- v1: 1 rad per cleaner med `day_mon`/`day_tue`/...-booleans
- v2: 1-N rader per cleaner med `day_of_week smallint`

Se [nytt-jobb-matchar-bugg.md](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md) och min tidigare STOPP-rapport för struktur-skillnader.

**Effort:** 1-2h. Kräver UI-omskrivning av `adminEditSchedule` + `adminSaveSchedule`.

---

## 0.5 — boka.html:1896 dag-numreringsbugg

**Källa:** [Arkitekturplan v2](docs/planning/spick-arkitekturplan-v2.md) Del 2 #13

**Bug:** `new Date().getDay()` returnerar 0=sön, 6=lör. `cleaner_availability_v2.day_of_week` CHECK kräver 1-7 (1=mån, 7=sön). Söndag (dow=0) matchar aldrig något i v2.

**Fix:** Konvertera `dow` innan jämförelse:
```js
const jsDayToIso = dow === 0 ? 7 : dow;  // JS 0=sön → ISO 7=sön
```

Alternativt normalisera v2-data vid query.

**Effort:** 15 min inklusive test.

---

## 0.6 — Wizard default mån-sön (inte bara mån-fre)

**Källa:** Arkitekturplan v2 Del 2 #19

**Fil:** [supabase/functions/admin-create-company/index.ts:141](supabase/functions/admin-create-company/index.ts:141)

**Ändring:** `for (let day = 1; day <= 5; day++)` → `for (let day = 1; day <= 7; day++)`

Samma sak på [index.ts:234](supabase/functions/admin-create-company/index.ts:234) för team-members.

**Effort:** 5 min.

---

## 0.7 — Wizard kräver VD-hemadress + geokodar

**Källa:** Arkitekturplan v2 Del 2 #18 (Zivar krävde manuell fix)

**Fix i frontend ([admin.html:1071-1087](admin.html:1071)):**
- `"Städar ej"`-checkbox → även när `owner_only=true`, gör `cw-owner-address` synligt + required
- Annars går bokningar aldrig till VD (koordinatbaserad matchning filtrerar)

**Fix i EF ([admin-create-company/index.ts:95-97](supabase/functions/admin-create-company/index.ts:95)):**
- Kräv `owner_lat`/`owner_lng` om `owner_only=false` (redan fungerar)
- Tillåt `owner_lat`/`owner_lng` för alla VDs oavsett `owner_only` (rekommendera)

**Effort:** 30 min.

---

## Total vecka 1-insats

| Uppgift | Effort | Status |
|---------|--------|--------|
| 0.1 — RLS-audit | 4h | 🟢 Klar |
| 0.2 — Dokumentera resterande policies | 3-5h | 🔵 Måndag |
| 0.3 — cleaner_email-bug | 15 min | 🔵 Måndag |
| 0.4 — Admin schedule v1→v2 | 1-2h | 🔵 Onsdag |
| 0.5 — Dag-numrering | 15 min | 🔵 Måndag |
| 0.6 — Wizard mån-sön | 5 min | 🔵 Måndag |
| 0.7 — Wizard VD-adress | 30 min | 🔵 Onsdag |
| **Total** | **5-8h** | Matchar arkitekturplanens vecka 1-budget |

---

## Deploy-ordning måndag

1. **Morgon (1h):** 0.5 + 0.6 + 0.3 — små fixes + deploy
2. **Middag (30 min):** Verifiera produktion med testbokning
3. **Eftermiddag (2-3h):** 0.2 — RLS-dokumentation

Onsdag:
1. **Morgon (1-2h):** 0.4 — Admin schedule-refaktor
2. **Eftermiddag (30 min):** 0.7 — Wizard VD-adress
3. **Kväll:** Review + buffer

Fredag: Produktionsdeploy + verifiera med Rafa/Zivar.

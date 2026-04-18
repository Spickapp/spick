# Stängda anon-skrivläckor — Fas 0.2a

**Datum:** 2026-04-18 sen kväll
**Status:** Stängda i prod via SQL + dokumenterade post-hoc
**Migration:** [`supabase/migrations/20260418_close_anon_write_leaks_phase_0_2a.sql`](../../supabase/migrations/20260418_close_anon_write_leaks_phase_0_2a.sql)

---

## Sammanfattning

Fyra policies med `qual=true` till `{public}` tillät anon-skrivningar till kritiska prod-tabeller. Upptäcktes under Fas 0.2-audit. Stängdes omedelbart utan regressionsrisk — frontend-grep bekräftade att inga anon-skrivningar faktiskt sker mot dessa tabeller idag. Ersatta med VD-skopade policies (via `cleaners.auth_user_id`-lookup) + admin-policies via `is_admin()` + service role där applicable.

---

## Stängda policies

1. `company_service_prices` — "Anyone can update company prices" (UPDATE)
2. `company_service_prices` — "Anyone can delete company prices" (DELETE)
3. `companies` — "Allow update companies" (UPDATE)
4. `booking_slots` — "System can update slots" (UPDATE)

Alla hade `USING (true)` utan roll-begränsning, vilket gjorde att anon-roll med giltig anon-JWT kunde utföra operationerna utan auth-kontroll.

---

## Ersättande policies (live)

### `company_service_prices`
- `"VD manages own company prices"` — FOR ALL TO authenticated, USING `company_id IN (SELECT company_id FROM cleaners WHERE auth_user_id = auth.uid() AND is_company_owner = true)`
- `"Admin manages all company prices"` — FOR ALL TO authenticated, USING `is_admin()`

### `companies`
- `"VD updates own company"` — FOR UPDATE TO authenticated, USING `id IN (SELECT company_id FROM cleaners WHERE auth_user_id = auth.uid() AND is_company_owner = true)`
- `"Admin updates all companies"` — FOR UPDATE TO authenticated, USING `is_admin()`

### `booking_slots`
- `"Service role manages booking_slots"` — FOR ALL TO service_role, USING (true)
- `"Admin manages booking_slots"` — FOR ALL TO authenticated, USING `is_admin()`

---

## Bevisad säkerhet

### Frontend grep-audit (2026-04-18 kväll)

Kartläggning av skriv-anrop till de fyra tabellerna. Inga anon-header-skrivningar hittades:

- `company_service_prices`:
  - [stadare-dashboard.html:8969](../../stadare-dashboard.html:8969) DELETE → `_authHeaders()` ✅
  - [stadare-dashboard.html:8976](../../stadare-dashboard.html:8976) POST upsert → `_authHeaders()` ✅
  - `fix-company-prices.js` (legacy engångs-script, inte aktivt) → `_authHeaders()` ✅
- `companies`:
  - [stadare-dashboard.html:9508](../../stadare-dashboard.html:9508) PATCH → `R.update` (auth JWT) ✅
  - `fix-pricing-model.js` (legacy, inte aktivt) → auth ✅
  - `fix-rating-toggle.js` (legacy, inte aktivt) → använde anon men används inte i prod ⚠
- `booking_slots`:
  - Endast SELECT från frontend, alla skrivningar via EF med service role ✅

### Data-audit

- Inga suspekta/oväntade rader i `company_service_prices`
- Inga oväntade rader i `cleaner_availability` v1 (granskat separat under samma audit)

### Post-check SQL

- Alla fyra ursprungliga policies borta ur `pg_policies`
- Alla ersättande policies verifierade med rätt roll (`authenticated` / `service_role`) och rätt `qual`-uttryck

---

## Biproduktsfynd flaggade för Fas 0.2b / Fas 1-6

- **60+ SELECT-läckor till `{public}` med `qual=true`** — separat läs-audit i 0.2b
- **Duplicerade policies** på `booking_slots`, `companies`, `company_service_prices` — konsolidering i Fas 1/6
- **`cleaner_availability` v1 "Cleaners can manage own availability"** med `qual=true FOR ALL` — kräver kod-fix först (Rafael + stadare-dashboard använder den aktivt, regression skulle bryta deras schema-redigering)
- **`booking_checklists`** — [stadare-dashboard.html:8717](../../stadare-dashboard.html:8717) och [:8784](../../stadare-dashboard.html:8784) skickar med anon-headers (`H`) trots att användaren är inloggad. Bör ändras till `_authHeaders()` innan RLS stängs.

---

## Regler efterlevda

- **Regel #26:** Varje fynd bekräftat mot primärkälla (SQL mot `pg_policies` + grep mot faktisk källkod)
- **Regel #27:** Ingen policy stängd utan att frontend-skrivningar först kartlagts — regressionsrisk validerad före DROP
- **Regel #28:** Ingen ny fragmentering — ersättande policies följer etablerat VD/Admin-mönster (samma `auth_user_id IN (...)`-pattern som finns i `20260418_company_owner_reads_team_bookings.sql` och `20260402000001_fix_rls_security.sql`)

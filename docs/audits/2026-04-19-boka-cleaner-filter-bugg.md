# boka.html cleaner-filter-bugg — 2026-04-19

**Symptom:** `find_nearby_cleaners(59.3430, 18.0473)` returnerar 4 cleaners (Farhad, Farhad, Zivar Solid Service, Rafael Rafa). Endast 1 visas på boka.html.
**Miljö:** Inkognito, ingen console-error.
**Metod:** Regel #26 — alla påståenden citerar fil:rad.

---

## TL;DR — Orsak identifierad

**Rotorsak: [boka.html:1937-1946](boka.html) — "Payment readiness"-filter kräver `status='aktiv'` + Stripe-complete på företagets VD.**

Zivar och Rafael filtreras ut för ATT **deras företags VD saknar `stripe_onboarding_status='complete'`**. Detta är **BY DESIGN** ("kan inte boka cleaner som inte kan ta emot betalning") men **tyst** — ingen UI-indikator eller log.

Sekundär risk: [boka.html:1891-1897](boka.html) — availability-filter mot `cleaner_availability_v2.day_of_week`. Wizard skapar bara mån-fre (dag 1-5) [admin-create-company/index.ts:141](supabase/functions/admin-create-company/index.ts). Testar du mot helg (dag 0 eller 6) filtreras wizard-cleaners bort.

---

## RPC:ns output — vad har frontend att jobba med

[sql/fix-find-nearby-for-teams.sql:14-34](sql/fix-find-nearby-for-teams.sql) — RETURNS TABLE:

```
id, full_name, first_name, last_name, bio, hourly_rate,
profile_image_url, avatar_url, avg_rating, total_reviews,
review_count, services, city, identity_verified,
home_lat, home_lng, pet_pref, elevator_pref, distance_km
```

**Kritiskt: RPC returnerar INTE `owner_only`, `company_id`, `is_company_owner`, `stripe_onboarding_status`, `status`.**

RPC:s interna filter ([fix-find-nearby-for-teams.sql:61-70](sql/fix-find-nearby-for-teams.sql)):
- `is_approved = true`
- `is_active = true OR company_id IS NOT NULL`
- `status = 'aktiv'`
- `home_lat IS NOT NULL AND home_lng IS NOT NULL`
- Inom `service_radius_km`

Så om RPC returnerar 4 → alla 4 har redan `status='aktiv'` och koordinater. **Filter i frontend bör därför bara vara en duplikatkontroll.**

---

## Alla filter efter RPC-anropet — i ordning

RPC anropas på [boka.html:1853-1860](boka.html). Resultatet går igenom **7 filter** innan `renderCleaners()` på [boka.html:2101](boka.html):

### Filter 1 — Service-match
[boka.html:1873-1890](boka.html)
```js
cleaners.filter(c => {
  let svcs = Array.isArray(c.services) ? c.services.map(s => (s||'').toLowerCase()) : [];
  if (svcs.length === 0) return true;
  if (svcLow === 'hemstädning') return svcs.some(s => s.includes('hem') || s.includes('städning'));
  // ...
});
```
**Risk:** Om Zivar/Rafaels `services`-array saknar 'hem' eller 'städning' (exakt matchning på underträng), filtreras de.
**Trolighet:** Låg — wizard sätter `services` från `activeSvcs` [admin-create-company/index.ts:104-105](supabase/functions/admin-create-company/index.ts).

### Filter 2 — Availability per veckodag ⚠️ SEKUNDÄR RISK
[boka.html:1891-1897](boka.html)
```js
const dayAvail = state.availability.filter(a => a.day_of_week === dow && a.cleaner_id).map(a => a.cleaner_id);
if (dayAvail.length > 0) {
  cleaners = cleaners.filter(c => dayAvail.includes(c.id));
}
```
**Risk:** Wizard skapar bara mån-fre (1-5) [admin-create-company/index.ts:141 `for (let day = 1; day <= 5; day++)`](supabase/functions/admin-create-company/index.ts). Om kund testar på lördag (6) eller söndag (0), **alla wizard-cleaners filtreras**.
**Trolighet:** Medel — beror på testdatum.

### Filter 3 — Blockerade datum
[boka.html:1898-1900](boka.html)
```js
const blockedToday = state.blocked.filter(b => b.blocked_date === state.date).map(b => b.cleaner_id);
cleaners = cleaners.filter(c => !blockedToday.includes(c.id));
```
**Risk:** Om Zivar/Rafael har `blocked` för testdatumet. Wizard skapar inga blockeringar.
**Trolighet:** Mycket låg.

### Filter 4 — Upptagna (dubbelbokning)
[boka.html:1901-1910](boka.html)
```js
const takenNow = state.bookings.filter(b => tidsöverlapp).map(b => b.cleaner_id);
cleaners = cleaners.filter(c => !takenNow.includes(c.id));
```
**Risk:** Om Zivar/Rafael redan har bokning på testtiden.
**Trolighet:** Mycket låg för nyskapade test-cleaners.

### Filter 5 — owner_only
[boka.html:1911-1916](boka.html)
```js
if (preCompanyId) {
  cleaners = cleaners.filter(c => c.company_id === preCompanyId && !c.owner_only);
} else {
  cleaners = cleaners.filter(c => !c.owner_only);
}
```
**⚠️ Tekniskt ineffektivt men inte rotorsaken:** Eftersom RPC inte returnerar `owner_only` är `c.owner_only === undefined`, `!undefined === true`, **alla passerar**. MEN: om `preCompanyId` är satt kräver filtret `c.company_id === preCompanyId` — och `company_id` returneras också inte av RPC → alla filtreras! Okänt om `preCompanyId` är satt i detta fall.

### Filter 6 — Payment readiness ⚠️ **PRIMÄR ROTORSAK**
[boka.html:1917-1951](boka.html)

Steg A — fetch extra data:
```js
var payRes = await fetch(SUPA + '/rest/v1/cleaners?select=id,company_id,is_company_owner,stripe_onboarding_status,status&id=in.(' + cleanerIds + ')', {headers: H});
```

Steg B — bygg `payableCompanies` ([boka.html:1925-1930](boka.html)):
```js
var payableCompanies = {};
payData.forEach(function(c) {
  if (c.is_company_owner && c.stripe_onboarding_status === 'complete') {
    payableCompanies[c.company_id] = true;
  }
});
```

Steg C — filtrera ([boka.html:1937-1946](boka.html)):
```js
cleaners = cleaners.filter(function(c) {
  var info = statusMap[c.id];
  if (!info) return false;                                        // [1]
  if (info.status !== 'aktiv') return false;                      // [2]
  if (info.company_id) return !!payableCompanies[info.company_id]; // [3]
  return info.stripe_onboarding_status === 'complete';            // [4]
});
```

**Varför Zivar + Rafael filtreras:**
- [1] `info` finns (anon-RLS tillåter select) ✅
- [2] `status === 'aktiv'` — RPC kräver redan detta, bör passera ✅
- [3] Zivar har `company_id` = Solid Service. Passerar bara om `payableCompanies[solid_service_id] === true`, dvs om **någon VD i Solid Service har `stripe_onboarding_status='complete'`**. Om Zivar är VD och hans Stripe inte är klar → filter returnerar `false`. **EXKLUDERAD.**
- [3] Rafael har `company_id` = Rafa Allservice. Samma logik — om Rafaels Stripe inte är 'complete' → filter returnerar `false`. **EXKLUDERAD.**
- [4] Farhad (solo, inget `company_id`) — passerar om hans egen Stripe är 'complete'.

**Matchar fynd från tidigare audit:** [docs/audits/2026-04-19-google-places-audit.md](docs/audits/2026-04-19-google-places-audit.md) + [docs/prep/2026-04-19-solid-service-demo-funktioner.md](docs/prep/2026-04-19-solid-service-demo-funktioner.md) noterade att **Stripe Connect onboarding aldrig triggas från admin** — cleaner måste själv gå till sin dashboard och starta. Zivar + Rafael har aldrig loggat in och startat → deras Stripe är **inte** `complete`.

### Filter 7 — Husdjur
[boka.html:1952-1955](boka.html)
```js
if (state.hasPets) {
  cleaners = cleaners.filter(c => c.pet_pref !== 'no');
}
```
**Risk:** Låg.

---

## Varför "Farhad Haghighi Sundbyberg" passerar

Tre möjligheter (kan inte verifieras utan DB-tillgång):

1. **Solo-Farhad:** Inget `company_id` → träffas av branch [4], hans egen `stripe_onboarding_status === 'complete'`.
2. **VD-Farhad:** `is_company_owner=true` OCH `stripe_onboarding_status='complete'` → han sätter `payableCompanies[hans_company]=true` → branch [3] passerar.
3. **Test-data:** Manuellt satt `stripe_onboarding_status='complete'` direkt i DB.

Eftersom admin hade 2 Farhads i RPC och 1 visas: den som filtreras bort har **inte** Stripe-complete.

---

## Bug eller by design?

**By design — men med tre UX-brister:**

1. **Tyst filter:** [boka.html:1948-1951](boka.html) — catch-blocket loggar `console.warn` men visar inget till användaren. Om `payRes` crashar, visas ALLA cleaners (graceful degradation). Om den lyckas + filtrerar, inget feedback.

2. **Ingen admin-signal:** Admin.html visar Stripe-status som kolumn ([admin.html:3538](admin.html), [3628](admin.html)) men det finns ingen varning "denna cleaner filtreras bort på boka.html" när Farhad tittar på listan.

3. **Duplikat Stripe-kontroll:** Samma cleaner laddas först via RPC (som redan kräver `status='aktiv'`), sedan laddas igen via `/rest/v1/cleaners` för Stripe-check. Kan slås ihop till en EF eller utökad VIEW.

**Det är inte en bugg i den meningen att filtret gör vad det ska.** Men det är en **förväntansbugg**: Farhad förväntade att 4 cleaners skulle visas eftersom RPC returnerar 4, och filtret är osynligt.

---

## Åtgärder (prio)

| # | Åtgärd | Effort | Effekt |
|---|--------|--------|--------|
| 1 | Slå på Stripe Connect för Zivar + Rafael (låt dem logga in på dashboard + onboarda) | 15 min per VD | Löser symtomet omedelbart |
| 2 | Visa "X cleaners undanhölls p.g.a. saknad Stripe" under listan om `payRes` filtrerar bort | 30 min | UX-transparens |
| 3 | Lägg till `owner_only`, `company_id`, `is_company_owner`, `stripe_onboarding_status` i `find_nearby_cleaners` RETURNS TABLE så vi slipper andra fetch:en | 1h + migration | Regel #28: mindre fragmentering |
| 4 | Lägg till admin-varning på cleaner-kort: "⚠️ Denna cleaner visas inte på boka.html pga saknad Stripe" | 30 min | Farhad upptäcker problemet innan kund |
| 5 | Inkludera helg-dagar (6, 0) i wizard-default availability om företaget ska kunna ta helgjobb | 5 min | Wizard-fullfjädrad |

---

## Filkoord (snabbreferens)

- [boka.html:1853-1860](boka.html) — RPC-anrop
- [boka.html:1873-1890](boka.html) — Filter 1 (service)
- [boka.html:1891-1897](boka.html) — Filter 2 (availability)
- [boka.html:1898-1900](boka.html) — Filter 3 (blocked)
- [boka.html:1901-1910](boka.html) — Filter 4 (taken)
- [boka.html:1911-1916](boka.html) — Filter 5 (owner_only)
- [boka.html:1917-1951](boka.html) — Filter 6 (payment) **← rotorsak**
- [boka.html:1952-1955](boka.html) — Filter 7 (pets)
- [boka.html:2101](boka.html) — renderCleaners
- [sql/fix-find-nearby-for-teams.sql:10-72](sql/fix-find-nearby-for-teams.sql) — RPC-definition
- [supabase/functions/admin-create-company/index.ts:141, 234](supabase/functions/admin-create-company/index.ts) — availability mån-fre only

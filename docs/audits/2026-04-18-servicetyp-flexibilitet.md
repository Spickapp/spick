# Servicetyp-flexibilitet — audit 2026-04-18

**Kontext:** Rafael (VD Rafa Allservice) önskar tillägg av Premiumstädning (35 kr/kvm), Mattrengöring (tidsbegränsad), och offertbaserad prissättning.
**Metod:** Regel #26 + #27 — grep + fil:rad-citat. Ingen SQL mot prod körd i denna audit (flaggas där det krävs).

---

## TL;DR

1. **Service-listan är hårdkodad på minst 2 divergerande ställen** + **RUT-listan på 4 ställen** — varje ny tjänst kräver kod-ändring i 5-8 filer. Detta är **teknisk skuld, blocker för företagsskala**.
2. **Offertbaserad prissättning finns INTE** — `price_type` stödjer bara `hourly` / `per_sqm` (+ `per_window` i admin-UI men ej i pricing-resolver). Ingen `quote`-typ existerar.
3. **Tillgänglighetsbegränsning per tjänst finns INTE** — `cleaner_availability` gäller per-cleaner, inte per-service. "Mattrengöring endast helger" kräver schema-ändring.

---

## FAS 1 — service_type-inventering

### Hårdkodade listor (2 divergerar redan)

| Plats | Antal | Tjänster |
|-------|-------|----------|
| [stadare-dashboard.html:5900](stadare-dashboard.html:5900) `_allServices` | **5** | Hemstädning, Storstädning, Flyttstädning, Fönsterputs, Kontorsstädning |
| [admin.html:5048-5058](admin.html:5048) `CW_SERVICES_CATALOG` | **9** | +Trappstädning, Skolstädning, Vårdstädning, Hotell & restaurang |

**Divergens:** Cleaner kan sätta priser på 5 tjänster via dashboard; admin kan skapa företag med 9 tjänster. En cleaner med "Trappstädning" från admin-flödet har inget UI i sin egen dashboard för att uppdatera priset.

### Inget centralt register

- **Ingen** `services`-tabell i `supabase/migrations/*.sql` (grep 0 träffar för `CREATE TABLE.*services`).
- **Ingen** PostgreSQL ENUM för service_type.
- DB förlitar sig på TEXT-kolumnen `service_type` + ad-hoc `DISTINCT`-queries.
- **SQL mot prod (ej körd) behövs:**
  ```sql
  SELECT DISTINCT service_type FROM bookings;
  SELECT DISTINCT service_type FROM company_service_prices;
  SELECT DISTINCT service_type FROM cleaner_service_prices;
  ```

### Filer som måste ändras för att lägga till "Premiumstädning"/"Mattrengöring"

Minimum (5 filer):
1. [stadare-dashboard.html:5900](stadare-dashboard.html:5900) — `_allServices`-array
2. [admin.html:5048](admin.html:5048) — `CW_SERVICES_CATALOG`
3. [boka.html:723](boka.html:723) — `RUT_SERVICES` (om RUT-berättigad)
4. [foretag.html:280](foretag.html:280) — `RUT_SERVICES`
5. [stadare-dashboard.html:2231](stadare-dashboard.html:2231) — `RUT_SERVICES`

Sannolikt också (verifiera):
6. [stadare-profil.html:302](stadare-profil.html:302) — `RUT_SERVICES`
7. `registrera-stadare.html` — tjänst-val vid ansökan
8. service-checklists (nämns i [fix-multiflow.js:72](fix-multiflow.js:72) men ingen CREATE TABLE hittades — sannolikt manuellt skapad)

**Grep-fynd:** 30 filer innehåller service-namn (inkl. blogg, SEO-sidor) — de flesta är statisk text. Min uppskattning: **5-8 funktionellt kritiska platser** per ny tjänst.

---

## FAS 2 — Pristyp-flexibilitet

### Stödda pristyper (inkonsistent)

| Stöd | hourly | per_sqm | per_window | quote/fixed |
|------|--------|---------|------------|-------------|
| [_shared/pricing-resolver.ts:33-34](supabase/functions/_shared/pricing-resolver.ts:33) | ✅ | ✅ | ❌ (defaultas till hourly) | ❌ |
| [admin.html:5059-5063](admin.html:5059) `CW_PRICE_TYPES` | ✅ | ✅ | ✅ | ❌ |
| [boka.html:2015, 2072](boka.html:2015) | ✅ | ✅ | ❌ | ❌ |
| [stadare-dashboard.html:5923](stadare-dashboard.html:5923) | ✅ | per_sqm eller kr/fönster | — | ❌ |

**Inkonsistens:** Admin kan sätta `per_window` (t.ex. 60 kr/fönster), men `pricing-resolver.ts:33-34` hanterar bara `hourly` och `per_sqm` — **allt annat faller tillbaka på hourly**. `per_window`-pris skulle tolkas som `per_sqm` eller `hourly` i booking-create.

### Offertbaserad prissättning

- `grep "'quote'|offertbaserad|custom_price"` → 0 träffar i produktion.
- Den enda `'fixed'` som hittas är i [coupons-migration:30](supabase/migrations/20260402100003_coupons.sql:30) (orelaterat — `discount_type`).
- Ingen UI-flagga för "begär offert" på tjänst eller cleaner.

**Vad krävs för offertbaserad prissättning:**
1. Nytt `price_type='quote'` + `company_service_prices.price` NULL-stöd (pris sätts senare).
2. `pricing-resolver.ts` måste hantera `quote`-typ — returnera flagga istället för pris.
3. `booking-create` måste hantera bokning utan pris — skapa bokning i `status='awaiting_quote'` utan Stripe-session.
4. Admin/VD-UI för att se "pending quotes" och sätta pris manuellt → mail till kund → Stripe-session skapas.
5. Kommunikationsflöde (kund ser "Vi återkommer med pris inom 24h").

**Storlek:** ~10-15h arbete. **Q3-kandidat.**

---

## FAS 3 — Tillgänglighetsbegränsning per tjänst

### Finns idag

- [cleaner_availability](supabase/migrations/20260326200001_availability.sql:3) — per-cleaner-tabell: `cleaner_id`, `day_of_week`, `start_time`, `end_time`, `is_active`.
- [cleaner_applications.available_days](supabase/migrations/20260326500001_cleaner_applications_columns.sql:3) — TEXT-fält (historisk ansökningsdata).

### Finns INTE

- **Ingen kolumn per service_type** som begränsar när tjänsten kan bokas.
- `grep "available_hours|evenings_only|weekends_only|time_window"` → 0 träffar.
- `boka.html` filtrerar **inte** på "tjänst kan bara bokas helger/kvällar".
- `find_nearby_cleaners` RPC ([sql/fix-find-nearby-for-teams.sql](sql/fix-find-nearby-for-teams.sql)) tar inte `time_of_day` eller `day_of_week`-parameter.

**Vad krävs för "Mattrengöring endast helg/kväll":**
1. Ny tabell `service_time_restrictions` (service_type, allowed_days[], allowed_hours_start, allowed_hours_end) eller JSON-kolumn på `company_service_prices`.
2. `boka.html`-filter: dölja tid-slots som strider mot regeln.
3. Server-side validering i `booking-create` (refusera bokning som bryter regeln).

**Storlek:** ~4-6h arbete. **Kan byggas som per-company flagga först (enklaste fallet: "Rafa erbjuder Mattrengöring bara lördagar kl 18-22").**

---

## FAS 4 — RUT-koppling

### RUT_SERVICES är hardcoded i 4 filer

| Fil | Rad | Värde |
|-----|-----|-------|
| [boka.html:723](boka.html:723) | 723 | `['Hemstädning', 'Storstädning', 'Flyttstädning', 'Fönsterputs']` |
| [foretag.html:280](foretag.html:280) | 280 | samma |
| [stadare-dashboard.html:2231](stadare-dashboard.html:2231) | 2231 | samma |
| [stadare-profil.html:302](stadare-profil.html:302) | 302 | samma |

**Ingen DB-flagga.** `isRutEligible(svc)` läser enbart från JS-array.

### Konsekvens för nya tjänster

- **Premiumstädning** (dyrare variant av Hemstädning → **ska** vara RUT-berättigad): Kräver ändring i alla 4 filer.
- **Mattrengöring**: Enligt Skatteverket är mattrengöring i hemmet RUT-berättigad ENDAST om den utförs i kundens bostad med kundens egen utrustning. Att tvätta en matta i verkstad är INTE RUT. Flagga för juridisk verifiering — om Rafas mattrengöring är "på plats" kan den läggas till i RUT_SERVICES.
- **Trappstädning**: Finns i `CW_SERVICES_CATALOG` men INTE i `RUT_SERVICES`. Trappstädning i bostadsrättsförening är ej RUT (gemensamma utrymmen). Koden är korrekt om detta är avsikten — men inkonsistens gör det lätt att missa.

---

## FAS 5 — Kombinationstjänster

### Aktuell hantering

[_shared/pricing-resolver.ts:48-49](supabase/functions/_shared/pricing-resolver.ts:48):
```ts
// Hantera "Hemstädning + Fönsterputs" → "Hemstädning"
const serviceType = params.serviceType.split(' + ')[0].trim();
```

**All text efter första ` + ` ignoreras vid prisberäkning.** Kunden betalar bara för första tjänsten. Andra tjänsten är "gratis".

### Implikationer för Rafaels önskemål

- "Hemstädning + Mattrengöring" → bara Hemstädning prissätts. Mattrengöring ignoreras helt.
- service_checklists (nämnd i [fix-multiflow.js:72](fix-multiflow.js:72)) hanterar `service_type=in.(...)` för visning av checklistor, men **inte pris-sammanslagning**.

**Vad krävs för korrekt kombinations-pris:**
1. `pricing-resolver.ts` utökas: split på ` + `, loopa alla delar, summera priser.
2. UI: visa uppdelat pris ("Hemstädning: 1200 kr + Fönsterputs: 450 kr = 1650 kr").

**Storlek:** ~2-3h arbete. **Låg prio** tills flera tjänster bokas tillsammans regelbundet.

---

## FAS 6 — Matris: Vad krävs för Rafaels önskemål

| Önskan | Stöd idag | Vad krävs | Storlek |
|--------|-----------|-----------|---------|
| **Premiumstädning 35 kr/kvm** | 🟡 Delvis — `per_sqm` stöds, men tjänstnamnet saknas överallt | Lägg till "Premiumstädning" i `_allServices`, `CW_SERVICES_CATALOG`, `RUT_SERVICES` (4 filer). Kund kan sedan bokas via `price_type='per_sqm'` med 35 kr. | **30 min** |
| **Mattrengöring (helg/kväll)** | 🔴 Nej — ingen tidsbegränsning per tjänst existerar | Ny tabell eller JSON-kolumn för tid-restriktion + `boka.html`-filter + server-validering. RUT-status kräver juridisk verifiering. | **4-6h** + juridik |
| **Offertbaserad prissättning** | 🔴 Nej — `price_type='quote'` finns inte | Nytt price_type + NULL-pris + "awaiting_quote"-status + admin-UI + kommunikationsflöde. | **10-15h** (Q3) |

---

## Rekommendationer

### P0 — Kan göras idag för Rafael

**Premiumstädning** kan implementeras på 30 min:
1. Lägg till `"Premiumstädning"` i `_allServices` och `CW_SERVICES_CATALOG` och `RUT_SERVICES` (4 filer).
2. Farhad skapar `company_service_prices`-rad för Rafas företag: `price_type='per_sqm', price=35`.
3. Kund bokar Premiumstädning → `pricing-resolver.ts` plockar upp per_sqm × kvm → Stripe.

### P1 — Teknisk skuld (blocker för företagsskala)

**Centralisera service-listan.** 5-8 ställen som måste uppdateras vid varje ny tjänst är ohållbart. Skapa antingen:
- DB-tabell `services(name, slug, rut_eligible, default_price, default_price_type)` med `GRANT SELECT` för anon.
- Eller `platform_settings.services_json` (snabbaste path, matchar befintligt mönster).

**Storlek:** ~3-4h. **Betala av före Rafael skalar till 10+ företag.**

### P2 — Tidsbegränsning per tjänst

Vänta tills Rafael verkligen vill erbjuda mattrengöring. Om det blir aktuellt → per-company JSON-flagga på `company_service_prices.restrictions` är enklaste path.

### Q3 — Offertbaserad prissättning

Överhopp för nu. Kräver större arkitekturändring (bokning utan pris, async pris-setting, nytt kommunikationsflöde). **Skjut till Q3-roadmap.**

---

**Stopp-kriterier uppnådda:**
- ✅ Hardcoded service-lista på 5+ ställen → flaggat som teknisk skuld.
- ✅ Offertbaserad prissättning → flaggat för Q3.

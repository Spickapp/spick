# Pricing-arkitektur end-to-end

**Datum:** 17 april 2026  
**Status:** Verifierat via grep + kodläsning. Inga SQL-körningar eller kodändringar.

---

## Nuvarande state

Prisberäkning sker på **tio distinkta platser** i kodbasen. Fyra av dem skriver data till DB (authoritative paths). Sex stycken är read-only display/preview. Endast en har den fulla 3-lagers-logiken; resten har olika delmängder.

### Sanningshierarki (tilltänkt)

```
Lager 1: companies.use_company_pricing = true   →  company_service_prices (ALLA cleaners i företaget)
Lager 2: use_company_pricing = false (eller inget företag):
  2a: cleaner_service_prices (individpris)     →  primärt val
  2b: company_service_prices (fallback)        →  om cleaner saknar individpris men tillhör företag
  2c: cleaners.hourly_rate (slutlig fallback)  →  solo-cleaner utan per-tjänst-pris
Pristyp:
  price_type = "hourly"   →  price × hours
  price_type = "per_sqm"  →  price × sqm (inga hours)
```

---

## Flöden

### Flöde 1: Solo-cleaner utan företag, standardprissättning

1. **Kund** öppnar `boka.html?id=<cleaner_uuid>`
2. [boka.html:775-808](boka.html:775) — ingen `?company=` i URL → `window.companyUseCompanyPricing` undefined.
3. [boka.html:2048-2054](boka.html:2048) — hämtar `cleaner_service_prices` för alla cleaners.
4. [boka.html:2001-2017](boka.html:2001) — preview använder Lager 2: hittar `cl._servicePrices` för primär service, annars `cleaner.hourly_rate`.
5. Kund väljer städare + submit → POST till `booking-create`.
6. [booking-create/index.ts:183-210](supabase/functions/booking-create/index.ts:183) — läser `cleaner_service_prices` först, sedan `cleaner.hourly_rate`.
7. [booking-create/index.ts:212-219](supabase/functions/booking-create/index.ts:212) — `calculateBooking(settings, ...)` beräknar total.
8. [booking-create/index.ts:302-349](supabase/functions/booking-create/index.ts:302) — INSERT `bookings` med `total_price`, `commission_pct`, etc.
9. [booking-create/index.ts:557-619](supabase/functions/booking-create/index.ts:557) — skapar Stripe checkout session med `amountOre = stripeAmount * 100`.
10. Kund betalar → `stripe-webhook` uppdaterar `payment_status='paid'`.

**Konsistens:** OK. Boka.html och booking-create använder samma källor.

### Flöde 2: Cleaner i företag, use_company_pricing = false (aktuellt default)

1. **Kund** öppnar `boka.html?company=<company_uuid>`
2. [boka.html:781-796](boka.html:781) — hämtar `companies.use_company_pricing` → false. Hämtar även `company_service_prices` som referensdata.
3. [boka.html:2008-2017](boka.html:2008) — `window.companyUseCompanyPricing=false` → Lager 2: `cleaner_service_prices` vinner, fallback till `company_service_prices`, sedan `hourly_rate`.
4. Submit → `booking-create`.
5. [booking-create/index.ts:183-210](supabase/functions/booking-create/index.ts:183) — **LÄSER ENDAST `cleaner_service_prices` + `cleaner.hourly_rate`**. **Läser inte `company_service_prices` som fallback.**
6. Rest identiskt med Flöde 1.

**Konsistens:** **AVVIKELSE.** Om cleaner saknar rad i `cleaner_service_prices` men företaget har `company_service_prices`:
- `boka.html` visar företagspriset (Lager 2b fallback).
- `booking-create` ignorerar företagspriset → faller tillbaka till `cleaner.hourly_rate` (eller 399 från platform_settings).
- **Resultat:** Kund ser priset X i preview, men DB sparar pris Y. Stripe tar pris Y.

**Status idag:** Latent — ingen aktiv cleaner i Rafas företag har tomt `cleaner_service_prices` OCH `company_service_prices` ifyllt. Men detta är en designbrist.

### Flöde 3: Cleaner i företag, use_company_pricing = true  ← **RAFAS CASE**

1. **Kund** öppnar `boka.html?company=<rafa_uuid>`
2. [boka.html:781-796](boka.html:781) — `companies.use_company_pricing = true`, `window.companyUseCompanyPricing=true`.
3. [boka.html:2005-2013](boka.html:2005) — **Lager 1:** ALLA cleaners visas med `window.companyPrices[service].price`.
4. Submit → `booking-create`.
5. [booking-create/index.ts:183-210](supabase/functions/booking-create/index.ts:183) — **IGNORERAR `use_company_pricing`**. Läser `cleaner_service_prices` först.
   - Rafael Granviken har `cleaner_service_prices` tom för Rafas företag (verifierat historik).
   - Faller tillbaka till `cleaner.hourly_rate` (Rafa har default 350).
6. `stripe-checkout` körs EJ i denna path — `booking-create` skapar Stripe-session direkt (efter att booking-cancel-v2-refactor konsoliderat).

**Resultat om flaggan sätts till true idag:**
- `boka.html` visar 300 kr/kvm × 80 kvm × 3h = helt annan summa än hour-based.
- `booking-create` räknar 350 kr × 3h = 1050 kr för samma bokning.
- **DB:** `bookings.total_price = 1050`
- **Stripe:** `amountOre = 105000 ore`
- Kund betalar 1050 kr, tror hen betalar företagspriset → FEL.

### Flöde 4: Prenumeration (återkommande bokning)

**Steg 1 — Uppsättning:**
1. Kund via `mitt-konto.html` eller `boka.html` med `frequency != 'once'`.
2. `setup-subscription/index.ts:96-100` — `rate = cleaner.hourly_rate || 350; totalPrice = hours * rate`.
3. [setup-subscription/index.ts:148-174](supabase/functions/setup-subscription/index.ts:148) — INSERT `subscriptions` med `hourly_rate`.
4. **Ignorerar helt** `use_company_pricing`, `company_service_prices`, `cleaner_service_prices`.

**Steg 2 — Återkommande bokning (cron):**
1. [auto-rebook/index.ts:231-232](supabase/functions/auto-rebook/index.ts:231) — `rate = (sub.hourly_rate) || 350; totalPrice = Math.round(hours * rate)`.
2. Skickar bookingPayload till `booking-create` (rad 201-218).
3. `booking-create` räknar OM priset via pricing-engine → **kan ge annat pris än `sub.hourly_rate`** om `cleaner_service_prices` existerar.

**Konsistens:** **AVVIKELSE.** Subscriptions bakar fast `hourly_rate` i `subscriptions`-raden, men `booking-create` räknar om. Om cleaner ändrar `cleaner_service_prices` efter subscription skapas, får nästa bokning nytt pris som INTE matchar subscription.hourly_rate.

**Status idag:** LATENT för subscription-kunder. Ingen aktiv subscription med company-cleaner.

### Flöde 5: Manuell bokning (VD eller admin skapar)

1. **VD** öppnar `stadare-dashboard.html` → "Boka uppdrag" (manuell bokning).
2. Frontend skickar till `booking-create` med `manual_override_price`.
3. [booking-create/index.ts:230-253](supabase/functions/booking-create/index.ts:230) — override aktiv om `manual_override_price >= 100`.
4. Pricing-engine körs först (normal prisberäkning), sedan **proportionell skalning** av alla fält:
   ```ts
   const ratio = op / originalTotal;
   pricing.customerTotal = op;
   pricing.cleanerTotal = Math.round(pricing.cleanerTotal * ratio);
   pricing.spickGross = Math.round(pricing.spickGross * ratio);
   ```
5. `bookings.total_price = op` (override-pris).
6. Stripe tar `op * 100` öre.

**Konsistens:** OK — override är explicit. Dock ärver override samma pricing-path som BUG 1 i Commission-audit (hårdkodad 17%).

### Flöde 6: Admin skapar företag + cleaner_service_prices

1. Admin via `admin.html` anropar `admin-create-company`.
2. [admin-create-company/index.ts:130-135](supabase/functions/admin-create-company/index.ts:130) — INSERT `company_service_prices` (base per tjänst).
3. [admin-create-company/index.ts:223-228](supabase/functions/admin-create-company/index.ts:223) — INSERT `cleaner_service_prices` för ägaren med samma priser.
4. `commission_rate: body.commission_rate ?? 12` (rad 59, 106, 205) — sparas till `companies` OCH `cleaners`.

**Konsistens:** OK — admin-create-company är korrekt.

### Flöde 7: Admin godkänner ansökan (cleaner)

1. Admin via `admin.html` anropar `admin-approve-cleaner`.
2. [admin-approve-cleaner/index.ts:138](supabase/functions/admin-approve-cleaner/index.ts:138) — INSERT `cleaners` med `hourly_rate = parseFloat(String(app.hourly_rate)) || 350`.
3. [admin-approve-cleaner/index.ts:148,272](supabase/functions/admin-approve-cleaner/index.ts:148) — `commission_rate: 17`.
4. [admin-approve-cleaner/index.ts:235-241](supabase/functions/admin-approve-cleaner/index.ts:235) — parse pricing-fält från ansökan, INSERT `cleaner_service_prices` med `price_type` "hourly" eller "per_sqm".

**Konsistens:** OK.

### Flöde 8: Självfakturering (månatlig, cron)

1. [generate-self-invoice/index.ts:135-205](supabase/functions/generate-self-invoice/index.ts:135) — läser bokningar + `commission_log`.
2. `gross = cl?.gross_amount || b.total_price` — läser gross från `commission_log`; fallback till `b.total_price`.
3. `commission = cl?.commission_amt || Math.round(gross * (commPct / 100))` — beräknar om ej loggat.

**Konsistens:** OK — self-invoice är pure-read.

### Flöde 9: Subscription-debitering (cron)

1. [charge-subscription-booking/index.ts:171](supabase/functions/charge-subscription-booking/index.ts:171) — `chargeAmount = Math.round(Number(booking.total_price) || 0)`.
2. [charge-subscription-booking/index.ts:188-190](supabase/functions/charge-subscription-booking/index.ts:188) — **läser `booking.commission_pct` korrekt** (/ 100).
3. `applicationFee = Math.round(amountOre * commissionRate)` — Stripe tar procent baserat på LAGRAD `commission_pct`.

**Konsistens:** ✅ **DENNA ÄR KORREKT IMPLEMENTATION.** Läser från bookings istället för att hårdkoda.

### Flöde 10: Företag-sida (`foretag.html`) — display only

1. [foretag.html:371-378](foretag.html:371) — hämtar `company_service_prices` + `cleaner_service_prices`.
2. [foretag.html:428-444](foretag.html:428) — bygger `svcMap` i tre steg:
   - Steg 1: Individuella `cleaner_service_prices` (lägst vinner).
   - Steg 2: `company_service_prices` som fallback.
   - Steg 3: `hourly_rate` som sista fallback.
3. Visar som "Från X kr/h" i listningen.

**Konsistens:** Display använder steg 1 → steg 2 → steg 3. **IGNORERAR `use_company_pricing` flagga.** Visar alltså alltid lägsta individpris först, även om företaget har `use_company_pricing=true`.

### Flöde 11: Städare sätter egna priser (`stadare-dashboard.html`)

1. [stadare-dashboard.html:5900-5941](stadare-dashboard.html:5900) — cleaner ser alla tjänster med `price_type` + `price`.
2. [stadare-dashboard.html:5964-5994](stadare-dashboard.html:5964) — DELETE + INSERT `cleaner_service_prices`.

**Konsistens:** OK — lokal cleaner-vy. Ingen company-fallback.

### Flöde 12: VD sätter företagspriser (`stadare-dashboard.html` + `fix-company-prices.js`)

1. [stadare-dashboard.html:8896-8899](stadare-dashboard.html:8896) — VD ser `companies.use_company_pricing`.
2. [stadare-dashboard.html:8887-8888](stadare-dashboard.html:8887) — PATCH `companies` med `use_company_pricing: useCompany`.
3. [stadare-dashboard.html:8910-8974](stadare-dashboard.html:8910) — CRUD på `company_service_prices`.

**Konsistens:** OK — VD kan toggle flaggan och sätta priser.

### Flöde 13: Städarens "Min profil" (`stadare-profil.html`)

1. [stadare-profil.html:494](stadare-profil.html:494) — visar `cleaner_service_prices` för en cleaner.

**Konsistens:** Display-only. OK.

---

## Pricing-points kartlagda (sammanfattning)

| # | Plats | Fil:rad | Läser från | Skriver till | Risk |
|---|-------|---------|------------|--------------|------|
| 1 | Frontend preview (boka) | [boka.html:2001-2099](boka.html:2001) | `use_company_pricing` → `company_prices` → `cleaner_service_prices` → `hourly_rate` | — | ✅ OK |
| 2 | Server preauth pricing (stripe-checkout) | [stripe-checkout/index.ts:112-164](supabase/functions/stripe-checkout/index.ts:112) | Samma 3-lagers som boka.html | Stripe session | ✅ OK (logik korrekt, men commission-fee hårdkodad, se Commission-audit BUG 1) |
| 3 | **Server booking-create pricing** | [booking-create/index.ts:183-210](supabase/functions/booking-create/index.ts:183) | **BARA `cleaner_service_prices` + `cleaner.hourly_rate`** | `bookings.total_price` | 🔴 **BUG** — ignorerar `use_company_pricing` OCH `company_service_prices` fallback |
| 4 | Manual override (VD/admin) | [booking-create/index.ts:230-253](supabase/functions/booking-create/index.ts:230) | `manual_override_price` param | `bookings.total_price` | ✅ OK (explicit override) |
| 5 | Subscription setup | [setup-subscription/index.ts:96-100](supabase/functions/setup-subscription/index.ts:96) | ENBART `cleaner.hourly_rate` | `subscriptions.hourly_rate` | 🟡 Ignorerar alla per-tjänst-priser OCH company-priser |
| 6 | Subscription auto-rebook | [auto-rebook/index.ts:231-232](supabase/functions/auto-rebook/index.ts:231) | `sub.hourly_rate` | Skickar till booking-create som ny bokning | 🟡 Låst pris; ny bokning kan få annat pris från pricing-engine |
| 7 | Subscription charge | [charge-subscription-booking/index.ts:171,188](supabase/functions/charge-subscription-booking/index.ts:171) | `booking.total_price` + `booking.commission_pct` | Stripe PaymentIntent | ✅ OK |
| 8 | foretag.html company listing | [foretag.html:428-444](foretag.html:428) | 3-lagers: individ > företag > timpris | — | 🟡 Ignorerar `use_company_pricing`-flaggan |
| 9 | admin-create-company | [admin-create-company/index.ts:130,223](supabase/functions/admin-create-company/index.ts:130) | `body.services` (admin input) | `company_service_prices` + `cleaner_service_prices` | ✅ OK |
| 10 | admin-approve-cleaner | [admin-approve-cleaner/index.ts:138,236](supabase/functions/admin-approve-cleaner/index.ts:138) | `app.hourly_rate` + parsed pricing | `cleaners.hourly_rate` + `cleaner_service_prices` | ✅ OK |
| 11 | Städare pricing UI | [stadare-dashboard.html:5900-5994](stadare-dashboard.html:5900) | Användare input | `cleaner_service_prices` (DELETE+INSERT) | ✅ OK |
| 12 | VD company pricing UI | [stadare-dashboard.html:8887-8974](stadare-dashboard.html:8887) | Användare input | `companies.use_company_pricing` + `company_service_prices` | ✅ OK |
| 13 | Admin cleaner pricing save | [admin.html:3285](admin.html:3285) | Admin input | `cleaner_service_prices` | ✅ OK |
| 14 | stadare-profil.html display | [stadare-profil.html:494](stadare-profil.html:494) | `cleaner_service_prices` | — | ✅ OK (display only) |

**Totalt:** 14 pricing-points. 3 kritiska fel/avvikelser.

---

## Identifierade problem

### Problem 1: booking-create ignorerar use_company_pricing (redan känt)

**Fil:** [`supabase/functions/booking-create/index.ts:183-210`](supabase/functions/booking-create/index.ts:183)

**Nuvarande kod:**
```ts
// Kolla per-tjänst-pris
let usePerSqm = false;
let perSqmRate = 0;
try {
  const { data: svcPrices } = await supabase
    .from("cleaner_service_prices")
    .select("price, price_type")
    .eq("cleaner_id", cleaner.id)
    .eq("service_type", service.split(" + ")[0].trim())
    .limit(1);
  if (svcPrices && svcPrices.length > 0) {
    if (svcPrices[0].price_type === "per_sqm" && sqm) {
      usePerSqm = true;
      perSqmRate = svcPrices[0].price;
      settings.basePricePerHour = Math.round((perSqmRate * sqm) / validHours);
    } else {
      settings.basePricePerHour = svcPrices[0].price;
    }
  } else if (cleaner.hourly_rate && cleaner.hourly_rate > 0) {
    settings.basePricePerHour = cleaner.hourly_rate;
  }
```

**Vad som saknas (jämför `stripe-checkout/index.ts:113-164`):**
- Läsning av `companies.use_company_pricing` när cleaner tillhör företag.
- Om `use_company_pricing=true` → läs `company_service_prices` (Lager 1).
- Fallback till `company_service_prices` när cleaner saknar individpris (Lager 2b).

**Användarflöden som bryts:**
- Flöde 3 (Rafas case, `use_company_pricing=true`).
- Flöde 2 (latent — cleaner utan individpris i företag).

**Berörda användartyper:**
- **Kund:** Ser ett pris i preview, betalar potentiellt ett annat (kund skyddas dock av att Stripe använder `stripeAmount`, så de betalar rätt för vad som sparats).
- **Solo-cleaner:** Inte berörd (inget företag).
- **VD (Rafa):** Kan inte aktivera `use_company_pricing` utan att bokningen sparar fel total_price.
- **Teammedlem:** Stripe Connect destination-charge räknas på fel basvärde.
- **Admin:** Rapporter visar fel omsättning.

**Status idag:** LATENT. Inga bokningar har gjorts med `use_company_pricing=true` (Rafas flagga är false). Ingen teammedlem utan individpris har bokats via en `use_company_pricing=false`-company.

### Problem 2: foretag.html ignorerar use_company_pricing

**Fil:** [`foretag.html:428-444`](foretag.html:428)

Listningssidan visar alltid lägsta individpris först, även när företaget har `use_company_pricing=true`. Kund ser t.ex. "Från 250 kr/h" baserat på en cleaner som historiskt hade individpris — men bokning kommer använda företagspriset (t.ex. 350 kr/h). Kognitiv dissonans för kund.

**Lösning:** Samma 3-lagers-logik som boka.html. ~15 rader.

### Problem 3: Subscriptions ignorerar per-tjänst-priser

**Fil:** [`setup-subscription/index.ts:96-100`](supabase/functions/setup-subscription/index.ts:96)

Subscriptions skapas alltid med `cleaner.hourly_rate`. Om cleaner har `cleaner_service_prices` ignoreras det helt vid uppsättning.

**Konsekvens:** Kund som ser "Storstädning 450 kr/h" i boka.html-preview kan sätta upp subscription som sparar `hourly_rate=350` (cleaner default) → första faktisk bokning via `auto-rebook` räknar om till 450 kr/h → kund betalar mer än förväntat.

**Status idag:** LATENT. Få subscriptions aktiva.

### Problem 4: auto-rebook återanvänder sub.hourly_rate utan att beakta cleaner_service_prices

**Fil:** [`auto-rebook/index.ts:231`](supabase/functions/auto-rebook/index.ts:231)

Samma rot som Problem 3. Subscription-raden är sanningskälla → stämmer inte med nuvarande priser.

---

## Sammanfattning

**Pricing-paths totalt:** 14 (över acceptansminimum 5).

**Konfliktpunkter:**
1. `boka.html` ↔ `booking-create` — olika källor i företagskontext (KRITISK).
2. `boka.html` ↔ `foretag.html` — olika ordning utan hänsyn till `use_company_pricing`.
3. `setup-subscription` ↔ `booking-create` (via `auto-rebook`) — olika prissättning för subscription.

**Tilldragande observation:** `stripe-checkout` har redan den kompletta 3-lagers-logiken (rad 112-164). Det är *den* koden som borde vara delad.

**Kritisk verifikation 17 april:** Grep i `boka.html` visar att frontend endast anropar `booking-create` (rad 2847). `stripe-checkout` är kvar i repo men **aktivt anropas inte** av huvudboknings-flödet. `booking-create` är single source of truth för nya bokningar och skapar egna Stripe-sessioner (rad 557-619).

**Implikation för Dag 2:** 
- Om `stripe-checkout` är död kod → ta bort den (minskar underhållsskuld).
- Om den används för någon annan flow (admin-bokningar? företags-bokningar?) → grep hela kodbasen innan borttagning.
- Under inga omständigheter bör vi duplicera logiken till båda filer — använd en gemensam pricing-helper (Väg B i fix-strategi).

**Verifikation (E):** SQL/runtime-test krävs för att avgöra:
- Är `stripe-checkout` EF någonsin invoked i produktion? (Supabase logs).
- Finns det aktiva subscriptions med `cleaner_id` som har `cleaner_service_prices`?

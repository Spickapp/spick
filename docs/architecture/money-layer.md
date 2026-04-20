# F1 — Money Layer (Design)

**Fas:** F1 i arkitekturplan v3.1
**Skriven:** 2026-04-20
**Primärkälla för F1.2–F1.10-implementation**
**Tidsestimat:** 30–50h över vecka 2–5 (per [spick-arkitekturplan-v3.md:133](../planning/spick-arkitekturplan-v3.md) "Fas 1 — Money Layer")
**Beroenden:** Fas 0 (klart). Blockerar: Fas 5 (recurring payout), Fas 8 (escrow), Fas 10 (observability).

---

## 1. Översikt + motivation

Skalbarhetsauditen 2026-04-20 (commit `72d082f`) identifierade **money-fragmentering** som audit-prioritet 🔴 #1. Commission och payout-logik är spritt över **14 kod-ställen** med fyra olika numeriska värden (0.12, 0.17, 0.83, 0.88) och två format (decimal vs procent). Silent drift uppstår närhelst `platform_settings.commission_standard` ändras eller Smart Trappstege aktiveras — ingen enda källa till sanning.

**Särskilt kritiskt:**

- [admin.html:4478-4502](../../admin.html:4478) `markPaid()` PATCH:ar `bookings.payout_status='paid'` utan att anropa Stripe. Ingen transfer, ingen verifiering, ingen idempotency. Fungerar vid låg volym eftersom `stripe-checkout` redan gör destination charges vid betalning, men skalar inte: inget audit-trail, ingen reconciliation mot Stripe, silent double-book-risk.
- [stripe-connect/index.ts:142-183](../../supabase/functions/stripe-connect/index.ts:142) `payout_cleaner`-action har **0 anropare** (grep i hela repot: 1 träff = definitionen). Död kod som ser verklig ut → risk att någon aktiverar den och dubbel-transfererar.
- [stripe-checkout/index.ts:88](../../supabase/functions/stripe-checkout/index.ts:88) hardcodar `company_id ? 0.12 : (customer_type==="foretag" ? 0.12 : 0.17)`. Läser INTE `platform_settings.commission_standard` (=12 per [MEMORY.md](../../.claude/projects/C--Users-farha-spick/memory/MEMORY.md)).

**Mål:** En central `supabase/functions/_shared/money.ts` är **enda vägen** för commission-lookup, payout-beräkning, RUT-split och Stripe-transfer. Ingen hardcodad procent finns i kod. Payout-markering kräver verifierad Stripe Transfer. Reconciliation-cron matchar dagligen DB mot Stripe events.

**Regel-referenser:**
- Regel #27 — primärkälle-verifiering: alla siffror i detta dokument är grepade från aktuell kod (verifierat 2026-04-20 mot commit `c9038ee`).
- Regel #28 — ingen business-data-fragmentering: commission/RUT/base_price på 2+ ställen → centraliseras till DB + money.ts.
- Regel #29 — primärkälla över memory: DB-kolumner som noteras som "osäkra" verifieras mot `information_schema` innan F1.1-start.

---

## 2. Nuvarande tillstånd

### 2.1 Fjorton hardcoded money-ställen

Alla fil:rad-referenser verifierade i commit `c9038ee` (2026-04-20).

| # | Fil:rad | Kod | Klass |
|---|---------|-----|-------|
| 1 | [stripe-checkout/index.ts:88](../../supabase/functions/stripe-checkout/index.ts:88) | `commissionRate = company_id ? 0.12 : (customer_type === "foretag" ? 0.12 : 0.17)` | 🔴 LIVE i checkout-flöde |
| 2 | [stripe-connect/index.ts:172](../../supabase/functions/stripe-connect/index.ts:172) | `Math.round(totalKr * 0.83)` | 🔴 Död kod (`payout_cleaner`-action) |
| 3 | [js/commission.js:15](../../js/commission.js:15) | `rate: 0.17, keep: 0.83` (tier "new") | 🟡 Display-only Trappstege |
| 4 | [js/commission.js:16](../../js/commission.js:16) | `rate: 0.15, keep: 0.85` (tier "established") | 🟡 Display-only Trappstege |
| 5 | [js/commission.js:17](../../js/commission.js:17) | `rate: 0.13, keep: 0.87` (tier "professional") | 🟡 Display-only Trappstege |
| 6 | [js/commission.js:18](../../js/commission.js:18) | `rate: 0.12, keep: 0.88` (tier "elite") | 🟡 Display-only Trappstege |
| 7 | [bli-stadare.html:511](../../bli-stadare.html:511) | `const commission = 0.17;` | 🟡 Marknadsförings-kalkylator |
| 8 | [faktura.html:121](../../faktura.html:121) | `const commissionPct = b.commission_pct \|\| 17;` (kundfaktura) | 🟡 17 som fallback |
| 9 | [faktura.html:205](../../faktura.html:205) | `const commissionPct = b.commission_pct \|\| 17;` (städarfaktura) | 🟡 17 som fallback |
| 10 | [admin.html:2806](../../admin.html:2806) | `Math.round((b.total_price\|\|0) * ((b.commission_pct\|\|17)/100))` (totalProvision) | 🟡 17 fallback i dashboard |
| 11 | [admin.html:2807](../../admin.html:2807) | Samma fallback (totalPayout) | 🟡 |
| 12 | [admin.html:2808](../../admin.html:2808) | Samma fallback (paidOut) | 🟡 |
| 13 | [marknadsanalys.html:969-970](../../marknadsanalys.html:969) | `cleanerPh = adjRate * 0.83; spickPh = adjRate * 0.17;` | 🟢 Simulerings-verktyg |
| 14 | [cleaners.commission_rate](../../supabase/migrations) + [companies.commission_rate](../../supabase/migrations) | Per-entitet kolumner med mixed format (0.12 eller 12). Ignoreras per [MEMORY.md](../../.claude/projects/C--Users-farha-spick/memory/MEMORY.md). | 🟡 Skall droppa eller migrera |

### 2.2 Payout-pipeline (nuläge)

```
Kund betalar
   ↓
stripe-checkout:88           ← HARDCODED 0.12/0.17
   ↓
Stripe destination charge    ← pengar direkt till cleaners Connect-konto
   ↓
stripe-webhook (succeeded)   ← sätter payment_status='paid', payout_status=null
   ↓
[INGET SKER AUTOMATISKT]
   ↓
admin.html:markPaid          ← manuell PATCH payout_status='paid'
                               ingen Stripe-anrop, ingen idempotency
```

**Kritiskt:** `stripe-connect:payout_cleaner` (rad 142-183) existerar men anropas **aldrig**. `stripe-checkout` gör redan betalningen via destination charge → ingen separat transfer behövs i nuvarande arkitektur. Men det betyder också att `payout_status='paid'` inte betyder något verifierat — bara att Farhad klickat en knapp i admin.

### 2.3 Existerande primärkälla

[supabase/functions/_shared/pricing-resolver.ts](../../supabase/functions/_shared/pricing-resolver.ts) (153 rader) är **föregångaren** till money.ts. Den löser:

- Commission från `platform_settings.commission_standard` (fallback 12)
- Pris i 5-stegs hierarki (se §6)

Money.ts **utökar** denna, den ersätts inte. `resolvePricing()` flyttas in som intern funktion `_resolveBasePrice()` i money.ts.

### 2.4 Relevanta DB-kolumner (verifierade via kod-läsning)

| Tabell | Kolumner (money-relaterade) | Källa |
|--------|------------------------------|-------|
| `platform_settings` | `key`, `value`, `description` (rader: `commission_standard=12`, `base_price_per_hour=399`) | [pricing-resolver.ts:54-58](../../supabase/functions/_shared/pricing-resolver.ts:54) |
| `cleaners` | `stripe_account_id`, `stripe_onboarding_status`, `company_id`, `is_company_owner`, `hourly_rate`, `commission_rate` (mixed) | [stripe-checkout:80-82](../../supabase/functions/stripe-checkout/index.ts:80) |
| `companies` | `stripe_account_id`, `use_company_pricing`, `owner_cleaner_id`, `commission_rate` (mixed) | [stripe-connect:162](../../supabase/functions/stripe-connect/index.ts:162), [pricing-resolver.ts:77-82](../../supabase/functions/_shared/pricing-resolver.ts:77) |
| `bookings` | `total_price`, `commission_pct`, `spick_gross_sek`, `stripe_fee_sek`, `rut_amount`, `base_price_per_hour`, `customer_price_per_hour`, `payment_status`, `payout_status`, `payout_date` | [faktura.html:118-125](../../faktura.html:118), [admin.html:2806](../../admin.html:2806) |
| `company_service_prices` | `company_id`, `service_type`, `price`, `price_type` | [pricing-resolver.ts:87-93](../../supabase/functions/_shared/pricing-resolver.ts:87) |
| `cleaner_service_prices` | `cleaner_id`, `service_type`, `price`, `price_type` | [pricing-resolver.ts:97-102](../../supabase/functions/_shared/pricing-resolver.ts:97) |

**Verifieras innan F1.1-start** (SQL i Supabase-studio, Farhad):

```sql
SELECT key, value, description FROM platform_settings
 WHERE key LIKE '%commission%' OR key LIKE '%price%' OR key LIKE '%rut%';

SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name IN ('cleaners','companies','bookings','platform_settings')
   AND (column_name LIKE '%commission%' OR column_name LIKE '%price%'
     OR column_name LIKE '%payout%' OR column_name LIKE '%rut%'
     OR column_name LIKE '%stripe%');
```

---

## 3. Mål-arkitektur

**Ett lager, en sanning:**

```
Alla callsites (EFs, frontend, admin, faktura)
   ↓
_shared/money.ts  (enda public API)
   ↓
┌──────────────────────────────────────┐
│  platform_settings (commission,      │
│    base_price, RUT-cap, ...)         │
│  cleaners/companies (stripe_account, │
│    pricing-flaggor)                  │
│  bookings (audit-kolumner)           │
│  payout_audit_log (NY)               │
└──────────────────────────────────────┘
   ↓
Stripe API (transfers, charges)
```

**Invarianter:**

1. **Ingen** kod utanför `_shared/money.ts` får innehålla numeriska procentsatser för commission/payout.
2. **Ingen** kod utanför money.ts får anropa `stripe("/transfers", ...)` eller `stripe("/refunds", ...)`.
3. `bookings.payout_status` får **endast** sättas av `markPayoutPaid()` eller `reconcilePayouts()`. Alla andra skriv-vägar avvisas via RLS + DB-trigger.
4. Commission-ändring i `platform_settings` propagerar automatiskt till **alla** framtida bokningar utan kod-deploy.
5. Payout-beräkning är deterministisk: samma `booking_id` + samma `platform_settings` → samma resultat. Reconciliation är möjlig.

---

## 4. API-design

Alla funktioner i `supabase/functions/_shared/money.ts`. TypeScript. Shared med både EFs (Deno) och frontend-EF `mark-payout-paid`.

### 4.1 `getCommission(context)` — Commission-lookup

```ts
interface CommissionContext {
  cleanerId: string;
  companyId?: string | null;
  customerType?: 'privat' | 'foretag';
  bookingDate?: string;  // ISO, för historik-lookup
}

interface CommissionResult {
  pct: number;                      // decimal, ex. 12 (betyder 12%)
  source: 'platform_settings'       // default
        | 'company_override'        // companies.commission_pct (framtida)
        | 'cleaner_override'        // cleaners.commission_pct (framtida)
        | 'smart_trappstege'        // js/commission.js tiers (om aktiv)
        | 'fallback';               // 12 (hardcoded sista utväg)
  tier?: 'new' | 'established' | 'professional' | 'elite';
}

export async function getCommission(
  sb: SupabaseClient,
  ctx: CommissionContext
): Promise<CommissionResult>
```

**Hierarki:** se §5.

### 4.2 `calculatePayout(booking)` — Payout-beräkning

```ts
interface PayoutBreakdown {
  totalPriceKr: number;          // kundens totala pris inkl. RUT
  priceBeforeRutKr: number;      // totalPrice + rut_amount
  commissionPct: number;
  commissionKr: number;          // Spick-andel (avrundad SEK)
  cleanerPayoutKr: number;       // städarens/företagets utbetalning (SEK)
  stripeFeeKr: number;           // från bookings.stripe_fee_sek eller beräknad
  destinationAccountId: string | null;  // Stripe Connect account
  destinationOwnerType: 'solo_cleaner' | 'company';
  rutAmountKr: number;
  source: CommissionResult;       // inkludera commission source för audit
}

export async function calculatePayout(
  sb: SupabaseClient,
  bookingId: string
): Promise<PayoutBreakdown>
```

**Avrundning:** Spick-andel avrundas med `Math.round()`. Cleaner-utbetalning = `priceBeforeRut - commission` (exakt, inga öres-drift). All matematik i SEK (heltal). Öre-konvertering sker endast vid Stripe-anrop.

### 4.3 `calculateRutSplit(amount, eligible)` — RUT-split

```ts
interface RutSplit {
  grossKr: number;        // total innan RUT
  rutAmountKr: number;    // 50% upp till kvotgräns
  customerPaysKr: number; // grossKr - rutAmountKr
  remainingYearlyCapKr: number;  // hur mycket RUT-utrymme kvar
}

export async function calculateRutSplit(
  sb: SupabaseClient,
  params: {
    customerId: string;
    grossKr: number;
    serviceType: string;  // avgör eligibility
    year?: number;
  }
): Promise<RutSplit>
```

**Källa:** `platform_settings.rut_yearly_cap_kr` (default 75000), `platform_settings.rut_pct` (default 0.50), `services.rut_eligible` (framtida Fas 4). RUT-historik slår upp i `bookings` summering för kund året. Recurring-serier som korsar årsskifte hanteras per-bokning, inte per-serie (Fas 5 interop).

### 4.4 `triggerStripeTransfer(booking)` — Separate-transfer (Fas 8 escrow)

```ts
export async function triggerStripeTransfer(
  sb: SupabaseClient,
  bookingId: string,
  opts?: { idempotencyKey?: string }
): Promise<{
  transferId: string;        // Stripe tr_xxx
  amountKr: number;
  destinationAccount: string;
  status: 'pending' | 'paid' | 'failed';
}>
```

**Obs:** I Fas 1 är denna **inte aktiv** — destination charges i `stripe-checkout` levererar redan pengarna vid betalning. Funktionen byggs men med flag-guard: `if (!await isEscrowEnabled(sb)) throw new Error('escrow_not_enabled')`. Aktiveras i Fas 8 när `separate-charges-and-transfers`-refactor körs.

### 4.5 `markPayoutPaid(bookingId)` — Ny EF-callable (ersätter admin.html:markPaid)

```ts
export async function markPayoutPaid(
  sb: SupabaseClient,
  bookingId: string,
  params: {
    adminEmail: string;          // för audit
    verifyStripeTransfer?: boolean; // default true i Fas 8, false i Fas 1
    idempotencyKey?: string;
  }
): Promise<{
  alreadyPaid: boolean;
  payoutDate: string;
  auditLogId: string;
}>
```

**Kontroll-flöde:**

1. Idempotency: slå upp `payout_audit_log` på `idempotency_key`. Om finns → returnera `alreadyPaid=true`.
2. Verifiera booking: `payment_status='paid'`, `payout_status IS NULL`, `cleaner_id NOT NULL`.
3. (Fas 8) Verifiera Stripe Transfer existerar och matchar beräknat belopp.
4. UPDATE `bookings SET payout_status='paid', payout_date=now()` — atomiskt med INSERT i `payout_audit_log`.
5. Logga event `payout_marked_paid` (Fas 6 event-system).

**Ersätter:** [admin.html:4478-4502](../../admin.html:4478) som idag gör direkt PATCH med anon-nyckel.

### 4.6 `reconcilePayouts()` — Daglig cron

```ts
export async function reconcilePayouts(
  sb: SupabaseClient,
  opts?: { dryRun?: boolean; sinceHours?: number }
): Promise<{
  checked: number;
  mismatches: PayoutMismatch[];
  alertsSent: number;
}>
```

**Jobbschema:** daglig 04:00 Stockholm. Hämtar Stripe Transfer events senaste 25h, matchar mot `bookings.payout_status='paid'`. Mismatches skrivs till `payout_audit_log.severity='alert'` + Slack/Discord-notis (Fas 10 integration).

**Mismatch-typer:**
- Stripe-transfer existerar men `payout_status IS NULL` → admin glömde markera.
- `payout_status='paid'` men ingen Stripe-transfer matchar → **kritiskt**, möjligt fake-payout.
- Belopp-diff > 1 kr → avrundnings-bug.

---

## 5. Commission-lookup-hierarki

```
1. Om booking.commission_pct_override IS NOT NULL  (framtida, admin-override)
   → returnera den (source='manual_override')

2. Om Smart Trappstege aktiverad i platform_settings.smart_trappstege_enabled=true
   → läs cleaners.completed_jobs
   → mappa mot tier (new/established/professional/elite)
   → returnera tier.pct (source='smart_trappstege')

3. Om cleaner.commission_pct IS NOT NULL  (framtida per-cleaner override)
   → returnera den (source='cleaner_override')

4. Om company.commission_pct IS NOT NULL  (framtida per-company override)
   → returnera den (source='company_override')

5. Default: platform_settings.commission_standard
   → returnera (source='platform_settings')

6. Hardcoded fallback om DB otillgänglig: 12
   → returnera (source='fallback')
```

**Historik:** alla bokningar skriver `bookings.commission_pct` vid skapande (redan idag). Vid rapportering (faktura, admin-dashboard) **alltid** läs från `bookings.commission_pct`, aldrig räkna om via `getCommission()` i efterhand. `getCommission()` anropas endast vid bokningsskapande och payout.

**Regel #28:** Smart Trappstege är `display-only` idag ([js/commission.js](../../js/commission.js)). För att aktivera den i payout krävs F1.7 — annars fragmentering mellan "vad städaren ser" och "vad städaren får".

---

## 6. Pricing-lookup-hierarki

**Oförändrad från [pricing-resolver.ts:43-152](../../supabase/functions/_shared/pricing-resolver.ts:43)** — bara flyttad in som intern funktion `_resolveBasePrice()` i money.ts.

```
1. company_service_prices (om companies.use_company_pricing=true)
2. cleaner_service_prices (individpris)
3. company_service_prices (fallback oavsett flaggan)
4. cleaners.hourly_rate
5. platform_settings.base_price_per_hour (default 399)
```

Returnerar `PricingResult { basePricePerHour, pricePerSqm, priceType, source }`.

**Ingen ändring i logik. Enda skillnad:** `commissionPct` hämtas inte längre via denna funktion — `getCommission()` anropas separat för att undvika att pris-fallback påverkar commission-fallback.

---

## 7. Stripe-integration

### 7.1 Destination charges (nuvarande, Fas 1–7)

`stripe-checkout` behåller destination charge-mönstret:

```ts
{
  payment_intent_data: {
    application_fee_amount: commissionOre,
    transfer_data: { destination: cleanerStripeAccountId },
  }
}
```

Men `commissionOre` beräknas via `getCommission()` + `calculatePayout()` — **inte** hardcoded `0.12/0.17`.

### 7.2 Separate charges and transfers (Fas 8 escrow)

Refactor till två-stegs:

```
1. Charge (stripe-checkout): pengarna till Spick-kontot
2. Transfer (efter "completed" + 24h, eller efter dispute-resolution):
   triggerStripeTransfer(bookingId) → pengarna till cleaner
```

Money.ts har redan funktionen klar från Fas 1 (§4.4, guard:ad bakom flag). Fas 8 flaggan `platform_settings.escrow_enabled=true` + refactor av `stripe-checkout` = hela escrow-layer utan refactor av money.ts.

### 7.3 Refunds (Fas 8)

`unified-refund` EF (planerad Fas 8) anropar `money.refund(bookingId, amountKr, reason)`. Ingen frontend eller annan EF får anropa Stripe `/refunds` direkt.

---

## 8. Feature flag-strategi

**Central flag:** `platform_settings.money_layer_enabled` (bool).

```
false (default vid launch av F1.2):
  stripe-checkout läser gamla hardcoded-logiken
  admin.html:markPaid fungerar som idag

true (efter 30d parallell-verifiering):
  stripe-checkout anropar money.calculatePayout()
  admin.html:markPaid anropar mark-payout-paid EF
  faktura.html läser bokningens lagrade commission_pct (oförändrat)
```

**Underflaggor:**
- `smart_trappstege_payout_enabled` (bool) — aktiverar §5 steg 2.
- `escrow_enabled` (bool) — Fas 8.
- `reconciliation_alert_threshold_kr` (int, default 1) — minsta belopp-diff för Slack-alert.

**Varför flag:** produktionsincident-risk. Om money.ts har bug i första veckan → `UPDATE platform_settings SET value='false' WHERE key='money_layer_enabled'` → tillbaka till gamla kod-path inom 30 sekunder.

---

## 9. Rollout-plan

**Vecka 2–3 (F1.1–F1.3):** Bygg money.ts + `payout_audit_log`-migration + `mark-payout-paid` EF. Ingen prod-ändring. Unit-tester + integration-test i Stripe test mode.

**Vecka 4 (F1.4–F1.6):** Deploya money.ts, guard:ad bakom `money_layer_enabled=false`. Parallell-skriv: varje gång stripe-checkout/faktura anropas, **även** kör money.ts och logga till `payout_audit_log` om avvikelse. Larm om > 0 avvikelser.

**Vecka 5 (F1.7–F1.10):** Efter 14 dagars 0-avvikelse: `UPDATE platform_settings SET value='true' WHERE key='money_layer_enabled'`. Övervaka 7 dagar. Om OK → tas hardcoded-koden bort i F1.8–F1.9 (single commit, revertable).

**Total parallell-period:** 21 dagar. Rivning först efter zero-issue-period. Inget big-bang.

**Rollback:** flag-toggle (< 1 min) eller revert av rivnings-commit (< 5 min).

---

## 10. Migration-plan per hardcoded-ställe

| # | Fil:rad | Migration-strategi | F-uppgift |
|---|---------|---------------------|-----------|
| 1 | stripe-checkout:88 | Ersätt med `const { pct } = await getCommission(sb, { cleanerId, companyId, customerType })` | **F1.2** |
| 2 | stripe-connect:172 (death code) | Radera hela `payout_cleaner`-action (rad 142-220). Ingen anropare finns. | **F1.3** |
| 3–6 | js/commission.js:15-18 | Om Smart Trappstege aktiveras i payout (F1.7 ja): behåll tiers men lägg till `await money.getCommission()` i städar-dashboard. Om nej: arkivera hela filen till `docs/archive/commission-trappstege-display-only.js`. | **F1.7** |
| 7 | bli-stadare.html:511 | Marknadsförings-kalkylator. Ersätt med `await fetch('/rest/v1/platform_settings?key=eq.commission_standard')` + fallback. | **F1.9** |
| 8–9 | faktura.html:121,205 | Behåll `b.commission_pct \|\| 17` fallback som **defensive**, MEN `bookings.commission_pct` ska alltid vara satt efter F1.2. 17 som fallback blir dead-code men säker. Efter 90d utan träff: ändra till `throw new Error('commission_pct missing')`. | **F1.9** |
| 10–12 | admin.html:2806-2808 | Samma som faktura.html. Samma 90-dagars defensive-pattern. | **F1.9** |
| 13 | marknadsanalys.html:969-970 | Simuleringsverktyg, ej live-data. Ersätt med hämtning från `platform_settings`. | **F1.9** |
| 14 | cleaners/companies.commission_rate | DB-kolumner. Fas 1: lämna orörda (ignoreras per memory). Fas 9 (VD-autonomi): antingen DROP eller omformatera till decimal + aktivera i hierarki §5 steg 3/4. | **Fas 9** |

**Bonus:** [admin.html:4478-4502](../../admin.html:4478) `markPaid()` ersätts i **F1.4** med fetch mot ny EF `mark-payout-paid`. Admin-UI:t oförändrat (samma knapp), bara backend-vägen refactoras.

---

## 11. Integration-test-plan

Ny katalog `supabase/functions/_tests/money/`. Kör i CI via befintlig workflow `.github/workflows/supabase-tests.yml`.

**Test-suite:**

1. **`commission-hierarchy.test.ts`** — 6 scenarier (varje hierarki-steg + fallback).
2. **`payout-breakdown.test.ts`** — RUT eligible vs ej, solo vs company-cleaner, avrundning (tvinga öres-precision-fel).
3. **`stripe-checkout-parity.test.ts`** — Fullt bokningsflöde i Stripe test mode. Verifiera att `application_fee_amount` matchar `money.calculatePayout().commissionKr * 100`.
4. **`mark-payout-idempotency.test.ts`** — Dubbel-anrop med samma idempotency_key. Andra anropet returnerar `alreadyPaid=true`, ingen DB-ändring.
5. **`reconciliation-mismatch.test.ts`** — Seeda DB med 3 bokningar. Seeda Stripe mock med 2 transfers (1 saknas, 1 belopp-diff). Kör `reconcilePayouts()`. Verifiera 2 mismatches loggas + 0 false-positives.
6. **`rut-yearly-cap.test.ts`** — Kund med 70,000 kr RUT redan använt. Ny bokning på 10,000 kr → 5,000 RUT cappas till 5,000 (74,000 av 75,000 kvar).
7. **`platform-settings-propagation.test.ts`** — Uppdatera commission_standard 12 → 15. Verifiera nästa bokning får 15%, gamla bokningar oförändrade.

**Gate för F1.8 (rivning):** alla 7 test-suits gröna i 10 på rad kör.

---

## 12. Reconciliation-cron design

**Filstruktur:**

```
supabase/functions/payout-reconciliation/
  index.ts          # Deno entry
  _reconcile.ts     # Logik, testbar
  deno.json
```

**Trigger:** GitHub Action `.github/workflows/cron-payout-reconciliation.yml`, schemalagd `0 3 * * *` (03:00 UTC = 04:00/05:00 Stockholm).

**Auth:** `CRON_SECRET` header (samma mönster som `cleanup-stale`, `auto-remind` per [CLAUDE.md](../../CLAUDE.md)).

**Flöde:**

```
1. Hämta bookings från senaste 25h där payment_status='paid'
2. Hämta Stripe /v1/transfers?created[gte]=<25h ago>
3. För varje booking:
     a. Hitta matchande transfer via transfer.metadata.booking_id
     b. Verifiera amountKr ±1 kr
     c. Verifiera booking.payout_status motsvarar
4. Logga alla mismatches till payout_audit_log (severity='alert')
5. Om mismatches > 0: POST till platform_settings.slack_webhook_url
6. Returnera { checked, mismatches, alertsSent }
```

**Payout_audit_log-schema:**

```sql
CREATE TABLE payout_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES bookings(id),
  action TEXT NOT NULL,               -- 'marked_paid' | 'reconcile_mismatch' | 'transfer_created'
  idempotency_key TEXT UNIQUE,        -- för markPayoutPaid
  severity TEXT DEFAULT 'info',       -- 'info' | 'alert' | 'critical'
  amount_kr INT,
  stripe_transfer_id TEXT,
  admin_email TEXT,
  diff_kr INT,                        -- för reconciliation
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 13. Error handling + fallback-regler

| Scenario | money.ts-beteende | Caller-ansvar |
|----------|--------------------|---------------|
| `platform_settings` otillgänglig (DB-fel) | Commission defaultar till 12. Loggas som `source='fallback'`. | Caller: fortsätt bokning men logga warning. |
| Cleaner saknar `stripe_account_id` | `calculatePayout()` kastar `Error('cleaner_missing_stripe_account')`. | Caller (stripe-checkout): avvisa checkout + visa kund-meddelande. |
| Cleaner `stripe_onboarding_status != 'complete'` | `destinationAccountId=null`, payout-belopp ändå beräknat. | Caller: Stripe destination charge faller tillbaka till Spick-kontot. |
| `bookings.cleaner_id` NULL (ej tilldelad) | `calculatePayout()` kastar `Error('booking_not_assigned')`. | Caller (markPaid): avvisa markering. |
| Smart Trappstege flag på men `cleaners.completed_jobs` NULL | Fallback till platform_settings. Loggas. | — |
| RUT yearly cap överskriden mid-year | `calculateRutSplit()` returnerar `rutAmountKr=remainingYearlyCapKr` (kan vara 0). | Caller: visa kund-meddelande "RUT-utrymme slut". |
| Stripe API-fel i `triggerStripeTransfer` | Retry 3× med exponential backoff. Om alla failar → kasta + logga till payout_audit_log. | Caller: admin-alert. |
| Idempotency-konflikt i markPayoutPaid | Returnera `alreadyPaid=true`. Ingen fel. | — |

**Princip:** Money-layer är defensiv vid läsning (fallback till safe default), strikt vid skrivning (kasta om prekondition brister). Aldrig silent drift i payout-beräkning.

---

## 14. Future-proofing: hur Fas 8 (escrow) byggs ovanpå

**Inget refactor av money.ts krävs för Fas 8.** Enbart:

1. Aktivera `platform_settings.escrow_enabled=true`.
2. Refactor `stripe-checkout`: ta bort `transfer_data.destination` (pengarna stannar hos Spick).
3. Ny EF `release-escrow` som anropar `money.triggerStripeTransfer(bookingId)` när:
   - 24h efter `bookings.status='completed'` utan dispute, ELLER
   - Efter `dispute-resolution`-EF kör `resolved` för städar-medhåll.
4. Ny EF `unified-refund` som anropar `money.refund(bookingId, amountKr)` vid kund-medhåll.

**Varför är detta möjligt utan refactor?**

- `money.triggerStripeTransfer()` är redan designad (§4.4), guard:ad bakom `escrow_enabled`.
- `payout_audit_log` har redan `action='transfer_created'`-typ.
- `reconcilePayouts()` matchar redan Stripe Transfer events.

**Fas 5 (Recurring) interop:** Varje bokning i en recurring-serie har egen escrow-hold. `money.triggerStripeTransfer()` anropas per-bokning, inte per-serie. Dispute på bokning N påverkar inte N+1. Detta matchar Fas 5-designen i [spick-arkitekturplan-v3.md:305](../planning/spick-arkitekturplan-v3.md).

---

## 15. Öppna frågor (lös innan F1.2-start)

1. **`cleaners.commission_rate`-kolumn:** Vad är faktiskt format i prod — decimal (0.12) eller procent (12)? Kräver SQL-query. Påverkar F1 bara om vi aktiverar §5 steg 3 i Fas 1 (default: nej, lämnas till Fas 9).
2. **`platform_settings.rut_yearly_cap_kr`:** Finns raden? Verifiera. Om saknas: migration F1.1 lägger till.
3. **`platform_settings.smart_trappstege_enabled`:** Finns raden? Verifiera. Om saknas: F1.7 skapar den (default false).
4. **`bookings.spick_gross_sek` vs beräknad commission:** används som audit-spår? Om inte: sätt den i F1.2 så att alla bokningar efter F1.2 har både `commission_pct` och `spick_gross_sek` lagrat.
5. **Smart Trappstege semantik:** ska "keep"-raten (0.83/0.85/0.87/0.88) räknas på totalt pris eller price_before_rut? [js/commission.js:15-18](../../js/commission.js:15) är tvetydigt. Besluta i F1.7-design.

---

## 16. Regel-efterlevnad

- **Regel #26** (sanity-check): F1.2 testar full kund-booking-flöde i Stripe test mode innan prod-deploy.
- **Regel #27** (primärkälla): alla 14 hardcoded-ställen är fil:rad-verifierade. DB-kolumner verifieras via `information_schema` före F1.1-start.
- **Regel #28** (ingen fragmentering): money.ts blir **enda** vägen för commission/payout. CI-linter (Fas 12) förhindrar regression.
- **Regel #29** (memory är hypoteser): ingen av fakta i detta dokument kommer från memory utan primärkälle-backning. MEMORY.md-referenser är markerade explicit.

---

**Slut.** Nästa steg: F1.1 (utöka pricing-resolver.ts till money.ts) efter Farhads SQL-verifiering av §2.4 + §15.

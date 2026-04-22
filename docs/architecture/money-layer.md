# F1 — Money Layer (Design + Implementation)

**Fas:** F1 i arkitekturplan v3.1
**Skriven:** 2026-04-20
**Senast uppdaterad:** 2026-04-22 (sync mot nuvarande arkitektur efter §1.2/§1.3/§1.4/§1.5/§1.7/§1.9)
**Primärkälla för F1.2–F1.10-implementation**
**Tidsestimat:** 30–50h över vecka 2–5 (per [spick-arkitekturplan-v3.md:133](../planning/spick-arkitekturplan-v3.md) "Fas 1 — Money Layer")
**Beroenden:** Fas 0 (klart). Blockerar: Fas 5 (recurring payout), Fas 8 (escrow), Fas 10 (observability).

---

## §-numrering vs F-numrering

Dokumentet skrevs 2026-04-20 med `F1.X`-notation. v3.1-arkitekturplanen använder `§1.X`. Mappningen är 1:1 — i citerade sektioner (skrivna 2026-04-20) bevaras `F1.X`. I progress-fil + commit-meddelanden används `§1.X`.

| Dok-notation | v3-notation | Beskrivning |
|---|---|---|
| F1.1 | §1.1 | `_shared/money.ts` skelett + helpers |
| F1.2 | §1.2 | stripe-checkout commission-läsning (SUPERSEDED 2026-04-21) |
| F1.3 | §1.3 | stripe-connect `payout_cleaner`-rensning |
| F1.4 | §1.4 | admin.html `markPaid()` → EF |
| F1.5 | §1.5 | Reconciliation-cron + auto-governing |
| F1.6 | §1.6 | Stripe integration-test i CI (ej påbörjad) |
| F1.7 | §1.7 | `js/commission.js` arkivering + helpers |
| F1.8 | §1.8 | Hardcoded hourly-priser → platform_settings (ej påbörjad) |
| F1.9 | §1.9 | Centralisering av `commission_pct\|\|17`-fallback |
| F1.10 | §1.10 | Detta sync-dokument + framtida `commission_rate`-droppning |

---

## Aktiveringsstatus (snabbreferens)

**Feature flag:** `platform_settings.money_layer_enabled='true'` i prod sedan **2026-04-20 19:07 UTC**.

| § | Status | Datum | Verkställelse |
|---|---|---|---|
| §1.1 | ✓ Implementerad | 2026-04-20 | money.ts (1798 rader) + alla helpers + 12 error-klasser |
| §1.2 | ⊘ SUPERSEDED | 2026-04-21 | stripe-checkout EF **raderad** ([§1.2-not](#21-fjorton-hardcoded-money-ställen)). booking-create:604 bär commission-läsningen. |
| §1.3 | ✓ Implementerad | 2026-04-21 | `payout_cleaner`-action **raderad** (91 rader). transfer-logiken finns i `money.ts::triggerStripeTransfer`. |
| §1.4 | ✓ Implementerad | 2026-04-20 | EF `admin-mark-payouts-paid` ersätter admin.html direkt-PATCH. |
| §1.5 | ✓ Implementerad | 2026-04-20 | EF `reconcile-payouts` med pg_cron-trigger + auto-activation/auto-rollback ([se §4.6](#46-reconcilepayouts--periodisk-matchning-mot-stripe)). |
| §1.6 | ◯ Ej påbörjad | – | Stripe integration-test i CI. 4 ignored tester väntar på `STRIPE_SECRET_KEY_TEST`. |
| §1.7 | ✓ Implementerad | 2026-04-20 | `js/commission.js` arkiverad. Smart Trappstege-tiers replikerade i [`money.ts:79-88`](../../supabase/functions/_shared/money.ts) (heltal-format). |
| §1.8 | ◯ Ej påbörjad | – | Hourly-priser 349/350/399 → platform_settings (admin/bli-stadare/join-team). |
| §1.9 | ✓ Implementerad | 2026-04-20 | 17 hardcodes centraliserade i 8 filer via `js/commission-helpers.js` ([se §17](#17-frontend-commission-helpers)). |
| §1.10 | ✓ Implementerad | 2026-04-22 | Detta dok-sync. `cleaners/companies.commission_rate`-droppning kvarstår som framtida migration. |

---

## 1. Översikt + motivation

Skalbarhetsauditen 2026-04-20 (commit `72d082f`) identifierade **money-fragmentering** som audit-prioritet 🔴 #1. Commission och payout-logik är spritt över **14 kod-ställen** med fyra olika numeriska värden (0.12, 0.17, 0.83, 0.88) och två format (decimal vs procent). Silent drift uppstår närhelst `platform_settings.commission_standard` ändras eller Smart Trappstege aktiveras — ingen enda källa till sanning.

**Särskilt kritiskt (2026-04-20-state — ALLA 3 ÅTGÄRDADE per 2026-04-22):**

- [admin.html:4478-4502](../../admin.html:4478) `markPaid()` PATCH:ar `bookings.payout_status='paid'` utan att anropa Stripe. Ingen transfer, ingen verifiering, ingen idempotency. Fungerar vid låg volym eftersom `stripe-checkout` redan gör destination charges vid betalning, men skalar inte: inget audit-trail, ingen reconciliation mot Stripe, silent double-book-risk. **→ ÅTGÄRDAT §1.4 (2026-04-20):** EF `admin-mark-payouts-paid` ersätter direkt-PATCH och anropar `triggerStripeTransfer()` + `markPayoutPaid()` med full audit-trail.
- [stripe-connect/index.ts:142-183](../../supabase/functions/stripe-connect/index.ts:142) `payout_cleaner`-action har **0 anropare** (grep i hela repot: 1 träff = definitionen). Död kod som ser verklig ut → risk att någon aktiverar den och dubbel-transfererar. **→ ÅTGÄRDAT §1.3 (2026-04-21):** `payout_cleaner`-action raderad (91 rader). Transfer-logiken finns nu i `money.ts::triggerStripeTransfer`.
- [stripe-checkout/index.ts:88](../../supabase/functions/stripe-checkout/index.ts:88) hardcodar `company_id ? 0.12 : (customer_type==="foretag" ? 0.12 : 0.17)`. Läser INTE `platform_settings.commission_standard` (verifierat `'12'` 2026-04-20, se Appendix C). **→ ÅTGÄRDAT §1.2 SUPERSEDED (2026-04-21):** stripe-checkout EF raderad helt. booking-create:604 bär kommissions-logiken via `getCommission()` mot `platform_settings`.

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
| 1 | ~~stripe-checkout/index.ts:88~~ | ~~`commissionRate = company_id ? 0.12 : (customer_type === "foretag" ? 0.12 : 0.17)`~~ | ❌ RADERAD 2026-04-21 (§1.2 SUPERSEDED). booking-create bär betalningen. |
| 2 | ~~stripe-connect/index.ts:172~~ | ~~`Math.round(totalKr * 0.83)`~~ | ❌ RADERAD 2026-04-21 (§1.3). `payout_cleaner`-action borttagen. Transfer-logiken finns i `money.ts::triggerStripeTransfer`. |
| 3 | ~~js/commission.js:15~~ | ~~`rate: 0.17, keep: 0.83` (tier "new")~~ | ❌ ARKIVERAD 2026-04-20 (§1.7). Tiers replikerade i [`money.ts:79-88`](../../supabase/functions/_shared/money.ts) (heltal-format). |
| 4 | ~~js/commission.js:16~~ | ~~`rate: 0.15, keep: 0.85` (tier "established")~~ | ❌ ARKIVERAD 2026-04-20 (§1.7). |
| 5 | ~~js/commission.js:17~~ | ~~`rate: 0.13, keep: 0.87` (tier "professional")~~ | ❌ ARKIVERAD 2026-04-20 (§1.7). |
| 6 | ~~js/commission.js:18~~ | ~~`rate: 0.12, keep: 0.88` (tier "elite")~~ | ❌ ARKIVERAD 2026-04-20 (§1.7). |
| 7 | [bli-stadare.html:511](../../bli-stadare.html:511) | `const commission = 0.17;` | 🟡 KVARSTÅR — scope-läckage från §1.9b ([hygien-task i progress-fil](../v3-phase1-progress.md)). |
| 8 | [faktura.html:121](../../faktura.html:121) | `const commissionPct = b.commission_pct \|\| 17;` (kundfaktura) | ✓ Centraliserad §1.9b via `getCommissionPct()`. 17-fallback bevarad som defensive (legacy-data). |
| 9 | [faktura.html:205](../../faktura.html:205) | `const commissionPct = b.commission_pct \|\| 17;` (städarfaktura) | ✓ Centraliserad §1.9b. |
| 10 | [admin.html:2806](../../admin.html:2806) | `Math.round((b.total_price\|\|0) * ((b.commission_pct\|\|17)/100))` (totalProvision) | ✓ Centraliserad §1.9b. |
| 11 | [admin.html:2807](../../admin.html:2807) | Samma fallback (totalPayout) | ✓ Centraliserad §1.9b. |
| 12 | [admin.html:2808](../../admin.html:2808) | Samma fallback (paidOut) | ✓ Centraliserad §1.9b. |
| 13 | [marknadsanalys.html:969-970](../../marknadsanalys.html:969) | `cleanerPh = adjRate * 0.83; spickPh = adjRate * 0.17;` | ✓ Centraliserad §1.9b via `getKeepRate()`/`getCommissionRate()`. |
| 14 | [cleaners.commission_rate](../../supabase/migrations) + [companies.commission_rate](../../supabase/migrations) | 17 cleaners-rader i **4 format** (0, 0.17, 12, 17). companies: default 0.17, 0 egna värden. Obrukbar som single-source (verifierat 2026-04-20, Appendix C). | 🟡 IGNORERAS av money.ts · Droppas i **F1.10** (kvarstående). |

**Sammanfattning 2026-04-22:** 12 av 14 ställen åtgärdade. Kvarstår: rad 7 (bli-stadare hygien-task) + rad 14 (DB-kolumn-droppning, framtida migration).

### 2.2 Payout-pipeline (nuläge per 2026-04-22)

```
Kund betalar
   ↓
booking-create:604           ← läser commission via getCommission(), skapar Stripe-session
                               (stripe-checkout EF raderad §1.2 SUPERSEDED 2026-04-21)
   ↓
Stripe destination charge    ← pengar direkt till cleaners Connect-konto
   ↓
stripe-webhook (succeeded)   ← sätter payment_status='paid', payout_status=null
   ↓
admin → "Markera utbetald"-knapp i admin.html
   ↓
EF admin-mark-payouts-paid   ← ersätter direkt-PATCH (§1.4 2026-04-20)
   ↓
1. triggerStripeTransfer()   ← payout_attempts + Stripe /transfers + idempotency
2. markPayoutPaid()          ← Stripe-verify + bookings.payout_status='paid' + audit
   ↓
payout_audit_log             ← full audit-trail
   ↓
reconcile-payouts EF (cron)  ← matchar dagligen DB ↔ Stripe (§1.5 2026-04-20)
                               auto-rollback vid critical mismatches
                               auto-activation efter 20 clean dry-runs i 24h
```

**Diagram-not (2026-04-22):** Den gamla pipelinen där `payout_status='paid'` betydde "Farhad klickade en knapp" är historik. Idag krävs verifierad Stripe Transfer + audit-insert innan statusen kan sättas. `payout_cleaner`-action raderad §1.3 — transfer-logiken konsoliderad i `money.ts::triggerStripeTransfer`.

### 2.3 Existerande primärkälla

[supabase/functions/_shared/pricing-resolver.ts](../../supabase/functions/_shared/pricing-resolver.ts) (153 rader) är **föregångaren** till money.ts. Den löser:

- Commission från `platform_settings.commission_standard` (fallback 12)
- Pris i 5-stegs hierarki (se §6)

**Designändring 2026-04-22:** Ursprungsplanen sa `resolvePricing()` skulle flyttas in som `_resolveBasePrice()` i money.ts. Detta skedde **inte** — pricing-resolver.ts förblev separat fil och money.ts fokuserar på commission/payout/transfer/RUT. Pricing-lookup är fortsatt pricing-resolver.ts:s ansvar. Båda filerna läser `platform_settings.commission_standard` med samma fallback-mönster (kod-duplicering accepterad eftersom pricing-resolver är defensiv vid pris-fallback medan money.ts är strikt).

### 2.4 Relevanta DB-kolumner (verifierade mot prod 2026-04-20)

SQL-queries kördes 2026-04-20 mot prod. Output + analys finns i **Appendix C**. Detta avsnitt reflekterar verifierat schema.

| Tabell | Kolumner (money-relaterade) | Not |
|--------|------------------------------|-----|
| `platform_settings` | `id` (uuid), `key` (TEXT, **primary key**), `value` (TEXT — kastas till numeric i money.ts via `parseFloat`/`Number`), `updated_at` (timestamptz) | Endast 4 kolumner. Ingen `description`-kolumn. Se §2.4.1 för existerande rader. |
| `cleaners` | `stripe_account_id`, `stripe_onboarding_status`, `company_id`, `is_company_owner`, `hourly_rate`, ~~`commission_rate`~~ | `commission_rate` har 4 format i 17 rader — **IGNORERAS** av money.ts, droppas i F1.10. |
| `companies` | `stripe_account_id`, `use_company_pricing`, `owner_cleaner_id`, ~~`commission_rate`~~ | `commission_rate` default 0.17, 0 egna värden — **IGNORERAS**, droppas i F1.10. |
| `bookings` | `total_price` (int), `commission_pct` (numeric), `spick_gross_sek` (numeric), `spick_net_sek` (numeric), `stripe_fee_sek` (numeric), `rut_amount` (int), `base_price_per_hour` (numeric), `customer_price_per_hour` (numeric), `cleaner_price_per_hour` (numeric), `payment_status` (text), `payout_status` (text), `payout_date` (timestamptz), `stripe_payment_intent_id` (text), `stripe_session_id` (text), `dispute_amount_sek` (int — Fas 8-förberedelse), `manual_override_price` (int — admin-undantag), `refund_amount` (int) | Rikare schema än förväntat. money.ts-API utökas att stödja `dispute_amount_sek`, `manual_override_price`, `refund_amount` från F1.2. |
| `company_service_prices` | `company_id`, `service_type`, `price`, `price_type` | Oförändrat. |
| `cleaner_service_prices` | `cleaner_id`, `service_type`, `price`, `price_type` | Oförändrat. |

#### 2.4.1 Existerande `platform_settings`-rader (verifierade 2026-04-20)

| key | value (TEXT) | Kommentar |
|-----|--------------|-----------|
| `commission_standard` | `'12'` | Sanning. Set 2026-04-17 10:25. |
| `commission_top` | `'12'` | **Duplicering** av `commission_standard`. Auditas i F1.2 — om oanvänd: DROP. |
| `base_price_per_hour` | `'399'` | Default hourly rate. |
| `subscription_price` | `'349'` | Spark-prenumeration. |
| `F1_USE_DB_SERVICES` | `'false'` | Feature flag för Fas 4 (services genomgående). |

**Saknas — F1.2 seed-migration lägger till (default-värden):**

| key | default-value | Syfte |
|-----|---------------|-------|
| `money_layer_enabled` | `'false'` | Huvud-flagga §8. Sätts `'true'` efter 21d parallell-verifiering. |
| `smart_trappstege_enabled` | `'false'` | §5 steg 2. Aktiverar payout-impact i F1.7 (om beslut=ja). |
| `escrow_enabled` | `'false'` | §4.4 + §14. Aktiveras i Fas 8. |
| `rut_pct` | `'50'` | §4.3. 50% RUT-avdrag. Heltal-procent — konsistent med `commission_standard`. |
| `rut_yearly_cap_kr` | `'75000'` | §4.3. Skatteverket-cap 2026. |
| `reconciliation_alert_threshold_kr` | `'1'` | §8. Minsta belopp-diff för Slack-alert. |

**Tillstånd 2026-04-22 (post-aktivering):** följande nycklar har sedan dess skrivits till prod:

| key | value (TEXT) | Kommentar |
|-----|--------------|-----------|
| `money_layer_enabled` | `'true'` | Aktiverad 2026-04-20 19:07 UTC. |
| `payout_trigger_mode` | `'immediate'` | Krävs av `triggerStripeTransfer()` för auto-trigger utan `force=true`. |
| `stripe_mode` | `'live'` | Mode-isolation för Fas 1.6.1. `getStripeClient()` väljer nyckel baserat på denna + `cleaner.is_test_account`. |
| `smart_trappstege_enabled` | `'false'` | Seedad enligt plan. Aktivering kräver beslut + tier-data per cleaner. |

**Implementations-not för money.ts:** eftersom `platform_settings.value` är TEXT, alla läsningar måste kasta:

```ts
const raw = row.value;  // 'string'
const parsed = parseFloat(raw);
if (Number.isNaN(parsed)) throw new Error(`platform_settings.${key} not numeric: ${raw}`);
```

Detta mönster finns redan i [pricing-resolver.ts:60-61](../../supabase/functions/_shared/pricing-resolver.ts:60) och återanvänds i money.ts.

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

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.1). [`money.ts:390-412`](../../supabase/functions/_shared/money.ts).

**Faktisk signatur (snake_case, konsistent med bookings-schema):**

```ts
export type CommissionContext = {
  booking_id?: string;
  cleaner_id?: string;
  company_id?: string | null;
  customer_type?: 'privat' | 'foretag';
  /** override för Smart Trappstege om aktiv */
  completed_jobs?: number;
};

export type CommissionResult = {
  pct: number;       // heltal-procent (ex. 12 betyder 12%) — INTE decimal
  source: 'platform_settings'
        | 'company_override'
        | 'cleaner_override'
        | 'smart_trappstege'
        | 'manual_override'
        | 'fallback';
  tier?: 'new' | 'established' | 'professional' | 'elite';
};

export async function getCommission(
  supabase: SupabaseClient,
  context: CommissionContext
): Promise<CommissionResult>
```

**Hierarki:** se §5. Implementationsstatus per steg är markerad i [money.ts JSDoc](../../supabase/functions/_shared/money.ts) (rad 367-389).

**Format-not (Regel #28):** `pct` är **heltal-procent** (12, 17), INTE decimal (0.12, 0.17). Konsistent med `platform_settings.commission_standard='12'` och `bookings.commission_pct`. Frontend-kod som `js/commission.js` använde decimal `0.17` — frontend-konsumenter använder nu `js/commission-helpers.js` som exponerar både heltal-procent (`getCommissionPct()`) och decimal (`getKeepRate()`/`getCommissionRate()`).

### 4.2 `calculatePayout(booking)` — Payout-beräkning

**Status:** Implementerad F1.4 ([commit efter 9813030](../../supabase/functions/_shared/money.ts)). Pure function, ingen DB-write. Per Farhads beslut 2026-04-20: Stripe destination charges-modell, **Spick betalar Stripe-fees** (dras från `spick_net`).

```ts
// Faktiskt implementerat (snake_case, konsistent med bookings-schema)
export type PayoutBreakdown = {
  total_price_sek: number;
  commission_pct: number;
  commission_sek: number;
  stripe_fee_sek: number;
  cleaner_payout_sek: number;
  spick_gross_sek: number;
  spick_net_sek: number;
};

export async function calculatePayout(
  supabase: SupabaseClient,
  booking_id: string
): Promise<PayoutBreakdown>
```

**Not om scope:** F1.4 håller typen minimal (7 fält). Utökning med `destinationAccountId`, `rutAmountKr`, `source` sker först när triggerStripeTransfer (F1.6) + RUT-integration (F1.5) behöver dem. Fragmentering undviks — fält läggs till per konsument, inte spekulativt.

**Formel (Stripe destination charges, Spick betalar fees):**

```
commission_sek     = round(total_price * commission_pct / 100)
stripe_fee_sek     = bookings.stripe_fee_sek ?? 0
cleaner_payout_sek = total_price − commission_sek
spick_gross_sek    = commission_sek
spick_net_sek      = commission_sek − stripe_fee_sek
```

**Invariant (verifieras varje anrop):**

```
cleaner_payout_sek + spick_net_sek + stripe_fee_sek === total_price
```

Matematiskt en identitet. Invariant-check fångar data-korruption (NaN-propagering) som inte fångas av typ-validering.

**Frozen commission:** `bookings.commission_pct` är sanning. Satt vid bokningsskapande (F1.3 `getCommission()` i `booking-create`). `calculatePayout()` räknar aldrig om — endast fallback till `getCommission()` om kolumnen är NULL (legacy-data). Plattformen-ändring av `commission_standard` påverkar ALDRIG befintliga bokningar.

**Fallback-beteenden (med `console.warn`):**

| Scenario | Beteende |
|----------|----------|
| `stripe_fee_sek` NULL | Default 0. Vanligt för gamla bokningar pre-F1.2. |
| `commission_pct` NULL | Fallback till `getCommission(ctx)`. Borde ej inträffa efter F1.2. |

**Error-typer (alla exporterade):**

| Klass | När |
|-------|-----|
| `MoneyLayerDisabled` | `money_layer_enabled='false'`. Caller faller tillbaka till legacy. |
| `BookingNotFound` | `booking_id` finns ej. Fel booking_id från caller. |
| `PayoutCalculationError` | Ogiltigt `total_price` (NULL/0/negativ/NaN), icke-numeriskt `commission_pct`/`stripe_fee_sek`, eller bruten invariant. Innehåller `details`-object med full kontext. |

**Avrundning:** Endast commission använder `Math.round()`. Cleaner-utbetalning = `total − commission` (exakt, inga öres-drift). All matematik i SEK (heltal). Öre-konvertering sker endast vid Stripe-anrop i F1.6.

**Testning:** [`supabase/functions/_tests/money/payout-calculation.test.ts`](../../supabase/functions/_tests/money/payout-calculation.test.ts) täcker 12 scenarier (feature flag, booking not found, 3 invalid-input-fall, 4 happy paths inkl. rounding, 2 fallback-warn-fall, 1 data-korruption). Kör med:

```bash
deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
  supabase/functions/_tests/money/
```

### 4.3 `calculateRutSplit(gross_sek, eligible)` — RUT-split

**Status:** Implementerad F1.5 ([commit efter 8c1abe6](../../supabase/functions/_shared/money.ts)). Pure function, ingen DB-write. Skatteverket 2026: 50% av arbetskostnad, 75000 kr/år/person tak.

```ts
// Faktiskt implementerat (snake_case, pos-argument istället för params-objekt)
export type RutSplit = {
  gross_sek: number;
  rut_eligible: boolean;
  rut_amount_sek: number;
  customer_paid_sek: number;
  rut_claim_amount_sek: number;
};

export async function calculateRutSplit(
  supabase: SupabaseClient,
  gross_sek: number,
  eligible: boolean
): Promise<RutSplit>
```

**Not om scope (Regel #28):** F1.5-signatur tar `eligible` som boolean — caller avgör RUT-grundande-status (idag via hardcodad service-lista i `booking-create`, framtida via `services.rut_eligible` i Fas 4). `customerId` / historisk cap-enforcement är F1.5.1 (se §4.3.1 nedan). Minimal yta nu, utökas per konsument.

**Formel (heltal-procent):**

```
rut_amount_sek       = Math.floor(gross_sek * rut_pct / 100)
customer_paid_sek    = gross_sek − rut_amount_sek
rut_claim_amount_sek = rut_amount_sek
```

`Math.floor` = Skatteverket-säkert (aldrig runda UPP RUT-andelen → 0 overclaim-risk). `rut_pct` lagras som **heltal-procent** (`'50'`) i `platform_settings`, konsistent med `commission_standard`-mönstret.

**Invariant (verifieras varje anrop):**

```
customer_paid_sek + rut_amount_sek === gross_sek
```

Matematiskt en identitet. Invariant-check fångar NaN-drift (t.ex. `rut_pct='Infinity'` → rut=Infinity → customer=-Infinity → sum=NaN → throw).

**Eligible-gren:** Om `eligible=false` returneras `rut_amount=0`, `customer_paid=gross`, oavsett `rut_pct`. Garanterat skydd för kontorsstädning/byggstädning.

**Per-bokning cap-warning:** Om `rut_amount_sek > rut_yearly_cap_kr` loggas `console.warn`. Ingen hard block — historisk kund-cap-enforcement i §4.3.1.

**Error-typer (alla exporterade):**

| Klass | När |
|-------|-----|
| `MoneyLayerDisabled` | `money_layer_enabled='false'`. |
| `InvalidRutAmount` | `gross_sek <= 0` eller NaN. |
| `RutSplitError` | Bruten invariant (data-korruption i `rut_pct`). Innehåller `details`-object. |

**Testning:** [`supabase/functions/_tests/money/rut-split.test.ts`](../../supabase/functions/_tests/money/rut-split.test.ts) täcker 14 scenarier (flag, eligible-gren, Math.floor-kanter 1/2/3/999, rut_pct=0/50/100, gross=0/negativ/>1M, rut_pct=Infinity invariant-brott, eligible=false override). 44 pass över hela money/-svit.

### 4.3.1 Framtida: historisk kund-cap-enforcement (F1.5.1)

F1.5 implementerar **per-bokning** soft-warning men INTE hard-enforcement av 75000 kr/år/person-taket. Skatteverket fångar överclaim vid deklaration — Spick kan inte tappa pengar på det.

**Varför inte nu:** Kräver kund-cap-SUM över året, vilket kräver:
- `customer_id` som säker identifierare (email/personnummer/auth_user_id?)
- SELECT SUM(`rut_amount_sek`) FROM `bookings` WHERE customer=X AND year=N
- Recurring-serie-interop (Fas 5): varje bokning räknas mot rätt år vid årsskifte

**Implementeras i F1.5.1 när:**
- Kund-identifierare är stabil (post-F4 Unified Identity eller motsvarande)
- Primärkälla för `customer_id` på bookings verifierad mot prod-schema
- Recurring-cron (Fas 5) är operationell så årsskifts-logik kan testas end-to-end

**Signatur när implementerad:**

```ts
export async function calculateRutSplit(
  supabase: SupabaseClient,
  gross_sek: number,
  eligible: boolean,
  opts?: { customer_id?: string; year?: number }  // F1.5.1-utökning
): Promise<RutSplit>
// RutSplit får då extra fält: remaining_yearly_cap_kr, capped_this_booking
```

Nuvarande `opts`-lös signatur är framåt-kompatibel — befintliga callers behöver inte ändras när F1.5.1 landar.

### 4.4 `triggerStripeTransfer(booking)` — Separate-transfer

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.6). Aktiv i prod sedan §1.4 (admin-mark-payouts-paid EF anropar denna).

**Faktisk signatur:**

```ts
export async function triggerStripeTransfer(
  supabase: SupabaseClient,
  booking_id: string,
  opts?: {
    idempotency_key?: string;
    force?: boolean;                   // override payout_trigger_mode-check
    _stripeRequest?: StripeRequestFn;  // DI för tester
  }
): Promise<PayoutAuditEntry>
```

**Aktuell guard (2026-04-22):** Funktionen är inte längre guard:ad bakom `escrow_enabled` (det var Fas 8-planen). Den primära guarden är **`platform_settings.payout_trigger_mode='immediate'`** plus den globala `money_layer_enabled='true'`. När `force=true` kan auto-trigger-checken bypassas (används av admin-mark-payouts-paid när admin manuellt initierar).

**9-stegs flöde** (per [`money.ts:744-1057`](../../supabase/functions/_shared/money.ts)):

1. Feature flag (`money_layer_enabled`) — `MoneyLayerDisabled` om inaktiv.
2. `payout_trigger_mode`-check (om !force) — `TransferPreconditionError` om ej `'immediate'`.
3. Fetch booking + pre-condition validering (`payment_status='paid'`, `total_price > 0`).
4. Idempotency: om `payout_status='paid'` + audit finns → return existing entry.
5. Fetch cleaner + Stripe Connect-verifiering (`stripe_account_id` + `stripe_onboarding_status='complete'`).
6. Beräkna `attempt_count` + idempotency_key (`payout-{booking_id}-{attempt_count}`).
7. `calculatePayout()` för belopp.
8. Insert `payout_attempts` (status=pending) → POST `/transfers` med Idempotency-Key.
9. Success: update attempts (status=paid) + insert audit (`action='transfer_created'`).
   Fel: log failure + throw `TransferFailedError`.
   DB-fel efter Stripe-success: `createReversal` + throw `TransferReversedError` (kritisk).

**Mode-isolation (Fas 1.6.1):** [`getStripeClient()`](../../supabase/functions/_shared/stripe-client.ts) väljer rätt API-nyckel baserat på `cleaner.is_test_account` + `platform_settings.stripe_mode`.

**Separation of concerns:** `triggerStripeTransfer` sätter INTE `bookings.payout_status` — det gör `markPayoutPaid()` (§4.5).

**Escrow (Fas 8):** Funktionen är förberedd för escrow-mönstret. När `escrow_enabled=true` aktiveras i Fas 8 sker `triggerStripeTransfer()` av `release-escrow`-EF efter completion-väntetid (24h utan dispute) i stället för av admin-mark-payouts-paid.

### 4.5 `markPayoutPaid(bookingId)` — Bekräftar + uppdaterar bookings

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.7).

**Artefakter:**
- Implementation: [`money.ts:markPayoutPaid`](../../supabase/functions/_shared/money.ts)
- Tester: [`_tests/money/mark-payout-paid.test.ts`](../../supabase/functions/_tests/money/mark-payout-paid.test.ts) (12 scenarier)

```ts
export async function markPayoutPaid(
  supabase: SupabaseClient,
  booking_id: string,
  opts?: {
    skip_stripe_verify?: boolean;  // bypass GET /transfers/{id}-verifiering
    admin_user_id?: string;        // audit-trail (details.admin_user_id)
    force?: boolean;               // trigger + mark i en operation
    _stripeRequest?: StripeRequestFn;  // DI för tester
  }
): Promise<PayoutAuditEntry>
```

**Separation of concerns** (Fas 1.6 §3.5):
- Fas 1.6 `triggerStripeTransfer`: skickar pengar via Stripe `/transfers`
- Fas 1.7 `markPayoutPaid`: bekräftar transfer + uppdaterar `bookings`

**Kontroll-flöde (10 steg):**

1. Feature flag (`money_layer_enabled`) — `MoneyLayerDisabled` om inaktiv.
2. Fetch booking — `BookingNotFound` om saknas. Validera `payment_status='paid'`.
3. Idempotency: om `payout_status='paid'` + audit finns → return existing entry. Self-healing om audit saknas (legacy-markPaid från admin.html).
4. Fetch senaste `payout_attempts`:
   - Saknas + `!force` → `PayoutPreconditionError`
   - Saknas + `force=true` → kör `triggerStripeTransfer()` + rekursiv `markPayoutPaid()`
   - `status !== 'paid'` → `PayoutPreconditionError`
5. Fetch cleaner (för `getStripeClient` mode-selection).
6. (Om `!skip_stripe_verify`) Verifiera Stripe Transfer via GET `/transfers/{id}`:
   - `reversed === true` → `PayoutVerificationError`
   - `amount !== expected_ore` → `PayoutVerificationError`
7. UPDATE `bookings SET payout_status='paid', payout_date=now()` — `PayoutUpdateError` vid fel.
8. INSERT `payout_audit_log` (`action='payout_confirmed'`, `severity='info'`).
9. Return `PayoutAuditEntry` (status='paid').

**Error-klasser** (nya i Fas 1.7):
- `PayoutPreconditionError` — precond brytna
- `PayoutVerificationError` — Stripe mismatch eller reversal
- `PayoutUpdateError` — DB-fel vid bookings-update eller audit-insert

**Idempotent:** safe att köra flera gånger. Rekursiv `force`-variant terminerar pga idempotency-check i steg 3 / attempt-check i steg 4.

**Ersätter:** [admin.html:4478-4502](../../admin.html:4478) som idag gör direkt PATCH med anon-nyckel. Konsument-migrering sker i Fas 1.10.

### 4.6 `reconcilePayouts()` — Periodisk matchning mot Stripe

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.8).

**Artefakter:**
- Implementation: [`money.ts:reconcilePayouts`](../../supabase/functions/_shared/money.ts)
- Tester: [`_tests/money/reconcile-payouts.test.ts`](../../supabase/functions/_tests/money/reconcile-payouts.test.ts) (15 scenarier)
- Design-dok: [`fas-1-8-reconciliation-design.md`](fas-1-8-reconciliation-design.md)

```ts
export async function reconcilePayouts(
  supabase: SupabaseClient,
  opts?: {
    since_days?: number;      // default 7
    max_transfers?: number;   // default 100
    max_api_calls?: number;   // default 50
    dry_run?: boolean;        // inga audit-writes
    _stripeRequest?: StripeRequestFn;
  }
): Promise<ReconciliationReport>
```

**Schemaläggning (aktiv 2026-04-20):** pg_cron `'5 * * * *'` → EF [`reconcile-payouts`](../../supabase/functions/reconcile-payouts/index.ts) → anropar `reconcilePayouts()`.

**Self-governing features (i `reconcile-payouts/index.ts`, INTE i money.ts):**

EF:n innehåller två autonoma kontrollmekanismer som agerar baserat på reconciliation-resultaten:

1. **Auto-rollback vid critical mismatches:** Om `money_layer_enabled='true'` och rapporten innehåller minst en `severity='critical'` mismatch:
   - `UPDATE platform_settings SET value='false' WHERE key='money_layer_enabled'`
   - INSERT audit `action='auto_rollback_triggered', severity='critical'`
   - Effekt: nästa anrop till money.ts kastar `MoneyLayerDisabled` → systemet återgår till legacy-mode inom 1 cron-cykel.

2. **Auto-activation efter clean dry-runs:** Om `money_layer_enabled='false'` och rapporten är 0 mismatches:
   - Räknar antalet `reconciliation_completed`-audits med `mode='dry_run'` + `mismatches_count=0` i senaste 24h.
   - Vid `cleanRuns >= 20` (`AUTO_ACTIVATION_CLEAN_RUNS_THRESHOLD`):
     - `UPDATE platform_settings SET value='true' WHERE key='money_layer_enabled'`
     - INSERT audit `action='auto_activation_triggered', severity='info'`

**Konstanter:**
```ts
const AUTO_ACTIVATION_CLEAN_RUNS_THRESHOLD = 20;  // ~20 timmar clean
const AUTO_ACTIVATION_HOURS_WINDOW = 24;
```

**Designnot:** Auto-activation/rollback är medvetet placerade i EF-lagret, inte i `money.ts`-funktionen. Kärn-funktionen `reconcilePayouts()` förblir pure (ingen feature-flag-mutation) — alla side effects som styr globalt tillstånd är cron-EF:s ansvar. Hygien-task: avvikelse mot v3.md som inte dokumenterar auto-governing.

**6 mismatch-typer** (enligt `MismatchType`):
- `stripe_paid_db_pending` (alert) — Stripe paid, DB pending
- `stripe_reversed_db_paid` (critical) — Stripe reversed men DB tror paid
- `db_paid_stripe_missing` (critical) — DB paid, Stripe GET returnerar 404
- `amount_mismatch` (critical) — belopp skiljer (`diff_kr` loggas)
- `no_local_attempt` (alert) — Stripe har, DB saknar
- `stale_pending` (alert) — DB pending > 48h

**Inga nya DB-tabeller** — skriver till befintlig `payout_audit_log` med `action='reconciliation_mismatch'` eller `'reconciliation_completed'`.

**Idempotens:** `run_id + stripe_transfer_id` i `details`-JSON. Dubbel-run skippar duplikat-audits.

**Rate-limit-skydd:** `max_api_calls=50` default, abort vid 80% → `errors: ['rate_limit_approaching']`.

**Auto-heal: NEJ.** Bara flagga. Admin granskar + fixar manuellt (F1.10 UI).

**Nya error-klasser:**
- `ReconcileConfigError` — Stripe auth failar (401)
- `ReconcilePermissionError` — RLS blockerar service_role-writes

### 4.7 `isMoneyLayerEnabled()` — Feature-flag helper

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.1). [`money.ts:1792-1797`](../../supabase/functions/_shared/money.ts).

```ts
export async function isMoneyLayerEnabled(
  supabase: SupabaseClient
): Promise<boolean>
```

Läser `platform_settings.money_layer_enabled` och returnerar `true` om värdet är strängen `'true'`. Används av samtliga publika money.ts-funktioner som steg 0/1-guard. Exporterad publikt för callers som behöver gate:a sina egna anrop (t.ex. `reconcile-payouts/index.ts` använder den för att avgöra `dry_run`-mode).

### 4.8 Error-klasser-katalog

12 exporterade error-klasser. Alla har en `details: Record<string, unknown>`-property utom `MoneyLayerDisabled` och `BookingNotFound`.

| Klass | Anrop | Kategori |
|---|---|---|
| `MoneyLayerDisabled` | Alla publika funktioner när flag=false | Feature flag |
| `BookingNotFound` | calculatePayout, triggerStripeTransfer, markPayoutPaid | Lookup |
| `PayoutCalculationError` | calculatePayout (data-korruption, bruten invariant) | Beräkning |
| `InvalidRutAmount` | calculateRutSplit (`gross_sek <= 0`) | Validering |
| `RutSplitError` | calculateRutSplit (bruten invariant) | Beräkning |
| `TransferPreconditionError` | triggerStripeTransfer (state-fel pre-Stripe) | Transfer |
| `TransferFailedError` | triggerStripeTransfer (Stripe avvisar) | Transfer |
| `TransferReversedError` | triggerStripeTransfer (DB-fel post-Stripe → reversal) | Transfer (kritisk) |
| `PayoutPreconditionError` | markPayoutPaid (saknad attempt, fel status) | Markering |
| `PayoutVerificationError` | markPayoutPaid (Stripe transfer reversed/missing/amount mismatch) | Markering |
| `PayoutUpdateError` | markPayoutPaid (DB-fel) | Markering |
| `ReconcileConfigError` | reconcilePayouts (Stripe auth 401) | Reconciliation |
| `ReconcilePermissionError` | reconcilePayouts (RLS blockerar audit-insert) | Reconciliation |

Klassificering hjälper callers (admin-mark-payouts-paid EF) avgöra retry-strategi: precondition-fel = fixa input + retry, transfer-fel = retry med ny idempotency_key, reversed = manuell incident-hantering.

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

**Regel #28 (uppdaterad 2026-04-22):** Smart Trappstege är **kod-implementerad** i `money.ts:79-88` + `_resolveSmartTrappstege()` (steg 2 ovan), men **inaktiv i prod** (`platform_settings.smart_trappstege_enabled='false'`). Aktivering kräver beslut om tier-zon-data per cleaner. Den ursprungliga `js/commission.js` är arkiverad §1.7 — frontend-display av tiers behövs en omdesign innan trappstegen aktiveras i payout, annars riskeras drift mellan "vad städaren ser" och "vad städaren får".

---

## 6. Pricing-lookup-hierarki

**Uppdaterad 2026-04-24 (Sprint 1 Dag 2):** 6-stegs-hierarki med min-pris-guard + services-fallback (hygien #30-fix). Ursprungsplanen sa `_resolveBasePrice()` skulle flyttas in i money.ts — det skedde **inte**. pricing-resolver.ts är fortsatt egen fil och egen import för callers (booking-create m.fl.).

```
1. company_service_prices (om companies.use_company_pricing=true)     → source='company_prices'
2. cleaner_service_prices (individpris)                                → source='cleaner_prices'
3. company_service_prices (fallback oavsett flaggan)                   → source='company_prices'
4. cleaners.hourly_rate — ENDAST om >= platform_settings.min_hourly_rate → source='hourly_rate'
5. services.default_hourly_price (NY Sprint 1 Dag 2)                   → source='service_default'
6. platform_settings.base_price_per_hour (default 399)                 → source='fallback'
```

**Min-pris-guard (Sprint 1 Dag 2):** Läser `platform_settings.min_hourly_rate` (default 200). Skyddar mot testdata/misstag där cleaner satt för lågt pris. Cleaners under min-gränsen faller genom till services.default_hourly_price istället för att debitera kund orimligt.

**Hygien #30-fix:** Fönsterputs-testbokning 681aaa93 (2026-04-23) debiterades 100 kr/h (cleaner-solo-dubbletten) istället för 349 kr/h. Efter fix: cleaner.hourly_rate=100 → under min 200 → services.default_hourly_price=349 används.

Returnerar `PricingResult { basePricePerHour, pricePerSqm, priceType, source, commissionPct }`.

**Ansvarsfördelning:** pricing-resolver.ts löser **pris-per-tjänst per cleaner**. money.ts löser **commission/payout/transfer/RUT**. Båda läser `platform_settings.commission_standard` med samma fallback-mönster (kod-duplicering accepterad — pricing-resolver är defensiv vid pris-fallback medan money.ts är strikt vid commission-läsning).

---

## 7. Stripe-integration

### 7.1 Destination charges (nuvarande)

**Uppdaterat 2026-04-22:** `stripe-checkout` EF är **raderad** (§1.2 SUPERSEDED). Destination charge-mönstret bibehålls men flyttat till [`booking-create:604`](../../supabase/functions/booking-create/index.ts):

```ts
{
  payment_intent_data: {
    application_fee_amount: commissionOre,
    transfer_data: { destination: cleanerStripeAccountId },
  }
}
```

`commissionOre` beräknas via `getCommission()` mot `platform_settings.commission_standard` — **inte** hardcoded `0.12/0.17`.

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

**Central flag:** `platform_settings.money_layer_enabled` (TEXT `'true'`/`'false'`).

**Aktuellt tillstånd 2026-04-22:** `'true'` sedan **2026-04-20 19:07 UTC**.

```
false (legacy-mode):
  money.ts-funktioner kastar MoneyLayerDisabled.
  Callers (admin-mark-payouts-paid EF, booking-create) fångar och
  faller tillbaka till legacy-kodvägar där sådana finns kvar.
  reconcile-payouts kör i dry_run-mode.

true (aktivt idag):
  booking-create anropar money.getCommission() mot platform_settings.
  admin-mark-payouts-paid EF anropar triggerStripeTransfer + markPayoutPaid.
  reconcile-payouts kör i live-mode.
  faktura.html + admin.html läser bokningens lagrade commission_pct
    via js/commission-helpers.js (oförändrad defensive 17-fallback).
```

**Underflaggor (faktiska namn i prod):**
- `smart_trappstege_enabled` (TEXT) — aktiverar §5 steg 2 i `_resolveSmartTrappstege()`. Default `'false'`.
- `payout_trigger_mode` (TEXT `'immediate'`) — krävs av `triggerStripeTransfer()` för auto-trigger utan `force=true`.
- `stripe_mode` (TEXT `'live'`/`'test'`) — mode-isolation för Fas 1.6.1 (per cleaner via `is_test_account`).
- `escrow_enabled` (bool) — Fas 8 (ej aktiv).
- `reconciliation_alert_threshold_kr` (int, default 1) — minsta belopp-diff för Slack-alert.

**Varför flag:** produktionsincident-risk. Om money.ts har bug i första veckan → `UPDATE platform_settings SET value='false' WHERE key='money_layer_enabled'` → tillbaka till gamla kod-path inom 30 sekunder. **Auto-rollback** (§4.6) gör detta automatiskt vid critical mismatches.

---

## 9. Rollout-plan (historisk — leverans 2026-04-20)

Ursprungsplan från 2026-04-20:

> **Vecka 2–3 (F1.1–F1.3):** Bygg money.ts + `payout_audit_log`-migration + `mark-payout-paid` EF. Ingen prod-ändring. Unit-tester + integration-test i Stripe test mode.
>
> **Vecka 4 (F1.4–F1.6):** Deploya money.ts, guard:ad bakom `money_layer_enabled=false`. Parallell-skriv: varje gång stripe-checkout/faktura anropas, **även** kör money.ts och logga till `payout_audit_log` om avvikelse. Larm om > 0 avvikelser.
>
> **Vecka 5 (F1.7–F1.10):** Efter 14 dagars 0-avvikelse: `UPDATE platform_settings SET value='true' WHERE key='money_layer_enabled'`. Övervaka 7 dagar. Om OK → tas hardcoded-koden bort i F1.8–F1.9 (single commit, revertable).
>
> **Total parallell-period:** 21 dagar. Rivning först efter zero-issue-period. Inget big-bang.
>
> **Rollback:** flag-toggle (< 1 min) eller revert av rivnings-commit (< 5 min).

**Faktiskt utfall 2026-04-22:** §1.1–§1.5 + §1.7 + §1.9 levererade på en sprint istället för 4 veckor. Aktivering 2026-04-20 19:07 UTC efter dry-run-period (auto-activation triggades efter 20 clean dry-runs i 24h, ej manuell SQL). §1.2 superseded:ades — stripe-checkout-EF raderades helt 2026-04-21 i stället för parallell-skriv. §1.3 raderade death code samma dag. §1.6 (CI-integration-test) + §1.8 (hourly-priser) kvarstår.

---

## 10. Migration-plan per hardcoded-ställe

Status per 2026-04-22: 12 av 14 åtgärdade.

| # | Fil:rad | Migration-strategi | F-uppgift | Status |
|---|---------|---------------------|-----------|--------|
| 1 | ~~stripe-checkout:88~~ | Hela EF raderad i stället. booking-create:604 läser via getCommission(). | **F1.2** | ⊘ SUPERSEDED 2026-04-21 |
| 2 | ~~stripe-connect:172~~ | `payout_cleaner`-action raderad (91 rader). Transfer-logiken i money.ts. | **F1.3** | ✓ 2026-04-21 |
| 3–6 | ~~js/commission.js:15-18~~ | js/commission.js arkiverad. Tiers replikerade i `money.ts:79-88` (heltal-format). | **F1.7** | ✓ 2026-04-20 |
| 7 | [bli-stadare.html:511](../../bli-stadare.html:511) | `const commission = 0.17;` — marknadsförings-kalkylator. **Ej fixad i §1.9b** (scope-läckage). | **F1.9** | 🟡 Hygien-task |
| 8–9 | faktura.html:121,205 | Centraliserade via `getCommissionPct()` från `js/commission-helpers.js`. 17-fallback bevarad som defensive. | **F1.9** | ✓ 2026-04-20 |
| 10–12 | admin.html:2806-2808 | Samma som faktura.html — `getCommissionPct()` med 17-fallback. | **F1.9** | ✓ 2026-04-20 |
| 13 | marknadsanalys.html:969-970 | Centraliserat via `getKeepRate()`/`getCommissionRate()`. | **F1.9** | ✓ 2026-04-20 |
| 14 | cleaners/companies.commission_rate | **IGNORERAS** av money.ts från F1.2. Kolumnerna droppas i **F1.10** (prod-verifierat 2026-04-20: 4 format i cleaners, 0 egna värden i companies = obrukbar single-source). Per-entitet commission-override implementeras istället via framtida `cleaners.commission_pct_override` / `companies.commission_pct_override` (decimal procent, strikt format) när §5 steg 3/4 aktiveras. | **F1.10** | ◯ Kvarstår |

**Bonus (status uppdaterad 2026-04-22):** [admin.html:4478-4502](../../admin.html:4478) `markPaid()` ersattes i **F1.4** med fetch mot EF [`admin-mark-payouts-paid`](../../supabase/functions/admin-mark-payouts-paid/index.ts). Admin-UI oförändrat (samma knapp), backend-vägen refactorad till `triggerStripeTransfer()` + `markPayoutPaid()`. ✓ 2026-04-20.

---

## 11. Integration-test-plan

Katalog `supabase/functions/_tests/money/`. Kör med `deno task test:money` (definierad i [`deno.json`](../../deno.json)).

**Faktiska test-suites 2026-04-22 (100 pass, 4 ignored):**

1. **[`commission-hierarchy.test.ts`](../../supabase/functions/_tests/money/commission-hierarchy.test.ts)** — 6 hierarki-scenarier + fallback.
2. **[`payout-calculation.test.ts`](../../supabase/functions/_tests/money/payout-calculation.test.ts)** — 12 scenarier (feature flag, booking not found, invalid input, happy paths inkl. rounding, fallback-warn-fall, data-korruption).
3. **[`rut-split.test.ts`](../../supabase/functions/_tests/money/rut-split.test.ts)** — 14 scenarier (Math.floor-kanter, rut_pct=0/50/100, gross-extremer, eligible-override).
4. **[`mark-payout-paid.test.ts`](../../supabase/functions/_tests/money/mark-payout-paid.test.ts)** — 12 scenarier (idempotency, force-mode, Stripe-verify, self-healing).
5. **[`reconcile-payouts.test.ts`](../../supabase/functions/_tests/money/reconcile-payouts.test.ts)** — 15 scenarier (alla 6 mismatch-typer + rate-limit + dry_run).
6. **[`stripe-transfer.test.ts`](../../supabase/functions/_tests/money/stripe-transfer.test.ts)** — 16 scenarier (mock Stripe, idempotency, retries, reversals).
7. **[`stripe-transfer-integration.test.ts`](../../supabase/functions/_tests/money/stripe-transfer-integration.test.ts)** — 4 ignored tester. Kräver `STRIPE_SECRET_KEY_TEST` för aktivering. Detta är §1.6-väntande arbete.

**Total:** 100 pass + 4 ignored. Testerna gate:r alla §1.X-commits sedan 2026-04-20.

**Avvikelse mot ursprungsplan:** `stripe-checkout-parity.test.ts` skulle verifierat `application_fee_amount`-konsistens — superseded:ad eftersom stripe-checkout EF raderats. `platform-settings-propagation.test.ts` är inte separat suite utan täcks av `commission-hierarchy.test.ts` (steg 5).

---

## 12. Reconciliation-cron design

**Faktisk filstruktur 2026-04-22:**

```
supabase/functions/reconcile-payouts/
  index.ts          # Deno entry, 188 rader
                    # innehåller auto-rollback + auto-activation (se §4.6)
```

(Ursprungsplanens namn `payout-reconciliation/` användes inte — slutligt namn `reconcile-payouts/` matchar money.ts-funktionen `reconcilePayouts()`.)

**Trigger:** pg_cron, hourly (`'5 * * * *'`). **Ej** GitHub Action (ändring vs ursprungsplan — pg_cron ger lägre latens och mindre drift mot DB-tillstånd).

**Auth:** JWT-role-check (`service_role` eller `authenticated`). Robusthet mot Supabase API-generationsbyte (2026-04-20). Inte CRON_SECRET-pattern eftersom pg_cron tillhandahåller service_role-JWT direkt.

**Flöde (faktiskt):** Se `reconcilePayouts()`-implementation [§4.6](#46-reconcilepayouts--periodisk-matchning-mot-stripe). 6 mismatch-typer, idempotens via `run_id`, rate-limit-skydd, ingen auto-heal — bara flagga.

**Self-governing (i EF, inte money.ts):** Auto-rollback vid critical mismatches, auto-activation efter 20 clean dry-runs i 24h. Konstanter och beteende dokumenterade i §4.6.

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
| `money_layer_enabled='false'` | Alla publika funktioner kastar `MoneyLayerDisabled`. | Caller: fångar och faller tillbaka till legacy (där sådan finns). |
| `platform_settings` otillgänglig (DB-fel) | `getCommission()` defaultar till 12 (`source='fallback'`). | Caller: fortsätt bokning men logga warning. |
| `bookings.commission_pct` NULL | `calculatePayout()` faller tillbaka till `getCommission()` + `console.warn`. | — (legacy-data, eliminerad efter §1.4). |
| `bookings.stripe_fee_sek` NULL | `calculatePayout()` defaultar till 0 + `console.warn`. | — (gamla bokningar pre-§1.2). |
| `bookings.total_price` ogiltig (NULL/0/negativ/NaN) | `calculatePayout()` kastar `PayoutCalculationError` med full kontext. | Caller: avvisa anrop, manuell granskning. |
| Cleaner saknar `stripe_account_id` | `triggerStripeTransfer()` kastar `TransferPreconditionError`. | Caller (admin-mark-payouts-paid): avvisa + visa felmeddelande. |
| Cleaner `stripe_onboarding_status != 'complete'` | `triggerStripeTransfer()` kastar `TransferPreconditionError`. | Caller: avvisa transfer, vänta på onboarding-completion. |
| `payout_trigger_mode != 'immediate'` (utan `force=true`) | `triggerStripeTransfer()` kastar `TransferPreconditionError`. | Caller: använd `force=true` om manuell admin-trigger. |
| Stripe avvisar `/transfers` (rate-limit, fel) | Logga till `payout_audit_log` (`action='transfer_failed'`) → kasta `TransferFailedError`. | Caller: admin-alert. |
| DB-fel efter Stripe-success | `createReversal` + audit `transfer_reversed` → kasta `TransferReversedError`. Kritisk. | Caller: incident-eskalera, manuell verifiering. |
| Stripe transfer reversed/missing/amount mismatch i markPayoutPaid | Kastar `PayoutVerificationError` med detaljer. | Caller: granska Stripe Dashboard, ej ompröva payout_status. |
| Idempotency: redan markerad paid | `markPayoutPaid()` returnerar existing audit-entry. Self-healing om audit saknas. | — (säkert att retrya). |
| RUT yearly cap överskriden | `calculateRutSplit()` loggar warning, returnerar full belopp ändå. | Caller: visa kund-meddelande (historisk cap-enforcement i F1.5.1). |

**Princip:** Money-layer är defensiv vid läsning (fallback till safe default + console.warn), strikt vid skrivning (kasta om prekondition brister). Aldrig silent drift i payout-beräkning. Se §4.8 för komplett error-klass-katalog.

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

## 15. Öppna frågor

### 15.1 Lösta 2026-04-20 (prod-verifiering)

| # | Fråga | Svar | Åtgärd |
|---|-------|------|--------|
| 1 | `cleaners.commission_rate` format? | 4 format i 17 rader (0, 0.17, 12, 17). Obrukbar. | IGNORERAS. Droppas i F1.10. |
| 2 | `platform_settings.rut_yearly_cap_kr` finns? | Nej. | F1.2 seed:ar `'75000'`. |
| 3 | `platform_settings.smart_trappstege_enabled` finns? | Nej. | F1.2 seed:ar `'false'`. |
| 4 | `platform_settings.money_layer_enabled` finns? | Nej. | F1.2 seed:ar `'false'`. |
| 5 | `platform_settings.escrow_enabled` finns? | Nej. | F1.2 seed:ar `'false'`. |
| 6 | `platform_settings.rut_pct` finns? | Nej. | F1.2 seed:ar `'50'` (heltal-procent, konsistent med `commission_standard`). |
| 7 | `bookings.spick_gross_sek` finns? | **Ja** (numeric). | F1.2 skriver ner värde vid bokningsskapande. |
| 8 | `bookings.dispute_amount_sek` finns? | **Ja** (int, Fas 8-förberedelse). | money.ts stödjer från F1.2. |
| 9 | `bookings.manual_override_price` finns? | **Ja** (int). | money.ts respekterar override om satt (ny §5 steg 0). |
| 10 | `bookings.stripe_payment_intent_id` finns? | **Ja** (text). | Används för reconciliation-lookup. |

### 15.2 Kvarstående öppna frågor

1. **`platform_settings.commission_top`-duplicering:** Samma värde som `commission_standard` (`'12'`). Grep visar 0 träffar på `commission_top` i kodbasen — trolig dead row. **Status 2026-04-22:** Ej DROP:ad ännu — kvarstår som hygien-task.
2. **Smart Trappstege semantik:** ska "keep"-raten räknas på totalt pris eller `priceBeforeRut`? Tvetydigt. **Status 2026-04-22:** Inte aktuellt — `smart_trappstege_enabled='false'` i prod, kod-implementerad men inaktiv. Beslut behövs först vid aktivering.
3. **Per-entitet override-schema:** nya kolumner (`commission_pct_override NUMERIC(5,2)`) eller ny tabell (`commission_overrides`)? Beslut tas när §5 steg 3/4 aktiveras (tidigast Fas 9). **Oförändrat öppet.**
4. ~~**`booking-create` vs `stripe-checkout` dubbel-skriv:**~~ **LÖST 2026-04-21:** stripe-checkout EF raderad (§1.2 SUPERSEDED). booking-create:604 är enda skrivvägen.
5. **Pilot-data pre-17-apr:** 4 betalda bokningar har `commission_pct=17` hårdkodat. Historik bevaras (ingen back-fill). **Defensive fallback `\|\| 17` kvarstår** i `getCommissionPct()`-konsumenter (`js/commission-helpers.js`). Tas bort när `bookings.commission_pct IS NOT NULL`-check kan göras med 100% säkerhet (efter 90 dagars stabil drift).
6. **Auto-governing avvikelse mot v3.md:** Reconcile-EF har auto-activation + auto-rollback som inte dokumenterats i v3.md. Hygien-task: synka v3.md eller dokumentera medvetet avsteg. Listad som hygien-task i progress-fil sedan §1.5.

---

## Appendix C — Prod-schema-verifiering (2026-04-20)

SQL-queries kördes 2026-04-20 mot prod-databasen (`urjeijcncsyuletprydy.supabase.co`) för att verifiera designen mot verkligt schema. Output sparas här som primärkälla per Regel #27.

### Query A — `platform_settings` struktur

```sql
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'platform_settings'
 ORDER BY ordinal_position;
```

**Output:**

| column_name | data_type |
|-------------|-----------|
| `id` | `uuid` |
| `key` | `text` (primary key) |
| `value` | `text` |
| `updated_at` | `timestamp with time zone` |

**Ingen `description`-kolumn finns.** Ursprungliga designantagandet korrigerat i §2.4.

### Query B — `platform_settings` money-relaterade rader

```sql
SELECT key, value FROM platform_settings
 WHERE key LIKE '%commission%' OR key LIKE '%price%'
    OR key LIKE '%rut%' OR key LIKE '%escrow%'
    OR key LIKE '%trappstege%' OR key LIKE '%money%'
 ORDER BY key;
```

**Output:**

| key | value |
|-----|-------|
| `base_price_per_hour` | `'399'` |
| `commission_standard` | `'12'` |
| `commission_top` | `'12'` |
| `F1_USE_DB_SERVICES` | `'false'` |
| `subscription_price` | `'349'` |

**5 existerande rader. 6 saknas** (money_layer_enabled, smart_trappstege_enabled, escrow_enabled, rut_pct, rut_yearly_cap_kr, reconciliation_alert_threshold_kr) — seedas i F1.2.

### Query C — `cleaners.commission_rate` format-distribution

```sql
SELECT commission_rate, COUNT(*) FROM cleaners
 WHERE commission_rate IS NOT NULL
 GROUP BY commission_rate ORDER BY commission_rate;
```

**Output:**

| commission_rate | count |
|-----------------|-------|
| `0` | 1 (trolig bug) |
| `0.17` | 1 (decimal) |
| `12` | 6 (procent) |
| `17` | 9 (procent) |

**Totalt:** 17 rader med värden. **4 olika format** inom samma kolumn. Default vid INSERT: `0.17` (decimal), inkonsekvent med majoriteten (17 procent). Kolumnen är obrukbar som single-source. **Beslut:** IGNORERAS. Droppas i F1.10.

### Query D — `companies.commission_rate` format

```sql
SELECT commission_rate, COUNT(*) FROM companies
 GROUP BY commission_rate;
```

**Output:** Alla rader använder default `0.17` (decimal). Ingen firma har satt eget värde. **Beslut:** IGNORERAS. Droppas i F1.10.

### Query E — `bookings.commission_pct` null-analys

```sql
SELECT
  COUNT(*) FILTER (WHERE commission_pct IS NULL) AS null_count,
  COUNT(*) FILTER (WHERE commission_pct IS NOT NULL) AS set_count,
  MIN(commission_pct), MAX(commission_pct), AVG(commission_pct)::numeric(5,2) AS avg
  FROM bookings WHERE payment_status = 'paid';
```

**Output:** `null_count=0`, `set_count=4`, `min=17`, `max=17`, `avg=17.00`.

**Analys:** 4 betalda pilot-bokningar, alla med `commission_pct=17` (pre-17-apr-data). Inga efter 17 apr — pga pågående bugg i [stripe-checkout:88](../../supabase/functions/stripe-checkout/index.ts:88) skulle nya skrivas som 12 via `booking-create` (pricing-resolver) men stripe-checkout hardcodar fortfarande 0.12/0.17 i Stripe-anropet → `application_fee` och `commission_pct` kan avvika i framtida bokningar. Money.ts (F1.2) eliminerar denna diskrepans genom att **läsa `bookings.commission_pct`** istället för att räkna om i stripe-checkout.

### Query F — `bookings` money-kolumner (kolumn-inventering)

```sql
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_name = 'bookings'
   AND (column_name LIKE '%commission%' OR column_name LIKE '%price%'
     OR column_name LIKE '%payout%' OR column_name LIKE '%rut%'
     OR column_name LIKE '%amount%' OR column_name LIKE '%total%'
     OR column_name LIKE '%spick%' OR column_name LIKE '%stripe%'
     OR column_name LIKE '%refund%' OR column_name LIKE '%dispute%')
 ORDER BY column_name;
```

**Output (nyckel-kolumner för money.ts):**

- `commission_pct` (numeric)
- `customer_price_per_hour`, `cleaner_price_per_hour`, `base_price_per_hour` (numeric)
- `spick_gross_sek`, `spick_net_sek`, `stripe_fee_sek` (numeric)
- `total_price` (integer), `rut_amount` (integer), `refund_amount` (integer)
- `dispute_amount_sek` (integer) — **Fas 8-förberedelse redan på plats**
- `manual_override_price` (integer) — admin-undantag (ny hierarki-steg 0)
- `payout_status` (text), `payout_date` (timestamp with time zone)
- `stripe_payment_intent_id`, `stripe_session_id` (text) — reconciliation-lookup

**Analys:** Schema är **rikare** än auditen antog. `dispute_amount_sek`, `manual_override_price`, och `refund_amount` är redan på plats — money.ts-API utökas i F1.2 att stödja dessa från dag 1 istället för att läggas till retroaktivt i Fas 8.

### Konsekvenser för design-dokumentet

Fem fakta-korrigeringar gjordes 2026-04-20:

1. **§2.4 platform_settings-struktur**: `(id, key, value, updated_at)` med TEXT value — inte `(key, value, description)`. Kräver `parseFloat()` vid läsning.
2. **§2.4 cleaners/companies.commission_rate**: IGNORERAS, droppas i F1.10. Inte "skall migreras".
3. **§10 migration-plan rad #14**: flyttad från Fas 9 till F1.10.
4. **§15 öppna frågor**: 10 resolved, 5 nya kvarstår (bl.a. `commission_top`-duplicering).
5. **§4 API-design**: utökas implicit att stödja `dispute_amount_sek`, `manual_override_price`, `refund_amount` från F1.2 (ej Fas 8).

---

## 16. Regel-efterlevnad

- **Regel #26** (sanity-check): F1.2 testar full kund-booking-flöde i Stripe test mode innan prod-deploy.
- **Regel #27** (primärkälla): alla 14 hardcoded-ställen är fil:rad-verifierade. DB-kolumner verifieras via `information_schema` före F1.1-start.
- **Regel #28** (ingen fragmentering): money.ts blir **enda** vägen för commission/payout. CI-linter (Fas 12) förhindrar regression.
- **Regel #29** (memory är hypoteser): ingen av fakta i detta dokument kommer från memory utan primärkälle-backning. MEMORY.md-referenser är markerade explicit.

---

## 17. Frontend commission-helpers

**Status:** ✅ **IMPLEMENTERAD 2026-04-20** (Fas 1.9a-infrastruktur). [`js/commission-helpers.js`](../../js/commission-helpers.js) (51 rader).

Frontend-konsumenter får INTE läsa `platform_settings.commission_standard` direkt — det skulle skapa fragmentering med 8+ olika fetch-implementeringar. I stället laddas en delad helper-fil tidigt i sid-init som cache:ar värdet i `window.SPICK_COMMISSION` och exponerar synkrona helpers.

**Användning:**

```html
<script src="js/config.js"></script>
<script src="js/commission-helpers.js"></script>
...
<script>
  await window.SPICK_COMMISSION_READY;  // i init-flödet
  const keep = getKeepRate();           // synkron läsning efteråt
  const pct = getCommissionPct();       // heltal-procent (12)
  const rate = getCommissionRate();     // decimal (0.12)
</script>
```

**API:**

| Funktion | Returnerar | Exempel (commission=12) |
|---|---|---|
| `getKeepRate()` | decimal städar-andel (0.88) | `0.88` |
| `getCommissionRate()` | decimal commission (0.12) | `0.12` |
| `getCommissionPct()` | heltal-procent (12) | `12` |
| `window.SPICK_COMMISSION_READY` | Promise (resolve:as när init klar) | — |
| `window.SPICK_COMMISSION` | `{ keepRate, commissionPct }` | `{ keepRate: 0.88, commissionPct: 12 }` |

**Gardrails:** alla helpers kastar `Error` om de anropas före `SPICK_COMMISSION_READY` resolve:at. Init-funktionen kastar om `platform_settings.commission_standard` saknas eller är ogiltig (`< 0`, `> 100`, NaN). Inga silenta defaults i frontend.

**Konsumenter (8 filer per §1.9b):**

- [admin.html](../../admin.html) — totalProvision/totalPayout/paidOut-kalkyler
- [faktura.html](../../faktura.html) — kund- + städar-fakturor (rad 121, 205)
- [stadare-dashboard.html](../../stadare-dashboard.html) — earnings-vyer
- [stadare-uppdrag.html](../../stadare-uppdrag.html) — per-uppdrag-payout
- [team-jobb.html](../../team-jobb.html) — team-medlems-payouts
- [marknadsanalys.html](../../marknadsanalys.html) — VD-simulering
- [registrera-stadare.html](../../registrera-stadare.html) — onboarding-kalkylator
- [rekrytera.html](../../rekrytera.html) — rekryterings-pitch

**Ej konsument (hygien-task):** [bli-stadare.html:511](../../bli-stadare.html:511) — `const commission = 0.17` kvarstår hardcoded. Scope-läckage från §1.9b — flaggad i progress-fil för framtida §1.9c-städ.

---

**Statusnot 2026-04-22:** Detta dokument är synkroniserat mot kodbasen efter §1.2/§1.3/§1.4/§1.5/§1.7/§1.9-leverans. Kvarstår: §1.6 (CI integration-test) + §1.8 (hourly-priser → platform_settings) + framtida `cleaners/companies.commission_rate`-droppning.

**Original-not (2026-04-20):** "Slut. Nästa steg: F1.1 (utöka pricing-resolver.ts till money.ts) efter Farhads SQL-verifiering av §2.4 + §15." — F1.1 levererat 2026-04-20; designändring: pricing-resolver.ts förblev separat fil i stället för att absorberas (se §2.3).

---

## 18. Fas 2.5-R2 — Kund-kvitto via mejl (2026-04-23)

**Status:** ✅ Implementerad + verifierad i prod 2026-04-23. Första kvittot utställt: **`KV-2026-00001`** för bokning `681aaa93` (Fönsterputs-testbokning, sekventiell serie via `generate_receipt_number()`-RPC). **Alla 11 BokfL 5 kap 7§ + MervL 11 kap 8§-fält renderade korrekt i mejlet.** Källa: Spår B-audit ([docs/audits/2026-04-23-revisor-audit-dokument-flow.md](../audits/2026-04-23-revisor-audit-dokument-flow.md)) + Farhads beslut.

**Retrospektiva fynd under deploy (hanterade i hygien-commits 2026-04-23):**

1. `receipt_number_seq` saknade `GRANT USAGE` till `service_role` → generate-receipt failade vid första körning. Fix ad-hoc i Studio, versionskontrollerad i [`20260423_f2_5_R2_grants.sql`](../../supabase/migrations/20260423_f2_5_R2_grants.sql) + preventivt för `commission_levels_id_seq` och `spark_levels_id_seq`.
2. `generate-receipt` saknades i [`deploy-edge-functions.yml`](../../.github/workflows/deploy-edge-functions.yml) FUNCTIONS-array → uppdaterad till 31 EFs.
3. `supabase db push` drev från prod-state pga 41 KRITISK-tabeller utan CREATE TABLE-migration (se §2.1-audit) → migration kördes manuellt i Studio. Hygien-task #25 öppen, löses av Fas 2-utökning §2.1.1.

**Sibling-bugs upptäckta under E2E-test (utanför R2-scope):**

- **Duplicerade cleaner-rader** (hygien #29): Farhad Haghighi hade två cleaner-rader (solo 100 kr + företag 350 kr). Solo-raden raderad manuellt 23 apr.
- ~~**Pricing-resolver ignorerar `services.default_hourly_price`** (hygien #30)~~: ✅ STÄNGD Sprint 1 Dag 2 (2026-04-24). Min-pris-guard + services-fallback införda. 13 unit-tester verifierar 6-stegs-hierarkin.
- **Hours-drift frontend vs backend** (hygien #31): boka.html visade `1h`, booking-create sparade `2.0h`. UX-bug, icke-kritisk.

**Viktigt:** R2-kvittot (`KV-2026-00001`) renderade **korrekt mot den debiterade summan**. Bokföringslag-compliance är intakt oavsett pricing-felet — kvittot är ett sant uttryck av transaktionen som den skedde. Pricing-bugen är sibling, inte regression i R2. Löses i §2.6 "Pricing-konsistens audit" eller separat hygien-sprint.

---

## 19. Fas 2.7 — B2B-fakturering (pågår från 2026-04-23)

**Status:** §2.7.1 (DB-schema) klar. Full arkitektur i [docs/planning/fas-2-7-b2b-kompatibilitet.md](../planning/fas-2-7-b2b-kompatibilitet.md).

**Kontext:** R2 levererade `KV-YYYY-NNNNN`-kvitton till B2C-kunder. Företagskunder behöver formell faktura med `F-YYYY-NNNNN`-prefix för att kunna bokföra i Fortnox/Visma (ett kvitto räcker inte juridiskt för företagsbokföring).

**§2.7.1 DB-infrastruktur (denna commit):**

- **7 nya kolumner** på `bookings`: `business_vat_number`, `business_contact_person`, `business_invoice_email`, `invoice_address_street`, `invoice_address_city`, `invoice_address_postal_code`, `invoice_number`.
- **Ny sequence** `b2b_invoice_number_seq` — monotoniskt ökande genom alla år.
- **Ny RPC** `generate_b2b_invoice_number()` → `F-YYYY-NNNNN`-format. Undviker kollision med befintliga `generate_invoice_number()` (städar-självfaktura SF-prefix).
- **`platform_settings.company_timezone`** seed:ad (Regel #28, config-driven RPC).
- **`serve-invoice`** tillagd i deploy-yml (31 → 32 EFs). Förberedelse för §2.7.5 regex-utökning.

**Kvarstående sub-faser:**

| Sub-fas | Fokus | Estimat |
|---|---|---:|
| §2.7.2 | UI-form för B2B-data i boka.html | 2-3h |
| §2.7.3 | Validering + booking-create uppdatering | 2-3h |
| §2.7.4 | generate-receipt utökad med F-prefix-routing + B2B-mall | 3-4h |
| §2.7.5 | serve-invoice regex `(SF|KV|F)` + bucket-routing | 30 min |
| §2.7.6 | Admin-UI + E2E-test | 2-3h |

**Storage-strategi:**

| Prefix | Bucket | Syfte |
|---|---|---|
| `KV-YYYY-NNNNN` | `receipts/` | B2C-kvitto (R2) |
| `SF-YYYY-NNNN` | `invoices/` | Städar-självfaktura |
| `F-YYYY-NNNNN` | `invoices/` | B2B-faktura (§2.7.4+) |

**Inga B2C-regressioner:** alla nya kolumner är NULL-able, RPC:n är additiv, storage-routing per prefix bevarar backwards-compat.

### 19.1 booking-create payload-kontrakt (§2.7.3 live)

Efter §2.7.3 (2026-04-23) accepterar `booking-create`-EF följande B2B-fält i request-body utöver befintliga B2C-fält:

```ts
{
  // customer_type: hybrid-validering
  //   - saknas/null/undefined/tom → default 'privat' (backwards-compat)
  //   - satt till 'privat' eller 'foretag' → accepteras
  //   - annat värde → 400 Bad Request
  customer_type?: 'privat' | 'foretag',

  // B2B-fält — ignoreras om customer_type='privat' (null-tvång B-11)
  business_name?: string | null,
  business_org_number?: string | null,       // format: XXXXXX-XXXX
  business_reference?: string | null,        // PO-nummer, kostnadsställe
  business_vat_number?: string | null,       // format: SE + 10 siffror + 01
  business_contact_person?: string | null,   // "Att:"-mottagare
  business_invoice_email?: string | null,    // separat fakturamejl
  invoice_address_street?: string | null,    // fakturaadress om ≠ tjänsteadress
  invoice_address_city?: string | null,
  invoice_address_postal_code?: string | null
}
```

**Sanitize-helper:** alla B2B-fält `.trim()`-as + konverteras till `null` om whitespace-only. Defense-in-depth mot bad-actor / direkt API-anrop utan frontend-trim.

**Null-tvång (B-11):** om `customer_type='privat'` populeras **aldrig** något B2B-fält i DB, oavsett payload. Skyddar mot cache-drift och felaktig frontend-state.

**Minimal B2B-logging:** `console.log('[BOOKING-CREATE] B2B booking created:', { booking_id, business_name, business_org_number, has_vat_number, has_separate_invoice_address })`. Innehåller **inte** kontakt-person, invoice-email eller fullständig adress (Regel #26 D / GDPR).

**Kvarstår i kommande sub-faser:**

- ~~`invoice_number` populeras inte än~~ ✅ **§2.7.4 löst** — `generate_b2b_invoice_number()` RPC anropas när `customer_type='foretag'` → `invoice_number = F-YYYY-NNNNN`.
- ~~`generate-receipt` läser inte ännu de nya kolumnerna~~ ✅ **§2.7.4 löst** — alla 10 B2B-fält läses och renderas i FAKTURA-mall.

### 19.2 generate-receipt dokumenttyp-gren (§2.7.4 live)

Efter §2.7.4 (2026-04-23) förgrenar EF:n på `booking.customer_type`:

| Fält | B2C (privat) | B2B (foretag) |
|---|---|---|
| Prefix | `KV-` | `F-` |
| RPC | `generate_receipt_number()` | `generate_b2b_invoice_number()` |
| Bucket | `receipts/` | `invoices/` |
| Mall (mejl) | `buildReceiptEmailHtml()` | `buildInvoiceEmailHtml()` (ny) |
| Mall (webbversion) | `buildReceiptHtml()` | `buildInvoiceHtml()` (ny) |
| Dokumenttitel | "KVITTO" | "FAKTURA" |
| Subject | "Bokningsbekräftelse + kvitto — …" | "Faktura F-YYYY-NNNNN — …" |
| RUT-rad | ✓ (om RUT) | ✗ (aldrig) |
| Betalningsstatus-box | — | "✓ Betald via …" |
| Köpare-sektion | — | Org.nr, VAT, kontakt, fakturaadress |
| Plattform-notering | — | "Fakturan genererades av Spick …" |
| DB-kolumn | `receipt_number` | `invoice_number` |

**Gemensamt för båda (B-15-beslut):**
- `receipt_url` återanvänd — pekar till rätt bucket + prefix-fil
- `receipt_email_sent_at` återanvänd som idempotens-flagga
- 3-stegs F-R2-7-idempotens (a) email_sent_at, (b) url+nummer finns, (c) full flow

**Dubbel-mejl-logik (E1):** om `customer_type='foretag'` OCH `business_invoice_email` satt OCH skiljer sig från `customer_email` → skickas till båda (kund-mejl är obligatoriskt, faktura-mejl är best-effort).

**Fakturaadress-fallback (E2):** om `invoice_address_street IS NULL` → använd `customer_address` på fakturan.

**E3-skydd mot sekvens-läckage:** steg (b) i idempotensen kollar `(invoice_number OR receipt_number)` INNAN RPC-anrop. Garanterar att `b2b_invoice_number_seq` aldrig förbrukar nytt värde vid re-run.

**B-17 terminologi:** `notifyAdminEmailFailure(bookingId, email, err, isB2B=true)` ger "Fakturamejl misslyckades" (inte "Kvittomejl") + "B2B-faktura (F-serie)" i admin-mejl-kort.

### 19.3 serve-invoice F-prefix-stöd (§2.7.4 övergång)

1-rads regex-fix: `(SF|KV)` → `(SF|KV|F)`. Bucket-routing oförändrad (KV- → receipts, annat → invoices).

**Markerad som övergångslösning** (hygien #44). §2.7.5 gör fullständig refaktor: content-type-headers per fil-typ, CSP, rate-limiting.

### 19.4 Webbversion-länk avvecklad (§2.7.4-fix1, 2026-04-23)

**Problem upptäckt vid smoke-test:** "Öppna kvittot/fakturan som webbversion"-länken i mejl-mallarna visade HTML-källkod istället för renderad sida. **Rotorsak:** Supabase Edge Runtime strippar content-type + applicerar CSP-sandbox på alla GET-responses från user Edge Functions. Plattformsbegränsning, inte kod-bug (verifierat via PowerShell HEAD vs GET-jämförelse).

**Åtgärd i fix1:**
- Tog bort webbversion-länken från både `buildReceiptEmailHtml` (B2C) och `buildInvoiceEmailHtml` (B2B)
- Behöll "Visa bokning"-länken (magic-link) som primär CTA — denna går till `min-bokning.html` (GitHub Pages, utan CSP-sandbox) och fungerar korrekt
- `receipt_url` sparas fortfarande i DB-kolumnen (för framtida bruk)
- `serve-invoice`-EF oförändrad — kan användas internt/admin via direkt-fetch

**Konsekvens för bokföringslag-compliance:** inga. Alla 11 obligatoriska fält (BokfL 5 kap 7§ + MervL 11 kap 8§) finns i mejl-innehållet. Kunden sparar mejlet som underlag. Spick kan vid behov regenerera dokument via `generate-receipt`-EF (idempotent).

**Framtida lösning** (hygien #45):
- (a) Custom domain som proxar till Supabase storage direkt (`kvitto.spick.se` eller liknande)
- (b) PDF-generering via `browserless.io` eller `pdf-lib` + attachment till mejlet
- (c) spick.se-backend-route (kräver Next.js eller annat server-runtime — svårt i dagens GitHub Pages-setup)

Låg prioritet — låt kvittot/fakturan vara i mejlet tills en kund explicit efterfrågar separata länkar.

**Problem som löstes:** generate-receipt-EF genererade kvitto till Supabase storage men skickade **aldrig länken till kunden**. Kunden fick idag bara Stripe-auto-kvittot (inte bokföringslag-kompatibelt). Dessutom var företagsuppgifter hardcodade i 3-4 filer (Regel #28-brott).

### 18.1 Ändringar

1. **9 `company_*`-nycklar seed:ade i `platform_settings`** — source of truth för legal name, org.nr, momsreg.nr, adress, SNI, F-skatt-status, email, website. generate-receipt läser dem via `fetchCompanyInfo()`-helper med fallback till dagens hardcodes. Framtida dokument-EFs (Fas 7.5, R4, R5) återanvänder samma helper.
2. **`bookings.receipt_email_sent_at timestamptz`-kolumn** — idempotens-flagga för mejl-leverans (inte bara HTML-generering).
3. **generate-receipt 3-stegs-idempotens** (F-R2-7):
   - (a) `receipt_email_sent_at IS NOT NULL` → return early
   - (b) `receipt_url` satt men `receipt_email_sent_at IS NULL` → skip HTML, skicka mejl
   - (c) annars → full flow + UPDATE båda
4. **Synkront anrop från stripe-webhook** — tidigare fire-and-forget, nu awaitad med try/catch. Vid fel: fallback-mejl till kund + admin-notis.
5. **Kvittomejlet ersätter tidigare "Bokning bekräftad"-mejl**. Subject: `"Bokningsbekräftelse + kvitto — <service> <datum>"`. Innehåll: alla 11 BokfL 5 kap 7§ + MervL 11 kap 8§-fält + magic link + nöjdhetsgaranti.

### 18.2 Bokföringslag-täckning (11 fält)

| # | Fält | Källa |
|---|---|---|
| 1 | Utfärdandedatum | `new Date()` vid EF-körning |
| 2 | Kvittonummer sekventiellt | `generate_receipt_number()` → `KV-YYYY-NNNNN` |
| 3 | Utfärdarens namn + adress | `company_legal_name` + `company_address` |
| 4 | Utfärdarens org.nr | `company_org_number` |
| 5 | Momsreg.nr | `company_vat_number` |
| 6 | Kundens namn | `bookings.customer_name` |
| 7 | Kundens adress | `bookings.customer_address` (tjänsteadress; S3-brist kvar för R4) |
| 8 | Beskrivning av tjänst | `service_type` + `booking_hours` + städare |
| 9 | Datum för utförd tjänst | `booking_date` + `booking_time` |
| 10 | Moms-sats + belopp exkl/moms/totalt | Beräknas från `total_price` + `rut_amount`, moms 25 % |
| 11 | F-skatt + RUT | `company_f_skatt` + `rut_amount` |

### 18.3 Framtida relaterade sub-faser (kvarstår)

- **§2.5-R3** — moms-rad i `faktura.html` D1/D3 (on-the-fly webbversion).
- **§2.5-R4** — persistera customer-invoices eller avveckla D1/D3. Scope-beslut öppet.
- **§2.5-R5** — kreditnota-flöde vid refund + städar-mejl för D4.
- **Fas 7.5** — full RUT-infrastruktur-refaktor (trigger-timing, XML-matematik, schema-fix).

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
- [stripe-checkout/index.ts:88](../../supabase/functions/stripe-checkout/index.ts:88) hardcodar `company_id ? 0.12 : (customer_type==="foretag" ? 0.12 : 0.17)`. Läser INTE `platform_settings.commission_standard` (verifierat `'12'` 2026-04-20, se Appendix C).

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
| 14 | [cleaners.commission_rate](../../supabase/migrations) + [companies.commission_rate](../../supabase/migrations) | 17 cleaners-rader i **4 format** (0, 0.17, 12, 17). companies: default 0.17, 0 egna värden. Obrukbar som single-source (verifierat 2026-04-20, Appendix C). | 🟡 IGNORERAS av money.ts · Droppas i **F1.10** |

### 2.2 Payout-pipeline (nuläge)

```
Kund betalar
   ↓
booking-create:604 (stripe-checkout raderad 2026-04-21, §1.2 SUPERSEDED)
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

**Schemaläggning (F1.9-scope):** pg_cron `'5 * * * *'` → EF `reconcile-payouts` → anropar `reconcilePayouts()`. Ej aktiv i F1.8.

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
| 14 | cleaners/companies.commission_rate | **IGNORERAS** av money.ts från F1.2. Kolumnerna droppas i **F1.10** (prod-verifierat 2026-04-20: 4 format i cleaners, 0 egna värden i companies = obrukbar single-source). Per-entitet commission-override implementeras istället via framtida `cleaners.commission_pct_override` / `companies.commission_pct_override` (decimal procent, strikt format) när §5 steg 3/4 aktiveras. | **F1.10** |

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

1. **`platform_settings.commission_top`-duplicering:** Samma värde som `commission_standard` (`'12'`). Vilken används faktiskt? Grep visar 0 träffar på `commission_top` i kodbasen — trolig dead row. **F1.2 action:** verifiera grep + DROP om orörd.
2. **Smart Trappstege semantik:** ska "keep"-raten (0.83/0.85/0.87/0.88) i [js/commission.js:15-18](../../js/commission.js:15) räknas på totalt pris eller `priceBeforeRut`? Tvetydigt. **Besluta i F1.7-design.**
3. **Per-entitet override-schema:** om framtida per-cleaner commission ska implementeras — nya kolumner (`commission_pct_override NUMERIC(5,2)`) eller ny tabell (`commission_overrides`)? Beslut tas när §5 steg 3/4 aktiveras (tidigast Fas 9).
4. **`booking-create` vs `stripe-checkout` dubbel-skriv:** [bookings.commission_pct](../../) sätts i `booking-create` (via pricing-resolver) men Stripe application_fee beräknas separat i `stripe-checkout:88`. **F1.2 måste läsa `commission_pct` från bokningen istället för att räkna om.**
5. **Pilot-data pre-17-apr:** 4 betalda bokningar har `commission_pct=17` hårdkodat. Historik bevaras (ingen back-fill). Faktura-rendering fungerar pga defensive fallback `|| 17` kvarstår.

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

**Slut.** Nästa steg: F1.1 (utöka pricing-resolver.ts till money.ts) efter Farhads SQL-verifiering av §2.4 + §15.

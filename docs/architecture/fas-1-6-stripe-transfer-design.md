# Fas 1.6 Design — `triggerStripeTransfer()`

**Fas:** F1.6 i arkitekturplan v3.1
**Skriven:** 2026-04-20
**Primärkälla för F1.6-implementation (nästa session)**
**Beroenden:** F1.3-F1.5 klara (commits 9813030, 8c1abe6, 7f04d69).
**Tidsestimat:** 6-10h (beroende på Stripe API-överraskningar).

---

## 1. Översikt + motivation

Per skalbarhetsauditen 2026-04-20 ([commit `72d082f`](../audits/2026-04-20-scalability-audit.md)) sektion 2-3: payout-pipelinen är falsk. [`admin.html:4478`](../../admin.html) `markPaid()` PATCH:ar `bookings.payout_status='paid'` direkt via anon-nyckel — ingen Stripe-anrop, ingen verifiering, ingen audit-trail.

Dagens pengaflöde är via **destination charges** i [`stripe-checkout:229-241`](../../supabase/functions/stripe-checkout/index.ts) — pengarna går direkt till städarens Connect-konto vid checkout. `payout_cleaner`-action i [`stripe-connect:142-220`](../../supabase/functions/stripe-connect/index.ts) gör legitim `/v1/transfers`-anrop men har **0 anropare** (död kod).

**Mål:** En central `money.triggerStripeTransfer()` är enda vägen till Stripe `/v1/transfers`. Idempotent, audit-logad, reconciliable. Förbereder för Fas 8 (full escrow via separate-charges-and-transfers).

**Regel-referenser:**
- Regel #26: grep-verifierat (`Stripe-Version: 2023-10-16` på 4 ställen, `/transfers`-anrop bara i stripe-connect).
- Regel #27: primärkällor = stripe-checkout + stripe-connect + admin.html + design-dok §4.4.
- Regel #28: ingen fragmentering — alla `/v1/transfers`-anrop ska gå via money.ts.
- Regel #29: memory inte använd — skelettet `triggerStripeTransfer`-stub finns verifierat i commit 7f04d69.
- Regel #30: Stripe API-version är verifierad från kodbasen, inga framtidsgissningar.

---

## 2. Nuvarande tillstånd (fil:rad-referenser)

### 2.1 `stripe-checkout` — destination charges

[`stripe-checkout/index.ts:229-241`](../../supabase/functions/stripe-checkout/index.ts) sätter:

```
payment_intent_data[transfer_data][destination] = <cleaner_stripe_account_id>
payment_intent_data[application_fee_amount]     = round(amountOre * commissionRate)
```

Stripe flyttar pengarna i samma charge → inget separat transfer behövs. Commission är fortfarande hardcodad `0.12/0.17` på rad 88 (F1.5.5 migration).

### 2.2 `stripe-connect` / `payout_cleaner` — död kod

[`stripe-connect/index.ts:142-220`](../../supabase/functions/stripe-connect/index.ts). Anropar faktiskt `stripe("/transfers", "POST", {...})` med rätt struktur. Men:
- `0.83` hardcoded (rad 172) — Regel #28-brott
- Ingen idempotency
- Ingen audit-trail (bara `UPDATE bookings` vid success)
- **0 anropare** i hela repot

**Behåll som referens-mönster, ersätt anrops-vägen med money.triggerStripeTransfer.** Arkivera filen i F1.6 eller F1.8.

### 2.3 `admin.html:markPaid` — fake

[`admin.html:4478-4502`](../../admin.html). PATCH `bookings.payout_status='paid'` via anon-nyckel. Ersätts i F1.7 (`markPayoutPaid()`) — INTE i F1.6.

### 2.4 Stripe SDK-mönster

Alla 4 EFs använder rå `fetch` mot `api.stripe.com/v1/*` med `Stripe-Version: 2023-10-16`. Ingen SDK-import. `stripe-connect:29` har en återanvändbar `stripe()`-helper — money.ts får egen helper eller flyttar den till `_shared/stripe.ts`.

---

## 3. Designbeslut

### 3.1 Transfer-flöde: separate transfers (inte destination)

**Beslut:** F1.6 implementerar `stripe.transfers.create()` som separat anrop efter booking-completion. Destination charges i `stripe-checkout` behålls tills vidare bakom `escrow_enabled=false`.

**Motivation:**
- Fas 8 (escrow) kräver separate-charges-and-transfers per v3.1-plan [Fas 8 rad 369-373](../planning/spick-arkitekturplan-v3.md).
- Bygg framtidssäkert nu — annars refactor av hela money.ts i Fas 8.
- Ger kontroll över timing (attest-flow i Fas 8).

**Konsekvens:**
- `stripe-checkout` refactor sker **INTE i F1.6**. Sker i F1.9 tillsammans med `escrow_enabled=true`-toggle.
- F1.6 bygger `triggerStripeTransfer()` guardad bakom `escrow_enabled` (inte anropbar i prod än).
- F1.6 byter **inte** existerande pengaflöde — bara lägger till en parallell kodvag.

### 3.2 Trigger-timing: configurable

Ny `platform_settings`-nyckel: `payout_trigger_mode`.

| Värde | Beteende | Aktiveras i |
|-------|----------|-------------|
| `'immediate'` | Transfer efter `payment_status='paid'` | F1.9 (om `escrow_enabled=true`) |
| `'on_attest'` | Transfer efter kund-attest eller 24h auto-release | Fas 8 |
| `'manual'` | Admin måste trigga via `markPayoutPaid` | F1.7 |

**Default vid F1.6-seed:** `'immediate'`. Oanvändbar tills `escrow_enabled=true` i F1.9.

### 3.3 Idempotency: booking_id + attempt_count

Ny tabell `payout_attempts`:

```sql
CREATE TABLE payout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id),
  attempt_count int NOT NULL DEFAULT 1,
  stripe_transfer_id text,
  status text NOT NULL,  -- 'pending' | 'paid' | 'failed' | 'reversed'
  stripe_idempotency_key text UNIQUE NOT NULL,
  error_message text,
  amount_sek int NOT NULL,
  destination_account_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX idx_payout_attempts_booking ON payout_attempts(booking_id);
```

**Idempotency-key format:** `payout-${booking_id}-${attempt_count}`. Stripe dedupar vid retry.

### 3.4 Audit-trail: `payout_audit_log`

Ny tabell (design-dok §12-spec):

```sql
CREATE TABLE payout_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id),
  action text NOT NULL,  -- 'transfer_created' | 'transfer_reversed' | 'transfer_failed'
  severity text DEFAULT 'info',  -- 'info' | 'alert' | 'critical'
  amount_sek int,
  stripe_transfer_id text,
  diff_kr int,
  details jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_payout_audit_booking ON payout_audit_log(booking_id);
CREATE INDEX idx_payout_audit_created ON payout_audit_log(created_at);
```

`payout_attempts` = idempotency-per-försök. `payout_audit_log` = alla state-ändringar (inkl. reconciliation mismatches från F1.8).

### 3.5 DB-writes under transfer

| Tabell | Kolumn | Värde |
|--------|--------|-------|
| `payout_attempts` | ny rad | INSERT före Stripe-anrop |
| `payout_attempts` | `status`, `stripe_transfer_id`, `completed_at` | UPDATE efter Stripe-svar |
| `payout_audit_log` | ny rad | INSERT efter Stripe-svar |
| `bookings` | `stripe_transfer_id`, `payout_date` | UPDATE efter success |
| `bookings` | `payout_status` | **INTE** — sätts först i F1.7 `markPayoutPaid()` |

**Varför inte `payout_status` här:** Separation of concerns. F1.6 = transfer skickas. F1.7 = admin markerar som betalt (verifierar transfer). Förhindrar race där UI visar "paid" innan reconciliation bekräftat.

### 3.6 Stripe mode isolation (Fas 1.6.1, EJ i 1.6)

**Beslut:** Fas 1.6 implementeras med Stripe-mocks i tester. Riktig integration mot Stripe test mode skjuts till Fas 1.6.1.

**Motivation:**

- Spick kör Stripe LIVE i prod idag (`STRIPE_SECRET_KEY=sk_live_xxx`).
- Att byta till test-nycklar bryter Rafael/Zivar-onboarding + kund-bokningar (live-kunder mittens Sverige).
- Behöver mode-isolation så live + test samexisterar utan cross-contamination.

**Planerad implementation i Fas 1.6.1 (2-3h scope):**

1. Ny `platform_setting`:
   ```sql
   INSERT INTO platform_settings (key, value)
   VALUES ('stripe_mode', 'live') ON CONFLICT DO NOTHING;
   ```
   Global default, kan overrides per cleaner.

2. Ny `cleaner`-kolumn:
   ```sql
   ALTER TABLE cleaners ADD COLUMN is_test_account boolean DEFAULT false;
   ```
   Per-cleaner override. Test-cleaners (`farrehagge+test7` m.fl.) flaggas som `is_test_account=true`.

3. Dubbla secrets i Supabase:
   - `STRIPE_SECRET_KEY` (befintlig, `sk_live_xxx`)
   - `STRIPE_SECRET_KEY_TEST` (ny, `sk_test_xxx`)

4. Ny helper i `_shared/stripe-client.ts` (ny fil):
   ```ts
   export function getStripeClient(cleaner: Cleaner): Stripe {
     const useTestMode = cleaner.is_test_account === true;
     const apiKey = useTestMode
       ? Deno.env.get('STRIPE_SECRET_KEY_TEST')
       : Deno.env.get('STRIPE_SECRET_KEY');
     return new Stripe(apiKey, { apiVersion: '2023-10-16' });
   }
   ```

5. Alla EFs som rör Stripe läser mode via denna helper. `money.ts` → `getStripeClient(cleaner)` i `triggerStripeTransfer`.

**Staging-ambition (Fas 10 Observability):**

Långsiktigt korrekt lösning är separat Supabase-project för staging. Det kräver:
- Ny project i Supabase Dashboard
- Separate env-variabler
- Deploy-pipeline

Ej scope för Fas 1.6.x. Flaggat för Fas 10.

**Konsekvens för Fas 1.6-tester:**
- Deno-tester i 1.6: full coverage med Stripe-mocks (15 scenarier).
- Integration-tester: skjuts till 1.6.1 efter mode-isolation klar.
- CI-pipeline oförändrad i 1.6.

---

## 4. API-signatur

```ts
export async function triggerStripeTransfer(
  supabase: SupabaseClient,
  booking_id: string,
  opts?: {
    idempotency_key?: string;  // default: "payout-${booking_id}-${attempt_count}"
    force?: boolean;           // bypass payout_trigger_mode-check
  }
): Promise<PayoutAuditEntry>
```

Returtyp `PayoutAuditEntry` finns redan i money.ts (från F1.2-skelett):

```ts
export type PayoutAuditEntry = {
  booking_id: string;
  stripe_transfer_id: string | null;
  amount_sek: number;
  status: 'pending' | 'paid' | 'failed' | 'reconciled';
  created_at: string;
  reconciled_at: string | null;
};
```

---

## 5. Flöde (step-by-step)

1. **Feature flag-check:** `money_layer_enabled='true'` → else `throw MoneyLayerDisabled`. (`escrow_enabled='true'` om inte `opts.force`.)
2. **Fetch booking + cleaner Stripe-konto:** `bookings.*` + `cleaners.stripe_account_id` + `cleaners.stripe_onboarding_status`.
3. **Pre-condition-validering** (se §7). Throw `TransferPreconditionError` om brutet.
4. **Check `payout_attempts` för tidigare försök:** om `status='paid'` → return existing entry (idempotent).
5. **Räkna ut belopp:** `const payout = await calculatePayout(supabase, booking_id)` → `cleaner_payout_sek`.
6. **Insert `payout_attempts`** med `attempt_count`, `stripe_idempotency_key`, `status='pending'`.
7. **Call `stripe.transfers.create()`** med `Idempotency-Key`-header.
8. **Uppdatera `payout_attempts`** med `stripe_transfer_id`, `status='paid'/'failed'`, `completed_at`.
9. **Insert `payout_audit_log`** med `action='transfer_created'`, `severity='info'`.
10. **Update `bookings`:** `stripe_transfer_id`, `payout_date` (INTE `payout_status`).
11. **Return `PayoutAuditEntry`.**

---

## 6. Error-scenarier + rollback

| Scenario | Beteende |
|----------|----------|
| Stripe 429 (rate limit) | Retry 3× med exponential backoff (500ms, 1s, 2s) |
| Stripe 402 (insufficient funds på plattformskonto) | `payout_attempts.status='failed'`, `payout_audit_log.severity='critical'`, throw `TransferFailedError` — admin-alert (F1.10) |
| Stripe 4xx (client error) | `status='failed'`, throw `TransferFailedError` |
| Stripe 5xx (server error) | Retry 3×, sedan `status='failed'` |
| Network timeout | Retry 3×, sedan `status='failed'` |
| `TransferPreconditionError` | `status='failed'` + throw — inte retry-bar |
| Booking already transferred (idempotent) | Return existing `PayoutAuditEntry` med `status='paid'` |
| DB-write failar EFTER Stripe success | `stripe.transfers.createReversal()` + `payout_audit_log.action='transfer_reversed'`, `severity='critical'`, admin-alert |

**Error-klasser (nya exports i money.ts):**

- `TransferPreconditionError` — pre-conditions brutna (eligible-check)
- `TransferFailedError` — Stripe avvisade eller retries uttömda
- `TransferReversedError` — DB-write failade efter Stripe-success, reversal kört

---

## 7. Pre-conditions

Samtliga måste vara sanna (annars `TransferPreconditionError`):

1. `bookings.payment_status === 'paid'`
2. `bookings.payout_status === null` OR `'failed'` (inte `'paid'`)
3. `bookings.total_price > 0`
4. Destination-konto existerar: `cleaners.stripe_account_id NOT NULL` (via solo-cleaner ELLER company-owner-lookup per `stripe-connect:158-167`-mönstret)
5. `cleaners.stripe_onboarding_status === 'complete'`
6. `platform_settings.payout_trigger_mode !== 'manual'` OR `opts.force === true`
7. (Om `'on_attest'`-mode och Fas 8 aktiv:) `bookings.attest_status === 'attested'`

---

## 8. Migration-plan

### 8.1 Inga ändringar av existerande kod i F1.6

- `stripe-checkout` rör vi **INTE** — destination charges förblir tills F1.9.
- `stripe-connect/payout_cleaner`-död kod **behålls** som referens. Arkiveras i F1.8.
- `admin.html:markPaid` rör vi **INTE** — F1.7.

### 8.2 Nya artefakter

- 2 migrations (`payout_attempts`, `payout_audit_log`)
- 1 platform_setting (`payout_trigger_mode='immediate'`)
- 1 implementation (`money.triggerStripeTransfer` + 3 error-klasser)
- 15 Deno-tester
- 1 integration-test (Stripe test mode)

### 8.3 Feature-flag-skydd

- `money_layer_enabled='false'` (prod idag) → `triggerStripeTransfer` kastar `MoneyLayerDisabled` → inget händer.
- `escrow_enabled='false'` (prod idag) → kastar också, såvida inte `opts.force=true` för admin-override i F1.7.

Ingen prod-impact i F1.6.

---

## 9. Tester

### 9.1 Deno-tester (15 scenarier, mock Supabase + mock Stripe fetch)

1. Feature flag disabled → `MoneyLayerDisabled`
2. `escrow_enabled=false` utan `force` → kastar
3. Booking not found → `BookingNotFound`
4. `payment_status !== 'paid'` → `TransferPreconditionError`
5. `payout_status='paid'` + existing attempt → idempotent return
6. Missing `stripe_account_id` → `TransferPreconditionError`
7. `onboarding_status !== 'complete'` → `TransferPreconditionError`
8. `total_price <= 0` → `TransferPreconditionError`
9. Standard success → transfer skapad, audit loggad, DB uppdaterad
10. Stripe 429 retry → 3 försök, sen success
11. Stripe 429 uttömd retry → `TransferFailedError`
12. Stripe 4xx → `TransferFailedError`, ingen retry
13. DB-write failar efter Stripe-success → `TransferReversedError`, reversal körd
14. Dubbel-anrop (samma idempotency_key) → 2:a returnerar existing entry
15. Company-cleaner: destination = company-owner's `stripe_account_id`

### 9.2 Integration-test — **flyttat till Fas 1.6.1**

E2E mot Stripe test mode (full booking → test-card → triggerStripeTransfer → verifiera `tr_xxx`) kräver mode-isolation (§3.6). Skjuts till Fas 1.6.1 när:

- `STRIPE_SECRET_KEY_TEST` är satt i Supabase Secrets
- `getStripeClient(cleaner)` väljer test-nyckel baserat på `is_test_account`-flagga
- Minst en test-cleaner har `stripe_account_id` genererat via test mode

I Fas 1.6 ersätts integration-testet av Deno-mocks (§9.1) — 15 scenarier täcker alla error-paths deterministiskt utan nätverksberoende.

---

## 10. Scope — split F1.6 + F1.6.1

### 10.1 Fas 1.6 (4-6h, mocks-only)

| Artefakt | Rad-estimat |
|----------|-------------|
| `money.triggerStripeTransfer` + error-klasser | ~250 rader |
| `_shared/stripe.ts` (återanvändbar `stripe()`-helper, **mode-agnostisk**) | ~40 rader |
| `20260421_f1_6_payout_attempts.sql` | ~30 rader |
| `20260421_f1_6_payout_audit_log.sql` | ~30 rader |
| Seed `payout_trigger_mode='immediate'` | ~5 rader |
| `_tests/money/stripe-transfer.test.ts` (15 mock-scenarier) | ~400 rader |
| Design-dok §4.4 uppdatering | +40 rader |
| **Total F1.6** | **~800 rader** |

### 10.2 Fas 1.6.1 (2-3h, mode-isolation + integration)

| Artefakt | Rad-estimat |
|----------|-------------|
| `_shared/stripe-client.ts` (`getStripeClient(cleaner)`) | ~50 rader |
| Migration `stripe_mode`-seed + `cleaners.is_test_account`-kolumn | ~20 rader |
| Refactor `money.triggerStripeTransfer` att använda `getStripeClient` | ~15 rader |
| `_tests/money/stripe-transfer-integration.test.ts` (4 scenarier) | ~200 rader |
| `STRIPE_SECRET_KEY_TEST`-setup i Supabase Secrets (manuellt) | 0 rader |
| **Total F1.6.1** | **~285 rader** |

---

## 11. Beslut 2026-04-20 (Farhads svar)

1. **Stripe test-account:** Test-API-nycklar finns (`pk_test_51TEsG3FQW3kXx`, `sk_test_51TEsG3FQW3kXx`). Test-cleaners i DB (`farrehagge+test7`, `farrehagge-test7`) saknar `stripe_account_id` — behöver onboardas via test mode. **Integration-test-setup skjuts till Fas 1.6.1.**

2. **Stripe API-version:** Behåll `2023-10-16` i Fas 1.6. Uppgradering till senaste stable hanteras i **Fas 2 (migrations-sanering)** som separat sprint.

3. **Manuell transfer-trigger:** **Skjuts till Fas 1.7** (`markPayoutPaid`-EF). F1.6 exporterar endast `money.triggerStripeTransfer()` — ingen EF-wrapper.

4. **Flag-aktivering (tvåstegs):**
   - **Fas 1.9:** `money_layer_enabled='true'` + `payout_trigger_mode='immediate'` (end-to-end-verifiering utan escrow).
   - **Fas 8:** `escrow_enabled='true'` + `payout_trigger_mode='on_attest'` (full escrow-flöde).

---

## 12. Referenser

- [`docs/planning/spick-arkitekturplan-v3.md`](../planning/spick-arkitekturplan-v3.md) — v3.1-plan Fas 1 + Fas 8
- [`docs/architecture/money-layer.md`](money-layer.md) §4.4 (original API-skiss), §7.2 (escrow), §12 (reconciliation-cron), §13 (error-regler)
- [`docs/audits/2026-04-20-scalability-audit.md`](../audits/2026-04-20-scalability-audit.md) sektion 2-3
- [`supabase/functions/stripe-connect/index.ts:142-220`](../../supabase/functions/stripe-connect/index.ts) — referens-mönster (`stripe("/transfers", "POST", ...)`)
- [`supabase/functions/stripe-checkout/index.ts:229-248`](../../supabase/functions/stripe-checkout/index.ts) — nuvarande destination charges
- [`supabase/functions/_shared/money.ts`](../../supabase/functions/_shared/money.ts) — F1.2-skelett (rad 537: `triggerStripeTransfer`-stub)

---

**Slut.** §3.1-3.6 beslutade, §11 besvarad 2026-04-20. Nästa steg: F1.6-implementation (mocks-only, 4-6h) i separat session → F1.6.1 (mode-isolation + integration, 2-3h) därefter.

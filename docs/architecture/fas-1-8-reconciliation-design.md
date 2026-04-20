# Fas 1.8 Design — `reconcilePayouts()`

**Fas:** F1.8 i arkitekturplan v3.1 (commit `8a08382`)
**Skriven:** 2026-04-20
**Primärkälla för F1.8-implementation (nästa commit)**
**Beroenden:** F1.6 + F1.6.1 + F1.7 klara (commits 7827eeb, 51fd4e9, adc50c7).
**Tidsestimat:** 4-5h.

---

## 1. Översikt + motivation

Ref v3.1-plan commit `8a08382` + skalbarhetsauditen commit `72d082f`.

**Problem:** utan periodisk reconciliation kan lokal DB drifta isär från Stripe utan upptäckt. Exempel-scenarier:

- Transfer lyckades på Stripe men DB-write failade (nätverksavbrott efter reversal-fel i F1.6 rollback-path).
- Stripe reverserade transfer (fraud-detection, dispute) — vi tror fortfarande `payout_status='paid'`.
- Pending attempts aldrig completerade — DB har `status='pending'` i veckor.
- Manuell `markPayoutPaid` utan verklig Stripe-transfer (legacy `admin.html:4478`).

**Lösning:** periodisk matchning mot Stripe List Transfers API. Flagga mismatches i `payout_audit_log`. Ingen auto-heal — admin granskar manuellt.

---

## 2. Nuvarande tillstånd (fil:rad)

### 2.1 Stub
[`money.ts:1336-1340`](../../supabase/functions/_shared/money.ts) — kastar `'Not implemented yet (Fas 1.8)'`.

### 2.2 Upstream-artefakter (verifierade)
- [`payout_attempts`](../../supabase/migrations/20260420_f1_6_payout_attempts.sql) — RLS aktiv, service_role-only.
- [`payout_audit_log`](../../supabase/migrations/20260420_f1_6_payout_audit_log.sql) — `severity` enum (info/alert/critical), `diff_kr`-kolumn reserverad för F1.8 belopps-diff.
- `bookings.payout_status` + `payout_date` (befintliga).

### 2.3 Stripe-klient
[`_shared/stripe.ts`](../../supabase/functions/_shared/stripe.ts) — rå `fetch` mot `api.stripe.com/v1/*`. Mode-isolation via `_shared/stripe-client.ts` (F1.6.1).

---

## 3. Designbeslut

### 3.1 Scope: senaste 100 transfers per run
Stripe List Transfers: `GET /v1/transfers?limit=100&created[gte]={since_timestamp}`. Matcha mot local state via `stripe_transfer_id`. Paginering via `starting_after` skjuts till framtida optimering om skala kräver.

### 3.2 Auto-heal: NEJ
Alla mismatches skapar `payout_audit_log`-entries med `severity='alert'` eller `'critical'`. Manuell granskning i admin-UI (F1.10). **Motivation:** pengalogik får inte auto-heala fel — risk för kaskad-buggar. Manuell process bygger först förtroende.

### 3.3 Schemaläggning: pg_cron (F1.9-scope)
`pg_cron` schemaar en EF 1x/timme (`'5 * * * *'`). **Ej i F1.8-scope** — funktionen + tester bara. EF + cron-setup i F1.9.

### 3.4 Idempotens: run_id SHA-hash
`run_id = sha256(now().toISOString() + crypto-salt).slice(0, 16)`. Audit-insert kollar existing `(run_id, stripe_transfer_id)` — skip duplikat.

**Avvisat:** Stripe request-id via `Idempotency-Key` — `GET /transfers` stödjer inte idempotency-header på API-nivå.

### 3.5 Rate-limit-strategi
Stripe: 100 req/s live, 25 req/s test. Reconciliation = 1 List-call + 0-N GET-calls för tvetydiga transfers.
**Policy:** max 50 api-calls per run (safe margin). Överskrids → abort gracefully, logga incomplete-run, nästa cron-tick plockar upp.

### 3.6 Tidsfönster
Initial catch-up run: `since_days=30`. Steady-state: `since_days=7`. Cutoff via `created[gte]`-param. Stripe-arkivering = 90 dagar → 7-dagars fönster ligger klart inom.

---

## 4. API-signatur

```ts
export async function reconcilePayouts(
  supabase: SupabaseClient,
  opts?: {
    since_days?: number;      // default 7
    max_transfers?: number;   // default 100
    max_api_calls?: number;   // default 50
    dry_run?: boolean;        // inga audit-writes
    _stripeRequest?: StripeRequestFn;  // DI för tester
  }
): Promise<ReconciliationReport>
```

```ts
export type MismatchType =
  | 'stripe_paid_db_pending'     // Stripe paid, DB säger pending
  | 'stripe_reversed_db_paid'    // Stripe reversed, DB säger paid (critical)
  | 'db_paid_stripe_missing'     // DB paid, Stripe returnerar ej (critical)
  | 'amount_mismatch'            // Belopp skiljer (critical)
  | 'no_local_attempt'           // Stripe har transfer, DB saknar payout_attempt
  | 'stale_pending';             // DB pending > 48h, ingen Stripe-match

export type ReconciliationReport = {
  run_id: string;
  started_at: string;
  completed_at: string;
  transfers_checked: number;
  matches: number;
  mismatches: Array<{
    severity: 'alert' | 'critical';
    type: MismatchType;
    booking_id: string | null;
    stripe_transfer_id: string;
    details: Record<string, unknown>;
  }>;
  api_calls_used: number;
  errors: string[];
};
```

---

## 5. Flöde (9 steg)

1. **Feature flag:** `isMoneyLayerEnabled()` — annars `throw MoneyLayerDisabled` (utom `dry_run=true` bypasses i tester).
2. **Generate run_id:** `sha256(now + salt).slice(0, 16)`. Unikt per run.
3. **Fetch local state:** `bookings` + `payout_attempts` LEFT JOIN där `created_at > NOW() - since_days`.
4. **Fetch Stripe List:** `GET /transfers?limit=100&created[gte]=...` via `getStripeClient()` (mode-isolation). `api_calls_used++`.
5. **Matchningsalgoritm** (se §5.5 nedan).
6. **Insert mismatch-audits** (om `!dry_run`): `action='reconciliation_mismatch'`, `severity`, `details={run_id, mismatch_type, ...}`. Idempotens-check först.
7. **Insert run-audit:** `action='reconciliation_completed'`, `severity=mismatches>0?'alert':'info'`, `details={run_id, transfers_checked, matches, mismatches_count, api_calls_used}`.
8. **Return `ReconciliationReport`** — komplett rapport med alla mismatches + stats.
9. **Rate-limit-skydd:** under hela flödet track:a `api_calls_used`. Om `> 0.8 * max_api_calls` → abort gracefully, sätt `errors: ['rate_limit_approaching']`.

### 5.5 Matchningsalgoritm

För varje **Stripe-transfer** i List-svaret:
- Hitta motsvarande `payout_attempts` via `stripe_transfer_id`.
- Saknas → `no_local_attempt` (alert).
- Finns:
  - `stripe.reversed=true` + DB `status='paid'` → `stripe_reversed_db_paid` (critical).
  - `stripe.amount !== db.amount_sek * 100` → `amount_mismatch` (critical, logga `diff_kr`).
  - Else → match.

För varje **local attempt** med `status='pending'` > 48h:
- Om Stripe listar den → `stripe_paid_db_pending` (alert).
- Annars → `stale_pending` (alert).

För varje **DB booking** med `payout_status='paid'` men `stripe_transfer_id` saknas i List-svaret:
- `GET /transfers/{id}` för verifiering (`api_calls_used++`).
- 404 → `db_paid_stripe_missing` (critical).
- Finns → match (List var inte uttömmande pga paginering/cutoff).

---

## 6. Error-scenarier

| Scenario | Beteende |
|----------|----------|
| Stripe 429 rate limit | Abort + `errors: ['stripe_429']`, nästa run plockar upp |
| Stripe 401 auth | `throw ReconcileConfigError` (ny klass) |
| Stripe 5xx | Retry 3× med backoff (500ms/1s/2s), sedan abort + log |
| DB RLS-block | `throw ReconcilePermissionError` (ny klass) |
| Unique-violation på audit-insert | Idempotens fungerar — skip tyst |
| `stripe_transfer_id` NULL i attempts | Skip raden, `console.warn` |

**Nya error-klasser:**
- `ReconcileConfigError` — auth/env-fel
- `ReconcilePermissionError` — RLS/service_role blockerar writes

---

## 7. Pre-conditions

1. `money_layer_enabled='true'` (eller `dry_run=true`).
2. `STRIPE_SECRET_KEY` eller `STRIPE_SECRET_KEY_TEST` satta.
3. `payout_audit_log`-tabellen existerar med RLS (verifierat F1.6).
4. `payout_attempts`-tabellen tillgänglig för service_role.

---

## 8. Tester

### 8.1 Deno-tester (enhet, mock Supabase + mock Stripe)

15 scenarier:

1. Feature flag disabled → `MoneyLayerDisabled` (utom `dry_run=true`)
2. Empty state: inga bookings, inga transfers → success report med 0 mismatches
3. Happy path: 5 matches, 0 mismatches
4. `stripe_paid_db_pending`: Stripe paid, DB pending
5. `stripe_reversed_db_paid`: Stripe reversed, DB paid
6. `db_paid_stripe_missing`: DB paid, Stripe GET returnerar 404
7. `amount_mismatch`: belopp skiljer 1 öre
8. `no_local_attempt`: Stripe har, DB saknar
9. `stale_pending`: DB pending > 48h, inte i Stripe-list
10. Idempotens: kör 2× med samma run_id — ingen duplikat-audit
11. Rate-limit: `api_calls > max` → abort gracefully
12. `dry_run=true`: ingen audit-write
13. `since_days=1` filter: gamla records exkluderas
14. Multiple mismatches i samma run → alla audits skapas
15. Stripe 429 mitt i run → partial report + `errors` satt

### 8.2 Integration-tester
Inga i F1.8. Mocks räcker för enhet — integration skjuts till F1.9 tillsammans med EF + pg_cron-setup.

---

## 9. Migration + deployment

### 9.1 Inga nya DB-tabeller
Reconciliation återanvänder `payout_audit_log` med nya `action`-värden: `reconciliation_mismatch`, `reconciliation_completed`. `diff_kr`-kolumnen (reserverad i F1.6) används för `amount_mismatch`-typen.

### 9.2 Edge Function (F1.9-scope)
`supabase/functions/reconcile-payouts/index.ts`:
- POST-endpoint som anropar `money.reconcilePayouts()`.
- Auth via service_role (CRON_SECRET-header).
- `pg_cron`-schedule: `'5 * * * *'` (5 min efter varje hel timme).

Ej i F1.8-scope.

---

## 10. Scope för Fas 1.8 implementation

**Status:** ✅ **IMPLEMENTERAD 2026-04-20**

**Levererat:**
- `reconcilePayouts`-funktion i [`money.ts`](../../supabase/functions/_shared/money.ts) (~280 rader)
- Typer: `MismatchType`, `ReconciliationMismatch`, `ReconciliationReport` (exporterade)
- 2 nya error-klasser: `ReconcileConfigError`, `ReconcilePermissionError`
- `_sha256Hex` helper för run_id-generering
- 15 Deno-tester i [`_tests/money/reconcile-payouts.test.ts`](../../supabase/functions/_tests/money/reconcile-payouts.test.ts)
- Design-dok §4.6 uppdaterad

**Utanför scope (F1.9):**
- Edge Function deployment
- `pg_cron`-setup
- Integration-tester mot Stripe test mode
- Webhook-alternativ (Fas 8 eller senare)

**Test-resultat:** 100 pass + 4 ignored (85 pre-F1.8 + 15 nya).

---

## 11. Beslut 2026-04-20 (Farhads godkännande)

1. **Scope:** senaste 100 transfers, matcha + flagga. ✅
2. **Auto-heal:** NEJ — bara flagga (severity=alert/critical). ✅
3. **Schemaläggning:** pg_cron 1x/timme. ✅
4. **Trigger:** EF som anropar `reconcilePayouts()`. ✅
5. **Fas 1.8-scope-split:** bara funktion + tester, cron/EF i F1.9. ✅
6. **Webhook:** skjuts till Fas 8 eller senare. ✅

---

## 12. Öppna frågor

Inga — samtliga besvarade i §11.

---

**Slut.** §1-11 beslutade, §12 tom. Nästa steg: F1.8-implementation (4-5h) i separat commit.

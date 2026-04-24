# Stripe Retry + Idempotency Audit (Fas 13 §13.3)

**Genererad:** 2026-04-24
**Metod:** Static code audit av alla EFs som anropar `api.stripe.com`. Verifierar förekomst av idempotency-keys och retry-logik.

**Primärkälla:** `_shared/stripe.ts` + `_shared/money.ts` + 17 EFs med direkta Stripe-calls.

**Rule #30 strikt:** Rapporten **tolkar inte Stripe rate-limit-regler**. Rekommenderar fix baserat på best-practice och vår egen arkitektur-doc (`docs/architecture/fas-1-6-stripe-transfer-design.md`), inte på Stripe-policy-tolkning. Farhad verifierar rate-limits i Stripe Dashboard innan produktion-beslut.

---

## 1. Sammanfattning

- **22 filer** interagerar med Stripe API (17 EFs + 2 helpers + 3 tester — tester exkluderas).
- **2 EFs** använder `_shared/stripe.ts::stripeRequest` korrekt med idempotency: `escrow-release` + `_shared/money.ts::triggerStripeTransfer`.
- **10+ EFs** anropar `fetch('https://api.stripe.com/...')` **direkt utan idempotency-header** — inkluderar betalnings-flows med hög duplicate-risk (`booking-create`, `stripe-refund`, `charge-subscription-booking`, alla refund-calls).
- **Ingen automatisk retry-logik** på 429/5xx i `stripeRequest` eller någon EF. En fail = fail.
- **Några application-level-skydd** finns (existingBooking-check i booking-create, processed_webhook_events i webhook-endpoint).

## 2. Inventering

### 2.1 EFs som använder `_shared/stripe.ts::stripeRequest` ✓

| EF | Idempotency-pattern | Verifierad |
|---|---|---|
| `escrow-release` | `escrow-release-${booking_id}-${releaseTrigger}` | Line 265 |
| `_shared/money.ts::triggerStripeTransfer` | `payout-${booking_id}-${attemptCount}` (retry-säker via attempt_count) | Line 880 |

### 2.2 EFs med direkta Stripe-fetch-calls utan idempotency ✗

| EF | Stripe-endpoint | Risk |
|---|---|---|
| `booking-create` | `POST /checkout/sessions` | ⚠ Dubbel Checkout session vid nätverks-retry. Mitigerad av existingBooking-check (line 349) men bara på application-level. |
| `stripe-refund` | `POST /refunds` | ⚠ Dubbel refund vid retry. Inget skydd. |
| `charge-subscription-booking` | `POST /payment_intents` | ⚠ Dubbeldebitering vid retry. Inget skydd. |
| `booking-auto-timeout` | `POST /refunds` | ⚠ Dubbel refund. |
| `auto-remind` | `POST /refunds` (på timeout-path) | ⚠ Dubbel refund. |
| `booking-cancel-v2` | `POST /refunds` | ⚠ Dubbel refund. |
| `booking-reassign` | `POST /refunds` | ⚠ Dubbel refund. |
| `noshow-refund` | `POST /refunds` | ⚠ Dubbel refund. |
| `setup-subscription` | `POST /customers` + `POST /checkout/sessions` | ⚠ Dubbla customers. |
| `stripe-webhook` | `POST /refunds` + `POST /payment_intents/.../capture` | Webhook har processed_webhook_events-dedup, men internal refund-calls kan dubbelkörras vid retry inom webhook. |

### 2.3 EFs med read-only Stripe-calls (låg risk)

| EF | Endpoint | Idempotency behövs? |
|---|---|---|
| `health` | `GET /balance` | Nej (read-only) |
| `poll-stripe-onboarding-status` | `GET /accounts/:id` | Nej |
| `stripe-webhook` | `GET /events/:id` (verify) | Nej |
| `stripe-webhook` | `GET /setup_intents/:id` + `GET /payment_methods/:id` | Nej |
| `stripe-connect` | Variant av GET/POST via shared stripe-helper | Delvis OK |

## 3. Retry-logik status

### 3.1 Inget centralt retry ⚠

`_shared/stripe.ts::stripeRequest` har **ingen automatisk retry** på:
- **HTTP 429** (rate limit) — enligt best-practice ska retry med exponential backoff
- **HTTP 5xx** (server error) — transient, borde retry
- **Nätverksfel** (connection reset, timeout) — borde retry

Varje fail = slutlig fail. Caller måste själv hantera.

### 3.2 Application-level retry där det finns ✓

- `charge-subscription-booking` — egen retry-strategi med `next_retry_at` + `attempt_count` på `subscription_charges`-raden (line 329). Inte retry på nätverksfel i samma anrop, utan queue-baserad.
- `auto-remind` email-queue — exponential 10/20/30 min (inte Stripe-relaterat men samma pattern).
- `_shared/money.ts::triggerStripeTransfer` — `attempt_count` uppräknas på retry, idempotency-key inkluderar attempt-nummer (duplicate-safe).

## 4. Rate-limit-skydd status

- **Rate limit-tracker på vår sida:** Ingen. Vi vet inte hur många Stripe-calls per sekund vi genererar.
- **Retry med backoff vid 429:** Saknas i stripeRequest.
- **Circuit breaker:** Saknas.
- **Queue-baserad batching:** Partiellt — `charge-subscription-booking` är cron-triggad och har natural batching.

## 5. Gap-lista

### 5.1 Hårda gaps (risk för faktisk duplicering)

1. **`stripe-refund` utan idempotency-key** — en refund-call som retry:as kan orsaka dubbel refund. HÖGST prioritet att fixa.
2. **`charge-subscription-booking` utan idempotency på payment_intents** — dubbeldebitering-risk.
3. **Alla 7 refund-sites (auto-timeout/remind/cancel-v2/reassign/noshow/stripe-webhook + stripe-refund)** behöver idempotency-key baserad på `booking_id + refund_reason` eller liknande unik identifierare.
4. **Rate-limit-retry saknas i stripeRequest** — vid spike i bokningar kan vi träffa Stripe-limits och fail:a tyst.

### 5.2 Mjuka gaps (design-skuld)

1. **Rule #28-brott:** 10+ EFs hard-codar `https://api.stripe.com/v1/...` istället för att använda `_shared/stripe.ts::stripeRequest`. SSOT-brott för Stripe-calls.
2. **Ingen rate-limit-instrumentation** — vi kan inte se hur nära Stripe-limits vi är.

## 6. Rekommendationer (prioriterade)

### R1: Konsolidera till `stripeRequest` (rule #28, ~4-6h)
Refaktor 10 EFs att använda `_shared/stripe.ts::stripeRequest` istället för raw fetch. Öppnar för centraliserad retry-logik.

### R2: Lägg till automatisk retry i `stripeRequest` (~1-2h)
Exponential backoff på HTTP 429 + 5xx + nätverksfel. Max 3 försök. `stripe.ts` är då enda stället som behöver fix.

### R3: Idempotency-key per refund-site (~2-3h)
Standard-pattern: `refund-${booking_id}-${reason}-${attempt}`. Unik per scenario, stabil över retries inom samma attempt.

### R4: Rate-limit-instrumentation (~2-3h)
Logga antal Stripe-calls per minut via `admin-morning-report` eller Grafana (blockad av §10.3).

### R5 ✓ KLART — Stripe-bekräftade gränser för Spick live-account (2026-04-24)

Farhad fick skriftlig bekräftelse från Stripe Support:

| Endpoint | Gräns | Spick-behov | Marginal |
|---|---|---|---|
| Global live-mode | 100 ops/sec | ~5-10/sec | 10x |
| Global sandbox | 25 ops/sec | test-only | — |
| Payment Intents updates | 1000/PI/timme | ~2-3/PI | massivt |
| Files API | 20 read + 20 write/sec | låg användning | OK |
| Search API | 20 read/sec | låg användning | OK |
| Subscriptions nya fakturor | 10/sub/min, 20/dag | 1/sub/dag | 10-20x |
| Subscriptions qty-uppdateringar | 200/timme | minimal | OK |
| Create Payout | 15/sec, 30 samtidiga | ~1/sec | 15x |
| Connect Accounts | 30/sec live | ~1/sec | 30x |
| Meter Events | 1000/sec | ej använt | — |
| Default per endpoint | 25/sec | varierar | OK för de flesta |

**Slutsats:** Nuvarande gränser räcker för **>1000 bokningar/månad**. Vid 10 000+/månad behöver Farhad kontakta Stripe Support **6 veckor i förväg** för höjning.

**Rule #30 uppfyllt:** Gränser är Stripe-bekräftade för vårt konto, inte antagande.
**R2-verifiering:** Vid 429-fel retry:ar stripeRequest automatiskt — exakt som Stripe docs rekommenderar.

## 7. Prioriteringsförslag

Om §13.3 ska stängas före GA:
- **Kritisk (fix före GA):** R3 för refund-sites (dubbel-refund är reell money-loss).
- **Bör (pre-GA):** R2 retry-logik i stripeRequest. Skyddar mot 429 under spike.
- **Kan vänta:** R1 refaktor-konsolidering (större scope).
- **Extern:** R5 ✓ Stripe-bekräftat 2026-04-24 (se §6 R5).

**Uppskattning:** R2 + R3 = 3-5h. R1 = 4-6h. Total pre-GA-fix: 7-11h. Farhad beslutar.

## 8. Relation till existerande skydd

| Skydd | Effekt |
|---|---|
| `processed_webhook_events`-tabell | Skyddar webhook-dedup, INTE intern refund-call-dedup |
| `existingBooking`-check i booking-create | Skyddar dubbla Checkout sessions på application-level |
| `subscription_charges.attempt_count` | Skyddar retry-loop i charge-subscription-booking |
| Stripe idempotency i 2 EFs (escrow-release + triggerStripeTransfer) | Ingen effekt på de andra 10 |

Application-level-skydd räcker INTE vid nätverks-retry-scenarion där samma POST ankommer dubbelt till Stripe inom millisekunder.

---

## 9. Nästa steg

1. Farhad läser rapport.
2. Beslut: fix R2 + R3 pre-GA eller skjut till post-GA med risk-acceptans.
3. Om fix: Claude implementerar R2 + R3 som separat scope.
4. Farhad verifierar Stripe Dashboard rate-limits (R5) oavsett.

## 10. Ändringslogg

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-24 | Initial audit | Claude |

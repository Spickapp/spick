# Dispute + Full Escrow System — Design (Fas 8)

**Status:** SKELETT · 2026-04-23 · Fylls in sessioner per §8.2-§8.25
**Primärkälla:** [docs/planning/spick-arkitekturplan-v3.md §8](../planning/spick-arkitekturplan-v3.md) (rad 400-456)
**EU-deadline:** 2 december 2026 (Platform Work Directive) — **icke-förhandlingsbar**
**Estimat:** 60-80h total (per plan)
**Beroenden:** Fas 1 Money Layer (✅ klar) · Fas 6 Event-system (◑ 75% retrofit)

---

## 0. Varför Full Escrow (val 2026-04-20)

Farhad valde **full escrow via separate-charges-and-transfers** över soft escrow via reversals. Motivering:

1. **EU Platform Directive compliance** — strukturerad dispute-process + audit-trail krävs
2. **Försäkringsbart** — ansvarsförsäkring kräver formell dispute-process
3. **Differentiator** — "Pengar frigörs först när du är nöjd" är starkt marknadsbudskap
4. **B2B-säljbar** — företagskunder förväntar sig escrow
5. **Juridiskt renare** — Spick äger pengarna under escrow, inte städaren

**Arkitektur-övergång:** Stripe Connect byte från "destination charges" (pengarna går direkt till städaren) till "separate charges and transfers" (pengarna stannar på Spicks plattformskonto tills manuell transfer).

---

## 1. State Machine

`bookings.escrow_state text` — strikt state-machine. Endast `escrow-state-transition` EF får ändra värdet.

### 1.1 Tillåtna states

```
pending_payment       -- Bokning skapad, väntar på Stripe checkout
paid_held             -- Stripe charge succeeded, pengar på Spick-konto
awaiting_attest       -- Städning klar, 24h timer startad
released              -- Transfer till städare genomförd
disputed              -- Kund har öppnat dispute
resolved_full_refund  -- Admin/system: full återbetalning
resolved_partial_refund -- Admin: delvis refund + delvis transfer
resolved_dismissed    -- Admin: dispute avvisad, transfer till städare
refunded              -- Pengar tillbaka till kund (cancellation eller dispute)
cancelled             -- Innan charge: pending_payment → cancelled
```

### 1.2 Övergångsgraf

```
pending_payment ──charge.succeeded──> paid_held
pending_payment ──cancel──> cancelled

paid_held ──checkout_complete──> awaiting_attest
paid_held ──cancel_pre_service──> refunded

awaiting_attest ──customer_attest──> released
awaiting_attest ──24h_timer_expire──> released (auto)
awaiting_attest ──customer_dispute_open──> disputed

disputed ──admin_full_refund──> resolved_full_refund ──transfer──> refunded
disputed ──admin_partial_refund──> resolved_partial_refund ──transfer──> released+refunded
disputed ──admin_dismiss──> resolved_dismissed ──transfer──> released
```

**Invarianter:**
- `paid_held` → aldrig direkt till `released` (måste via `awaiting_attest`)
- `disputed` → aldrig till `released`/`refunded` utan resolve
- `released` + `refunded` är terminal — ingen transition ut

### 1.3 Implementation

- CHECK constraint på `bookings.escrow_state`
- `escrow_events`-tabell loggar VARJE transition
- `escrow-state-transition` EF validerar övergångar (switch på from_state + action)
- Misslyckad transition → 422 + behåll gammal state + log warning

### 1.4 Backward-kompatibilitet (pre-Fas 8 bookings)

Legacy-bookings får `escrow_state = 'released_legacy'` (special-state utanför normal graf). Gamla flödet fortsätter fungera. Endast NYA bookings går genom escrow från Fas 8-aktivering.

---

## 2. Stripe Architecture Shift

### 2.1 Före (idag: destination charges)

```
Customer → Spick platform → destination = cleaner Stripe Connect account
                             ↓
                  88% till cleaner, 12% application_fee till Spick
```

Pengarna går DIREKT till städarens konto. Problem: refund kräver komplex reversal-kedja genom cleaner-kontot.

### 2.2 Efter (Fas 8: separate charges)

```
Steg 1 (booking-create):
Customer → Spick platform konto (FULL amount)
  status: escrow_state='paid_held'

Steg 2 (escrow-release efter attest):
Spick platform → stripe.transfers.create(88%) → cleaner Connect account
  status: escrow_state='released'

Steg 3 (vid dispute/refund):
Spick platform → stripe.refunds.create(full or partial)
  status: escrow_state='refunded' eller 'resolved_*'
```

### 2.3 Konsekvens för booking-create (§8.2)

Ändring från:
```ts
// destination charges (nuvarande)
payment_intent_data: {
  application_fee_amount: applicationFee,
  transfer_data: { destination: cleanerStripeId }
}
```

Till:
```ts
// separate charges (Fas 8)
// INGEN transfer_data. Pengarna stannar på plattformskontot.
// Transfer sker senare via escrow-release EF.
```

`booking-create` blir SIMPLARE (ingen transfer_data), men FÖRE charge måste `escrow_state='pending_payment'`.

### 2.4 `escrow-release` EF (§8.7)

```ts
async function releaseEscrow(booking_id: string, trigger: 'attest' | 'auto_24h' | 'admin_dismiss') {
  // 1. Hämta booking + verifiera escrow_state IN ('awaiting_attest', 'resolved_dismissed')
  // 2. Beräkna transfer-amount via money.calculatePayout(booking)
  // 3. await stripe.transfers.create({ amount, destination: cleaner.stripe_account_id })
  // 4. UPDATE escrow_state = 'released'
  // 5. logBookingEvent(booking_id, 'escrow_released', { stripe_transfer_id, amount_to_cleaner, release_reason: trigger })
}
```

Använder Fas 6.2 events-helper (redan levererad).

---

## 3. Tabeller (§8.4)

### 3.1 `escrow_events`

```sql
CREATE TABLE escrow_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL,
  from_state  text,
  to_state    text NOT NULL,
  triggered_by text,           -- 'customer', 'cleaner', 'admin', 'system_timer'
  triggered_by_id uuid,
  metadata    jsonb DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);
```

Kompletterar `booking_events` (Fas 6) — `escrow_events` är mer snäv, bara state-transitioner. Timeline-UI (Fas 6.4) unionerar båda.

### 3.2 `disputes`

```sql
CREATE TABLE disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL UNIQUE,  -- 1 dispute per booking
  opened_by         uuid,                  -- customer_id
  reason            text NOT NULL,
  customer_description text,
  cleaner_response  text,
  admin_notes       text,
  admin_decision    text,                  -- 'full_refund' | 'partial_refund' | 'dismissed'
  refund_amount_sek integer,
  opened_at         timestamptz DEFAULT now(),
  cleaner_responded_at timestamptz,
  admin_decided_at  timestamptz,
  resolved_at       timestamptz
);
```

### 3.3 `dispute_evidence`

```sql
CREATE TABLE dispute_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL,
  uploaded_by text NOT NULL,              -- 'customer' | 'cleaner'
  storage_path text NOT NULL,             -- Supabase storage URL
  file_size_bytes integer,
  mime_type   text,
  uploaded_at timestamptz DEFAULT now()
);
```

### 3.4 `attested_jobs`

```sql
CREATE TABLE attested_jobs (
  booking_id    uuid PRIMARY KEY,
  attested_at   timestamptz DEFAULT now(),
  attest_method text,  -- 'customer_manual' | 'auto_24h_timer'
  customer_note text
);
```

---

## 4. Storage Bucket (§8.5)

Bucket: `dispute-evidence`

RLS-policies:
- Kund uppladdar till `/customer/{user_id}/{dispute_id}/`
- Städare uppladdar till `/cleaner/{user_id}/{dispute_id}/`
- Admin läser allt (via `admin_users`-join)
- Gäster läser INTE

Begränsningar:
- Max 5 MB per foto
- Max 5 foton per part per dispute
- Accepterade MIME-types: `image/jpeg`, `image/png`, `image/heic`

---

## 5. SLA Timers

| Händelse | SLA | Auto-action |
|---|---|---|
| `awaiting_attest` → auto-release | 24h efter `checkout_at` | Cron: escrow-auto-release |
| `disputed` → cleaner-svar saknas | 48h | Cron: escrow-sla-check → admin-alert |
| `disputed` → admin-beslut | 72h | Cron: escrow-sla-check → eskalera till Farhad |

Crons: `escrow-auto-release` (var 15 min), `escrow-sla-check` (dagligen).

---

## 6. EU Platform Work Directive Compliance

**Deadline:** 2 december 2026. Source: EU Platform Work Directive (PWD) 2024.

### 6.1 Krav (mapping till Fas 8-deliverables)

| PWD-krav | Fas 8-deliverable |
|---|---|
| Transparent dispute-process | State machine §1 + dispute-tabeller §3 |
| Audit-trail för state-changes | `escrow_events` + `booking_events` (Fas 6) |
| Data-exporträtt för städare | Ny EF `export-cleaner-data` (§8.20) |
| Rätt till förklaring av algoritm-beslut | Fas 3 matching-algorithm.md (✅ klart) |
| Formell svarsrätt | `dispute-cleaner-respond` EF (§8.9) |
| Oberoende beslut | Admin-beslut kräver minst 2-ögon för >5000 kr dispute (framtida) |

### 6.2 Research-uppgift (§8.1 sub-task)

- **Hämta** aktuell PWD-spec (2024 version) från EU Official Journal
- **Mappa** varje krav till konkret implementation
- **Verifiera** med jurist innan Fas 8 går live

**Regel #30:** PWD-tolkning får INTE gissas. Jurist krävs.

---

## 7. Interaktion med Recurring (Fas 5)

Recurring-bokningar genereras som individuella `bookings`-rader av `generate-recurring-bookings` cron (Fas 5.3).

**Princip:** Varje recurring-enstaka-bokning har egen escrow_state. Dispute på en bokning påverkar INTE övriga i serien.

```
Subscription "hemstädning varje onsdag"
  ↓ cron genererar
[Booking 1: onsdag 1 → escrow_state='released']
[Booking 2: onsdag 2 → escrow_state='disputed']  ← isolerad
[Booking 3: onsdag 3 → escrow_state='awaiting_attest']
```

**Undantag:** Om 3+ bokningar i rad disputas → automatisk pause av subscription (anti-churn). Implementation via `escrow-sla-check` cron som kan flippa `subscriptions.status='paused'`.

---

## 8. Frontend-komponenter (§8.14-8.17)

### 8.1 `min-bokning.html` — Attest + Dispute UI

```
[24h timer räknar ner] ← visas när escrow_state='awaiting_attest'

[Godkänn städningen] → customer_attest action
[Invänd mot städningen] → öppnar dispute-form
```

### 8.2 Dispute-form

- Min 1 foto obligatoriskt (storage-validering)
- Fritt fält: anledning (textarea, max 2000 tecken)
- Submit → `dispute-open` EF → escrow_state='disputed'

### 8.3 `stadare-dashboard.html` — Dispute-respons

När egen booking har `escrow_state='disputed'`:
```
[En kund har invänt mot din städning] [48h timer]

Kundens foto: [thumbnail × N]
Kundens förklaring: "..."

[Ladda upp ditt foto-bevis]
[Skriv din förklaring]
[Skicka svar] → dispute-cleaner-respond EF
```

### 8.4 `admin.html` — Dispute-kö

```
Alla aktiva disputes | SLA-räknare | Filter: [väntar svar | redo beslut | äldre än 72h]

Per dispute:
  Kundens evidens | Städarens evidens | Tidslinje
  [Full refund] [Partial refund (kr)] [Dismiss]
```

---

## 9. Migration Strategy (§8.18)

### 9.1 Parallell-kör-fas (första 30 dagarna efter Fas 8-aktivering)

- Nya bokningar: `escrow_state` populated, nya flödet
- Existerande bokningar (pre-aktivering): `escrow_state='released_legacy'`, gamla flödet körs till completion
- Feature flag: `platform_settings.fas8_escrow_enabled='false'` default

### 9.2 Migration-steg

```sql
-- 1. Lägg till kolumner + tabeller (denna commit)
ALTER TABLE bookings ADD COLUMN escrow_state text DEFAULT NULL;
CREATE TABLE escrow_events (...);
CREATE TABLE disputes (...);
CREATE TABLE dispute_evidence (...);
CREATE TABLE attested_jobs (...);

-- 2. Backfill pre-aktivering
UPDATE bookings SET escrow_state = 
  CASE
    WHEN status IN ('klar', 'completed') AND payment_status = 'paid' THEN 'released_legacy'
    WHEN status IN ('avbokad', 'cancelled') THEN 'cancelled'
    WHEN payment_status = 'refunded' THEN 'refunded'
    ELSE 'paid_held_legacy'
  END
WHERE escrow_state IS NULL;

-- 3. Sätt NOT NULL + CHECK constraint (efter backfill)
ALTER TABLE bookings ALTER COLUMN escrow_state SET NOT NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_escrow_state_check 
  CHECK (escrow_state IN (/* lista per §1.1 */));

-- 4. Aktivera flag
UPDATE platform_settings SET value='true' WHERE key='fas8_escrow_enabled';
```

---

## 10. Rollback Plan (§8.19)

Per-steg rollback. Alla reverseringar har SQL-script eller feature-flagg.

| Steg | Rollback-tid | Metod |
|---|---|---|
| Tabeller skapade | <5 min | `DROP TABLE escrow_events, disputes, ...` |
| Bookings escrow_state column | <5 min | `ALTER TABLE bookings DROP COLUMN escrow_state` |
| Feature flag aktiverad | <1 min | `UPDATE platform_settings SET value='false' WHERE key='fas8_escrow_enabled'` |
| Edge Functions deployade | Manual | `supabase functions delete <name>` (via CLI) |
| Stripe Connect-mode ändring | Medium risk | Återgå till destination charges i booking-create + deploy |

**Röd linje:** Rollback av Stripe Connect-mode efter 30+ dagars produktionskörning är RISKFYLLT. Använd legacy-mode för gamla bookings (§9.1) så rollback inte rör existerande betalningar.

---

## 11. Referenser

- [arkitekturplan-v3.md §8](../planning/spick-arkitekturplan-v3.md)
- [money-layer.md](money-layer.md) — money.ts, calculatePayout, triggerStripeTransfer
- [event-schema.md](event-schema.md) — BookingEventType inkluderar escrow_held, escrow_released, dispute_opened, dispute_cleaner_responded, dispute_resolved
- [fas-1-6-stripe-transfer-design.md](fas-1-6-stripe-transfer-design.md) — Stripe Connect teknisk grund
- [timezone-convention.md](timezone-convention.md) — SLA-timer tidszon
- EU Platform Work Directive 2024 — [hämtas vid Fas 8-start, regel #30]

---

## 12. Working defaults (FASTSTÄLLDA 2026-04-23 — kräver jurist-verifikation innan PROD)

| Beslut | Working default | Jurist-verifiering behövs? |
|---|---|---|
| Auto-release timer | **24h** | ✅ Verifiera mot PWD "rimlig tid för bestridan" |
| Max refund utan admin | **500 kr VD tier-1** + 10% random admin-sampling | ✅ Verifiera med styrelse/jurist |
| 2-ögon-krav | **>5000 kr** dispute | ✅ **Primärt** — mot PWD "oberoende granskning"-krav |
| Evidence-retention GDPR | **6 mån evidens (foto/text)** / **7 år meta (belopp/beslut)** | ✅ GDPR-jurist (Art. 4 PII + BokfL) |
| Klarna chargeback | **Auto-move till `disputed`** + Slack-alert | ❌ Tekniskt beslut, ingen jurist |

**Farhad-godkänt 2026-04-23 som working defaults för design + implementation.** PROD-aktivering av Fas 8.X kräver jurist-verifikation av ovan PWD-, GDPR- och Stripe-compliance-aspekter (senast oktober 2026).

**Motivering för defaults:**
- 24h: balans mellan cash-flow (cleaner) och bestridande-tid (kund). Industry-benchmark (Airbnb, Uber Eats).
- 500 kr tier-1: täcker ~90% av customer-service-volym. Random sampling skyddar mot conflict-of-interest.
- 5000 kr 2-ögon: ~1-2 städningar. Verifiera mot PWD-spec.
- 6mån/7år split: separera PII-evidens från bokförings-meta. Minimerar GDPR-exposure utan att bryta BokfL.
- Auto-move Klarna: konsekvent audit-trail + cleaner får chans att svara (48h).

---

## 13. Session-plan (60-80h fördelning)

Denna doc är §8.1 (design). Resterande sub-tasks över Fas 8-sessioner:

| Sub-fas | Timmar | Dependencies |
|---|---|---|
| §8.2 booking-create refactor | 8-10h | §8.1 klar |
| §8.3-8.4 schema + migrations | 4-6h | §8.1 klar |
| §8.5 storage bucket | 1-2h | §8.3 klar |
| §8.6 escrow-state-transition EF | 4-6h | §8.3 klar |
| §8.7 escrow-release EF | 3-4h | §8.3 + money.ts |
| §8.8-8.10 dispute EFs (3 st) | 8-12h | §8.3 + §8.6 |
| §8.11 unified refund-booking | 6-8h | §8.7 |
| §8.12-8.13 crons | 3-5h | §8.7 + §8.10 |
| §8.14-8.17 frontends | 10-15h | §8.6-§8.10 |
| §8.18-8.19 migration + rollback | 3-5h | allt ovan |
| §8.20-8.25 compliance + polish | 6-10h | allt ovan + jurist |

**Total:** 56-83h. Matchar plan §8 estimat 60-80h.

---

## 14. Regelefterlevnad vid framtida Fas 8-arbete

Obligatoriskt:
- **#26** Grep före varje ALTER/INSERT mot existerande tabeller
- **#27** Scope per sub-fas. INGEN refactor över sub-task-gräns.
- **#28** Money-logik i `_shared/money.ts`. Event-logik i `_shared/events.ts`. Inga nya helpers utan behov.
- **#29** EU Platform Work Directive-research FÖRST (§6.2). Jurist-verifikation innan deploy.
- **#30** Stripe-regler, EU-compliance, bokföringslag-tolkning: verifieras mot primärkälla + jurist. INGA antaganden.
- **#31** `bookings`-schema verifieras mot migration-filer INNAN SQL skrivs. Lärdom från 2026-04-27-session (jag skrev monitoring-SQL mot obefintlig `bookings.company_id` — korrigerad i `fd2a2c5`).

---

**Nästa steg:** Farhad godkänner denna skiss + fastställer öppna beslut §12. Sedan startar §8.2 (booking-create refactor) i egen session.

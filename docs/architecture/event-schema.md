# Event Schema (booking_events)

**Status:** Fas 6.2 foundation · 2026-04-23
**Primärkälla-kod:** [`supabase/functions/_shared/events.ts`](../../supabase/functions/_shared/events.ts)
**Plan-referens:** [`docs/planning/spick-arkitekturplan-v3.md`](../planning/spick-arkitekturplan-v3.md) §6 (Event-system)
**Tabell-schema:** [`supabase/migrations/20260401181153_sprint1_missing_tables.sql`](../../supabase/migrations/20260401181153_sprint1_missing_tables.sql) rad 92-123

---

## 1. Syfte

Ge Spick en enhetlig, auditbar timeline per bokning:

- **Admin:** "Vad hände med bokning X?" — svar på 10 sek via event-timeline
- **Dispute-flöde (Fas 8):** audit-trail krävs av EU Platform Directive (2 dec 2026)
- **Observability (Fas 10):** event-stream → Slack/Discord-alerts
- **Kund-förtroende:** min-bokning.html kan visa transparent timeline
- **Städare-transparens:** stadare-dashboard.html kan visa egen jobb-historik

Canonical event-types enforcas via TypeScript-typen `BookingEventType` i `_shared/events.ts`. Retrofit av befintliga EFs sker i Fas 6.3 (separat sprint).

---

## 2. Tabell-struktur

```sql
CREATE TABLE booking_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL,              -- FK logisk (ingen CASCADE på prod)
  event_type  TEXT NOT NULL,              -- canonical, se §3
  actor_type  TEXT DEFAULT 'system',      -- see §4
  metadata    JSONB DEFAULT '{}',         -- se §5
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS: service_role SELECT/INSERT/UPDATE/DELETE
-- Index: idx_booking_events_booking ON booking_events(booking_id)
```

**RPC-signatur (ENDA vägen för INSERT):**

```sql
log_booking_event(
  p_booking_id UUID,
  p_event_type TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_metadata   JSONB DEFAULT '{}'
) RETURNS void  -- SECURITY DEFINER
```

Klient-sidan ska använda `logBookingEvent()`-wrappern i [`_shared/events.ts`](../../supabase/functions/_shared/events.ts) för compile-time-typ-säkerhet.

---

## 3. Canonical event-types

Komplett lista matchar `BookingEventType`-union i `events.ts`. Grupperas nedan per affärsfas.

### 3.1 Livscykel (boknings-grundflöde)

| Event | När emitteras | Primär EF |
|---|---|---|
| `booking_created` | Bokning sparad, betalning ev. pending | `booking-create` |
| `cleaner_assigned` | Primär cleaner kopplad (auto-delegate eller direkt-val) | `auto-delegate` / `booking-create` |
| `cleaner_reassigned` | Byte av primär cleaner | `booking-reassign` |
| `cleaner_invited` | Team-invite (booking_team-rad skapad, Modell C multi-cleaner) | TBD Sprint C-3 |
| `cleaner_declined` | Cleaner avvisar invite eller bokning | `cleaner-booking-response` |
| `checkin` | Städare markerar ankomst (geo-checkin) | TBD (checkin-EF) |
| `checkout` | Städare markerar slutförande | TBD (checkout-EF) |
| `completed` | Jobb marked som klart (auto eller manuell) | `booking-auto-complete` eller admin |

### 3.2 Betalning (Fas 1 + Fas 8)

| Event | När emitteras | Primär EF |
|---|---|---|
| `payment_received` | Stripe `charge.succeeded` (idag: direct charges) | `stripe-webhook` |
| `payment_captured` | Separate charges capture (efter Fas 8 escrow-refactor) | `stripe-webhook` (Fas 8) |
| `escrow_held` | Pengar hålls på plattformskonto (Fas 8) | `stripe-webhook` (Fas 8) |
| `escrow_released` | Transfer till cleaner (attest eller 24h auto-release) | `escrow-release` (Fas 8) |
| `refund_issued` | Refund genomförd | `refund-booking` (unified, Fas 8) |

### 3.3 Avbrott

| Event | När emitteras | Primär EF |
|---|---|---|
| `cancelled_by_customer` | Kund avbokar | `booking-cancel-v2` |
| `cancelled_by_cleaner` | Cleaner avbokar | `cleaner-booking-response` |
| `cancelled_by_admin` | Admin avbokar via admin.html | admin-action |
| `noshow_reported` | No-show rapporterat av kund/cleaner | `noshow-refund` |

### 3.4 Dispute (Fas 8 EU-compliance)

| Event | När emitteras | Primär EF |
|---|---|---|
| `dispute_opened` | Kund öppnar dispute + evidens | `dispute-open` (Fas 8) |
| `dispute_cleaner_responded` | Cleaner svarar inom 48h | `dispute-cleaner-respond` (Fas 8) |
| `dispute_resolved` | Admin-beslut: full/partial refund eller dismissed | `dispute-admin-decide` (Fas 8) |

### 3.5 Kvalitet

| Event | När emitteras | Primär EF / frontend |
|---|---|---|
| `review_submitted` | Betyg insert:at i ratings-tabellen | `betyg.html` |

### 3.6 Recurring (Fas 5)

| Event | När emitteras | Primär EF |
|---|---|---|
| `recurring_generated` | Cron genererade nästa tillfälle i serien | `generate-recurring-bookings` (Fas 5) |
| `recurring_skipped` | Enskilt tillfälle hoppat (helgdag, kund-val) | `generate-recurring-bookings` |
| `recurring_paused` | Hela serien pausad av kund | min-bokning.html-action |
| `recurring_resumed` | Serien återupptagen | min-bokning.html-action |
| `recurring_cancelled` | Serien uppsagd helt | min-bokning.html-action |

### 3.7 Ändring

| Event | När emitteras | Primär EF |
|---|---|---|
| `schedule_changed` | Datum/tid flyttad för bokning | `booking-reschedule` eller admin |

---

## 4. Actor types

```ts
type ActorType = "system" | "customer" | "cleaner" | "admin" | "company_owner";
```

| Actor | Användning |
|---|---|
| `system` | Default. Cron/trigger/webhook utan explicit user-context |
| `customer` | Kund-initierad action (avbokning, recension, dispute) |
| `cleaner` | Städar-initierad (checkin, accept, decline) |
| `admin` | Spick-admin via admin.html |
| `company_owner` | VD via foretag-dashboard.html (Fas 9 VD-autonomi) |

---

## 5. Metadata-konventioner

Metadata-fältet är öppen JSONB, men EFs bör följa förväntad nyckel-lista per event-type. Se `EVENT_METADATA` constant i `_shared/events.ts` för canonical lista.

**Regel:** metadata är AUDIT, inte primär-data. Inga fält som är kritiska för business-logik ska BARA finnas här — de ska alltid finnas i en separat tabell (bookings, ratings, escrow_events etc.).

**Exempel-payloads:**

```jsonc
// booking_created
{ "service": "Hemstädning", "total_price": 2400, "cleaner_id": "abc-...", "company_id": null }

// cleaner_assigned
{ "cleaner_id": "abc-...", "assigned_by": "auto-delegate", "delegation_route": "vd_timeout_2h" }

// review_submitted
{ "rating": 5, "cleaner_id": "abc-...", "has_comment": true }

// escrow_released (Fas 8)
{ "stripe_transfer_id": "tr_...", "amount_to_cleaner": 2112, "release_reason": "customer_attested" }
```

---

## 6. Retrofit-plan (Fas 6.3, separat sprint)

Prio-ordning baserat på audit-värde:

1. **`booking-create`** → `booking_created` (redan live, migrera till helper)
2. **`auto-delegate`** → `cleaner_assigned` + delegation-route metadata
3. **`cleaner-booking-response`** → `cleaner_declined` / `cancelled_by_cleaner`
4. **`booking-cancel-v2`** → `cancelled_by_customer`
5. **`stripe-webhook`** → `payment_received`, `refund_issued`
6. **`noshow-refund`** → `noshow_reported` + `refund_issued`
7. **`auto-remind`** (om det triggar state-change) → relevant event
8. **`betyg.html`** → `review_submitted` (frontend via anon, RPC måste tillåtas)

Sprintar efter Fas 8 (Dispute + Escrow):
- Escrow-EFs loggar `escrow_held`, `escrow_released`
- Dispute-EFs loggar `dispute_opened`, `dispute_cleaner_responded`, `dispute_resolved`

Sprint efter Fas 5 (Retention):
- Recurring-cron loggar `recurring_*` events

---

## 7. Bakåtkompatibilitet

Tabellen existerar sedan `20260401181153_sprint1_missing_tables.sql`. Endast `booking-create:528-530` loggar idag (händelse `booking_created`). Helpern i `_shared/events.ts` ändrar INGET existerande beteende — det är ren additiv infrastruktur.

Retrofit per Fas 6.3 sker gradvis. Varje EF-migrering är isolerad commit med egen verifiering.

---

## 8. Frontend-exponering

**Kund-facing (`min-bokning.html`):** Visa bara "mjuka" events (kund-relevanta), filtrera tekniskt brus. Whitelist:
- booking_created, cleaner_assigned, cleaner_reassigned
- checkin, checkout, completed
- payment_received, escrow_released, refund_issued
- cancelled_by_*
- review_submitted

**Städar-facing (`stadare-dashboard.html`):** Visa cleaner-relevanta, t.ex. egen `cleaner_invited`, `cleaner_assigned`, `checkin`, `checkout`, `completed`, `review_submitted`.

**VD-facing (`foretag-dashboard.html`):** Visa team-events filtrerade på `company_id` (via JOIN till bookings).

**Admin-facing (`admin.html`):** Visa ALLA events för en bokning. Dispute-queue använder `dispute_*`-events för SLA-timers.

Ingen av dessa frontend-vyer är byggd ännu — de tillhör §6.4-6.6.

---

## 9. Versionshistorik

| Datum | Ändring | Commit |
|---|---|---|
| 2026-04-23 | Foundation skapad. `_shared/events.ts` + 8 tester + denna doc. | (se git blame) |

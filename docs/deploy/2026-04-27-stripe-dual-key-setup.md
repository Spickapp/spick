# Setup: Stripe Dual-Key Infrastructure (test/live toggle)

**Datum:** 2026-04-23
**Status:** KOD KLAR, KRÄVER FARHADS SETUP FÖR ATT AKTIVERAS
**Relaterade commits:** se commit efter denna fil

---

## Vad det här löser

Problemet: Stripe Checkout i live-mode accepterar inte test-kort som `4242 4242 4242 4242`. För att testa betalningsflödet måste man antingen:
- använda riktigt kort (real pengar + refund)
- byta STRIPE_SECRET_KEY till test-värde (risk att glömma byta tillbaka)

Lösning: feature-flag `platform_settings.stripe_test_mode` som togglar mellan live och test utan kod-ändring eller deploy.

---

## Arkitektur

### Hur det fungerar

**booking-create** (utgående API-calls):
- Läser `platform_settings.stripe_test_mode` vid varje request
- Om `'true'` + `STRIPE_SECRET_KEY_TEST` satt → använder test-nyckeln
- Annars fallback till live
- Fail-safe: om flag=true men secret saknas → logga warning + fallback live (förhindrar betalnings-downtime)

**stripe-webhook** (inkommande events):
- Läser `event.livemode` (Stripe-native flag i webhook-payload)
- Om `livemode=false` (test-event) + `STRIPE_SECRET_KEY_TEST` satt → använder test-nyckeln för Stripe API-callback-verifiering
- Annars live-nyckel
- Smart: ingen flag-läsning behövs för webhooks — Stripe själv märker varje event

**capturePayment** (stadare-dashboard action=capture):
- Läser flag från `platform_settings.stripe_test_mode` (samma som booking-create)
- Behövs eftersom detta inte är event-driven

---

## Setup (engångs, ~10 min)

### Steg 1: Supabase Secrets

Gå till [Supabase Dashboard → Settings → Edge Functions → Secrets](https://supabase.com/dashboard/project/urjeijcncsyuletprydy/settings/functions)

Lägg till 2 nya secrets:

| Secret name | Värde |
|---|---|
| `STRIPE_SECRET_KEY_TEST` | `sk_test_...` (kopiera från Stripe Dashboard → Developers → API keys → Testmode) |
| `STRIPE_WEBHOOK_SECRET_TEST` | `whsec_...` (skapas i steg 2 nedan) |

**OBS:** `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (utan _TEST) förblir LIVE-nycklarna. Rör dem inte.

### Steg 2: Stripe Test-Webhook endpoint

1. Gå till [Stripe Dashboard](https://dashboard.stripe.com/test/webhooks) — **växla till Testmode** (toggle uppe till höger)
2. Klicka "Add endpoint"
3. URL: `https://urjeijcncsyuletprydy.supabase.co/functions/v1/stripe-webhook`
4. Events att lyssna på: samma som live-endpoint. Lägg till:
   - `checkout.session.completed`
   - `payment_intent.payment_failed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
5. Skapa endpoint → kopiera "Signing secret" → det är värdet för `STRIPE_WEBHOOK_SECRET_TEST` ovan

### Steg 3: Kör migration (seed flag)

I Supabase Studio SQL Editor:

```sql
INSERT INTO platform_settings (key, value, description)
VALUES (
  'stripe_test_mode',
  'false',
  'När ''true'': booking-create använder STRIPE_SECRET_KEY_TEST. stripe-webhook auto-detekterar test-events via event.livemode. DEFAULT false (live mode).'
)
ON CONFLICT (key) DO NOTHING;

-- Verifiera
SELECT key, value FROM platform_settings WHERE key = 'stripe_test_mode';
-- Förväntat: key=stripe_test_mode, value=false
```

Alternativt kör migration-filen som commit 2026-04-27 lägger till.

### Steg 4: Deploy Edge Functions

```bash
supabase functions deploy booking-create --project-ref urjeijcncsyuletprydy
supabase functions deploy stripe-webhook --project-ref urjeijcncsyuletprydy
```

---

## Användning: Toggla test ↔ live

### Aktivera test-mode

```sql
UPDATE platform_settings SET value='true' WHERE key='stripe_test_mode';
```

Nästa bokning (från boka.html) kommer:
- Skapa Stripe Checkout Session i test-mode
- Accepter test-kort `4242 4242 4242 4242` (exp: vilken framtida tid, CVC: vilken 3-siffrig)
- webhook tar emot `livemode=false` events och verifierar med test-secret

Loggar i booking-create: `[booking-create] STRIPE TEST MODE aktivt`

### Gå tillbaka till live

```sql
UPDATE platform_settings SET value='false' WHERE key='stripe_test_mode';
```

**Rekommendation:** Ha en timer på dig själv — kör testerna inom 30 min och byt tillbaka. Sätt kalenderpåminnelse.

---

## Verifiering (efter setup)

### Test 1: live-mode fungerar (default state)

```sql
SELECT value FROM platform_settings WHERE key='stripe_test_mode';
-- Ska vara: false
```

Kör en riktig bokning med eget kort → betalning går igenom → email + event-logging fungerar.

### Test 2: test-mode switchar korrekt

```sql
UPDATE platform_settings SET value='true' WHERE key='stripe_test_mode';
```

Boka från boka.html med 4242-kort → Stripe Checkout ska INTE visa "Kortet nekades. Din begäran gjordes i live-läge, men den använde ett känt testkort".

Betalning går igenom → Spick tar emot test-webhook (livemode=false) → event verifieras → booking_events får `payment_received`-rad med `stripe_charge_id` som börjar `ch_test_...`.

### Test 3: rollback-verifiering

```sql
UPDATE platform_settings SET value='false' WHERE key='stripe_test_mode';
```

Kör ännu en live-bokning → ska fungera exakt som före test.

---

## Säkerhetsmodell

### Fail-modes

| Scenario | Beteende |
|---|---|
| `stripe_test_mode=true` men `STRIPE_SECRET_KEY_TEST` saknas | booking-create loggar warning + fallback live. Säker default. |
| `stripe_test_mode=false` men test-event inkommer | stripe-webhook läser `event.livemode=false` → använder test-secret → verifiering lyckas. Independent av flag. |
| Flag-läsning misslyckas (DB-fel) | booking-create fallback live. Säker default. |
| `STRIPE_SECRET_KEY_TEST` satt fel (expired/revoked) | Stripe API returnerar 401 → booking-create error → kund får error-sida. Ingen silent failure. |

### Audit-trail

- Test-mode-aktivering syns i `platform_settings.updated_at`
- Varje test-bokning loggar `booking_created` i `booking_events` med metadata (fas 6 retrofit)
- Stripe events kommer med `livemode: false` → webhook loggar `[stripe-webhook] TEST event received`

### Risk-områden

- **Människa-fel:** Kan glömma toggla tillbaka till live. Mitigering: kalender-påminnelse.
- **Test/live-kors:** Om Farhad råkar skapa en test-bokning medan flag=false → Stripe rejectar direkt (nuvarande beteende, påverkas inte).
- **Dual webhook-endpoints:** Båda live + test måste vara korrekt konfigurerade i Stripe Dashboard. Om bara live finns, test-events når aldrig stripe-webhook.

---

## Rollback (om något går fel)

### Snabbt rollback

```sql
UPDATE platform_settings SET value='false' WHERE key='stripe_test_mode';
```

### Full rollback (radera flag helt)

```sql
DELETE FROM platform_settings WHERE key='stripe_test_mode';
```

Kod faller tillbaka till live-mode default (via fallback i `resolveStripeKey`).

### Kod-rollback

Om Farhad vill ta bort dual-key infrastructure helt:

```bash
git revert <commit-sha>  # revert stripe-dual-key-commit
supabase functions deploy booking-create --project-ref urjeijcncsyuletprydy
supabase functions deploy stripe-webhook --project-ref urjeijcncsyuletprydy
```

Radera test-secrets från Supabase Dashboard + test-webhook-endpoint i Stripe.

---

## Framtida utveckling

Denna infrastruktur låser upp:

1. **E2E-testning i CI** (plan §1.6 + §12.1): automatiserade bokning → charge → webhook → verify-flöden
2. **Pilot-testning utan real pengar**: Rafa-pilot kan testa utan Stripe Connect live-account
3. **Dispute/Escrow-testning** (Fas 8): test-mode för att trigga dispute.created-events

Inga fler kod-ändringar behövs för dessa — bara sätt `stripe_test_mode=true` vid test-kör.

---

## Regelefterlevnad

- **#26** Grep-verifierat alla `STRIPE_SECRET_KEY`-usages innan refactor
- **#27** Minimal scope: flag-infrastruktur only, INGA payment-flow-ändringar
- **#28** Single source: `platform_settings.stripe_test_mode` + `_TEST` Supabase secrets. Ingen duplicering.
- **#29** Stripe webhook-docs primärkälla för `event.livemode`-flaggan
- **#30** Stripe-regler verifierat via docs.stripe.com (livemode-flag i webhook events är native)
- **#31** Kod-test: 8/8 events-tests pass. Type-check: endast pre-existing H5-error (inte relaterat).

# Manual-bokning med BankID + RUT-flöde — design-spec

**Status:** PLANNING-DOC, inte implementerad
**Skapad:** 2026-04-25
**Vision-källa:** Farhad 2026-04-25 ("när man lägger till jobb manuellt
att bank id skickas med när kundens personnummer efterfrågas så att man
godkänner rut, även det betalningsflödet får inte missas")
**Implementation BLOCKAD AV:** Fas 7.5 jurist-OK (RUT-aktivering) +
TIC BankID-integration deploy

---

## 1. Vision

Spick ska vara skalbart, enkelt, gratis. Ett av flödena är **manuell
bokning** där admin (eller VD/städare) skapar en bokning på kundens
vägnar — t.ex. när kund ringer/mejlar i stället för att boka via
boka.html.

För RUT-berättigade tjänster (Hemstädning, Storstädning, Flyttstädning,
Fönsterputs, Trappstädning) krävs PNR + samtycke. Kund godkänner via
BankID innan bokningen aktiveras.

Betalning sker via Stripe Checkout-länk som skickas till kund efter
BankID-signering.

## 2. Aktörer + entry-points

| Aktör | Entry-point | Behörighet |
|---|---|---|
| Admin | admin.html → "Lägg till bokning" | Service-role via admin-auth |
| VD (company_owner) | foretag-dashboard.html → "Skapa bokning för kund" | Authenticated, RLS-restrikterad till egen company |
| Städare | Endast via admin/VD-godkännande | Ej direktåtkomst (förebygger fraud) |

## 3. Flow (high-level)

```
1. Admin/VD trycker "Skapa bokning"
2. Fyller i: service, datum, tid, varaktighet, adress
3. Anger kundens email + telefon (nytt eller befintligt customer_profile)
4. Väljer städare (eller låt auto-delegate)
5. För RUT-bokning: visar PNR-input MEN markerar "BankID krävs"
6. Spara → status='draft', booking-create EF skapar pending booking
7. SMS/email till kund med BankID-signeringslänk
8. Kund öppnar länk → TIC BankID-flow → signerar
9. Vid signering: PNR registreras (krypterat), RUT-samtycke loggas
10. Bokning övergår till status='pending_payment'
11. Stripe Checkout-länk skickas till kund
12. Vid betalning: status='paid', auto-confirm enligt cleaner-tier
13. Vid utfört arbete: RUT-ansökan till SKV (Fas 7.5)
```

## 4. Komponenter (att bygga)

### 4.1 Admin-UI: "Lägg till bokning"-modal i admin.html

Återanvänder boka.html-formfält men admin-side:
- Ingen Stripe-direktbetalning vid submit (kund får länk istället)
- Pre-fill kund från `customer_profiles` om email matchar befintlig
- Validering: PNR skickas EJ från admin-form (kommer via BankID-flow)

### 4.2 Edge Function: `manual-booking-create`

Lik `booking-create` men:
- Service-role auth (admin/VD)
- Skip PNR-collection
- Status='draft' initialt
- Generera signing-token (UUID, 24h TTL)
- Trigga SMS/email med signerings-länk

### 4.3 BankID-flow: ny sida `/godkann.html?token=<UUID>`

Public sida som:
1. Validerar token mot `pending_signatures`-tabell
2. Visar booking-summary (service, datum, pris)
3. Förklarar RUT-samtycke pedagogiskt
4. Anropar TIC BankID `/auth/start` (Hosted-mode)
5. Vid success: lagrar PNR krypterat (AES-GCM via pgcrypto eller server-side)
6. Skickar Stripe Checkout-länk via SMS/email

### 4.4 Edge Function: `bankid-callback`

TIC webhook handler:
- Verifiera TIC signature
- Decrypt PNR från TIC payload
- Update booking: pnr_encrypted, rut_consent_at, signing_completed_at
- Trigga `stripe-checkout-create` för betalningssida
- Logga event `pnr_signed` i booking_events

### 4.5 Schema-tillägg

```sql
-- ny tabell: pending signatures
CREATE TABLE pending_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  signing_token UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  signed_at TIMESTAMPTZ,
  bankid_provider TEXT DEFAULT 'tic',
  pnr_encrypted TEXT,  -- AES-GCM
  consent_recorded JSONB,  -- TIC-payload signature + timestamp
  created_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- bookings nya kolumner
ALTER TABLE bookings ADD COLUMN signing_token UUID;
ALTER TABLE bookings ADD COLUMN signed_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN created_by_admin BOOLEAN DEFAULT false;
ALTER TABLE bookings ADD COLUMN created_by_user_id UUID;
```

### 4.6 Stripe Checkout-flow för manual-bokning

`stripe-checkout-create` (eller existerande): tar booking-id efter
BankID-signering, skapar Checkout-Session med:
- success_url: `/tack.html?bid=<id>`
- cancel_url: `/godkann.html?token=<token>` (kund kan avbryta)
- metadata: booking_id, signing_token, manual_booking=true

Webhook (existerande `stripe-webhook`): vid payment_received markerar
booking som paid + auto-confirms cleaner.

## 5. RUT-samtycke (regulator-känsligt)

**RULE #30:** Skatteverket-kraven måste verifieras med jurist innan
implementation. Plan-skiss baserat på allmän kunskap, ej regulator-spec:

- BankID-signering ger **bevisbart kund-samtycke** för RUT-deklaration
- TIC BankID returnerar signerad payload med personnummer + timestamp
- Spick lagrar signed-payload som audit-trail
- Vid SKV-submission (Fas 7.5): refererar signing_token för revisor

**Frågor till jurist (Fas 7.5):**
1. Är BankID-signering sufficient för RUT-samtycke, eller krävs
   explicit text-based consent?
2. Hur länge ska consent-payload lagras? (BokfL 7 år vs GDPR-radering)
3. Måste consent-text refereras explicit i SKV-XML?

## 6. Implementation-ordning (när Fas 7.5 är klart)

### Fas A — Manual booking-skelett (utan BankID)
- Bygg admin-UI + manual-booking-create EF
- Status='pending_payment', skip BankID/PNR
- Stripe Checkout-länk via SMS/email
- **Funktion:** Admin kan skapa B2B-bokningar (ej RUT) helt manuellt

### Fas B — TIC BankID-integration (efter TIC-credentials klart)
- pending_signatures-tabell + RLS
- /godkann.html med Hosted-mode TIC-flow
- bankid-callback EF
- **Funktion:** Privat-bokningar med BankID-auth (utan RUT än)

### Fas C — RUT-aktivering (BLOCKAD: Fas 7.5 jurist-OK)
- Aktivera PNR-fält i godkann-flow
- AES-GCM encryption i bankid-callback
- RUT-samtycke i consent_recorded
- **BLOCKERS:**
  - Jurist OK på BankID-consent-text
  - SKV API-spec 2026 verifierad
  - PNR-encryption-strategi godkänd
  - Honest text-skrivning för kund

### Fas D — Auto-RUT-submission (BLOCKAD: Fas 7.5 deploy)
- Vid completed-event: trigga rut-claim EF
- Submission via SKV API
- Audit-trail per booking_events

## 7. Hårda blockerare (rule #30)

Innan ANY del av detta byggs i prod:

| Blocker | Status | Källa |
|---|---|---|
| SKV API-spec 2026 verifierad | ⛔ BLOCKAD | docs/sanning/rut.md |
| Jurist-OK på consent-text | ⛔ BLOCKAD | Fas 7.5 |
| PNR-encryption-strategi (AES-GCM vs pgcrypto) | ⛔ BLOCKAD | docs/sanning/pnr-och-gdpr.md |
| TIC BankID credentials i prod-vault | ⛔ Väntar Farhad | Iteration efter A1 |
| Stripe Checkout-test för manual-flow | 🟡 Möjligt nu | Fas A |

## 8. Vad jag kan bygga UTAN regulator-blockerare

**Fas A (manual-booking utan BankID/RUT)** är möjligt nu om:
1. Endast B2B-bokningar (kontorsstädning, byggstädning — ingen RUT)
2. Eller privat utan RUT-rabatt (ovanligt)
3. Stripe-flow utan PNR-collection

Det löser problemet "admin behöver kunna lägga till bokning manuellt"
för B2B-kunder utan att bryta regulator-låsningar.

**Förslag:** Bygg Fas A nu. Fas B+C+D efter Fas 7.5 jurist-OK.

## 9. Pricing-flow (rule #28 SSOT)

Manual-bokning ska använda **samma pricing-resolver** som boka.html:
- `_shared/pricing-resolver.ts` returnerar pris baserat på
  service + sqm + hours + cleaner-rate + RUT-flag
- `total_price` lagras som NETTO efter RUT (per docs/sanning/rut.md)
- `rut_amount` lagras separat
- Helper `calcBookingPrice()` för display (per js/booking-price.js)

Inga nya pricing-paths. SSOT-konvention behålls.

## 10. Open questions (för Farhad)

1. Ska VD också ha "Skapa bokning"-rätten, eller bara admin?
2. För B2B utan BankID: räcker email-bekräftelse av kund, eller måste
   manual-bokningar ha någon signering-form?
3. Stripe Checkout-länk-livslängd: 24h, 48h, 7 dagar?
4. Vid token-expiration utan signering: radera draft-booking eller
   notifiera admin?
5. För kund som redan har customer_profile: skip PNR-input om existing
   pnr_encrypted finns? (Återanvänd consent från tidigare booking?)

## Ändringar

| Datum | Ändring | Av |
|---|---|---|
| 2026-04-25 | Skapad. Vision från Farhad. Implementation BLOCKAD av Fas 7.5. | Farhad + Claude session |

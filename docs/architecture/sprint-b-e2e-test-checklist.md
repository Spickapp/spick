# Sprint B — End-to-end Test-Checklist

Använd denna checklista för att manuellt verifiera hela Sprint B-flödet i produktion.

**Förväntad körtid:** ~45 minuter
**Förberedelse:** Ha tillgång till en testmobil (för SMS-mottagning) och en anonym Stripe-identitet

---

## Test 1: Self-signup — företagsregistrering

**Mål:** Verifiera att en extern VD kan registrera sitt företag utan admin-interaktion.

### Steg

- [ ] **1.1** Öppna https://spick.se/bli-foretag.html i inkognito-flik
- [ ] **1.2** Verifiera:
  - Nav laddas med "Bli partner"-länk (desktop+mobile)
  - Hero-sektion visar gradient-bakgrund
  - 6 fördelar-kort renderas
  - "Så kommer du igång"-sektion visar 4 steg
  - FAQ-accordion öppnas/stängs
- [ ] **1.3** Klicka "Registrera mitt företag"-CTA
- [ ] **1.4** På registrera-foretag.html — Steg 1:
  - Ange org.nr `556677-8800` (Luhn-giltigt)
  - Ange företagsnamn `Test Firma {tidsstämpel}`
  - Kryssa i "har F-skatt"
  - Klicka "Fortsätt →"
- [ ] **1.5** Steg 2:
  - Namn: `Test Testsson`
  - Email: `test+{timestamp}@example.com`
  - Telefon: `+46701234567` (gärna din test-mobil)
  - Klicka "Fortsätt →"
- [ ] **1.6** Steg 3 (granskning):
  - Verifiera att alla 6 review-rader visar rätt värden
  - Kryssa i alla 3 consent-checkboxar
  - Submit-knappen blir enabled
- [ ] **1.7** Klicka "Skicka in registrering"
- [ ] **1.8** Förväntat:
  - Steg 4 visas med success-ikon
  - "Slutför Stripe-registrering →" länk syns och är klickbar
  - Bekräfta-email skickat till `test+...@example.com`

### DB-verifiering

```sql
-- Hämta ny company
SELECT id, name, org_number, self_signup, onboarding_status, stripe_account_id
  FROM companies 
 WHERE org_number = '556677-8800' 
 ORDER BY created_at DESC LIMIT 1;

-- Förväntat: self_signup=true, onboarding_status='pending_stripe', 
--            stripe_account_id = acct_... (INTE null)
```

---

## Test 2: Admin godkänner företag

**Mål:** Verifiera admin pending-queue + approve-flöde.

### Steg

- [ ] **2.1** Öppna https://spick.se/admin.html (logga in som admin)
- [ ] **2.2** Verifiera:
  - "Företagsansökningar" visas i nav under Personal
  - Badge-counter visar antal pending
- [ ] **2.3** Klicka sektion → se kort för "Test Firma X"
- [ ] **2.4** Kortet visar:
  - Företagsnamn + org.nr
  - Self-signup badge (blå)
  - VD-info (namn, email, telefon)
  - Stripe-status (pending eller complete)
  - Tre knappar: Godkänn, Avslå, (Generera Stripe-länk om ej complete)
- [ ] **2.5** Klicka "✅ Godkänn"
  - Popup: "Valfritt meddelande till VD" → lämna tomt → OK
  - Confirm-dialog → OK
- [ ] **2.6** Förväntat:
  - Alert "{name} godkändes!"
  - Kortet försvinner från pending-listan
  - Badge-counter minskar med 1

### DB-verifiering

```sql
SELECT onboarding_status, onboarding_completed_at 
  FROM companies 
 WHERE id = '<company-id>';
-- Förväntat: onboarding_status='active', onboarding_completed_at!=null

SELECT is_approved, status 
  FROM cleaners 
 WHERE company_id = '<company-id>' AND is_company_owner = true;
-- Förväntat: is_approved=true, status='aktiv'
```

### Email-verifiering

- [ ] VD-emailen fick meddelande "Ditt företag är godkänt på Spick!"
- [ ] Om SMS-kapable telefon: fick SMS

---

## Test 3: VD loggar in + dashboard

**Mål:** Verifiera VD-dashboard + onboarding-checklist.

### Steg

- [ ] **3.1** Öppna `mitt-konto.html` inkognito
- [ ] **3.2** Logga in som VD (`test+...@example.com`) → OTP-kod från email
- [ ] **3.3** Navigera till `foretag-dashboard.html` (via mobile-nav eller direkt URL)
- [ ] **3.4** Dashboardet laddar:
  - Header visar företagsnamn
  - VD-checklist med 5 items (företag, Stripe, team, priser, första bokning)
  - Team-sektion (tom)
  - "Bjud in ny teammedlem"-formulär
- [ ] **3.5** Om Stripe inte är complete:
  - Checklist-item "Stripe-registrering" visar pending
  - "Slutför Stripe"-knapp finns och fungerar (öppnar Stripe i ny flik)

---

## Test 4: VD bjuder in teammedlem

**Mål:** Verifiera company-invite-member EF.

### Steg

- [ ] **4.1** I VD:s foretag-dashboard.html, fyll i:
  - Namn: `Anna Andersson`
  - Telefon: (din riktiga test-mobil, `+46701234567` eller liknande)
- [ ] **4.2** Klicka "Skicka inbjudan"
- [ ] **4.3** Förväntat:
  - Alert "Inbjudan skickad till Anna Andersson! SMS med länk skickat."
  - Team-listan uppdateras med Anna som "Inbjuden"
  - SMS anländer till test-mobilen inom 30 sek

### DB-verifiering

```sql
SELECT id, full_name, invited_phone, status, invited_via_magic_code
  FROM cleaner_applications
 WHERE invited_phone = '+46701234567'
 ORDER BY created_at DESC LIMIT 1;
-- Förväntat: status='invited', invited_via_magic_code != null
```

---

## Test 5: Teammedlem accepterar invite

**Mål:** Verifiera join-team.html + company-accept-invite.

### Steg

- [ ] **5.1** På test-mobilen, öppna SMS:et
- [ ] **5.2** Klicka magic-link (spick.se/m/XXXXXX)
- [ ] **5.3** Förväntat:
  - Magic-link lander på join-team.html?app_id=XXX
  - "Du är inbjuden" banner visar företagsnamn
  - Formulär: email, timpris, språk, F-skatt-checkbox, 2 consent
- [ ] **5.4** Fyll i:
  - Email: `anna+{ts}@example.com`
  - Timpris: 350 (default)
  - Språk: Svenska (default)
  - F-skatt: välj (ja eller nej, beroende på test-scenario)
  - Kryssa consent-checkboxar
- [ ] **5.5** Submit-knapp blir enabled när alla fält OK
- [ ] **5.6** Klicka "Slutför registrering"
- [ ] **5.7** Förväntat:
  - Success-sida visar "Välkommen till teamet!"
  - "Slutför Stripe-registrering"-knapp finns med Stripe URL
  - Välkomst-email skickat till Anna

### DB-verifiering

```sql
-- Anna har cleaner-rad
SELECT id, full_name, email, is_approved, status, company_id, stripe_account_id
  FROM cleaners
 WHERE email = 'anna+{ts}@example.com';
-- Förväntat: is_approved=true, status='onboarding', company_id=<VD:s company>, 
--            stripe_account_id != null

-- Invitation uppdaterad
SELECT status, onboarding_phase, approved_at 
  FROM cleaner_applications
 WHERE email = 'anna+{ts}@example.com';
-- Förväntat: status='approved', onboarding_phase='active'
```

---

## Test 6: VD ser uppdaterad team-lista

- [ ] **6.1** VD refreshar foretag-dashboard.html
- [ ] **6.2** Förväntat:
  - Team-lista visar Anna som "Väntar Stripe" (gul pill)
  - Inga "Inbjuden"-invites kvar
  - Counter: "1 aktiva, 0 inbjudna"

---

## Test 7: Stripe webhook — Anna slutför Stripe

**Obs:** Detta test kräver att Anna använder Stripe-URL och slutför ett "test"-konto där.
För Stripe test-konton: använd test-data från https://docs.stripe.com/connect/testing

- [ ] **7.1** Klicka Stripe URL från success-sidan (eller från email)
- [ ] **7.2** Fyll i alla Stripe-krav (test-SSN, test-kort, osv.)
- [ ] **7.3** Submit → Stripe skickar `account.updated` webhook
- [ ] **7.4** Vänta 30 sek → VD refreshar foretag-dashboard.html
- [ ] **7.5** Förväntat:
  - Team-lista visar Anna som "Aktiv" (grön pill)

### DB-verifiering

```sql
SELECT stripe_onboarding_status FROM cleaners WHERE email = 'anna+{ts}@example.com';
-- Förväntat: 'complete'
```

---

## Test 8: Cron — poll-stripe-onboarding-status

**Obs:** Testa endast om Stripe webhook missade (osannolikt i test, men manuellt trigga för säkerhet).

### Manuell trigger

```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/poll-stripe-onboarding-status \
  -H "Authorization: Bearer <service_role_key>"
```

### Förväntat

```json
{
  "ok": true,
  "checked": X,
  "updated": Y,
  "unchanged": Z,
  "errors": 0
}
```

- [ ] Inga errors i response
- [ ] Om Anna's status var `pending` men hon slutfört → `updated` = 1

---

## Test 9: Cron — expire-team-invitations

### Manuell trigger (efter att ha skapat äldre invite för test)

```sql
-- Skapa test-invite med fake äldre datum (måste vara admin)
UPDATE cleaner_applications 
   SET created_at = now() - interval '8 days' 
 WHERE id = '<någon-invited-rad-id>';
```

```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/expire-team-invitations \
  -H "Authorization: Bearer <service_role_key>"
```

### Förväntat

```json
{
  "ok": true,
  "expired": 1,
  "companies_notified": 1,
  "email_failures": 0
}
```

- [ ] Invite-rad har status='expired'
- [ ] VD fick email "1 teaminbjudan har gått ut"

---

## Städning efter test

```sql
BEGIN;

-- Ta bort alla test-företag
UPDATE companies SET owner_cleaner_id = NULL 
 WHERE name LIKE 'Test Firma%';

DELETE FROM cleaner_applications 
 WHERE email LIKE 'test+%@example.com' OR email LIKE 'anna+%@example.com';

DELETE FROM cleaners 
 WHERE email LIKE 'test+%@example.com' OR email LIKE 'anna+%@example.com';

DELETE FROM companies 
 WHERE name LIKE 'Test Firma%';

COMMIT;

-- Radera auth.users via Supabase Dashboard > Authentication > Users
```

---

## Slutrapport

| Test | Status | Kommentar |
|---|---|---|
| 1. Self-signup | ⬜ | |
| 2. Admin godkänner | ⬜ | |
| 3. VD login + dashboard | ⬜ | |
| 4. VD bjuder in | ⬜ | |
| 5. Team accepterar | ⬜ | |
| 6. Team-lista uppdaterad | ⬜ | |
| 7. Stripe webhook | ⬜ | |
| 8. Poll-cron | ⬜ | |
| 9. Expire-cron | ⬜ | |

**Godkänt om:** 9/9 gröna + inga errors i Supabase logs.

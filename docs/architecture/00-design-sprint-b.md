# Sprint B — Självgående Onboarding

**Design-dokument Dag 1 (2026-04-19)**

---

## 1. Executive Summary

Spick har redan 80% av onboarding-infrastrukturen (8 EFs, `cleaner_applications`-tabell, admin approval-flow, Stripe Connect-initiering). Sprint B fokuserar på de **kritiska luckor** som blockerar skalbarhet:

**Huvudmål:**
1. Automatisk detektering av Stripe Connect-completion (webhook)
2. Self-service företagsregistrering + VD-onboarding
3. Team-invitations via SMS + automatisk cleaner-skapande
4. VD-checklist på foretag-dashboard.html (visuell status av alla onboarding-steg)
5. Fix av `commission_rate 17 → 12` bug + centralisering

**Efter Sprint B:** En VD kan registrera företag, bjuda in team, och ha fullt fungerande Stripe Connect — utan Farhads intervention.

**Sprint A (Escrow) kan köras efteråt ovanpå denna färdiga infra.**

---

## 2. Nuvarande brister — rotorsaksanalys

### 2a. Stripe Connect completion saknar automatisk detektering

**Symptom:** Rafael klickade onboarding-URL, Stripe sa "klart", men `cleaners.stripe_onboarding_status` stannade på `pending`. Pengar skulle ha gått till Spick-balance, inte till honom.

**Rotorsak:** Ingen Stripe webhook-handler för `account.updated`-events.

**Fix:** Ny EF `stripe-connect-webhook` som lyssnar på `account.updated` → uppdaterar `stripe_onboarding_status` automatiskt.

### 2b. `onboard_cleaner` skapar duplicate accounts vid retry

**Symptom:** Vi försökte polla Rafaels status med `onboard_cleaner`-action (fel) → nytt Stripe-konto skapades (`acct_1TNs8a2Z1jUUfBhF`). Gamla kontot (`acct_1TMPCTFNYQLiXUWj`) är nu orphaned.

**Rotorsak:** `onboard_cleaner` kollar inte om `stripe_account_id` redan finns innan den skapar nytt.

**Fix:** Ny action `refresh_account_link` som genererar ny onboarding-URL mot EXISTERANDE account.

### 2c. `commission_rate: 17` hårdkodat i `admin-approve-cleaner`

**Symptom:** Nya företag får 17% istället för 12% → felaktiga utbetalningar.

**Rotorsak:** Hårdkodat värde i koden (rad 272).

**Fix:** Läs från `platform_settings.commission_standard` (redan centralisering enligt Regel #28).

### 2d. Ingen self-service företagsregistrering

**Symptom:** Rafael + Fazli måste ha skapats manuellt av Farhad via admin.html. Ingen `bli-foretag.html`-sida finns.

**Rotorsak:** Ej byggt.

**Fix:** Publik sida `bli-foretag.html` med BankID + org.nr-validering + auto-skapande av company+cleaner-rad.

### 2e. Inget team-invitation-flöde

**Symptom:** Daniella + Lizbeth skapades manuellt, inte via VD-invitation. Ingen skalbar lösning.

**Rotorsak:** Ej byggt.

**Fix:** VD skickar SMS med magic-link → cleaner klickar → BankID-verifiering → automatisk cleaner-rad + Stripe Connect startar.

### 2f. Ingen VD-checklist

**Symptom:** VD vet inte vad som behövs — Stripe Connect klar? Team tillagt? RUT-ombud klart?

**Rotorsak:** Ej byggt.

**Fix:** Dashboard-widget som visar alla onboarding-steg med status + actions.

---

## 3. Arkitektur-översikt

### 3a. Nytt onboarding-flöde (company + VD)

```
Publik landing: bli-foretag.html
  ↓
Fyll i formulär: BankID + org.nr + namn + email + telefon
  ↓
Anropa ny EF: company-self-signup
  ↓
Skapar:
  - companies-rad (status: pending_stripe)
  - cleaners-rad (VD, is_company_owner: true)
  - cleaner_applications-rad (status: approved via auto-path)
  - Stripe Connect account + onboarding-URL
  ↓
Visa: "Slutför Stripe-registrering: [URL]"
  ↓
VD klickar URL → slutför hos Stripe
  ↓
Stripe skickar webhook account.updated → vår webhook uppdaterar status=complete
  ↓
VD landar på foretag-dashboard.html
  ↓
Ser VD-checklist med nästa steg (bjud in team, verifiera RUT, osv)
```

### 3b. Nytt team-invitation-flöde

```
VD går till foretag-dashboard.html → sektion "Team"
  ↓
Klickar "Bjud in teammedlem" → formulär: namn + telefon
  ↓
Anropa ny EF: company-invite-team
  ↓
Skapar:
  - cleaner_applications-rad (invited_by_company_id = VD's company, status: invited)
  - Magic-link med scope="team_onboarding"
  - SMS till ny cleaner
  ↓
Ny cleaner får SMS: "Rafael har bjudit in dig till Rafa Allservice. Slutför registrering: [kort URL]"
  ↓
Klickar URL → landar på join-team.html
  ↓
BankID-inloggning
  ↓
Anropa accept-team-invitation EF
  ↓
Skapar:
  - cleaners-rad (company_id = VD's, is_company_owner: false)
  - Stripe Connect account + onboarding-URL
  ↓
Visa: "Slutför Stripe-registrering: [URL]"
  ↓
Webhook uppdaterar status=complete när klart
  ↓
Cleaner kan ta bokningar
```

### 3c. VD-checklist arkitektur

foretag-dashboard.html laddar en RPC `get_company_onboarding_status(company_id)` som returnerar:

```json
{
  "company_verified": true,          // org.nr + BankID klart
  "vd_stripe_complete": false,       // ← VD:s Stripe-status
  "rut_agent_registered": true,       // Skatteverket-ombud
  "team_members_count": 2,
  "team_members_stripe_complete": 1,  // hur många av teamet klar
  "first_booking_received": false,
  "company_logo_uploaded": false,
  "service_prices_configured": true,
  "bank_account_verified": true       // via Stripe
}
```

Frontend mappar till visuell checklist med gröna/röda ikoner + CTAs.

---

## 4. Database-ändringar

### 4a. Nya kolumner på `cleaner_applications`

```sql
ALTER TABLE public.cleaner_applications
  ADD COLUMN IF NOT EXISTS invited_via_magic_code text,   -- vilken magic-link använts
  ADD COLUMN IF NOT EXISTS invited_phone text,            -- telefon för SMS-invitation
  ADD COLUMN IF NOT EXISTS bankid_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS bankid_personnummer_hash text; -- SHA256 av personnummer
```

### 4b. Nya kolumner på `companies`

```sql
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS self_signup BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_status text DEFAULT 'pending_stripe',
  -- onboarding_status ∈ {'pending_stripe', 'pending_team', 'active', 'suspended'}
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
```

### 4c. Fix commission_rate bug

Istället för kolumnändring — centralisera ALL commission-read till platform_settings:

```sql
-- INGEN ALTER — gör det i kod (admin-approve-cleaner läser från platform_settings.commission_standard)
-- Men uppdatera befintliga företag med fel värde:

UPDATE companies 
   SET commission_rate = 12
 WHERE commission_rate = 17
   AND onboarding_status != 'legacy';  -- skydda eventuella legacy-företag
```

### 4d. Ny RPC: `get_company_onboarding_status`

```sql
CREATE OR REPLACE FUNCTION public.get_company_onboarding_status(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'company_verified', (c.org_number IS NOT NULL AND c.name IS NOT NULL),
    'vd_stripe_complete', (vd.stripe_onboarding_status = 'complete'),
    'rut_agent_registered', COALESCE(c.rut_agent_registered, false),
    'team_members_count', (SELECT COUNT(*) FROM cleaners WHERE company_id = c.id AND NOT is_company_owner),
    'team_members_stripe_complete', (SELECT COUNT(*) FROM cleaners WHERE company_id = c.id AND NOT is_company_owner AND stripe_onboarding_status = 'complete'),
    'first_booking_received', EXISTS (SELECT 1 FROM bookings WHERE cleaner_id IN (SELECT id FROM cleaners WHERE company_id = c.id) LIMIT 1),
    'company_logo_uploaded', (c.logo_url IS NOT NULL),
    'service_prices_configured', EXISTS (SELECT 1 FROM cleaner_service_prices WHERE cleaner_id = vd.id),
    'onboarding_status', c.onboarding_status,
    'stripe_account_id', vd.stripe_account_id
  ) INTO result
    FROM companies c
    LEFT JOIN cleaners vd ON vd.company_id = c.id AND vd.is_company_owner = true
   WHERE c.id = p_company_id;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_onboarding_status(uuid) TO authenticated;
```

---

## 5. Edge Functions

### 5a. NY: `stripe-connect-webhook`

Lyssnar på Stripe-events: `account.updated`, `account.application.authorized`, `account.application.deauthorized`.

**Logik för `account.updated`:**
1. Extrahera `account` från event
2. Om `details_submitted = true` AND `charges_enabled = true` AND `payouts_enabled = true`:
   - Uppdatera `cleaners.stripe_onboarding_status = 'complete'`
   - Om company_owner: uppdatera `companies.onboarding_status` via RPC eller direkt
   - Skicka SMS + email till cleaner: "Stripe-registrering klar! Du kan nu ta bokningar."
3. Annars om `requirements.currently_due` finns:
   - Sätt `stripe_onboarding_status = 'requirements_pending'`
   - SMS: "Stripe behöver mer info från dig: [URL]"

**Kritisk:** Webhook måste valideras mot `STRIPE_WEBHOOK_SECRET_CONNECT` (olika från booking-webhook secret).

### 5b. NY action: `stripe-connect/refresh_account_link`

Input: `{ action: "refresh_account_link", cleaner_id }`

**Logik:**
1. Hämta cleaner.stripe_account_id (FEJ skapa nytt)
2. Om NULL: returnera fel (måste använda `onboard_cleaner` först)
3. Annars: `stripe.accountLinks.create({ account: stripe_account_id, type: 'account_onboarding', ... })`
4. Returnera ny URL

### 5c. NY: `company-self-signup`

Input: `{ org_number, company_name, vd_name, vd_email, vd_phone, vd_pnr, bankid_signature }`

**Logik:**
1. Validera BankID-signature (via bankid-verify EF)
2. Kolla att org_number inte redan finns
3. Hämta commission från `platform_settings.commission_standard`
4. Transaction:
   - Skapa `companies`-rad (self_signup=true, status='pending_stripe')
   - Skapa `cleaners`-rad (is_company_owner=true)
   - Skapa `cleaner_applications`-rad (auto-approved)
   - Skapa Supabase Auth user med VD:s email
   - Trigga `stripe-connect/onboard_cleaner` → få onboarding-URL
5. Returnera `{ company_id, cleaner_id, stripe_onboarding_url }`

### 5d. NY: `company-invite-team`

Input: `{ company_id, team_member_name, team_member_phone }` (auth: VD via session)

**Logik:**
1. Validera att auth.uid() matchar VD av company_id
2. Skapa `cleaner_applications`-rad (invited_by_company_id, status='invited', invited_phone)
3. Anropa `public-auth-link` med scope="team_onboarding", redirect_to=`https://spick.se/join-team.html?app_id=...`
4. SMS via `sendMagicSms` till nummer: "X har bjudit in dig till [Company]. Registrera dig: [kort URL]"
5. Returnera success

### 5e. NY: `accept-team-invitation`

Input: `{ application_id, bankid_signature, email }` (anon, men validerad via magic-link session + BankID)

**Logik:**
1. Validera BankID + att session är etablerad (post-magic-link)
2. Läs `cleaner_applications` via application_id
3. Validera status='invited' och invited_by_company_id finns
4. Skapa:
   - `cleaners`-rad (company_id från application, is_company_owner=false)
   - Uppdatera `cleaner_applications.status='approved'`
5. Trigga `stripe-connect/onboard_cleaner` → få onboarding-URL
6. Returnera `{ cleaner_id, stripe_onboarding_url }`

### 5f. ÄNDRAD: `admin-approve-cleaner`

**Ändringar:**
- Rad 272: `commission_rate: 17` → läs från platform_settings
- Ingen annan ändring

### 5g. ÄNDRAD: `stripe-connect/onboard_cleaner`

**Ändringar:**
- Om `cleaners.stripe_account_id` redan finns → logga varning + returnera refresh_account_link-URL istället för att skapa nytt
- Detta förhindrar duplicate accounts som hände med Rafael

---

## 6. Frontend-ändringar

### 6a. NY: `bli-foretag.html`

Publik landing som motsvarar `bli-stadare.html` men för företag.

**Sections:**
1. Hero: "Starta ditt städföretag på Spick"
2. Fördelar: låg provision, team-hantering, RUT-ombud, Stripe-utbetalningar
3. CTA: "Registrera företag"
4. Kliar → `registrera-foretag.html`

### 6b. NY: `registrera-foretag.html`

Formulär:
1. **Steg 1:** Org.nr (auto-fetch company name från Bolagsverket API eller manuell)
2. **Steg 2:** Företagsnamn, adress, bransch
3. **Steg 3:** VD-info (namn, email, telefon, pnr)
4. **Steg 4:** BankID-verifiering (via befintlig bankid EF)
5. **Steg 5:** Granska + bekräfta
6. **Submit:** Anropa `company-self-signup` EF → redirect till Stripe onboarding-URL

### 6c. NY: `join-team.html`

Landing när team-cleaner klickar invitation-URL.

**Flow:**
1. Magic-link etablerar session (via Fas 1.2 infra)
2. Hämta `cleaner_applications`-data via `application_id` query-param
3. Visa: "X har bjudit in dig till [Company]"
4. BankID-verifiering
5. Submit: Anropa `accept-team-invitation` EF → redirect till Stripe onboarding-URL

### 6d. ÄNDRAD: `foretag-dashboard.html`

Lägg till ny sektion "Onboarding-status" överst (visas bara om någon checklist-item är false):

```
┌────────────────────────────────────────────┐
│ 📋 Kom igång med ditt företag              │
│                                            │
│ ✅ Företagsuppgifter klara                 │
│ ✅ Teammedlemmar: 2                        │
│ ⚠ Stripe-utbetalning: [Slutför →]          │
│ ⚠ RUT-ombud: [Ansök →]                     │
│ ⚠ Första bokning: Vänta på trafik          │
│                                            │
│ 3 av 5 steg klara                          │
└────────────────────────────────────────────┘
```

Anropar `get_company_onboarding_status(company_id)` RPC.

### 6e. ÄNDRAD: `admin.html`

Ny sektion "Pending companies" som visar företag där self_signup=true och onboarding_status != active. Admin kan se progress + manuellt ingripa.

---

## 7. Notifieringar

### Nya SMS-mallar

1. **Team-invitation → Ny cleaner:**
   > "Spick: [VD-namn] har bjudit in dig till [Company]. Registrera dig inom 7 dagar: [kort URL]"

2. **Stripe complete → Cleaner:**
   > "Spick: Din Stripe-registrering är klar! Du kan nu ta bokningar: [portal URL]"

3. **Stripe requires more info → Cleaner:**
   > "Spick: Stripe behöver mer info från dig för att godkänna utbetalningar: [URL]"

4. **First booking received → VD:**
   > "Spick: [Cleaner-namn] har fått sin första bokning via ditt företag!"

### Email-templates

Samma innehåll men med länk till dashboard + mer kontext.

---

## 8. Edge cases

### 8a. Org.nr finns redan

`company-self-signup` validerar. Om finns → felmeddelande: "Detta företag är redan registrerat. Kontakta hello@spick.se om du tror detta är fel."

### 8b. Team-invitation klickas av fel person

Magic-link är email-bound. Om ny cleaner klickar utan access till email → kan inte acceptera. Detta är by design (säkerhet).

### 8c. Cleaner redan i system

`accept-team-invitation` kollar om personnummer redan finns som cleaner hos annat företag → error: "Du är redan registrerad hos [Company]. Kontakta dem om du vill byta."

### 8d. Stripe Connect webhook kommer sent (timing race)

Webhook kan fördröjas ~5 min. Cleaner ser `pending` på dashboard även om de är klara hos Stripe.

**Mitigation:** Dashboard polleer `check_status` var 10:e sek i 2 minuter efter tillbakakomst från Stripe URL (visuell feedback "Kontrollerar status...").

### 8e. BankID-signature förfalskad

BankID-verifiering körs serverside via bankid-verify EF. Signatur som inte validerar → 401.

### 8f. VD avregistrerar sig men team finns kvar

Company → `onboarding_status='suspended'`. Team-cleaners kan inte ta bokningar. Admin-action krävs: antingen transferera ownership eller arkivera företag.

### 8g. Stripe account.updated webhook failar

Ingen retry från Stripe. Mitigation: cron-jobb varje 15 min som pollar alla cleaners med `stripe_account_id IS NOT NULL AND stripe_onboarding_status != 'complete' AND created_at > now() - 7 days` och anropar `check_status`.

---

## 9. Sprint B breakdown — daglig plan

| Dag | Scope | Commits |
|---|---|---|
| **Dag 1** | Design-dok + akut-fix (stripe-connect-webhook EF + refresh_account_link action + Rafael fix) | 3-4 |
| **Dag 2** | DB-migrations (nya kolumner + RPC) + commission_rate fix + `admin-approve-cleaner` update | 2-3 |
| **Dag 3** | `company-self-signup` EF + `bli-foretag.html` + `registrera-foretag.html` | 3-4 |
| **Dag 4** | `company-invite-team` EF + `accept-team-invitation` EF + `join-team.html` + UI på foretag-dashboard | 4-5 |
| **Dag 5** | VD-checklist (RPC + foretag-dashboard UI) + admin.html pending-companies + Fazli/Solid onboarding test | 3-4 |
| **Dag 6** | Notifieringar (SMS + email) + cron-polling fallback + testing + rollback-plan | 2-3 |

**Totalt:** 17-23 commits, ~30h arbete.

---

## 10. Testing

### Happy path

1. **Ny VD registrerar företag:** fyll formulär → BankID → company-self-signup → Stripe URL → slutför → webhook → status=complete → dashboard OK
2. **VD bjuder in team:** invite-form → SMS till ny cleaner → klick → BankID → accept → Stripe URL → slutför → webhook → cleaner kan ta bokningar
3. **Team-cleaner får bokning:** booking-create → SMS/email magic-link → kund bokar → cleaner checkar ut → auto-release → payout
4. **Rafael-fix:** Ny onboarding-URL → Rafael slutför → webhook → status=complete

### Edge cases

5. Duplicate org.nr → error
6. Invite-klick efter 7 dagar → error (magic-link expired)
7. BankID-pnr redan existerar → error
8. Stripe webhook komma sent → polling-fallback fungerar
9. Team-cleaner avböjer invitation (klickar inte på 7 dagar) → cleaner_applications.status → 'expired'

---

## 11. Rollback-plan

### Nivå 1 (mjuk)
- Disable `bli-foretag.html`-länken i navigation
- Nya företag registreras via admin.html istället

### Nivå 2 (medium)
- Revert EF-deploys till pre-Sprint-B-version
- Nya DB-kolumner är non-breaking (nullable)

### Nivå 3 (hård)
- Via Supabase PITR — förlora data efter deployment

---

## 12. Definition of Done

- [ ] Alla 17-23 commits pushade till main
- [ ] Alla nya EFs deployade till Supabase
- [ ] DB-migration körd, RPC testad
- [ ] `bli-foretag.html` + `registrera-foretag.html` publika och fungerar
- [ ] `join-team.html` fungerar end-to-end
- [ ] Rafael har `stripe_onboarding_status='complete'`
- [ ] Fazli (Solid Service) har full onboarding-flöde test-körd
- [ ] VD-checklist visar korrekt status
- [ ] Webhook för `account.updated` aktiv i Stripe Dashboard
- [ ] Notifieringar verifierade
- [ ] admin.html pending-queue visar self-signup-företag
- [ ] Test av alla 9 testscenarier passerade

---

## 13. Öppna frågor / risker

### 13a. Bolagsverket API för org.nr lookup

Om vi vill auto-fetcha företagsnamn från org.nr → Bolagsverket har API men kräver avtal. **Alt:** Skippa auto-fetch, låt användaren mata in manuellt i formuläret. Risk: typos. **Rekommendation:** Skippa i Sprint B, överväg senare.

### 13b. BankID-integration för self-signup

Befintlig `bankid-verify` EF används för cleaners. Vi återanvänder den. **Inget nytt jobb här.**

### 13c. Stripe Connect-kostnad

~1-2 SEK per transfer + 0.25% fee. Inkluderat i befintlig kostnadsmodell. **Ingen förändring.**

### 13d. GDPR — personnummer-hash

`bankid_personnummer_hash` sparas som SHA256. Inget plaintext-pnr i DB. **OK.**

---

## 14. Nästa steg

**Omedelbart efter godkännande:**
1. Commit detta design-dokument
2. Starta Dag 1: fixa Rafael + bygg stripe-connect-webhook + refresh_account_link

**Efter Sprint B är klar:**
- Sprint A (Escrow) kan starta med ren Stripe Connect-infra

---

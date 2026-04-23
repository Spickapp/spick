# Go-live-checklist: Zivar + Solid Service Sverige AB

**Skapad:** 2026-04-23 (efter produktionsgranskning)
**Cleaner-id (VD Zivar):** `0bf8ec72-3560-421f-a7a5-acc87b50bc30`
**Company-id (Solid Service):** `1b969ed7-99f7-4553-be0e-8bedcaa7f5eb`
**Team (4 st):** Dildora `a86ec998`, Nasiba `3f16c9d1`, Nilufar `d6e3281a`, Odilov `e43c819f`

## Syfte

Samlad, verifierbar plan för att ta Zivar/Solid Service från "aktiv men med gap" till "redo för bred kundtrafik". Följ stegen i ordning. Verifiera varje steg via angiven query/URL innan nästa.

**Status-ikoner:** ⏳ ej start · 🔄 pågår · ✅ klar · ❌ blockerad

---

## P0 — Måste-fixas (juridik + säkerhet)

### 1. ⏳ Underleverantörsavtal juristgranskas + signeras

**Varför:** B2B-städning med anställd team kräver underleverantörsavtal mellan Spick och Solid Service (civilrätt + skatterätt).

**Ägare:** Farhad + jurist
**Status i DB:** `companies.underleverantor_agreement_accepted_at = null`

**Steg:**
1. Kontakta jurist för underleverantörsavtal-mall (om Spick saknar)
2. Mail mall till Zivar för signering
3. Sätt DB när signerat:
   ```sql
   UPDATE companies
   SET underleverantor_agreement_accepted_at = NOW(),
       underleverantor_agreement_version = 'v1.0'
   WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
   ```

**Verifiering:**
```sql
SELECT underleverantor_agreement_accepted_at, underleverantor_agreement_version
FROM companies WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
-- Ska ge tidstämpel + versionssträng, ej null
```

---

### 2. ⏳ Försäkring verifieras (ansvars + arbets)

**Varför:** Ansvarsförsäkring skyddar kund om skada sker vid städning. Arbetsskadeförsäkring skyddar team-medlem.

**Ägare:** Farhad + Zivar
**Status i DB:** `companies.insurance_verified = false`, `insurance_expires_at = null`

**Steg:**
1. Zivar skickar försäkringsbevis (ansvar min 10 MSEK rekommenderat)
2. Farhad arkiverar i Google Drive/liknande
3. Sätt DB:
   ```sql
   UPDATE companies
   SET insurance_verified = true,
       insurance_expires_at = '2027-04-23'::date  -- datum från policy
   WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
   ```

**Verifiering:**
```sql
SELECT insurance_verified, insurance_expires_at
FROM companies WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
-- insurance_verified=true, expires_at > CURRENT_DATE
```

---

### 3. ⏳ DPA (Data Processing Agreement) signeras

**Varför:** GDPR kräver DPA när personuppgifter bearbetas mellan två parter (Spick ↔ Solid Service). Kund-PNR (när reaktiverat i Fas 7.5), adresser, reviews = personuppgifter.

**Ägare:** Farhad + jurist
**Status i DB:** `companies.dpa_accepted_at = null`

**Steg:**
1. Jurist förbereder DPA-mall
2. Mail mall till Zivar för signering
3. Sätt DB:
   ```sql
   UPDATE companies SET dpa_accepted_at = NOW()
   WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
   ```

---

### 4. ⏳ BankID-verifiering för Zivar (VD)

**Varför:** `identity_verified=false` signalerar till kunder att städaren inte är BankID-verifierad. Grundläggande trust-signal.

**Ägare:** Farhad (admin-override) ELLER Zivar (ny UI saknas)
**Status i DB:** `cleaners.identity_verified = false` för alla 5

**Väg A (snabb — admin-override):**
1. Farhad → [admin.html](admin.html) → Zivar:s cleaner-kort → kryssa `cd-identity-verified` ([rad 3768](admin.html:3768))
2. Upprepa för alla 5 team-medlemmar
3. **Juridisk risk:** detta är en manuell whitelistning, inte faktisk BankID-verifiering. Använd endast om Zivar har visat ID fysiskt.

**Väg B (korrekt — ny UI krävs):**
1. Bygg "Verifiera identitet"-knapp i [stadare-dashboard.html](stadare-dashboard.html) som redirectar till BankID-flow
2. Edge Function `bankid-verify` finns redan
3. ~1-2h implementation

**Rekommendation:** Väg B eftersom Spick annars säljer en falsk trust-signal till kunder.

**Verifiering:**
```sql
SELECT id, full_name, identity_verified FROM cleaners
WHERE company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
ORDER BY full_name;
-- Alla 5 ska ha identity_verified=true
```

---

### 5. ⏳ BESLUT: Stripe-routing till VD eller bolag?

**Varför:** Verkligt beteende idag (verifierat i [booking-create/index.ts:629-657](supabase/functions/booking-create/index.ts:629)):

> Vid team-booking söker koden VD:s **personliga** `cleaners.stripe_account_id` (`is_company_owner=true`). `companies.stripe_account_id` (= `acct_1TOoGR2WmxQpNdtI`) används **inte**.

**Affärsimplikation:**
- Nu: team-intäkter går till Zivars privata Stripe-konto
- Om `employment_model='employed'` skatterättsligt = intäkter ska bokföras på bolaget → **fel konto idag**

**Farhads beslut behövs:**
- **(a)** Behåll nuvarande: Zivar drar pengar privat och redovisar internt. Enklare men kan vara skattefel.
- **(b)** Routa till bolag: kräver kodändring i booking-create + slutföra Stripe Connect för `acct_1TOoGR2WmxQpNdtI`. Mer korrekt för B2B men ~2-3h kodjobb + Stripe-onboarding.

**Steg för (b):**
1. Zivar slutför Stripe Connect för bolag-kontot (via Stripe Dashboard → acct_1TOoGR2WmxQpNdtI)
2. Uppdatera `companies.stripe_onboarding_status='complete'` (auto via webhook, eller manuellt)
3. Claude ändrar booking-create att prioritera `companies.stripe_account_id` om complete, fallback till VD
4. Testbokning för att verifiera transfer till bolag

**Rekommendation:** Fråga din bokförare vilken modell som är korrekt för Solid Services skattesituation. Om osäker → (a) temporärt, (b) inom 30 dagar.

---

## P1 — Kommersiell trovärdighet (innan bred lansering)

### 6. ⏳ Profilbilder för alla 5

**Varför:** Kunder bokar inte tomma ansikten. Trust + personalisering.
**Status i DB:** `cleaners.avatar_url = null` för alla 5

**Steg:**
1. Zivar fotograferar medlemmarna (naturligt ljus, neutral bakgrund)
2. Logga in i [stadare-dashboard.html](stadare-dashboard.html) som VD
3. För VD själv: profil → "📷 Ladda upp foto"
4. För varje team-medlem: Team-tab → Redigera → "📷 Ladda upp foto" (section `team-avatar-section`)

**Verifiering:**
```sql
SELECT id, full_name, avatar_url FROM cleaners
WHERE company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
  AND (avatar_url IS NULL OR avatar_url = '');
-- Förväntat: 0 rader
```

---

### 7. ⏳ Bio (2-3 meningar) för alla 5

**Status i DB:** `cleaners.bio = null` för alla 5

**Rekommenderat innehåll:** Erfarenhet, specialisering, personlig touch. Max 500 tecken. Undvik att försvenska/överdriva.

**Exempel för Nasiba:**
> "Jag är Nasiba och har 3 års erfarenhet av kontorsstädning. Jag är noggrann med detaljer och tycker om att lämna utrymmen i perfekt skick. Talar svenska och engelska."

**Steg:**
1. Zivar/medlem skriver bio
2. Uppdateras via team-modal `team-bio`-textarea

---

### 8. ⏳ Languages satt per medlem

**Status i DB:** `cleaners.languages = []` för alla 5

**Steg:** Via team-modal `renderTeamLangs()` eller direkt SQL:
```sql
UPDATE cleaners SET languages = ARRAY['Svenska']::text[]
WHERE company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
  AND languages = '{}';
```

**Uppdatera individuellt om annat språk:**
```sql
UPDATE cleaners SET languages = ARRAY['Svenska','Engelska','Uzbekiska']::text[]
WHERE id = '<cleaner-id>';
```

---

### 9. ⏳ Per-service-priser för 4 medlemmar (matcha Odilov)

**Status:** Endast Odilov (`a86ec998`) har 4 rader i `cleaner_service_prices`. Övriga 4 använder `hourly_rate=390` som fallback.

**Option A (enklast):** Behåll fallback — fungerar.

**Option B (konsekvent):** Seed samma priser för alla:
```sql
INSERT INTO cleaner_service_prices (cleaner_id, service_type, price, price_type)
SELECT c.id, s.service_type, 390, 'hourly'
FROM cleaners c
CROSS JOIN (VALUES ('Hemstädning'), ('Storstädning'), ('Flyttstädning'), ('Fönsterputs')) s(service_type)
WHERE c.company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
  AND c.is_company_owner = false
  AND NOT EXISTS (
    SELECT 1 FROM cleaner_service_prices csp
    WHERE csp.cleaner_id = c.id AND csp.service_type = s.service_type
  );
```

**Rekommendation:** Option B för UI-konsekvens.

---

### 10. ⏳ Företagslogo uploadas

**Status i DB:** `companies.logo_url = null`
**Gap:** Ingen UI i [foretag-dashboard.html](foretag-dashboard.html) eller [stadare-dashboard.html](stadare-dashboard.html) för logo-upload.

**Option A:** Claude bygger logo-upload-UI (scope ~45 min).

**Option B (snabb):** Manuellt:
1. Zivar mailar logo (PNG, 512×512) till Farhad
2. Farhad laddar till Supabase Storage (via Studio)
3. Sätt DB:
   ```sql
   UPDATE companies
   SET logo_url = 'https://urjeijcncsyuletprydy.supabase.co/storage/v1/object/public/logos/solid-service.png'
   WHERE id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb';
   ```

**Rekommendation:** Option B nu + Option A senare som hygien.

---

## P2 — Verifiering före bred lansering

### 11. ⏳ Agreement-signering-UI (om #1-3 blir återkommande behov)

**Kontext:** När fler företag onboardas, manuell SQL-uppdatering skalar inte. Bygg UI i foretag-dashboard där VD kan ladda upp försäkringsbevis + acceptera avtal digitalt.

**Scope:** ~3-4h. Inte kritiskt för Solid Service alone.

---

### 12. ⏳ End-to-end testbokning (Farhad som kund)

**Efter #1-10 är klara:**

**Steg:**
1. Öppna [boka.html](boka.html) i incognito (logga ej in som VD)
2. Välj Hemstädning, 100 kvm, valfri Stockholm-adress, imorgon 10:00
3. I cleaner-list: verifiera att Solid Service visas med:
   - Företagslogo + display-name
   - Team-badge (👥 4 städare)
   - Rating (om satt) eller "Ny på Spick"
4. Välj Nasiba specifikt
5. Fortsätt till betalning (använd Stripe test-mode: 4242 4242 4242 4242)
6. Verifiera i Stripe Dashboard att transfer-destination är Zivars konto (eller bolag om #5b valts)
7. Verifiera att booking.status='pending' i DB
8. Logga in som Zivar → ska se notifieringen om bokning
9. Klicka "Acceptera"
10. Verifiera status → 'confirmed'

**Rollback om något felar:** Radera test-bokning + refund via Stripe.

---

### 13. ⏳ Pilot-fas: 3-5 riktiga kunder

**Efter #12 OK:**
- Farhad väljer 3-5 kunder (befintliga kontakter, t.ex. vänner/kollegor med kontor)
- Erbjud 20-30% pilot-rabatt via manuell rabattkod
- Övervaka: boknings-flöde, payout, notifieringar, reviews
- 2-veckorsperiod innan "fullt öppnat"

**Metrics att följa:**
- Konverteringsgrad i boka.html
- Tid från bokning → accept
- Transfer-success i Stripe
- Review efter städning (både kund och cleaner)

---

## Övergripande regel-efterlevnad (denna plan)

- **#26** grep-före-edit — plan innehåller SQL/instruktioner, inga edits ännu
- **#27** scope-respekt — Farhads åtgärder (P0 jurist/BankID/Stripe) åtskilda från Claude's (P1 UI-bygge) och operational (P1 data-entry)
- **#28** single source of truth — denna fil är ENDA go-live-planen för Solid Service
- **#29** audit-först — varje påstående baserat på prod-query eller kod-läsning 2026-04-23
- **#30** regulator-gissning — försäkring/DPA/underleverantör/Arbetsmiljö flaggade som jurist-beroende, inte gissade
- **#31** primärkälla över memory — alla DB-uppdateringar verifieras via SELECT-queries efteråt

---

## Relaterade dokument

- [docs/planning/todo-foretag-dashboard-vd-workflows-2026-04-23.md](todo-foretag-dashboard-vd-workflows-2026-04-23.md) — P3/P4 dashboard-gaps
- [docs/sanning/provision.md](../sanning/provision.md) — 12% flat provision
- [CLAUDE.md](../../CLAUDE.md) — projektkontext

# E2E-analys Moment 1: Bokning → Stripe → VD-dashboard — 2026-04-19

**Metod:** Regel #26 + #27 + #28 — fil:rad för varje påstående, primärkälla verifierad.
**Scope:** Bokningsskapande från boka.html, via booking-create EF + Stripe, till synlighet i stadare-dashboard.html för Zivar (VD Solid Service).

---

## Verifierade fakta

### 1. boka.html kallar booking-create
[boka.html:2847-2882](boka.html:2847) skickar POST till `/functions/v1/booking-create` med payload:
- `cleaner_id` från `state.cleanerId` (satt när kund klickar på cleaner-kort)
- `name, email, phone, address, date, time, hours, service`
- `rut`, `customer_type`, `business_name/org_number/reference`
- `frequency`, `discount_code`, `referral_code`, `customer_pnr`
- `auto_delegation_enabled` (från checkbox)

### 2. URL-styrning via `?company=<id>`
[boka.html:776-797](boka.html:776):
- `preCompanyId = urlParams.get('company')`
- Om satt → hämtar `companies.allow_customer_choice`, `show_individual_ratings`, `use_company_pricing`, `company_service_prices`
- Sätter `window.companyPrices`, `window.companyAllowChoice` etc.

Cleaner-filter i [boka.html:1912-1915](boka.html:1912):
```js
if (preCompanyId) {
  cleaners = cleaners.filter(c => c.company_id === preCompanyId && !c.owner_only);
} else {
  cleaners = cleaners.filter(c => !c.owner_only);
}
```

**Slutsats:** När kund kommer via `/boka.html?company=<solid_service_id>`, filtreras till teammedlemmar i Solid Service (VD `owner_only=true` döljs). Utan parametern → alla cleaners.

### 3. booking-create EF: cleaner_id-hantering
[supabase/functions/booking-create/index.ts:109-139](supabase/functions/booking-create/index.ts:109):
- Om `cleaner_id` i payload → hämtar cleaner-raden (`is_approved=true AND is_active=true`), använder den
- Om `cleaner_id` saknas → **fallback: högsta `avg_rating` bland ALLA godkända cleaners (inte per-company!)** — [index.ts:127-133](supabase/functions/booking-create/index.ts:127)

### 4. Booking insert
[index.ts:291-341](supabase/functions/booking-create/index.ts:291):
- `bookingId = crypto.randomUUID()`
- `status = 'pending'`, `payment_status = 'pending'`
- `cleaner_id`, `cleaner_name` satta redan vid INSERT
- `company_id` sätts INTE på bookings-raden (fält finns inte i insert — bookings-tabellen spårar cleaner_id, inte company_id)
- Commission och pricing från `pricing-resolver` ([_shared/pricing-resolver.ts](supabase/functions/_shared/pricing-resolver.ts)) som läser `platform_settings.commission_standard`

### 5. Customer profile upsert
[index.ts:352-368](supabase/functions/booking-create/index.ts:352) — `customer_profiles` upsertas med `auto_delegation_enabled` om angivet. Non-blocking.

### 6. Stripe Checkout + destination charge
[index.ts:487-514](supabase/functions/booking-create/index.ts:487) — logik för destination:
```js
if (cleanerConnect?.company_id && !cleanerConnect.is_company_owner) {
  // Teammedlem → hämta VD:s stripe_account_id
  destinationAccountId = owner.stripe_account_id;
} else if (cleanerConnect?.stripe_account_id && cleanerConnect.stripe_onboarding_status === "complete") {
  destinationAccountId = cleanerConnect.stripe_account_id;  // Solo eller VD
}
```

**Endast om `stripe_onboarding_status === 'complete'`** sätts destinationAccountId. Annars → "funds stay on platform" ([index.ts:597](supabase/functions/booking-create/index.ts:597)).

Stripe-param ([index.ts:590-595](supabase/functions/booking-create/index.ts:590)):
```js
params.append("payment_intent_data[transfer_data][destination]", destinationAccountId);
params.append("payment_intent_data[application_fee_amount]", String(applicationFee));
```
`applicationFee = amountOre * commissionRate`. Commission läses från pricing-resolver → platform_settings → 12%.

### 7. Stripe Webhook
[stripe-webhook/index.ts:839-885](supabase/functions/stripe-webhook/index.ts:839) — idempotency:
```js
const eventId = event.id;
// Check processed_webhook_events first
// ...
await sb.from("processed_webhook_events").insert({ event_id: eventId, ... });
```

`checkout.session.completed` [index.ts:865](supabase/functions/stripe-webhook/index.ts:865) → `handlePaymentSuccess()`:
- [index.ts:282-295](supabase/functions/stripe-webhook/index.ts:282): UPDATE bookings SET status, payment_status='paid', cleaner_id (om ändrad), payment_method, payment_intent_id
- [index.ts:279-280](supabase/functions/stripe-webhook/index.ts:279): Auto-confirm om `isExperiencedCleaner` (≥5 completed_jobs + ≥4.0 rating) → `status='bekräftad'`, annars `pending_confirmation`

### 8. Double-booking-guard
[stripe-webhook/index.ts:243-275](supabase/functions/stripe-webhook/index.ts:243) — efter paid-update men INNAN status-bekräftelse: kolla om annan bokning för samma cleaner+datum+tid redan är paid → auto-refund via Stripe refund API.

### 9. Stadare-dashboard booking-loading

**Solo-cleaner** ([stadare-dashboard.html:3106](stadare-dashboard.html:3106)):
```js
R.select('bookings', `select=*&cleaner_id=eq.${cleaner.id}&payment_status=in.(paid,pending)`)
```

**VD (is_company_owner)** ([stadare-dashboard.html:6171-6175](stadare-dashboard.html:6171)):
```js
const memberIds = _teamMembers.map(m => m.id);
const idFilter = memberIds.map(id => `cleaner_id.eq.${id}`).join(',');
R.select('bookings', `select=...&or=(${idFilter})&order=booking_date.asc&limit=100`)
```
Data lagras i `data_teamBookings` och visas via `renderTeamBookingCard` ([6197-6237](stadare-dashboard.html:6197)) i "Idag/Kommande/Tidigare/Avbokade"-sektioner.

### 10. Badge-räknare för VD
[stadare-dashboard.html:4074-4082](stadare-dashboard.html:4074):
```js
if (window._isCompanyOwner) {
  var teamB = window.data_teamBookings || [];
  count = teamB.filter(function(b) { return b.status === 'pending_confirmation'; }).length;
}
```

---

## Fungerar som förväntat

✅ **Booking-create accepterar cleaner_id från frontend** — om kund väljer Dildora, bokningen knyts till Dildora.
✅ **Pricing-resolver är centraliserad** ([_shared/pricing-resolver.ts](supabase/functions/_shared/pricing-resolver.ts)) — commission läses från `platform_settings.commission_standard`. Följer Regel #28 för pricing-logik.
✅ **Destination charge implementerat** — teammedlem → VD:s Stripe, solo → egen.
✅ **Webhook-idempotency finns** — `processed_webhook_events` förhindrar duplicerad payment-handling.
✅ **Double-booking-guard** — auto-refund vid kollision.
✅ **VD ser team-bokningar** — OR-filter på alla teammedlemmars cleaner_ids ([6174](stadare-dashboard.html:6174)).
✅ **Customer_profiles upsertas** — auto_delegation_enabled lagras på kund-nivå.

---

## Frågetecken (Regel #27 — kräver prod-verifikation)

### 🚩 F1: Företagsprofil-URL
Jag hittade inte var `/f/<slug>` genererar cleaner-kort som länkar till `boka.html?company=X` eller `?id=cleaner_id`. Kräver grep på `f/` routing eller stadare-profil.html.

### 🚩 F2: Finns rabattgrupp-logik för VD-val av cleaner i team?
booking-create tar cleaner_id från frontend. Om kund väljer VD istället för teammedlem — ska bokningen delegeras automatiskt? Ingen sån logik i booking-create (grep `is_company_owner.*delegate` → 0 träffar).

### 🚩 F3: Solid Service Stripe-status
Utan pg_policies-query mot prod kan jag inte verifiera om Zivar har `stripe_onboarding_status='complete'`. Om NEJ → bokningar till Solid Service-cleaners kommer skapas, men utbetalning hamnar på **spick-platformen**, inte VD:s konto.

### 🚩 F4: Auto-delegation initial flöde
`auto_delegation_enabled` används bara vid **cleaner-decline** av redan-tilldelad bokning ([auto-delegate/index.ts:61-72](supabase/functions/auto-delegate/index.ts:61)). **Ingen initial auto-tilldelning** inom company — Rafa/Solid Service måste manuellt välja cleaner på boka.html eller ge kunden en lista.

### 🚩 F5: Fråga om kund väljer direkt via slug
Om kund surfar till /boka.html utan `?company`-param och väljer Dildora (som tillhör Solid Service) — vad händer? Troligen samma: booking-create tar hennes cleaner_id, sätter bookings.cleaner_id=Dildora. Men RLS på bookings-page kanske inte visar den för Zivar om VD-filter bygger på company-kontext. Se F6.

### 🚩 F6: VD-synlighet i RLS
[stadare-dashboard.html:6175](stadare-dashboard.html:6175) queryar `bookings?or=(cleaner_id.eq.X,cleaner_id.eq.Y,...)` med VD:s JWT. RLS på bookings ([20260402000001:20-26](supabase/migrations/20260402000001_fix_rls_security.sql:20)): `email = jwt.email OR cleaner_id = auth.uid()`. Eftersom Zivars auth.uid ≠ team-cleaners.id, **skulle VD inte se teamets bokningar med nuvarande RLS**. Om det ändå fungerar i prod finns en undokumenterad policy (troligen baserat på `is_company_owner` + `company_id`).

---

## Demo-risker

### 🔴 P0 — blockar demo

**P0-1: Solid Service saknar Stripe-onboarding**
Om Zivar inte har `stripe_onboarding_status='complete'` → destinationAccountId=NULL → betalningar går till Spick-plattformen utan utbetalning till VD. Demo-livebook skulle fungera tekniskt men pengaflödet är fel.
**Åtgärd:** Låt Zivar onboarda Stripe från stadare-dashboard innan mötet.

**P0-2: VD-synlighet via RLS**
Om [20260402000001:20-26](supabase/migrations/20260402000001_fix_rls_security.sql:20) är den enda aktiva policyn på bookings → Zivar ser 0 teambokningar. Om det finns en undokumenterad policy i prod — vi vet inte vad den gör.
**Åtgärd:** Kör SQL-query nedan för att bekräfta policies. Om brist → skapa migration för `cleaners c WHERE c.company_id = <X> AND c.is_company_owner`.

### 🟡 P1 — gör demo skakig

**P1-1: Ingen initial auto-delegation till team**
Om kund via /boka.html väljer fel/kritiskt cleaner — inget system slår över till team-alternativ. Manuell ombokning behövs.

**P1-2: Auto-confirm-tröskel kan blockera nya cleaners**
[stripe-webhook:279-280](supabase/functions/stripe-webhook/index.ts:279): ny cleaner med 0 completed_jobs → `pending_confirmation`, väntar på bekräftelse via email/SMS. Om Zivars team inte svarar snabbt → bokningen hänger.

**P1-3: booking-create kan bli fel om cleaner_id saknas**
[index.ts:127-133](supabase/functions/booking-create/index.ts:127): "välj högsta rating bland ALLA godkända" — inte company-aware. Vid direktbokning utan cleaner_id kan bokningen hamna utanför Solid Service.

### 🟢 P2 — kosmetiskt

- "Nytt jobb matchar dig"-räknare visar 1 för Zivar i view_as (se [tidigare audit](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md))
- Display-name-format "Dildora (Solid Service)" på teammedlemmar — fungerar men kan förvirra
- `cityJobs`-variabel i boka.html har inget stadsfilter trots namnet

---

## SQL-verifikation — Kör innan mötet

```sql
-- 1. Solid Services cleaners + Stripe-status
SELECT c.id, c.full_name, c.is_company_owner, c.stripe_account_id, c.stripe_onboarding_status, c.status
FROM cleaners c
WHERE c.company_id = (SELECT id FROM companies WHERE org_number = '559537-7523')
ORDER BY c.is_company_owner DESC;
-- Kontrollera att Zivar (is_company_owner=true) har stripe_onboarding_status='complete'

-- 2. Företagsprofil + Stripe
SELECT name, slug, stripe_account_id, stripe_onboarding_status, allow_customer_choice, show_individual_ratings, use_company_pricing
FROM companies
WHERE org_number = '559537-7523';
-- 'slug' används i /f/<slug>-URL för direktlänk till företagsprofil

-- 3. Bokningar tilldelade Solid Services cleaners
SELECT b.id, b.customer_name, b.cleaner_id, b.cleaner_name, b.status,
       b.payment_status, b.booking_date, b.total_price
FROM bookings b
WHERE b.cleaner_id IN (
  SELECT id FROM cleaners
  WHERE company_id = (SELECT id FROM companies WHERE org_number = '559537-7523')
)
ORDER BY b.created_at DESC;

-- 4. RLS-policies på bookings (regel #27-verifikation)
SELECT policyname, cmd, permissive, roles, qual
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY policyname;
-- Förväntat minst: "Auth read own bookings", "Anon read booking by uuid header",
-- "Service role all bookings". Om det finns en VD/company-policy, dokumentera.

-- 5. Stripe-webhook-events (idempotency)
SELECT COUNT(*) AS processed_count, MAX(processed_at) AS last_event
FROM processed_webhook_events;
-- Ska öka efter varje Stripe-event

-- 6. Platform commission-värde (för att verifiera 12%)
SELECT key, value FROM platform_settings WHERE key = 'commission_standard';
```

---

## E2E-testsekvens (kör i test-miljö)

### Förberedelser (Farhad, innan mötet)
1. Verifiera Zivars Stripe-onboarding: kör SQL-query #1 ovan.
2. Om Zivar saknar Stripe: ring Zivar → be honom logga in på `stadare-dashboard.html` → klicka "Anslut Stripe" → följ Express-onboarding.
3. Verifiera `companies.slug` för Solid Service: kör SQL #2.

### Steg 1 — Kundens bokning (demo)
```
1. Öppna inkognito-flik
2. Gå till: https://spick.se/f/solid-service-sverige (använd slug från SQL #2)
3. Visa Rafael: "Detta är er företagsprofil — gäster ser denna."
4. Klicka "Boka nu" → hamnar på boka.html?company=<id>
5. Fyll i:
   - Tjänst: Hemstädning
   - Datum: valfritt (mån-fre för wizard-availability)
   - Tid: 10:00
   - Timmar: 3
   - Adress: testadress i Stockholm
   - Kundinfo: test-email + telefon
6. Välj Dildora eller Zivar
7. Fortsätt → Stripe checkout
```

### Steg 2 — Stripe TEST mode
Om systemet är på **live-nycklar**: **ingen test-bokning** — använd riktig betalning (eller slå temporärt över till test-nycklar). Viktigt för demo: välj ett datum som är flyttbart/avbokbart efteråt.

Om test-nycklar: använd kortnummer `4242 4242 4242 4242`, datum 12/30, CVC 123.

### Steg 3 — Verifiera i admin.html
1. Farhad loggar in på admin.html
2. Navigera till "Alla bokningar"
3. Kontrollera: cleaner_id = vald cleaner, payment_status = paid, status = pending_confirmation eller bekräftad
4. Verifiera commission-kolumnerna: `commission_pct=12`, `spick_gross_sek`≈12% av customer_price

### Steg 4 — Verifiera i Zivars dashboard
1. Farhad i admin: klicka "📊 Dashboard" på Zivars rad → view_as öppnas
2. Banner "Admin-vy — du hanterar Zivar"
3. Kontrollera:
   - Bokningen syns i "Team-bokningar" → "Idag" eller "Kommande"
   - Status visas korrekt (pending_confirmation → "Väntar på svar", bekräftad → "Bekräftad")
4. Om pending_confirmation: klicka "Acceptera" (VD-action ska trigger `ownerAcceptBooking` på [stadare-dashboard.html:6205](stadare-dashboard.html:6205))

### Steg 5 — Kvittens
1. Gå tillbaka till admin → bokningar
2. Status ska ha uppdaterats till "bekräftad"
3. Kvittens-email bör ha gått till kunden (Resend)

### Post-demo städning
- Avboka testbokningen via admin → Stripe refund triggas
- Alternativt: ta bort bokningsraden direkt om det var test-data

---

## Backlog (fix efter mötet)

### Regel #27-tekniska skulder
1. **Dokumentera RLS-policies som finns i prod men saknar migration** — kör `SELECT policyname FROM pg_policies WHERE tablename IN ('bookings','cleaners','companies')` och skapa migration som återskapar.
2. **Fixa booking-create fallback** ([index.ts:127-133](supabase/functions/booking-create/index.ts:127)) — när cleaner_id saknas, respektera company_id om det finns i payload. Lägg till `company_id` som valfri input.
3. **Initial auto-delegation inom team** — om Rafa vill att "kund väljer Solid Service → systemet tilldelar första lediga teammedlem" krävs ny logik i booking-create eller en `company-auto-assign` EF.

### UX-förbättringar
4. **Admin-trigger Stripe Connect** (se [tidigare audit](docs/audits/2026-04-19-admin-impersonation-vs-editing.md)) — 1-knapps onboarding från admin
5. **VD-schemaläggare** — admin saknar UI för cleaner_availability_v2 (sveeper v1-bugg har egen backlog)
6. **"Matchar dig"-text** bör bytas till "Öppna jobb" tills faktisk geografisk matchning implementeras

### Regel #28-fragmentering
7. **cityJobs-variabeln** i boka.html är missvisande — byt namn till `unassignedJobs` eller implementera faktiskt stadsfilter
8. **Fallback-duplikat** i stadare-dashboard loadJobs:3111-3114 — samma query med bara `limit` skillnad. Ta bort.

---

## Sammanfattning

**Kan vi köra E2E imorgon?** **Ja** — flödet är arkitekturellt komplett. Två saker som MÅSTE verifieras innan:
1. Zivars Stripe-onboarding klart
2. RLS tillåter VD att se teambokningar

Om båda är OK → bokningsflödet fungerar end-to-end. Om inte → åtgärda först.

**Huvud-fragmentering att flagga:**
- `v_available_jobs_with_match`, `jobs`-tabell, `cleaner-job-match` EF — finns men integreras inte med stadare-dashboard loadJobs ([tidigare audit](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md))
- cleaner_availability (v1) vs cleaner_availability_v2 — admin-editor skriver till fel tabell ([tidigare audit](docs/audits/2026-04-19-admin-impersonation-vs-editing.md))
- RLS-policies i prod saknar motsvarande migration-filer (Regel #27-brott)

**Referenser:**
- [2026-04-19-admin-impersonation-vs-editing.md](docs/audits/2026-04-19-admin-impersonation-vs-editing.md)
- [2026-04-19-boka-cleaner-filter-bugg.md](docs/audits/2026-04-19-boka-cleaner-filter-bugg.md)
- [2026-04-19-nytt-jobb-matchar-bugg.md](docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md)
- [2026-04-19-view-as-impersonate-analys.md](docs/audits/2026-04-19-view-as-impersonate-analys.md)
- [2026-04-19-google-places-audit.md](docs/audits/2026-04-19-google-places-audit.md)
- [2026-04-19-solid-service-demo-funktioner.md](docs/prep/2026-04-19-solid-service-demo-funktioner.md)

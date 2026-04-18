# E2E-analys Moment 2: VD tilldelar bokning till teammedlem — 2026-04-19

**Metod:** Regel #26 + #27 + #28 — fil:rad för varje påstående, primärkällan verifierad.
**Scope:** Tilldelningsflödet i Solid Service-kontext (Zivar VD, team Dildora/Odilov/Nasiba/Nilufar).
**Använder:** Verifierad prod-info att "Company owner reads team bookings"-RLS finns.

---

## TL;DR — 3 kritiska fynd

1. **🔴 `booking_staff`-tabellen finns men används ALDRIG i kod.** Tilldelning sker via direkt UPDATE på `bookings.cleaner_id`. Designkoncept övergivet. Regel #28-brott.
2. **🔴 Omfördelning loggas inte + notifierar ingen.** `ownerReassignBooking` ([stadare-dashboard.html:8072-8094](stadare-dashboard.html:8072)) gör direkt PATCH → uppdaterar cleaner_id, cleaner_name, cleaner_email, cleaner_phone. **Ingen email/SMS/push till nya cleaner. Ingen email till kund om att städaren bytts. Ingen log_booking_event.**
3. **🟡 Två parallella tilldelningsvägar:** direkt PATCH (quick-reassign) vs `company-propose-substitute` EF (formellt proposal-flöde). Olika UX, olika regler (rating-check, customer-approval). Fragmenterat.

---

## Verifierade fakta

### 1. Bokningen kommer med cleaner_id redan satt

[boka.html:2859](boka.html:2859):
```js
cleaner_id: state.cleanerId || undefined,
```

`state.cleanerId` sätts när kund klickar på cleaner-kort i boka.html:steg 2. Om `preCompanyId`-filter är aktivt ([boka.html:1912-1915](boka.html:1912)) visas bara teammedlemmar + owner_only=false döljs.

**Om kund väljer Dildora:** `state.cleanerId = Dildora.id` → booking-create får `cleaner_id=Dildora`.

**Om kund inte väljer någon:** booking-create fallback ([index.ts:127-133](supabase/functions/booking-create/index.ts:127)):
```js
const { data } = await supabase
  .from("cleaners")
  .select("id, full_name, avg_rating, ...")
  .eq("is_approved", true)
  .eq("is_active", true)
  .order("avg_rating", { ascending: false })
  .limit(1);
```

→ Högsta avg_rating globalt, **INTE company-aware**. Risk: Solid-bokning hamnar utanför Solid Service.

### 2. VD ser team-bokningar i "Teamets bokningar"

[stadare-dashboard.html:6171-6175](stadare-dashboard.html:6171):
```js
const memberIds = _teamMembers.map(m => m.id);
const idFilter = memberIds.map(id => `cleaner_id.eq.${id}`).join(',');
R.select('bookings', `select=...&or=(${idFilter})&order=booking_date.asc&limit=100`);
```

Resultatet visas i [stadare-dashboard.html:6239-6256](stadare-dashboard.html:6239) under sektionerna "Idag / Kommande / Tidigare / Avbokade".

### 3. Två olika tilldelnings-UI:n beroende på status

**Status = `pending_confirmation`** — [stadare-dashboard.html:6203-6207](stadare-dashboard.html:6203):
```js
<button onclick="ownerAcceptBooking(...)">✓ Acceptera</button>
<button onclick="ownerRejectBooking(...)">Avböj</button>
```

**Status = `confirmed` / `bekräftad`** — [stadare-dashboard.html:6208-6213](stadare-dashboard.html:6208):
```js
<button onclick="showReassignPicker(...)">⇄ Omfördela</button>
<button onclick="ownerCancelBooking(...)">Avboka</button>
```

### 4. `ownerReassignBooking` — direkt PATCH på bookings

[stadare-dashboard.html:8072-8094](stadare-dashboard.html:8072):
```js
async function ownerReassignBooking(bookingId, newCleanerId, newCleanerName) {
  if (!confirm('Omfördela till ' + newCleanerName + '?')) return;
  var member = _teamMembers.find(m => m.id === newCleanerId);
  var res = await fetch(SUPA_URL + '/rest/v1/bookings?id=eq.' + bookingId, {
    method: 'PATCH',
    headers: {..._authHeaders(), 'Prefer': 'return=minimal'},
    body: JSON.stringify({
      cleaner_id: newCleanerId,
      cleaner_name: member ? member.full_name : newCleanerName,
      cleaner_email: member ? member.email : null,
      cleaner_phone: member ? member.phone : null
    })
  });
  if (res.ok) showToast('✅ Omfördelad till ' + newCleanerName);
}
```

**Ingen EF anropas.** Ingen notifiering. Ingen loggning. Ingen validering utöver `confirm()`-dialog och RLS.

### 5. `ownerAcceptBooking` — cleaner-booking-response EF

[stadare-dashboard.html:8096-8113](stadare-dashboard.html:8096) anropar `/functions/v1/cleaner-booking-response` med `action: 'accept'`.

[cleaner-booking-response/index.ts:53-64](supabase/functions/cleaner-booking-response/index.ts:53):
```js
let isAuthorized = booking.cleaner_id === cleaner.id;
if (!isAuthorized && cleaner.is_company_owner && cleaner.company_id) {
  const { data: assignedCleaner } = await sb
    .from("cleaners")
    .select("company_id")
    .eq("id", booking.cleaner_id)
    .maybeSingle();
  if (assignedCleaner?.company_id === cleaner.company_id) {
    isAuthorized = true;  // ← VD får acceptera på sitt teams vägnar
  }
}
```

EF uppdaterar ([cleaner-booking-response/index.ts:83-89](supabase/functions/cleaner-booking-response/index.ts:83)):
```js
await sb.from("bookings").update({
  status: "confirmed",
  confirmed_at: new Date().toISOString(),
  cleaner_email: cleaner.email || null,    // ← VD:s email, inte Dildoras!
  cleaner_phone: cleaner.phone || null,    // ← VD:s phone, inte Dildoras!
}).eq("id", booking_id);
```

**🚨 Bugg:** När VD accepterar på Dildoras vägnar skrivs VD:s email/phone som cleaner_email/cleaner_phone, INTE teammedlemmens. Påverkar cleaner-kontaktinformation som går till kunden.

### 6. `ownerRejectBooking` — company-booking-flow

[cleaner-booking-response/index.ts:132-152](supabase/functions/cleaner-booking-response/index.ts:132):
```js
const isCompanyBooking = !!cleaner.company_id;
const newStatus = isCompanyBooking ? "awaiting_company_proposal" : "awaiting_reassignment";

if (!isCompanyBooking) {
  updateFields.cleaner_id = null;  // Solo: nollställ
  updateFields.cleaner_name = null;
}
// För företagsbokningar: behåll cleaner_id som "sist tilldelad"
await sb.from("bookings").update(updateFields).eq("id", booking_id);
```

Sedan notifieras VD via email (rad 232-249):
```js
await sendEmail(owner.email, `[Spick] Ersättare behövs: ...`);
```

→ VD får email att "föreslå ersättare inom 2h" via `company-propose-substitute` EF.

### 7. `company-propose-substitute` — separate proposal-flow

[company-propose-substitute/index.ts](supabase/functions/company-propose-substitute/index.ts):
- Auth: verifierar VD ([index.ts:42-52](supabase/functions/company-propose-substitute/index.ts:42))
- Input: `{ booking_id, new_cleaner_id, let_customer_choose }`
- Kontrollerar booking.status === 'awaiting_company_proposal' (rad 72-74)
- Två grenar:
  - `let_customer_choose=true`: nollställer cleaner_id, status→awaiting_reassignment, kunden väljer
  - Annars: sätter ny cleaner_id, check kvalitet (rating-tröskel), mejlar kund för approval

### 8. `booking_staff`-tabellen används aldrig

Grep-verifierat: `booking_staff` förekommer i:
- [add-booking-architecture-tables.sql:8-34](supabase/add-booking-architecture-tables.sql:8) — definition
- Denna audit-rapport

**0 träffar i kod** (alla HTML-filer, alla EFs, alla andra SQL-migrations).

CREATE TABLE ([add-booking-architecture-tables.sql:8-19](supabase/add-booking-architecture-tables.sql:8)):
```sql
CREATE TABLE IF NOT EXISTS booking_staff (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'assistant' CHECK (role IN ('primary', 'assistant')),
  hours_worked numeric(5,2),
  status text CHECK (status IN ('assigned', 'confirmed', 'completed', 'cancelled')),
  assigned_by uuid REFERENCES cleaners(id),
  ...
  UNIQUE(booking_id, cleaner_id)
);
```

Design: "extra personal per bokning" (multiple cleaners per job, primary + assistants).
Verklighet: aldrig implementerat. Alla tilldelningar går via `bookings.cleaner_id` (single-person).

---

## Fungerar som förväntat

✅ **VD ser team-bokningar** via OR-filter + RLS-policy "Company owner reads team bookings"
✅ **Separata UI-knappar** för pending (accept/reject) vs confirmed (reassign/cancel)
✅ **Reassignment via direct PATCH** är enkel och atomisk — single source of truth är `bookings.cleaner_id`
✅ **Rejection-flöde med company-propose-substitute** har formellt proposal-flöde: rating-check, customer-approval, 2h-tidsgräns
✅ **VD får mejl vid rejection** via Resend ([cleaner-booking-response:242-249](supabase/functions/cleaner-booking-response/index.ts:242))
✅ **Authorization via is_company_owner-check** i cleaner-booking-response

---

## Frågetecken (Regel #27-flaggor)

### 🚩 F1: Efter reassign — får Dildora notis?

`ownerReassignBooking` ([stadare-dashboard.html:8072](stadare-dashboard.html:8072)) gör BARA PATCH. Ingen push, SMS, email, eller log triggas explicit. **Om Dildora är aktiv med real-time subscription** ([stadare-dashboard.html:5089-5097](stadare-dashboard.html:5089)) får hon uppdateringen via postgres_changes. Men om hon inte är inloggad → hon vet inte om det nya jobbet.

**Antagande att bekräfta:** Dildora förväntas logga in själv och se jobbet i sin lista. **Ingen proaktiv notifiering.**

### 🚩 F2: Ändras `spick_gross_sek` vid reassign?

Nej — `ownerReassignBooking` uppdaterar bara cleaner_id/name/email/phone. Om Dildora har annan commission-rate än Zivar (vilket är möjligt per-cleaner commission_rate i [cleaners-tabellen]), **spick_gross_sek reflekterar inte längre rätt belopp**.

För Solid Service med `use_company_pricing=false` + commission=12% flat (från platform_settings) är det kanske inte ett problem. Men för företag där cleaners har olika commission → Regel #28-pris-inkonsekvens.

### 🚩 F3: Loggas reassign i booking_events/booking_status_log?

Grep `log_booking_event|booking_status_log` i stadare-dashboard.html → **0 träffar**. ownerReassignBooking loggar inget explicit.

**MEN:** Det kan finnas trigger i DB som loggar bookings-UPDATEs till `booking_status_log` ([PREFLIGHT_RUN_THIS.sql:118](supabase/PREFLIGHT_RUN_THIS.sql:118)). Kräver SQL-verifikation.

### 🚩 F4: Hur hämtas `_teamMembers`-variabeln?

[stadare-dashboard.html:8059-8062](stadare-dashboard.html:8059) refererar `_teamMembers` för reassignment-picker. Var populeras den? Grep ger över 20 träffar — troligen laddat när VD öppnar "Team"-tab. Om VD inte besökt den tabben → `_teamMembers` tom → picker visar "Inga andra aktiva teammedlemmar" ([stadare-dashboard.html:8065](stadare-dashboard.html:8065)).

### 🚩 F5: RLS — ser Dildora bokningen efter reassign?

Tidigare audit flaggade att [20260402000001:20-26](supabase/migrations/20260402000001_fix_rls_security.sql:20) policy jämför `cleaner_id = auth.uid()` vilket är fel (cleaner.id ≠ auth.users.id). Om Dildora ändå ser bokningen i prod finns en odokumenterad policy, t.ex. baserat på `cleaners.auth_user_id`.

Användaren bekräftade att "Company owner reads team bookings" finns i prod — men det är för VD, inte individ-cleaner. Kör SQL #4 nedan för att verifiera cleaner-individ-policy.

### 🚩 F6: `cleaner-booking-response` skriver VD:s email istället för team-medlemmens

[cleaner-booking-response/index.ts:87-88](supabase/functions/cleaner-booking-response/index.ts:87):
```js
cleaner_email: cleaner.email || null,  // cleaner här = inloggad användare = VD
cleaner_phone: cleaner.phone || null,
```

När Zivar accepterar på Dildoras vägnar → `cleaner.email = zivar@...`. Men **bokningens cleaner_id är fortfarande Dildora**. Så det finns en mismatch mellan cleaner_id och cleaner_email/phone.

Detta kan påverka:
- Kvitto-email (skickas till fel mottagare?)
- Cleaner-kontakt från kund
- Admin-filter

### 🚩 F7: Om VD kör `ownerReassignBooking` på en `pending_confirmation`-booking?

UI ([stadare-dashboard.html:6203-6207](stadare-dashboard.html:6203)) visar bara Acceptera/Avböj för pending_confirmation, inte Omfördela-knappen. Men om någon anropar `ownerReassignBooking` direkt via console → ingen server-validering. PATCH kan lyckas → confused state.

---

## Demo-risker

### 🔴 P0 — blockar demo

**P0-1: Teammedlem-notifiering saknas**
Om demon visar "Zivar omfördelar till Dildora" → Dildora får ingen notis. Sämsta fall: demo-presentation antyder att systemet fungerar reaktivt men det är en tyst uppdatering. Rafael kan påpeka "hur vet min anställd att jobbet är hennes?"

**Åtgärd:** Säg tydligt "Dildora måste logga in för att se jobbet. Real-time-uppdatering sker via postgres_changes om hon är inloggad."

### 🟡 P1 — gör demo skakig

**P1-1: Email/phone skrivs fel vid VD-accept**
Efter Zivar accepterar Dildoras bokning skrivs Zivars email som cleaner_email. Om kundens kvitto refererar cleaner_email → kund får fel info. Kontrollera innan demon.

**P1-2: Två reassignment-flöden med olika UX**
- Direct `ownerReassignBooking` (confirmed bookings): ingen customer approval, ingen quality-check
- `company-propose-substitute` (awaiting_company_proposal): formellt flöde med customer approval
Om demon visar båda flödena kan Rafael förvirras.

**P1-3: `_teamMembers` måste vara laddat**
Reassignment-picker visar "Inga andra aktiva teammedlemmar" om VD inte öppnat Team-tabben. Klicka "Team" minst en gång före demon.

### 🟢 P2 — kosmetiskt

- Ingen logging i booking_events/booking_status_log vid reassign (ej synligt för Rafael, men Regel #27-svaghet)
- `booking_staff`-tabellen är död kod (Regel #28, men påverkar inget demo-flöde)

---

## SQL-verifikation

### Kör innan demon

```sql
-- 1. Finns booking_staff-tabellen?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'booking_staff'
ORDER BY ordinal_position;
-- Förväntat: 9 kolumner (id, booking_id, cleaner_id, role, hours_worked, status, assigned_by, created_at, updated_at)

-- 2. Hur många rader i booking_staff?
SELECT COUNT(*) FROM booking_staff;
-- Förväntat: 0 (aldrig använd)

-- 3. Rafas bokningar (som kontrast/referens)
SELECT
  b.id, b.customer_name, b.cleaner_id, b.cleaner_name,
  b.status, b.payment_status,
  c.first_name, c.last_name, c.is_company_owner
FROM bookings b
LEFT JOIN cleaners c ON c.id = b.cleaner_id
WHERE c.company_id = (
  SELECT id FROM companies WHERE slug = 'rafa-allservice'
);
-- Visar om Rafa har några bokningar + hur cleaner_id sätts

-- 4. RLS-policies på bookings
SELECT policyname, cmd, permissive, roles, qual
FROM pg_policies
WHERE tablename = 'bookings'
ORDER BY policyname;
-- Förväntat: Auth read own, Anon read by uuid, Service role all, + "Company owner reads team bookings"
-- Sök efter ev. individ-cleaner-policy: "Cleaner reads own bookings USING (cleaner_id IN (SELECT id FROM cleaners WHERE auth_user_id = auth.uid()))"

-- 5. booking_status_log eller booking_events — loggas reassign?
SELECT column_name FROM information_schema.columns WHERE table_name = 'booking_status_log';
SELECT COUNT(*), MAX(created_at) FROM booking_status_log;

-- 6. Solid Services cleaners och deras commission_rate
SELECT id, full_name, is_company_owner, commission_rate, status
FROM cleaners
WHERE company_id = (SELECT id FROM companies WHERE org_number = '559537-7523');
-- Kontrollerar om alla har samma commission_rate eller olika (påverkar reassign-pris)
```

### Live-demo-sequence

**Steg 1 — Skapa test-bokning (från Moment 1-testsekvens)**
Nu existerar en bokning med `cleaner_id=Dildora, status=pending_confirmation` (eller bekräftad om auto-confirm).

**Steg 2 — Öppna Zivar's dashboard via view_as**
Admin.html → Cleaners → Zivar → "📊 Dashboard"

**Steg 3 — Gå till "Team"-tab**
- Bokningen syns under "Kommande" eller "Idag"
- Om pending_confirmation: visa Acceptera/Avböj
- Om bekräftad: visa Omfördela/Avboka

**Steg 4 — Demo "Omfördela till Odilov"**
1. Klicka "⇄ Omfördela"
2. Picker visar team-medlemmar (exkl. Dildora som är aktuell)
3. Klicka "Odilov"
4. Confirm-dialog: "Omfördela till Odilov?"
5. Toast: "✅ Omfördelad till Odilov"
6. Kontrollera i admin.html: `bookings.cleaner_id = Odilov.id`

**Steg 5 — Visa kvarstående begränsningar (honesty)**
Säg:
> "Just nu: Odilov får ingen push/SMS. Hon ser det nästa gång hon loggar in. I produktionsversion kopplar vi in team-sms-notify för direkt notifiering."

---

## Backlog (fix efter mötet)

### 🚨 P0 — efter demon
1. **Notifiera ny cleaner vid reassign** — anropa `team-sms-notify` + push från `ownerReassignBooking` (30 min)
2. **Fixa cleaner_email-bugg** i `cleaner-booking-response` ([index.ts:87-88](supabase/functions/cleaner-booking-response/index.ts:87)) — skriv target-cleanerns email, inte inloggad användares (15 min)
3. **Loggning av reassign** — anropa `log_booking_event` RPC från `ownerReassignBooking` (10 min)

### Regel #28-skulder
4. **Ta bort booking_staff-tabellen** om den inte ska användas. Eller implementera "extra personal"-koncept som designen förutsätter. Välj en. (1-2h att ta bort / 1-2 dagar att implementera)
5. **Konsolidera reassignment-flöden:** bestäm om alla reassignments ska gå via `company-propose-substitute` EF (med kvalitetscheck och customer approval) eller om "quick reassign" är OK. Just nu två parallella (Regel #28).

### Regel #27-skulder  
6. **Dokumentera alla RLS-policies** i migration-filer (pg_policies-dump + skapa migration)
7. **Validera "Company owner reads team bookings"-policy** genom att leta efter den i SQL-migrations eller skapa om saknas

### UX-förbättringar
8. **Email till kund** vid reassign om cleanern bytts. Kund förtjänar veta.
9. **Rating-check på quick-reassign** — varna VD om Odilov har lägre rating än Dildora
10. **"Vill Dildora verkligen avböja?"-confirm** i ownerRejectBooking — just nu lätt att råka klicka fel

---

## Referenser

- [Moment 1: bokning → Stripe](docs/audits/2026-04-19-e2e-moment-1-bokning.md)
- [view_as-analys](docs/audits/2026-04-19-view-as-impersonate-analys.md)
- [Admin-editing-audit](docs/audits/2026-04-19-admin-impersonation-vs-editing.md)
- [boka-filter-bugg](docs/audits/2026-04-19-boka-cleaner-filter-bugg.md)

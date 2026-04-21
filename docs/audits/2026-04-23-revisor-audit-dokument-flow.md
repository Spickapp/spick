# Revisor-audit — Dokumentflöde mot Bokföringslag + Skatteverket

**Datum:** 2026-04-23
**Status:** §2.5-R1 research, ingen kod ändrad
**Beslutsfattare:** Farhad Haghighi (projektchef)
**Primärkälla:** [Bokföringslag (1999:1078) 5 kap 7§](https://rkrattsbaser.gov.se/sfst?bet=1999:1078) + [Mervärdesskattelag (1994:200) 11 kap 8§](https://rkrattsbaser.gov.se/sfst?bet=1994:200) + Skatteverket RUT-regler 2026 (verifierat av Farhad 2026-04-23)

---

## TL;DR

Spick har **fyra parallella dokument-flöden** som delvis överlappar, delvis konkurrerar, och tillsammans täcker **inget enda av dem** alla obligatoriska bokföringslag-krav. Den största upptäckten utanför Spår B: **kunden får aldrig sitt kvitto/faktura via e-post**. Det genereras + laddas upp till storage men länken syncas inte med någon mejl-mall.

Minst 4 🔴 kritiska brister som blockerar korrekt bokföring. Minst 6 🟡 sekundära brister. Samtliga behöver fix innan RUT-ansökan åter-aktiveras i Fas 7.5 (eller tidigare om bokföringsgranskning inkommer).

---

## 1. Dokument-inventering (5 dokument-flöden)

| # | Dokument | Typ | Utfärdare | Mottagare | Trigger | Lagring |
|---|---|---|---|---|---|---|
| **D1** | `faktura.html?bid=X&type=customer` | On-the-fly HTML | Spick | Kund | Kund-URL (ej mejlad) | Render från `bookings`-rad, ej persistent |
| **D2** | `generate-receipt` EF → `KV-YYYY-NNNN.html` | Persistent HTML | Spick | Kund | Stripe-webhook `checkout.session.completed` | Supabase Storage `receipts/` bucket |
| **D3** | `faktura.html?bid=X&type=cleaner` | On-the-fly HTML | Spick (köpare) | Städare (säljare) | Städare-URL (ej mejlad) | Render från `bookings`-rad, ej persistent |
| **D4** | `generate-self-invoice` EF → `SF-YYYY-NNNN.html` | Persistent HTML | Spick (köpare) | Städare (säljare) | Månadsvis manuellt anrop | Supabase Storage `invoices/` bucket + `self_invoices`-tabell |
| **D5** | `serve-invoice` EF | Pass-through router | — | — | URL-anrop från receipt/faktura-email | Ingen — läser från storage |

### Observationer på inventeringen

- **D1 och D2 är duplicerade** men använder olika fakturanr-format (`SP-` UUID-prefix i D1, `KV-YYYY-NNNN` sekventiellt i D2). Olika dokument för samma transaktion.
- **D3 och D4 är duplicerade** på samma sätt (`SF-` UUID-prefix i D3, `SF-YYYY-NNNN` sekventiellt i D4). D3 är per-bokning, D4 är månadsvis.
- **D1 och D3 delar samma URL** (`faktura.html`) men `?type=`-parameter styr vilken som renderas. Kunden ser D1, städaren ser D3 — ingen ACL-skydd (båda kan se båda om de ändrar URL).
- **D2 (`KV-...`) sekventiell numreringsserie** delar `receipts/`-bucket med `generate_receipt_number()`-RPC (atomär counter).
- **D4 (`SF-...`) sekventiell numreringsserie** delar `invoices/`-bucket med `generate_invoice_number()`-RPC.
- **D1 och D3 saknar sekventiell numrering** — använder UUID-prefix, bryter mot bokföringslag.

---

## 2. Kompletthet-matris (obligatoriska fält per dokument)

Bokföringslag 5 kap 7§ + Mervärdesskattelag 11 kap 8§:

| # | Obligatoriskt fält | D1 fakt-html (kund) | D2 generate-receipt | D3 fakt-html (städare) | D4 generate-self-invoice |
|---|---|---|---|---|---|
| 1 | Utfärdandedatum | 🔴 saknas | ✅ `receiptDate` | 🔴 saknas | ✅ `invoiceDate` |
| 2 | Fakturanummer | 🔴 UUID-prefix (ej sekv.) | ✅ `KV-YYYY-NNNN` sekv. | 🔴 UUID-prefix (ej sekv.) | ✅ `SF-YYYY-NNNN` sekv. |
| 3 | Utfärdarens namn | ✅ "Haghighi Consulting AB" | ✅ "Haghighi Consulting AB" | ✅ "Haghighi Consulting AB" | ✅ "Haghighi Consulting AB" |
| 4 | Utfärdarens adress | ❌ saknas | ❌ saknas | ❌ saknas | 🟡 "Solna, Sverige" (vag) |
| 5 | Utfärdarens org.nr | ✅ "559402-4522" | ✅ "559402-4522" | ✅ "559402-4522" | ✅ "559402-4522" |
| 6 | Momsregistreringsnr | 🟡 endast i footer | 🔴 saknas | 🟡 endast i footer | ❌ saknas (köpare behöver inte visa) |
| 7 | Kundens/säljarens namn | ✅ `customer_name` | ✅ `customer_name` | ✅ `cleanerName` eller `companyName` | ✅ `sellerName` |
| 8 | Kundens/säljarens adress | 🟡 delvis (`customer_address`) | 🟡 `address` = tjänsteadress, EJ kundens faktureringsadress | ❌ saknas | 🟡 `sellerAddress` om satt |
| 9 | Beskrivning av tjänst | ✅ `service_type` + datum + tid | ✅ service + hours + adress | ✅ `service_type` + datum | ✅ per rad: datum + tjänst + timmar |
| 10 | Datum för utförd tjänst | ✅ `booking_date` | ✅ `bookingDate` | ✅ `booking_date` | ✅ per rad |
| 11 | Belopp per momssats | 🔴 saknas (bara total) | 🟡 visas (exkl moms / moms / totalt) | 🔴 saknas | ✅ netto + moms-rad |
| 12 | Momssats + moms-belopp | 🔴 saknas | ✅ "Moms 25%" + belopp | 🔴 saknas | ✅ "Moms 25%" om momsreg |
| 13 | Totalbelopp inkl moms | ✅ "Att betala" (utan moms-spec) | ✅ "ATT BETALA" | ✅ "Utbetalning till dig" | ✅ "Att betala" |
| 14 | F-skatt-uppgift | ✅ footer | 🟡 saknas på kvittot | ✅ footer | ✅ "Godkänd för F-skatt" badge |
| 15 | RUT-avdragets storlek | ✅ "RUT-avdrag (50%)" | ✅ "RUT-avdrag 50%" | N/A (inte kund-dok) | N/A (inte RUT-dok) |

### Sammanställd kompletthet

| Dokument | Totalt 🔴 | Totalt 🟡 | Totalt ❌ | Totalt ✅ | Legal status |
|---|---|---|---|---|---|
| D1 `faktura.html` kund | **4** | 2 | 1 | 7 | 🔴 Fakturanr bryter BokfL, moms saknas |
| D2 `generate-receipt` | 1 | 3 | 2 | 8 | 🟡 Kvitto OK för kunskap, saknar moms-reg.nr |
| D3 `faktura.html` cleaner | **3** | 1 | 3 | 6 | 🔴 Fakturanr bryter BokfL, moms saknas |
| D4 `generate-self-invoice` | 0 | 2 | 2 | 10 | 🟡 Närmast korrekt, mindre adressbrister |

**D4 (månadsvis självfaktura till städare) är det ENDA dokumentet som är nära bokföringslag-kompatibelt.** De andra tre har kritiska brister.

---

## 3. Kritiska brister (🔴)

### 🔴 K1 — Fakturanummer-serier i D1 + D3 bryter BokfL 5 kap 7§

**Problem:** `'SP-' + (b.id || '').slice(0, 8).toUpperCase()` ([faktura.html:119](../../faktura.html:119)) tar UUID-prefix. UUIDs är slumpmässiga, inte sekventiella. Bokföringslag kräver **entydig och sekventiell nummerserie**.

**Konsekvens:** Vid revision kan Skatteverket underkänna fakturor. Dessutom är UUID-prefix inte garanterat unikt på 8 tecken — kollisioner möjliga vid tusentals fakturor.

**Fix:** D1/D3 måste persistera till en tabell (likt D4) och använda `generate_invoice_number()` eller motsvarande. Ren on-the-fly-rendering fungerar inte för fakturor.

### 🔴 K2 — Moms-specifikation saknas i D1 och D3

**Problem:** [faktura.html:190-192](../../faktura.html:190) visar bara "Arbetskostnad", "RUT-avdrag" och "Att betala". **Ingen rad för moms eller belopp exkl moms.**

**Konsekvens:** Mervärdesskattelag 11 kap 8§ kräver att faktura med moms visar moms-sats och moms-belopp separat. RUT-tjänster i Sverige är 25 % moms-belagda — momsen ska synas på fakturan.

**Fix:** Lägg till rader före totalsumma: `Arbetskostnad exkl moms: X kr`, `Moms 25%: Y kr`, `Arbetskostnad inkl moms: Z kr`, `RUT-avdrag 50%: -A kr`, `Att betala: B kr`.

D2 (`generate-receipt`) gör detta korrekt vid `isRut`-fallet ([generate-receipt:215-221](../../supabase/functions/generate-receipt/index.ts:215)). Samma mönster kan kopieras till D1.

### 🔴 K3 — Kunden får inte fakturan/kvittot via e-post

**Problem:** 
- [generate-receipt:115-117](../../supabase/functions/generate-receipt/index.ts:115) sparar `receipt_url` + `receipt_number` på `bookings`-raden.
- 0 caller i `supabase/functions/` läser sedan `receipt_url` för att skicka till kund (verifierat via grep).
- [stripe-webhook:403-408](../../supabase/functions/stripe-webhook/index.ts:403) skickar "Bokning bekräftad"/"Bokning mottagen"-mejlet **innan** generate-receipt körts ([rad 519-528](../../supabase/functions/stripe-webhook/index.ts:519) anropar receipt-EF efteråt), och mejlet innehåller ingen receipt-länk.
- Om kunden vill se kvittot måste de besöka `faktura.html?bid=<uuid>` vilket de aldrig fått URL:en till.

**Konsekvens:** Kunden har inget underlag för RUT-granskning i deklarationen. Om kunden bestrider betalningen kan Spick inte peka på ett utskickat kvitto. Strider mot god kundpraxis + möjligen konsumentlag.

**Fix:** Uppdatera bekräftelsemejlet (efter `await supabase.from("bookings").update({ receipt_url, receipt_number })`) att inkludera länk till `serve-invoice?file=<receipt_number>.html` eller direkt `receipt_url`. Kräver att generate-receipt körs SYNKRONT före mejlet skickas.

### 🔴 K4 — D1 och D3 (on-the-fly) är inte immutable

**Problem:** Dokumenten genereras varje gång URL:en laddas, direkt från `bookings`-raden. Om bookings-raden ändras (admin-edit, refund-flöde, price-adjustment) ändras fakturan retroaktivt. Detta är **efterhandskonstruktion** enligt bokföringslag.

**Konsekvens:** Tidigare utställda fakturor kan inte återskapas med sitt ursprungliga innehåll. Revisor kan underkänna hela dokument-serien.

**Fix:** D1/D3 bör ersättas av persistenta dokument (likt D2/D4) som laddas upp till storage vid utställandet och aldrig ändras. Refund → ny kreditfaktura (ny immutable fil).

---

## 4. Sekundära brister (🟡)

### 🟡 S1 — Utfärdarens adress saknas i D1, D2, D3

Footer visar bara "Haghighi Consulting AB · Bifirma Spick · Org.nr 559402-4522 · hello@spick.se · spick.se". Ingen postadress. Bokföringslag säger "namn och adress".

**Åtgärd:** Lägg till "Solna, Sverige" eller fullständig företagsadress i alla tre dokument.

### 🟡 S2 — Momsregistreringsnr saknas på D2 och D3

D1 visar det i footer ("SE559402452201"), D2 och D3 gör inte det. Momsregistrerad utfärdare måste visa momsreg.nr enligt MervL 11 kap 8§.

**Åtgärd:** Lägg till "Momsreg.nr: SE559402452201" i footer på D2 och D3.

### 🟡 S3 — Kundens adress i D2 är tjänsteadress, inte faktureringsadress

[generate-receipt:72](../../supabase/functions/generate-receipt/index.ts:72) sätter `address: booking.customer_address`. Men `customer_address` är **städ-adress**, inte kundens registrerade faktureringsadress. Kan vara samma, kan vara olika.

**Åtgärd:** Separata fält: `customer_billing_address` (faktureringsadress) + `service_address` (städ-adress). Bokföringslag vill ha faktureringsadressen.

### 🟡 S4 — Säljaradress i D4 är "Solna, Sverige" som fallback

[generate-self-invoice:285](../../supabase/functions/generate-self-invoice/index.ts:285): `buyer_address: "Solna, Sverige"`. Vag adress, Skatteverket accepterar det men det är inte bästa praxis.

**Åtgärd:** Hämta riktig business-adress från `Haghighi Consulting AB`-uppgifterna.

### 🟡 S5 — F-skatt-uppgift saknas på D2 (kvitto)

Kvittot saknar "Godkänd för F-skatt"-noteringen som finns på fakturan (D1) och självfakturan (D4). Inte strikt obligatoriskt för kvitto men förväntat vid RUT.

**Åtgärd:** Lägg till F-skatt-noteringen i D2-footer.

### 🟡 S6 — D3 saknar säljaradress (städarens adress)

När städaren fakturerar via D3 (on-the-fly) visas ingen `business_address`. Då städaren är säljare bryter det MervL 11 kap 8§.

**Åtgärd:** Fetch + rendera `cleaners.business_address` i `renderCleanerInvoice`.

### 🟡 S7 — Fakturan (D1) visar inte momsregistreringsnr synligt

Det står i footern i 0.75 rem-text. Bokföringslag säger det ska vara tydligt. Flytta till `inv-meta-box`-sektionen.

### 🟡 S8 — D3 skickas aldrig till städaren

Samma problem som K3 men för städare. Städaren får aldrig länk till sin självfaktura (D3). D4 månadsversionen skapas men levereras inte heller automatiskt — vi genererar till storage men ingen email-flow triggar.

---

## 5. Test-transaktion — spårbarhetsanalys

Jag kan inte köra DB-query direkt. Studio SQL nedan för Farhad att köra och klistra tillbaka:

### Query 5A — Hitta Farhads test-transaktion

```sql
SELECT
  id,
  booking_date,
  booking_time,
  booking_hours,
  service_type,
  customer_name,
  customer_email,
  customer_phone,
  customer_address,
  customer_pnr,
  customer_pnr_hash,
  customer_type,
  total_price,
  amount_paid,
  rut_amount,
  commission_pct,
  base_price_per_hour,
  customer_price_per_hour,
  payment_status,
  payment_method,
  status,
  stripe_session_id,
  stripe_payment_intent_id,
  stripe_fee_sek,
  spick_gross_sek,
  receipt_number,
  receipt_url,
  rut_claim_status,
  rut_application_status,
  confirmed_at,
  completed_at,
  checked_in_at,
  checkout_time,
  created_at
FROM bookings
WHERE customer_email = 'farrehagge@gmail.com'
   OR customer_email ILIKE '%hello@spick.se%'
ORDER BY created_at DESC
LIMIT 5;
```

### Query 5B — Hitta relaterade dokument

```sql
-- Kontrollera om self_invoice skapats för denna städare/period
SELECT si.invoice_number, si.period_start, si.period_end, si.booking_ids,
       si.total_gross, si.total_net, si.status, si.pdf_url, si.html_url
FROM self_invoices si
WHERE si.booking_ids @> ARRAY['<boka_id_från_5A>']::uuid[]
   OR si.cleaner_id = '<cleaner_id_från_5A>';

-- Kontrollera commission_log
SELECT * FROM commission_log
WHERE booking_id = '<boka_id_från_5A>';
```

### Förväntad spårbarhets-analys

För Farhads test-transaktion förväntar vi (baserat på kod-läsning):

| Spårbarhets-punkt | Förväntat resultat | Vad det säger |
|---|---|---|
| `stripe_session_id` | Satt | Kopplad till Stripe checkout |
| `stripe_payment_intent_id` | Satt | Kopplad till Stripe payment |
| `stripe_fee_sek` | Satt (om `money_layer_enabled=true`) | Stripes avgift synlig |
| `spick_gross_sek` | Satt | Commission beräknad |
| `receipt_number` | Troligen satt (`KV-YYYY-NNNN`) | D2-kvitto genererat |
| `receipt_url` | Troligen satt | HTML i receipts-bucket |
| `rut_claim_status` | `'pending_api_key'` eller NULL | Spök-trigger (nu stoppad) |
| `completed_at` | NULL eller satt efter checkout | Om städning utförts |
| `self_invoices`-match | Troligen 0 rader | D4 genereras bara manuellt |
| `commission_log`-match | Troligen 1 rad | money-layer-beräkning |

**Spårbarhet Spick → Stripe:** ✅ Via `stripe_session_id` + `stripe_payment_intent_id`
**Spårbarhet Spick → Skatteverket:** 🔴 Bruten (rut-claim avstängd + SKV_API_KEY tom)
**Spårbarhet kund-fakturering:** 🟡 Kvitto finns i storage, men URL ej levererad till kund
**Spårbarhet städar-fakturering:** 🔴 Ingen månadsvis självfaktura (D4) för denna period ännu

---

## 6. Rekommenderad fix-ordning (mappad mot §2.5-R2 till §2.5-R6)

Rangordnade efter exponering + beroenden:

| Prio | Sub-fas | Innehåll | Tim | Beroenden |
|---|---|---|---|---|
| **P1** | **§2.5-R2** | **K3 — synka receipt_url till kund-bekräftelsemejl**. Uppdatera stripe-webhook att köra generate-receipt synkront + inkludera `receipt_url` i bekräftelsemejl. | 2-3 | Ingen |
| **P1** | **§2.5-R3** | **K2 — moms-rad i D1 + D3**. Kopiera mönster från D2 (generate-receipt). Lägg till `Arbetskostnad exkl moms` + `Moms 25%` + `inkl moms` rader i faktura.html. | 1-2 | Ingen |
| **P2** | **§2.5-R4** | **K1 + K4 — persistera D1/D3 eller redirect till D2/D4**. Två vägar: (a) bygg `generate-customer-invoice` EF som skapar D1 med `SP-YYYY-NNNN` sekventiell + uppladdning, eller (b) radera D1/D3 och peka all fakturering till D2 (kvitto) + D4 (månadsvis). Beslutet är scope-fråga. | 6-10 (a) / 2-3 (b) | Beslut av Farhad |
| **P3** | **§2.5-R5** | **S1 + S2 + S5 — addressfält + F-skatt + momsreg.nr**. Kosmetiska fält-tillägg i alla dokument. | 1 | §2.5-R4 |
| **P3** | **§2.5-R6** | **S8 — trigga D4-leverans till städare**. När self_invoice genereras, skicka länken via mejl. | 1-2 | §2.5-R4 |
| **P4** | Hygien-task | **S3 — `customer_billing_address` separat från tjänsteadress**. Kräver DB-schema-ändring + boka.html-uppdatering. | 3-5 | Ingen akut, långsiktig fix |

**Total scope §2.5-R2 till R6: 11-18h** beroende på R4-beslutet.

### Rekommenderad commit-ordning

1. §2.5-R2 (kund får kvittot) — **fristående kritisk fix**
2. §2.5-R3 (moms-rad) — **fristående kritisk fix**
3. §2.5-R4a eller R4b (persistering) — **scope-beslut först**
4. §2.5-R5 + R6 — **samma commit, kosmetiska fix efter R4**

§2.5-R2 kan gå live inom timmar — det är den enskilt högsta värde-påverkan (kunder får kvittot, minskar supporttryck, ger RUT-underlag).

---

## 7. Upptäckta brister utanför ursprunglig Spår B-lista

Spår B 2026-04-23 fokuserade på RUT-trigger-timing + faktura-persistering. Denna audit fann dessutom:

### U1 — D1 och D3 har ingen ACL

[faktura.html:65](../../faktura.html:65) `const type = params.get('type') || 'customer'`. Kund med bokning-id kan se städarens självfaktura genom att ändra `?type=cleaner`. Läcker kommission-belopp och cleaner-intjäning till kund.

**Risk:** 🟡 informationsläcka, inte ekonomisk skada.
**Fix:** Verifiera att betraktarens auth matchar dokumentets typ. Scope §2.5-R4 eller separat hygien-task.

### U2 — D2 auto-genereras men D4 inte

Kund-kvitto (D2) triggas automatiskt av stripe-webhook vid betalning. Städar-självfaktura (D4) kräver manuellt anrop till `generate-self-invoice` med `{ month: "YYYY-MM" }` eller `{ cleaner_id, period_start, period_end }`. Inget cron-jobb gör detta idag (grep 0 träffar på "generate-self-invoice" i `.github/workflows/`).

**Risk:** 🟡 städare får ingen faktura utan manuell admin-action.
**Fix:** Månadsvis cron `generate-self-invoice-cron` som kör första måndagen varje månad för föregående månad. Scope ~2-3h. Del av §2.5-R6 eller separat hygien-task.

### U3 — D4 använder commission_pct fallback 17%

[generate-self-invoice:190](../../supabase/functions/generate-self-invoice/index.ts:190) `const commPct = cl?.commission_pct || 17`. Hårdkodad fallback 17% när `commission_log`-raden saknas. Detta bryter mot v3:s single-source-of-truth (`platform_settings.commission_standard=12`). Samma mönster som hygien-task #4 i progress-filen (admin.html commission-hardcodes).

**Risk:** 🟡 fel commission på självfaktura om commission_log-rad saknas.
**Fix:** Använd `_shared/money.ts::getCommission()`. Scope ~30 min. Hanteras lämpligen som del av hygien-task #4 (`§1.9c läckage-fix`) eller separat.

### U4 — D2 hanterar företagsmoms korrekt men RUT-moms potentiellt fel

[generate-receipt:199-209](../../supabase/functions/generate-receipt/index.ts:199) för företag: `exVat = round(total/1.25); vat = total - exVat`. Detta antar att `total_price` är inkl moms för företag. Men [rad 211-212](../../supabase/functions/generate-receipt/index.ts:211) för RUT: `grossPrice = total + rut_amount; exVat = round(gross/1.25)`. Fungerar **om** `total_price` är efter-RUT och `rut_amount` är RUT-beloppet — då är grossPrice brutto inkl moms.

**Risk:** 🟡 behöver verifieras mot faktisk test-transaktion. Matematik bra på ytan, men känsligt för att `total_price`-semantik är konsistent över kod-baser.
**Fix:** Verifiera via test-transaktionen (Query 5A) att `total_price + rut_amount = grossPrice` stämmer och att moms-belopp är korrekt. Om fel: fix i §2.5-R3.

### U5 — receipt_url lagras som publik URL

[generate-receipt:91](../../supabase/functions/generate-receipt/index.ts:91) skapar bucket med `{ public: true }`. Alla kvitton är alltså publikt läsbara om man känner URL:en. Innehåller kundens namn + städadress.

**Risk:** 🟡 GDPR-exponering om URL läcker (men URLs är långa UUID-liknande, praktisk säkerhet).
**Fix:** Byt till signed URLs med TTL. Scope 1-2h. Ingen akut risk men bättre praxis.

### U6 — Sekventiell nummerserie återanvänds inte vid rollback

Om `generate_invoice_number()` ger `SF-2026-0042` men `self_invoices.insert` misslyckas, är 0042 förbrukat. Nästa försök får 0043 → **glapp i serien**. Bokföringslag kräver obruten serie.

**Risk:** 🟡 revisor frågar varför 0042 saknas.
**Fix:** Transaktionell RPC som både reserverar nummer och skriver raden. Eller `ON CONFLICT`-logik som rollback:ar counter. Scope 2-3h.

---

## 8. Handover till §2.5-R2 och framåt

**Primärkälla för framtida sessioner:** denna rapport + [2026-04-23-rut-infrastructure-decision.md](2026-04-23-rut-infrastructure-decision.md) (tidigare §2.5-minifix).

**Rekommendation:**

1. **§2.5-R2 (K3 fix)** — kund får kvittot via mejl. Scope 2-3h. **Gör först.** Minskar supporttryck, ger RUT-underlag, bygger förtroende.
2. **§2.5-R3 (K2 fix)** — moms-rad i fakturor. Scope 1-2h. Gör direkt efter R2.
3. **R4-beslut** — behöver Farhad välja (a) bygga immutable kund-faktura-flow eller (b) avveckla D1/D3 till förmån för D2/D4. Påverkar scope ~6-10h vs ~2-3h.
4. **§2.5-R5 + R6** — kosmetiska fix efter R4 landat. ~2-3h totalt.

**Väntar på:** Farhads beslut på R4-scope + go-signal för §2.5-R2.

**Inga kod-ändringar, inga commits, inga migrations** gjorda i denna audit-session.

---

## Referenser

- [docs/audits/2026-04-23-rut-infrastructure-decision.md](2026-04-23-rut-infrastructure-decision.md) — §2.5-minifix (trigger avstängd)
- [docs/archive/edge-functions/rut-claim/](../archive/edge-functions/rut-claim/) — arkiverad rut-claim EF
- [faktura.html](../../faktura.html) — D1/D3 on-the-fly rendering
- [generate-receipt/index.ts](../../supabase/functions/generate-receipt/index.ts) — D2 persistent kvitto
- [generate-self-invoice/index.ts](../../supabase/functions/generate-self-invoice/index.ts) — D4 månads-självfaktura
- [serve-invoice/index.ts](../../supabase/functions/serve-invoice/index.ts) — D5 pass-through
- [stripe-webhook/index.ts:400-530](../../supabase/functions/stripe-webhook/index.ts:400) — email-mallar + dokumenttriggers
- Bokföringslag (1999:1078) 5 kap 7§
- Mervärdesskattelag (1994:200) 11 kap 8§
- Skatteverket: RUT-regler 2026 (verifierat av Farhad 2026-04-23)

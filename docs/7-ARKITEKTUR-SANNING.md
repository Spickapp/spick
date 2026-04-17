# 7 — Spick Arkitektur-sanning

> **Syfte:** Registrera platser där samma logik finns på flera ställen i kodbasen.  
> **Vid ändring — kolla ALLA ställen, inte bara en.**  
> **Senast verifierad:** 2026-04-17 via grep + kodläsning.

Detta dokument är den **permanenta referensen** för fragmenterad logik. När framtida Claude-sessioner planerar ändringar i pricing, commission, auth, status eller översättning — **läs denna FÖRST**.

---

## Pricing-logik (14 ställen)

Pricing hanteras på **14 platser** — 4 skrivande (authoritative), 10 läsande (display). Vid ändring som påverkar pris, verifiera ALLA:

### Authoritative (skriver till DB / Stripe)

| # | Plats | Fil:rad | Läser | Status 2026-04-17 | Risk vid miss |
|---|-------|---------|-------|-------------------|---------------|
| 1 | Frontend preview | [boka.html:2001-2099](../boka.html) | ✅ Korrekt 3-lagers: `use_company_pricing` → `company_service_prices` → `cleaner_service_prices` → `hourly_rate` | OK | Visningsfel (kund ser fel pris) |
| 2 | **Booking insert + Stripe session** | [booking-create/index.ts:183-210](../supabase/functions/booking-create/index.ts) | 🔴 BARA `cleaner_service_prices` + `cleaner.hourly_rate` | **LATENT BUG** — ignorerar `use_company_pricing` | DB **OCH** Stripe får fel belopp (konsekvent fel, inte mismatch — men fel jämfört med preview) |
| 3 | Subscription checkout | [setup-subscription/index.ts:96-100](../supabase/functions/setup-subscription/index.ts) | 🟡 BARA `cleaner.hourly_rate` | LATENT | Subscription-pris låst till fel värde; auto-rebook kan räkna om med helt annat pris |
| 4 | Manual override (VD/admin) | [booking-create/index.ts:230-253](../supabase/functions/booking-create/index.ts) | `manual_override_price` param + proportionell skalning | OK (explicit override) | Om override < 100 → error |
| 5 | ~~stripe-checkout EF~~ | ~~[stripe-checkout/index.ts:112-164](../supabase/functions/stripe-checkout/index.ts)~~ | Korrekt 3-lagers — **MEN DÖD KOD** | ⚠️ **DÖD KOD** (verifierat 2026-04-17: `boka.html:2847` anropar bara `booking-create`) | **Ska raderas efter Dag 2-refaktor** |

### Display (läser från DB, skriver ej)

| # | Plats | Fil:rad | Läser | Risk vid miss |
|---|-------|---------|-------|---------------|
| 6 | Företagslista | [foretag.html:428-444](../foretag.html) | Individ > företag > hourly_rate. 🟡 Ignorerar `use_company_pricing`-flaggan | Visar lägsta pris även om företaget tvingar företagspris → kund gör annat pris på boka.html |
| 7 | Cleaner-profil | [stadare-profil.html:494](../stadare-profil.html) | `cleaner_service_prices` | Visningsfel |
| 8 | Städare egen pricing-UI | [stadare-dashboard.html:5900-5994](../stadare-dashboard.html) | `cleaner_service_prices` CRUD | OK (egen vy) |
| 9 | VD company pricing-UI | [stadare-dashboard.html:8887-8974](../stadare-dashboard.html) | `companies.use_company_pricing` + `company_service_prices` CRUD | OK |
| 10 | Admin cleaner pricing save | [admin.html:3285](../admin.html) | Admin input | OK |
| 11 | admin-create-company | [admin-create-company/index.ts:130,223](../supabase/functions/admin-create-company/index.ts) | INSERT company + cleaner_service_prices | OK |
| 12 | admin-approve-cleaner | [admin-approve-cleaner/index.ts:138,236](../supabase/functions/admin-approve-cleaner/index.ts) | INSERT hourly_rate + cleaner_service_prices | OK |
| 13 | Subscription charge | [charge-subscription-booking/index.ts:171,188](../supabase/functions/charge-subscription-booking/index.ts) | `booking.total_price` + `booking.commission_pct` | ✅ KORREKT REFERENSIMPL |
| 14 | Subscription auto-rebook | [auto-rebook/index.ts:231-232](../supabase/functions/auto-rebook/index.ts) | `sub.hourly_rate` | 🟡 Skickar till booking-create som ny bokning — kan få annat pris via pricing-engine |

### Varningar

- **`stripe-checkout` EF kan se ut som pricing-sanning** (har korrekt `use_company_pricing`-logik) men är oanvänd. Använd **`booking-create`** och **`setup-subscription`** som referens.
- **Dag 2-plan:** Skapa `supabase/functions/_shared/pricing-resolver.ts` som gemensam helper. Ersätt #2 och #3. Ta bort #5. `boka.html` (#1) kan exponeras via RPC senare.

### Gemensam helper

- **Pre-Dag 2:** Inte existerande.
- **Post-Dag 2 (planerat):** [`supabase/functions/_shared/pricing-resolver.ts`](../supabase/functions/_shared/pricing-resolver.ts).
- **Existerande helper som redan delas:** [`_shared/pricing-engine.ts`](../supabase/functions/_shared/pricing-engine.ts) — marginal/rabatt/kredit-motor (EJ pris-resolver).

---

## Stripe-integration (VERIFIERAT 2026-04-17)

**Ett enda aktivt flöde för engångsbokning:**

```
boka.html (rad 2847)  →  POST booking-create EF
                              ↓
                 booking-create/index.ts:611 skapar Stripe Checkout session
                              ↓
                         Returnerar session.url
                              ↓
                    Frontend redirectar kund
                              ↓
                       Kund betalar → Stripe
                              ↓
                    stripe-webhook bekräftar (rad 297-321)
```

**Prenumeration:**
- **Kortregistrering:** `setup-subscription` EF (oberoende flöde).
- **Återkommande charge:** `charge-subscription-booking` EF (cron, dagen innan).
- **Ny bokning per period:** `auto-rebook` EF (cron, kallar `booking-create`).

**Webhook:** `stripe-webhook` hanterar:
- `payment_intent.succeeded` — bekräfta bokning, skicka email.
- `checkout.session.completed` — samma.
- `charge.dispute.created` — clawback.
- `customer.subscription.*` — subscription livscykel.

**⚠️ Oanvänd EF (ska raderas):**
- **`stripe-checkout`** — förvirrande namn, inte kopplad till något flöde. "stripe_checkout" som sträng används dock som `payment_mode`-värde i `booking-create`.

---

## Commission-beräkning (32 träffar)

Alla ställen där commission hanteras:

| Ställe | Fil | Läsning | Skrivning | Status |
|--------|-----|---------|-----------|--------|
| pricing-engine | `_shared/pricing-engine.ts:5,9` | — | Returnerar `commissionPct` (14/17) | ✅ OK |
| booking-create DB insert | `booking-create/index.ts:330,433` | `pricing.commissionPct` | `bookings.commission_pct` | ✅ OK |
| booking-create Stripe fee | `booking-create/index.ts:497,603` | **HÅRDKODAD 0.17/0.12** | Stripe `application_fee_amount` | 🔴 **BUG 1** |
| booking-create commission_log | `booking-create/index.ts:683` | `commissionRate * 100` | `commission_log.commission_pct` | ⚠️ Loggar hårdkodad 17 även om booking är Top-tier (14) |
| stripe-checkout Stripe fee | `stripe-checkout/index.ts:74,88,231` | **HÅRDKODAD 0.17/0.12** | Stripe `application_fee_amount` | 🔴 **BUG 1** (men dead code) |
| charge-subscription-booking | `charge-subscription-booking/index.ts:188-190` | `booking.commission_pct` /100 | Stripe `application_fee_amount` | ✅ **REFERENSIMPLEMENTATION** |
| stripe-webhook | `stripe-webhook/index.ts` | — | `bookings.payment_status='paid'` + dispute-hantering | ✅ Ej commission-beräkning |
| stripe-refund | `stripe-refund/index.ts` | `booking.total_price` | Refund | ✅ OK |
| generate-self-invoice | `generate-self-invoice/index.ts:190-191` | `commission_log.commission_pct \|\| 17`, /100 | Fakturarad | ✅ OK |
| admin-create-company | `admin-create-company/index.ts:59,106,205` | `body.commission_rate ?? 12` | `companies.commission_rate`, `cleaners.commission_rate` | ✅ OK (procent) |
| admin-approve-cleaner | `admin-approve-cleaner/index.ts:148,272` | hårdkod 17 | `cleaners.commission_rate` | ✅ OK (procent) |
| auto-remind emails | `auto-remind/index.ts:119,155,361,673` | Hårdkodad `*0.83` | Email-text | 🟡 **BUG 2** (kosmetisk) |
| notify emails | `notify/index.ts:212,332-333` | Hårdkodad `*0.83` | Email-text | 🟡 **BUG 2** (kosmetisk) |
| admin-UI visning | `admin.html:2378,2558,3501,3514,3629,3941,5467` | `commission_pct \|\| 17` /100. Har försvarskod för mixed format. | Admin-rapporter + edit | ✅ OK (robust) |
| faktura.html | `faktura.html:121,205` | `commission_pct \|\| 17` /100 | Kundfaktura | ✅ OK |
| team-jobb | `team-jobb.html:382-383` | `commission_pct \|\| 17` /100 | Teammedlem-vy | ✅ OK |
| stadare-uppdrag | `stadare-uppdrag.html:637-638` | **FEL FÄLT** — `booking.commission_rate` finns ej på bookings | Städare-vy ersättning | 🔴 **BUG 3** |
| stadare-dashboard | `stadare-dashboard.html:9080,9083` | Hårdkodad `0.12` fallback | Städare-dashboard salary | 🟡 **BUG 4** (kosmetisk) |

**Format-regel:** ALLA värden är procent (17 = 17%). Koden måste konsekvent dividera med 100. Undantag: variabelnamn med `Rate` (t.ex. `commissionRate`) = decimal (0.17) efter /100-konvertering.

**Referensimplementation:** `charge-subscription-booking/index.ts:188-190` är den korrekta implementationen. Kopiera dess mönster:
```ts
const commissionPct = Number(booking.commission_pct) || 17;
const commissionRate = commissionPct / 100;
const applicationFee = Math.round(amountOre * commissionRate);
```

---

## i18n-arkitektur

| Område | Metod | Status |
|--------|-------|--------|
| Frontend UI | Google Translate client-side | 10 språk (11 efter uz-patch P2-2) |
| Välkomstmejl | Hårdkodat trespråkigt (SV + EN + AR) | OK |
| Övriga emails | Endast svenska (`notify/index.ts`) | ⚠️ P2-1 |
| SMS | Endast svenska (`notify/index.ts` + ej-live SMS) | ⚠️ P2-1 |
| DB-fält (notes, customer_notes) | Klartext, ingen översättning | ⚠️ P2-1 |
| Chatmeddelanden städare↔kund | Klartext | ⚠️ P2-1 |

**Vid feature som berör användarkommunikation: Vilket språk går ut? Alltid verifiera.**

**Registrera-stadare.html** har native AR (inte via Google Translate) — asymmetri som INTE ska förvärras.

---

## Autentisering (4 roller)

| Roll | Lagring | Auth-metod | Nyckel-fält |
|------|---------|------------|--------------|
| **Kund** | `customer_profiles` | Supabase Auth OTP-email | `email` PK |
| **Solo-cleaner** | `cleaners` | OTP-email (`otp_code` + `otp_expires_at`) | `company_id IS NULL` |
| **VD** | `cleaners` | Samma OTP | `is_company_owner=true` |
| **Teammedlem** | `cleaners` | Samma OTP | `company_id IS NOT NULL AND is_company_owner=false` |
| **Admin** | `admin_users` (separat tabell) | Supabase Auth | Separat lösenord |

**Regel:** Solo-cleaner + VD + Teammedlem går ALLA genom `cleaners`-tabellen och skiljs åt av `is_company_owner` + `company_id`.

**Vid nya RLS-policies:** Testa mot ALLA 4 rollerna. Behörighetsregression är kritiskt.

---

## Status-fält på cleaners (4 fält, delvis överlappande tillstånd)

| Fält | Default | Används primärt |
|------|---------|-----------------|
| `status` | `'aktiv'` | Admin-UI, `v_cleaners_for_booking` filter |
| `is_active` | `true` | `find_nearby_cleaners` (accepterar `is_active=true OR company_id IS NOT NULL`) |
| `is_approved` | `false` | ALLA bokningsflöden kräver denna true |
| `is_blocked` | `false` | Admin manuell blockering (reserverad, används inte aktivt än) |

**Vid cleaner-deaktivering:** Osäker på vilka fält som ska sättas? Testa mot `v_cleaners_for_booking` — vyn filtrerar `is_approved=true AND status='aktiv'`. Om städaren inte dyker upp där är hen korrekt deaktiverad.

**Inkonsekvens:** `v_cleaners_for_booking` kollar `status='aktiv'` men `find_nearby_cleaners` kollar också `is_active=true`. Följden kan vara att en cleaner visas i listan men inte i radius-sök (eller tvärtom).

---

## Rating/review-arkitektur

- **Primär tabell:** `ratings` — ALLA inserts MÅSTE gå mot denna.
- **Vy:** `reviews` = VY på `ratings`.
- **Felkälla att undvika:** Insert direkt mot `reviews` → RLS-fel eller ingen effekt.

---

## Kända fragmenterade logiker som INTE ska förvärras

### Översättningar (asymmetri)

- `registrera-stadare.html` har **native AR** (inte Google Translate).
- Övriga filer använder Google Translate client-side.
- **Inte synkat** — om AR-texten i registrera-stadare uppdateras måste den ändras manuellt; GT ändras automatiskt.
- Vid språkändring: kolla båda metoder, inte bara en.

### Pricing (se ovan, 14 ställen)

### Commission (se ovan, 32 träffar)

### Status-fält cleaners (4 fält, delvis överlappande)

---

## Checklista för framtida ändringar

Innan du ändrar något som rör pris, commission, auth, status eller översättning:

- [ ] **Pricing:** Kollade alla 14 ställen (se tabell ovan)?
- [ ] **Commission:** Kollade alla 32 träffar? Använde jag referensimplementationen från `charge-subscription-booking`?
- [ ] **Auth:** Testade jag mot alla 4 roller (Kund, Solo, VD, Teammedlem)? Plus Admin?
- [ ] **Status cleaners:** Vilka av de 4 fälten ska sättas? Verifierade via `v_cleaners_for_booking`?
- [ ] **Översättning:** Vilket språk går ut (email/SMS/chat)? Kollade både native AR (registrera) och GT (övriga)?

Om checklistan inte kan besvaras med "ja" → pausa och verifiera.

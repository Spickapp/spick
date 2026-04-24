# 7 — Spick Arkitektur-sanning

> **Syfte:** Registrera platser där samma logik finns på flera ställen i kodbasen.  
> **Vid ändring — kolla ALLA ställen, inte bara en.**  
> **Senast verifierad:** 2026-04-24 via grep + kodläsning + session-spårning.

Detta dokument är den **permanenta referensen** för fragmenterad logik. När framtida Claude-sessioner planerar ändringar i pricing, commission, auth, status eller översättning — **läs denna FÖRST**.

## Auto-genererad källa (§11.4)

För **infrastruktur-inventering** (Edge Functions, databas-views, migrationer) är källan av sanning **[docs/auto-generated/codebase-snapshot.md](auto-generated/codebase-snapshot.md)** — uppdateras veckovis via workflow [`update-claude-md.yml`](../.github/workflows/update-claude-md.yml).

| Fråga | Primärkälla |
|---|---|
| "Hur många Edge Functions finns det nu?" | `codebase-snapshot.md` |
| "Vilka tjänster finns?" | `codebase-snapshot.md` |
| "Vilka migrations har körts?" | `codebase-snapshot.md` + `information_schema`-query |
| "Vilka affärsregler gäller?" | `docs/sanning/*.md` (provision, rut, pnr-och-gdpr) |
| "Vilka kolumner har tabellen X?" | `information_schema`-query mot prod (rule #31) |
| "Vad är latest fas-status?" | `docs/v3-phase1-progress.md` |

Detta dokument (7-ARKITEKTUR-SANNING.md) fokuserar istället på **fragmenterad logik** (pricing på 14 ställen, commission-läsning, status-drift etc) — information som inte genereras av snapshot-scriptet.

> **Status post-Fas 1 (2026-04-22):** 9 av 10 sub-faser klara + §2.7 (19 fix-skript raderade). Många "BUG"-rader i tabellerna nedan är åtgärdade — sök efter "✓ åtgärdat §X.Y"-noteringar. Rader med 🔍-flagga kräver verifiering vid eventuell §2.9b-omräkning. Se [docs/v3-phase1-progress.md](v3-phase1-progress.md) för exakt status per sub-fas.

## Money-layer-referens (NY 2026-04-22)

Sedan §1.1 är `_shared/money.ts` (1798 rader) **single source of truth** för commission/payout/transfer/RUT. Viktiga exports:

| Export | Syfte | Sub-fas |
|---|---|---|
| `getCommission(ctx)` | Hierarkisk commission-lookup mot platform_settings | §1.1 |
| `calculatePayout(booking_id)` | Payout-breakdown med invariant-check | §1.4 |
| `calculateRutSplit(gross, eligible)` | RUT 50% split (Skatteverket-säker Math.floor) | §1.5 |
| `triggerStripeTransfer(booking_id)` | Stripe Transfer + idempotency + reversal | §1.6 |
| `markPayoutPaid(booking_id)` | Stripe-verify + bookings-update + audit | §1.4 |
| `reconcilePayouts()` | DB ↔ Stripe-matchning + 6 mismatch-typer | §1.5 |
| `isMoneyLayerEnabled()` | Feature-flag-helper för callers | §1.1 |

**Frontend-konsumenter:** [`js/commission-helpers.js`](../js/commission-helpers.js) exponerar `getKeepRate()`, `getCommissionRate()`, `getCommissionPct()`, `getDefaultHourlyRate()` (efter `await window.SPICK_COMMISSION_READY` + `SPICK_PRICING_READY`).

**Detaljerad arkitektur:** [docs/architecture/money-layer.md](architecture/money-layer.md) (uppdaterad §1.10 2026-04-22).

---

## Pricing-logik (14 ställen, post-§1.8: reducerade där verifierat)

Pricing hanteras på **14 platser** — 4 skrivande (authoritative), 10 läsande (display). Vid ändring som påverkar pris, verifiera ALLA.

> **Annotation 2026-04-22:** §1.8 centraliserade 13 hardcoded `350`-fallbacks (admin: 9, bli-stadare: 3, join-team: 1) via `getDefaultHourlyRate()`. K3 (subscription-fallback 349) + K4 (CW_SERVICES_CATALOG) orörda — out of scope per beslut. Originalantalet 14 är inte omräknat — exakt antal pricing-ställen = §2.9b hygien-task.

### Authoritative (skriver till DB / Stripe)

| # | Plats | Fil:rad | Läser | Status 2026-04-17 | Risk vid miss |
|---|-------|---------|-------|-------------------|---------------|
| 1 | Frontend preview | [boka.html:2001-2099](../boka.html) | ✅ Korrekt 3-lagers: `use_company_pricing` → `company_service_prices` → `cleaner_service_prices` → `hourly_rate` | OK | Visningsfel (kund ser fel pris) |
| 2 | **Booking insert + Stripe session** | [booking-create/index.ts:183-210](../supabase/functions/booking-create/index.ts) | 🔴 BARA `cleaner_service_prices` + `cleaner.hourly_rate` | **LATENT BUG** — ignorerar `use_company_pricing`. 🔍 verifiera post-§1.2 SUPERSEDED + §1.4 (booking-create:604 bär nu commission-läsning, men pricing-vägen kan vara oförändrad) | DB **OCH** Stripe får fel belopp (konsekvent fel, inte mismatch — men fel jämfört med preview) |
| 3 | Subscription checkout | [setup-subscription/index.ts:96-100](../supabase/functions/setup-subscription/index.ts) | 🟡 BARA `cleaner.hourly_rate` | LATENT — 🔍 verifiera om §1.X-arbete påverkat | Subscription-pris låst till fel värde; auto-rebook kan räkna om med helt annat pris |
| 4 | Manual override (VD/admin) | [booking-create/index.ts:230-253](../supabase/functions/booking-create/index.ts) | `manual_override_price` param + proportionell skalning | OK (explicit override) | Om override < 100 → error |
| 5 | ~~stripe-checkout EF~~ | ~~stripe-checkout/index.ts:112-164~~ | Korrekt 3-lagers — men oanvänd | ❌ **RADERAD 2026-04-21** (§1.2 SUPERSEDED). Verifierat 0 invocations 20 dgr + 0 callers. | – |

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

- ~~**`stripe-checkout` EF kan se ut som pricing-sanning**~~ — raderad 2026-04-21 (§1.2 SUPERSEDED). Använd **`booking-create`** och **`setup-subscription`** som referens.
- **Dag 2-plan:** Skapa `supabase/functions/_shared/pricing-resolver.ts` som gemensam helper. Ersätt #2 och #3. Ta bort #5. `boka.html` (#1) kan exponeras via RPC senare.

### Gemensam helper

- ✓ **EXISTERAR sedan §1.1 (2026-04-20):** [`supabase/functions/_shared/pricing-resolver.ts`](../supabase/functions/_shared/pricing-resolver.ts) — läser `platform_settings.commission_standard` + 5-lagers-pricing-hierarki (commission/payout flyttade till `_shared/money.ts`).
- ✓ **Frontend (sedan §1.9):** [`js/commission-helpers.js`](../js/commission-helpers.js) — `getKeepRate()`, `getCommissionRate()`, `getCommissionPct()`, `getDefaultHourlyRate()` (efter §1.8). Konsumenter: 8 filer per §1.9b + ny scope §1.8 (admin, bli-stadare, join-team).
- 🔍 **`_shared/pricing-engine.ts`** marginal/rabatt/kredit-motor — verifiera om `COMMISSION_STANDARD=17, COMMISSION_TOP=14`-konstanter kvarstår eller ersattes via §1.X (sannolikt kvar — inte i §1.9-konsument-listan).

### Checklista före pricing-ändring

- [ ] Läser koden från `platform_settings`?
- [ ] Hårdkodar koden `0.17`, `0.12`, `0.83`, `0.88`, `349`, `350`, `399`? → FEL, ska läsa platform_settings (350 nytt sedan §1.8).
- [ ] Läser koden `cleaners.commission_rate` eller `companies.commission_rate`? → FEL, fältet ska ignoreras (droppas i §1.10 framtida migration).
- [ ] Använder backend-koden `_shared/money.ts` + `_shared/pricing-resolver.ts`? → JA sedan §1.1.
- [ ] Använder frontend-koden `js/commission-helpers.js`? → JA sedan §1.9 (med `await SPICK_COMMISSION_READY` + `SPICK_PRICING_READY`).

---

## Stripe-integration (VERIFIERAT 2026-04-22)

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

**✅ Raderad EF:**
- ~~**`stripe-checkout`**~~ — raderad 2026-04-21 (§1.2 SUPERSEDED). "stripe_checkout" som sträng används dock som `payment_mode`-värde i `booking-create`.

---

## Commission — 12% överallt (Dag 1-beslut 2026-04-17)

**Affärsmodellen:** 12% provision på ALLA bokningar, oavsett kund-typ eller städare.

**Single source of truth:** `platform_settings.commission_standard = 12`

**Läs så här i kod:**
```typescript
const { data } = await sb.from('platform_settings')
  .select('value')
  .eq('key', 'commission_standard')
  .single();
const commissionPct = parseFloat(data.value);   // 12
const commissionRate = commissionPct / 100;     // 0.12 för Stripe
```

**ALDRIG:** Hårdkoda `0.17`, `0.12`, `17`, `12`, `0.83`, `0.88` som konstanter.

**⚠️ `cleaners.commission_rate` och `companies.commission_rate`** har blandade historiska värden (`17`, `12`, `0.17`, `0`). **Dessa fält ska IGNORERAS av ny kod.** `platform_settings` är sanning. Normaliseras i P1-6 efter P1-1 är fixat.

### Alla 32 ställen där commission hanteras (post-§1.9: reducerade där verifierat)

> **Annotation 2026-04-22:** §1.9b centraliserade frontend-konsumenter via [`js/commission-helpers.js`](../js/commission-helpers.js) (8 filer). §1.7 arkiverade `js/commission.js`. §1.2 raderade `stripe-checkout` EF. §1.4 ersatte `admin.html:markPaid` PATCH med EF. Originalantalet 32 är inte exakt omräknat — exakt antal kvar = §2.9b hygien-task vid behov. Rader nedan med 🔍 kräver grep-verifiering vid omräkning.

| Ställe | Fil | Läsning | Skrivning | Status |
|--------|-----|---------|-----------|--------|
| pricing-engine | `_shared/pricing-engine.ts:5,9` | Konstanter `COMMISSION_STANDARD=17, COMMISSION_TOP=14` (migration-seed) | Returnerar `commissionPct` | 🔍 verifiera om kvar — INTE i §1.9-konsument-listan, sannolikt oförändrad |
| booking-create DB insert | `booking-create/index.ts:330,433` | `pricing.commissionPct` | `bookings.commission_pct` | 🟡 Indirekt — korrekt via pricing-engine. 🔍 verifiera radnummer post-§1.2 SUPERSEDED |
| booking-create Stripe fee | `booking-create/index.ts:497,603` | **HÅRDKODAD 0.17/0.12** | Stripe `application_fee_amount` | 🔴 **BUG 1** — ska läsa `platform_settings`. 🔍 verifiera om §1.4-arbete (markPaid → EF) påverkat. booking-create:604 nämns i [docs/architecture/money-layer.md §2.2](architecture/money-layer.md) som commission-läsare post-§1.2 |
| booking-create commission_log | `booking-create/index.ts:683` | `commissionRate * 100` | `commission_log.commission_pct` | ⚠️ Loggar hårdkodad 17. 🔍 verifiera radnummer + status |
| ~~stripe-checkout~~ | ~~`stripe-checkout/index.ts:74,88,231`~~ | ~~HÅRDKODAD 0.17/0.12~~ | ~~Stripe fee~~ | ✅ **RADERAD 2026-04-21** (§1.2 SUPERSEDED) |
| **charge-subscription-booking** | `charge-subscription-booking/index.ts:188-190` | `booking.commission_pct` /100 | Stripe `application_fee_amount` | ✅ **REFERENSIMPLEMENTATION** — dock läser från booking-raden, inte platform_settings. OK tills vidare. Sedan §1.4: nya referensimplementation är `_shared/money.ts::calculatePayout()` |
| stripe-webhook | `stripe-webhook/index.ts` | — | Ingen commission-beräkning | ✅ Ej commission |
| stripe-refund | `stripe-refund/index.ts` | `booking.total_price` | Refund | ✅ OK |
| generate-self-invoice | `generate-self-invoice/index.ts:190-191` | `commission_log.commission_pct \|\| 17` /100 | Fakturarad | ✅ OK (historisk-robust) |
| admin-create-company | `admin-create-company/index.ts:59,106,205` | `body.commission_rate ?? 12` | `companies.commission_rate` | 🟡 Skriver till fält som ska ignoreras — droppas §1.10 framtida migration |
| admin-approve-cleaner | `admin-approve-cleaner/index.ts:148,272` | hårdkod 17 | `cleaners.commission_rate` | 🟡 Samma — droppas §1.10 framtida migration |
| auto-remind emails | `auto-remind/index.ts:119,155,361,673` | Hårdkodad `*0.83` | Email-text | 🟡 **BUG 2** — 🔍 verifiera om §1.X-arbete täckt. INTE i §1.9-konsument-listan |
| notify emails | `notify/index.ts:212,332-333` | Hårdkodad `*0.83` | Email-text | 🟡 **BUG 2** — 🔍 verifiera. INTE i §1.9-konsument-listan |
| admin-UI visning | `admin.html:2378,2558,3501,3514,3629,3941,5467` | `commission_pct \|\| 17` /100 + försvarskod för mixed format | Admin-rapporter | ✅ **Centraliserad §1.9b** via `getCommissionPct()`. 17-fallback bevarad som defensive (legacy-data). Plus admin commission-hardcodes vid `:1119` (`value="12"`) + `:3763` (`: 17`) flaggade som §1.9c-läckage-task |
| faktura.html | `faktura.html:121,205` | `commission_pct \|\| 17` /100 | Kundfaktura | ✅ **Centraliserad §1.9b** via `getCommissionPct()` |
| team-jobb | `team-jobb.html:382-383` | `commission_pct \|\| 17` /100 | Teammedlem-vy | ✅ **Centraliserad §1.9b** via `getCommissionPct()` |
| stadare-uppdrag | `stadare-uppdrag.html:637-638` | **FEL FÄLT** — `booking.commission_rate` finns ej | Städare-vy | 🔴 **BUG 3** — 🔍 verifiera om §1.9b centraliserade fixade detta (filen är §1.9b-konsument). Ursprunglig BUG-text behålls tills grep-verifiering |
| stadare-dashboard | `stadare-dashboard.html:9080,9083` | Hårdkodad `0.12` fallback | Salary-översikt | 🟡 **BUG 4** — 🔍 verifiera. §1.7-läckage-fix tog rad 9182 (`getCommissionRate`-helper införd där). Rad 9080,9083 separat — kan kvarstå |

**Post-Dag 2 referensimplementation (i pricing-resolver):**
```ts
const { data: settings } = await sb.from('platform_settings')
  .select('value').eq('key', 'commission_standard').single();
const commissionPct = parseFloat(settings.value);    // 12
const commissionRate = commissionPct / 100;          // 0.12
const applicationFee = Math.round(amountOre * commissionRate);
```

**Läs-från-booking-mönster (bakåtkompatibelt för historiska rader):**
```ts
// När booking redan har commission_pct lagrad (historiska)
const commissionPct = Number(booking.commission_pct) || 12;  // fallback 12 efter 2026-04-17
const commissionRate = commissionPct / 100;
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

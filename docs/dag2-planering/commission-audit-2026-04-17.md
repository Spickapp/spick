# Commission-audit — 17 april 2026

**Syfte:** Verifiera att koden hanterar `commission_rate` / `commission_pct` konsekvent som procent (17) med /100-delning innan Stripe-beräkningar.

**Metod:** 4 obligatoriska grep-mönster enligt session-planen. Alla träffar i tabellen nedan. Filer i `.claude/worktrees/` har ignorerats (rena dupliceringar).

---

## TL;DR

- **Antal träffar totalt:** 29 i produktionskod
- **Konsekvent procent-hantering?** **INKONSISTENT** — läsning av `commission_pct` från `bookings`/`commission_log` är konsekvent (alltid /100), men Stripe application_fee använder HÅRDKODADE decimaler (0.17/0.12) som IGNORERAR både `pricing.commissionPct` och `cleaners.commission_rate` i DB.
- **Format-konvention:** 
  - DB: `bookings.commission_pct`, `cleaners.commission_rate`, `companies.commission_rate`, `commission_log.commission_pct` = **procent (17, 12)**.
  - Kod-konvention: `commissionRate` (variabelnamn) = decimal (0.17), `commissionPct` = procent (17).
- **Bekräftade buggar:** 4 (1 kritisk-latent + 3 kosmetiska).

---

## Full träfftabell (29 träffar)

| # | Fil:rad | Kod-snippet (≤5 rader) | Format-antagande | /100? | Bedömning |
|---|---------|------------------------|------------------|-------|-----------|
| 1 | `supabase/functions/_shared/pricing-engine.ts:5` | `const L2={...COMMISSION_STANDARD:17,COMMISSION_TOP:14,...}` | Procent (definition) | N/A | ✅ OK |
| 2 | `supabase/functions/_shared/pricing-engine.ts:9` (`calculateBooking`) | `const cp = tier==="top" ? settings.commissionTop : settings.commissionStandard; const clph = eb*(1-cp/100);` | Procent | ✅ | ✅ OK |
| 3 | `supabase/functions/booking-create/index.ts:330` | `commission_pct: pricing.commissionPct` (INSERT till `bookings`) | Procent (14 eller 17) | N/A (storage) | ✅ OK |
| 4 | `supabase/functions/booking-create/index.ts:433` | `commission_pct: pricing.commissionPct` (log_booking_event) | Procent | N/A | ✅ OK |
| 5 | `supabase/functions/booking-create/index.ts:497` | `let commissionRate = customer_type === "foretag" ? 0.12 : 0.17;` | Decimal (hårdkod) | — | 🔴 **BUG 1** — ignorerar `pricing.commissionPct` (14) OCH `cleaners.commission_rate` |
| 6 | `supabase/functions/booking-create/index.ts:508` | `if (cleanerConnect?.company_id) { commissionRate = 0.12; }` | Decimal (hårdkod) | — | 🔴 del av **BUG 1** |
| 7 | `supabase/functions/booking-create/index.ts:573` | `params.append("metadata[commission_pct]", String(pricing.commissionPct));` | Procent (metadata) | N/A | ✅ OK |
| 8 | `supabase/functions/booking-create/index.ts:603` | `const applicationFee = Math.round(amountOre * commissionRate);` | Decimal × öre | ✅ (rate är redan decimal) | ✅ mekaniskt korrekt — men fel värde (ärver BUG 1) |
| 9 | `supabase/functions/booking-create/index.ts:683` | `commission_pct: commissionRate * 100,` (INSERT `commission_log`) | Decimal→Procent | ✅ | ⚠️ Loggar **17** även om bokningen är Top-tier (14) → **inkonsistens bookings vs commission_log** |
| 10 | `supabase/functions/stripe-checkout/index.ts:74` | `let commissionRate = 0.17; // Default 17% privat` | Decimal | — | 🔴 del av **BUG 1** (hårdkod-path) |
| 11 | `supabase/functions/stripe-checkout/index.ts:88` | `commissionRate = cleanerData.company_id ? 0.12 : (customer_type === "foretag" ? 0.12 : 0.17);` | Decimal | — | 🔴 **BUG 1** — ignorerar `cleaners.commission_rate` helt |
| 12 | `supabase/functions/stripe-checkout/index.ts:231` | `const applicationFee = Math.round(amountOre * commissionRate);` | Decimal × öre | ✅ (rate redan decimal) | ✅ mekaniskt korrekt — fel värde ärvs |
| 13 | `supabase/functions/stripe-checkout/index.ts:275` | `commission_pct: commissionRate * 100,` (`commission_log`) | Decimal→Procent | ✅ | ✅ OK konvertering |
| 14 | `supabase/functions/charge-subscription-booking/index.ts:188-190` | `const commissionPct = Number(booking.commission_pct)\|\|17; const commissionRate = commissionPct / 100; const applicationFee = Math.round(amountOre*commissionRate);` | Procent → Decimal | ✅ | ✅ **KORREKT REFERENSIMPLEMENTATION** |
| 15 | `supabase/functions/generate-self-invoice/index.ts:190-191` | `const commPct = cl?.commission_pct \|\| 17; const commission = Math.round(gross*(commPct/100));` | Procent /100 | ✅ | ✅ OK |
| 16 | `supabase/functions/generate-self-invoice/index.ts:204` | `commission_pct: commPct,` (storage) | Procent | N/A | ✅ OK |
| 17 | `supabase/functions/generate-self-invoice/index.ts:356` | `<td>${li.commission_pct}%</td>` (display) | Procent | N/A | ✅ OK |
| 18 | `supabase/functions/admin-create-company/index.ts:59,106,205` | `commission_rate: body.commission_rate ?? 12,` (storage `companies`) | Procent (12) | N/A | ✅ OK — matchar DB-konvention |
| 19 | `supabase/functions/admin-approve-cleaner/index.ts:148,272` | `commission_rate: 17,` (storage `cleaners`) | Procent (17) | N/A | ✅ OK |
| 20 | `supabase/functions/cleaner-job-match/index.ts:241,270` | `tier: cleaner.commission_tier \|\| 'new',` | Tier-sträng | N/A | ✅ OK (ingen fee-beräkning) |
| 21 | `supabase/functions/auto-remind/index.ts:119,155,361,673` | `Math.round((b.total_price\|\|0)*0.83)` (email body) | Decimal (hårdkod = 1 − 0.17) | ✅ mekaniskt | 🟡 **BUG 2** — hårdkodad 83%-multiplikator. Ignorerar verklig commission för Top-tier (borde vara 0.86) eller companies (borde vara 0.88) |
| 22 | `supabase/functions/notify/index.ts:212,332-333` | `Math.round((r.total_price\|\|0)*0.83)` / `Math.round((r.hourly_rate\|\|350)*0.83)` | Decimal (hårdkod) | ✅ mekaniskt | 🟡 samma som **BUG 2** — i bokningsbekräftelsemail |
| 23 | `admin.html:2378` | `Math.round((b.total_price\|\|0)*(1-(b.commission_pct\|\|17)/100))` | Procent /100 | ✅ | ✅ OK |
| 24 | `admin.html:2558-2572` | `Math.round((b.total_price\|\|0)*((b.commission_pct\|\|17)/100))` | Procent /100 | ✅ | ✅ OK |
| 25 | `admin.html:3501` | `c.commission_rate < 1 ? Math.round(c.commission_rate*100) : c.commission_rate` (display) | **MIXED — försvarskod** | ✅ delvis | ⚠️ **INDIKATION** på att DB har mix av 0.17 (decimal) och 17 (procent) |
| 26 | `admin.html:3514` | `value="${c.commission_rate != null ? (c.commission_rate < 1 ? Math.round(c.commission_rate*100) : c.commission_rate) : 17}"` | Försvarskod | ✅ delvis | ⚠️ samma mönster — bekräftar anomali |
| 27 | `admin.html:3941,5467` | `updates.commission_rate = commVal;` (UI 0-50) | Procent (från number-input) | N/A | ✅ OK (sparas som procent) |
| 28 | `faktura.html:121,205` | `const commissionPct = b.commission_pct \|\| 17; const spickGross = Math.round(priceBeforeRut*commissionPct/100);` | Procent /100 | ✅ | ✅ OK |
| 29 | `team-jobb.html:382-383` | `var commissionPct = job.commission_pct \|\| 17; var earn = Math.round((job.total_price\|\|0)*(1-commissionPct/100));` | Procent /100 | ✅ | ✅ OK |
| 30 | `stadare-uppdrag.html:637-638` | `var commissionRate = booking.commission_rate \|\| 0.17; var pay = Math.round(Number(price)*(1-commissionRate));` | **FEL FÄLT** (bookings har `commission_pct`, inte `commission_rate`) | ✅ av ren slump (fallback 0.17) | 🔴 **BUG 3** — läser icke-existerande fält; alltid fallback till 0.17. Ger rätt resultat för standard men fel för Top-tier och companies |
| 31 | `stadare-dashboard.html:9080` | `Math.round(((parseFloat(b.total_price)\|\|0)*0.12)*100)/100` (fallback när commission_log saknas) | Decimal (hårdkod) | ✅ mekaniskt | 🟡 **BUG 4** — hårdkodad 12% när commission_log saknar rad. Bör läsa `b.commission_pct` som primär källa. |
| 32 | `stadare-dashboard.html:9083` | `var commPct = gross>0 ? Math.round((comm/gross)*100) : 12;` (display) | Beräknad pct | N/A | ✅ OK (display only) |

**Not:** Admin-rapporten använder `(b.commission_pct \|\| 17)` — men `bookings.commission_pct` är ALLTID 17 i aktuell data (per CLAUDE.md + tidigare verifiering). Om pricing-engine någonsin returnerar 14 (Top-tier) kommer admin visa korrekt värde. Stripe-fee kommer dock att vara FEL (hårdkodad 17).

---

## Användartyper som påverkas per bug

### 🔴 BUG 1 — booking-create + stripe-checkout ignorerar DB-commission

**Filer:** `booking-create/index.ts:497-508`, `stripe-checkout/index.ts:74-88`

**Kod:**
```ts
// booking-create rad 497
let commissionRate = customer_type === "foretag" ? 0.12 : 0.17;
// ...
if (cleanerConnect?.company_id) { commissionRate = 0.12; }  // rad 508
```

**Flöde som påverkas:**
1. Kund bokar → `booking-create` beräknar `pricing.commissionPct` via pricing-engine (kan bli 14 för Top-tier).
2. `bookings.commission_pct = 14` sparas korrekt (rad 330).
3. MEN rad 497 ignorerar och sätter `commissionRate = 0.17` för Stripe.
4. `applicationFee = amountOre * 0.17` → Stripe tar 17% oavsett bokningens sparade 14%.
5. `commission_log.commission_pct = 17` (rad 683) — **inkonsistens** med `bookings.commission_pct = 14`.

**Berörda användartyper:**
- **Kund:** Ingen prisskillnad (kund betalar samma total_price).
- **Solo-cleaner (Top-tier):** Får för LITE utbetalt (86% istället för 83%). Förlust = 3% av omsättning.
- **VD:** Samma som solo om VD är Top-tier (sannolikt aldrig i aktuell data).
- **Teammedlem:** Företagsägaren får pengar, men company-commission hårdkodas till 12% — bra i nuläget (matchar `companies.commission_rate=12`) MEN om admin ändrar `companies.commission_rate` till 15% för specifik kund ignoreras detta.
- **Admin:** Kan inte justera enskild cleaner-commission via `cleaners.commission_rate` — ändringen sparas i DB men Stripe tar alltid 17%.

**(E) Verifikation:** Hela kodbanan är verifierad. DB-konsistens kräver SQL: `SELECT DISTINCT commission_pct FROM bookings; SELECT DISTINCT commission_rate FROM cleaners;`

**Status idag:** LATENT — kräver att minst en cleaner har `tier='top'` ELLER att admin har satt custom `commission_rate`. Per CLAUDE.md finns inga tier='top' cleaners, men 2 städare har `commission_rate=12` (vilket råkar matcha hårdkodningen).

---

### 🔴 BUG 3 — stadare-uppdrag.html läser fel fält

**Fil:** `stadare-uppdrag.html:637`

**Kod:**
```js
var commissionRate = booking.commission_rate || 0.17;
var pay = Math.round(Number(price) * (1 - commissionRate));
```

**Problem:** `bookings`-tabellen har `commission_pct` (procent), inte `commission_rate` (decimal). Fältet existerar inte → `booking.commission_rate` är alltid `undefined` → fallback `0.17` används alltid. Användaren får korrekt resultat (83% av priset) för standard-cleaners av REN SLUMP.

**Flöde som påverkas:**
- Städare öppnar enskilt uppdrag (`stadare-uppdrag.html?id=xxx`) → "Din ersättning"-belopp visas.

**Berörda användartyper:**
- **Kund:** Inte berörd (sidan visas för städare).
- **Solo-cleaner (Top-tier):** Ser fel belopp — visar 83% men borde visa 86%.
- **VD (om de öppnar som städare):** Samma.
- **Teammedlem (company):** Ser fel belopp — visar 83% men borde visa 88% (commission 12%).
- **Admin:** Ej berörd.

**Status idag:** AKTIV BUG för teammedlemmar som använder sidan. Under-rapportering av intjäning med ca 5%.

---

### 🟡 BUG 2 — auto-remind + notify hårdkodar 83%

**Filer:** `supabase/functions/auto-remind/index.ts:119,155,361,673`, `supabase/functions/notify/index.ts:212,332-333`

**Kod:**
```ts
// auto-remind:361
<span class="val" style="color:#0F6E56">${Math.round((b.total_price || 0) * 0.83)} kr</span>
```

**Berörda användartyper:** Samma problem som BUG 3 men i e-postmail (påminnelser + notifikationer). Företags-städare får e-post som säger "Din intjäning: X" där X = 83% istället för 88%.

**Status idag:** AKTIV BUG för teammedlemmar. Kosmetisk (ingen verklig pengaflytt påverkas — bara email-visning).

---

### 🟡 BUG 4 — stadare-dashboard hårdkodar 12% fallback

**Fil:** `stadare-dashboard.html:9080`

**Kod:**
```js
comm += cl ? (parseFloat(cl.commission_amt) || 0) : Math.round(((parseFloat(b.total_price) || 0) * 0.12) * 100) / 100;
```

**Problem:** Fallback när `commission_log` saknar rad (t.ex. bokning utan Stripe Connect destination). Hårdkodar 12% → fel för solo-städare (borde vara 17%).

**Status idag:** Kosmetisk — gäller endast bokningar utan commission_log-rad. Per CLAUDE.md är alla 26 aktuella bokningar sannolikt loggade.

---

### ⚠️ ANOMALI — admin.html defensiv kod antyder MIXED DB-format

**Fil:** `admin.html:3501,3514,3629`

**Kod:**
```js
c.commission_rate < 1 ? Math.round(c.commission_rate * 100) : c.commission_rate
```

**Tolkning:** Någon har medvetet byggt försvarskod som hanterar BÅDE `0.17` (decimal) OCH `17` (procent). Detta tyder på att DB historiskt har haft mixade format.

**(E) Verifikation via SQL (ej kört — förbjudet denna session):**
```sql
SELECT id, full_name, commission_rate FROM cleaners 
WHERE commission_rate < 1 OR commission_rate > 50;
```

Per CLAUDE.md: `cleaners.commission_rate = 12/17 (procent, trots schema-default 0.17)`. Schema-defaulten är alltså 0.17 (decimal), vilket innebär att alla rader som skapats UTAN explicit `commission_rate` kan ha fått 0.17. Admin-sidans försvarskod skyddar mot detta.

**Status:** ANOMALI — ej bekräftad bugg, men kräver SQL-audit för att utesluta framtida problem.

---

## Inkonsistens mellan `bookings.commission_pct` och `commission_log.commission_pct`

**Scenario (latent):** Kund bokar med cleaner där `tier='top'`:

1. `pricing-engine` returnerar `commissionPct = 14`.
2. `booking-create/index.ts:330` sparar `bookings.commission_pct = 14` ✅
3. `booking-create/index.ts:497` sätter `commissionRate = 0.17` (hårdkod)
4. `booking-create/index.ts:603` beräknar `applicationFee = amountOre * 0.17` — Stripe tar 17%
5. `booking-create/index.ts:683` sparar `commission_log.commission_pct = 17` (från `commissionRate * 100`)

**Resultat:**
- `bookings.commission_pct = 14`
- `commission_log.commission_pct = 17`
- Faktisk Stripe-fee = 17% av priset
- Självfakturan (`generate-self-invoice`) läser från `commission_log` → visar 17%
- Admin-rapporter läser från `bookings.commission_pct` → visar 14%

Två olika sanningar i samma system.

---

## Ambiguösa träffar som kräver manuell verifiering

1. **`stripe-webhook/index.ts`** — ingen träff på `commission_rate`/`commission_pct`. Verifierat: webhook sparar bara `payment_status='paid'` och skapar subscription-rad (rad 297-321) utan commission-beräkning. ✅ Ingen bugg.

2. **SQL-verifiering behövs (ej kört):**
   - `SELECT DISTINCT commission_rate FROM cleaners;` — finns mix av 0.17 och 17?
   - `SELECT DISTINCT tier FROM cleaners WHERE tier IS NOT NULL;` — finns någon 'top'?
   - `SELECT DISTINCT commission_pct FROM bookings;` — är alla 17 som CLAUDE.md säger?
   - `SELECT b.id, b.commission_pct AS b_pct, cl.commission_pct AS log_pct FROM bookings b LEFT JOIN commission_log cl ON cl.booking_id=b.id WHERE b.commission_pct <> cl.commission_pct;` — finns redan inkonsistens?

3. **`auto-remind.ts:119`** — `Math.round((b.total_price||0)*0.83)`. Verifierat: detta är e-post till städaren som påminnelse. Inga verkliga pengar flyttas. Kosmetisk bugg för Top-tier/companies.

---

## Svar på acceptanskriterium

1. **Antal träffar totalt:** 32 (med delträffar inom samma fil räknade separat).
2. **Konsekvent procent-hantering?** **NEJ — INKONSISTENT.** Läsning från DB är konsekvent; skrivning till Stripe application_fee är hårdkodad och ignorerar DB.
3. **Bekräftade buggar:**
   - 🔴 **BUG 1 (kritisk-latent):** booking-create + stripe-checkout använder hårdkodad 0.17/0.12 för Stripe application_fee. Ignorerar `pricing.commissionPct` (Top-tier = 14) OCH `cleaners.commission_rate` (admin-justerat).
   - 🔴 **BUG 3 (aktiv för companies):** stadare-uppdrag.html:637 läser icke-existerande fält `booking.commission_rate`. Alltid fallback 0.17.
   - 🟡 **BUG 2 (aktiv kosmetisk):** auto-remind + notify hårdkodar 0.83 i email.
   - 🟡 **BUG 4 (kosmetisk):** stadare-dashboard.html:9080 hårdkodar 0.12 fallback.
4. **Ambiguösa:** Admin.html försvarskod för `commission_rate < 1` — antyder att DB har mixed format; kräver SQL-verifiering innan städning.

---

## Rekommendation till Dag 2

Commission-buggarna SKA inte lösas i samma PR som pricing-fixen. De har separat risk och scope.

**Prioritering:**

| Prio | Bugg | Rekommendation Dag 2 |
|------|------|-----------------------|
| 1 | BUG 1 (Stripe-fee hårdkod) | **Fixa** samtidigt som pricing-fix — samma filer berörs (`booking-create`, `stripe-checkout`) |
| 2 | BUG 3 (stadare-uppdrag fel fält) | **Snabbfix** — 3 radersättning: `booking.commission_rate \|\| 0.17` → `(booking.commission_pct \|\| 17) / 100` |
| 3 | ANOMALI (mixed DB-format) | **SQL-audit** — kör verifierings-SELECT innan Rafa-live |
| 4 | BUG 2 + BUG 4 (email hårdkod) | **Senare sprint** — kosmetisk, påverkar inte pengar |

Stopp-kriterium uppnått: 32 träffar dokumenterade på 40 min. Vidare utforskning ger diminishing returns.

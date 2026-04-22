# Audit: Modell C — flexibel matchning & multi-cleaner

**Datum:** 2026-04-26 (påföljd till [Modell B-audit](2026-04-26-foretag-vs-stadare-modell.md))
**Status:** DESIGN · ej implementerad
**Initierad av:** Farhads frågor efter Modell B-infrastruktur:
> "En fördel är att man kan välja städarna. Dessutom kanske ett jobb kräver fler än en städare. Man kanske önskar boka en städare från företaget och inte vill att företaget bestämmer. Alla betyg och omdömen syns om företaget och dess städare. Tjänster/städare/extra tillägg/större jobb matchas mot kundens önskemål."

**Ramverk:** Regler #26–#31. Primärkälla före design (regel #31).

---

## 1. Sammanfattning

Modell B (8 commits i dag: `7b32fc7` → `6c9e05c`) etablerade **företag som aggregat av aktiva städare**. Modell C bygger vidare genom att ge kunden fler val inom företag:

- Välja **specifik team-medlem** från ett företag (inte bara "någon från teamet")
- Beställa **multi-cleaner-bokning** för större jobb (t.ex. flyttstäd med 2 städare)
- Se **betyg per team-medlem** + **aggregerat för företaget**
- Kombinera **tjänst + extra tillägg + team-storlek** som matchings-kriterier

**Kärninsikt från research:** `booking_team`-tabellen finns redan (14 kolumner inkl. customer_approved, status, checkin_per-cleaner). Multi-cleaner-flödet är förberett på DB-nivå men oanvänt.

---

## 2. Primärkälla-research (verifierat 2026-04-26)

| Tabell | Rader | Syfte | Status |
|---|---|---|---|
| `bookings` | 46 | Kärnbokning · `cleaner_id` = primär-cleaner (singular) | Live, används dagligen |
| `booking_team` | **0** | Multi-cleaner: kollega/ersättare bjuds in till en bokning | **Schema finns, oanvänd** |
| `ratings` | **0** | Kund-rating per cleaner (`cleaner_id`) | **Tom — ingen rating-data än** |
| `service_addons` | 1 | Tillägg per tjänst (key, label, price_sek) | Skelett, 1 test-rad |
| `cleaner_booking_prefs` | 0 | Cleaner-inställningar (accepts_recurring/one_time) | Oanvänd |

### 2.1 `booking_team`-schema (redan deployad)

```
id                        uuid (PK)
booking_id                uuid (FK → bookings)
cleaner_id                uuid (FK → cleaners)  -- den kollega som bjuds in
invited_by                uuid                  -- cleaner-id som bjöd in
status                    text                  -- t.ex. pending, accepted, declined
customer_approved         boolean               -- kund får godkänna team-utökning
invite_sent_at            timestamptz
colleague_responded_at    timestamptz
customer_responded_at     timestamptz
checkin_lat, checkin_lng  double precision      -- per-cleaner geo-checkin
checkin_time              timestamptz           -- per-cleaner arbetstid
checkout_time             timestamptz
created_at                timestamptz
```

**Design-intention (härledd från schema):**
1. Primär cleaner tar bokning via `bookings.cleaner_id`
2. Vid behov av extra händer: cleanern bjuder in kollega → `booking_team`-rad skapas med `status='pending'`
3. Kollega accepterar → `colleague_responded_at` sätts
4. Kund godkänner tilläggs-cleaner → `customer_approved=true`
5. Båda städar → var och en registrerar egen `checkin_time` och `checkout_time`

Detta är en **SUBSTITUTE/COLLEAGUE**-flöde. Inte ursprunglig multi-cleaner-boking (där kund bokar "2 städare samtidigt"). Men kan utökas till det.

### 2.2 `service_addons`-schema

```
id             uuid
service_id     uuid (FK → services)
key            text  -- t.ex. "fonsterputs_extra", "ugnsrengoring"
label_sv       text  -- "Fönsterputs extra"
label_en       text
price_sek      integer
display_order  integer
active         boolean
```

**Saknas i schema:** koppling mellan addon och cleaner (kan städaren utföra tillägget?). Idag antas att om cleaner kan huvudtjänsten kan hen alla tillägg.

### 2.3 `ratings`-tabell är tom

0 rader idag. Alla aggregat-beräkningar (avg_rating, review_count på cleaners) är NULL eller 0.
Konsekvens: Model-4a's `aggregate_rating`-fält är alltid NULL idag. Rating-relaterade design-beslut kan göras utan att bryta data.

---

## 3. Fem matchnings-nivåer (designmodell)

Modell C definierar **fem nivåer** av kundens beslut. Nivå 1–2 finns redan (Modell B), 3–5 är nya.

| Nivå | Kundens val | UX | DB-konsekvens | Status |
|---|---|---|---|---|
| **1. Solo direkt** | "Jag vill ha Farhad (solo)" | Kortet på boka.html | `bookings.cleaner_id = Farhad.id` | ✅ Live |
| **2. Företag, någon från teamet** | "Solid Service väljer" | Företagskort → klick | `bookings.cleaner_id = VD` → auto-delegate till team | ✅ Live (Modell B) |
| **3. Expandera team** | "Visa mig städarna hos Solid Service" | Klick på företagskort → team-drawer visar individer | Ej mutation — bara UI | ⏳ Ny (Sprint C-1) |
| **4. Välja specifik team-medlem** | "Jag vill ha Nasiba från Solid Service" | Team-drawer → klick på Nasiba → booking direkt | `bookings.cleaner_id = Nasiba.id`, `company_id = Solid Service` | ⏳ Ny (Sprint C-2) |
| **5. Multi-cleaner-bokning** | "Jag vill ha 2 städare från Solid Service för min flyttstäd" | Team-drawer → checkbox flera → "Boka grupp" | `bookings.cleaner_id = primary` + `booking_team`-rader för övriga | ⏳ Ny (Sprint C-3) |

### 3.1 Nivå 3 — expandera team

På boka.html, när kund klickar på ett company-provider-kort ("Solid Service"):
- Kortet expanderar till en **team-drawer**
- Visar 4 individ-kort (Nasiba, Nilufar, Dildora, Odilov) med bilder, betyg, specialiteter
- Längst upp: "Låt Solid Service välja åt mig" (= nivå 2)
- Alternativt: klick på specifik städare → nivå 4

**Idag** har `foretag.html` (/f/<slug>) denna team-scroll, men boka.html visar bara VD.

**Implementation Sprint C-1:**
- boka.html: när cleaner-kort är provider_type='company' → "Expandera team →"-knapp
- Ny team-drawer-komponent som fetchar team via `v_cleaners_public?company_id=eq.X`
- Knapp per team-medlem: "Boka [namn] →"
- Knapp ovanför: "Låt företaget välja →" (default Modell B)

### 3.2 Nivå 4 — specifik team-medlem

När kund klickar "Boka Nasiba →":
- `boka.html?cleaner_id=<nasiba_id>&company=<solid_id>` — URL-fragment
- boka.html steg 3 visar: "Du har valt Nasiba (från Solid Service)"
- Booking-create sätter `cleaner_id = nasiba_id`, `company_id = solid_id`
- Stripe-transfer går till VD:ns konto (oförändrat)
- Nasiba får notifikation direkt (ingen auto-delegation)

**Riskobservation:** Om Nasiba är fullbokad den tiden → booking-create ska varna innan betalning. Redan hanterat via `cleaner_availability_v2`.

### 3.3 Nivå 5 — multi-cleaner

**Use-case:** Flyttstäd av 3-rumslgh på 80 kvm, kund vill ha klart inom 2 timmar → behöver 2 städare samtidigt.

**Designförslag:**

1. Kund ser team-drawer för Solid Service
2. Kryssar i checkbox för 2 städare (Nasiba + Dildora)
3. Klickar "Boka grupp (2 städare) →"
4. boka.html visar: "Bokar Nasiba + Dildora från Solid Service · pris = MAX(cleaner rates) × hours × 2"
5. Booking-create:
   - Skapar `bookings`-rad med `cleaner_id = Nasiba` (primär)
   - Skapar `booking_team`-rad: `(booking_id, cleaner_id=Dildora, invited_by=Nasiba, status='pending', customer_approved=true)`
   - Båda får notifikationer
6. Stripe-transfer fördelad:
   - 50/50 mellan cleaners (eller MAX_priceshare)
   - VD:ns konto tar emot totalen, distribuerar internt

**Pris-modell för multi:**
- Option A: `per_cleaner_rate × hours × team_size` (additiv)
- Option B: `max(rates) × hours × team_size × 0.9` (rabatt för team)
- Option C: `per_cleaner_rate × hours` (samma pris — team splittar insatsen)
- **Rekommendation:** Option A för tydlighet. Kund vet att 2 städare = 2x pris.

**Tid-modell:** Båda städar SAMMA tid (inte sekvensiellt). Booking har EN `booking_time` och `booking_hours`.

**Schema-ändring behövs?**
Nej! `booking_team`-schemat räcker. `status`-kolumn kan ha värden: `pending`, `accepted_by_colleague`, `accepted_by_customer`, `active`, `completed`, `declined`.

**Implementation Sprint C-3:**
- boka.html multi-select-UI
- booking-create stödjer `team_cleaner_ids: uuid[]` parameter
- Pris-logik i pricing-resolver (multiplikator för team_size)
- Notifikations-flöde för team-invite
- Ny EF `cleaner-team-response` för accept/decline

---

## 4. Addon-matching (tjänst + tillägg)

### 4.1 Nuvarande state

`service_addons`-tabell finns men bara 1 test-rad. `bookings` har ingen kolumn för valda addons. Matching i `find_nearby_providers` filtrerar inte på addon-capabilities.

### 4.2 Designförslag

**DB-tillägg (Sprint C-4):**

```sql
-- Vilka addons kan en cleaner utföra? (default: alla för cleaner's services)
CREATE TABLE cleaner_addon_capabilities (
  cleaner_id uuid REFERENCES cleaners(id),
  addon_id   uuid REFERENCES service_addons(id),
  can_perform boolean DEFAULT true,
  PRIMARY KEY (cleaner_id, addon_id)
);

-- Vilka addons valde kunden för en bokning?
ALTER TABLE bookings ADD COLUMN selected_addons jsonb DEFAULT '[]';
-- Format: [{ addon_id, price_sek_snapshot, key_snapshot }]
```

**UX-flöde:**
1. Kund väljer tjänst (Hemstädning)
2. Kund expanderar "Tillägg →" → ser lista från `service_addons`:
   - Fönsterputs extra · +200 kr
   - Ugnsrengöring · +150 kr
   - Balkong · +100 kr
3. Kryssar i önskade
4. Matching (providers-RPC) filtrerar på:
   - Cleaner har tjänsten (som idag)
   - Cleaner kan utföra alla valda addons (via `cleaner_addon_capabilities`)
5. Pris = basepris + summa av addons

**Fallback:** Om inga addon-capabilities finns för cleaner → anta att hen kan alla sina services' addons.

### 4.3 Integration med multi-cleaner

Om bokning har både multi-cleaner OCH addons:
- ALLA team-medlemmar måste kunna alla valda addons
- Eller: vissa addons utförs av specifik team-medlem (komplext — skip för nu)
- **Rekommendation:** kräver att alla kan alla addons. Enkelt.

---

## 5. Betyg-synlighet: individuellt + aggregerat

### 5.1 Nuvarande state

`ratings.cleaner_id` är FK till cleaners — individ-rating. 0 rader idag.

### 5.2 Designförslag

**Tre vy-lager:**

1. **Individ-profil (/s/<slug>):** `SELECT * FROM ratings WHERE cleaner_id = X` — dagens pattern
2. **Företags-profil (/f/<slug>):**
   - Aggregerat: viktat snitt över team (Model-4a har det redan: `SUM(avg_rating * review_count) / SUM(review_count)`)
   - Individuellt: klick på team-medlem → /s/<slug> visar hens ratings
3. **Matching-lista (boka.html):**
   - Företag-kort: aggregate_rating (från providers-RPC)
   - Solo-kort: avg_rating (från providers-RPC som identifier)

**Inga schema-ändringar behövs.** Aggregat-logik finns i Model-4a.

### 5.3 Företags-nivå rating i framtiden?

Om önskat kan `companies.aggregate_rating`-kolumn beräknas via materialized view + cron. Men idag räcker live-aggregering. Latency är OK (<50ms per Prof-1-verifiering).

---

## 6. Sprint-plan för Modell C

| Sprint | Omfång | Tid | Risk |
|---|---|---|---|
| **C-1** | Team-drawer på boka.html (nivå 3) | 3-4h | Medel (UI-komponent) |
| **C-2** | ?cleaner_id=-pre-select (nivå 4) | 1-2h | Låg (URL-parsing finns) |
| **C-3** | Multi-cleaner-bokning via `booking_team` (nivå 5) | 6-8h | Hög (booking-create, pricing, notifikationer) |
| **C-4** | Addon-matching (cleaner_addon_capabilities + selected_addons) | 4-5h | Medel (nya tabeller + matching-filter) |
| **C-5** | Rating-aggregat i VIEW (performance) | 2-3h | Låg |

**Totalt:** ~16-22h. Men oberoende — kan göras i vilken ordning som helst.

### 6.1 Rekommenderad ordning

1. **Först C-2** (pre-select via URL). Låg risk, förberedelse för Modell B-rollout.
2. **Sen C-1** (team-drawer). Aktiverar nivå 3 + lämnar nivå 4 enkel (klick → ?cleaner_id=).
3. **Sen C-4** (addons). Mer operationell nytta än nivå 5.
4. **Till sist C-3** (multi-cleaner). Mest komplext men störst differentiering mot konkurrenter.
5. **Löpande: C-5** (rating-perf) — när ratings-tabellen börjar fyllas.

---

## 7. Framtida beslut (§9 för Farhad)

1. **Accepterar du nivå-modellen (1-5)?** Eller vill du ha en annan struktur?
2. **Pris-modell för multi-cleaner:** additiv (Option A rekommenderad)?
3. **Addon-capabilities: default "alla" eller måste cleaner opt-in per addon?**
4. **Team-drawer layout:** checkbox-multi-select ELLER en-och-en-klick + "lägg till fler"?
5. **Rating-aggregat:** live-beräkning i RPC ELLER materialized view uppdaterad varje natt?

Min projektchef-rekommendation:
- **Fråga 1:** Ja, 5 nivåer är komplett spektrum
- **Fråga 2:** Option A (additiv) = tydligt för kund
- **Fråga 3:** Default "alla" (opt-out för specifika) — lågt onboarding-friktion
- **Fråga 4:** En-och-en-klick för nivå 4, multi-checkbox för nivå 5 (tydligare use-case)
- **Fråga 5:** Live-beräkning tills ratings > 1000 rader (då MV)

---

## 8. Integration med tidigare sprintar

**Modell B (klart idag):** find_nearby_providers + matching-wrapper + providers-shadow.

**Modell C bygger på:** Model-4a's `provider_type` + `team_size` + `representative_cleaner_id`. När klient ser company-provider i boka.html → klick → expandera team (Sprint C-1).

**Ingen refaktor av Modell B behövs.** Modell C är UX-lager + utvidgning av booking-create för multi-cleaner.

---

## 9. Regel-check

| Regel | Uppfyllt genom |
|---|---|
| **#26** (grep-före-edit) | N/A — denna audit implementerar ingen kod |
| **#27** (scope-respekt) | Endast design, Farhad beslutar sprint-ordning innan kod |
| **#28** (single source of truth) | `booking_team` + `service_addons` återanvänds (finns redan). Inga nya duplikat-tabeller |
| **#29** (audit-först) | DB-schema + boka.html + foretag.html + föregående Modell B-audit lästa |
| **#30** (regulator-gissning) | N/A |
| **#31** (primärkälla) | DB-state verifierad (bookings=46, ratings=0, booking_team=0, service_addons=1) |

---

## 10. Öppna frågor (måste besvaras INNAN Sprint C-1)

1. **Vilken sprint först?** (C-2 rekommenderas, låg risk)
2. **Multi-cleaner-scope:** bara samma företag, ELLER blanda solo+team?
   - Rekommendation: bara samma företag. Blanda är komplext (pris-fördelning, Stripe-transfer).
3. **Team-drawer:** inline-expand ELLER separat overlay?
   - Rekommendation: inline-expand (mindre friktion)
4. **Prisvisning för multi:** visas varje cleaner separat ELLER totalpris?
   - Rekommendation: båda (transparens + enkelhet)

---

## 11. Referenser

- [Modell B audit (2026-04-26)](2026-04-26-foretag-vs-stadare-modell.md)
- [Matching-algorithm.md §10 A/B-ramverk](../architecture/matching-algorithm.md)
- [Shadow-mode-analysis.md](../architecture/shadow-mode-analysis.md)
- `supabase/functions/booking-create/index.ts` (rad 355 — bookings.insert)
- `supabase/functions/auto-delegate/index.ts` (team-fallback-logik)

---

**Ingen kod skrivs förrän Farhad besvarat §10 + gett go för Sprint C-X.** Denna audit är dokument, inte implementation (regel #27).

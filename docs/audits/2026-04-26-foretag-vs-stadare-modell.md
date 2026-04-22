# Audit: Företag-vs-städare-modell

**Datum:** 2026-04-26
**Status:** AUDIT KOMPLETT · ej implementerad
**Initierad av:** Farhads observation att nuvarande modell visar VD som städare (Zivar Majid som "ägare/representant" för Solid Service Sverige AB) trots att Zivar själv inte utför städjobb
**Ramverk:** Regler #26–#31 (grep-före-edit · scope-respekt · audit-först · primärkälla)

---

## 1. Sammanfattning

**Dagens matching-modell är strukturellt felaktig.** `find_nearby_cleaners` filtrerar på `(company_id IS NULL OR is_company_owner = true)` — d.v.s. företag representeras av sin VD. Detta gör VD:ns hem-koordinater, service-radie, tillgänglighet, `hourly_rate` och `services` till proxy för företaget, även när VD själv inte utför städjobb.

**Konsekvens:** 6 team-medlemmar (∼55 % av aktiva cleaners) är osynliga i matchningen, och företag-räckvidden är artificiellt begränsad till VD:ns koordinater.

**Rekommendation:** Modell B — "Företag = aggregat av aktiva städare". Kräver ny `cleaners.active_cleaner`-kolumn, ny RPC som grupperar team till företag-entity, och UX-justering.

**Estimat:** 10–13h över 4 sprintar med låg risk per steg tack vare shadow-mode-infrastruktur (från §3.7).

---

## 2. Metod

Primärkälla-verifiering (regel #31):

| Källa | Verifikation |
|---|---|
| `cleaners`-tabell prod | `SELECT COUNT(*) GROUP BY is_company_owner, company_id IS NULL` |
| `bookings`-fördelning | `JOIN cleaners ON cleaner_id` |
| `find_nearby_cleaners` body | `20260423202501_f3_2a_matching_v2_core.sql` rad 95–130 |
| `find_nearby_cleaners_v1` body | `20260425120000_sprint2d2_find_nearby_cleaners_v1.sql` rad 79–95 |
| booking-create Stripe-routing | `supabase/functions/booking-create/index.ts` rad 605–615 |
| auto-delegate team-logik | `supabase/functions/auto-delegate/index.ts` rad 85–120 |
| Klient-rendering | `boka.html`, `foretag.html`, `stadare-profil.html` |

Grep-kartläggning av `is_company_owner`: **30 filer** (HTML, TS, SQL, docs).

---

## 3. Dagens modell (verifierat)

### 3.1 Data-distribution i prod

| Kategori | Antal | Andel | Synliga i matching? |
|---|---|---|---|
| VD (is_company_owner=true) | 4 | 36 % | ✅ ja |
| Team-medlem (company_id satt, ej VD) | 6 | 55 % | ❌ nej |
| Solo-städare (company_id=NULL) | 1 | 9 % | ✅ ja |
| **Totalt (approved + active)** | **11** | | |

### 3.2 Bokningsfördelning

| Bokningar mot | Antal | Andel |
|---|---|---|
| Solo-städare | 37 | 82 % |
| VD (is_company_owner=true) | 5 | 11 % |
| Team-medlem (via auto-delegation) | 3 | 7 % |
| **Totalt** | **45** | |

**Observation:** 8 av 45 bokningar (18 %) går genom företagsflödet idag. Av dessa omfördelas 3 från VD till team via `auto-delegate` EF.

### 3.3 Matching-logik idag

**v2-RPC hard filter (live i prod):**
```sql
WHERE c.is_approved = true
  AND c.is_active   = true
  AND c.status      = 'aktiv'
  AND c.is_blocked  = false
  AND c.home_lat    IS NOT NULL
  AND c.home_lng    IS NOT NULL
  AND (c.company_id IS NULL OR c.is_company_owner = true)
  AND ST_DWithin(<cleaner.home>, <customer>, c.service_radius_km * 1000)
```

**Vad raden `(company_id IS NULL OR is_company_owner = true)` innebär:**
- Solo-städare (company_id=NULL) passerar
- VD (is_company_owner=true) passerar → representerar sitt företag
- Team-medlem (company_id satt, ej VD) blockeras

### 3.4 Stripe-routing (booking-create)

`booking-create/index.ts` rad 605–615:

```typescript
// Om team-medlem: hämta VD för Stripe-transfer
if (cleanerConnect?.company_id && !cleanerConnect.is_company_owner) {
  const { data: vd } = await supabase
    .from("cleaners")
    .select("stripe_account_id")
    .eq("company_id", cleanerConnect.company_id)
    .eq("is_company_owner", true);
  // ... transfer till VD:ns Stripe-konto
}
```

**Observation:** Stripe-transfers går alltid till VD:ns konto, även när jobbet utförs av team. VD distribuerar internt. Detta är korrekt B2B-flöde — inget att ändra.

### 3.5 Auto-delegation (auto-delegate EF)

`auto-delegate/index.ts` rad 85–120:

```typescript
const { data: prevCleaner } = await supabase
  .from("cleaners")
  .select("id, company_id, avg_rating")
  .eq("id", originalCleanerId);
if (!prevCleaner?.company_id) return; // solo → ingen delegering
const { data: team } = await supabase
  .from("cleaners")
  .select(...)
  .eq("company_id", prevCleaner.company_id);
// välj team-medlem baserat på availability + avg_rating
```

**Observation:** Fungerar bara för bokningar som från början mappats mot team-medlem eller VD i samma företag. Delegerar inte från solo-cleaner. Ingen ändring behövs här.

### 3.6 Klient-rendering (UX idag)

| Sida | Beteende |
|---|---|
| `boka.html` | Visar Zivar som "Solid Service Sverige AB" med ZM-avatar. Pris 390 kr/h (VD:ns). "Ny städare"-badge (VD:ns 0 completed_jobs). |
| `foretag.html` (/f/solid-service-sverige-ab) | Visar företagsnamn som primär, team-scroll med 4 medlemmar synliga. Ingen VD-kontaktperson-text. |
| `stadare-profil.html` (/s/zivar-majid) | **Redirectar till /f/** sedan Prof-5 (commit 88a7c90). VD:n visas inte som solo-profil. |

**Delvis fixat av Prof-1-5**, men matching-LOGIKEN är fortfarande VD-baserad.

### 3.7 Companies-schema (vad finns idag?)

```sql
-- Relevanta kolumner:
companies.id              uuid PRIMARY KEY
companies.name            text
companies.slug            text
companies.org_number      text
companies.description     text
companies.logo_url        text             -- saknar default, NULL i Solid Service
companies.onboarding_status text
companies.onboarding_completed_at timestamptz
companies.updated_at      timestamptz
companies.insurance_verified boolean
companies.self_signup     boolean
-- SAKNAS:
-- home_lat, home_lng      (geo på företagsnivå)
-- service_radius_km       (radie på företagsnivå)
-- services                (tjänste-lista på företagsnivå)
-- hourly_rate             (pris på företagsnivå)
```

**Observation:** `companies` är en ren organisations-tabell. All operationell data (geo, services, pris, radie) lever på `cleaners`. Konsekvens: företagets verkliga räckvidd och prismodell kan bara utledas genom aggregering över team.

---

## 4. Problem-katalog

### P1 — Geografisk räckvidd begränsad till VD

**Exempel:** Solid Service Sverige AB
- Zivar (VD): home (59.3693, 17.8401), Hässelby, radius 50 km
- Dildora (team): home (59.4119, 17.9200), radius 30 km
- Nasiba (team): home (59.4093, 17.9302), radius 30 km
- Nilufar (team): home (59.2435, 18.2227), radius 50 km
- Odilov (team): home (59.3876, 17.9202), radius 50 km

Kund i Södertälje (59.19, 17.63): Zivar är 23 km bort, hans radie är 50 km → företaget syns. OK här.

Kund i Liljeholmen (59.31, 18.02): Nasiba är 5 km bort, Zivar är 10 km bort → båda kan servera, men Nasiba skulle varit närmast match. Idag visas företaget BARA med Zivars distans (10 km), inte "närmaste" (5 km).

Kund i Tumba (59.20, 17.84): Zivar är 20 km bort, alla team-medlemmar >30 km bort. Idag visas företaget eftersom Zivars radie är 50 km, men INGEN team-medlem kan faktiskt servera — resulterande bokning kräver att VD delegerar trots att ingen är inom avståndsräckvidd.

### P2 — Prismotor använder VD:ns rate som företags-rate

Solid Service:
- Zivar: hourly_rate = 390
- Alla team: hourly_rate = 390

Om företaget ville erbjuda lägre pris för team (350 för Dildora som städar snabbt) — dagens modell visar alltid VD:ns 390. `company_service_prices` används bara som fallback i pricing-resolver (Sprint 1 Dag 2), inte som primär prissättning i boka.html.

### P3 — Tillgänglighet är VD:ns, inte team-union

`cleaner_availability_v2` har 7 rader för Zivar (alla dagar) men också per team-medlem. Idag kollar `find_nearby_cleaners` bara VD:ns tillgänglighet. Om Zivar är sjuk men Nasiba kan jobba → företaget visas som "ej tillgänglig" trots att teamet kan.

### P4 — VD-rating representerar hela företaget

Aggregate rating i JSON-LD (Prof-5) baseras på VD:ns reviews idag. Om VD har få reviews men team har många → företagets rating är artificiellt låg.

### P5 — UX-missvisning: "Zivar · Kontaktperson"

Tidigare visade `stadare-profil.html` denna text (rad 367). **Fixat av Prof-5 VD-redirect** (88a7c90) — VD hamnar nu alltid på `/f/`. Men konceptet kvarstår: dagens data-modell förutsätter att VD har en profilsida som städare.

### P6 — "Ny städare"-badge på företagskort

boka.html:2474 visar cleaner-kort med `cl.company_display_name`. Om `cl.completed_jobs = 0` → "Ny städare". För företag är detta vilseledande: företaget har kanske 6 team-medlemmar som utfört 20 jobb totalt, men VD:ns 0 jobb syns.

### P7 — Matching-algorithm-doc §12 beslut behövs omvärderas

`docs/architecture/matching-algorithm.md` §12 sa "radera `jobs`/`job_matches`/`cleaner_job_types`" med motivering "push-modell vs pull-modell". Beslutet är korrekt för solo-städare, men frågan om **hur företag-entitet ska matcha** har inte diskuterats. Denna audit fyller det gapet.

---

## 5. Föreslagen modell (Modell B)

### 5.1 Kärnprincip

> **Matchbara entiteter är endast: (a) aktiva solo-städare, eller (b) företag representerade som aggregat av sitt team.**
>
> VD är INTE matchbar som städare om hen inte själv städar.

### 5.2 Data-modell-tillägg

En ny kolumn på `cleaners`:

```sql
ALTER TABLE cleaners
  ADD COLUMN IF NOT EXISTS active_cleaner boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN cleaners.active_cleaner IS
  'true = personen utför städjobb själv och inkluderas i matching-aggregat. '
  'false = endast administratör (VD som inte städar, onboarding, pausad). '
  'Solo-cleaners: alltid true. VD som städar själv: true. VD som bara ansvarar: false.';
```

Backfill-strategi:
- Alla solo (`company_id IS NULL`): `active_cleaner = true` (default OK)
- Alla team-medlemmar: `active_cleaner = true` (de städar per definition)
- VD:er: **kräver manuell utpekning** i VD-dashboard. Default `true` bakåtkompat, men Farhad måste markera vilka av de 4 VD:erna som själva städar.

### 5.3 Ny RPC: `find_nearby_providers`

Returnerar blandad lista: solo-cleaners + företag.

**Förslag (skiss, ej slutlig):**

```sql
CREATE FUNCTION find_nearby_providers(
  customer_lat double precision,
  customer_lng double precision,
  booking_date date DEFAULT NULL,
  -- ... övriga v2-params
) RETURNS TABLE (
  provider_type text,        -- 'solo' | 'company'
  provider_id uuid,          -- cleaners.id OR companies.id
  display_name text,         -- cleaner.full_name OR company.name
  slug text,
  avatar_url text,
  min_hourly_rate integer,   -- MIN over team + company_prices
  services jsonb,            -- UNION over team
  distance_km numeric,       -- MIN distance (company: till närmaste team-medlem)
  team_size integer,         -- 1 för solo, N för företag
  aggregate_rating numeric,  -- MEAN över alla team-medlemmar viktat på reviews
  aggregate_review_count integer, -- SUM
  aggregate_completed_jobs integer, -- SUM
  match_score numeric(4,3),  -- v2-score (för företag: baserad på bästa team-medlem)
  ...
) AS $$
  WITH active_providers AS (
    -- Solo-cleaners
    SELECT
      'solo'::text AS provider_type,
      c.id AS provider_id,
      c.full_name AS display_name,
      c.slug,
      ...
    FROM cleaners c
    WHERE c.company_id IS NULL
      AND c.is_approved = true AND c.is_active = true
      AND c.status = 'aktiv' AND c.active_cleaner = true
      AND ST_DWithin(<c.home>, <customer>, c.service_radius_km * 1000)

    UNION ALL

    -- Företag (aggregerat per company_id)
    SELECT DISTINCT ON (c.company_id)
      'company'::text AS provider_type,
      co.id AS provider_id,
      co.name AS display_name,
      co.slug,
      COALESCE(co.logo_url, c.avatar_url) AS avatar_url,
      -- min-pris från cleaner + company_service_prices
      -- union av services över team
      -- min distans till närmaste team-medlem
      -- max radie
      ...
    FROM cleaners c
    JOIN companies co ON c.company_id = co.id
    WHERE c.company_id IS NOT NULL
      AND c.is_approved = true AND c.is_active = true
      AND c.status = 'aktiv' AND c.active_cleaner = true
      AND ST_DWithin(<c.home>, <customer>, c.service_radius_km * 1000)
    ORDER BY c.company_id, ST_Distance(<c.home>, <customer>)
  )
  SELECT ... FROM active_providers;
$$;
```

**Kritisk detalj:** `DISTINCT ON (company_id) ORDER BY ST_Distance ASC` = väljer närmaste team-medlem som representativ för företaget.

### 5.4 UX-förändringar

**boka.html cleaner-kort:**

| Idag | Modell B |
|---|---|
| "Solid Service Sverige AB" (VD som proxy) | "Solid Service Sverige AB" (företag som aggregat) |
| "Ny städare" (VD:s 0 jobb) | "Team med 5 städare · ⭐ X jobb utförda" |
| 390 kr/h (VD:s rate) | "Från Y kr/h" (MIN över team + company_prices) |
| ZM-avatar (Zivar) | Logo (companies.logo_url) eller dynamisk färg-tile |

**Profilsida /f/<slug>:**

Delvis fixat i Prof-1-5. Ytterligare:
- Ta bort "Zivar Majid · Kontaktperson" från hero (redan diskuterat)
- Lägg till "Kontakt"-avsnitt längst ner
- Team-sektion visar alla `active_cleaner=true` medlemmar
- VD:er med `active_cleaner=false` visas inte i team-scroll

**Profilsida /s/<vd-slug>:**

Redan redirectas till /f/ via Prof-5. Ingen ändring.

### 5.5 Bakåtkompat-strategi

- Behåll `find_nearby_cleaners` och `find_nearby_cleaners_v1` som RPC:er i prod (för shadow-mode + rollback)
- Lägg till `find_nearby_providers` som tredje variant
- `platform_settings.matching_algorithm_version` får nytt värde: `'providers'`
- matching-wrapper EF branching: v1, v2, shadow, providers

---

## 6. Call-site-impact-matrix

| # | Call-site | Fil | Impact | Kod-ändring | Risk |
|---|---|---|---|---|---|
| 1 | v2-RPC hard filter | `20260423...f3_2a.sql` | Ersätt eller parallell | Ny migration | Låg (v2 orörd) |
| 2 | v1-RPC hard filter | `20260425...v1.sql` | Oförändrad | — | Ingen |
| 3 | `matching-wrapper` EF | `functions/matching-wrapper/` | Lägg till 'providers'-branch | 20 rader TS | Låg |
| 4 | `boka.html` rendering | `boka.html:2430–2500` | Cleaner-kort-mallen (team-size, min-pris) | 10 rader HTML/JS | Medel |
| 5 | `boka.html` filtering | `boka.html:1960–2030` | Om resp innehåller `provider_type`, skip availability-filter för solo (redan hanterat i RPC) | 5 rader | Låg |
| 6 | `booking-create` Stripe | `booking-create/index.ts:605–615` | Oförändrad (VD är fortfarande Stripe-ägare) | — | Ingen |
| 7 | `auto-delegate` EF | `auto-delegate/index.ts` | Oförändrad | — | Ingen |
| 8 | `foretag.html` rendering | `foretag.html` | Already company-centric via Prof-1-5 | — | Ingen |
| 9 | `stadare-profil.html` | `stadare-profil.html` | Redirect via Prof-5 → ingen ändring | — | Ingen |
| 10 | `admin.html` cleaner-lista | `admin.html` | Lägg till "Aktiv städare"-toggle per cleaner | 15 rader HTML/JS | Låg |
| 11 | VD-dashboard | `stadare-dashboard.html` | Lägg till toggle "Städar du själv?" | 10 rader | Låg |
| 12 | `matching-algorithm.md` | docs | Uppdatera §12 + nytt §13 för provider-modellen | Dokumentation | Ingen |
| 13 | `matching_shadow_log` | Dag 1-migration | Utöka `v2_ranking` tolkning för provider-format | Dokumentation | Ingen |
| 14 | Stripe-webhook | `stripe-webhook/index.ts` | Oförändrad | — | Ingen |
| 15 | `stripe-connect` EF | `stripe-connect/index.ts` | Oförändrad (VD = Stripe-ägare) | — | Ingen |

**Summering:** 5 aktiva kod-ändringar (pkt 1, 3, 4, 10, 11). Övriga är dokumentation eller orörda.

---

## 7. Implementations-plan (4 sprintar)

### Sprint Model-1: DB-kolumn + backfill (~2h, risk: låg)

1. Migration: `20260426_model1_active_cleaner.sql`
   - `ALTER TABLE cleaners ADD COLUMN active_cleaner boolean NOT NULL DEFAULT true`
   - Backfill ingen ändring (alla blir true)
2. Admin-panel: lägg till per-cleaner toggle "Aktiv städare"
3. VD-dashboard: lägg till toggle "Jag städar själv" (om is_company_owner=true)
4. Dokumentera i `docs/architecture/matching-algorithm.md` §13
5. **Ingen matching-ändring** — endast infrastruktur

**Leverabel:** Farhad kan markera vilka VD:er som faktiskt INTE städar (t.ex. Zivar om sant).

### Sprint Model-2: Ny RPC `find_nearby_providers` (~4h, risk: medel)

1. Migration med nya RPC:n
2. Unit-tester mot prod-data:
   - Solid Service representeras som 1 provider (ej per team-medlem)
   - Närmaste distans reflekterar närmaste team-medlem
   - Min-pris är MIN över team + company_prices
   - Services = UNION
3. Dokumentera RPC-signaturen
4. Deploy via workflow

**Leverabel:** RPC körbar i prod, men ännu INTE anropad av klient.

### Sprint Model-3: matching-wrapper + shadow-mode (~3h, risk: medel)

1. Utöka matching-wrapper EF med `'providers'`-branch
2. Nytt shadow-läge: "providers vs v2" — loggar diff-ranking
3. platform_settings: `matching_algorithm_version='providers-shadow'`
4. Kör 48–72h i shadow för att validera matchnings-kvalitet

**Leverabel:** Shadow-data som visar hur `providers`-RPC skiljer sig från v2.

### Sprint Model-4: Klient-rendering + rollout (~3h, risk: medel)

1. boka.html:
   - Rendera provider-kort med team-size, min-pris, aggregat-rating
   - Ta bort "Ny städare"-badge för company-providers
2. Aktivera: `matching_algorithm_version='providers'`
3. Rollback-plan: UPDATE tillbaka till 'v2' vid incident
4. Monitor 48h

**Leverabel:** Kund ser företag som aggregat i boka.html. Team-medlemmar syns med korrekt min-distans och min-pris.

---

## 8. Risker + rollback

| Risk | Mitigering |
|---|---|
| Aggregat-logik ger fel min-pris | Unit-tester + shadow-jämförelse före rollout |
| VD marked active_cleaner=false, bokningar failar | Booking-create använder cleaner_id direkt, inte provider_id — ingen impact |
| Solo-cleaners syns som "företag" | `company_id IS NULL`-branch explicit i RPC |
| Företag utan active_cleaner-team visas som tomt | Hard filter `EXISTS (team WHERE active_cleaner=true)` — företag utan aktiva städare exkluderas |
| Stripe-routing bryts för team-bokning | Oförändrad logik i booking-create — risk noll |
| find_nearby_cleaners v2 används av andra callers | Grep-verifierat: endast matching-wrapper anropar den |
| Farhad missar att markera VD:ns active_cleaner-flagga | Default=true → bakåtkompat, VD syns tills toggle flyttas |

**Rollback per sprint:**
- Model-1: DROP COLUMN (inga rader använder den än)
- Model-2: DROP FUNCTION find_nearby_providers
- Model-3: matching_algorithm_version='v2' → wrapper skippar providers-branch
- Model-4: matching_algorithm_version='v2' + git revert boka.html-commiten

---

## 9. Öppna frågor (beslut krävs från Farhad)

1. **Vilka av de 4 VD:erna städar själva?**
   - Zivar Majid (Solid Service): ?
   - Övriga 3 VD:er: ?
   - Detta styr backfill av `active_cleaner=false` i Sprint Model-1.

2. **Ska company-nivå "services" lagras eller aggregeras live?**
   - (A) Lagrad: ny `companies.services jsonb` + triggers som synkar från team. Snabbare matching. Risk för drift.
   - (B) Aggregerad: räknas ut i RPC:n vid varje anrop. Alltid korrekt. Liten perf-kostnad.
   - Rekommendation: (B) tills team-antal >50. Då övergång till (A) med materialized view.

3. **Hur hantera "VD som städar ibland"?**
   - active_cleaner=true → syns i team-aggregat
   - VD har egna services/rate → används som medlem i aggregatet
   - Default-lösning i Model B

4. **Logo vs dynamisk färg-tile?**
   - Sprint Prof-1 introducerade dynamisk HSL-färg per namn
   - Om företaget laddar upp logo → visa logo
   - Annars → färg-tile med initialer
   - Enkel fallback-logik

5. **"Kontakt"-sektion på profilsida (VD):**
   - Ska VD:n visas som kontaktperson?
   - Eller bara en generisk "Hör av dig till vårt team"?
   - Rekommendation: namn + roll om Farhad pekar ut VD som kontaktperson, annars generic.

---

## 10. Referenser

**Relaterade audits:**
- `docs/audits/2026-04-22-schema-drift-analysis.md` (företagsschema + cleaner-kolumner)
- `docs/audits/2026-04-22-replayability-audit.md` (migration-drift)

**Designdokument:**
- `docs/architecture/matching-algorithm.md` §5 (scoring), §10 (A/B), §12 (DORMANT-jobs beslut), §14 (pilot-metrics)
- `docs/architecture/shadow-mode-analysis.md` (Prof-5, kategori A + B metrics)

**Migrations berörda:**
- `20260422113608_f2_2_find_nearby_cleaners.sql` (v1 — orörd)
- `20260423202501_f3_2a_matching_v2_core.sql` (v2 — orörd, behåll för shadow)
- `20260425120000_sprint2d2_find_nearby_cleaners_v1.sql` (v1-namespace-kopia — orörd)
- `20260425130000_sprint2d3_shadow_analysis_views.sql` (VIEWs — påverkas ej)

**Commits i denna session-period:**
- Prof-1–Prof-5: unificerade UX men löste inte matching-logiken (täcker UX-symptom, inte strukturell root cause)
- Denna audit pekar ut root cause som separat Sprint Model-serie

---

## 11. Nästa steg

1. Farhad läser denna audit
2. Farhad besvarar öppna frågor §9 (särskilt #1 om VD-aktiva-städning)
3. Gå-beslut för Sprint Model-1 (lägsta-risk-start)
4. Denna audit länkas från `docs/v3-phase1-progress.md` som Fas 3.10 (ny sub-fas)

**Ingen kod ändras förrän Farhad godkänt §9 + gå-beslut.** Denna audit är dokument, inte implementation (regel #27 scope-respekt).

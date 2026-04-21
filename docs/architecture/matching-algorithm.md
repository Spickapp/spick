# Matching Algorithm — Designdokument (§3.1)

> **Status:** Design — ren dokumentation, inga migrations eller kod i denna leverabel.
> **Primärkälla:** v3-arkitekturplan `docs/planning/spick-arkitekturplan-v3.md` rad 199-233 (Fas 3 §3.1-§3.9).
> **Metod:** Regel #26 (fil:rad) + Regel #27 (primärkälleverifierad via prod-schema.sql 2026-04-22 + kod-grep).
> **Sub-fas-roll:** §3.1 levererar formeln, vikterna, cold-start-strategin och A/B-ramverket. §3.2+ verkställer i SQL/kod.
> **Scope:** Strikt kundens bokningsflöde (boka.html). Stadare-dashboard + admin-dashboard ingår INTE i §3.x utöver det som §3.8 föreskriver.

---

## 1. Syfte & mål

**Målet** är att ersätta dagens fragmenterade matchning — en SQL-RPC för filter + en TypeScript Edge Function för scoring — med **en multivariat, auditbar ranking** i `find_nearby_cleaners` som löser:

- **Cold-start-problemet**: nya städare (0 reviews, 0 completed_jobs) hamnar permanent längst ner i distance-sorterade listor → aldrig jobb → aldrig reviews → **dödlig feedback-loop**.
- **Endimensionell sortering**: nuvarande RPC sorterar `ORDER BY distance_km ASC, avg_rating DESC NULLS LAST`. Vid 100+ städare per stad blir avstånd-skillnaderna mikroskopiska och sorteringen slumpartad.
- **Arkitektur-fragmentering**: `cleaner-job-match` EF ([supabase/functions/cleaner-job-match/index.ts](../../supabase/functions/cleaner-job-match/index.ts)) kör redan 7-dim-scoring live, men med andra vikter, utanför migrations-kedjan, med 3 extra DB-fetches per boka-sida.

**Konkret leverabel (efter §3.2-§3.9):** `find_nearby_cleaners` returnerar sorterat efter `match_score DESC`, deterministisk tie-break, cold-start-boost inbyggd, A/B-ramverk i `platform_settings`.

## 2. Nuläge — primärkälleverifierad inventering

Tre matching-system samexisterar i prod. Den här designen ersätter alla tre:

| System | Typ | Filer | Status | Vikter / logik |
|---|---|---|---|---|
| `find_nearby_cleaners` RPC | Pull-modell, filter + endim-sort | [supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql](../../supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql) | LIVE, i migrations sedan §2.2 | `distance ASC → avg_rating DESC NULLS LAST` |
| `cleaner-job-match` EF | Pull-modell, 7-dim-scoring | [cleaner-job-match/index.ts:11-19](../../supabase/functions/cleaner-job-match/index.ts:11) | LIVE, deploy via [deploy-edge-functions.yml:36](../../.github/workflows/deploy-edge-functions.yml:36) | availability 25, geography 20, jobType 15, hourlyRate 15, quality 10, preferences 10, history 5 |
| `jobs` + `job_matches` + `cleaner_job_types` | Push-modell, broadcast-scoring | [prod-schema.sql:2240-2297](../../prod-schema.sql) | DORMANT (39 rader, 0 kod-callers) | 7-booleans + integer `match_score` |

**Caller-inventering** (grep `find_nearby_cleaners|cleaner-job-match` i `js/`, `*.html`, `supabase/functions/`):

- [boka.html:1864](../../boka.html:1864) — anropar `find_nearby_cleaners` RPC med `customer_lat`/`customer_lng`.
- [boka.html:1984](../../boka.html:1984) — anropar `cleaner-job-match` EF **efter** RPC, för att omsortera via score. `include_below_threshold=true` → filtrerar inget, bara sorterar.
- [tests/smoke.spec.ts:85](../../tests/smoke.spec.ts:85) — smoke-test för EF.
- **Inga andra callers** i stadare-dashboard, admin, team-jobb.

**Infrastruktur-drift (hygien-task #13, separat scope):** [admin.html:5146-5176](../../admin.html:5146) refererar en `admin_settings`-tabell som INTE existerar i prod ([schema-drift-audit 2026-04-22](../audits/2026-04-22-schema-drift-analysis.md)). Matching-kategori-UI (`matching:'Matchning'`) renderar tomt. Icke-blockerare för §3 men måste lösas före §3.8 admin-dashboard.

## 3. Problem att lösa

1. **Cold-start-dödsloop** — [docs/planning/spick-arkitekturplan-v3.md:201](../planning/spick-arkitekturplan-v3.md:201) identifierar detta som 🔴 audit-prioritet 2.
2. **Endimensionell sortering** bryts vid skala (v3:201, samma).
3. **Två scoring-system är aligna nog att förvirra men olika nog att drifta** — EF:s 7 dimensioner överlappar RPC:ns filter men ersätter inte dem. Ingen ansvarig att hålla dem i synk.
4. **`cleaner-job-match` EF utanför migrations-kedjan** — samma Regel #27-överträdelse som `find_nearby_cleaners` pre-§2.2. Lokal dev + disaster recovery fungerar inte.
5. **Preferens-input är felmodellerad** — v3 §3.3 föreslår match mot `customer_profiles.preferences` JSONB; **den kolumnen existerar inte** ([prod-schema.sql:2080-2099](../../prod-schema.sql)). Primärkälla är **bokningens parametrar** (`has_pets`, `has_elevator`, `floor`, `hours`), inte kundprofilen.
6. **Audit-pure**: inget spårar vilken cleaner blev vald och med vilken match_score — vi kan inte efterhandsanalysera kvaliteten på ranking-modellen.

## 4. Design-principer

| Princip | Varför |
|---|---|
| **Pull-modell, inte push** | Kund väljer aktivt från lista. Push (jobs+job_matches) är en annan produkt (automatisk jobbtilldelning) som Spick inte kör idag. |
| **En RPC, inte RPC+EF** | Enklare arkitektur. Lägre latens (en fetch i stället för tre). Migrations-spårbar. |
| **Hard filter före scoring** | Städare som inte kan jobba den tiden, eller som är pausade, får **inte** score 0.3 — de filtreras bort innan scoring. Ingen risk att ett cold-start-boost lyfter en pausad cleaner till topplacering. |
| **Deterministisk ordning vid lika score** | A/B-analys kräver reproducerbar sortering. Slumpmässig tie-break förorenar experimentdata. |
| **Audit-kolumner på bokningen** | `chosen_cleaner_match_score` + `matching_algorithm_version` sparas på bokningen (§3.7). Möjliggör efterhands-kalibrering. |
| **Vikter i migrations, inte hårdkodade** | Framtida vikt-justeringar är 1 UPDATE på `platform_settings`, inte en RPC-redeploy. Inledningsvis kan vikterna dock vara konstanter i SQL — A/B via `matching_algorithm_version='v2'` som pekar på annan RPC-variant. |

## 5. Formeln

```
match_score =
    MIN(1.0,
        ( 0.35 * distance_score
        + 0.20 * rating_score
        + 0.15 * completed_jobs_score
        + 0.15 * preference_match_score
        + 0.10 * verified_score
        + 0.05 * exploration_bonus
        )
        * history_multiplier
    )
```

**Summa vikter: 0.35+0.20+0.15+0.15+0.10+0.05 = 1.00.**

`history_multiplier ∈ {1.00, 1.10}` (se §7). `MIN(1.0, ...)` cappar efter history-boost.

### 5.1 `distance_score` — 35 %

```
distance_score = 1 - MIN(distance_km, effective_radius) / effective_radius

effective_radius = COALESCE(cleaner.service_radius_km, 10)
```

- Linjär avfallande från 1.0 (på plats) till 0.0 (på radiens gräns).
- Bortom radien **filtrerades cleaner redan bort** av hard filter, så `distance_score=0` inträffar bara precis på gränsen.
- **Rationale höjning 35→40%**: distance är fortfarande viktigast (restid påverkar både cleaner och kund), men sänkt från v3:s 40% för att ge utrymme åt höjt `preference_match` (15%, jfr v3:10%). Preferenser skapar bättre match-kvalitet på längre sikt; distance dominerar ändå i lokala kluster.

### 5.2 `rating_score` — 20 %

```
rating_score = bayesian_smoothed(avg_rating, review_count) / 5.0

bayesian_smoothed(m, n) = (C * PRIOR + n * m) / (C + n)
  where C = 10, PRIOR = 4.5
```

- **Bayesian smoothing** förhindrar att en cleaner med 1 review å 5.0 rankar över en med 50 reviews å 4.8.
- `C=10` betyder "en cleaner jämförs mot en prior på 4.5 tills hen har ca 10 reviews".
- **NULL-hantering**: `avg_rating=NULL OR review_count=NULL` → behandla som 0 respektive 0 → `rating_score = PRIOR/5 = 0.9`. Rimligt: nya cleaners får prior-värde, inte noll.
- **Kolumnval**: `cleaners.avg_rating` (inte `rating` — duplikat, hygien-task #15).

### 5.3 `completed_jobs_score` — 15 %

```
completed_jobs_score = MIN(completed_jobs, 50) / 50
```

- Linjär kappning vid 50 jobb. Över 50 är man "etablerad", ytterligare volym ska inte rankas framför bättre rating.
- **NULL-hantering**: `completed_jobs=NULL` → 0. DEFAULT är 0 i schemat ([prod-schema.sql:1832](../../prod-schema.sql)), så NULL förekommer inte i praktiken.
- **Kolumnval**: `cleaners.completed_jobs` (inte `total_jobs` — duplikat, hygien-task #15).

### 5.4 `preference_match_score` — 15 %

**Input från bokningen** (inte från `customer_profiles`, som saknar `preferences` JSONB):

- `booking.has_pets` (boolean)
- `booking.has_elevator` (boolean)
- `booking.floor` (int, kan vara NULL)
- `booking.hours` (int)
- `booking.materials` (`'client'|'cleaner'|'both'|NULL`)

**Jämförs mot cleaner-kolumner:**

- `cleaners.pet_pref` (`'yes'|'some'|'no'`)
- `cleaners.elevator_pref` (`'need'|'prefer'|'any'`)
- `cleaners.material_pref` (`'client'|'cleaner'|'both'`)
- `cleaners.min_pay_per_job`, `cleaners.hourly_rate` (implicit rimlighetscheck)

**Formel (genomsnitt av fyra lika-viktade delpoäng):**

```
preference_match_score = (pet_match + elevator_match + material_match + hours_match) / 4

pet_match:
  1.0 om pet_pref IN ('yes','some')       -- 'no' + has_pets filtreras ut av hard filter
  1.0 om NOT has_pets
  0.0 annars

elevator_match:
  1.0 om NOT booking.floor OR booking.floor <= 3     -- ingen hiss-relevans
  1.0 om booking.has_elevator
  1.0 om cleaners.elevator_pref IN ('prefer','any')
  0.0 om cleaners.elevator_pref = 'need' AND NOT has_elevator AND floor > 3

material_match:
  1.0 om NOT booking.materials                       -- ospecificerat
  1.0 om cleaners.material_pref = 'both'
  1.0 om cleaners.material_pref = booking.materials
  0.5 annars

hours_match:
  1.0 om booking.hours * cleaners.hourly_rate >= cleaners.min_pay_per_job
  0.5 annars
```

- **Pet-disqualifier**: `pet_pref='no' AND booking.has_pets=true` hanteras av hard filter (se §6), inte av score.
- **Rationale höjning 10→15%**: bättre preferensmatch minskar avbokningar och ökar rating på sikt. Kund-feedback från pilot ger kalibreringsdata (§3.9).

### 5.5 `verified_score` — 10 %

```
verified_score = 0.5 * (identity_verified::int)
               + 0.5 * (has_fskatt::int)
```

- `is_approved` ingår inte i scoret — det är hard filter (§6). Annars blev bidraget alltid 1.0.
- **Kolumnval**: `cleaners.has_fskatt` (inte `f_skatt_verified` — duplikat, hygien-task #15).
- **NULL-hantering**: boolean med DEFAULT false, inga NULLs i praktiken. Behandla NULL som false → 0.

### 5.6 `exploration_bonus` — 5 %

```
days_since_approval = EXTRACT(DAY FROM (NOW() - cleaners.signup_date))::INTEGER

exploration_bonus =
  CASE
    WHEN cleaners.review_count >= 3
     AND cleaners.avg_rating < 3.5 THEN 0       -- Exploration-cap
    ELSE GREATEST(0, 1.0 - days_since_approval::numeric / 30.0)
  END
```

**`days_since_approval`-härledning — beslut:**

- **Källa: `cleaners.signup_date`** (DATE, DEFAULT CURRENT_DATE, NOT NULL i praktiken).
- **Övervägda alternativ** (förkastade):
  - `identity_verified_at` — TIMESTAMPTZ, NULLABLE. NULL för cleaners verifierade innan fältet tillkom → olika semantik per kohort.
  - `member_since` — TIMESTAMPTZ DEFAULT now(). Samma data som `signup_date` men olika format. Accepterbart men lägre prod-precedens.
  - `approved_at` — existerar **inte** i `cleaners`-tabellen (bara i `cleaner_applications`, `booking_adjustments`, `booking_modifications`).
- **Prod-precedens**: [prod-schema.sql:518](../../prod-schema.sql) — `get_new_cleaner_boost(p_cleaner_id)` använder redan `signup_date` med identisk uttryck. Återanvänd konventionen.

**Exploration-cap (Farhads beslut):**

- Villkor: `review_count ≥ 3 AND avg_rating < 3.5` → boost = 0.
- Intuition: efter 3 reviews har vi statistiskt utrymme att tro att en låg avg inte är slump. En cleaner som är ny **och** underpresterar ska inte lyftas av exploration-boost.
- Symmetri med [admin.html:4145-4156](../../admin.html:4145) som redan auto-pausar cleaners med `review_count ≥ 3 AND avg_rating < 3.0`. Vår threshold (3.5) är mjukare (exploration-cap), admin-threshold (3.0) är hårdare (auto-pause).

**Linjär avfallning 30 dagar:**

- Dag 0: bonus = 0.05 (5 %)
- Dag 15: bonus = 0.025 (2.5 %)
- Dag 30+: bonus = 0

Skillnad mot prod-funktionen `get_new_cleaner_boost` (som ger tiers 15/10/5/0 över 15 dagar och cappar vid `total_jobs >= 5`): vår version är linjär över 30 dagar och använder review_count + avg_rating som cap-kriterium i stället för total_jobs. Mjukare övergång, bättre cold-start-skydd.

## 6. Hard filter (före scoring)

Följande villkor **måste** uppfyllas för att en cleaner ska inkluderas i ranking-listan. Brott = ingen score, ingen visning.

```
WHERE cleaners.is_approved = true              -- #1 Godkänd
  AND cleaners.is_active = true                -- #2 Aktiverad
  AND cleaners.status = 'aktiv'                -- #3 Inte 'pausad'/'avstängd'/'onboarding'
  AND COALESCE(cleaners.is_blocked, false)     -- #4 Inte blockerad
      = false
  AND cleaners.home_lat IS NOT NULL            -- #5 Har koordinater
  AND cleaners.home_lng IS NOT NULL
  AND (cleaners.company_id IS NULL             -- #6 Solo eller företags-VD
       OR cleaners.is_company_owner = true)
  AND ST_DWithin(                              -- #7 Inom radie
       ST_MakePoint(home_lng, home_lat)::geography,
       ST_MakePoint(cust_lng, cust_lat)::geography,
       COALESCE(cleaners.service_radius_km, 10) * 1000
     )
  AND EXISTS (                                 -- #8 Availability (NYTT)
       SELECT 1 FROM cleaner_availability_v2 av
        WHERE av.cleaner_id = cleaners.id
          AND av.day_of_week = booking_dow_iso   -- ISO 1-7
          AND av.is_active = true
          AND av.start_time <= booking_time
          AND av.end_time   >= booking_end_time
     )
  AND NOT (                                    -- #9 Husdjurs-disqualifier
       booking.has_pets = true
       AND cleaners.pet_pref = 'no'
     )
```

**Filter #8 (availability) är nytt i denna design.** I cleaner-job-match-EF var availability en 25 %-vikt; vi flyttar den till hard filter. En cleaner som inte kan jobba den tiden är inte en sämre match — den är ingen match alls.

**Filter #9 (husdjurs-disqualifier) är nytt i denna design.** Idag filtreras det i boka.html ([rad 1963-1965](../../boka.html:1963)) efter RPC. Flyttas till RPC för konsekvens.

**Stripe-readiness-filter (boka.html rad 1928-1957)** behålls på klienten — det är en cross-cutting betalnings-check som inte hör till matching-RPCn.

## 7. Kund-historik-boost (§3.4, POST-multiplikator)

```
history_multiplier = CASE
  WHEN EXISTS (
    SELECT 1
      FROM bookings b
      JOIN ratings r ON r.booking_id = b.id
     WHERE b.cleaner_id = cleaners.id
       AND b.customer_email = ?     -- bokande kund
       AND b.payment_status = 'paid'
       AND r.score >= 4
  ) THEN 1.10
  ELSE 1.00
END
```

**POST-multiplikation, inte pre-weight**: formeln multiplicerar slutscore efter viktad summa. `MIN(1.0, ...)` cappar toppen så en redan högt rankad cleaner inte spränger skalan.

**Varför POST, inte pre**:

- Pre-weight (addera en dimension) skulle kräva omfördelning av alla andra vikter (en 10%-pref-boost som läggs till kräver att alla andra sänks med 11.1%).
- POST-multiplikation är semantiskt renare: "cleaner X med tidigare bra betyg från kunden boostas 10 %, oavsett var på skalan scoret ligger".
- Matchar v3 §3.4 ordagrant: "addera +10%" (tolkat som multiplikator, inte som poängadd).

**Edge case**: kund utan customer_email (anonym boka-utan-konto) → EXISTS returnerar alltid false → multiplier = 1.00. Inget extra villkor behövs.

**Kolumnval**: `ratings.score` (inte `rating` — ratings-tabellen heter så i prod, [prod-schema.sql:2477](../../prod-schema.sql)).

## 8. Edge cases & NULL-hantering

| Scenario | Hantering |
|---|---|
| `home_lat IS NULL` | Filter #5 i §6 → utelämnas. Täcker Rafas team-medlemmar som saknar koordinater. |
| `avg_rating IS NULL` | Bayesian smoothing ger `PRIOR/5 = 0.9` (se §5.2). |
| `review_count IS NULL` | Behandla som 0. Rating-smoothing förutsätter det. |
| `completed_jobs IS NULL` | Behandla som 0. `min(0, 50)/50 = 0`. DEFAULT 0 i schemat gör att det inte uppstår. |
| `service_radius_km IS NULL` | `COALESCE(service_radius_km, 10)` → 10 km default. Matchar prod-RPC:s beteende. |
| `identity_verified IS NULL` | Behandla som false. DEFAULT false i schemat. |
| `has_fskatt IS NULL` | Behandla som false. DEFAULT false i schemat. |
| `signup_date IS NULL` | Praktiskt omöjligt (DEFAULT CURRENT_DATE), men fallback: behandla som 30+ dagar → `exploration_bonus = 0`. |
| `status = 'pausad'` | Filter #3 → utelämnas. Behåller data, påverkar inte historik. |
| `status = 'avstängd'` | Filter #3 → utelämnas. Admin-action, oftast pga rating < 3.0 (auto-pause). |
| `status = 'onboarding'` | Filter #3 → utelämnas. `is_approved` bör också vara false. |
| Team-medlem utan `home_lat` | Filter #5 utelämnar individen. Filter #6 utelämnar även synliga team-medlemmar (bara VD synlig). I praktiken: kunden bokar VD → VD delegerar till team internt. |
| Team-VD utan completed Stripe | Hanteras av boka.html klient-filter ([rad 1937](../../boka.html:1937)). Om det ska in i RPC: separat hygien-task (inte i §3.1-scope). |
| `cleaner_availability_v2` saknar rader för cleaner | Filter #8 utelämnar. Strängare än cleaner-job-match-EF (som gav 0.7 som fallback). Rationale: "ingen definierad tillgänglighet" ska inte tolkas som "tillgänglig alltid". |
| Booking under midnatt (end_time < start_time) | Utanför scope. Boka.html tillåter inte bokningar över dygnsgränsen. |

## 9. Data-beroenden

### 9.1 Kolumner som läses

| Tabell | Kolumn | Användning | Duplikat-notering |
|---|---|---|---|
| `cleaners` | `id` | Key | — |
| `cleaners` | `home_lat`, `home_lng` | Hard filter #5, distance_score | — |
| `cleaners` | `service_radius_km` | Hard filter #7, distance-normalisering | — |
| `cleaners` | `is_approved`, `is_active`, `status`, `is_blocked` | Hard filter #1-4 | — |
| `cleaners` | `company_id`, `is_company_owner` | Hard filter #6 | — |
| `cleaners` | `pet_pref`, `elevator_pref`, `material_pref` | preference_match_score + hard filter #9 | — |
| `cleaners` | `min_pay_per_job`, `hourly_rate` | preference_match_score (hours_match) | — |
| `cleaners` | `avg_rating` | rating_score | **Duplikat**: `rating` (numeric, default 0). Ignorerad. |
| `cleaners` | `review_count` | rating_score, exploration-cap | **Duplikat**: `total_reviews`, `total_ratings`. Ignorerade. |
| `cleaners` | `completed_jobs` | completed_jobs_score | **Duplikat**: `total_jobs` (används av `get_new_cleaner_boost`). Ignorerad här. |
| `cleaners` | `identity_verified` | verified_score | — |
| `cleaners` | `has_fskatt` | verified_score | **Duplikat**: `f_skatt_verified`. Ignorerad. |
| `cleaners` | `signup_date` | exploration_bonus | Alt: `member_since` (samma data, annan typ). Ignorerad här. |
| `cleaner_availability_v2` | `cleaner_id, day_of_week, is_active, start_time, end_time` | Hard filter #8 | ISO day_of_week 1-7 (7=sön). |
| `companies` | `name` | Returkolumn `company_name` (för boka-UI) | — |
| `bookings` + `ratings` | Join för history_multiplier | §7 | — |

**Hygien-task #15 (öppnad här)** listar alla duplikat ovan för framtida kolumnkonsolidering. Inte en blockerare för §3.2 — RPC läser en kolumn av varje par, och det är prod-sanning redan.

### 9.2 Input-parametrar till RPC

```
find_nearby_cleaners(
  customer_lat        double precision,
  customer_lng        double precision,
  booking_date        date,
  booking_time        time,
  booking_hours       integer,
  booking_has_pets    boolean,
  booking_has_elevator boolean,
  booking_floor       integer,
  booking_materials   text,
  customer_email      text
)
```

**Utökning från nuvarande RPC-signatur** (som tar bara lat/lng). §3.2 genomför signaturändringen. Default-värden på nya parametrarna för bakåtkompatibilitet under rollout.

### 9.3 Input-validering

- `customer_lat`, `customer_lng` — obligatoriska (utan dem: 0 cleaners).
- Övriga: NULLABLE, funktionen hanterar NULL graciöst (se §8).
- Ingen skydds-check mot koordinat-injektion — `double precision` är typesäkert.

## 10. A/B-test-ramverk

**Målet**: rulla ut v2-matchning (denna design) bredvid v1 (nuvarande distance-sort) utan att bryta trafik. Mäta per-bokning om v2 ger bättre acceptance-rate, rating-utfall, avbokningar.

### 10.1 `platform_settings`-nycklar

```sql
-- Versionssträng, valbar: 'v1' | 'v2' | 'shadow'
INSERT INTO platform_settings (key, value)
VALUES ('matching_algorithm_version', 'v1')
ON CONFLICT (key) DO NOTHING;

-- Skuggläge: kör v2 bakom kulisserna, serva v1 till kund, logga diff
INSERT INTO platform_settings (key, value)
VALUES ('matching_shadow_log_enabled', 'false')
ON CONFLICT (key) DO NOTHING;
```

**Värden:**

- `'v1'` — nuvarande `find_nearby_cleaners` (distance-sort). Default under rollout.
- `'v2'` — ny multivariat ranking. Aktiveras per pilotgrupp eller globalt.
- `'shadow'` — RPC returnerar v1-ordning till boka.html, men loggar även v2-score för jämförelse. Ingen användare-påverkan; rena observationer.

**Konvention**: matchar `platform_settings`-mönstret från [20260420_f1_2_seed_platform_settings.sql](../../supabase/migrations/20260420_f1_2_seed_platform_settings.sql) — TEXT key, TEXT value, `ON CONFLICT DO NOTHING` för idempotent seed.

### 10.2 Audit-kolumner på `bookings`

Två nya kolumner på `bookings` (migration i §3.2):

```sql
ALTER TABLE bookings ADD COLUMN chosen_cleaner_match_score numeric(4,3);
ALTER TABLE bookings ADD COLUMN matching_algorithm_version text;
```

- `chosen_cleaner_match_score`: score-värdet för den cleaner kunden valde. NULL för v1-bokningar.
- `matching_algorithm_version`: snapshot av `platform_settings`-värdet vid bokning. Frigör analys från framtida settings-ändringar.

**Skugg-loggnings-tabell (optional, §3.9-analys):**

```sql
CREATE TABLE matching_shadow_log (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  uuid REFERENCES bookings(id),
  v1_ranking  jsonb,   -- array av {cleaner_id, rank}
  v2_ranking  jsonb,   -- samma struktur
  delta_summary jsonb, -- Spearman rank correlation, top-5-overlap etc
  created_at  timestamptz DEFAULT now()
);
```

Implementation i §3.2 eller §3.9. Inte blockerande för rollout.

### 10.3 Rollout-plan (referens för §3.7)

1. `v1` default, migration deployas → inga ändringar för kund.
2. Aktivera `shadow` i 48 h → samla diff-data utan risk.
3. Aktivera `v2` för 10 % av trafik (kräver extra flagga eller stad-filter).
4. Efter 30 dagar: analys (§3.9) → go/no-go för 100 %.
5. Efter 100 %-rollout: plan för att sunsetta v1 (radera gammal RPC-variant).

§3.7-implementationen detaljerar traffic-split-mekanik.

## 11. Performance-plan

**Nuvarande skala (2026-04-22)**: 14 aktiva cleaners. En `ST_DWithin` + `ST_Distance` mot 14 rader är <5 ms.

**Tröskel för materialiserad vy (§3.6)**:

- Om `EXPLAIN ANALYZE` visar `find_nearby_cleaners` > 200 ms på repr. prod-query vid ≥500 aktiva cleaners.
- Eller om p95-latens i Edge Function-loggar överstiger 300 ms konsekvent.

**När tröskeln nås — implementation (§3.6, ej nu)**:

```sql
CREATE MATERIALIZED VIEW mv_cleaner_scores AS
  SELECT
    id,
    ... pre-computed static fields ...
    computed_static_score,  -- allt utom distance + history (de är booking-beroende)
    ...
  FROM cleaners
  WHERE ... hard filter #1-6 ...;

CREATE INDEX idx_mv_cleaner_scores_location
  ON mv_cleaner_scores USING gist (
    ST_MakePoint(home_lng, home_lat)::geography
  );

-- Refresh varje 15 min via pg_cron eller Edge Function:
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_cleaner_scores;
```

RPC joinar mot MV, beräknar distance + history dynamiskt. Skippar tunga aggregat (Bayesian rating-smoothing är konstant tills nästa review).

**Indexering från dag 1 (§3.2 migrations):**

```sql
-- Hard filter + spatial
CREATE INDEX idx_cleaners_approval_active
  ON cleaners (is_approved, is_active, status)
  WHERE is_approved = true AND is_active = true AND status = 'aktiv';

CREATE INDEX idx_cleaners_location_gist
  ON cleaners USING gist (
    ST_MakePoint(home_lng, home_lat)::geography
  )
  WHERE home_lat IS NOT NULL AND home_lng IS NOT NULL;

-- Availability-join
CREATE INDEX idx_availability_v2_lookup
  ON cleaner_availability_v2 (cleaner_id, day_of_week, is_active)
  WHERE is_active = true;
```

Nuvarande prod har: `idx_cleaners_status_approved`, `idx_cleaners_languages`, `idx_cleaners_spark`. Location-GiST saknas — §3.2 bör lägga till.

## 12. DORMANT `jobs` + `job_matches` + `cleaner_job_types` — beslut

**Beslut**: radera.

**Motivation**:

- 0 kod-callers efter full grep (verifierat 2026-04-22 i §2.3-research).
- Designen implementerar en **push-modell** (jobb broadcastas, cleaners tävlar om att acceptera). Spick kör **pull-modellen** (kund väljer aktivt). De är olika produkter.
- `job_matches.match_score` + 7 booleans (`distance_ok`, `job_type_ok`, `time_ok`, `elevator_ok`, `pets_ok`, `materials_ok`, `client_rating_ok`) överlappar konceptuellt med vår `preference_match_score` + hard filters — men som audit-snapshot, inte som sorteringsnyckel. Vår design loggar till `bookings.chosen_cleaner_match_score` + eventuell `matching_shadow_log`. Samma audit-behov täckt på renare sätt.
- Triggers (`trg_response_time`, `trg_sync_portal_status`, `trg_update_cleaner_stats`) måste droppas tillsammans med tabellerna.

**Audit-insikter bevaras i designen:**

- De 7 booleans i `job_matches` är det koncept vi implementerar som `preference_match_score`-dimensionerna (pet/elevator/material/hours). Form-parallellitet.
- `distance_km` + `travel_time_min` på `jobs` är också input till framtida travel-time-scoring (om vi vill ersätta Euklidisk distance med Google Routes API). Inte i §3.1-scope men arkitekturen tillåter expansion.

**Migration (§3.2 eller §2.1.3-exekvering)**:

```sql
BEGIN;
  DROP TRIGGER IF EXISTS trg_response_time ON job_matches;
  DROP TRIGGER IF EXISTS trg_sync_portal_status ON jobs;
  DROP TRIGGER IF EXISTS trg_update_cleaner_stats ON jobs;

  DROP TABLE IF EXISTS job_matches CASCADE;
  DROP TABLE IF EXISTS cleaner_job_types CASCADE;
  DROP TABLE IF EXISTS jobs CASCADE;

  -- Droppa även tillhörande functions om de är orefererade
  DROP FUNCTION IF EXISTS cleanup_expired_jobs();
COMMIT;
```

**OBS**: Verifiera `cleanup_expired_jobs()`-referenser innan DROP. Om kopplad till pg_cron måste cron-jobbet deaktiveras först.

**Stänger**: §2.1.3 DORMANT-del i [docs/v3-phase1-progress.md](../v3-phase1-progress.md).
**Öppnar**: hygien-task #16 (cleaner-job-match EF radering efter §3.2).

## 13. Admin-dashboard (§3.8, skiss)

**Utanför §3.1-scope att bygga.** Skiss för planerings-referens:

**Vyer i admin.html-tabb `matching`:**

1. **Top 10 / Bottom 10 cleaners per match_score** (rullande 30 dagar).
2. **Cold-start-monitor**: cleaners med `days_since_approval < 30` + deras genomsnittliga ranking + accept-rate.
3. **Vikt-kalibrerare**: slider-UI för att preview:a vad en vikt-ändring gör med rankingen på senaste 100 bokningarna.
4. **A/B-läge + shadow-diff**: rapport på `matching_shadow_log`-data (top-5-overlap, ranking correlation).
5. **Exploration-cap-aktiveringar**: lista på cleaners där cap slog in senaste veckan.

**Förutsätter**: hygien-task #13 löst (admin.html:5146-5176 idag bruten, läser från icke-existerande `admin_settings`).

## 14. Pilot-analys (§3.9, metrik-plan)

**30-dagars pilot efter v2-aktivering**, metrik för go/no-go:

| Metrik | Definition | Mål |
|---|---|---|
| **Acceptance-rate** | Andel bokningar där kund valde en av top-3-rankade | ≥ 75 % (v1-baseline TBD från shadow) |
| **Distance-kompromiss** | Median distance_km för valda cleaners | Inom +20 % av v1-median |
| **Cold-start-jobb** | Andel cleaners med `days_since_approval < 30` som fick ≥1 bokning under piloten | > 50 % (v1-baseline TBD) |
| **Rating-utfall** | Genomsnittlig rating för v2-bokningar | ≥ v1-rating |
| **Avbokningar** | Andel v2-bokningar som avbokades före utförande | ≤ v1-rate |
| **Pref-kvalitet** | `preference_match_score` för valda cleaners | Median ≥ 0.75 |

**Kalibrerings-loop**: om acceptance sjunker → höj `distance` eller `rating`-vikt. Om cold-start misslyckas → höj `exploration_bonus` eller förläng fönstret från 30 → 45 dagar. Regel: **ingen vikt-ändring utan minst 100 datapunkter och 7 dagars observation**.

## 15. Öppna design-beslut (för §3.2+ att lösa)

1. **RPC-signatur: kompatibilitet vs renhet**. §3.2 måste välja:
   - (a) Behåll gamla `find_nearby_cleaners(lat, lng)` + lägg till `find_nearby_cleaners_v2(...)` parallellt, eller
   - (b) Utöka signaturen med NULL-defaults och uppdatera boka.html att skicka alla parametrar.
   - Rekommendation: (b), enklare migrations-spår, färre EF-callers att synka.

2. **`company_name`-returning i v2-RPC**. Nuvarande RPC returnerar `company_name` via `LEFT JOIN companies`. Nytt fält `company_display_name` i prod-VIEW [v_cleaners_for_booking](../../prod-schema.sql:2935). Ska v2 returnera båda, bara den ena, eller lämna join till klienten? Beslut i §3.2 när `bookings`-kolumner införs.

3. **Shadow-loggnings-omfattning**. Räcker med `matching_shadow_log`-tabellen, eller behöver vi också per-cleaner-per-bokning snapshot för att debugga rankning-edge-cases? Beslut i §3.2.

4. **A/B traffic-split-mekanik**. Var splittas trafik — i `platform_settings` (globalt mode), i RPC (per-request-parameter), eller på klienten (hash av customer_email)? Beslut i §3.7.

5. **Kalibrering av `history_multiplier`**. Idag fast 1.10. Finns argument för att graderar (`1.05` för 1 bra review, `1.10` för 3+)? Kräver data från pilot (§3.9).

6. **Exploration-cap-symmetri med auto-pause**. [admin.html:4145](../../admin.html:4145) auto-pausar vid `review_count ≥ 3 AND avg_rating < 3.0`. Vårt exploration-cap triggar vid `review_count ≥ 3 AND avg_rating < 3.5`. Ska auto-pause-tröskeln höjas till 3.5 för konsistens, eller är det bra att de är olika (mjuk cap vs hård pause)? Separat scope — inte blockerande för §3.2.

7. **`preference_match_score` dimensions-vikter**. Designen ger varje av fyra dimensioner lika vikt (0.25 vardera). Alternativ: `pet_match` + `elevator_match` är hårda krav och bör väga tyngre än `material_match`. Behöver pilot-data för kalibrering (§3.9).

8. **Preferens-hårdhet**. Idag är husdjursfiltret hard (filter #9). Ska elevator-pref eller material-pref också upphöjas från soft score till hard filter? Argument: "cleaner.material_pref='cleaner' (bara egna)" + "booking.materials='client' (kund har)" är en riktig mismatch, inte en nyans. Beslut efter pilot.

---

## Referenser

- **v3-arkitekturplan**: [docs/planning/spick-arkitekturplan-v3.md:199-233](../planning/spick-arkitekturplan-v3.md:199)
- **Prod-schema (granskad 2026-04-22)**: `prod-schema.sql` (gitignored, 200 KB)
- **Schema-drift-audit**: [docs/audits/2026-04-22-schema-drift-analysis.md](../audits/2026-04-22-schema-drift-analysis.md)
- **Nuvarande `find_nearby_cleaners`-migration**: [supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql](../../supabase/migrations/20260422_f2_2_find_nearby_cleaners.sql)
- **`cleaner-job-match` EF (raderas efter §3.2)**: [supabase/functions/cleaner-job-match/index.ts](../../supabase/functions/cleaner-job-match/index.ts)
- **Tidigare matching-relaterad audit**: [docs/audits/2026-04-19-nytt-jobb-matchar-bugg.md](../audits/2026-04-19-nytt-jobb-matchar-bugg.md), [2026-04-19-boka-cleaner-filter-bugg.md](../audits/2026-04-19-boka-cleaner-filter-bugg.md)
- **Prod-funktion `get_new_cleaner_boost`** (konventions-källa): [prod-schema.sql:513-521](../../prod-schema.sql)
- **Admin auto-pause-logik** (exploration-cap-symmetri): [admin.html:4145-4156](../../admin.html:4145)
- **Boka.html nuvarande matching-flöde**: [boka.html:1852-2007](../../boka.html:1852)

## Nya hygien-tasks öppnade av denna design (i progress-filen)

- **#13** — admin.html:5146-5176 matching-UI bruten (läser icke-existerande `admin_settings`-tabell). Blockerar §3.8.
- **#14** — `days_since_approval`-härledning via `signup_date` dokumenterad här; verifiera att prod-datum är rimliga för alla 14 aktiva cleaners innan exploration-cap aktiveras.
- **#15** — Cleaner-kolumn-duplikater audit: `avg_rating`/`rating`, `review_count`/`total_reviews`/`total_ratings`, `completed_jobs`/`total_jobs`, `has_fskatt`/`f_skatt_verified`, `signup_date`/`member_since`. RPC läser en av varje, resten bör DROPas i framtida migration.
- **#16** — `cleaner-job-match` EF radering efter §3.2 (RPC-konsolidering komplett). Innefattar: undeploy EF, radera `supabase/functions/cleaner-job-match/`, ta bort från `deploy-edge-functions.yml:36`, ta bort smoke-test på `tests/smoke.spec.ts:85`.

## Stängd deferred sub-fas

- **§2.1.3 (DORMANT-beslut)** stängs: jobs/job_matches/cleaner_job_types raderas per §12-beslut. Exekvering i kommande migration (§3.2 eller separat cleanup-commit).

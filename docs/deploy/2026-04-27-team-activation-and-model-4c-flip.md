# Runbook: Team-aktivering + Model-4c flipp (2026-04-27)

**Prereq:** Läs denna fil HELT innan du kör något. Alla SQL-kommandon körs i Supabase Studio SQL Editor (prod). Ingen auto-apply.

**Syfte:** Aktivera Solid Service 4 team-medlemmar + flippa matching från `providers-shadow` → `providers`. Detta låser upp C-2 + Model-4b till att bli LIVE för riktiga kunder.

**Totalt tid:** 10-15 min (mest väntetid på smoke-tests).

**Förutsättningar (verifierat 2026-04-27 via anon-REST, rule #31):**
- ✅ VD Zivar: status='aktiv', stripe_onboarding_status='complete', owner_only=true
- ✅ Team (4 st): is_approved=true, owner_only=false, is_company_owner=false, status='onboarding' (flyttas till 'aktiv' i Steg 2)
- ✅ `matching_algorithm_version='providers-shadow'`, `matching_shadow_log_enabled='true'`
- ✅ `find_nearby_providers(59.3293, 18.0686)` returnerar idag BARA Farhad-solo
- ✅ RPC-logik: `is_active=true AND status='aktiv' AND NOT owner_only`

---

## Steg 0 — Shadow-data-verifiering (KÖR FÖRST)

Per handoff §6.2 gate: Model-4c flipp kräver shadow-data verifierad. Kör dessa queries i Studio SQL och notera resultaten:

```sql
-- 1. Hur mycket shadow-data har samlats sedan aktivering?
SELECT
  COUNT(*) AS total_searches,
  MIN(created_at) AS first_search,
  MAX(created_at) AS last_search,
  ROUND(EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) / 3600, 1) AS hours_of_data,
  COUNT(DISTINCT DATE(created_at)) AS distinct_days
FROM matching_shadow_log;

-- 2. v1 vs v2 top-5-overlap + Spearman rho (daglig agg)
SELECT * FROM v_shadow_mode_stats ORDER BY day DESC LIMIT 7;

-- 3. Senaste 10 sökningar
SELECT 
  id, created_at, 
  top5_overlap, 
  spearman_rho,
  jsonb_array_length(v1_ranking) AS v1_count,
  jsonb_array_length(v2_ranking) AS v2_count,
  CASE WHEN providers_ranking IS NOT NULL THEN jsonb_array_length(providers_ranking) ELSE NULL END AS providers_count
FROM matching_shadow_log
ORDER BY created_at DESC
LIMIT 10;

-- 4. Eventuella korrupta rader (spearman_rho utanför [-1,1])
SELECT COUNT(*) AS corrupt_rows FROM matching_shadow_log
WHERE spearman_rho < -1 OR spearman_rho > 1;
```

**Acceptans-kriterier innan Steg 1:**
- ✅ `total_searches >= 10` (minst 10 riktiga kundsökningar, INTE smoke-tests)
- ✅ `corrupt_rows = 0`
- ✅ `v_shadow_mode_stats` visar dagar med data (inte bara smoke-test-data)
- ✅ Mean `top5_overlap >= 3` (v1+v2 har ~60% överlapp → inte helt disjoint)

**Om kriterierna inte uppfylls:** PAUSA. Shadow-mode behöver mer data innan flipp. Återkom om en vecka. Gå EJ till Steg 1.

---

## Steg 1 — Team-aktivering (SAFE, reversibel)

**Vad det gör:** Flippar 4 Solid Service team-medlemmar från `status='onboarding'` → `'aktiv'`. Därmed dyker Solid Service upp som "company"-provider i `find_nearby_providers`.

**Rollback-effekt:** UPDATE-statement. Helt reversibel via rollback-SQL nedan. Inga data raderas.

**FÖRE-tillstånd (rule #31 kontroll):**
```sql
SELECT id, slug, full_name, status, is_active, is_approved, stripe_onboarding_status
FROM cleaners
WHERE id IN (
  '3f16c9d1-b365-4baf-8d72-5f02af911fca',  -- Nasiba Kenjaeva
  'd6e3281a-0c70-4b3f-a1e6-9a98d40860a8',  -- Nilufar Kholdorova
  'a86ec998-1ac5-48f6-b7bd-24f6aeed887e',  -- Dildora Kenjaeva
  'e43c819f-6442-48af-8ce5-f3b306c6c805'   -- Odilov Firdavsiy
)
ORDER BY full_name;
```

Förväntat: 4 rader, alla med `status='onboarding'`.

**APPLY (kör i Studio):**
```sql
BEGIN;

UPDATE cleaners
SET 
  status = 'aktiv',
  is_active = true,
  updated_at = now()
WHERE id IN (
  '3f16c9d1-b365-4baf-8d72-5f02af911fca',  -- Nasiba Kenjaeva
  'd6e3281a-0c70-4b3f-a1e6-9a98d40860a8',  -- Nilufar Kholdorova
  'a86ec998-1ac5-48f6-b7bd-24f6aeed887e',  -- Dildora Kenjaeva
  'e43c819f-6442-48af-8ce5-f3b306c6c805'   -- Odilov Firdavsiy
)
  AND status = 'onboarding'
  AND is_company_owner = false
  AND company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'  -- Solid Service
RETURNING id, full_name, status;

-- INSPEKTERA RETURNING. Om exakt 4 rader → COMMIT. Annars → ROLLBACK.
COMMIT;
-- ROLLBACK;  -- alternativt om något är fel
```

**EFTER-verifiering:**
```sql
-- Bekräfta 4 rader är nu aktiva
SELECT COUNT(*) FROM cleaners
WHERE company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
  AND is_company_owner = false
  AND status = 'aktiv';
-- Förväntat: 4
```

**Smoke-test 1a (find_nearby_providers Stockholm):**
```sql
SELECT provider_type, display_name, team_size, min_hourly_rate, distance_km
FROM find_nearby_providers(59.3293, 18.0686)
ORDER BY distance_km;
```

Förväntat: Minst 2 rader — Farhad-solo + Solid Service (`provider_type='company'`, `team_size=4`).

**Smoke-test 1b (v_cleaners_public för boka.html):**
```sql
SELECT COUNT(*) AS aktiva_bokbara_cleaners
FROM v_cleaners_public
WHERE status = 'aktiv' AND is_approved = true;
-- Förväntat: 6 (5 solo/VD + 4 Solid Service team) = egentligen 6 beroende på VD-setup
```

**Om smoke-test 1a INTE visar Solid Service:** ROLLBACK och debug. Kontrollera `home_lat/lng`, `service_radius_km`, `is_active`.

---

## Steg 1 ROLLBACK (vid behov)

```sql
BEGIN;

UPDATE cleaners
SET 
  status = 'onboarding',
  updated_at = now()
WHERE id IN (
  '3f16c9d1-b365-4baf-8d72-5f02af911fca',
  'd6e3281a-0c70-4b3f-a1e6-9a98d40860a8',
  'a86ec998-1ac5-48f6-b7bd-24f6aeed887e',
  'e43c819f-6442-48af-8ce5-f3b306c6c805'
)
  AND company_id = '1b969ed7-99f7-4553-be0e-8bedcaa7f5eb'
RETURNING id, full_name, status;

COMMIT;
```

---

## Steg 2 — Model-4c flipp (providers-mode LIVE)

**KÖR ENDAST efter Steg 1 verifierad.** Vänta gärna 15-30 min efter Steg 1 för att säkerställa att inga larm utlöses.

**Vad det gör:** Flippar `platform_settings.matching_algorithm_version` från `'providers-shadow'` → `'providers'`. Klient (boka.html) får därmed `find_nearby_providers`-output istället för v2-output.

**Rollback-effekt:** UPDATE av 1 platform_settings-rad. Reverseras via rollback-SQL. Klient går tillbaka till shadow-mode omedelbart vid nästa request.

**FÖRE-tillstånd:**
```sql
SELECT key, value, updated_at FROM platform_settings 
WHERE key = 'matching_algorithm_version';
-- Förväntat: value='providers-shadow'
```

**APPLY:**
```sql
BEGIN;

UPDATE platform_settings
SET 
  value = 'providers',
  updated_at = now()
WHERE key = 'matching_algorithm_version'
  AND value = 'providers-shadow'  -- guard mot dubbel-flipp
RETURNING key, value, updated_at;

COMMIT;
```

**Smoke-test 2a (kontroll):**
```sql
SELECT key, value FROM platform_settings 
WHERE key LIKE 'matching%';
-- Förväntat: matching_algorithm_version='providers'
--            matching_shadow_log_enabled='true' (shadow fortsätter logga, bra för kontinuerlig A/B)
```

**Smoke-test 2b (klient-upplevelse):**

Öppna https://spick.se/boka.html i en INCOGNITO browser och välj:
- Tjänst: Hemstädning
- Datum: imorgon
- Tid: 10:00
- Adress: nära Stockholm (Odenplan, Vasastan)

Steg 2 ska visa BÅDE Farhad-solo OCH Solid Service-kortet (med "👥 Team med 4 städare"-badge via Model-4b).

**Smoke-test 2c (curl-test av boka.html matching-wrapper):**
```bash
curl -X POST https://urjeijcncsyuletprydy.supabase.co/functions/v1/matching-wrapper \
  -H "Content-Type: application/json" \
  -H "apikey: <ANON_KEY>" \
  -d '{"customer_lat":59.3293,"customer_lng":18.0686,"service":"Hemstädning","booking_date":"2026-04-28","booking_time":"10:00","booking_hours":3}' | jq .
```

Förväntat: `{"cleaners": [...], "algorithm_version": "providers", "shadow_meta": null}`. Cleaners-listan innehåller Solid Service med `provider_type='company'` + `team_size=4`.

---

## Steg 2 ROLLBACK (vid behov)

```sql
BEGIN;

UPDATE platform_settings
SET 
  value = 'providers-shadow',
  updated_at = now()
WHERE key = 'matching_algorithm_version'
  AND value = 'providers'
RETURNING key, value;

COMMIT;
```

Klient återgår till shadow-mode OMEDELBART vid nästa request (ingen cache-invalidering behövs).

---

## Övervakning efter Steg 2

Kör dessa queries under de första 48h efter flip:

```sql
-- Nya bokningar per matching-version
SELECT 
  matching_algorithm_version,
  COUNT(*) AS bookings,
  AVG(chosen_cleaner_match_score) AS avg_match_score
FROM bookings
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY matching_algorithm_version;

-- Företag-andel av nya bokningar (= Model-4c-värdet konkret)
SELECT 
  COUNT(*) FILTER (WHERE company_id IS NOT NULL) AS company_bookings,
  COUNT(*) FILTER (WHERE company_id IS NULL) AS solo_bookings,
  ROUND(100.0 * COUNT(*) FILTER (WHERE company_id IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS company_pct
FROM bookings
WHERE created_at >= NOW() - INTERVAL '48 hours';

-- Avvisnings-rate per primär cleaner
SELECT 
  cleaner_id,
  COUNT(*) FILTER (WHERE status IN ('rejected', 'awaiting_reassignment', 'awaiting_company_proposal')) AS declined,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('rejected', 'awaiting_reassignment', 'awaiting_company_proposal')) / NULLIF(COUNT(*), 0), 1) AS decline_pct
FROM bookings
WHERE created_at >= NOW() - INTERVAL '48 hours'
  AND cleaner_id IS NOT NULL
GROUP BY cleaner_id
ORDER BY decline_pct DESC;
```

**Larm-trösklar (rollback om något överträds):**
- Ingen booking-completion på >= 4 timmar efter flipp (potentiellt kritisk bug)
- Decline-rate per cleaner > 30% (matching ger dåliga förslag)
- Console-errors på boka.html > baseline
- Customer-support-volym ökar synligt

---

## Loggning av denna flipp

Skriv en rad i SESSION-HANDOFF efter exekvering:

```markdown
### Team-aktivering + Model-4c flipp körda 2026-04-XX

Steg 1 exekverat 2026-04-XX HH:MM. 4 team-medlemmar aktiverade.
Steg 0 shadow-data: X searches, Y dagar, mean_overlap=Z, mean_rho=W.
Steg 2 flipp exekverat 2026-04-XX HH:MM.
Post-flipp 48h: A nya bokningar, B% företag, högsta decline-rate=C%.
Status: [OK / Rollbackad till providers-shadow pga Y]
```

---

## Claudes begränsningar

Denna runbook är förberedd men INTE exekverad. Claude (denna session) kan inte köra prod-UPDATE:s via anon-REST (RLS blockerar). Farhad kör alla steg i Studio SQL Editor efter egen review.

Om du vill att Claude exekverar i framtid: Supabase CLI med service_role-key, eller `supabase-mcp`-integration.

**Session-verifiering (2026-04-27, pre-runbook-skrivning, rule #31):**
- Team-medlemmarnas state verifierat via `v_cleaners_public` REST-call
- VD Zivar's Stripe-complete verifierat via samma
- `find_nearby_providers` returnerar idag bara Farhad-solo (1 rad)
- Platform_settings matching-keys är `'providers-shadow'` + `'true'`

# Shadow-mode pilot-analys (§3.9)

**Status:** Kategori A ✓ (Sprint 2 Dag 3a, 2026-04-25) · Kategori B ✓ infrastruktur klar (Sprint 2 Dag 3b) — väntar shadow-mode-bokningar för data

**Primärkälla:** [matching-algorithm.md §14](matching-algorithm.md) (metrik-plan från designdokumentet)

---

## 1. Vad loggas (påminnelse)

`matching_shadow_log`-tabellen (migration [`20260424231000`](../../supabase/migrations/20260424231000_sprint2d1_matching_shadow_log.sql)) fylls av `matching-wrapper`-EF när `platform_settings.matching_algorithm_version='shadow'` OCH `matching_shadow_log_enabled='true'`.

Per sökning (ett anrop från `boka.html` steg 2) loggas:

- `v1_ranking` jsonb — array `[{cleaner_id, rank, distance_km}, ...]`
- `v2_ranking` jsonb — array `[{cleaner_id, rank, match_score}, ...]`
- `top5_overlap` integer — antal gemensamma cleaners i top-5 av båda rankings
- `spearman_rho` numeric(4,3) — rank-korrelation på **lokala** ranks över gemensamma cleaners
- `customer_lat/lng`, `booking_date/time` — sökkontext
- `booking_id`, `chosen_cleaner_id` — NULL i kategori A (blir ifyllda i §3.9b)

## 2. Metric-plan (officiell från designdok §14)

30-dagars pilot, **go/no-go-tröskel** för v2-rollout (100% trafik):

| Metrik | Definition | Mål | Kategori |
|---|---|---|---|
| Acceptance-rate | Andel bokningar där kund valde cleaner från top-3 av v2 | ≥ 75 % | B |
| Distance-kompromiss | Median `distance_km` för valda cleaners | Inom +20 % av v1-median | B |
| Cold-start-jobb | Andel nya cleaners (< 30 dagar) som fick ≥ 1 bokning | > 50 % | B |
| Rating-utfall | Genomsnittlig rating för v2-bokningar | ≥ v1-rating | B |
| Avbokningar | Andel v2-bokningar som avbokades före utförande | ≤ v1-rate | B |
| Pref-kvalitet | Median `chosen_cleaner_match_score` i `bookings` | ≥ 0.75 | B |

**Kategori A (shadow-only, tillgänglig NU):**

- Top-5-overlap distribution
- Spearman rho distribution
- Söknings-frekvens och volym
- Stability over time
- Geografi-spridning

**Kategori B (kräver booking-koppling, §3.9b):** Samtliga tabell-metrics ovan. Behöver `chosen_cleaner_id`-länk mellan shadow_log och booking.

## 3. VIEWs (deployad Sprint 2 Dag 3a)

Migration: [`20260425130000_sprint2d3_shadow_analysis_views.sql`](../../supabase/migrations/20260425130000_sprint2d3_shadow_analysis_views.sql)

### 3.1 `v_shadow_mode_stats`

Daglig agg för tidsserie-analys. Kolumner:

| Kolumn | Typ | Betydelse |
|---|---|---|
| `day` | date | Truncat till dag |
| `searches` | bigint | Antal sökningar |
| `mean_top5_overlap` | numeric | Genomsnittlig overlap [0..5] |
| `stddev_top5_overlap` | numeric | Spridning. Stor = instabilitet |
| `mean_spearman_rho` | numeric | Genomsnittlig rank-korrelation [-1..1] |
| `stddev_spearman_rho` | numeric | Spridning på rho |
| `min_spearman_rho`, `max_spearman_rho` | numeric | Extremvärden |
| `mean_v1_count`, `mean_v2_count` | numeric | Genomsnittligt antal cleaners per algoritm (v2 hårdare filter → ofta < v1) |

```sql
SELECT * FROM v_shadow_mode_stats;
```

### 3.2 `v_shadow_mode_histogram`

Distribution av `top5_overlap` (6 buckets: 0..5) och `spearman_rho` (8 buckets från -1 till 1).

```sql
SELECT * FROM v_shadow_mode_histogram;
```

**Tolkning:**
- `top5_overlap = 5` dominerar → v1 och v2 är praktiskt lika i topp-5. v2 tillför inte signifikant ny sortering.
- `top5_overlap` bred (0-5) → algoritmerna gör olika val → shadow-data är meningsfull för go/no-go.
- `spearman_rho` klustrar kring 1.0 → rank-ordning nästan identisk.
- `spearman_rho` klustrar kring 0 → rank-ordning är oberoende.

### 3.3 `v_shadow_mode_recent`

Senaste 48h för debug + smoke-test. Använd när shadow-mode är aktivt för att se senaste sökningarna.

```sql
SELECT id, created_at, top5_overlap, spearman_rho, v1_count, v2_count
FROM v_shadow_mode_recent
LIMIT 20;
```

## 4. Standalone-queries (kategori A)

Kör i Supabase Studio SQL Editor. Kräver admin-JWT via `is_admin()`.

### 4.1 Volym-growth

```sql
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS searches
FROM matching_shadow_log
WHERE created_at >= NOW() - INTERVAL '48 hours'
GROUP BY hour
ORDER BY hour;
```

Förväntat under pilot: > 10 sökningar/timme vid peak (dagtid), > 50/dag totalt.

### 4.2 Geografi-spridning

```sql
SELECT
  ROUND(customer_lat::numeric, 2) AS lat_bucket,
  ROUND(customer_lng::numeric, 2) AS lng_bucket,
  COUNT(*) AS searches
FROM matching_shadow_log
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY lat_bucket, lng_bucket
ORDER BY searches DESC
LIMIT 20;
```

Används för att se om vissa geo-områden har extrem v1/v2-divergens — kan signalera behov av regional kalibrering.

### 4.3 Cleaners som oftast rankat högre av v2 än v1

```sql
WITH v1_ranks AS (
  SELECT
    (r->>'cleaner_id')::uuid AS cleaner_id,
    (r->>'rank')::int AS rank
  FROM matching_shadow_log,
       jsonb_array_elements(v1_ranking) AS r
  WHERE created_at >= NOW() - INTERVAL '30 days'
),
v2_ranks AS (
  SELECT
    (r->>'cleaner_id')::uuid AS cleaner_id,
    (r->>'rank')::int AS rank
  FROM matching_shadow_log,
       jsonb_array_elements(v2_ranking) AS r
  WHERE created_at >= NOW() - INTERVAL '30 days'
),
joined AS (
  SELECT
    v1.cleaner_id,
    AVG(v1.rank) AS avg_v1_rank,
    AVG(v2.rank) AS avg_v2_rank,
    COUNT(*) AS appearances
  FROM v1_ranks v1
  JOIN v2_ranks v2 USING (cleaner_id)
  GROUP BY v1.cleaner_id
  HAVING COUNT(*) >= 10
)
SELECT
  j.cleaner_id,
  c.first_name,
  c.last_name,
  j.appearances,
  ROUND(j.avg_v1_rank::numeric, 2) AS avg_v1_rank,
  ROUND(j.avg_v2_rank::numeric, 2) AS avg_v2_rank,
  ROUND((j.avg_v1_rank - j.avg_v2_rank)::numeric, 2) AS rank_delta
FROM joined j
LEFT JOIN cleaners c ON c.id = j.cleaner_id
ORDER BY rank_delta DESC
LIMIT 20;
```

`rank_delta > 0` = v2 rankar högre än v1 → cleaners som gynnas av multivariat-algoritmen. Användbart för att förstå vilken typ av cleaner v2 favoriserar (cold-start-boost, preference-match, etc).

### 4.4 Sökningar där v1 och v2 håller med

```sql
SELECT
  COUNT(*) FILTER (WHERE top5_overlap = 5 AND spearman_rho > 0.9) AS high_agreement,
  COUNT(*) FILTER (WHERE top5_overlap BETWEEN 3 AND 4 AND spearman_rho BETWEEN 0.5 AND 0.9) AS moderate_agreement,
  COUNT(*) FILTER (WHERE top5_overlap <= 2 OR spearman_rho < 0.5) AS low_agreement,
  COUNT(*) AS total
FROM matching_shadow_log
WHERE created_at >= NOW() - INTERVAL '30 days';
```

**Tolkning:**
- `high_agreement > 80%` → v2 är i praktiken v1, rollout är lågrisk men inte värdeadderande
- `low_agreement > 30%` → v2 gör signifikant olika val, data är mycket värdefull för go/no-go
- `moderate` i mitten → förväntat utfall

## 5. Kategori B — infrastruktur klar (Sprint 2 Dag 3b)

`matching_shadow_log.booking_id` och `chosen_cleaner_id` fylls i vid varje shadow-mode-bokning. Korrelations-flöde:

1. **EF `matching-wrapper`** INSERT:ar shadow-rad + `SELECT id` → returnerar `shadow_meta.shadow_log_id` i response.
2. **`boka.html`** sparar `efPayload.shadow_meta?.shadow_log_id` i `state.shadowLogId` (rad ~1953).
3. **`boka.html`** skickar `shadow_log_id: state.shadowLogId || undefined` i `booking-create`-body (rad ~2970).
4. **`booking-create`** deconstructar `shadow_log_id` (rad 63) och kör `UPDATE matching_shadow_log SET booking_id, chosen_cleaner_id WHERE id = shadow_log_id` efter lyckad booking-INSERT (rad ~420). Fail-soft — log-failure blockerar INTE betalning.

**Smoke-test (Sprint 2 Dag 3b):** Shadow-log-rad `dc4b3502-9fac-4c1d-b110-d2dab0d140fc` skapad via EF, `booking_id` + `chosen_cleaner_id` NULL redo för första verkliga shadow-bokning att fylla.

**Data-tillgänglighet:** Första verkliga shadow-mode-bokning (kund öppnar boka.html, väljer städare, bokar, betalar) fyller i korrelations-kolumnerna. Därefter kan kategori B-queries köras:

### 5.1 Acceptance-rate (chosen i top-3 av v2)

```sql
WITH chosen_in_v2 AS (
  SELECT
    s.id AS shadow_id,
    s.chosen_cleaner_id,
    (SELECT (r->>'rank')::int
     FROM jsonb_array_elements(s.v2_ranking) AS r
     WHERE (r->>'cleaner_id')::uuid = s.chosen_cleaner_id
     LIMIT 1) AS chosen_v2_rank
  FROM matching_shadow_log s
  WHERE s.chosen_cleaner_id IS NOT NULL
    AND s.created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  COUNT(*) AS total_bookings,
  COUNT(*) FILTER (WHERE chosen_v2_rank <= 3) AS top3_hits,
  ROUND(100.0 * COUNT(*) FILTER (WHERE chosen_v2_rank <= 3) / NULLIF(COUNT(*), 0), 1) AS acceptance_rate_pct
FROM chosen_in_v2;
```

Mål per §14: ≥ 75%. Under 75% → v2 behöver kalibreras.

### 5.2 Distance-kompromiss

```sql
-- Jämför median-distance för chosen cleaner mellan v1-sortering och v2-sortering
-- (kräver både sortning att jämföra — data tillgänglig via v1_ranking/v2_ranking)
```

(Skissas när §3.9b är deployad och data finns.)

## 6. Go/no-go-beslut (efter 30d)

Enligt §14 kalibrerings-loop:

> "Om acceptance sjunker → höj `distance` eller `rating`-vikt. Om cold-start misslyckas → höj `exploration_bonus` eller förläng fönstret från 30 → 45 dagar. Regel: **ingen vikt-ändring utan minst 100 datapunkter och 7 dagars observation**."

Rollout-sekvens per §10.3:

1. `v1` default (nu: `'shadow'` för 48h data-insamling)
2. `shadow` 48h → samla diff-data (PÅGÅENDE)
3. `v2` 10% trafik (kräver traffic-split-mekanik — §3.7 framtida sub-steg)
4. Efter 30d: analys → go/no-go
5. `v2` 100% → plan för sunset av `find_nearby_cleaners_v1`

## 7. Relaterade files

- **Migration (shadow-log-tabell):** [`20260424231000_sprint2d1_matching_shadow_log.sql`](../../supabase/migrations/20260424231000_sprint2d1_matching_shadow_log.sql)
- **Migration (v1-RPC):** [`20260425120000_sprint2d2_find_nearby_cleaners_v1.sql`](../../supabase/migrations/20260425120000_sprint2d2_find_nearby_cleaners_v1.sql)
- **Migration (denna, VIEWs):** [`20260425130000_sprint2d3_shadow_analysis_views.sql`](../../supabase/migrations/20260425130000_sprint2d3_shadow_analysis_views.sql)
- **EF matching-wrapper:** [`supabase/functions/matching-wrapper/index.ts`](../../supabase/functions/matching-wrapper/index.ts)
- **Diff-helpers + unit-tester:** [`supabase/functions/_shared/matching-diff.ts`](../../supabase/functions/_shared/matching-diff.ts), [`supabase/functions/_tests/matching/matching-diff.test.ts`](../../supabase/functions/_tests/matching/matching-diff.test.ts)
- **Design-dokument:** [`docs/architecture/matching-algorithm.md`](matching-algorithm.md) §10, §14

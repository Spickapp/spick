// supabase/functions/_shared/matching-diff.ts
// ──────────────────────────────────────────────────────────────────
// Shadow-mode diff-helpers för §3.7-full A/B-ramverk.
//
// Används av matching-wrapper EF (§3.7-full Step 2b) för att beräkna
// top5-overlap + Spearman rank correlation mellan v1- och v2-rankings
// innan INSERT i matching_shadow_log.
//
// Isolerade från EF för att möjliggöra unit-tester utan Supabase-mock.
//
// Primärkälla:
//   - docs/architecture/matching-algorithm.md §10.2 (audit-kolumner)
//   - supabase/migrations/20260424231000_sprint2d1_matching_shadow_log.sql
//     (v1_ranking/v2_ranking jsonb-struktur, top5_overlap integer,
//      spearman_rho numeric(4,3))
// ──────────────────────────────────────────────────────────────────

export interface V1RankingEntry {
  cleaner_id: string;
  rank: number;
  distance_km: number;
}

export interface V2RankingEntry {
  cleaner_id: string;
  rank: number;
  match_score: number;
}

// v1-RPC returnerar 24 fält (find_nearby_cleaners_v1, distance-sort).
// v2-RPC returnerar 33 fält (find_nearby_cleaners, multivariat).
// När 'shadow'-läge returnerar v1-ordning till klient behöver vi mappa
// upp v1-schema till v2-schema så boka.html alltid får samma struktur.
export interface V2Cleaner {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  hourly_rate: number | null;
  profile_image_url: string | null;
  avatar_url: string | null;
  avg_rating: number | null;
  total_reviews: number | null;
  review_count: number | null;
  services: unknown;
  city: string | null;
  identity_verified: boolean | null;
  home_lat: number | null;
  home_lng: number | null;
  pet_pref: string | null;
  elevator_pref: string | null;
  distance_km: number | null;
  company_id: string | null;
  is_company_owner: boolean | null;
  company_name: string | null;
  completed_jobs: number | null;
  has_fskatt: boolean | null;
  match_score: number | null;
  distance_score: number | null;
  rating_score: number | null;
  completed_jobs_score: number | null;
  preference_match_score: number | null;
  verified_score: number | null;
  exploration_bonus: number | null;
  history_multiplier: number | null;
  company_display_name: string | null;

  // Sprint Model-4a extensions — endast satta i 'providers'-läge
  // Null/undefined i v1, v2, shadow, providers-shadow-lägen.
  // Gör det möjligt för klient (boka.html) att rendera team-aggregat.
  provider_type?: 'solo' | 'company' | null;
  provider_id?: string | null;
  representative_cleaner_id?: string | null;
  team_size?: number | null;
  aggregate_rating?: number | null;
  aggregate_review_count?: number | null;
  aggregate_completed_jobs?: number | null;
  min_hourly_rate?: number | null;
}

/**
 * Top-N overlap mellan två rankings — antal cleaner_ids som finns i
 * top-N av båda. N=5 default enligt designdok §10.2.
 *
 * Returnerar 0-5 (inclusive). Om n är mindre än 5 räknas det som finns.
 */
export function calculateTopNOverlap<
  T1 extends { cleaner_id: string },
  T2 extends { cleaner_id: string },
>(
  v1: readonly T1[],
  v2: readonly T2[],
  n = 5,
): number {
  const v1Top = new Set(v1.slice(0, n).map((r) => r.cleaner_id));
  const v2Top = new Set(v2.slice(0, n).map((r) => r.cleaner_id));
  let overlap = 0;
  for (const id of v1Top) {
    if (v2Top.has(id)) overlap++;
  }
  return overlap;
}

/**
 * Spearman rank correlation mellan två rankings.
 *
 * Formel: ρ = 1 - (6 * Σd²) / (n * (n² - 1))
 * där d = LOKAL rank-skillnad för samma cleaner_id inom delmängden
 * gemensamma cleaners. n = antal gemensamma.
 *
 * VIKTIGT: Använder *lokala* ranks (1..n_common), INTE de globala
 * ranks från v1/v2-listorna. Standardformeln kräver att ranks är
 * en permutation av 1..n — om v1 har 5 cleaners och v2 har 2 med 2
 * gemensamma, globala ranks (t.ex. v1_rank=4, v2_rank=1) ger värden
 * utanför [-1, 1]. Sprint 2 Dag 2 bugfix efter prod-test visade
 * spearman_rho=-8 pga globala ranks på asymmetriska listor.
 *
 * Returvärde i [-1, 1]:
 *   +1 = identisk lokal ordning
 *    0 = ingen korrelation (eller n < 2)
 *   -1 = exakt inverterad lokal ordning
 *
 * Edge cases:
 *   - Färre än 2 cleaners gemensamma → returnerar 0 (otillräcklig data)
 *   - Cleaners som bara finns i en ranking ignoreras
 *
 * Avrundning till 3 decimaler matchar shadow_log.spearman_rho numeric(4,3).
 */
export function calculateSpearmanRho<
  T1 extends { cleaner_id: string; rank: number },
  T2 extends { cleaner_id: string; rank: number },
>(
  v1: readonly T1[],
  v2: readonly T2[],
): number {
  const v1Map = new Map(v1.map((r) => [r.cleaner_id, r.rank]));
  const v2Map = new Map(v2.map((r) => [r.cleaner_id, r.rank]));

  const commonIds: string[] = [];
  for (const id of v1Map.keys()) {
    if (v2Map.has(id)) commonIds.push(id);
  }

  const n = commonIds.length;
  if (n < 2) return 0;

  // Tilldela LOKALA ranks på de gemensamma cleaners.
  // Sortera efter globala v1-rank, assign lokal 1..n. Samma för v2.
  const sortedByV1 = [...commonIds].sort(
    (a, b) => (v1Map.get(a) ?? 0) - (v1Map.get(b) ?? 0),
  );
  const localV1Rank = new Map(sortedByV1.map((id, i) => [id, i + 1]));

  const sortedByV2 = [...commonIds].sort(
    (a, b) => (v2Map.get(a) ?? 0) - (v2Map.get(b) ?? 0),
  );
  const localV2Rank = new Map(sortedByV2.map((id, i) => [id, i + 1]));

  let sumD2 = 0;
  for (const id of commonIds) {
    const r1 = localV1Rank.get(id)!;
    const r2 = localV2Rank.get(id)!;
    const d = r1 - r2;
    sumD2 += d * d;
  }

  const rho = 1 - (6 * sumD2) / (n * (n * n - 1));

  // Avrunda till 3 decimaler för DB-insertion (numeric(4,3))
  return Math.round(rho * 1000) / 1000;
}

/**
 * Mappa v1-RPC-resultat (24 fält) till v2-schema (33 fält) med NULL scores.
 *
 * Används när 'shadow'-läge returnerar v1-ordning till klient. Klienten
 * förväntar samma struktur oavsett algorithm_version (boka.html renderar
 * match_score om !=null). Null-scores signalerar att v1 kördes.
 *
 * company_display_name fylls från company_name (v1-fält) eftersom v2:s
 * logik (c.company_name || c.first_name) inte kan rekonstrueras här.
 */
export function mapV1ToV2Schema(
  v1Cleaners: ReadonlyArray<Record<string, unknown>>,
): V2Cleaner[] {
  return v1Cleaners.map((c) => ({
    id: String(c.id ?? ""),
    full_name: (c.full_name as string) ?? null,
    first_name: (c.first_name as string) ?? null,
    last_name: (c.last_name as string) ?? null,
    bio: (c.bio as string) ?? null,
    hourly_rate: (c.hourly_rate as number) ?? null,
    profile_image_url: (c.profile_image_url as string) ?? null,
    avatar_url: (c.avatar_url as string) ?? null,
    avg_rating: (c.avg_rating as number) ?? null,
    total_reviews: (c.total_reviews as number) ?? null,
    review_count: (c.review_count as number) ?? null,
    services: c.services ?? null,
    city: (c.city as string) ?? null,
    identity_verified: (c.identity_verified as boolean) ?? null,
    home_lat: (c.home_lat as number) ?? null,
    home_lng: (c.home_lng as number) ?? null,
    pet_pref: (c.pet_pref as string) ?? null,
    elevator_pref: (c.elevator_pref as string) ?? null,
    distance_km: (c.distance_km as number) ?? null,
    company_id: (c.company_id as string) ?? null,
    is_company_owner: (c.is_company_owner as boolean) ?? null,
    company_name: (c.company_name as string) ?? null,
    completed_jobs: (c.completed_jobs as number) ?? null,
    has_fskatt: (c.has_fskatt as boolean) ?? null,
    match_score: null,
    distance_score: null,
    rating_score: null,
    completed_jobs_score: null,
    preference_match_score: null,
    verified_score: null,
    exploration_bonus: null,
    history_multiplier: null,
    company_display_name: (c.company_name as string) ?? null,
  }));
}

/**
 * Sprint Model-4a: mappa find_nearby_providers-output till V2Cleaner-format.
 *
 * Providers-RPC returnerar (provider_type, provider_id, representative_cleaner_id,
 * display_name, aggregate_*, min_hourly_rate, team_size, ...). Klienten (boka.html)
 * förväntar V2Cleaner-struktur. Denna helper bygger en bro:
 *
 *   - id = representative_cleaner_id (så booking-create kan använda samma
 *     cleaner_id som tidigare)
 *   - full_name = display_name (för 'company' = företagsnamnet)
 *   - hourly_rate = min_hourly_rate
 *   - avg_rating = aggregate_rating
 *   - review_count = aggregate_review_count
 *   - completed_jobs = aggregate_completed_jobs
 *   - company_id populerad om provider_type='company' (booking-create routar
 *     Stripe-transfer via is_company_owner = VD:n)
 *   - Extension-fält (provider_type, team_size m.fl.) bevaras för klient-UI
 *
 * V2-specifika score-fält blir null (providers har inget match_score i Model-2a).
 */
export function mapProvidersToV2Cleaners(
  providers: ReadonlyArray<Record<string, unknown>>,
): V2Cleaner[] {
  return providers.map((p) => {
    const providerType = (p.provider_type as 'solo' | 'company') ?? 'solo';
    const isCompany = providerType === 'company';
    return {
      id: String(p.representative_cleaner_id ?? p.provider_id ?? ''),
      full_name: (p.display_name as string) ?? null,
      first_name: null,
      last_name: null,
      bio: (p.bio as string) ?? null,
      hourly_rate: (p.min_hourly_rate as number) ?? null,
      profile_image_url: null,
      avatar_url: (p.avatar_url as string) ?? null,
      avg_rating: (p.aggregate_rating as number) ?? null,
      total_reviews: (p.aggregate_review_count as number) ?? null,
      review_count: (p.aggregate_review_count as number) ?? null,
      services: p.services ?? null,
      city: (p.city as string) ?? null,
      identity_verified: (p.identity_verified as boolean) ?? null,
      home_lat: null,
      home_lng: null,
      pet_pref: null,
      elevator_pref: null,
      distance_km: (p.distance_km as number) ?? null,
      company_id: isCompany ? String(p.provider_id ?? '') : null,
      is_company_owner: null, // providers exponerar inte detta
      company_name: isCompany ? (p.display_name as string) : null,
      completed_jobs: (p.aggregate_completed_jobs as number) ?? null,
      has_fskatt: (p.has_fskatt as boolean) ?? null,
      match_score: null,
      distance_score: null,
      rating_score: null,
      completed_jobs_score: null,
      preference_match_score: null,
      verified_score: null,
      exploration_bonus: null,
      history_multiplier: null,
      company_display_name: isCompany ? (p.display_name as string) : null,
      // Model-4a extensions
      provider_type: providerType,
      provider_id: String(p.provider_id ?? ''),
      representative_cleaner_id: String(p.representative_cleaner_id ?? ''),
      team_size: (p.team_size as number) ?? 1,
      aggregate_rating: (p.aggregate_rating as number) ?? null,
      aggregate_review_count: (p.aggregate_review_count as number) ?? null,
      aggregate_completed_jobs: (p.aggregate_completed_jobs as number) ?? null,
      min_hourly_rate: (p.min_hourly_rate as number) ?? null,
    };
  });
}

/**
 * Bygg V1-ranking-array från RPC-resultat (för shadow_log.v1_ranking jsonb).
 * Ordningen i input är auktoritativ (RPC:n returnerar redan sorterat).
 */
export function buildV1Ranking(
  v1Cleaners: ReadonlyArray<Record<string, unknown>>,
): V1RankingEntry[] {
  return v1Cleaners.map((c, i) => ({
    cleaner_id: String(c.id ?? ""),
    rank: i + 1,
    distance_km: Number(c.distance_km ?? 0),
  }));
}

/**
 * Bygg V2-ranking-array från RPC-resultat (för shadow_log.v2_ranking jsonb).
 */
export function buildV2Ranking(
  v2Cleaners: ReadonlyArray<Record<string, unknown>>,
): V2RankingEntry[] {
  return v2Cleaners.map((c, i) => ({
    cleaner_id: String(c.id ?? ""),
    rank: i + 1,
    match_score: Number(c.match_score ?? 0),
  }));
}

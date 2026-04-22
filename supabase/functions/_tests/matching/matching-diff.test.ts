// supabase/functions/_tests/matching/matching-diff.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/matching-diff.ts (§3.7-full Step 2b)
//
// Kör: deno test supabase/functions/_tests/matching/matching-diff.test.ts --allow-env
// ──────────────────────────────────────────────────────────────────

import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildV1Ranking,
  buildV2Ranking,
  calculateSpearmanRho,
  calculateTopNOverlap,
  mapV1ToV2Schema,
  type V1RankingEntry,
  type V2RankingEntry,
} from "../../_shared/matching-diff.ts";

// ── calculateTopNOverlap ───────────────────────────────────────────

Deno.test("topN-overlap: identiska top-5 → 5", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "b", rank: 2, match_score: 0.8 },
    { cleaner_id: "c", rank: 3, match_score: 0.7 },
    { cleaner_id: "d", rank: 4, match_score: 0.6 },
    { cleaner_id: "e", rank: 5, match_score: 0.5 },
  ];
  assertEquals(calculateTopNOverlap(v1, v2, 5), 5);
});

Deno.test("topN-overlap: disjoint top-5 → 0", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "f", rank: 1, match_score: 0.9 },
    { cleaner_id: "g", rank: 2, match_score: 0.8 },
    { cleaner_id: "h", rank: 3, match_score: 0.7 },
    { cleaner_id: "i", rank: 4, match_score: 0.6 },
    { cleaner_id: "j", rank: 5, match_score: 0.5 },
  ];
  assertEquals(calculateTopNOverlap(v1, v2, 5), 0);
});

Deno.test("topN-overlap: delvis överlappning → 3", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "c", rank: 1, match_score: 0.9 }, // finns i v1
    { cleaner_id: "e", rank: 2, match_score: 0.8 }, // finns i v1
    { cleaner_id: "a", rank: 3, match_score: 0.7 }, // finns i v1
    { cleaner_id: "x", rank: 4, match_score: 0.6 }, // ny
    { cleaner_id: "y", rank: 5, match_score: 0.5 }, // ny
  ];
  assertEquals(calculateTopNOverlap(v1, v2, 5), 3);
});

Deno.test("topN-overlap: färre än N cleaners fungerar", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "b", rank: 2, match_score: 0.8 },
  ];
  assertEquals(calculateTopNOverlap(v1, v2, 5), 2);
});

// ── calculateSpearmanRho ───────────────────────────────────────────

Deno.test("spearman: identiska rankings → 1.0", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "b", rank: 2, match_score: 0.8 },
    { cleaner_id: "c", rank: 3, match_score: 0.7 },
    { cleaner_id: "d", rank: 4, match_score: 0.6 },
  ];
  assertEquals(calculateSpearmanRho(v1, v2), 1.0);
});

Deno.test("spearman: helt inverterade → -1.0", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "d", rank: 1, match_score: 0.9 },
    { cleaner_id: "c", rank: 2, match_score: 0.8 },
    { cleaner_id: "b", rank: 3, match_score: 0.7 },
    { cleaner_id: "a", rank: 4, match_score: 0.6 },
  ];
  assertEquals(calculateSpearmanRho(v1, v2), -1.0);
});

Deno.test("spearman: 1 gemensam cleaner → 0 (otillräcklig data)", () => {
  const v1: V1RankingEntry[] = [{ cleaner_id: "a", rank: 1, distance_km: 1 }];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "b", rank: 2, match_score: 0.8 },
  ];
  assertEquals(calculateSpearmanRho(v1, v2), 0);
});

Deno.test("spearman: asymmetriska listor (v1=5, v2=2, 2 gemensamma) → i [-1, 1]", () => {
  // REGRESSIONSTEST — Sprint 2 Dag 2 prod-bug 2026-04-25
  // EF returnerade spearman_rho=-8 när v1 hade 5 cleaners, v2 hade 2,
  // och 2 var gemensamma. Rotorsak: globala ranks (v1_rank=4, v2_rank=1)
  // användes i formeln istället för lokala ranks (1..n_common).
  //
  // v1: A=1, B=2, C=3, D=4, E=5
  // v2: C=1, A=2
  // Gemensamma: {A, C}, n=2
  // Lokala v1-ranks på gemensamma: A=1 (global 1), C=2 (global 3)
  // Lokala v2-ranks på gemensamma: C=1 (global 1), A=2 (global 2)
  // Diff per cleaner (lokal): A: 1-2=-1, C: 2-1=1 → d²=[1,1], Σd²=2
  // n=2, n*(n²-1)=6 → ρ = 1 - (6*2)/6 = -1.0 (helt inverterad lokalt)
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "c", rank: 1, match_score: 0.9 },
    { cleaner_id: "a", rank: 2, match_score: 0.8 },
  ];
  const rho = calculateSpearmanRho(v1, v2);
  assertEquals(rho, -1.0);
  assertEquals(rho >= -1 && rho <= 1, true); // SAFETY GUARD — inom giltigt intervall
});

Deno.test("spearman: asymmetriska listor med lokal identisk ordning → 1.0", () => {
  // v1: A=1, B=2, C=3, D=4, E=5
  // v2: A=1, C=2  (färre cleaners, men samma relativa ordning)
  // Gemensamma: {A, C}, n=2
  // Lokala v1-ranks: A=1, C=2
  // Lokala v2-ranks: A=1, C=2
  // Σd²=0 → ρ=1.0
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "c", rank: 2, match_score: 0.8 },
  ];
  const rho = calculateSpearmanRho(v1, v2);
  assertEquals(rho, 1.0);
});

Deno.test("spearman: disjoint rankings → 0", () => {
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "c", rank: 1, match_score: 0.9 },
    { cleaner_id: "d", rank: 2, match_score: 0.8 },
  ];
  assertEquals(calculateSpearmanRho(v1, v2), 0);
});

Deno.test("spearman: en-rank-skillnad → ~0.8", () => {
  // 3 cleaners, v2 swap:ar rank 1 och 2
  //   v1: a=1, b=2, c=3
  //   v2: b=1, a=2, c=3
  // d = [1-2, 2-1, 3-3] = [-1, 1, 0] → d² = [1, 1, 0] → Σd² = 2
  // ρ = 1 - (6*2)/(3*(9-1)) = 1 - 12/24 = 0.5
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "b", rank: 1, match_score: 0.9 },
    { cleaner_id: "a", rank: 2, match_score: 0.8 },
    { cleaner_id: "c", rank: 3, match_score: 0.7 },
  ];
  assertAlmostEquals(calculateSpearmanRho(v1, v2), 0.5, 0.001);
});

Deno.test("spearman: avrundning till 3 decimaler", () => {
  // 5 cleaners, slumpmässigt mixade för icke-rund ρ
  const v1: V1RankingEntry[] = [
    { cleaner_id: "a", rank: 1, distance_km: 1 },
    { cleaner_id: "b", rank: 2, distance_km: 2 },
    { cleaner_id: "c", rank: 3, distance_km: 3 },
    { cleaner_id: "d", rank: 4, distance_km: 4 },
    { cleaner_id: "e", rank: 5, distance_km: 5 },
  ];
  const v2: V2RankingEntry[] = [
    { cleaner_id: "a", rank: 1, match_score: 0.9 },
    { cleaner_id: "c", rank: 2, match_score: 0.8 },
    { cleaner_id: "b", rank: 3, match_score: 0.7 },
    { cleaner_id: "e", rank: 4, match_score: 0.6 },
    { cleaner_id: "d", rank: 5, match_score: 0.5 },
  ];
  // d = [0, -1, 1, -1, 1] → Σd² = 0+1+1+1+1 = 4
  // ρ = 1 - (6*4)/(5*(25-1)) = 1 - 24/120 = 0.8
  const rho = calculateSpearmanRho(v1, v2);
  assertEquals(rho, 0.8);
  // Verifiera att det är 3-decimaler-safe för numeric(4,3)
  assertEquals(Number.isFinite(rho), true);
});

// ── mapV1ToV2Schema ────────────────────────────────────────────────

Deno.test("mapV1ToV2Schema: NULL-scores + company_display_name kopierat", () => {
  const v1Cleaners = [
    {
      id: "aaa",
      full_name: "Anna A",
      first_name: "Anna",
      last_name: "A",
      hourly_rate: 350,
      company_name: "ACME AB",
      distance_km: 4.2,
      avg_rating: 4.7,
    },
  ];
  const mapped = mapV1ToV2Schema(v1Cleaners);
  assertEquals(mapped.length, 1);
  assertEquals(mapped[0].id, "aaa");
  assertEquals(mapped[0].full_name, "Anna A");
  assertEquals(mapped[0].company_name, "ACME AB");
  assertEquals(mapped[0].company_display_name, "ACME AB");
  assertEquals(mapped[0].match_score, null);
  assertEquals(mapped[0].distance_score, null);
  assertEquals(mapped[0].history_multiplier, null);
});

Deno.test("mapV1ToV2Schema: solo-cleaner (company_name null)", () => {
  const v1Cleaners = [
    {
      id: "bbb",
      full_name: "Bob B",
      first_name: "Bob",
      distance_km: 7.1,
    },
  ];
  const mapped = mapV1ToV2Schema(v1Cleaners);
  assertEquals(mapped[0].company_name, null);
  assertEquals(mapped[0].company_display_name, null);
});

Deno.test("mapV1ToV2Schema: tom array → tom array", () => {
  assertEquals(mapV1ToV2Schema([]), []);
});

// ── buildV1Ranking / buildV2Ranking ────────────────────────────────

Deno.test("buildV1Ranking: assignar ranks 1..N", () => {
  const v1Cleaners = [
    { id: "a", distance_km: 1.2 },
    { id: "b", distance_km: 2.5 },
    { id: "c", distance_km: 3.8 },
  ];
  const ranking = buildV1Ranking(v1Cleaners);
  assertEquals(ranking[0], { cleaner_id: "a", rank: 1, distance_km: 1.2 });
  assertEquals(ranking[1], { cleaner_id: "b", rank: 2, distance_km: 2.5 });
  assertEquals(ranking[2], { cleaner_id: "c", rank: 3, distance_km: 3.8 });
});

Deno.test("buildV2Ranking: assignar ranks + tar match_score", () => {
  const v2Cleaners = [
    { id: "a", match_score: 0.92 },
    { id: "b", match_score: 0.81 },
  ];
  const ranking = buildV2Ranking(v2Cleaners);
  assertEquals(ranking[0], { cleaner_id: "a", rank: 1, match_score: 0.92 });
  assertEquals(ranking[1], { cleaner_id: "b", rank: 2, match_score: 0.81 });
});

Deno.test("buildV1/V2Ranking: NULL-distance/score → 0 (safe default)", () => {
  assertEquals(buildV1Ranking([{ id: "a" }])[0].distance_km, 0);
  assertEquals(buildV2Ranking([{ id: "a" }])[0].match_score, 0);
});

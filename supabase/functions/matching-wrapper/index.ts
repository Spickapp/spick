// supabase/functions/matching-wrapper/index.ts
// =============================================================
// §3.7-full Step 2b — Matching-wrapper EF (shadow-mode A/B-ramverk)
//
// Default-path för cleaner-matchning. boka.html anropar denna EF
// istället för find_nearby_cleaners-RPC direkt. EF:en läser
// platform_settings.matching_algorithm_version och brancherar:
//
//   'v1'     → find_nearby_cleaners_v1(lat, lng) — distance-sort
//   'v2'     → find_nearby_cleaners(9 args) — multivariat
//   'shadow' → båda RPCs parallellt + diff-beräkning +
//              INSERT matching_shadow_log (om enabled) +
//              returnera v1-ordning till klient
//
// Rollout-sekvens (designdok §10.3):
//   1. version='v1'   (default, 0 risk)
//   2. version='shadow' 48h → samla diff-data
//   3. version='v2' för 10% → rollout
//   4. efter 30d analys (§3.9) → go/no-go för 100%
//   5. efter 100% → DROP find_nearby_cleaners_v1
//
// Primärkälla:
//   - docs/architecture/matching-algorithm.md §10 (A/B-ramverk)
//   - supabase/migrations/20260424231000_sprint2d1_matching_shadow_log.sql
//   - supabase/migrations/20260425120000_sprint2d2_find_nearby_cleaners_v1.sql
//
// Klienten skickar:
//   POST {
//     customer_lat: number (required),
//     customer_lng: number (required),
//     booking_date?: string (YYYY-MM-DD, för v2),
//     booking_time?: string (HH:MM, för v2),
//     booking_hours?: number (för v2),
//     has_pets?: boolean (för v2),
//     has_elevator?: boolean (för v2),
//     booking_materials?: string (för v2),
//     customer_id?: string (UUID, för v2)
//   }
//
// Servern returnerar:
//   { cleaners: V2Cleaner[], algorithm_version: 'v1'|'v2'|'shadow',
//     shadow_meta?: { top5_overlap, spearman_rho } }
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  buildV1Ranking,
  buildV2Ranking,
  calculateSpearmanRho,
  calculateTopNOverlap,
  mapV1ToV2Schema,
  type V2Cleaner,
} from "../_shared/matching-diff.ts";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AlgorithmVersion = "v1" | "v2" | "shadow" | "providers-shadow";

interface RequestBody {
  customer_lat?: number;
  customer_lng?: number;
  booking_date?: string | null;
  booking_time?: string | null;
  booking_hours?: number | null;
  has_pets?: boolean | null;
  has_elevator?: boolean | null;
  booking_materials?: string | null;
  customer_id?: string | null;
}

interface SettingsPair {
  version: AlgorithmVersion;
  shadowLogEnabled: boolean;
}

async function readSettings(supabase: SupabaseClient): Promise<SettingsPair> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", ["matching_algorithm_version", "matching_shadow_log_enabled"]);

  const rows = (data ?? []) as Array<{ key: string; value: string }>;
  const rawVersion = rows.find((r) => r.key === "matching_algorithm_version")?.value ?? "v1";
  const version: AlgorithmVersion =
    rawVersion === "v1" || rawVersion === "v2" || rawVersion === "shadow" || rawVersion === "providers-shadow"
      ? rawVersion
      : "v1";
  const shadowLogEnabled =
    rows.find((r) => r.key === "matching_shadow_log_enabled")?.value === "true";

  return { version, shadowLogEnabled };
}

serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const body = (await req.json()) as RequestBody;
    const { customer_lat, customer_lng } = body;

    if (typeof customer_lat !== "number" || typeof customer_lng !== "number") {
      return json(400, { error: "customer_lat och customer_lng krävs (number)" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { version, shadowLogEnabled } = await readSettings(supabase);

    // ── v1: distance-sort (ingen shadow) ──────────────────────────
    if (version === "v1") {
      const { data, error } = await supabase.rpc("find_nearby_cleaners_v1", {
        customer_lat,
        customer_lng,
      });
      if (error) return json(500, { error: "v1-RPC misslyckades", detail: error.message });
      return json(200, {
        cleaners: mapV1ToV2Schema((data ?? []) as Array<Record<string, unknown>>),
        algorithm_version: "v1",
      });
    }

    // ── v2: multivariat ────────────────────────────────────────────
    if (version === "v2") {
      const { data, error } = await supabase.rpc("find_nearby_cleaners", {
        customer_lat,
        customer_lng,
        booking_date: body.booking_date ?? null,
        booking_time: body.booking_time ?? null,
        booking_hours: body.booking_hours ?? null,
        has_pets: body.has_pets ?? null,
        has_elevator: body.has_elevator ?? null,
        booking_materials: body.booking_materials ?? null,
        customer_id: body.customer_id ?? null,
      });
      if (error) return json(500, { error: "v2-RPC misslyckades", detail: error.message });
      return json(200, {
        cleaners: (data ?? []) as V2Cleaner[],
        algorithm_version: "v2",
      });
    }

    // ── shadow: båda parallellt + diff + INSERT + return v1 ───────
    const [v1Result, v2Result] = await Promise.all([
      supabase.rpc("find_nearby_cleaners_v1", { customer_lat, customer_lng }),
      supabase.rpc("find_nearby_cleaners", {
        customer_lat,
        customer_lng,
        booking_date: body.booking_date ?? null,
        booking_time: body.booking_time ?? null,
        booking_hours: body.booking_hours ?? null,
        has_pets: body.has_pets ?? null,
        has_elevator: body.has_elevator ?? null,
        booking_materials: body.booking_materials ?? null,
        customer_id: body.customer_id ?? null,
      }),
    ]);

    // Om båda failar → 500. Om en failar → fallback till den andra (fail-soft).
    if (v1Result.error && v2Result.error) {
      return json(500, {
        error: "Båda RPCs failade i shadow-mode",
        v1: v1Result.error.message,
        v2: v2Result.error.message,
      });
    }

    if (v1Result.error) {
      // v2 funkade — returnera v2 istället för att blockera kund
      return json(200, {
        cleaners: (v2Result.data ?? []) as V2Cleaner[],
        algorithm_version: "v2_fallback_from_shadow",
        shadow_warning: `v1 failade: ${v1Result.error.message}`,
      });
    }

    if (v2Result.error) {
      // v1 funkade — returnera v1
      return json(200, {
        cleaners: mapV1ToV2Schema((v1Result.data ?? []) as Array<Record<string, unknown>>),
        algorithm_version: "v1_fallback_from_shadow",
        shadow_warning: `v2 failade: ${v2Result.error.message}`,
      });
    }

    const v1Cleaners = (v1Result.data ?? []) as Array<Record<string, unknown>>;
    const v2Cleaners = (v2Result.data ?? []) as Array<Record<string, unknown>>;

    const v1Ranking = buildV1Ranking(v1Cleaners);
    const v2Ranking = buildV2Ranking(v2Cleaners);

    const top5Overlap = calculateTopNOverlap(v1Ranking, v2Ranking, 5);
    const spearmanRho = calculateSpearmanRho(v1Ranking, v2Ranking);

    // Logga om enabled. Fire-and-forget: log-failure ska INTE blockera kunden.
    // §3.9b (Sprint 2 Dag 3b): returnerar shadow_log_id så klient kan skicka
    // med till booking-create EF, som i sin tur UPDATE:ar shadow-raden med
    // booking_id + chosen_cleaner_id. Stänger kategori B-metrics.
    let shadowLogId: string | null = null;
    if (shadowLogEnabled) {
      try {
        const { data: logRow, error: logErr } = await supabase
          .from("matching_shadow_log")
          .insert({
            booking_id: null, // fylls av booking-create via §3.9b-korrelations-UPDATE
            v1_ranking: v1Ranking,
            v2_ranking: v2Ranking,
            top5_overlap: top5Overlap,
            spearman_rho: spearmanRho,
            chosen_cleaner_id: null, // fylls av booking-create
            customer_lat,
            customer_lng,
            booking_date: body.booking_date ?? null,
            booking_time: body.booking_time ?? null,
          })
          .select("id")
          .single();
        if (logErr) {
          console.error("matching_shadow_log INSERT failed:", logErr);
        } else {
          shadowLogId = (logRow as { id: string } | null)?.id ?? null;
        }
      } catch (e) {
        console.error("matching_shadow_log INSERT threw:", e);
      }
    }

    // Shadow-mode definition (designdok §10.1): "RPC returnerar v1-ordning
    // till boka.html, men loggar även v2-score för jämförelse". Vi returnerar
    // v1, mappad till v2-schema för att klient-kod inte ska behöva veta mode.
    if (version === "shadow") {
      return json(200, {
        cleaners: mapV1ToV2Schema(v1Cleaners),
        algorithm_version: "shadow",
        shadow_meta: {
          shadow_log_id: shadowLogId, // §3.9b: klient skickar med till booking-create
          top5_overlap: top5Overlap,
          spearman_rho: spearmanRho,
          v1_count: v1Cleaners.length,
          v2_count: v2Cleaners.length,
          logged: shadowLogEnabled,
        },
      });
    }

    // ── providers-shadow: v2 + providers parallellt, logga diff, return v2 ──
    // Sprint Model-3 (audit 2026-04-26): shadow-jämförelse mellan v2-RPC
    // och Model-2a providers-RPC. Klient får v2-data (bakåtkompat); diff
    // loggas i matching_shadow_log.providers_ranking för §3.9-analys.
    // Model-4 aktiverar 'providers' direkt (utan shadow) efter verifiering.
    const v2ParamsM3 = {
      customer_lat,
      customer_lng,
      booking_date: body.booking_date ?? null,
      booking_time: body.booking_time ?? null,
      booking_hours: body.booking_hours ?? null,
      has_pets: body.has_pets ?? null,
      has_elevator: body.has_elevator ?? null,
      booking_materials: body.booking_materials ?? null,
      customer_id: body.customer_id ?? null,
    };
    const [v2ResultM3, providersResult] = await Promise.all([
      supabase.rpc("find_nearby_cleaners", v2ParamsM3),
      supabase.rpc("find_nearby_providers", v2ParamsM3),
    ]);

    if (v2ResultM3.error && providersResult.error) {
      return json(500, {
        error: "Båda RPCs failade i providers-shadow",
        v2: v2ResultM3.error.message,
        providers: providersResult.error.message,
      });
    }
    if (v2ResultM3.error) {
      // v2 failade — returnera v2-tom och logga inget
      return json(200, {
        cleaners: [] as V2Cleaner[],
        algorithm_version: "v2_fallback_from_providers_shadow",
        shadow_warning: `v2 failade: ${v2ResultM3.error.message}`,
      });
    }
    if (providersResult.error) {
      // providers failade — returnera v2, skippa shadow-logging
      return json(200, {
        cleaners: (v2ResultM3.data ?? []) as V2Cleaner[],
        algorithm_version: "v2_fallback_from_providers_shadow",
        shadow_warning: `providers failade: ${providersResult.error.message}`,
      });
    }

    const v2CleanersM3 = (v2ResultM3.data ?? []) as Array<Record<string, unknown>>;
    const providersRows = (providersResult.data ?? []) as Array<Record<string, unknown>>;

    // Bygg providers_ranking för shadow_log
    const providersRankingForLog = providersRows.map((p, i) => ({
      provider_type: p.provider_type,
      provider_id: String(p.provider_id ?? ""),
      representative_cleaner_id: String(p.representative_cleaner_id ?? ""),
      rank: i + 1,
      team_size: Number(p.team_size ?? 1),
      distance_km: Number(p.distance_km ?? 0),
    }));

    // Diff-metrik: top-N-overlap + Spearman på representative_cleaner_id vs v2.id
    const v2RankingM3 = buildV2Ranking(v2CleanersM3);
    const providersAsRepresentatives = providersRankingForLog.map((p) => ({
      cleaner_id: p.representative_cleaner_id,
      rank: p.rank,
    }));
    const top5OverlapM3 = calculateTopNOverlap(providersAsRepresentatives, v2RankingM3, 5);
    const spearmanRhoM3 = calculateSpearmanRho(providersAsRepresentatives, v2RankingM3);

    // Logga i matching_shadow_log (fire-and-forget)
    let shadowLogIdM3: string | null = null;
    if (shadowLogEnabled) {
      try {
        const { data: logRow, error: logErr } = await supabase
          .from("matching_shadow_log")
          .insert({
            booking_id: null,
            v1_ranking: [], // n/a i providers-shadow
            v2_ranking: v2RankingM3,
            providers_ranking: providersRankingForLog, // Model-3 nya kolumn
            top5_overlap: top5OverlapM3,
            spearman_rho: spearmanRhoM3,
            chosen_cleaner_id: null,
            customer_lat,
            customer_lng,
            booking_date: body.booking_date ?? null,
            booking_time: body.booking_time ?? null,
          })
          .select("id")
          .single();
        if (logErr) {
          console.error("providers-shadow INSERT failed:", logErr);
        } else {
          shadowLogIdM3 = (logRow as { id: string } | null)?.id ?? null;
        }
      } catch (e) {
        console.error("providers-shadow INSERT threw:", e);
      }
    }

    // Returnera v2-data till klient (Model-3 håller klient-schemat stabilt)
    return json(200, {
      cleaners: v2CleanersM3 as unknown as V2Cleaner[],
      algorithm_version: "providers-shadow",
      shadow_meta: {
        shadow_log_id: shadowLogIdM3,
        top5_overlap: top5OverlapM3,
        spearman_rho: spearmanRhoM3,
        v2_count: v2CleanersM3.length,
        providers_count: providersRows.length,
        logged: shadowLogEnabled,
      },
    });
  } catch (err) {
    return json(500, {
      error: "matching-wrapper internal error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

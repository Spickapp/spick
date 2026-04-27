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
  mapProvidersToV2Cleaners,
  mapV1ToV2Schema,
  type V2Cleaner,
} from "../_shared/matching-diff.ts";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AlgorithmVersion = "v1" | "v2" | "shadow" | "providers-shadow" | "providers";

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
  // Sprint C-4 (2026-04-28): kund-valda addons — skickas ENDAST till
  // find_nearby_providers (Model-2a). v1/v2 har inte addon-filter.
  required_addons?: string[] | null;
  // Fas 7 §7.7 (2026-04-25): kund-valda språk-krav. NULL/[] = ignorera filter.
  // Skickas till v2 + shadow + providers-shadow (alla v2-kompatibla RPCs).
  // v1 (find_nearby_cleaners_v1) har inte param — ignoreras där.
  languages?: string[] | null;
}

interface SettingsPair {
  version: AlgorithmVersion;
  shadowLogEnabled: boolean;
  // Sprint 1 (2026-04-28, Farhad-mandat): gatekeeping av icke-verifierade
  // cleaners/companies i matching. Default 'false' = nuvarande beteende
  // (alla som passerar matching-RPC:s hard filter visas).
  requireVerification: boolean;
}

async function readSettings(supabase: SupabaseClient): Promise<SettingsPair> {
  const { data } = await supabase
    .from("platform_settings")
    .select("key, value")
    .in("key", [
      "matching_algorithm_version",
      "matching_shadow_log_enabled",
      "matching_require_verification",
    ]);

  const rows = (data ?? []) as Array<{ key: string; value: string }>;
  const rawVersion = rows.find((r) => r.key === "matching_algorithm_version")?.value ?? "v1";
  const version: AlgorithmVersion =
    rawVersion === "v1" || rawVersion === "v2" || rawVersion === "shadow" ||
      rawVersion === "providers-shadow" || rawVersion === "providers"
      ? rawVersion
      : "v1";
  const shadowLogEnabled =
    rows.find((r) => r.key === "matching_shadow_log_enabled")?.value === "true";
  // Default false — om platform_settings-nyckeln saknas (ej seed:ad) behåller
  // vi nuvarande beteende (bakåtkompat). Farhad aktiverar via:
  //   INSERT INTO platform_settings (key,value)
  //   VALUES ('matching_require_verification','true');
  const requireVerification =
    rows.find((r) => r.key === "matching_require_verification")?.value === "true";

  return { version, shadowLogEnabled, requireVerification };
}

// ═══════════════════════════════════════════════════════════════
// Sprint 1 — Verifierings-filter (Alt B: application-lager)
// ═══════════════════════════════════════════════════════════════
// Farhad-mandat 2026-04-28: icke-verifierade cleaners/companies får INTE
// dyka upp i matching. Öppen städar-signup är strategi — gatekeeping är
// gjort på application-lagret (inte DB-lagret) av rule #27 + #31:
//   - Rör ingen befintlig RPC
//   - Kill-switch via platform_settings.matching_require_verification
//   - Rollback = flippa kill-switch (INGEN kod-deploy behövs)
//
// Verifierings-krav:
//   Solo cleaner (company_id IS NULL):
//     - cleaners.f_skatt_verified = true
//     - cleaners.underleverantor_agreement_accepted_at IS NOT NULL
//   Company member (company_id IS NOT NULL):
//     - companies.underleverantor_agreement_accepted_at IS NOT NULL
//     - companies.onboarding_status = 'active'
//
// Observability: loggar antal filtrerade till console (picks upp av
// Supabase EF logs + Discord alerts om signifikant avvikelse).
// ═══════════════════════════════════════════════════════════════

type VerifFilterRow = Record<string, unknown>;

/**
 * Per-cleaner allow_individual_booking-filter (Zivar 2026-04-26).
 * Tar bort solo-providers vars cleaner är timanställd (allow=false).
 * Company-providers behålls oavsett — kund bokar då hela företaget.
 * Cleaners-mode-filter: tar bort solo-cleaners med allow=false.
 */
async function filterIndividualBookingMode(
  supabase: SupabaseClient,
  rows: Array<Record<string, unknown>>,
): Promise<Array<Record<string, unknown>>> {
  if (rows.length === 0) return rows;
  const soloIds = new Set<string>();
  for (const r of rows) {
    // Providers-mode: bara solo-providers (company-providers påverkas inte)
    if (r.provider_type === "solo") {
      const id = String(r.representative_cleaner_id ?? r.provider_id ?? "");
      if (id) soloIds.add(id);
    } else if (r.provider_type === undefined) {
      // cleaners-mode (v1/v2): platt cleaner-rad, alla räknas som solo-träff
      const id = String(r.id ?? "");
      if (id) soloIds.add(id);
    }
  }
  if (soloIds.size === 0) return rows;
  const { data } = await supabase
    .from("v_cleaner_booking_mode")
    .select("id, allow_individual_booking")
    .in("id", Array.from(soloIds));
  const blockedIds = new Set<string>(
    (data ?? [])
      .filter((c: Record<string, unknown>) => c.allow_individual_booking === false)
      .map((c: Record<string, unknown>) => String(c.id))
  );
  if (blockedIds.size === 0) return rows;
  return rows.filter((r) => {
    if (r.provider_type === "solo") {
      const id = String(r.representative_cleaner_id ?? r.provider_id ?? "");
      return !blockedIds.has(id);
    }
    if (r.provider_type === undefined) {
      const id = String(r.id ?? "");
      return !blockedIds.has(id);
    }
    return true; // company-providers behålls
  });
}

async function filterByVerification(
  supabase: SupabaseClient,
  rows: VerifFilterRow[],
  mode: "cleaners" | "providers",
  context: string,
): Promise<VerifFilterRow[]> {
  if (rows.length === 0) return rows;

  // ─── Samla ids att kolla verifiering för ───
  const soloCleanerIds = new Set<string>();
  const companyIdsFromProviders = new Set<string>();

  if (mode === "providers") {
    for (const r of rows) {
      if (r.provider_type === "solo") {
        const id = String(r.representative_cleaner_id ?? r.provider_id ?? "");
        if (id) soloCleanerIds.add(id);
      } else if (r.provider_type === "company") {
        const id = String(r.provider_id ?? "");
        if (id) companyIdsFromProviders.add(id);
      }
    }
  } else {
    // cleaners-mode: raderna är platta cleaner-rader från v1/v2 RPC
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (id) soloCleanerIds.add(id);
    }
  }

  // ─── Fetch cleaner-verifiering (+ deras company_id för member-check) ───
  interface CleanerRow {
    id: string;
    f_skatt_verified: boolean | null;
    underleverantor_agreement_accepted_at: string | null;
    company_id: string | null;
  }
  let cleanerRows: CleanerRow[] = [];
  if (soloCleanerIds.size > 0) {
    const { data, error } = await supabase
      .from("cleaners")
      .select("id, f_skatt_verified, underleverantor_agreement_accepted_at, company_id")
      .in("id", Array.from(soloCleanerIds));
    if (error) {
      console.error(JSON.stringify({
        level: "error", fn: "matching-wrapper", msg: "verif_filter_cleaner_fetch_failed",
        context, error: error.message,
      }));
      // Fail-safe: returnera ofiltrerat (hellre visa alla än ingen)
      return rows;
    }
    cleanerRows = (data ?? []) as CleanerRow[];
  }

  // ─── Member-companies: samla company_ids från cleaners med company_id ───
  const memberCompanyIds = new Set<string>();
  for (const c of cleanerRows) {
    if (c.company_id) memberCompanyIds.add(c.company_id);
  }
  // ─── Union med provider-companies för en enda company-fetch ───
  const allCompanyIds = new Set<string>([
    ...memberCompanyIds,
    ...companyIdsFromProviders,
  ]);

  // ─── Fetch company-verifiering ───
  interface CompanyRow {
    id: string;
    underleverantor_agreement_accepted_at: string | null;
    onboarding_status: string | null;
  }
  const verifiedCompanyIds = new Set<string>();
  if (allCompanyIds.size > 0) {
    const { data, error } = await supabase
      .from("companies")
      .select("id, underleverantor_agreement_accepted_at, onboarding_status")
      .in("id", Array.from(allCompanyIds));
    if (error) {
      console.error(JSON.stringify({
        level: "error", fn: "matching-wrapper", msg: "verif_filter_company_fetch_failed",
        context, error: error.message,
      }));
      return rows;
    }
    for (const co of (data ?? []) as CompanyRow[]) {
      if (co.underleverantor_agreement_accepted_at && co.onboarding_status === "active") {
        verifiedCompanyIds.add(co.id);
      }
    }
  }

  // ─── Bedöm varje cleaner ───
  const cleanerVerified = new Map<string, boolean>();
  for (const c of cleanerRows) {
    if (!c.company_id) {
      // Solo: egen F-skatt + eget UA
      cleanerVerified.set(
        c.id,
        c.f_skatt_verified === true &&
        c.underleverantor_agreement_accepted_at !== null,
      );
    } else {
      // Member: företaget måste vara verifierat
      cleanerVerified.set(c.id, verifiedCompanyIds.has(c.company_id));
    }
  }

  // ─── Applicera filter ───
  const filtered = rows.filter((r) => {
    if (mode === "providers") {
      if (r.provider_type === "solo") {
        const id = String(r.representative_cleaner_id ?? r.provider_id ?? "");
        return cleanerVerified.get(id) === true;
      }
      if (r.provider_type === "company") {
        const id = String(r.provider_id ?? "");
        return verifiedCompanyIds.has(id);
      }
      return false;
    }
    // cleaners-mode
    const id = String(r.id ?? "");
    return cleanerVerified.get(id) === true;
  });

  // ─── Observability ───
  const removed = rows.length - filtered.length;
  if (removed > 0) {
    console.log(JSON.stringify({
      level: "info",
      fn: "matching-wrapper",
      msg: "verif_filter_applied",
      context,
      mode,
      before: rows.length,
      after: filtered.length,
      removed,
    }));
  }

  return filtered;
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

    // P0 prod-fix 2026-04-27: find_nearby_providers + find_nearby_cleaners-RPCs
    // har booking_hours som INTEGER (PostgreSQL-typ). Klient skickar decimaler
    // (t.ex. 2.5h för "2.5 timmar städning"). PostgreSQL kastade
    // "invalid input syntax for type integer: 2.5" → 500 Internal Server Error.
    // Fix: Math.ceil rundar upp 2.5 → 3 så matchningen kräver att cleaner har
    // minst 3h ledigt (lite strängare, men ALDRIG bokar 2.5h-jobb mot cleaner
    // med bara 2h ledigt). Bokningens FAKTISKA timmar lagras i bookings-tabellen
    // oförändrat (booking-create skriver den NUMERIC). Permanent DB-fix
    // (ALTER FUNCTION → NUMERIC) i separat migration nästa sprint.
    if (typeof body.booking_hours === "number" && !Number.isInteger(body.booking_hours)) {
      body.booking_hours = Math.ceil(body.booking_hours);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { version, shadowLogEnabled, requireVerification } = await readSettings(supabase);

    // ── v1: distance-sort (ingen shadow) ──────────────────────────
    if (version === "v1") {
      const { data, error } = await supabase.rpc("find_nearby_cleaners_v1", {
        customer_lat,
        customer_lng,
      });
      if (error) return json(500, { error: "v1-RPC misslyckades", detail: error.message });
      let rows = (data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "cleaners", "v1");
      }
      return json(200, {
        cleaners: mapV1ToV2Schema(rows),
        algorithm_version: "v1",
      });
    }

    // ── providers: Model-2a-RPC, mappad till V2Cleaner med extensions ──
    // Sprint Model-4a (audit 2026-04-26). Klient får team_size + aggregat
    // via extension-fält. Solo-providers renderas exakt som solo-städare
    // idag (team_size=1). Company-providers visas med företagsnamn som
    // display_name och min_hourly_rate som kortpris.
    if (version === "providers") {
      const { data, error } = await supabase.rpc("find_nearby_providers", {
        customer_lat,
        customer_lng,
        booking_date: body.booking_date ?? null,
        booking_time: body.booking_time ?? null,
        booking_hours: body.booking_hours ?? null,
        has_pets: body.has_pets ?? null,
        has_elevator: body.has_elevator ?? null,
        booking_materials: body.booking_materials ?? null,
        customer_id: body.customer_id ?? null,
        // Sprint C-4: addon-filter (NULL = inga krav)
        required_addons: body.required_addons ?? null,
      });
      if (error) {
        return json(500, { error: "providers-RPC misslyckades", detail: error.message });
      }
      let rows = (data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "providers", "providers");
      }
      // Per-cleaner allow_individual_booking-filter (Zivar 2026-04-26):
      // Solo-providers vars cleaner är timanställd (allow_individual=false)
      // ska INTE dyka upp som solo-träff. Company-providers behålls eftersom
      // kund då bokar HELA företaget oavsett vilka cleaners som är timanställda.
      rows = await filterIndividualBookingMode(supabase, rows);
      return json(200, {
        cleaners: mapProvidersToV2Cleaners(rows),
        algorithm_version: "providers",
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
        p_languages: body.languages ?? null,
      });
      if (error) return json(500, { error: "v2-RPC misslyckades", detail: error.message });
      let rows = (data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "cleaners", "v2");
      }
      // Per-cleaner allow_individual_booking-filter (Zivar 2026-04-26)
      rows = await filterIndividualBookingMode(supabase, rows);
      return json(200, {
        cleaners: rows as unknown as V2Cleaner[],
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
        p_languages: body.languages ?? null,
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
      let rows = (v2Result.data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "cleaners", "shadow_v2_fallback");
      }
      return json(200, {
        cleaners: rows as unknown as V2Cleaner[],
        algorithm_version: "v2_fallback_from_shadow",
        shadow_warning: `v1 failade: ${v1Result.error.message}`,
      });
    }

    if (v2Result.error) {
      // v1 funkade — returnera v1
      let rows = (v1Result.data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "cleaners", "shadow_v1_fallback");
      }
      return json(200, {
        cleaners: mapV1ToV2Schema(rows),
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
    //
    // Sprint 1 (2026-04-28): filter appliceras på RETURNERAD data (inte på
    // shadow-log) så analys-integriteten behålls. shadow_log har rå v1/v2-data
    // för pilot-analys; klienten får bara verifierade.
    if (version === "shadow") {
      let v1Out = v1Cleaners;
      if (requireVerification) {
        v1Out = await filterByVerification(supabase, v1Cleaners, "cleaners", "shadow_return");
      }
      return json(200, {
        cleaners: mapV1ToV2Schema(v1Out),
        algorithm_version: "shadow",
        shadow_meta: {
          shadow_log_id: shadowLogId, // §3.9b: klient skickar med till booking-create
          top5_overlap: top5Overlap,
          spearman_rho: spearmanRho,
          v1_count: v1Cleaners.length,
          v2_count: v2Cleaners.length,
          logged: shadowLogEnabled,
          verification_filter_applied: requireVerification,
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
      p_languages: body.languages ?? null,
    };
    // Sprint C-4: providers-RPC kan ta required_addons (v2 saknar param).
    // Fas 7 §7.7 (2026-04-25): p_languages är v2-only — providers-RPC har INTE
    // den param ännu (separat sprint). Spread:a inte v2ParamsM3 → bygg explicit.
    const providersParamsM3 = {
      customer_lat,
      customer_lng,
      booking_date: body.booking_date ?? null,
      booking_time: body.booking_time ?? null,
      booking_hours: body.booking_hours ?? null,
      has_pets: body.has_pets ?? null,
      has_elevator: body.has_elevator ?? null,
      booking_materials: body.booking_materials ?? null,
      customer_id: body.customer_id ?? null,
      required_addons: body.required_addons ?? null,
    };
    const [v2ResultM3, providersResult] = await Promise.all([
      supabase.rpc("find_nearby_cleaners", v2ParamsM3),
      supabase.rpc("find_nearby_providers", providersParamsM3),
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
      let rows = (v2ResultM3.data ?? []) as Array<Record<string, unknown>>;
      if (requireVerification) {
        rows = await filterByVerification(supabase, rows, "cleaners", "providers_shadow_v2_fallback");
      }
      return json(200, {
        cleaners: rows as unknown as V2Cleaner[],
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

    // Returnera v2-data till klient (Model-3 håller klient-schemat stabilt).
    // Sprint 1 (2026-04-28): filter på returnerad data, inte på shadow-log.
    let v2Out = v2CleanersM3;
    if (requireVerification) {
      v2Out = await filterByVerification(supabase, v2CleanersM3, "cleaners", "providers_shadow_return");
    }
    return json(200, {
      cleaners: v2Out as unknown as V2Cleaner[],
      algorithm_version: "providers-shadow",
      shadow_meta: {
        shadow_log_id: shadowLogIdM3,
        top5_overlap: top5OverlapM3,
        spearman_rho: spearmanRhoM3,
        v2_count: v2CleanersM3.length,
        providers_count: providersRows.length,
        logged: shadowLogEnabled,
        verification_filter_applied: requireVerification,
      },
    });
  } catch (err) {
    return json(500, {
      error: "matching-wrapper internal error",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

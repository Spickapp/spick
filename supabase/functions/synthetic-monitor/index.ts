// ═══════════════════════════════════════════════════════════════
// SPICK – synthetic-monitor (Fas 10 §10.x extension 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// Nightly synthetic stress-test av 10 kritiska EFs. Varje check
// pingar en EF med en mock-payload, mäter response-tid och status,
// aggregerar resultatet till healthy/degraded/down och alertar via
// sendAdminAlert om något failar.
//
// PRIMÄRKÄLLA / PATTERN:
//   - supabase/functions/health/index.ts (check-objekt-shape)
//   - supabase/functions/auto-remind/index.ts (cron-EF-struktur)
//   - supabase/functions/_shared/cron-auth.ts (auth)
//   - supabase/functions/_shared/alerts.ts (admin-alert)
//
// REGLER:
//   - #26: cron-auth + alerts lästa innan import
//   - #27: scope = synthetic-monitor only, inga ändringar i de
//          10 EFs som pingas
//   - #28: SSOT — requireCronAuth + sendAdminAlert återanvänds
//   - #31: alla 10 payload-shapes curl-verifierade mot prod
//          2026-04-26 (geo: action=geocode_booking, matching-wrapper
//          kräver customer_lat/lng, og-prerender kräver type+slug,
//          services-list är GET-only, auto-approve-check kräver
//          POST + application_id)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireCronAuth } from "../_shared/cron-auth.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-cron-secret",
};

// Per-check timeout (ms). Höj inte över ~10s — total körning ska klara
// Supabase-EF-default-timeout (60s).
const CHECK_TIMEOUT_MS = 8000;

interface CheckSpec {
  name: string;
  ef: string;            // EF-namn under /functions/v1/
  method: "GET" | "POST";
  path?: string;          // querystring (utan ledande ?)
  body?: unknown;         // POST-payload
  // expectStatuses: HTTP-koder som räknas som "alive" (incl. förväntade
  // 4xx för EFs som validerar input — 404 från og-prerender på en
  // testslug betyder att EF körde, hittade ingen profil, returnerade 404).
  expectStatuses: number[];
  // Om satt: minst en av strängarna måste finnas i response-body
  // (för 200-svar). Garanterar att EF inte returnerar tom JSON.
  bodyContains?: string[];
}

// De 10 critical-path-EFs. Mock-payloads är hardcodade testdata
// (rule #28: testdata, inte affärsdata → får inte fragmenteras till
// platform_settings).
const CHECKS: CheckSpec[] = [
  {
    name: "health",
    ef: "health",
    method: "GET",
    expectStatuses: [200, 503], // 503 = degraded men EF lever
    bodyContains: ['"status"'],
  },
  {
    name: "services-list (GET)",
    ef: "services-list",
    method: "GET",
    expectStatuses: [200],
    bodyContains: ['"services"'],
  },
  {
    name: "geo (geocode_booking)",
    ef: "geo",
    method: "POST",
    body: {
      action: "geocode_booking",
      address: "Storgatan 1",
      city: "Stockholm",
    },
    expectStatuses: [200, 400], // 400 om Nominatim inte hittar — EF lever
    bodyContains: ['"ok"', '"error"', '"coords"'],
  },
  {
    name: "matching-wrapper",
    ef: "matching-wrapper",
    method: "POST",
    body: {
      customer_lat: 59.3293,
      customer_lng: 18.0686,
      city: "stockholm",
      service: "hemstadning",
      date: "2026-05-01",
      time: "10:00",
      booking_hours: 3,
    },
    expectStatuses: [200],
    bodyContains: ['"cleaners"'],
  },
  {
    name: "verify-fskatt",
    ef: "verify-fskatt",
    method: "POST",
    body: { org_number: "5594024522" }, // Haghighi Consulting AB
    expectStatuses: [200],
    bodyContains: ['"valid"'],
  },
  {
    name: "og-prerender",
    ef: "og-prerender",
    method: "GET",
    path: "type=cleaner&slug=test-cleaner-synthetic",
    expectStatuses: [200, 404], // 404 = SSR körde men hittade ingen profil
    bodyContains: ["<!DOCTYPE", "<html"],
  },
  {
    name: "og-image",
    ef: "og-image",
    method: "GET",
    path: "slug=test-cleaner-synthetic",
    expectStatuses: [200, 302], // 302 = SVG-redirect till fallback
  },
  {
    name: "seo-page-stad-tjanst",
    ef: "seo-page-stad-tjanst",
    method: "GET",
    path: "stad=stockholm&tjanst=hemstadning",
    expectStatuses: [200],
    bodyContains: ["<!DOCTYPE", "<html"],
  },
  {
    name: "services-list (addons-coverage)",
    // services-list är GET-only — vi verifierar att GET-svaret innehåller
    // addons-strukturen (services-list returnerar { services, addons } i
    // samma response).
    ef: "services-list",
    method: "GET",
    expectStatuses: [200],
    bodyContains: ['"addons"'],
  },
  {
    name: "auto-approve-check",
    ef: "auto-approve-check",
    method: "POST",
    body: { application_id: "00000000-0000-0000-0000-000000000000" },
    // 404 = EF körde, hittade ingen ansökan med dummy-UUID → bevisar att
    // cron-EF inte kraschar. 400 om validering misslyckas. 200 osannolikt
    // (skulle kräva matchande UUID).
    expectStatuses: [200, 400, 404],
    bodyContains: ['"error"', '"ok"'],
  },
];

interface CheckResult {
  name: string;
  ef: string;
  method: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  body_snippet?: string; // Första 200 tecken av response (för debug)
}

async function runCheck(spec: CheckSpec): Promise<CheckResult> {
  const url = `${SUPA_URL}/functions/v1/${spec.ef}${spec.path ? "?" + spec.path : ""}`;
  const t0 = Date.now();
  try {
    const headers: Record<string, string> = {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${ANON_KEY}`,
    };
    if (spec.method === "POST") headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: spec.method,
      headers,
      body: spec.method === "POST" ? JSON.stringify(spec.body ?? {}) : undefined,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      // og-image returnerar 302 → vi vill fånga redirect-statusen, inte följa
      redirect: "manual",
    });

    const ms = Date.now() - t0;
    const text = await res.text();
    const snippet = text.slice(0, 200);

    const statusOk = spec.expectStatuses.includes(res.status);
    let bodyOk = true;
    if (statusOk && spec.bodyContains && spec.bodyContains.length) {
      // Räcker att en av de förväntade fragmenten matchar
      bodyOk = spec.bodyContains.some((needle) => text.includes(needle));
    }

    return {
      name: spec.name,
      ef: spec.ef,
      method: spec.method,
      status: res.status,
      ms,
      ok: statusOk && bodyOk,
      ...(!statusOk && {
        error: `unexpected_status_${res.status} (allowed=${spec.expectStatuses.join(",")})`,
      }),
      ...((statusOk && !bodyOk) && {
        error: `body_missing_expected_fragment (looked_for=${spec.bodyContains?.join("|")})`,
      }),
      body_snippet: snippet,
    };
  } catch (e) {
    return {
      name: spec.name,
      ef: spec.ef,
      method: spec.method,
      status: null,
      ms: Date.now() - t0,
      ok: false,
      error: (e as Error).message || "fetch_failed",
    };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Auth: cron-only
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  // Kör alla checks parallellt — undviker att en slow EF blockerar nästa.
  const results = await Promise.all(CHECKS.map(runCheck));

  const failed = results.filter((r) => !r.ok);
  const failedCount = failed.length;
  // "degraded" särskiljer mellan kritiskt fail och svaga signaler. Definitionen
  // i task: 1-2 fail = degraded, 3+ = down. Vi spårar degraded_count separat
  // för dashboards.
  const degradedCount = failedCount >= 1 && failedCount <= 2 ? failedCount : 0;

  let overallStatus: "healthy" | "degraded" | "down";
  if (failedCount === 0) overallStatus = "healthy";
  else if (failedCount <= 2) overallStatus = "degraded";
  else overallStatus = "down";

  const totalMs = Date.now() - t0;
  const report = {
    overall_status: overallStatus,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_ms: totalMs,
    total_checks: results.length,
    failed_count: failedCount,
    degraded_count: degradedCount,
    failed_checks: failed.map((f) => f.name),
    results,
  };

  // Persist till synthetic_monitor_runs (best-effort — alert ändå om DB nere)
  let dbInsertOk = false;
  try {
    const sb = createClient(SUPA_URL, SERVICE_KEY);
    const { error } = await sb.from("synthetic_monitor_runs").insert({
      overall_status: overallStatus,
      total_checks: results.length,
      failed_count: failedCount,
      degraded_count: degradedCount,
      results: report,
    });
    if (error) {
      console.error("[synthetic-monitor] DB insert failed:", error.message);
    } else {
      dbInsertOk = true;
    }
  } catch (e) {
    console.error("[synthetic-monitor] DB insert exception:", (e as Error).message);
  }

  // Alerta admin om degraded eller down
  if (overallStatus !== "healthy") {
    try {
      await sendAdminAlert({
        severity: overallStatus === "down" ? "critical" : "error",
        title: `Synthetic monitor: ${overallStatus.toUpperCase()} (${failedCount}/${results.length} failed)`,
        source: "synthetic-monitor",
        message: `Failed EFs: ${failed.map((f) => `${f.name} [${f.status ?? "no-resp"}: ${f.error ?? "ok-but-empty"}]`).join("; ")}`,
        metadata: {
          failed_count: failedCount,
          total_checks: results.length,
          total_ms: totalMs,
          db_persisted: dbInsertOk,
        },
      });
    } catch (e) {
      console.error("[synthetic-monitor] sendAdminAlert failed:", (e as Error).message);
    }
  }

  return new Response(JSON.stringify(report, null, 2), {
    status: overallStatus === "down" ? 503 : 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
});

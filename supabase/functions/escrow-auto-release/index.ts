// ═══════════════════════════════════════════════════════════════
// SPICK – escrow-auto-release (Fas 8 §8.12)
// ═══════════════════════════════════════════════════════════════
//
// Cron-EF: kör var 15 min. Letar bokningar i escrow_state='awaiting_attest'
// där 24h har passerat sedan state-transition (job_completed). Triggar
// escrow-release med trigger='auto_24h_timer'.
//
// Stänger happy-path-loopen: kund gör INGET → pengar flyttas till
// städare automatiskt efter 24h.
//
// CRON: GitHub Actions schedule '*/15 * * * *' (var 15 min).
// Auth: CRON_SECRET per konvention (CLAUDE.md §konventioner).
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §5 SLA-timers.
//
// FLÖDE:
//   1. Auth (CRON_SECRET)
//   2. Hämta bokningar i escrow_state='awaiting_attest'
//      som transitioned dit >= 24h sedan (via escrow_events.created_at)
//   3. För varje: POST /functions/v1/escrow-release med trigger='auto_24h_timer'
//   4. Logga resultat, skicka admin-summary vid fel
//
// IDEMPOTENS:
//   escrow-release-EF har escrow_state-guardrail. Om en bokning
//   redan transitioned till 'released' (via customer_attest i mellantiden)
//   returnerar EF 422 → vi loggar warn, fortsätter till nästa.
//
// REGLER: #26 grep escrow-state + events-schema, #27 scope (bara
// cron-wrapper, 0 Stripe, 0 business-logic utanför escrow-release),
// #28 SSOT = escrow-release EF hanterar transfer + state, denna
// bara identifierar vilka bokningar som är ready, #30 money-critical
// men delegerar till §8.7 som redan är rule #30-verified, #31 schema
// (escrow_state + escrow_events) live-verifierat.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "escrow-auto-release",
    msg,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // ── Auth: CRON_SECRET (GitHub Actions) ──
    const authHeader = req.headers.get("Authorization");
    const providedSecret = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : req.headers.get("x-cron-secret");

    if (!providedSecret || providedSecret !== CRON_SECRET) {
      return json(CORS, 401, { error: "unauthorized" });
    }

    // ── Hitta bokningar redo för auto-release ──
    // Logik: awaiting_attest-transitions är minst 24h gamla.
    // Vi läser escrow_events för att hitta when booking gick IN i
    // awaiting_attest (job_completed-action).
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: readyEvents, error: fetchErr } = await sb
      .from("escrow_events")
      .select("booking_id, created_at")
      .eq("to_state", "awaiting_attest")
      .lte("created_at", cutoff);

    if (fetchErr) {
      log("error", "escrow_events fetch failed", { error: fetchErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }

    // Dedup: samma booking_id kan ha flera awaiting_attest-transitions
    // (om dispute → resolved_dismissed → awaiting_attest loop senare).
    // Ta bara unika booking_ids som fortfarande är i awaiting_attest.
    const candidateIds = [...new Set((readyEvents || []).map((e) => e.booking_id as string))];

    if (candidateIds.length === 0) {
      log("info", "No bookings ready for auto-release", { cutoff });
      return json(CORS, 200, { processed: 0, results: [] });
    }

    // Verifiera att de fortfarande är i awaiting_attest (inte customer_attest:ade)
    const { data: activeBookings } = await sb
      .from("bookings")
      .select("id")
      .in("id", candidateIds)
      .eq("escrow_state", "awaiting_attest");

    const bookingIdsToRelease = (activeBookings || []).map((b) => b.id as string);

    if (bookingIdsToRelease.length === 0) {
      log("info", "All candidates already transitioned out of awaiting_attest", {
        candidates: candidateIds.length,
      });
      return json(CORS, 200, { processed: 0, results: [] });
    }

    log("info", "Auto-release candidates", {
      count: bookingIdsToRelease.length,
      first_few: bookingIdsToRelease.slice(0, 3),
    });

    // ── Loopa: call escrow-release per booking ──
    const results: Array<{ booking_id: string; ok: boolean; error?: string; amount_sek?: number }> = [];

    for (const bookingId of bookingIdsToRelease) {
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/escrow-release`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
          },
          body: JSON.stringify({
            booking_id: bookingId,
            trigger: "auto_24h_timer",
          }),
        });
        const resJson = await res.json();

        if (!res.ok) {
          results.push({
            booking_id: bookingId,
            ok: false,
            error: resJson.error || `HTTP ${res.status}`,
          });
          log("warn", "escrow-release failed", {
            booking_id: bookingId,
            status: res.status,
            error: resJson.error,
          });
          continue;
        }

        results.push({
          booking_id: bookingId,
          ok: true,
          amount_sek: resJson.amount_sek,
        });
      } catch (e) {
        results.push({
          booking_id: bookingId,
          ok: false,
          error: (e as Error).message,
        });
        log("error", "escrow-release exception", {
          booking_id: bookingId,
          error: (e as Error).message,
        });
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    const failCount = results.length - successCount;

    // ── Admin-alert vid fel ──
    if (failCount > 0) {
      await sendAdminAlert({
        severity: failCount > successCount ? "error" : "warn",
        title: `Auto-release: ${failCount}/${results.length} failed`,
        source: "escrow-auto-release",
        message: "Bokningar kvar i awaiting_attest pga fel i escrow-release. Manuell granskning krävs.",
        metadata: {
          total: results.length,
          success: successCount,
          failed: failCount,
          failed_booking_ids: results.filter((r) => !r.ok).map((r) => r.booking_id),
        },
      });
    }

    log("info", "Auto-release batch complete", {
      total: results.length,
      success: successCount,
      failed: failCount,
    });

    return json(CORS, 200, {
      processed: results.length,
      success: successCount,
      failed: failCount,
      results,
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

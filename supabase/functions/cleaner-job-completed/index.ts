// ═══════════════════════════════════════════════════════════════
// SPICK – cleaner-job-completed (Fas 8 §8.2 wiring)
// ═══════════════════════════════════════════════════════════════
//
// Wrapper-EF för cleaner att transitionera escrow_state från
// paid_held → awaiting_attest efter jobb markerat klart.
//
// Wrapper behövs eftersom escrow-state-transition EF kräver
// service_role (rule #30 — customer/cleaner går via wrapper-EFs
// som validerar ownership). Stadare-dashboard har cleaner-JWT.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §1.2
//
// FLÖDE:
//   1. Cleaner JWT auth (Bearer token från logged-in cleaner)
//   2. Validate input (booking_id)
//   3. Fetch booking + cleaner → verify cleaner-ownership
//      (booking.cleaner_id = cleaners.auth_user_id)
//   4. Verify escrow_state = 'paid_held' (dispute-mode) eller
//      skippa om 'released_legacy' (legacy-mode = no-op success)
//   5. Call escrow-state-transition action='job_completed' → 'awaiting_attest'
//
// NO-OP för legacy-bokningar:
//   Om booking.escrow_state = 'released_legacy', returnerar 200 med
//   noop=true. Detta gör att frontend kan anropa oberoende av escrow-
//   mode — EF hanterar båda fall.
//
// REGLER: #26 grep dispute-open-pattern för cleaner-JWT + ownership-
// check, #27 scope (bara job_completed-transition, ingen PATCH av
// booking-status som stadare-dashboard gör redan), #28 SSOT =
// escrow-state-transition EF, #30 money-critical state-change
// delegeras till §8.6 state-machine, #31 prod-schema verifierat.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "cleaner-job-completed",
    msg,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: cleaner JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);

    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();

    if (userErr || !user) {
      return json(CORS, 401, { error: "invalid_auth" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const b = body as Record<string, unknown>;

    if (!isValidUuid(b.booking_id)) {
      return json(CORS, 400, { error: "invalid_booking_id" });
    }
    const bookingId = b.booking_id as string;
    const checkoutMetadata = typeof b.metadata === "object" && b.metadata !== null
      ? (b.metadata as Record<string, unknown>)
      : {};

    // ── Fetch cleaner (ownership-referens) ──
    const { data: cleaner, error: cleanerErr } = await sbService
      .from("cleaners")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (cleanerErr || !cleaner) {
      return json(CORS, 403, { error: "not_a_cleaner" });
    }

    // ── Fetch booking + verify ownership ──
    const { data: booking, error: bookingErr } = await sbService
      .from("bookings")
      .select("id, cleaner_id, escrow_state")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingErr) {
      log("error", "Booking fetch failed", { booking_id: bookingId, error: bookingErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }
    if (booking.cleaner_id !== cleaner.id) {
      log("warn", "Ownership mismatch", {
        booking_id: bookingId,
        cleaner_auth_id: cleaner.id,
        booking_cleaner_id: booking.cleaner_id,
      });
      return json(CORS, 403, { error: "not_your_booking" });
    }

    // ── No-op för legacy-bokningar ──
    const escrowState = booking.escrow_state as string;
    if (escrowState === "released_legacy") {
      return json(CORS, 200, {
        ok: true,
        booking_id: bookingId,
        noop: true,
        reason: "legacy_booking_no_escrow_transition_needed",
      });
    }

    // ── Endast paid_held → awaiting_attest är giltig här ──
    // Andra states: returnera klart error så frontend kan debuggea.
    if (escrowState !== "paid_held") {
      return json(CORS, 422, {
        error: "invalid_escrow_state",
        details: {
          current: escrowState,
          required: "paid_held",
          note: "Job_completed transition kräver paid_held. Andra states har redan passerat denna fas.",
        },
      });
    }

    // ── Call escrow-state-transition med service-role ──
    const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        booking_id: bookingId,
        action: "job_completed",
        triggered_by: "cleaner",
        triggered_by_id: user.id,
        metadata: {
          cleaner_id: cleaner.id,
          ...checkoutMetadata,
        },
      }),
    });

    const transJson = await transRes.json();

    if (!transRes.ok) {
      log("error", "escrow-state-transition failed", {
        booking_id: bookingId,
        status: transRes.status,
        error: transJson.error,
      });
      return json(CORS, 502, {
        error: "escrow_transition_failed",
        details: transJson.error,
      });
    }

    log("info", "Job completed + escrow transitioned", {
      booking_id: bookingId,
      cleaner_id: cleaner.id,
    });

    return json(CORS, 200, {
      ok: true,
      booking_id: bookingId,
      from_state: transJson.from_state,
      to_state: transJson.to_state,
      next_step: "24h auto-release eller customer_attest → released",
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

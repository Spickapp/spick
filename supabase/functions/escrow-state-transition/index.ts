// ═══════════════════════════════════════════════════════════════
// SPICK – escrow-state-transition (Fas 8 §8.6)
// ═══════════════════════════════════════════════════════════════
//
// Central state-machine för bookings.escrow_state. ALLA övergångar
// mellan escrow-states MÅSTE gå genom denna EF. Inga andra EFs eller
// admin-UI får UPDATE:a escrow_state direkt.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §1.2
// State-machine-logik: supabase/functions/_shared/escrow-state.ts
//
// ARKITEKTUR:
//   1. Callers (stripe-webhook, cron, admin-UI, customer-UI) POST:ar
//      action + booking_id hit
//   2. _shared/escrow-state.validateInput validerar from_state-action-map
//   3. Uppdaterar bookings.escrow_state + INSERT escrow_events atomiskt
//   4. Returnerar ny state eller 422 vid ogiltig övergång
//
// OUT-OF-SCOPE (separata EFs):
//   - Stripe transfers/refunds (escrow-release, refund-booking)
//   - Dispute-open-flöde (dispute-open-EF kommer i §8.15)
//   - SLA-timers (escrow-auto-release cron)
//
// AUTH: Service-role bearer token required. Customer/admin-UI går
// genom dedicated wrapper-EFs som validerar ownership innan de
// anropar denna.
//
// REGLER: #26 exact text från arkitektur-doc §1.2, #27 scope (bara
// state-machine, inga side-effects i Stripe eller notifications),
// #28 SSOT för transitions = _shared/escrow-state.ts,
// #30 ingen Stripe-touch (separat EF), #31 prod-schema verifierad
// (migration 20260427000007 live).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { validateInput } from "../_shared/escrow-state.ts";
import { verifyInternalSecret } from "../_shared/auth.ts";
import { createLogger } from "../_shared/log.ts";
import { retryWithBackoff } from "../_shared/retry-backoff.ts";
import { withSentry } from "../_shared/sentry.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("escrow-state-transition");

Deno.serve(withSentry("escrow-state-transition", async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: shared-secret-header (2026-04-24 rotorsaksfix) ──
    // Tidigare JWT-validering avvisades av Supabase gateway oavsett
    // giltig service_role-JWT. Shared secret via X-Internal-Secret
    // header är robust + enkel. EF deploy:ad med --no-verify-jwt.
    if (!verifyInternalSecret(req)) {
      return json(CORS, 403, { error: "internal_secret_required" });
    }

    // ── Body + validation ──
    const body = await req.json().catch(() => null);
    const validation = validateInput(body);
    if (!validation.ok) {
      return json(CORS, 400, {
        error: validation.error,
        ...(validation.details ? { details: validation.details } : {}),
      });
    }
    const { booking_id, action, transition, triggered_by, triggered_by_id, metadata } = validation.input;

    // ── Hämta nuvarande state ──
    const { data: booking, error: fetchErr } = await sb
      .from("bookings")
      .select("id, escrow_state")
      .eq("id", booking_id)
      .maybeSingle();

    if (fetchErr) {
      log("error", "Fetch booking failed", { booking_id, error: fetchErr.message });
      return json(CORS, 500, { error: "fetch_failed", details: fetchErr.message });
    }
    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found", booking_id });
    }

    const fromState = booking.escrow_state as string;

    // ── Validera from_state ──
    if (!transition.from.includes(fromState as typeof transition.from[number])) {
      log("warn", "Invalid transition attempt", {
        booking_id, action, from_state: fromState, expected_from: transition.from,
      });
      return json(CORS, 422, {
        error: "invalid_transition",
        details: {
          current_state: fromState,
          action,
          expected_from: transition.from,
          to_state: transition.to,
        },
      });
    }

    // No-op: om new state samma som old → ingen transition
    if (fromState === transition.to) {
      return json(CORS, 200, {
        ok: true,
        booking_id,
        from_state: fromState,
        to_state: transition.to,
        action,
        noop: true,
      });
    }

    // ── Atomisk UPDATE med optimistic concurrency control + retry ──
    // P1 Race Fix #2: wrap UPDATE i retryWithBackoff (3 attempts, 100ms→200ms→400ms)
    // för transienta optimistic-lock-konflikter. Permanenta konflikter kastas vidare.
    let updated: { id: string; escrow_state: string } | null = null;
    let updateErr: { message: string } | null = null;
    try {
      updated = await retryWithBackoff(
        async () => {
          const { data, error } = await sb
            .from("bookings")
            .update({ escrow_state: transition.to })
            .eq("id", booking_id)
            .eq("escrow_state", fromState)
            .select("id, escrow_state")
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("optimistic_lock_conflict");
          return data;
        },
        { maxAttempts: 3, initialDelayMs: 100 }
      );
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "optimistic_lock_conflict") {
        return json(CORS, 409, {
          error: "state_changed_concurrently",
          details: { booking_id, expected_from: fromState },
        });
      }
      updateErr = { message: msg };
    }

    if (updateErr) {
      log("error", "Update failed", { booking_id, error: updateErr.message });
      return json(CORS, 500, { error: "update_failed", details: updateErr.message });
    }
    if (!updated) {
      return json(CORS, 409, {
        error: "state_changed_concurrently",
        details: { booking_id, expected_from: fromState },
      });
    }

    // ── INSERT escrow_events via SECURITY DEFINER RPC ──
    // Rotorsak 2026-04-24: direct INSERT blockerades av RLS trots
    // service_role (Supabase-konfig-drift). log_escrow_event RPC
    // kör som function-owner → bypassar RLS konsistent.
    const { error: eventErr } = await sb.rpc("log_escrow_event", {
      p_booking_id: booking_id,
      p_from_state: fromState,
      p_to_state: transition.to,
      p_triggered_by: triggered_by,
      p_triggered_by_id: triggered_by_id,
      p_metadata: { action, ...metadata },
    });

    if (eventErr) {
      log("warn", "log_escrow_event RPC failed (state changed, audit missing)", {
        booking_id, from_state: fromState, to_state: transition.to, error: eventErr.message,
      });
    }

    log("info", "State transition", {
      booking_id, action, from_state: fromState, to_state: transition.to,
      triggered_by, has_metadata: Object.keys(metadata).length > 0,
    });

    return json(CORS, 200, {
      ok: true,
      booking_id,
      from_state: fromState,
      to_state: transition.to,
      action,
      triggered_by,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
}));

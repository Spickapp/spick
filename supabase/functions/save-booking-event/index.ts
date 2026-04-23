// ═══════════════════════════════════════════════════════════════
// SPICK – save-booking-event (Fas 6.3 + §6.5 beslut 2026-04-23)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE:
//   Säker anon-frontend-path för customer-initiated booking_events.
//   Ersätter direkt-RPC-call från betyg.html (+ framtida attest-UI,
//   recurring-UI, dispute-open-UI). Server validerar booking-ownership
//   via customer_email-match innan logging.
//
// §6.5 BESLUT (2026-04-23, Farhad godkände):
//   Customer-initiated events → via EF (denna), inte direkt RPC.
//   Säkerhetsmodell: server-validerar ownership + whitelistar event_type.
//
// INPUT:
//   {
//     booking_id:    uuid (required),
//     customer_email: string (required, matches booking.customer_email),
//     event_type:    string (whitelisted — se EVENT_TYPE_WHITELIST),
//     metadata:      object (optional, event-type-specific fields)
//   }
//
// OUTPUT:
//   200: { success: true, event_type, logged_at }
//   400: { error: "validation", details }
//   403: { error: "unauthorized", reason } — email mismatch
//   404: { error: "booking_not_found" }
//   422: { error: "event_type_not_allowed", allowed }
//
// SÄKERHETSMODELL:
//   - Bygger på att kunden har booking_id + customer_email
//   - Booking-ownership valideras server-side (email-match)
//   - event_type whitelist (bara customer-facing types)
//   - Rate-limit ska läggas till framtida (se TODO nedan)
//
// REGLER: #26 grep-före-edit (events.ts + booking_confirmation-schema
// verifierade), #27 scope (bara denna EF), #28 single source
// (logBookingEvent från _shared/events.ts), #30 (whitelist = safer
// than open), #31 (primärkälla = booking_confirmation för ownership).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { logBookingEvent, type BookingEventType } from "../_shared/events.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

/**
 * Whitelist av event_types som customer får logga via denna EF.
 * Andra event_types (cleaner_assigned, payment_received etc.) loggas
 * server-side från andra EFs via direkt log_booking_event-RPC.
 *
 * Lägg till framtida:
 *   - 'dispute_opened' (när Fas 8 dispute-UI byggs)
 *   - 'booking_attested' (när Fas 8 attest-UI byggs)
 */
const EVENT_TYPE_WHITELIST: ReadonlyArray<BookingEventType> = [
  "review_submitted",
  "cancelled_by_customer",
];

function normalizeEmail(email: string): string {
  return typeof email === "string" ? email.toLowerCase().trim() : "";
}

function isValidUuid(id: string): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  try {
    // ── RATE-LIMIT (20 calls / 5 min per IP) ─────────────
    // Anvander existing check_rate_limit RPC (migration 20260327300001).
    // Regel #28: single source — bygger inte eget rate-limit-system.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") || "unknown";
    try {
      const { data: allowed, error: rlErr } = await sb.rpc("check_rate_limit", {
        p_key: `save_event:${ip}`,
        p_max: 20,
        p_window_minutes: 5,
      });
      if (rlErr) {
        console.warn("[save-booking-event] rate-limit check fel:", rlErr.message);
        // Fail-open: om rate-limit-check failar, tillat request (annars
        // blockeras all trafik vid DB-issues). Loggas for monitoring.
      } else if (allowed === false) {
        return new Response(
          JSON.stringify({
            error: "rate_limit_exceeded",
            retry_after_seconds: 60,
          }),
          {
            status: 429,
            headers: {
              ...CORS,
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
          },
        );
      }
    } catch (e) {
      console.warn("[save-booking-event] rate-limit oväntat fel:", (e as Error).message);
      // Fail-open (se ovan)
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(
        JSON.stringify({ error: "validation", details: "invalid_json_body" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const { booking_id, customer_email, event_type, metadata = {} } = body as {
      booking_id?: unknown;
      customer_email?: unknown;
      event_type?: unknown;
      metadata?: unknown;
    };

    // ── VALIDERING ────────────────────────────────────────
    if (typeof booking_id !== "string" || !isValidUuid(booking_id)) {
      return new Response(
        JSON.stringify({ error: "validation", details: "booking_id must be valid uuid" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (typeof customer_email !== "string" || !customer_email) {
      return new Response(
        JSON.stringify({ error: "validation", details: "customer_email required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (typeof event_type !== "string") {
      return new Response(
        JSON.stringify({ error: "validation", details: "event_type required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (!EVENT_TYPE_WHITELIST.includes(event_type as BookingEventType)) {
      return new Response(
        JSON.stringify({
          error: "event_type_not_allowed",
          received: event_type,
          allowed: EVENT_TYPE_WHITELIST,
        }),
        { status: 422, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── OWNERSHIP-CHECK ────────────────────────────────────
    const { data: booking, error: bookingErr } = await sb
      .from("booking_confirmation")
      .select("id, customer_email, cleaner_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingErr) {
      console.warn("[save-booking-event] booking lookup error:", bookingErr.message);
      return new Response(
        JSON.stringify({ error: "lookup_failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (!booking) {
      return new Response(
        JSON.stringify({ error: "booking_not_found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const providedEmail = normalizeEmail(customer_email);
    const bookingEmail = normalizeEmail(booking.customer_email as string);

    if (providedEmail !== bookingEmail) {
      return new Response(
        JSON.stringify({
          error: "unauthorized",
          reason: "email_mismatch",
        }),
        { status: 403, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── LOG EVENT ──────────────────────────────────────────
    const sanitizedMetadata = typeof metadata === "object" && metadata !== null
      ? metadata as Record<string, unknown>
      : {};

    // Sätt automatiska audit-fält
    sanitizedMetadata._source = "save-booking-event";
    sanitizedMetadata._actor_email_hash = await hashEmail(providedEmail);

    const logged = await logBookingEvent(sb, booking_id, event_type as BookingEventType, {
      actorType: "customer",
      metadata: sanitizedMetadata,
    });

    if (!logged) {
      return new Response(
        JSON.stringify({ error: "log_failed" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_type,
        booking_id,
        logged_at: new Date().toISOString(),
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[save-booking-event] unexpected error:", msg);
    return new Response(
      JSON.stringify({ error: "internal_error", details: msg }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});

// ── Hash-helper (SHA-256, kort prefix) för audit utan raw email ─
// GDPR-safe: lagra bara hash som bevis på ownership, inte klartext
async function hashEmail(email: string): Promise<string> {
  try {
    const enc = new TextEncoder();
    const hash = await crypto.subtle.digest("SHA-256", enc.encode(email));
    const bytes = new Uint8Array(hash);
    let hex = "";
    for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex; // 16-char prefix räcker för audit-trail
  } catch {
    return "unknown";
  }
}

// TODO (framtida Fas 6.3b):
// - Rate-limit per IP (max 10/min) via check_rate_limit() RPC
// - JWT-auth-support för inloggade customers (alternativ till email-match)
// - Expansion av whitelist när Fas 8 attest-UI + dispute-UI byggs

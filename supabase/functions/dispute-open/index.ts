// ═══════════════════════════════════════════════════════════════
// SPICK – dispute-open (Fas 8 §8.8)
// ═══════════════════════════════════════════════════════════════
//
// Kund öppnar formell dispute inom 24h efter städning via
// min-bokning.html. EU Platform Work Directive (PWD) kräver
// strukturerad dispute-process + audit-trail — denna EF är
// customer-facing entry-point.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §3.2 + §6
//
// FLÖDE:
//   1. Customer JWT auth + bearer token
//   2. Validera input (booking_id, reason, customer_description)
//   3. Hämta booking + verify customer_email matchar JWT-email
//   4. Verify escrow_state === 'awaiting_attest' (bara i dispute-window)
//   5. Verify inom 24h-SLA från job_completed (awaiting_attest-start)
//   6. INSERT disputes-row (UNIQUE booking_id skyddar mot dubblering)
//   7. Call escrow-state-transition → 'disputed' (action='dispute_open')
//   8. logBookingEvent('dispute_opened')
//   9. sendAdminAlert(severity='critical') — EU 7-dagars-SLA startar
//
// RATE-LIMIT: en dispute per booking (DB UNIQUE constraint). Repeated
// calls returnerar 409 efter första lyckade.
//
// OUT-OF-SCOPE:
//   - Dispute-evidence upload (separat EF dispute-evidence-upload §8.13)
//   - Cleaner-response (dispute-cleaner-respond §8.9)
//   - Admin-beslut (dispute-admin-decide §8.14)
//
// REGLER: #26 grep booking-ownership + JWT-auth-patterns (mönster från
// save-booking-event EF), #27 scope (bara open, ingen evidence/response),
// #28 SSOT = escrow-state-transition-EF för state + disputes-tabell
// för dispute-record, #30 EU PWD-compliance — structured dispute
// + audit + 24h-SLA är regulator-krav, implementerat exakt per
// arkitektur-doc (ingen spec-gissning), #31 prod-schema verifierat
// (disputes + escrow_events live).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

// 24h SLA från arkitektur-doc §5
const DISPUTE_WINDOW_HOURS = 24;

// Giltiga dispute-reasons (whitelist). Extendable vid behov.
const VALID_REASONS = [
  "not_as_described",     // städning inte som beskrivet
  "incomplete",           // jobb inte slutfört
  "damage",               // skada uppstod
  "no_show",              // städare dök inte upp
  "quality",              // otillräcklig kvalitet
  "other",                // annat (customer_description krävs)
] as const;

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("dispute-open");

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: customer JWT ──
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

    const customerEmail = user.email?.toLowerCase().trim();
    if (!customerEmail) {
      return json(CORS, 401, { error: "email_missing_in_token" });
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
    if (typeof b.reason !== "string" || !VALID_REASONS.includes(b.reason as typeof VALID_REASONS[number])) {
      return json(CORS, 400, {
        error: "invalid_reason",
        details: { allowed: VALID_REASONS },
      });
    }
    if (b.reason === "other" && (typeof b.customer_description !== "string" || b.customer_description.trim().length < 10)) {
      return json(CORS, 400, {
        error: "description_required_for_other",
        details: { min_length: 10 },
      });
    }
    // Cap description-length för att skydda DB
    const customerDescription = typeof b.customer_description === "string"
      ? b.customer_description.slice(0, 2000).trim()
      : null;

    const bookingId = b.booking_id as string;
    const reason = b.reason as string;

    // ── Hämta booking ──
    const { data: booking, error: bookingErr } = await sbService
      .from("bookings")
      .select("id, customer_email, escrow_state, booking_date, total_price, cleaner_id, cleaner_name")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingErr) {
      log("error", "Booking fetch failed", { booking_id: bookingId, error: bookingErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }

    // ── Ownership: customer_email på booking måste matcha JWT-email ──
    const bookingEmail = (booking.customer_email as string | null)?.toLowerCase().trim();
    if (!bookingEmail || bookingEmail !== customerEmail) {
      log("warn", "Dispute-open ownership mismatch", {
        booking_id: bookingId,
        jwt_email: customerEmail.slice(0, 5) + "...",
      });
      return json(CORS, 403, { error: "not_booking_owner" });
    }

    // ── State-validering: bara disputable om awaiting_attest ──
    const fromState = booking.escrow_state as string;
    if (fromState !== "awaiting_attest") {
      return json(CORS, 422, {
        error: "dispute_not_allowed_in_current_state",
        details: {
          current_state: fromState,
          required_state: "awaiting_attest",
        },
      });
    }

    // ── 24h-window från job_completed (awaiting_attest-start) ──
    // Använder escrow_events.created_at som sanning för när state-transition hände.
    const { data: attestEvent } = await sbService
      .from("escrow_events")
      .select("created_at")
      .eq("booking_id", bookingId)
      .eq("to_state", "awaiting_attest")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (attestEvent?.created_at) {
      const windowStart = new Date(attestEvent.created_at as string).getTime();
      const hoursSince = (Date.now() - windowStart) / (60 * 60 * 1000);
      if (hoursSince > DISPUTE_WINDOW_HOURS) {
        return json(CORS, 422, {
          error: "dispute_window_expired",
          details: {
            hours_since_attest_window_start: Math.round(hoursSince * 10) / 10,
            max_hours: DISPUTE_WINDOW_HOURS,
          },
        });
      }
    }
    // Om attestEvent saknas: skippa window-check (backward-compat för
    // bokningar där escrow_events-audit inte fångats). Framtida: krav
    // på attest-event finns när escrow_v2 är fullt aktiverat.

    // ── INSERT disputes (UNIQUE booking_id skyddar) ──
    const { data: disputeRow, error: disputeErr } = await sbService
      .from("disputes")
      .insert({
        booking_id: bookingId,
        opened_by: user.id,
        reason,
        customer_description: customerDescription,
      })
      .select("id, opened_at")
      .single();

    if (disputeErr) {
      // Check for duplicate (already disputed)
      if (disputeErr.code === "23505") {
        return json(CORS, 409, { error: "dispute_already_exists" });
      }
      log("error", "Dispute insert failed", { booking_id: bookingId, error: disputeErr.message });
      return json(CORS, 500, { error: "dispute_insert_failed" });
    }

    const disputeId = disputeRow.id as string;

    // ── State-transition via escrow-state-transition EF ──
    const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
      },
      body: JSON.stringify({
        booking_id: bookingId,
        action: "dispute_open",
        triggered_by: "customer",
        triggered_by_id: user.id,
        metadata: {
          dispute_id: disputeId,
          reason,
        },
      }),
    });

    if (!transRes.ok) {
      // Kritisk inkonsistens: dispute-rad finns men state-transition failade.
      // Vi rullar TILLBAKA disputes-raden för konsistens.
      await sbService.from("disputes").delete().eq("id", disputeId);
      const transErr = await transRes.json().catch(() => ({}));
      log("error", "state-transition failed after dispute-insert (rolled back)", {
        booking_id: bookingId,
        dispute_id: disputeId,
        status: transRes.status,
        error: transErr.error,
      });
      return json(CORS, 500, {
        error: "dispute_state_transition_failed",
        details: "Dispute-registrering rullades tillbaka.",
      });
    }

    // ── Audit-log + admin-alert (båda best-effort efter state-change) ──
    await logBookingEvent(sbService, bookingId, "dispute_opened", {
      actorType: "customer",
      metadata: {
        dispute_id: disputeId,
        reason,
        evidence_count: 0, // uppdateras när dispute-evidence-upload byggs §8.13
      },
    });

    await sendAdminAlert({
      severity: "critical",
      title: `Dispute öppnad: ${reason}`,
      source: "dispute-open",
      message: "EU-PWD 7-dagars-SLA startar. Admin måste fatta beslut (full_refund/partial_refund/dismissed) inom 7d.",
      booking_id: bookingId,
      cleaner_id: (booking.cleaner_id as string) || undefined,
      metadata: {
        dispute_id: disputeId,
        reason,
        customer: customerEmail,
        cleaner_name: booking.cleaner_name || "–",
        amount_sek: booking.total_price || 0,
        booking_date: booking.booking_date,
      },
    });

    log("info", "Dispute opened", {
      booking_id: bookingId,
      dispute_id: disputeId,
      reason,
      customer: customerEmail.slice(0, 5) + "...",
    });

    return json(CORS, 200, {
      ok: true,
      dispute_id: disputeId,
      booking_id: bookingId,
      opened_at: disputeRow.opened_at,
      reason,
      next_steps: {
        evidence_upload: "Ladda upp foto-bevis inom 24h (max 5 bilder).",
        admin_decision_sla_hours: 168, // 7 dagar
      },
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

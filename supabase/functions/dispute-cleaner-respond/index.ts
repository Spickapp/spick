// ═══════════════════════════════════════════════════════════════
// SPICK – dispute-cleaner-respond (Fas 8 §8.9)
// ═══════════════════════════════════════════════════════════════
//
// Städare svarar på dispute inom 48h-SLA. Balanserar customer-
// sidan (dispute-open §8.8). EU PWD kräver bägge parter får yttra
// sig innan admin beslutar.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §5 SLA
//
// FLÖDE:
//   1. Cleaner JWT auth
//   2. Validate input (dispute_id, response_text 10-2000 chars)
//   3. Fetch dispute + booking → verify cleaner-ownership via
//      booking.cleaner_id → cleaners.auth_user_id
//   4. Verify dispute not resolved + no existing response
//   5. Verify inom 48h från dispute.opened_at
//   6. UPDATE disputes (cleaner_response, cleaner_responded_at)
//   7. logBookingEvent('dispute_cleaner_responded')
//   8. sendAdminAlert (info) — admin kan nu besluta utan SLA-tomrum
//
// OUT-OF-SCOPE:
//   - Cleaner-evidence-upload (§8.13)
//   - Admin-beslut (§8.14 dispute-admin-decide)
//
// REGLER: #26 grep dispute-open för JWT-auth-pattern, #27 scope
// (bara cleaner-response, ingen admin-trigger), #28 SSOT = disputes-
// tabellen, #30 EU PWD: bägge parter MÅSTE få yttra sig före
// admin-beslut — denna EF säkrar det, #31 disputes schema live.
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

// 48h SLA från arkitektur-doc §5
const RESPONSE_WINDOW_HOURS = 48;

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("dispute-cleaner-respond");

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

    if (!isValidUuid(b.dispute_id)) {
      return json(CORS, 400, { error: "invalid_dispute_id" });
    }
    if (typeof b.response_text !== "string") {
      return json(CORS, 400, { error: "response_text_required" });
    }
    const responseText = b.response_text.trim();
    if (responseText.length < 10) {
      return json(CORS, 400, {
        error: "response_too_short",
        details: { min_length: 10 },
      });
    }
    if (responseText.length > 2000) {
      return json(CORS, 400, {
        error: "response_too_long",
        details: { max_length: 2000 },
      });
    }

    const disputeId = b.dispute_id as string;

    // ── Fetch cleaner (ownership-referens) ──
    const { data: cleaner, error: cleanerErr } = await sbService
      .from("cleaners")
      .select("id, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (cleanerErr || !cleaner) {
      return json(CORS, 403, { error: "not_a_cleaner" });
    }

    // ── Fetch dispute + booking (verify ownership) ──
    const { data: dispute, error: disputeErr } = await sbService
      .from("disputes")
      .select("id, booking_id, reason, admin_decision, resolved_at, opened_at, cleaner_response, cleaner_responded_at")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeErr) {
      log("error", "Dispute fetch failed", { dispute_id: disputeId, error: disputeErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!dispute) {
      return json(CORS, 404, { error: "dispute_not_found" });
    }

    // ── Verify cleaner är tilldelad bokningen ──
    const { data: booking } = await sbService
      .from("bookings")
      .select("id, cleaner_id, customer_name, booking_date")
      .eq("id", dispute.booking_id as string)
      .maybeSingle();

    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }
    if (booking.cleaner_id !== cleaner.id) {
      log("warn", "Cleaner-ownership mismatch", {
        dispute_id: disputeId,
        cleaner_id: cleaner.id,
        booking_cleaner_id: booking.cleaner_id,
      });
      return json(CORS, 403, { error: "not_your_booking" });
    }

    // ── State-validering ──
    if (dispute.resolved_at) {
      return json(CORS, 409, {
        error: "dispute_already_resolved",
        details: {
          existing_decision: dispute.admin_decision,
          resolved_at: dispute.resolved_at,
        },
      });
    }
    if (dispute.cleaner_response) {
      return json(CORS, 409, {
        error: "response_already_submitted",
        details: {
          responded_at: dispute.cleaner_responded_at,
        },
      });
    }

    // ── 48h-SLA-check från dispute.opened_at ──
    const openedAt = new Date(dispute.opened_at as string).getTime();
    const hoursSince = (Date.now() - openedAt) / (60 * 60 * 1000);
    if (hoursSince > RESPONSE_WINDOW_HOURS) {
      return json(CORS, 422, {
        error: "response_window_expired",
        details: {
          hours_since_opened: Math.round(hoursSince * 10) / 10,
          max_hours: RESPONSE_WINDOW_HOURS,
          note: "Admin kommer fatta beslut utan cleaner-response. Detta kan påverka utfallet.",
        },
      });
    }

    // ── UPDATE disputes ──
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await sbService
      .from("disputes")
      .update({
        cleaner_response: responseText,
        cleaner_responded_at: nowIso,
      })
      .eq("id", disputeId)
      .is("cleaner_response", null); // Optimistic concurrency

    if (updateErr) {
      log("error", "Dispute update failed", { dispute_id: disputeId, error: updateErr.message });
      return json(CORS, 500, { error: "update_failed" });
    }

    // ── Audit + alert ──
    await logBookingEvent(sbService, dispute.booking_id as string, "dispute_cleaner_responded", {
      actorType: "cleaner",
      metadata: {
        dispute_id: disputeId,
        response: responseText,
        evidence_count: 0, // uppdateras när §8.13 evidence-upload byggs
      },
    });

    await sendAdminAlert({
      severity: "info",
      title: `Dispute: ${cleaner.full_name} svarade`,
      source: "dispute-cleaner-respond",
      message: "Båda parter har yttrat sig. Admin kan nu fatta beslut.",
      booking_id: dispute.booking_id as string,
      cleaner_id: cleaner.id,
      metadata: {
        dispute_id: disputeId,
        reason: dispute.reason,
        customer: booking.customer_name,
        booking_date: booking.booking_date,
        response_preview: responseText.slice(0, 200),
      },
    });

    log("info", "Cleaner responded to dispute", {
      dispute_id: disputeId,
      booking_id: dispute.booking_id,
      cleaner_id: cleaner.id,
      response_length: responseText.length,
    });

    return json(CORS, 200, {
      ok: true,
      dispute_id: disputeId,
      booking_id: dispute.booking_id,
      responded_at: nowIso,
      next_step: "Admin fattar beslut inom 7 dagar (EU PWD SLA).",
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

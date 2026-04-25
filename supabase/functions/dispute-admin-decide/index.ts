// ═══════════════════════════════════════════════════════════════
// SPICK – dispute-admin-decide (Fas 8 §8.14)
// ═══════════════════════════════════════════════════════════════
//
// Admin fattar beslut på dispute: full_refund / partial_refund /
// dismissed. Uppdaterar disputes-raden + transitionerar escrow_state
// till resolved_*. Money-ops (Stripe refund/transfer) görs separat
// via transfer_full_refund-action + escrow-release-EF.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §3.2
//
// AUTH (rule #30 konservativt):
//   Service-role bearer required. Admin-UI i admin.html kan inte
//   anropa direkt — behöver antingen proxy-EF eller admin-JWT-
//   validering (framtida §8.15). För nu: admin använder Supabase
//   Studio Function Invoker med service-role-key.
//
// FLÖDE:
//   1. Service-role auth
//   2. Validate input (dispute_id, decision, refund_amount_sek?,
//      admin_notes?, admin_id)
//   3. Fetch dispute + verify not resolved
//   4. Validate: partial_refund kräver refund_amount_sek > 0 och
//      < total_price
//   5. UPDATE disputes (admin_decision, admin_decided_at, ...)
//   6. Call escrow-state-transition med matchande admin-action
//   7. logBookingEvent('dispute_resolved')
//   8. sendAdminAlert (info) för audit
//
// OUT-OF-SCOPE:
//   - Stripe refund (separat refund-booking EF behövs för
//     resolved_full_refund → refunded)
//   - Stripe transfer (escrow-release hanterar resolved_dismissed →
//     released via trigger='admin_dismiss_transfer')
//
// REGLER: #26 grep dispute-open-pattern för struktur, #27 scope
// (bara decision-endpoint, ingen money-op), #28 SSOT =
// escrow-state-transition för state, disputes-tabell för record,
// #30 money-flow deferred till separata EFs med egen rule #30-
// verifiering, #31 disputes + escrow_events schema live.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { verifyInternalSecret } from "../_shared/auth.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type AdminDecision = "full_refund" | "partial_refund" | "dismissed";

// Map decision → escrow-state-transition-action
const DECISION_ACTION_MAP: Record<AdminDecision, string> = {
  full_refund: "admin_full_refund",       // disputed → resolved_full_refund
  partial_refund: "admin_partial_refund", // disputed → resolved_partial_refund
  dismissed: "admin_dismiss",             // disputed → resolved_dismissed
};

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("dispute-admin-decide");

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: shared-secret (internal EF-to-EF calls) ──
    if (!verifyInternalSecret(req)) {
      return json(CORS, 403, { error: "internal_secret_required" });
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
    if (typeof b.decision !== "string" || !(b.decision in DECISION_ACTION_MAP)) {
      return json(CORS, 400, {
        error: "invalid_decision",
        details: { allowed: Object.keys(DECISION_ACTION_MAP) },
      });
    }
    if (b.admin_id !== undefined && b.admin_id !== null && !isValidUuid(b.admin_id)) {
      return json(CORS, 400, { error: "invalid_admin_id" });
    }

    const disputeId = b.dispute_id as string;
    const decision = b.decision as AdminDecision;
    const adminId = (b.admin_id as string | undefined) ?? null;
    const adminNotes = typeof b.admin_notes === "string"
      ? b.admin_notes.slice(0, 2000).trim()
      : null;
    const refundAmountInput = b.refund_amount_sek;

    // ── Fetch dispute + booking (joined) ──
    const { data: dispute, error: disputeErr } = await sb
      .from("disputes")
      .select("id, booking_id, reason, admin_decision, resolved_at, opened_at")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeErr) {
      log("error", "Dispute fetch failed", { dispute_id: disputeId, error: disputeErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!dispute) {
      return json(CORS, 404, { error: "dispute_not_found" });
    }
    if (dispute.resolved_at) {
      return json(CORS, 409, {
        error: "dispute_already_resolved",
        details: {
          existing_decision: dispute.admin_decision,
          resolved_at: dispute.resolved_at,
        },
      });
    }

    const bookingId = dispute.booking_id as string;

    // ── Hämta booking för refund-amount-validation ──
    const { data: booking } = await sb
      .from("bookings")
      .select("id, total_price, escrow_state")
      .eq("id", bookingId)
      .maybeSingle();

    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }
    if (booking.escrow_state !== "disputed") {
      return json(CORS, 422, {
        error: "booking_not_in_disputed_state",
        details: { current_state: booking.escrow_state },
      });
    }

    // ── partial_refund-specific validering ──
    let refundAmountSek: number | null = null;
    if (decision === "partial_refund") {
      if (typeof refundAmountInput !== "number" || !Number.isFinite(refundAmountInput)) {
        return json(CORS, 400, { error: "refund_amount_sek_required_for_partial" });
      }
      const rounded = Math.round(refundAmountInput);
      const totalPrice = Number(booking.total_price) || 0;
      if (rounded <= 0 || rounded >= totalPrice) {
        return json(CORS, 400, {
          error: "invalid_refund_amount",
          details: {
            min: 1,
            max: totalPrice - 1,
            provided: rounded,
            note: "partial_refund kräver 0 < amount < total_price. Använd full_refund för hela beloppet.",
          },
        });
      }
      refundAmountSek = rounded;
    } else if (decision === "full_refund") {
      refundAmountSek = Number(booking.total_price) || 0;
    }
    // dismissed: ingen refund_amount

    // ── UPDATE disputes ──
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("disputes")
      .update({
        admin_decision: decision,
        admin_decided_at: nowIso,
        resolved_at: nowIso,
        refund_amount_sek: refundAmountSek,
        admin_notes: adminNotes,
      })
      .eq("id", disputeId)
      .is("resolved_at", null); // Optimistic concurrency: bara om inte redan resolved

    if (updateErr) {
      log("error", "Dispute UPDATE failed", { dispute_id: disputeId, error: updateErr.message });
      return json(CORS, 500, { error: "update_failed" });
    }

    // ── State-transition via escrow-state-transition-EF ──
    const transitionAction = DECISION_ACTION_MAP[decision];
    const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
      },
      body: JSON.stringify({
        booking_id: bookingId,
        action: transitionAction,
        triggered_by: "admin",
        triggered_by_id: adminId,
        metadata: {
          dispute_id: disputeId,
          decision,
          refund_amount_sek: refundAmountSek,
        },
      }),
    });

    if (!transRes.ok) {
      // State-transition failade — dispute-raden har uppdaterats men
      // escrow_state är fortfarande 'disputed'. Inkonsistens.
      // Vi rullar TILLBAKA dispute-raden för konsistens.
      await sb.from("disputes").update({
        admin_decision: null,
        admin_decided_at: null,
        resolved_at: null,
        refund_amount_sek: null,
      }).eq("id", disputeId);

      const transErr = await transRes.json().catch(() => ({}));
      log("error", "State-transition failed (dispute rolled back)", {
        dispute_id: disputeId,
        booking_id: bookingId,
        action: transitionAction,
        status: transRes.status,
        error: transErr.error,
      });
      return json(CORS, 500, {
        error: "state_transition_failed",
        details: "Dispute-beslutet rullades tillbaka.",
      });
    }

    // ── Audit + alerts (best-effort) ──
    await logBookingEvent(sb, bookingId, "dispute_resolved", {
      actorType: "admin",
      metadata: {
        dispute_id: disputeId,
        resolution: decision,
        refund_amount: refundAmountSek,
      },
    });

    // ── §8.11.b: Auto-genomför money-op efter resolution ──
    // full_refund    → refund-booking EF (Stripe refund + transfer_full_refund)
    // partial_refund → refund-booking EF med partial_amount_sek (§8.22, 2026-04-25)
    //                  Stripe partial-refund + transfer_partial_refund.
    //                  Cleaner-andel kvar för MANUELL transfer (§8.23 DEFERRED).
    // dismissed      → escrow-release EF (transfer till städare, admin_dismiss_transfer)
    let autoOpResult: Record<string, unknown> | null = null;
    const internalSecret = Deno.env.get("INTERNAL_EF_SECRET") || "";
    if (decision === "full_refund") {
      try {
        const refundRes = await fetch(`${SUPABASE_URL}/functions/v1/refund-booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
          body: JSON.stringify({
            booking_id: bookingId,
            admin_id: adminId,
            reason: `dispute_full_refund: ${dispute.reason}`,
          }),
        });
        const refundJson = await refundRes.json().catch(() => ({}));
        autoOpResult = { op: "refund-booking", status: refundRes.status, ...refundJson };
        if (!refundRes.ok) {
          log("warn", "Auto-refund-booking failed (state är resolved_full_refund, manual retry möjlig)", {
            dispute_id: disputeId, status: refundRes.status, error: (refundJson as { error?: string }).error,
          });
        }
      } catch (e) {
        autoOpResult = { op: "refund-booking", error: (e as Error).message };
        log("warn", "Auto-refund-booking exception", { dispute_id: disputeId, error: (e as Error).message });
      }
    } else if (decision === "partial_refund") {
      try {
        const refundRes = await fetch(`${SUPABASE_URL}/functions/v1/refund-booking`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
          body: JSON.stringify({
            booking_id: bookingId,
            admin_id: adminId,
            reason: `dispute_partial_refund: ${dispute.reason}`,
            partial_amount_sek: refundAmountSek,
          }),
        });
        const refundJson = await refundRes.json().catch(() => ({}));
        autoOpResult = { op: "refund-booking", mode: "partial", status: refundRes.status, ...refundJson };
        if (!refundRes.ok) {
          log("warn", "Auto-refund-booking (partial) failed (state är resolved_partial_refund, manual retry möjlig)", {
            dispute_id: disputeId, status: refundRes.status, error: (refundJson as { error?: string }).error,
          });
        }
      } catch (e) {
        autoOpResult = { op: "refund-booking", mode: "partial", error: (e as Error).message };
        log("warn", "Auto-refund-booking (partial) exception", { dispute_id: disputeId, error: (e as Error).message });
      }
    } else if (decision === "dismissed") {
      try {
        const releaseRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-release`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Internal-Secret": internalSecret },
          body: JSON.stringify({
            booking_id: bookingId,
            trigger: "admin_dismiss_transfer",
          }),
        });
        const releaseJson = await releaseRes.json().catch(() => ({}));
        autoOpResult = { op: "escrow-release", status: releaseRes.status, ...releaseJson };
        if (!releaseRes.ok) {
          log("warn", "Auto-escrow-release failed (state är resolved_dismissed, manual retry möjlig)", {
            dispute_id: disputeId, status: releaseRes.status, error: (releaseJson as { error?: string }).error,
          });
        }
      } catch (e) {
        autoOpResult = { op: "escrow-release", error: (e as Error).message };
        log("warn", "Auto-escrow-release exception", { dispute_id: disputeId, error: (e as Error).message });
      }
    }
    // partial_refund: ingen auto-op (DEFERRED till §8.22-25)

    await sendAdminAlert({
      severity: "info",
      title: `Dispute-beslut: ${decision}`,
      source: "dispute-admin-decide",
      booking_id: bookingId,
      metadata: {
        dispute_id: disputeId,
        decision,
        refund_amount_sek: refundAmountSek,
        auto_op_result: autoOpResult,
        next_step: decision === "partial_refund"
          ? "MANUELL: partial-refund-flow ej implementerad (DEFERRED §8.22-25)."
          : autoOpResult && (autoOpResult as { ok?: boolean }).ok
          ? "Auto-op klar."
          : "Auto-op failed — kör refund-booking eller escrow-release manuellt.",
      },
    });

    log("info", "Dispute decided", {
      dispute_id: disputeId,
      booking_id: bookingId,
      decision,
      refund_amount_sek: refundAmountSek,
      auto_op_ok: autoOpResult ? (autoOpResult as { ok?: boolean }).ok ?? false : null,
    });

    return json(CORS, 200, {
      ok: true,
      dispute_id: disputeId,
      booking_id: bookingId,
      decision,
      refund_amount_sek: refundAmountSek,
      new_escrow_state: decision === "full_refund"
        ? (autoOpResult && (autoOpResult as { ok?: boolean }).ok ? "refunded" : "resolved_full_refund")
        : decision === "partial_refund"
        ? "resolved_partial_refund"
        : (autoOpResult && (autoOpResult as { ok?: boolean }).ok ? "released" : "resolved_dismissed"),
      auto_op: autoOpResult,
      next_step: decision === "partial_refund"
        ? "MANUELL: partial-refund-flow ej implementerad."
        : autoOpResult && (autoOpResult as { ok?: boolean }).ok
        ? "Klart — escrow-state har transitionerat till final-state."
        : "Auto-op failed — admin behöver retry refund-booking/escrow-release manuellt.",
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// SPICK – vd-dispute-decide (Fas 9 §9.2 — VD dispute-tier-1)
// ═══════════════════════════════════════════════════════════════
//
// VD (städfirma-ägare, is_company_owner=true) kan besluta disputes
// upp till 500 kr för bokningar i sitt eget team utan admin-inblandning.
// Detta är "tier-1" — snabbare turnaround för låga belopp, admin frigörs
// från trivial-decisions.
//
// PRIMÄRKÄLLA:
//   docs/architecture/dispute-escrow-system.md §12 (working defaults):
//     - Max refund utan admin: 500 kr VD tier-1 + 10% random admin-sampling
//     - 2-ögon-krav: >5000 kr (admin-only, ej VD-tier)
//
// SCOPE:
//   - VD JWT auth (cleaner WHERE is_company_owner=true)
//   - Begränsning: booking.cleaner_id måste tillhöra VD:s company
//   - decision='dismissed': alltid OK
//   - decision='full_refund': bara om booking.total_price <= 500
//   - decision='partial_refund': bara om refund_amount_sek <= 500
//     (DEFERRED — partial-refund-flow saknas i state-machine)
//   - 10% random sampling → admin-audit-alert
//
// ARKITEKTUR:
//   Detta är en wrapper-EF som forwardar till dispute-admin-decide
//   (samma pattern som admin-dispute-decide gör för admin-JWT).
//   Affärslogiken (state-transition, refund-orchestration) görs i
//   dispute-admin-decide. Denna EF är pure auth+validation-gate.
//
// REGLER: #26 grep VD-auth-pattern (booking-cancel-v2 rad 27-72) +
// dispute-admin-decide-payload-shape, #27 scope (bara wrapper, ingen
// duplicerad business-logic), #28 SSOT — affärslogik i dispute-admin-
// decide, #29 design-doc §12 working defaults läst, #30 500 kr-cap +
// 10% sampling är Farhad-godkända working defaults (inte regulator-
// gissning), #31 prod-state primärkälla (dispute-admin-decide live,
// cleaners.is_company_owner-kolumn används i flera EFs).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Working defaults från arkitektur-doc §12 (Farhad-godkända 2026-04-23)
const VD_TIER_1_MAX_REFUND_SEK = 500;
const ADMIN_AUDIT_SAMPLING_RATE = 0.1; // 10%

const log = createLogger("vd-dispute-decide");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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
    // ── VD JWT-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    if (token === ANON_KEY) {
      return json(CORS, 401, { error: "anon_token_rejected" });
    }

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!authRes.ok) {
      return json(CORS, 401, { error: "invalid_token" });
    }
    const authUser = await authRes.json();
    const userEmail = (authUser.email || "").toLowerCase().trim();
    if (!userEmail) {
      return json(CORS, 401, { error: "email_missing_in_token" });
    }

    // ── Verifiera VD-roll ──
    const { data: vdRow } = await sb
      .from("cleaners")
      .select("id, full_name, company_id")
      .eq("email", userEmail)
      .eq("is_company_owner", true)
      .maybeSingle();

    if (!vdRow || !vdRow.company_id) {
      log("warn", "Non-VD user attempted dispute-decide", { email_prefix: userEmail.slice(0, 5) });
      return json(CORS, 403, { error: "not_vd_or_no_company" });
    }

    const vdId = vdRow.id as string;
    const vdCompanyId = vdRow.company_id as string;

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const b = body as Record<string, unknown>;

    if (!isValidUuid(b.dispute_id)) {
      return json(CORS, 400, { error: "invalid_dispute_id" });
    }
    if (typeof b.decision !== "string") {
      return json(CORS, 400, { error: "invalid_decision" });
    }
    const decision = b.decision as string;
    if (!["full_refund", "partial_refund", "dismissed"].includes(decision)) {
      return json(CORS, 400, {
        error: "invalid_decision_value",
        details: { allowed: ["full_refund", "partial_refund", "dismissed"] },
      });
    }
    const refundAmountInput = b.refund_amount_sek;
    const vdNotes = typeof b.vd_notes === "string" ? b.vd_notes.slice(0, 1000) : null;

    // ── Hämta dispute + booking ──
    const { data: dispute, error: disputeErr } = await sb
      .from("disputes")
      .select("id, booking_id, reason, resolved_at")
      .eq("id", b.dispute_id as string)
      .maybeSingle();

    if (disputeErr) {
      log("error", "Dispute fetch failed", { dispute_id: b.dispute_id, error: disputeErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!dispute) {
      return json(CORS, 404, { error: "dispute_not_found" });
    }
    if (dispute.resolved_at) {
      return json(CORS, 409, { error: "dispute_already_resolved" });
    }

    const bookingId = dispute.booking_id as string;

    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id, total_price, escrow_state")
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

    // ── Ownership: booking.cleaner_id måste tillhöra VD:s company ──
    const { data: bookedCleaner } = await sb
      .from("cleaners")
      .select("id, company_id, full_name")
      .eq("id", booking.cleaner_id as string)
      .maybeSingle();

    if (!bookedCleaner || bookedCleaner.company_id !== vdCompanyId) {
      log("warn", "VD attempted dispute-decide on non-team booking", {
        vd_id: vdId, booking_id: bookingId,
      });
      return json(CORS, 403, { error: "booking_not_in_vd_team" });
    }

    // ── Tier-1 belopp-cap ──
    const totalPrice = Number(booking.total_price) || 0;
    let refundAmountSek: number | null = null;
    if (decision === "full_refund") {
      if (totalPrice > VD_TIER_1_MAX_REFUND_SEK) {
        return json(CORS, 422, {
          error: "amount_exceeds_vd_tier_1",
          details: {
            booking_total: totalPrice,
            max_vd_refund: VD_TIER_1_MAX_REFUND_SEK,
            note: "Bokningar över 500 kr kräver admin-beslut (escalate via admin-disputes.html).",
          },
        });
      }
      refundAmountSek = totalPrice;
    } else if (decision === "partial_refund") {
      // DEFERRED — partial-refund-flow saknas i state-machine
      return json(CORS, 422, {
        error: "partial_refund_not_implemented",
        details: "Partial-refund är DEFERRED till §8.22-25. Använd full_refund eller dismissed.",
      });
    }
    // dismissed: ingen amount, alltid OK för VD

    // ── 10% random admin-sampling ──
    const requiresAudit = Math.random() < ADMIN_AUDIT_SAMPLING_RATE;

    // ── Forwarda till dispute-admin-decide ──
    const adminDecideRes = await fetch(`${SUPABASE_URL}/functions/v1/dispute-admin-decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        // dispute-admin-decide kräver service-role auth direkt (rule #30
        // konservativt). vd-dispute-decide har redan validerat VD-roll
        // ovan, så vi kan använda service-role för forward-call.
      },
      body: JSON.stringify({
        dispute_id: dispute.id,
        decision,
        refund_amount_sek: refundAmountSek,
        admin_id: vdId, // VD som triggered_by_id (audit-trail)
        admin_notes: [
          `[VD-tier-1 beslut av ${vdRow.full_name || userEmail}]`,
          requiresAudit ? "[10% AUDIT-FLAGGAD]" : "",
          vdNotes ? `Notis: ${vdNotes}` : "",
        ].filter(Boolean).join("\n"),
      }),
    });

    const adminDecideJson = await adminDecideRes.json().catch(() => ({}));

    if (!adminDecideRes.ok) {
      log("error", "dispute-admin-decide forward failed", {
        vd_id: vdId, dispute_id: dispute.id, status: adminDecideRes.status,
      });
      return json(CORS, 500, {
        error: "decide_forward_failed",
        details: (adminDecideJson as { error?: string }).error || "internal_error",
      });
    }

    // ── Audit-alert om sampled ──
    if (requiresAudit) {
      try {
        await sendAdminAlert({
          severity: "warn",
          title: "VD tier-1 dispute-beslut FLAGGAT för audit (10% sampling)",
          source: "vd-dispute-decide",
          booking_id: bookingId,
          cleaner_id: bookedCleaner.id,
          company_id: vdCompanyId,
          metadata: {
            dispute_id: dispute.id,
            vd_id: vdId,
            vd_email: userEmail,
            vd_name: vdRow.full_name,
            decision,
            refund_amount_sek: refundAmountSek,
            booking_total: totalPrice,
            booked_cleaner_name: bookedCleaner.full_name,
            admin_decide_response: adminDecideJson,
          },
        });
      } catch (e) {
        log("warn", "Audit-alert failed", { error: (e as Error).message });
      }
    }

    log("info", "VD dispute decided", {
      vd_id: vdId, dispute_id: dispute.id, decision,
      refund_amount_sek: refundAmountSek, audit_flagged: requiresAudit,
    });

    return json(CORS, 200, {
      ok: true,
      dispute_id: dispute.id,
      decision,
      refund_amount_sek: refundAmountSek,
      audit_flagged: requiresAudit,
      forwarded_to: "dispute-admin-decide",
      forward_response: adminDecideJson,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

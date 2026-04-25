// ═══════════════════════════════════════════════════════════════
// SPICK – refund-booking (Fas 8 §8.11)
// ═══════════════════════════════════════════════════════════════
//
// Genomför Stripe-refund från plattformskonto till kund efter att
// dispute-admin-decide markerat dispute som resolved_full_refund.
// Transitionerar escrow_state till 'refunded'.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §1.2 + §2.4
//              + escrow-state.ts TRANSITIONS (transfer_full_refund:
//                resolved_full_refund → refunded)
//
// SCOPE (minimal — Alt A från sessionsplan 2026-04-25):
//   - Bara full_refund-flödet (escrow_state='resolved_full_refund' →
//     'refunded'). Partial-refund (resolved_partial_refund) är DEFERRED
//     till §8.22-25 sprint pga avsaknad av transfer_partial_refund-
//     transition i state-machine.
//   - Anropas manuellt från admin (eller framtida auto-call från
//     dispute-admin-decide retrofit).
//
// FLÖDE:
//   1. X-Internal-Secret-auth (samma som escrow-state-transition/release)
//   2. Validate input (booking_id)
//   3. Fetch booking + verify escrow_state='resolved_full_refund'
//   4. Validate booking.payment_intent_id finns (för Stripe-refund)
//   5. POST Stripe /v1/refunds med idempotency-key per booking
//   6. Update bookings: payment_status='refunded', refund_amount=total_price
//   7. Anropa escrow-state-transition('transfer_full_refund') → 'refunded'
//   8. logBookingEvent('refunded'/dispute_resolved)
//   9. sendAdminAlert (info)
//
// IDEMPOTENS:
//   - Stripe Idempotency-Key: refund-booking-{booking_id}-full
//   - escrow_state är guardrail: bara från resolved_full_refund
//   - Dubbel-call → 422 (state ≠ resolved_full_refund efter första)
//
// OUT-OF-SCOPE (DEFERRED):
//   - Partial-refund-flow (kräver ny TRANSITION transfer_partial_refund
//     + ny state 'released_partial' eller motsvarande)
//   - Klarna chargeback (§8.22)
//   - Auto-refund från dispute-admin-decide (§8.11.b retrofit-commit)
//
// REGLER: #26 grep stripe-refund + escrow-release patterns,
// #27 scope (bara full_refund-EF, ingen retrofit), #28 SSOT —
// escrow-state-transition för state, money.ts för amount-läsning,
// #29 dispute-escrow-system.md §2.4 + escrow-state.ts läst i sin helhet,
// #30 Stripe API exakt per existing escrow-release-pattern, ingen spec-
// gissning, #31 prod-state verifierat (escrow_v2 LIVE, alla beroende
// EFs deployade, payment_intent_id-kolumn finns på bookings).
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { verifyInternalSecret } from "../_shared/auth.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const log = createLogger("refund-booking");

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

// Rule #28 — duplicerar escrow-release.resolveStripeKey-pattern lokalt.
// Kan extraheras till _shared/stripe-mode.ts i framtida refactor (separat
// commit för att respektera scope #27).
async function resolveStripeKey(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "stripe_test_mode")
    .maybeSingle();
  const isTestMode = data?.value === "true";
  const key = isTestMode
    ? Deno.env.get("STRIPE_SECRET_KEY_TEST")
    : Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) {
    throw new Error(`Stripe key missing (test_mode=${isTestMode})`);
  }
  return key;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: shared-secret (internal EF-to-EF + admin-wrapper) ──
    if (!verifyInternalSecret(req)) {
      return json(CORS, 403, { error: "internal_secret_required" });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }

    const { booking_id, admin_id, reason, partial_amount_sek } = body as {
      booking_id?: unknown;
      admin_id?: unknown;
      reason?: unknown;
      partial_amount_sek?: unknown;  // §8.22 (2026-04-25): om satt → partial-flow
    };

    if (!isValidUuid(booking_id)) {
      return json(CORS, 400, { error: "invalid_booking_id" });
    }
    if (admin_id !== undefined && admin_id !== null && !isValidUuid(admin_id)) {
      return json(CORS, 400, { error: "invalid_admin_id" });
    }

    const bookingIdStr = booking_id as string;
    const adminIdStr = (admin_id as string | undefined) ?? null;
    const isPartial = partial_amount_sek !== undefined && partial_amount_sek !== null;
    const partialAmountSek = isPartial ? Number(partial_amount_sek) : null;
    if (isPartial && (!Number.isFinite(partialAmountSek) || partialAmountSek! <= 0)) {
      return json(CORS, 400, {
        error: "invalid_partial_amount_sek",
        details: { received: partial_amount_sek, note: "Måste vara positivt tal." },
      });
    }
    const reasonStr = typeof reason === "string"
      ? reason.slice(0, 500)
      : (isPartial ? "dispute_partial_refund" : "dispute_full_refund");

    // ── Fetch booking ──
    const { data: booking, error: fetchErr } = await sb
      .from("bookings")
      .select(
        "id, escrow_state, payment_intent_id, payment_status, total_price, customer_email, customer_name, cleaner_id, cleaner_name",
      )
      .eq("id", bookingIdStr)
      .maybeSingle();

    if (fetchErr) {
      log("error", "Booking fetch failed", { booking_id: bookingIdStr, error: fetchErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }

    // ── State-validering ──
    // §8.22 (2026-04-25): partial-flow accepterar resolved_partial_refund.
    // full-flow accepterar resolved_full_refund (oförändrat).
    const fromState = booking.escrow_state as string;
    const expectedState = isPartial ? "resolved_partial_refund" : "resolved_full_refund";
    if (fromState !== expectedState) {
      return json(CORS, 422, {
        error: "invalid_escrow_state",
        details: {
          current: fromState,
          expected: expectedState,
          mode: isPartial ? "partial" : "full",
        },
      });
    }

    // ── Stripe payment-intent finns? ──
    const paymentIntentId = booking.payment_intent_id as string | null;
    if (!paymentIntentId) {
      log("error", "No payment_intent_id on booking", { booking_id: bookingIdStr });
      await sendAdminAlert({
        severity: "critical",
        title: `Refund-booking blockerad: ingen Stripe-referens`,
        source: "refund-booking",
        booking_id: bookingIdStr,
        message: "Booking saknar payment_intent_id. Manuell admin-action krävs (Studio Stripe Dashboard).",
        metadata: { customer_email: booking.customer_email, total_price: booking.total_price },
      });
      return json(CORS, 422, { error: "no_payment_intent" });
    }

    const totalPrice = Number(booking.total_price) || 0;
    if (totalPrice <= 0) {
      return json(CORS, 422, { error: "invalid_total_price", details: { total_price: totalPrice } });
    }

    // §8.22 partial-validering: amount måste vara < total_price (annars använd full-flow)
    if (isPartial && partialAmountSek! >= totalPrice) {
      return json(CORS, 422, {
        error: "partial_amount_too_high",
        details: {
          partial_amount_sek: partialAmountSek,
          total_price: totalPrice,
          note: "Använd full_refund-flowen för hela beloppet.",
        },
      });
    }

    const refundAmountSek = isPartial ? partialAmountSek! : totalPrice;

    // ── Stripe refund ──
    // Idempotency-Key inkluderar belopp → distinkt nyckel per refund-mode/-belopp.
    const stripeKey = await resolveStripeKey(sb);
    const idempotencyKey = isPartial
      ? `refund-booking-${bookingIdStr}-partial-${refundAmountSek}`
      : `refund-booking-${bookingIdStr}-full`;

    const refundParams = new URLSearchParams();
    refundParams.append("payment_intent", paymentIntentId);
    refundParams.append("reason", "requested_by_customer");
    refundParams.append("metadata[booking_id]", bookingIdStr);
    refundParams.append("metadata[refund_type]", isPartial ? "dispute_partial" : "dispute_full");
    refundParams.append("metadata[reason_internal]", reasonStr);
    if (isPartial) {
      // Stripe API tar amount i öre (SEK lägsta enhet = öre, multiplicera med 100)
      refundParams.append("amount", String(Math.round(refundAmountSek * 100)));
    }

    const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2023-10-16",
        "Idempotency-Key": idempotencyKey,
      },
      body: refundParams.toString(),
    });

    const refundJson = await refundRes.json();
    if (!refundRes.ok) {
      log("error", "Stripe refund failed", {
        booking_id: bookingIdStr,
        status: refundRes.status,
        error: refundJson?.error?.message,
      });
      await sendAdminAlert({
        severity: "critical",
        title: "Stripe-refund failed",
        source: "refund-booking",
        booking_id: bookingIdStr,
        message: refundJson?.error?.message || "Stripe API error",
        metadata: { stripe_status: refundRes.status, payment_intent_id: paymentIntentId },
      });
      return json(CORS, 502, {
        error: "stripe_refund_failed",
        details: refundJson?.error?.message || "Stripe API error",
      });
    }

    const stripeRefundId = refundJson.id as string;
    log("info", "Stripe refund created", {
      booking_id: bookingIdStr,
      stripe_refund_id: stripeRefundId,
      amount_sek: totalPrice,
    });

    // ── UPDATE bookings (refund-metadata) ──
    // Skild från escrow_state-update — den går via state-transition-EF.
    // §8.22: vid partial används partial_amount, vid full används totalPrice.
    const { error: updateErr } = await sb
      .from("bookings")
      .update({
        payment_status: isPartial ? "partially_refunded" : "refunded",
        refund_amount: refundAmountSek,
      })
      .eq("id", bookingIdStr);

    if (updateErr) {
      log("warn", "Booking refund-metadata UPDATE failed (refund done, state-drift möjlig)", {
        booking_id: bookingIdStr,
        error: updateErr.message,
      });
      // Fortsätter — Stripe-refund är gjord, kvarvarande state-drift kan
      // reconcileras manuellt.
    }

    // ── Transition escrow_state ──
    // full:    resolved_full_refund → refunded
    // partial: resolved_partial_refund → released_partial (§8.22)
    const transitionAction = isPartial ? "transfer_partial_refund" : "transfer_full_refund";
    const expectedNewState = isPartial ? "released_partial" : "refunded";
    const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
      },
      body: JSON.stringify({
        booking_id: bookingIdStr,
        action: transitionAction,
        triggered_by: adminIdStr ? "admin" : "system_webhook",
        triggered_by_id: adminIdStr,
        metadata: {
          stripe_refund_id: stripeRefundId,
          refund_amount_sek: refundAmountSek,
          reason: reasonStr,
          mode: isPartial ? "partial" : "full",
          ...(isPartial && {
            cleaner_share_remaining_sek: totalPrice - refundAmountSek,
            transfer_to_cleaner_pending: true,
          }),
        },
      }),
    });

    if (!transRes.ok) {
      // Kritisk: Stripe-refund är gjord, men escrow_state ej updaterad.
      // State-drift. Logga + alert. INGEN auto-rollback (Stripe-refund
      // kan inte trivialt reverseras).
      const transErr = await transRes.json().catch(() => ({}));
      log("error", "escrow-state-transition failed AFTER Stripe-refund (manual reconciliation required)", {
        booking_id: bookingIdStr,
        stripe_refund_id: stripeRefundId,
        status: transRes.status,
        error: transErr.error,
      });
      await sendAdminAlert({
        severity: "critical",
        title: "Refund state-drift: Stripe-refund klar men escrow_state ej updaterad",
        source: "refund-booking",
        booking_id: bookingIdStr,
        message: "Manuell SQL-reconciliation krävs: UPDATE bookings SET escrow_state='refunded' + INSERT escrow_events.",
        metadata: {
          stripe_refund_id: stripeRefundId,
          transition_error: transErr.error,
        },
      });
      // Returnera 200 så caller vet att refund hände — men flagga state-drift.
      return json(CORS, 200, {
        ok: true,
        warning: "state_drift",
        booking_id: bookingIdStr,
        stripe_refund_id: stripeRefundId,
        refund_amount_sek: totalPrice,
        new_escrow_state: "resolved_full_refund_DRIFT", // ej riktigt — flagg
      });
    }

    // ── Audit-log + admin-alert (best-effort) ──
    // Canonical event-type "refund_issued" per _shared/events.ts BookingEventType.
    await logBookingEvent(sb, bookingIdStr, "refund_issued", {
      actorType: adminIdStr ? "admin" : "system",
      metadata: {
        stripe_refund_id: stripeRefundId,
        refund_amount_sek: refundAmountSek,
        reason: reasonStr,
        triggered_by_admin: adminIdStr,
        mode: isPartial ? "partial" : "full",
        ...(isPartial && { cleaner_share_remaining_sek: totalPrice - refundAmountSek }),
      },
    });

    try {
      const alertTitle = isPartial
        ? `Partial refund: ${refundAmountSek} kr (kvar ${totalPrice - refundAmountSek} kr till cleaner — MANUELL transfer krävs §8.23)`
        : `Refund genomförd: ${refundAmountSek} kr`;
      await sendAdminAlert({
        severity: isPartial ? "warn" : "info",
        title: alertTitle,
        source: "refund-booking",
        booking_id: bookingIdStr,
        message: isPartial
          ? "PARTIAL refund klar mot kund. Transfer av återstående belopp till cleaner via Stripe Connect är §8.23 (DEFERRED) — gör manuellt i Stripe Dashboard tills auto-flow byggs."
          : undefined,
        metadata: {
          customer_email: booking.customer_email,
          customer_name: booking.customer_name,
          cleaner_id: booking.cleaner_id,
          stripe_refund_id: stripeRefundId,
          refund_amount_sek: refundAmountSek,
          total_price: totalPrice,
          mode: isPartial ? "partial" : "full",
          reason: reasonStr,
        },
      });
    } catch (e) {
      log("warn", "Admin alert failed", { error: (e as Error).message });
    }

    log("info", "Refund-booking complete", {
      booking_id: bookingIdStr,
      stripe_refund_id: stripeRefundId,
      amount_sek: refundAmountSek,
      mode: isPartial ? "partial" : "full",
    });

    return json(CORS, 200, {
      ok: true,
      booking_id: bookingIdStr,
      stripe_refund_id: stripeRefundId,
      refund_amount_sek: refundAmountSek,
      new_escrow_state: expectedNewState,
      mode: isPartial ? "partial" : "full",
      ...(isPartial && {
        cleaner_share_remaining_sek: totalPrice - refundAmountSek,
        cleaner_transfer_status: "pending_manual_§8.23",
      }),
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

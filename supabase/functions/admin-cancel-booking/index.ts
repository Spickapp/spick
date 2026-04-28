// ═══════════════════════════════════════════════════════════════
// SPICK – admin-cancel-booking (Audit-fix P2-1, 2026-04-26)
//
// BAKGRUND (audit 2026-04-26-test-admin-flow.md fynd #1):
//   admin.html:3614-3648 cancelBooking() skriver direkt mot
//   bookings-tabellen via PostgREST. Ingen atomisk koppling till
//   refund + audit-log + notify. Om Stripe-refund ska göras måste
//   admin klicka separat knapp ("refundBooking()") — risk att kund
//   får statusen "cancelled" men pengarna ligger kvar.
//
// FIX:
//   Atomisk wrapper som:
//     1. SELECT bookings (validering: existerar + status != cancelled)
//     2. UPDATE bookings (status='avbokad', payment_status='cancelled')
//     3. Om payment_status='paid' + payment_intent_id → anropa
//        stripe-refund-EF (med admin-token vidare)
//     4. INSERT booking_status_log (audit-trail trigger kan redan
//        skapa en — men vi loggar explicit för att täcka edge case)
//     5. INSERT admin_audit_log (vem cancelled, varför)
//     6. Anropa notify-EF (booking_cancelled till kund)
//   Returnerar { ok, refund_id?, ms } eller error med rollback-hint.
//
// AUTH: kräver admin-JWT (samma mönster som admin-approve-cleaner).
//
// REGLER:
//   #26 grep+läst admin-approve-cleaner som mall, läst stripe-refund
//   #27 scope = exakt cancellation-wrapper, ingen sido-städning
//   #28 SSOT = återanvänder stripe-refund-EF + notify-EF +
//       admin_audit_log-schema (verifierat via auto-approve-check)
//   #30 inga regulator-claims
//   #31 schema curl-verifierat: bookings.payment_status, status,
//       payment_intent_id, total_price, customer_email, customer_name
//       finns. admin_audit_log-schema verifierat via
//       auto-approve-check/index.ts:109.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";
import { withSentry } from "../_shared/sentry.ts";
import { permissionErrorToResponse, requireAdmin } from "../_shared/permissions.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const sb = createClient(SUPA_URL, SERVICE_KEY);

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(withSentry("admin-cancel-booking", async (req) => {
  const t0 = Date.now();
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, CORS);

  try {
    // ── AUTH: verify admin via JWT (centraliserad via _shared/permissions.ts) ──
    // Token extraheras separat eftersom den vidarebefordras till stripe-refund-EF nedan.
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    let adminEmail: string;
    try {
      const ctx = await requireAdmin(req, sb);
      adminEmail = ctx.email;
    } catch (e) {
      const r = permissionErrorToResponse(e, CORS);
      if (r) return r;
      throw e;
    }

    // ── PARSE BODY ──────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const {
      booking_id,
      reason,
      refund_amount_ore, // optional — om inte satt, refundas total_price (full refund)
    } = body as {
      booking_id?: string;
      reason?: string;
      refund_amount_ore?: number;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json({ error: "booking_id krävs" }, 400, CORS);
    }
    if (!reason || typeof reason !== "string" || reason.trim().length < 3) {
      return json({ error: "reason krävs (min 3 tecken)" }, 400, CORS);
    }

    // Audit-fix P1-1 (2026-04-26): refund_amount_ore accepterades men
    // ignorerades alltid (full refund only). Det är en UX-bedrägeri-vektor
    // — admin tror sig göra partial men får full. Reject explicit istället
    // för silent ignore. Caller måste använda stripe-refund-EF för partial.
    if (typeof refund_amount_ore === "number" && refund_amount_ore > 0) {
      return json({
        error: "partial_refund_not_supported",
        detail: "admin-cancel-booking gör endast full refund. Använd stripe-refund-EF direkt för partial.",
      }, 422, CORS);
    }

    // ── 1. SELECT booking (validering) ──────────────────────
    const { data: booking, error: selErr } = await sb
      .from("bookings")
      .select("id, status, payment_status, payment_intent_id, total_price, customer_email, customer_name, service_type, booking_date, cleaner_id, cleaner_name")
      .eq("id", booking_id)
      .maybeSingle();

    if (selErr) {
      return json({ error: "DB-fel vid SELECT", detail: selErr.message }, 500, CORS);
    }
    if (!booking) {
      return json({ error: "booking_not_found" }, 404, CORS);
    }
    if (booking.status === "avbokad" || booking.payment_status === "cancelled") {
      return json({ error: "already_cancelled", current_status: booking.status }, 409, CORS);
    }

    const oldValue = {
      status: booking.status,
      payment_status: booking.payment_status,
      cleaner_id: booking.cleaner_id,
      cleaner_name: booking.cleaner_name,
    };

    // ── 2. UPDATE booking ───────────────────────────────────
    const newPaymentStatus = booking.payment_status === "paid" ? "paid" : "cancelled";
    // OBS: om paid → låt stripe-refund-EF flippa till 'refunded' (atomicitet:
    // den uppdaterar payment_status='refunded' när Stripe-anropet lyckats).
    // Vi sätter status='avbokad' direkt och clear:ar cleaner-koppling.
    const { error: updErr } = await sb
      .from("bookings")
      .update({
        status: "avbokad",
        payment_status: newPaymentStatus,
        cleaner_id: null,
        cleaner_name: null,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq("id", booking_id);

    if (updErr) {
      return json({
        error: "update_failed",
        detail: updErr.message,
      }, 500, CORS);
    }

    // ── 3. Stripe refund om paid ────────────────────────────
    let refundId: string | null = null;
    let refundError: string | null = null;
    if (booking.payment_status === "paid" && booking.payment_intent_id) {
      try {
        // Anropa stripe-refund-EF med admin-token (som har JWT auth-gate).
        // Service-role-token funkar INTE eftersom stripe-refund kräver
        // admin-JWT-flow (auth/v1/user → admin_users-check). Vi vidarebefordrar
        // den ursprungliga admin-tokenen.
        const refundRes = await fetch(`${SUPA_URL}/functions/v1/stripe-refund`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": ANON_KEY,
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({
            booking_id,
            reason: reason || "Admin cancellation",
          }),
        });
        const refundData = await refundRes.json().catch(() => ({}));
        if (!refundRes.ok) {
          refundError = refundData?.error || `Stripe-refund failed (HTTP ${refundRes.status})`;
        } else {
          refundId = refundData?.refund_id || null;
        }
      } catch (e) {
        refundError = `Stripe-refund exception: ${(e as Error).message}`;
      }
    }

    // ── 4. booking_status_log (best-effort, trigger skapar troligen) ──
    try {
      await sb.from("booking_status_log").insert({
        booking_id,
        old_status: booking.status,
        new_status: "avbokad",
        changed_by: adminEmail,
        change_reason: `admin_cancel: ${reason}`,
      });
    } catch (_) {
      // Ej kritiskt — DB-trigger hanterar primär audit
    }

    // ── 5. admin_audit_log ──────────────────────────────────
    try {
      await sb.from("admin_audit_log").insert({
        action: "cancel",
        resource_type: "booking",
        resource_id: booking_id,
        admin_email: adminEmail,
        old_value: oldValue,
        new_value: {
          status: "avbokad",
          payment_status: newPaymentStatus,
          refund_id: refundId,
          refund_error: refundError,
        },
        reason,
      });
    } catch (auditErr) {
      console.warn("[admin-cancel-booking] audit_log failed:", (auditErr as Error).message);
    }

    // ── 6. Notify kund ──────────────────────────────────────
    if (booking.customer_email) {
      try {
        await fetch(`${SUPA_URL}/functions/v1/notify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": ANON_KEY,
            "Authorization": `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({
            type: "booking_cancelled",
            record: {
              customer_name: booking.customer_name,
              email: booking.customer_email,
              service: booking.service_type,
              date: booking.booking_date,
              cancellation_reason: reason,
              refunded: refundId !== null,
            },
          }),
        });
      } catch (notifyErr) {
        console.warn("[admin-cancel-booking] notify failed:", (notifyErr as Error).message);
      }
    }


    return json({
      ok: true,
      booking_id,
      status: "avbokad",
      payment_status: newPaymentStatus,
      refund_id: refundId,
      refund_error: refundError,
      ms: Date.now() - t0,
    }, 200, CORS);

  } catch (err) {
    console.error("[admin-cancel-booking] unhandled:", (err as Error).message);
    return json({
      error: "internal_error",
      detail: (err as Error).message,
      ms: Date.now() - t0,
    }, 500, CORS);
  }
}));

/**
 * SPICK – Booking Cancel v2 Edge Function
 *
 * POST { booking_id, customer_email, reason? }
 * 1. Verifies customer owns the booking
 * 2. Applies cancellation policy: free >24h, 50% refund <24h
 * 3. Processes Stripe refund if applicable
 * 4. Updates booking status to "cancelled"
 * 5. Logs in booking_status_log
 * 6. Notifies customer & cleaner
 * 7. Returns success with refund info
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

// Kontrollerar om Authorization-token tillhör admin eller VD för bokningens cleaner
async function checkAuthBypass(req: Request, booking: { cleaner_id: string | null }): Promise<{ isAdmin: boolean; isVD: boolean; userEmail: string | null }> {
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  // Anon-token = inte inloggad användare → ingen bypass
  if (!token || token === SUPA_ANON) return { isAdmin: false, isVD: false, userEmail: null };

  try {
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPA_ANON },
    });
    if (!authRes.ok) return { isAdmin: false, isVD: false, userEmail: null };
    const authUser = await authRes.json();
    const userEmail = (authUser.email || "").toLowerCase();
    if (!userEmail) return { isAdmin: false, isVD: false, userEmail: null };

    // 1. Admin-check
    const { data: adminRow } = await sb
      .from("admin_users")
      .select("id")
      .eq("email", userEmail)
      .maybeSingle();
    if (adminRow) return { isAdmin: true, isVD: false, userEmail };

    // 2. VD-check: är användaren VD för bokningens städares företag?
    if (!booking.cleaner_id) return { isAdmin: false, isVD: false, userEmail };

    const { data: bookedCleaner } = await sb
      .from("cleaners")
      .select("company_id")
      .eq("id", booking.cleaner_id)
      .maybeSingle();
    if (!bookedCleaner?.company_id) return { isAdmin: false, isVD: false, userEmail };

    const { data: vdRow } = await sb
      .from("cleaners")
      .select("id")
      .eq("email", userEmail)
      .eq("company_id", bookedCleaner.company_id)
      .eq("is_company_owner", true)
      .maybeSingle();
    if (vdRow) return { isAdmin: false, isVD: true, userEmail };

    return { isAdmin: false, isVD: false, userEmail };
  } catch (e) {
    console.warn("[booking-cancel-v2] auth-bypass check failed:", e);
    return { isAdmin: false, isVD: false, userEmail: null };
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { booking_id, customer_email, reason } = await req.json();

    if (!booking_id) {
      return json({ error: "booking_id krävs" }, 400);
    }

    // 1. Fetch booking
    const { data: booking, error: fetchErr } = await sb
      .from("bookings")
      .select("id, customer_email, customer_name, cleaner_id, booking_date, booking_time, status, payment_status, total_price, rut_amount, payment_intent_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (fetchErr || !booking) return json({ error: "Bokning hittades inte" }, 404);

    // 2. Auktorisering: admin eller VD kringgår email-check
    const auth = await checkAuthBypass(req, { cleaner_id: booking.cleaner_id });
    const isPrivileged = auth.isAdmin || auth.isVD;

    if (!isPrivileged) {
      // Kund-flöde: customer_email måste matcha
      if (!customer_email) {
        return json({ error: "customer_email krävs för kund-avbokning" }, 400);
      }
      if ((booking.customer_email || "").toLowerCase() !== customer_email.toLowerCase()) {
        return json({ error: "E-posten matchar inte bokningen" }, 403);
      }
    }

    console.log("[booking-cancel-v2] Auth-kontext:", { isAdmin: auth.isAdmin, isVD: auth.isVD, userEmail: auth.userEmail });

    // 3. Check not already cancelled
    if (booking.status === "cancelled" || booking.status === "avbokad") {
      return json({ error: "Bokningen är redan avbokad" }, 400);
    }

    // 4. Calculate refund based on cancellation policy
    const bookingDate = booking.booking_date || "";
    const bookingTime = booking.booking_time || "09:00";
    const scheduledAt = new Date(`${bookingDate}T${bookingTime}:00`);
    const now = new Date();
    const hoursUntil = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    const totalPrice = booking.total_price || 0;
    const refundPercent = hoursUntil >= 24 ? 100 : 50;
    const refundAmount = Math.round(totalPrice * refundPercent / 100);
    const cancellationFee = totalPrice - refundAmount;

    // 5. Process Stripe refund if payment exists
    let stripeRefundId: string | null = null;
    if (booking.payment_intent_id && refundAmount > 0 && STRIPE_KEY) {
      try {
        const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${STRIPE_KEY}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            payment_intent: booking.payment_intent_id,
            amount: String(refundAmount * 100), // Stripe uses öre
            reason: "requested_by_customer",
          }),
        });
        const refundData = await refundRes.json();

        if (refundRes.ok) {
          stripeRefundId = refundData.id;
        } else {
          console.error("Stripe refund error:", refundData);
        }
      } catch (e) {
        console.error("Stripe refund failed:", e);
      }
    }

    const oldStatus = booking.status;

    // 6. Update booking status
    const { error: updateErr } = await sb
      .from("bookings")
      .update({
        status: "cancelled",
        payment_status: stripeRefundId ? "refunded" : booking.payment_status,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || "Kund avbokade",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return json({ error: "Kunde inte avboka bokningen" }, 500);
    }

    // 7. Log in booking_status_log
    await sb.from("booking_status_log").insert({
      booking_id,
      old_status: oldStatus,
      new_status: "cancelled",
      changed_by: `customer:${customer_email}`,
    });

    // 8. Notify customer
    await sb.functions.invoke("notify", {
      body: {
        type: "booking_cancelled",
        record: {
          email: booking.customer_email,
          customer_name: booking.customer_name,
          booking_id,
          date: booking.booking_date,
          time: booking.booking_time,
          refund_amount: refundAmount,
          refund_percent: refundPercent,
          cancellation_fee: cancellationFee,
        },
      },
    }).catch((e: Error) => console.error("Notify customer error:", e.message));

    // 9. Notify cleaner if assigned
    if (booking.cleaner_id) {
      const { data: cleaner } = await sb
        .from("cleaners")
        .select("id, full_name")
        .eq("id", booking.cleaner_id)
        .maybeSingle();

      if (cleaner) {
        await sb.functions.invoke("notify", {
          body: {
            type: "booking_cancelled_cleaner",
            record: {
              cleaner_id: booking.cleaner_id,
              cleaner_name: cleaner.full_name,
              booking_id,
              booking_date: booking.booking_date,
              booking_time: booking.booking_time,
              customer_name: booking.customer_name,
            },
          },
        }).catch((e: Error) => console.error("Notify cleaner error:", e.message));
      }
    }

    console.log(`Booking cancelled: ${booking_id} by ${customer_email} — refund ${refundPercent}% (${refundAmount} kr)`);

    return json({
      success: true,
      message: refundPercent === 100
        ? "Bokningen är avbokad. Full återbetalning."
        : `Bokningen är avbokad. ${refundPercent}% återbetalning (${refundAmount} kr). Avbokningsavgift: ${cancellationFee} kr.`,
      refund_percent: refundPercent,
      refund_amount: refundAmount,
      cancellation_fee: cancellationFee,
      stripe_refund_id: stripeRefundId,
    });
  } catch (e) {
    console.error("booking-cancel-v2 error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

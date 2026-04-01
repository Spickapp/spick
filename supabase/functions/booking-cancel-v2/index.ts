import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { booking_id, customer_email, reason } = await req.json();

    if (!booking_id || !customer_email) {
      return new Response(
        JSON.stringify({ error: "booking_id och customer_email krävs" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch booking — verified DB columns (no 'email', 'name', 'date', 'time' columns)
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id, customer_email, customer_name, cleaner_id, cleaner_name, booking_date, booking_time, status, payment_status, total_price, rut_amount, payment_intent_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingErr || !booking) {
      return new Response(
        JSON.stringify({ error: "Bokning hittades inte" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Verify customer owns this booking
    if ((booking.customer_email || "").toLowerCase() !== customer_email.toLowerCase()) {
      return new Response(
        JSON.stringify({ error: "E-posten matchar inte bokningen" }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Check if already cancelled
    if (booking.status === "cancelled" || booking.status === "avbokad" || booking.payment_status === "cancelled") {
      return new Response(
        JSON.stringify({ error: "Bokningen är redan avbokad" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Calculate refund based on time until booking
    const bookingDate = booking.booking_date || "";
    const bookingTime = booking.booking_time || "09:00";
    const scheduledAt = new Date(`${bookingDate}T${bookingTime}:00`);
    const now = new Date();
    const hoursUntilBooking = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    const totalPrice = booking.total_price || 0;
    let refundPercent = 100; // >24h: full refund
    let cancellationFee = 0;

    if (hoursUntilBooking < 24) {
      refundPercent = 50; // <24h: 50% refund
      cancellationFee = Math.round(totalPrice * 0.5);
    }

    const refundAmount = Math.round(totalPrice * refundPercent / 100);

    // Process Stripe refund if payment exists
    const paymentIntent = booking.payment_intent_id;
    let stripeRefundId = null;
    if (paymentIntent && refundAmount > 0) {
      try {
        const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
        if (stripeKey) {
          const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${stripeKey}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              payment_intent: paymentIntent,
              amount: String(refundAmount * 100), // Stripe uses öre
            }),
          });
          const refundData = await refundRes.json();
          stripeRefundId = refundData.id || null;

          if (!refundRes.ok) {
            console.error("Stripe refund error:", refundData);
          }
        }
      } catch (e) {
        console.error("Stripe refund failed:", e);
      }
    }

    // Update booking status
    const { error: updateErr } = await sb
      .from("bookings")
      .update({
        status: "avbokad",
        payment_status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || "Kund avbokade",
        refund_amount: refundAmount,
        refund_percent: refundPercent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Kunde inte avboka" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Log event
    await sb.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "customer_cancel",
      actor_type: "customer",
      metadata: {
        reason: reason || "Ingen anledning",
        hours_before: hoursUntilBooking.toFixed(1),
        refund_percent: refundPercent,
        refund_amount: refundAmount,
        cancellation_fee: cancellationFee,
        stripe_refund_id: stripeRefundId,
      },
    }).catch((e: Error) => console.error("Event log error:", e.message));

    // Notify customer
    await sb.functions.invoke("notify", {
      body: {
        type: "booking_cancelled",
        record: {
          email: booking.customer_email,
          customer_name: booking.customer_name,
          booking_id: booking_id,
          date: booking.booking_date,
          time: booking.booking_time,
          refund_amount: refundAmount,
          refund_percent: refundPercent,
          cancellation_fee: cancellationFee,
        },
      },
    }).catch((e: Error) => console.error("Notify customer error:", e.message));

    // Notify cleaner if assigned (cleaners has no email column — use cleaner_name from booking)
    if (booking.cleaner_id) {
      const { data: cleaner } = await sb
        .from("cleaners")
        .select("id, full_name")
        .eq("id", booking.cleaner_id)
        .single();

      if (cleaner) {
        await sb.functions.invoke("notify", {
          body: {
            type: "booking_cancelled_cleaner",
            record: {
              cleaner_id: booking.cleaner_id,
              cleaner_name: cleaner.full_name,
              booking_id: booking_id,
              booking_date: booking.booking_date,
              booking_time: booking.booking_time,
              customer_name: booking.customer_name,
            },
          },
        }).catch((e: Error) => console.error("Notify cleaner error:", e.message));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: refundPercent === 100
          ? "Bokningen är avbokad. Full återbetalning."
          : `Bokningen är avbokad. ${refundPercent}% återbetalning (${refundAmount} kr). Avbokningsavgift: ${cancellationFee} kr.`,
        refund_percent: refundPercent,
        refund_amount: refundAmount,
        cancellation_fee: cancellationFee,
        stripe_refund_id: stripeRefundId,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS } }
    );
  } catch (e) {
    console.error("Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: "Serverfel" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }
});

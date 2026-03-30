import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tier-based opt-out windows (hours before booking start)
const OPTOUT_WINDOWS: Record<string, number> = {
  platinum: 0,
  gold: 1,
  silver: 2,
  bronze: 2,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { booking_id, cleaner_id, reason } = await req.json();

    if (!booking_id || !cleaner_id) {
      return new Response(
        JSON.stringify({ error: "booking_id och cleaner_id krävs" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch booking
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id, cleaner_id, scheduled_at, status, customer_email, customer_name")
      .eq("id", booking_id)
      .eq("cleaner_id", cleaner_id)
      .in("status", ["confirmed", "paid"])
      .maybeSingle();

    if (bookingErr || !booking) {
      return new Response(
        JSON.stringify({ error: "Bokning hittades inte eller redan avbokad" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Fetch cleaner tier
    const { data: cleaner } = await sb
      .from("cleaners")
      .select("id, full_name, tier, cancellation_count, cancellation_rate")
      .eq("id", cleaner_id)
      .single();

    if (!cleaner) {
      return new Response(
        JSON.stringify({ error: "Städare hittades inte" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Check opt-out window
    const tier = (cleaner.tier || "bronze").toLowerCase();
    const windowHours = OPTOUT_WINDOWS[tier] ?? 2;
    const scheduledAt = new Date(booking.scheduled_at);
    const now = new Date();
    const hoursUntilBooking = (scheduledAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntilBooking < windowHours) {
      return new Response(
        JSON.stringify({
          error: "Opt-out-fönstret har stängt",
          message: `Som ${tier}-städare kan du avboka senast ${windowHours}h innan bokningens start.`,
          hours_remaining: Math.max(0, hoursUntilBooking).toFixed(1),
          window_hours: windowHours,
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Release the booking (set cleaner_id to null, status back to paid/open)
    const { error: updateErr } = await sb
      .from("bookings")
      .update({
        cleaner_id: null,
        status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id);

    if (updateErr) {
      console.error("Update error:", updateErr);
      return new Response(
        JSON.stringify({ error: "Kunde inte frigöra bokningen" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Log the event
    await sb.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "cleaner_optout",
      actor_id: cleaner_id,
      actor_type: "cleaner",
      metadata: { reason: reason || "Ingen anledning angiven", tier, window_hours: windowHours },
    }).catch((e: Error) => console.error("Event log error:", e.message));

    // Update cleaner cancellation stats
    await sb
      .from("cleaners")
      .update({
        cancellation_count: (cleaner.cancellation_count || 0) + 1,
        last_cancellation_at: new Date().toISOString(),
      })
      .eq("id", cleaner_id)
      .catch((e: Error) => console.error("Stats update error:", e.message));

    // Notify customer via notify edge function
    await sb.functions.invoke("notify", {
      body: {
        type: "cleaner_optout",
        record: {
          email: booking.customer_email,
          customer_name: booking.customer_name,
          cleaner_name: cleaner.full_name,
          booking_id: booking_id,
          scheduled_at: booking.scheduled_at,
        },
      },
    }).catch((e: Error) => console.error("Notify error:", e.message));

    return new Response(
      JSON.stringify({
        success: true,
        message: "Bokningen har frigjorts. Kunden meddelas och bokningen läggs ut igen.",
        booking_id: booking_id,
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

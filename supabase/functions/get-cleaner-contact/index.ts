import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { cleaner_id, booking_id } = await req.json();

    if (!cleaner_id || !booking_id) {
      return new Response(
        JSON.stringify({ error: "cleaner_id och booking_id krävs" }),
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Use service_role to bypass RLS
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify that a confirmed or completed booking exists for this cleaner + customer
    const { data: booking, error: bookingErr } = await sb
      .from("bookings")
      .select("id, customer_email, status")
      .eq("id", booking_id)
      .eq("cleaner_id", cleaner_id)
      .in("status", ["confirmed", "completed"])
      .maybeSingle();

    if (bookingErr) {
      console.error("Booking lookup error:", bookingErr);
      return new Response(
        JSON.stringify({ error: "Kunde inte verifiera bokning" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    if (!booking) {
      return new Response(
        JSON.stringify({
          error: "Ingen bekräftad bokning hittades",
          message: "Du kan se städarens kontaktuppgifter efter att din bokning har bekräftats.",
          locked: true,
        }),
        { status: 403, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Booking verified – fetch cleaner contact info
    const { data: cleaner, error: cleanerErr } = await sb
      .from("cleaners")
      .select("id, name, phone, email")
      .eq("id", cleaner_id)
      .single();

    if (cleanerErr || !cleaner) {
      return new Response(
        JSON.stringify({ error: "Städare hittades inte" }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } }
      );
    }

    // Log the unlock for audit
    await sb.from("contact_unlock_log").insert({
      cleaner_id: cleaner_id,
      booking_id: booking_id,
      customer_email: booking.customer_email,
      unlocked_at: new Date().toISOString(),
    }).then(() => {}).catch((e: Error) => {
      console.error("Audit log error (non-fatal):", e.message);
    });

    return new Response(
      JSON.stringify({
        locked: false,
        name: cleaner.name,
        phone: cleaner.phone,
        email: cleaner.email,
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

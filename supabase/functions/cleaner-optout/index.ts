/**
 * SPICK – Cleaner Opt-out Edge Function
 *
 * POST { booking_id, cleaner_id }
 * 1. Verifies the cleaner is assigned to the booking
 * 2. Sets booking status to "pending_rematch"
 * 3. Logs the change in booking_status_log
 * 4. Returns success
 *
 * Also handles legacy GET ?token= notification opt-out (from stripe-webhook emails)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── Legacy GET: notification opt-out via token link ──────────────
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return new Response("Saknar token", { status: 400 });

    const { data: cleaner } = await sb
      .from("cleaners")
      .select("id, full_name")
      .eq("auth_user_id", token)
      .maybeSingle();

    if (!cleaner) return new Response("Städare hittades inte", { status: 404 });

    const { error } = await sb
      .from("cleaners")
      .update({ status: "inaktiv" })
      .eq("id", cleaner.id);

    if (error) return new Response("Fel: " + error.message, { status: 500 });

    console.log(`Cleaner notification opt-out: ${cleaner.full_name} (${cleaner.id})`);
    return new Response(
      `<html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2>Du har avregistrerats</h2>
        <p>Du får inga fler boknings-notiser från Spick.</p>
        <p style="margin-top:24px;color:#6B6960">Vill du komma tillbaka? Kontakta <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  // ── POST: booking opt-out ────────────────────────────────────────
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { booking_id, cleaner_id } = await req.json();

    if (!booking_id || !cleaner_id) {
      return json({ error: "booking_id och cleaner_id krävs" }, 400);
    }

    // 1. Verify the cleaner is assigned to this booking
    const { data: booking, error: fetchErr } = await sb
      .from("bookings")
      .select("id, status, cleaner_id")
      .eq("id", booking_id)
      .maybeSingle();

    if (fetchErr) return json({ error: fetchErr.message }, 500);
    if (!booking) return json({ error: "Bokning hittades inte" }, 404);
    if (booking.cleaner_id !== cleaner_id) {
      return json({ error: "Städaren är inte tilldelad denna bokning" }, 403);
    }

    const oldStatus = booking.status;

    // 2. Update booking status to pending_rematch and unassign cleaner
    const { error: updateErr } = await sb
      .from("bookings")
      .update({ status: "pending_rematch", cleaner_id: null })
      .eq("id", booking_id);

    if (updateErr) return json({ error: updateErr.message }, 500);

    // 3. Log in booking_status_log
    await sb.from("booking_status_log").insert({
      booking_id,
      old_status: oldStatus,
      new_status: "pending_rematch",
      changed_by: `cleaner:${cleaner_id}`,
    });

    console.log(`Cleaner opt-out: cleaner=${cleaner_id} booking=${booking_id} ${oldStatus}→pending_rematch`);

    return json({ success: true, booking_id, new_status: "pending_rematch" });
  } catch (e) {
    console.error("cleaner-optout error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

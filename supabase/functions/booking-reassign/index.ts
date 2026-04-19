/**
 * booking-reassign — Kund väljer ny städare efter avböjning
 *
 * Input: { booking_id, new_cleaner_id, customer_email }
 * Verifierar: bokning finns, status = awaiting_reassignment, email matchar
 * Uppdaterar: cleaner_id, cleaner_name, status → pending_confirmation
 * Skickar: mejl till ny städare + bekräftelse till kund + admin-notis
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { generateMagicShortUrl } from "../_shared/send-magic-sms.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { booking_id, new_cleaner_id, customer_email, action } = await req.json();

    // ── REFUND ACTION ──────────────────────────────────
    if (action === "refund") {
      if (!booking_id || !customer_email) {
        return json({ error: "booking_id och customer_email krävs" }, 400, CORS);
      }

      const { data: booking } = await sb.from("bookings").select("*").eq("id", booking_id).maybeSingle();
      if (!booking) return json({ error: "Bokning hittades inte" }, 404, CORS);
      if (booking.customer_email !== customer_email) return json({ error: "E-post matchar inte" }, 403, CORS);
      if (booking.status !== "awaiting_reassignment") return json({ error: "Bokning har redan hanterats" }, 409, CORS);

      // Process refund
      const paymentIntentId = booking.payment_intent_id || booking.stripe_payment_intent_id;
      let refundStatus = "skipped";
      if (paymentIntentId) {
        try {
          const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
          const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${STRIPE_KEY}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: `payment_intent=${paymentIntentId}`,
          });
          refundStatus = refundRes.ok ? "initiated" : "failed";
        } catch { refundStatus = "error"; }
      }

      await sb.from("bookings").update({
        status: "cancelled",
        payment_status: refundStatus === "initiated" ? "refunded" : booking.payment_status,
      }).eq("id", booking_id);

      // Email confirmation
      if (customer_email) {
        await sendEmail(customer_email, "Återbetalning bekräftad — Spick", wrap(`
          <h2>Återbetalning bekräftad</h2>
          <p>Hej ${esc(booking.customer_name || "")},</p>
          <p>Din återbetalning är på väg. Du ser pengarna på ditt konto inom 3–5 bankdagar.</p>
          <p>Vi hoppas kunna hjälpa dig nästa gång! <a href="https://spick.se/boka.html" style="color:#0F6E56;font-weight:600">Boka en ny städning →</a></p>
        `));
      }

      log("info", "booking-reassign", "Customer requested refund", { booking_id, refundStatus });
      return json({ success: true, message: "Återbetalning påbörjad.", refundStatus }, 200, CORS);
    }

    // ── REASSIGN ACTION ────────────────────────────────
    if (!booking_id || !new_cleaner_id || !customer_email) {
      return json({ error: "booking_id, new_cleaner_id och customer_email krävs" }, 400, CORS);
    }

    // Fetch booking
    const { data: booking, error: bErr } = await sb.from("bookings").select("*").eq("id", booking_id).maybeSingle();
    if (bErr || !booking) return json({ error: "Bokning hittades inte" }, 404, CORS);
    if (booking.customer_email !== customer_email) return json({ error: "E-post matchar inte" }, 403, CORS);
    if (booking.status !== "awaiting_reassignment") return json({ error: "Bokning har redan hanterats" }, 409, CORS);

    // Fetch new cleaner
    const { data: cleaner, error: cErr } = await sb.from("cleaners")
      .select("id, full_name, email, phone, avg_rating")
      .eq("id", new_cleaner_id)
      .eq("is_approved", true)
      .eq("status", "aktiv")
      .maybeSingle();

    if (cErr || !cleaner) return json({ error: "Städaren är inte tillgänglig" }, 404, CORS);

    // Update booking
    await sb.from("bookings").update({
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.full_name,
      cleaner_email: cleaner.email || null,
      cleaner_phone: cleaner.phone || null,
      status: "pending_confirmation",
      rejected_at: null,
      rejection_reason: null,
    }).eq("id", booking_id);

    const bookingDate = booking.booking_date || booking.scheduled_date || "";
    const bookingTime = booking.booking_time || "";
    const serviceType = booking.service_type || "Hemstädning";
    const bookingHours = booking.booking_hours || 3;

    // Notify new cleaner via SMS + email
    try {
      await fetch(`${SUPA_URL}/functions/v1/notify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: Deno.env.get("SUPABASE_ANON_KEY")!,
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
        },
        body: JSON.stringify({
          type: "new_booking_assignment",
          record: {
            booking_id,
            cleaner_name: cleaner.full_name,
            cleaner_email: cleaner.email,
            cleaner_phone: cleaner.phone,
            service_type: serviceType,
            booking_date: bookingDate,
            booking_time: bookingTime,
            booking_hours: bookingHours,
            customer_name: booking.customer_name,
            customer_address: booking.customer_address,
          },
        }),
      });
    } catch (e) { console.warn("Notify failed:", e); }

    // Email to customer — confirmation
    if (customer_email) {
      // Email magic-link (Fas 1.2) — single-use, 168h TTL
      const emailMagicLink = await generateMagicShortUrl({
        email: customer_email,
        redirect_to: `https://spick.se/min-bokning.html?bid=${booking_id}`,
        scope: "booking",
        resource_id: booking_id,
        ttl_hours: 168,
      });
      await sendEmail(customer_email, `Ny städare tilldelad — ${cleaner.full_name}`, wrap(`
        <h2>Ny städare tilldelad! 🧹</h2>
        <p>Hej ${esc(booking.customer_name || "")},</p>
        <p><strong>${esc(cleaner.full_name)}</strong> har tilldelats din städning. Städaren bekräftar inom 90 minuter.</p>
        ${card([
          ["Tjänst", `${esc(serviceType)}, ${bookingHours}h`],
          ["Datum", bookingDate],
          ["Tid", bookingTime],
          ["Ny städare", esc(cleaner.full_name)],
        ])}
        <p><a href="${emailMagicLink}" style="color:#0F6E56;font-weight:600">Se bokningsstatus →</a></p>
      `));
    }

    // Email to admin
    await sendEmail(ADMIN, `🔄 Bokning omtilldelad → ${cleaner.full_name}`, wrap(`
      <h2>Bokning omtilldelad</h2>
      <p>Kunden valde ny städare efter avböjning.</p>
      ${card([
        ["Bokning", booking_id.slice(0, 8)],
        ["Kund", esc(booking.customer_name || "")],
        ["Ny städare", esc(cleaner.full_name)],
        ["Status", "pending_confirmation"],
      ])}
    `));

    log("info", "booking-reassign", "Booking reassigned", { booking_id, new_cleaner_id: cleaner.id });
    return json({
      success: true,
      message: `${cleaner.full_name} har tilldelats! Bekräftelse inom 90 min.`,
      cleaner_name: cleaner.full_name,
    }, 200, CORS);

  } catch (err) {
    log("error", "booking-reassign", "Error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

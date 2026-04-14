// auto-rebook — Skapar nästa bokning för aktiva prenumerationer
// =============================================================
// Triggas dagligen via cron (eller manuellt via POST)
//
// Flöde per prenumeration:
//   1. Hitta aktiva subscriptions med next_booking_date = idag
//   2. Skapa bokning via booking-create Edge Function
//   3. Skicka betalningslänk till kund via e-post
//   4. Uppdatera next_booking_date till nästa förekomst
//   5. Öka total_bookings
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, log, sendEmail } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL     = Deno.env.get("BASE_URL") || "https://spick.se";

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // Bestäm datum att processa (default: idag)
    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || new Date().toISOString().split("T")[0];

    log("info", "auto-rebook", "Starting", { targetDate });

    // 1. Hämta aktiva prenumerationer med next_booking_date = targetDate
    const { data: subs, error: subErr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("status", "aktiv")
      .eq("next_booking_date", targetDate);

    if (subErr) {
      log("error", "auto-rebook", "Failed to fetch subscriptions", { error: subErr.message });
      return new Response(JSON.stringify({ error: subErr.message }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!subs || subs.length === 0) {
      log("info", "auto-rebook", "No subscriptions due today", { targetDate });
      return new Response(JSON.stringify({ processed: 0, date: targetDate }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const results: any[] = [];

    for (const sub of subs) {
      try {
        const result = await processSubscription(supabase, sub);
        results.push({ id: sub.id, customer: sub.customer_name, ...result });
      } catch (e: any) {
        log("error", "auto-rebook", `Failed for ${sub.id}`, { error: e.message });
        results.push({ id: sub.id, customer: sub.customer_name, error: e.message });
      }
    }

    log("info", "auto-rebook", "Complete", { processed: results.length });

    return new Response(JSON.stringify({ processed: results.length, date: targetDate, results }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    log("error", "auto-rebook", "Fatal error", { error: err.message });
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

async function processSubscription(supabase: any, sub: any) {
  // 1. Hitta nästa tillgänglig tid
  const bookingDate = sub.next_booking_date;
  const bookingTime = sub.preferred_time || "09:00";
  const hours = sub.hours || 3;

  // 2. Skapa bokning via booking-create Edge Function
  const bookingPayload = {
    name: sub.customer_name,
    email: sub.customer_email,
    phone: sub.customer_phone || null,
    address: sub.address,
    date: bookingDate,
    time: bookingTime,
    hours: hours,
    service: sub.service || "Hemstädning",
    cleaner_id: sub.preferred_cleaner_id || null,
    rut: sub.rut !== false,
    frequency: sub.frequency,
    customer_notes: sub.customer_notes || null,
    key_info: sub.key_info || null,
    recurring_from_subscription: sub.id,
  };

  const createRes = await fetch(`${SUPABASE_URL}/functions/v1/booking-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(bookingPayload),
  });

  const createResult = await createRes.json();

  if (!createRes.ok || !createResult.url) {
    throw new Error(createResult.error || "booking-create failed: " + JSON.stringify(createResult));
  }

  // 3. Skicka betalningslänk till kund
  const paymentUrl = createResult.url;
  const firstName = (sub.customer_name || "").split(" ")[0] || "Kund";
  const freqLabel = sub.frequency === "weekly" ? "veckovis" : "varannan vecka";
  const serviceLabel = sub.service || "hemstädning";

  try {
    await sendEmail(
      sub.customer_email,
      `Dags för din ${freqLabel}a ${serviceLabel.toLowerCase()} — Spick`,
      `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <div style="text-align:center;margin-bottom:24px">
            <span style="font-family:serif;font-size:1.8rem;font-weight:700;color:#0F6E56">Spick</span>
          </div>
          <p style="font-size:15px;line-height:1.6">Hej ${firstName}!</p>
          <p style="font-size:15px;line-height:1.6">
            Det &auml;r dags f&ouml;r din ${freqLabel}a ${serviceLabel.toLowerCase()}.
            ${sub.cleaner_name ? "Din st&auml;dare <strong>" + sub.cleaner_name + "</strong> &auml;r redo." : ""}
          </p>
          <div style="background:#F0FDF4;border-radius:12px;padding:16px;margin:20px 0;text-align:center">
            <div style="font-size:.85rem;color:#065F46;margin-bottom:4px">${bookingDate} kl ${bookingTime}</div>
            <div style="font-size:1.3rem;font-weight:700;color:#0F6E56">${serviceLabel} &middot; ${hours}h</div>
          </div>
          <p style="font-size:14px;line-height:1.6;color:#666">
            Klicka nedan f&ouml;r att bekr&auml;fta och betala. Samma adress och st&auml;dare som senast.
          </p>
          <div style="text-align:center;margin:24px 0">
            <a href="${paymentUrl}" style="display:inline-block;background:#0F6E56;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:600;font-size:15px">
              Bekr&auml;fta &amp; betala &rarr;
            </a>
          </div>
          <p style="font-size:13px;color:#999;text-align:center">
            Vill du pausa eller avsluta? <a href="${BASE_URL}/mitt-konto.html" style="color:#0F6E56">Hantera prenumeration</a>
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="font-size:11px;color:#bbb;text-align:center">Spick &middot; hello@spick.se &middot; spick.se</p>
        </div>
      `
    );
  } catch (emailErr: any) {
    log("warn", "auto-rebook", "Email failed (non-critical)", { sub_id: sub.id, error: emailErr.message });
  }

  // 4. Beräkna nästa booking_date
  const nextDate = new Date(bookingDate + "T12:00:00");
  if (sub.frequency === "weekly") {
    nextDate.setDate(nextDate.getDate() + 7);
  } else if (sub.frequency === "biweekly" || sub.frequency === "varannan-vecka") {
    nextDate.setDate(nextDate.getDate() + 14);
  } else {
    nextDate.setDate(nextDate.getDate() + 30); // monthly fallback
  }

  // 5. Uppdatera prenumerationen
  await supabase
    .from("subscriptions")
    .update({
      next_booking_date: nextDate.toISOString().split("T")[0],
      total_bookings: (sub.total_bookings || 0) + 1,
      last_booking_id: createResult.booking_id || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  return {
    status: "ok",
    booking_id: createResult.booking_id,
    payment_url: paymentUrl,
    next_date: nextDate.toISOString().split("T")[0],
  };
}

/**
 * noshow-refund – Kundinitierad återbetalning vid no-show
 * Kunden klickar refund-länk → validerar token → Stripe refund → uppdaterar bokning
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, ADMIN } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const sb = createClient(SUPA_URL, SUPA_KEY);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { bid, token } = await req.json();

    if (!bid || !token) {
      return new Response(JSON.stringify({ error: "Saknar bid eller token" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Token = first 8 chars of booking ID
    if (token !== bid.slice(0, 8)) {
      return new Response(JSON.stringify({ error: "Ogiltig token" }), {
        status: 403,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Hämta bokning
    const { data: booking, error: fetchErr } = await sb
      .from("bookings")
      .select("*")
      .eq("id", bid)
      .single();

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "Bokning hittades inte" }), {
        status: 404,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Redan återbetald?
    if (booking.status === "no_show_refunded" || booking.payment_status === "refunded") {
      return new Response(JSON.stringify({ error: "Redan återbetald", already: true }), {
        status: 409,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Stripe refund
    let refundStatus = "skipped";
    if (booking.payment_intent_id && STRIPE_KEY) {
      const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(STRIPE_KEY + ":")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `payment_intent=${booking.payment_intent_id}`,
      });
      if (!refundRes.ok) {
        const errBody = await refundRes.text();
        console.error("Stripe refund error:", errBody);
        return new Response(JSON.stringify({ error: "Stripe-fel vid återbetalning" }), {
          status: 502,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      refundStatus = "initiated";
    }

    // Uppdatera bokning
    await sb.from("bookings").update({
      status: "no_show_refunded",
      payment_status: "refunded",
      refunded_at: new Date().toISOString(),
      refund_reason: "Kundens begäran — städare dök inte upp",
    }).eq("id", bid);

    const custFirst = (booking.customer_name || "").split(" ")[0] || "Kund";
    const cleanerName = booking.cleaner_name || "städaren";

    // Bekräftelse till kund
    if (booking.customer_email) {
      await sendEmail(booking.customer_email,
        "Återbetalning bekräftad — vi ber om ursäkt",
        wrap(`<h2>Din återbetalning är bekräftad</h2>
<p>Hej ${esc(custFirst)}, vi ber verkligen om ursäkt för besväret. Din bokning har avbokats och full återbetalning är på väg.</p>
<div class="card">
  <div class="row"><span class="lbl">Bokning</span><span class="val">${esc(booking.service_type || "Hemstädning")} · ${booking.booking_hours || 3}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${esc(booking.booking_date)} kl ${esc(booking.booking_time || "09:00")}</span></div>
  <div class="row"><span class="lbl">Belopp</span><span class="val">${booking.total_price || 0} kr</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val" style="color:#0F6E56">Återbetald</span></div>
</div>
<p>Pengarna syns på ditt konto inom 3–5 bankdagar.</p>
<p>Vi vill gärna kompensera dig — boka nästa städning så ser vi till att det blir perfekt!</p>
<a href="https://spick.se/boka.html" class="btn">Boka ny städning</a>
<hr style="border:none;border-top:1px solid #E8E8E4;margin:20px 0">
<p style="font-size:13px">Frågor? <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> · <a href="https://wa.me/46760505153" style="color:#0F6E56">WhatsApp</a></p>`)
      );
    }

    // Admin-alert
    await sendEmail(ADMIN,
      `🚨 No-show refund utförd: ${esc(cleanerName)} → ${esc(custFirst)} (${booking.total_price || 0} kr)`,
      wrap(`<h2>Kund begärde no-show återbetalning</h2>
<div class="card">
  <div class="row"><span class="lbl">Kund</span><span class="val">${esc(booking.customer_name || "–")} (${esc(booking.customer_phone || "–")})</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${esc(cleanerName)} (${esc(booking.cleaner_phone || "–")})</span></div>
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${esc(booking.service_type || "Städning")} · ${booking.booking_hours || 3}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${esc(booking.booking_date)} kl ${esc(booking.booking_time || "09:00")}</span></div>
  <div class="row"><span class="lbl">Belopp</span><span class="val">${booking.total_price || 0} kr</span></div>
  <div class="row"><span class="lbl">Refund</span><span class="val">${refundStatus}</span></div>
</div>
<p>Ring städaren och följ upp. Överväg varning om detta upprepas.</p>
<a href="https://spick.se/admin.html" class="btn">Öppna admin</a>`)
    );

    return new Response(JSON.stringify({ ok: true, refund: refundStatus }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("noshow-refund error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

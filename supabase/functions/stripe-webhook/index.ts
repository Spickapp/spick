/**
 * stripe-webhook – komplett Spick betalningsflöde
 * 
 * Hanterar:
 * - checkout.session.completed → betald bokning
 *   1. Uppdatera bokning i DB
 *   2. Tilldela närmaste tillgängliga städare
 *   3. Skicka bekräftelsemail till kund (med faktura)
 *   4. Notifiera tilldelad städare
 *   5. Notifiera admin
 *   6. Trigga RUT-ansökan om applicerbart
 * - payment_intent.payment_failed → misslyckad betalning
 *   1. Uppdatera bokning
 *   2. Skicka mail till kund
 * - charge.refunded → återbetalning
 *   1. Uppdatera bokning
 *   2. Skicka bekräftelse
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, stripe-signature",
};

const STRIPE_SECRET_KEY     = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const RESEND_API_KEY        = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL          = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM                  = "Spick <hello@spick.se>";
const ADMIN                 = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Stripe-signaturverifiering ─────────────────────────────────────────────
async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = sigHeader.split(",");
    const t = parts.find(p => p.startsWith("t="))?.split("=")[1];
    const v1 = parts.find(p => p.startsWith("v1="))?.split("=")[1];
    if (!t || !v1) return false;
    const payload = `${t}.${body}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    return computed === v1;
  } catch { return false; }
}

// ── Email wrapper ──────────────────────────────────────────────────────────
function wrap(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;padding:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.header{background:#0F6E56;padding:24px 32px}.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}
.body{padding:32px}.footer{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}
p{color:#6B6960;line-height:1.7;font-size:15px;margin:0 0 12px}
.card{background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}
.row:last-child{border:none;padding-top:10px}.row .lbl{color:#9B9B95}.row .val{font-weight:600;color:#1C1C1A}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}
.check{background:#E1F5EE;border-radius:12px;padding:20px;text-align:center;margin:16px 0}
.check-icon{font-size:3rem;display:block}.check-text{font-weight:700;color:#0F6E56;font-size:18px;font-family:Georgia,serif}
.divider{border:none;border-top:1px solid #E8E8E4;margin:20px 0}
.steps{margin:16px 0}.step{display:flex;gap:12px;margin-bottom:12px;align-items:flex-start}
.step-num{background:#0F6E56;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0}
.step-text{font-size:14px;color:#6B6960;padding-top:3px}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">Spick</div></div>
  <div class="body">${content}</div>
  <div class="footer">
    Spick AB · 559402-4522 · hello@spick.se · <a href="https://spick.se" style="color:#0F6E56">spick.se</a><br>
    <a href="https://spick.se/integritetspolicy.html" style="color:#9E9E9A">Integritetspolicy</a> · 
    <a href="https://spick.se/garanti.html" style="color:#9E9E9A">Nöjdhetsgaranti</a>
  </div>
</div></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
  if (!res.ok) console.error("Email fel:", await res.text());
}

// ── Tilldela bästa tillgängliga städare ───────────────────────────────────
async function assignBestCleaner(booking: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const city = (booking.city as string)?.toLowerCase() || "";
  const service = (booking.service as string) || "Hemstädning";
  const date = booking.date as string;
  
  // Hitta godkända städare i rätt stad med rätt tjänst, sorterade på betyg
  const { data: cleaners } = await sb
    .from("cleaners")
    .select("id, full_name, email, avg_rating, services, city")
    .eq("status", "godkänd")
    .order("avg_rating", { ascending: false });

  if (!cleaners?.length) return null;

  // Filtrera på stad och tjänst med prioritering
  const eligible = cleaners.filter(c => {
    const cleanerCity = (c.city as string)?.toLowerCase() || "";
    const cleanerServices = ((c.services as string) || "").toLowerCase();
    
    // Stadscheck
    let cityMatch = cleanerCity === city || cleanerCity.includes(city) || city.includes(cleanerCity) || city === "";
    const storsthlm = ["stockholm","solna","sundbyberg","nacka","bromma","lidingö","huddinge","hägersten"];
    if (!cityMatch && storsthlm.includes(city)) {
      cityMatch = storsthlm.some(s => cleanerCity.includes(s));
    }
    if (!cityMatch) return false;
    
    // Tjänstcheck - matcha kompetens mot bokad tjänst
    const serviceNormalized = service.toLowerCase();
    if (!cleanerServices || cleanerServices.length === 0) return true; // Inga krav = kan allt
    if (serviceNormalized.includes("fönster") || serviceNormalized.includes("puts")) {
      return cleanerServices.includes("fönster") || cleanerServices.includes("puts");
    }
    if (serviceNormalized.includes("flytt")) {
      return cleanerServices.includes("flytt") || cleanerServices.includes("storstäd");
    }
    if (serviceNormalized.includes("storstäd")) {
      return cleanerServices.includes("stor") || cleanerServices.includes("hem");
    }
    // Hemstädning - de flesta kan
    return cleanerServices.includes("hem") || cleanerServices.includes("städ");
  });

  // Fallback om ingen i rätt stad
  const pool = eligible.length ? eligible : cleaners;
  
  console.log(`Auto-assign: ${pool.length} kandidater för ${city}`);

  // Kolla att städaren inte redan är bokad samma dag
  for (const cleaner of eligible) {
    // Kolla tidskonflikter – hämta tid och time_end för städarens bokningar den dagen
    const startTime = booking.time || "09:00";
    const endTime   = booking.time_end || "12:00";
    const { data: conflicts } = await sb
      .from("bookings")
      .select("id, time, time_end")
      .eq("cleaner_id", cleaner.id)
      .eq("date", date)
      .eq("payment_status", "paid");

    // Kontrollera om någon befintlig bokning överlappar med den nya
    const hasConflict = (conflicts || []).some(b => {
      const bStart = b.time     || "00:00";
      const bEnd   = b.time_end || "23:59";
      // Overlap: ny start < befintlig slut OCH ny slut > befintlig start
      return startTime < bEnd && endTime > bStart;
    });

    if (!hasConflict) return cleaner;
  }

  return eligible[0]; // Alla är bokade – ta bästa ändå
}

// ── Betalning lyckades ─────────────────────────────────────────────────────
async function handlePaymentSuccess(session: Record<string, unknown>) {
  const bookingId = (session.metadata as Record<string, string>)?.booking_id;
  const isRut = (session.metadata as Record<string, string>)?.rut === "true";
  const amountPaid = (session.amount_total as number) / 100;
  const customerEmail = (session.customer_details as Record<string, string>)?.email;
  const stripeSessionId = session.id as string;

  if (!bookingId) { console.error("Saknar booking_id"); return; }

  // Hämta bokningsinformation
  const { data: bookings } = await sb
    .from("bookings")
    .select("*")
    .eq("id", bookingId);
  
  const booking = bookings?.[0];
  if (!booking) { console.error("Bokning ej hittad:", bookingId); return; }

  // Tilldela städare - prioritera den som kunden valde
  const preferredCleanerId = (session.metadata as Record<string, string>)?.cleaner_id;
  let cleaner = null;
  if (preferredCleanerId) {
    const { data: preferred } = await sb
      .from("cleaners")
      .select("id, full_name, email, avg_rating")
      .eq("id", preferredCleanerId)
      .eq("status", "godkänd")
      .single();
    cleaner = preferred;
  }
  if (!cleaner) {
    cleaner = await assignBestCleaner(booking);
  }

  // Uppdatera bokning
  const metadata = session.metadata as Record<string, string> || {};
  await sb.from("bookings").update({
    payment_status: "paid",
    payment_method: (session.payment_method_types as string[])?.[0] || "card",
    stripe_session_id: stripeSessionId,
    stripe_payment_intent: session.payment_intent,
    paid_at: new Date().toISOString(),
    reminders_sent: [],
    ...(cleaner ? { cleaner_id: cleaner.id, cleaner_name: cleaner.full_name, cleaner_email: cleaner.email } : {}),
    ...(metadata.sqm ? { sqm: parseInt(metadata.sqm) } : {}),
    ...(metadata.key_info ? { key_info: metadata.key_info } : {}),
    ...(metadata.customer_notes ? { customer_notes: metadata.customer_notes } : {}),
    ...(metadata.frequency && metadata.frequency !== "once" ? { is_recurring: true } : {}),
  }).eq("id", bookingId);

  // Om prenumeration: skapa subscription-rad
  if (metadata.frequency && metadata.frequency !== "once") {
    const freqMap: Record<string, string> = { weekly: "vecka", biweekly: "varannan_vecka" };
    await sb.from("subscriptions").insert({
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      customer_phone: booking.phone,
      address: booking.address,
      city: booking.city,
      service: booking.service,
      frequency: freqMap[metadata.frequency] || metadata.frequency,
      hours: booking.hours,
      price: amountPaid,
      rut: booking.rut,
      status: "aktiv",
      next_booking_date: booking.date,
      discount_percent: metadata.frequency === "weekly" ? 10 : 0,
    }).then(() => console.log("✅ Prenumeration skapad")).catch(e => console.error("Prenumeration-fel:", e));
  }

  const name = booking.customer_name || "Kunden";
  const fname = name.split(" ")[0];
  const price = `${Math.round(amountPaid)} kr`;
  const rutNote = isRut ? " (efter 50% RUT-avdrag)" : "";
  const date = booking.date || "";
  const time = booking.time || "09:00";
  const service = booking.service || "Hemstädning";
  const hours = booking.hours || 3;
  const address = booking.address || "";

  // ── 1. Bekräftelsemail till kund ────────────────────────────
  const customerHtml = wrap(`
<div class="check">
  <span class="check-icon">✅</span>
  <div class="check-text">Din bokning är bekräftad!</div>
</div>
<h2>Tack för din bokning, ${fname}! 🌿</h2>
<p>Vi har tagit emot din betalning och en BankID-verifierad städare är tilldelad till dig.</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  ${cleaner ? `<div class="row"><span class="lbl">Din städare</span><span class="val">${cleaner.full_name} ⭐ ${cleaner.avg_rating || "5.0"}</span></div>` : ""}
  <div class="row"><span class="lbl">Betalt</span><span class="val">${price}${rutNote}</span></div>
</div>
<div class="steps">
  <div class="step"><div class="step-num">1</div><div class="step-text">Du får en påminnelse 24 timmar innan städningen</div></div>
  <div class="step"><div class="step-num">2</div><div class="step-text">Städaren anländer på utsatt tid och utför jobbet</div></div>
  <div class="step"><div class="step-num">3</div><div class="step-text">Du betygsätter städningen – vi säkerställer kvaliteten</div></div>
</div>
${isRut ? `<div style="background:#E1F5EE;border-radius:12px;padding:16px;margin:16px 0"><p style="margin:0;font-size:14px;color:#0F6E56">🏦 <strong>RUT-avdrag:</strong> Vi ansöker automatiskt om ditt RUT-avdrag hos Skatteverket. Du behöver inte göra något.</p></div>` : ""}
<a href="https://spick.se/min-bokning.html?bid=${bookingId}" class="btn">Visa min bokning →</a>
<hr class="divider">
<p style="font-size:13px">Behöver du ändra eller avboka? Kontakta oss senast 24h innan på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
<p style="font-size:13px">🛡️ <strong>100% nöjdhetsgaranti</strong> – inte nöjd? Vi städar om gratis.</p>
`);
  await sendEmail(customerEmail || booking.customer_email, `Bokningsbekräftelse – ${service} den ${date} ✅`, customerHtml);

  // ── 2. Notifiera städaren ────────────────────────────────────
  if (cleaner) {
    const earning = Math.round(amountPaid * 0.83);
    const cleanerHtml = wrap(`
<h2>Nytt uppdrag tilldelat! 🧹</h2>
<p>Hej ${cleaner.full_name?.split(" ")[0] || ""}! Du har fått ett nytt städuppdrag.</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">${earning} kr</span></div>
</div>
<p>⚠️ Kan du inte genomföra uppdraget? Hör av dig omgående till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> så vi kan omfördela.</p>
<a href="https://spick.se/stadare-dashboard.html" class="btn">Öppna dashboard →</a>
`);
    await sendEmail(cleaner.email, `Nytt uppdrag: ${service} den ${date} 🧹`, cleanerHtml);
  }

  // ── 3. Admin-notis ───────────────────────────────────────────
  const adminHtml = wrap(`
<h2>💰 Ny betalning mottagen!</h2>
<div class="card">
  <div class="row"><span class="lbl">Kund</span><span class="val">${name}</span></div>
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date} ${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  <div class="row"><span class="lbl">Belopp</span><span class="val">${price}${rutNote}</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${cleaner ? cleaner.full_name : "⚠️ EJ TILLDELAD"}</span></div>
  <div class="row"><span class="lbl">Stripe Session</span><span class="val" style="font-size:11px">${stripeSessionId}</span></div>
</div>
${!cleaner ? `<div style="background:#FFF5E5;border-left:4px solid #F59E0B;padding:12px;border-radius:0 8px 8px 0;margin:8px 0"><strong>⚠️ Ingen städare tilldelad!</strong> Tilldela manuellt i admin-panelen.</div>` : ""}
<a href="https://spick.se/admin.html" class="btn">Admin-panel →</a>
`);
  await sendEmail(ADMIN, `💰 Ny bokning: ${name} – ${price} – ${date}`, adminHtml);

  // ── 4. Trigga RUT-ansökan ────────────────────────────────────
  if (isRut && booking.customer_pnr_hash) {
    await fetch(`${SUPABASE_URL}/functions/v1/rut-claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "apikey": SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({ booking_id: bookingId })
    }).catch(e => console.error("RUT-fel:", e));
  }
}

// ── Betalning misslyckades ─────────────────────────────────────────────────
async function handlePaymentFailed(paymentIntent: Record<string, unknown>) {
  const bookingId = (paymentIntent.metadata as Record<string, string>)?.booking_id;
  if (!bookingId) return;

  await sb.from("bookings").update({ payment_status: "failed" }).eq("id", bookingId);

  const { data: bookings } = await sb.from("bookings").select("customer_name,customer_email,email,service,date,time").eq("id", bookingId);
  const booking = bookings?.[0];
  if (!booking) return;

  const fname = booking.customer_name?.split(" ")[0] || "där";
  await sendEmail(
    booking.customer_email || booking.email,
    "Betalning misslyckades – försök igen ❌",
    wrap(`
<h2>Betalningen gick inte igenom 😔</h2>
<p>Hej ${fname}! Tyvärr misslyckades din betalning för ${booking.service} den ${booking.date}.</p>
<p>Din bokning är sparad – försök betala igen:</p>
<a href="https://spick.se/boka.html" class="btn">Försök betala igen →</a>
<p style="font-size:13px;margin-top:16px">Behöver du hjälp? Skriv till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
`)
  );
}

// ── Återbetalning ──────────────────────────────────────────────────────────
async function handleRefund(charge: Record<string, unknown>) {
  const paymentIntentId = charge.payment_intent as string;
  if (!paymentIntentId) return;

  const { data: bookings } = await sb
    .from("bookings")
    .select("*")
    .eq("stripe_payment_intent", paymentIntentId);
  
  const booking = bookings?.[0];
  if (!booking) return;

  await sb.from("bookings").update({ payment_status: "refunded" }).eq("id", booking.id);

  const refundAmount = ((charge.amount_refunded as number) || 0) / 100;
  const fname = booking.customer_name?.split(" ")[0] || "där";

  await sendEmail(
    booking.customer_email || booking.email,
    `Återbetalning bekräftad – ${Math.round(refundAmount)} kr ✅`,
    wrap(`
<h2>Din återbetalning är genomförd ✅</h2>
<p>Hej ${fname}! Vi har återbetalat <strong>${Math.round(refundAmount)} kr</strong> till ditt betalkort.</p>
<p>Pengarna syns på ditt konto inom 3-5 bankdagar.</p>
<p>Vi hoppas att vi får möjlighet att hjälpa dig i framtiden.</p>
<a href="https://spick.se/boka.html" class="btn">Boka igen →</a>
`)
  );
  await sendEmail(ADMIN, `↩️ Återbetalning: ${booking.customer_name} – ${Math.round(refundAmount)} kr`, wrap(`<h2>Återbetalning genomförd</h2><p>Kund: ${booking.customer_name}<br>Belopp: ${Math.round(refundAmount)} kr<br>Bokning: ${booking.date}</p>`));
}

// ── Huvud-handler ──────────────────────────────────────────────────────────

// ── FÅNGA BETALNING (escrow → faktisk debitering) ─────────────────────────
async function capturePayment(bookingId: string) {
  const { data: booking } = await sb.from("bookings")
    .select("stripe_payment_intent,total_price,customer_email,email,service")
    .eq("id", bookingId).single();
  
  if (!booking?.stripe_payment_intent) return;
  
  // Capture payment via Stripe API
  const captureRes = await fetch(
    `https://api.stripe.com/v1/payment_intents/${booking.stripe_payment_intent}/capture`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );
  
  const captured = await captureRes.json();
  if (captured.status === "succeeded") {
    await sb.from("bookings").update({ 
      payment_status: "captured",
      captured_at: new Date().toISOString()
    }).eq("id", bookingId);
    console.log("✅ Betalning captured för bokning:", bookingId);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  // Direkt capture-anrop från städardashboard
  if (req.method === "POST" && req.url.includes("?action=capture")) {
    const { booking_id } = await req.json().catch(() => ({}));
    if (booking_id) await capturePayment(booking_id);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }
  
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  const valid = await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET);
  if (!valid) { console.error("Ogiltig Stripe-signatur"); return new Response("Unauthorized", { status: 401 }); }

  let event: Record<string, unknown>;
  try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handlePaymentSuccess(event.data.object as Record<string, unknown>);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Record<string, unknown>);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object as Record<string, unknown>);
        break;
      default:
        console.log("Unhandled event:", event.type);
    }
  } catch (e) {
    console.error("Webhook-fel:", e);
    return new Response("Internal Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});

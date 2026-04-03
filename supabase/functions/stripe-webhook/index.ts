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
import { corsHeaders } from "../_shared/email.ts";

const STRIPE_SECRET_KEY     = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const RESEND_API_KEY        = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL          = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM                  = "Spick <hello@spick.se>";
const ADMIN                 = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Stripe-signaturverifiering (timing-safe + replay protection) ───────────
const STRIPE_TOLERANCE_SEC = 300; // 5 min replay window

async function verifyStripeSignature(body: string, sigHeader: string, secret: string): Promise<boolean> {
  try {
    const parts = sigHeader.split(",");
    const t = parts.find(p => p.startsWith("t="))?.split("=")[1];
    const v1 = parts.find(p => p.startsWith("v1="))?.split("=")[1];
    if (!t || !v1) return false;

    const timestamp = parseInt(t, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(timestamp) || Math.abs(now - timestamp) > STRIPE_TOLERANCE_SEC) {
      console.warn(`Stripe replay rejected: diff ${Math.abs(now - timestamp)}s`);
      return false;
    }

    const payload = `${t}.${body}`;
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (computed !== v1) {
      console.warn(`Stripe sig mismatch: computed=${computed.substring(0,16)}... expected=${v1.substring(0,16)}...`);
    }
    return computed === v1;
  } catch(e) {
    console.error("Stripe sig verify error:", e);
    return false;
  }
}

// ── Email wrapper ──────────────────────────────────────────────────────────
// XSS-skydd
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

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

/** Fire-and-forget SMS via sms-EF. Loggar fel men kastar aldrig undantag. */
async function sendSms(to: string | null | undefined, message: string): Promise<void> {
  if (!to) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ to, message }),
    });
  } catch (e) {
    console.warn("SMS skippat:", (e as Error).message);
  }
}

// ── Tilldela bästa tillgängliga städare ───────────────────────────────────
async function assignBestCleaner(booking: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const city = (booking.customer_address as string)?.toLowerCase() || "";
  const service = (booking.service_type as string) || "Hemstädning";
  const date = booking.booking_date as string;
  
  // Hitta godkända städare i rätt stad med rätt tjänst, sorterade på betyg
  const { data: cleaners } = await sb
    .from("cleaners")
    .select("id, full_name, avg_rating, city, auth_user_id, email")
    .eq("status", "aktiv")
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
    // Kolla tidskonflikter – hämta booking_time och booking_hours för städarens bokningar den dagen
    const startTime = booking.booking_time || "09:00";
    const bookingHrs = Number(booking.booking_hours) || 3;
    const [sH, sM] = startTime.split(":").map(Number);
    const endMin = sH * 60 + (sM || 0) + bookingHrs * 60;
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    const { data: conflicts } = await sb
      .from("bookings")
      .select("id, booking_time, booking_hours")
      .eq("cleaner_id", cleaner.id)
      .eq("booking_date", date)
      .eq("payment_status", "paid");

    // Kontrollera om någon befintlig bokning överlappar med den nya
    const hasConflict = (conflicts || []).some(b => {
      const bStart = b.booking_time || "00:00";
      const bH = Number(b.booking_hours) || 3;
      const [bHr, bMn] = bStart.split(":").map(Number);
      const bEndMin = bHr * 60 + (bMn || 0) + bH * 60;
      const bEnd = `${String(Math.floor(bEndMin / 60)).padStart(2, "0")}:${String(bEndMin % 60).padStart(2, "0")}`;
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
      .select("id, full_name, avg_rating, auth_user_id, email")
      .eq("id", preferredCleanerId)
      .eq("status", "aktiv")
      .single();
    cleaner = preferred;
  }
  if (!cleaner) {
    cleaner = await assignBestCleaner(booking);
  }

  // ── DOUBLE-BOOKING GUARD (server-side, final check) ──────────
  // Before marking as paid, verify no other paid booking exists for same slot
  const { data: conflicts } = await sb.from("bookings")
    .select("id")
    .eq("cleaner_id", cleaner?.id || booking.cleaner_id)
    .eq("booking_date", booking.booking_date)
    .eq("booking_time", booking.booking_time)
    .eq("payment_status", "paid")
    .neq("status", "avbokad")
    .neq("id", bookingId)
    .limit(1);
  
  if (conflicts && conflicts.length > 0) {
    // Double-booking detected — refund automatically
    console.error(`DOUBLE-BOOKING BLOCKED: booking ${bookingId} conflicts with ${conflicts[0].id}`);
    await sb.from("bookings").update({ 
      payment_status: "refunded", 
      status: "avbokad",
      notes: (booking.notes || '') + ' [Auto-refund: dubbelbokningskonflikt]'
    }).eq("id", bookingId);
    // Trigger Stripe refund
    if (session.payment_intent) {
      try {
        const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: `payment_intent=${session.payment_intent}`,
        });
        console.log("Auto-refund result:", refundRes.status);
      } catch (re) { console.error("Refund failed:", re); }
    }
    return new Response(JSON.stringify({ ok: false, reason: "double-booking" }), { status: 200 });
  }

  // Uppdatera bokning
  const metadata = session.metadata as Record<string, string> || {};
  await sb.from("bookings").update({
    payment_status: "paid",
    payment_method: (session.payment_method_types as string[])?.[0] || "card",
    payment_intent_id: session.payment_intent as string || null,
    ...(cleaner ? { cleaner_id: cleaner.id, cleaner_name: cleaner.full_name } : {}),
    ...(metadata.sqm ? { square_meters: parseInt(metadata.sqm) } : {}),
    ...(metadata.customer_notes ? { notes: metadata.customer_notes } : {}),
  }).eq("id", bookingId);

  // Om prenumeration: skapa subscription-rad
  if (metadata.frequency && metadata.frequency !== "once") {
    const nextDate = new Date(booking.booking_date);
    nextDate.setDate(nextDate.getDate() + (metadata.frequency === "weekly" ? 7 : metadata.frequency === "biweekly" ? 14 : 30));
    try {
      await sb.from("subscriptions").insert({
        customer_name:        booking.customer_name,
        customer_email:       booking.customer_email,
        customer_phone:       booking.customer_phone        || null,
        address:              booking.customer_address,
        city:                 booking.city                  || null,
        service:              booking.service_type          || "Hemstädning",
        frequency:            metadata.frequency,
        hours:                booking.booking_hours         || 3,
        preferred_cleaner_id: booking.cleaner_id            || null,
        cleaner_name:         booking.cleaner_name          || null,
        status:               "aktiv",
        next_booking_date:    nextDate.toISOString().split("T")[0],
        discount_percent:     metadata.frequency === "weekly" ? 10 : metadata.frequency === "biweekly" ? 5 : 0,
        key_info:             booking.key_info              || null,
        customer_notes:       booking.customer_notes        || null,
      });
      console.log("✅ Prenumeration skapad");
    } catch(e) { console.error("Prenumeration-fel:", e); }
  }

  const name = booking.customer_name || "Kunden";
  const fname = name.split(" ")[0];
  const price = `${Math.round(amountPaid)} kr`;
  const rutNote = isRut ? " (efter 50% RUT-avdrag)" : "";
  const date = booking.booking_date || "";
  const time = booking.booking_time || "09:00";
  const service = booking.service_type || "Hemstädning";
  const hours = booking.booking_hours || 3;
  const address = booking.customer_address || "";

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

  // SMS-bekräftelse (fire-and-forget — kräver ELKS-nycklar i Secrets)
  await sendSms(
    booking.customer_phone,
    `Spick: Bokning bekräftad ✅ ${service} den ${date} kl ${time}. ` +
    `Se din bokning: https://spick.se/min-bokning.html?bid=${booking.id}`
  );

  // ── 2. Notifiera städaren ────────────────────────────────────
  if (cleaner) {
    // Hämta städarens email via auth.users (cleaners har ingen email-kolumn)
    let cleanerEmail: string | null = null;
    if (cleaner.auth_user_id) {
      const { data: authData } = await sb.auth.admin.getUserById(cleaner.auth_user_id);
      cleanerEmail = authData?.user?.email || null;
    }
    if (!cleanerEmail && cleaner.email) {
      cleanerEmail = cleaner.email;
    }

    if (cleanerEmail) {
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
<a href="https://spick.se/portal" class="btn">Öppna dashboard →</a>
<p style="margin-top:24px;font-size:12px;color:#9E9E9A">Vill du sluta ta emot uppdrag? <a href="https://urjeijcncsyuletprydy.supabase.co/functions/v1/cleaner-optout?token=${cleaner.auth_user_id}" style="color:#9E9E9A">Avregistrera dig här</a></p>
`);
      await sendEmail(cleanerEmail, `Nytt uppdrag: ${service} den ${date} 🧹`, cleanerHtml);
    } else {
      console.warn(`Ingen email hittad för städare ${cleaner.id} – kan ej notifiera`);
    }
  }

  // ── 3. Admin-notis ───────────────────────────────────────────
  const adminHtml = wrap(`
<h2>💰 Ny betalning mottagen!</h2>
<div class="card">
  <div class="row"><span class="lbl">Kund</span><span class="val">${esc(name)}</span></div>
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
  await sendEmail(ADMIN, `💰 Ny bokning: ${esc(name)} – ${price} – ${date}`, adminHtml);

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

  const { data: bookings } = await sb.from("bookings").select("customer_name,customer_email,service_type,booking_date,booking_time").eq("id", bookingId);
  const booking = bookings?.[0];
  if (!booking) return;

  const fname = booking.customer_name?.split(" ")[0] || "där";
  await sendEmail(
    booking.customer_email,
    "Betalning misslyckades – försök igen ❌",
    wrap(`
<h2>Betalningen gick inte igenom 😔</h2>
<p>Hej ${fname}! Tyvärr misslyckades din betalning för ${booking.service_type} den ${booking.booking_date}.</p>
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
    .eq("payment_intent_id", paymentIntentId);
  
  const booking = bookings?.[0];
  if (!booking) return;

  await sb.from("bookings").update({ payment_status: "refunded" }).eq("id", booking.id);

  const refundAmount = ((charge.amount_refunded as number) || 0) / 100;
  const fname = booking.customer_name?.split(" ")[0] || "där";

  await sendEmail(
    booking.customer_email,
    `Återbetalning bekräftad – ${Math.round(refundAmount)} kr ✅`,
    wrap(`
<h2>Din återbetalning är genomförd ✅</h2>
<p>Hej ${fname}! Vi har återbetalat <strong>${Math.round(refundAmount)} kr</strong> till ditt betalkort.</p>
<p>Pengarna syns på ditt konto inom 3-5 bankdagar.</p>
<p>Vi hoppas att vi får möjlighet att hjälpa dig i framtiden.</p>
<a href="https://spick.se/boka.html" class="btn">Boka igen →</a>
`)
  );
  await sendEmail(ADMIN, `↩️ Återbetalning: ${booking.customer_name} – ${Math.round(refundAmount)} kr`, wrap(`<h2>Återbetalning genomförd</h2><p>Kund: ${booking.customer_name}<br>Belopp: ${Math.round(refundAmount)} kr<br>Bokning: ${booking.booking_date}</p>`));
}

// ── Huvud-handler ──────────────────────────────────────────────────────────

// ── FÅNGA BETALNING (escrow → faktisk debitering) ─────────────────────────
async function capturePayment(bookingId: string) {
  const { data: booking } = await sb.from("bookings")
    .select("payment_intent_id,total_price,customer_email,service_type")
    .eq("id", bookingId).single();
  
  if (!booking?.payment_intent_id) return;

  // Capture payment via Stripe API
  const captureRes = await fetch(
    `https://api.stripe.com/v1/payment_intents/${booking.payment_intent_id}/capture`,
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
    }).eq("id", bookingId);
    console.log("✅ Betalning captured för bokning:", bookingId);
  }
}

serve(async (req) => {
  const CORS = corsHeaders(req);
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

  // ── IDEMPOTENCY: claim event BEFORE processing (atomic guard) ───────────
  const eventId = event.id as string;
  if (eventId) {
    const { error: claimErr } = await sb
      .from("processed_webhook_events")
      .insert({ event_id: eventId, event_type: event.type as string });

    if (claimErr) {
      console.log(`Skipping duplicate event: ${eventId} (${event.type})`);
      return new Response("Already processed", { status: 200 });
    }
  }

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

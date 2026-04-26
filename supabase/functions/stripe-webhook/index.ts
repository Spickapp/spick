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
import { corsHeaders, getMaterialInfo } from "../_shared/email.ts";
import { sendMagicSms } from "../_shared/send-magic-sms.ts";
import { logBookingEvent } from "../_shared/events.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";

const STRIPE_SECRET_KEY       = Deno.env.get("STRIPE_SECRET_KEY")!;
const STRIPE_SECRET_KEY_TEST  = Deno.env.get("STRIPE_SECRET_KEY_TEST") || "";
const RESEND_API_KEY          = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL            = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FROM                    = "Spick <hello@spick.se>";
const ADMIN                   = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/**
 * Dual-key Stripe: välj secret för API-anrop baserat på event.livemode.
 * Stripe's native livemode-flag (true för live, false för test) styr
 * vilken secret som används för verification-call och downstream API.
 * Fail-safe: om test-event och STRIPE_SECRET_KEY_TEST saknas → fallback
 * live (Stripe API returnerar då 404 → isReal=false → event hoppas över,
 * vilket är korrekt defensiv behavior).
 */
function stripeKeyForEvent(event: Record<string, unknown>): string {
  const isLive = event.livemode !== false; // default true om fältet saknas
  if (!isLive && STRIPE_SECRET_KEY_TEST) {
    return STRIPE_SECRET_KEY_TEST;
  }
  return STRIPE_SECRET_KEY;
}

// ── Smart Auto-Confirm trösklar ────────────────────────────
const AUTO_CONFIRM_MIN_JOBS = 5;
const AUTO_CONFIRM_MIN_RATING = 4.0;

function isExperiencedCleaner(cleaner: any): boolean {
  if (!cleaner) return false;
  const jobs = Number(cleaner.completed_jobs || cleaner.total_jobs || 0);
  const rating = Number(cleaner.avg_rating || 0);
  return jobs >= AUTO_CONFIRM_MIN_JOBS && rating >= AUTO_CONFIRM_MIN_RATING;
}

// ── Stripe event verification via API ───────────────────────────────────────
async function verifyEventWithStripe(eventId: string, stripeKey: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.stripe.com/v1/events/${eventId}`, {
      headers: { "Authorization": `Bearer ${stripeKey}` }
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolve Stripe key för code-paths som saknar event-context
 * (t.ex. capturePayment från stadare-dashboard). Läser platform_settings
 * flag. Samma logik som booking-create.
 */
async function resolveStripeKeyFromFlag(): Promise<string> {
  try {
    const { data } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "stripe_test_mode")
      .single();
    if (data?.value === 'true' && STRIPE_SECRET_KEY_TEST) {
      return STRIPE_SECRET_KEY_TEST;
    }
  } catch (_) { /* fallback live */ }
  return STRIPE_SECRET_KEY;
}

/**
 * Returnerar `true` om DB-flaggan platform_settings.stripe_test_mode='true'.
 * Default: false (live-mode) vid fel/okänt värde.
 *
 * Används av webhook-mode-guarden för att blocka events där
 * event.livemode och DB-flagga inte matchar (hygien #21,
 * defense-in-depth mot cs_test_*-sessions i live-mode-prod).
 */
async function getStripeTestModeFlag(): Promise<boolean> {
  try {
    const { data } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "stripe_test_mode")
      .single();
    return data?.value === 'true';
  } catch (_) {
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
    Spick · 559402-4522 · hello@spick.se · <a href="https://spick.se" style="color:#0F6E56">spick.se</a><br>
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
    .select("id, full_name, avg_rating, city, auth_user_id, email, company_id, completed_jobs, total_jobs, phone")
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

  // Ingen fallback — returnera null om ingen matchar
  if (!eligible.length) {
    console.warn("Ingen städare matchar stad:", city);
    return null;
  }
  const pool = eligible;
  
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
async function handlePaymentSuccess(session: Record<string, unknown>, stripeKey: string = STRIPE_SECRET_KEY) {
  // ── Subscription setup (mode=setup) ────────────────
  if (session.mode === 'setup' && (session.metadata as Record<string, string>)?.type === 'subscription_setup') {
    await handleSubscriptionSetup(session, stripeKey);
    return;
  }

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
      .select("id, full_name, avg_rating, auth_user_id, email, company_id, completed_jobs, total_jobs, phone")
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
        // R3 (§13.3): idempotency-key förhindrar dubbel refund om webhook retry:as
        const idempotencyKey = `refund-${bookingId}-double-booking`;
        const refundRes = await fetch("https://api.stripe.com/v1/refunds", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            "Content-Type": "application/x-www-form-urlencoded",
            "Idempotency-Key": idempotencyKey,
          },
          body: `payment_intent=${session.payment_intent}`,
        });
        console.log("Auto-refund result:", refundRes.status);
      } catch (re) { console.error("Refund failed:", re); }
    }
    return new Response(JSON.stringify({ ok: false, reason: "double-booking" }), { status: 200 });
  }

  // Uppdatera bokning
  const metadata = session.metadata as Record<string, string> || {};
  const autoConfirm = isExperiencedCleaner(cleaner);
  const bookingStatus = autoConfirm ? "bekräftad" : "pending_confirmation";

  await sb.from("bookings").update({
    status: bookingStatus,
    payment_status: "paid",
    payment_method: (session.payment_method_types as string[])?.[0] || "card",
    payment_intent_id: session.payment_intent as string || null,
    ...(cleaner ? {
      cleaner_id: cleaner.id,
      cleaner_name: cleaner.full_name,
      cleaner_email: cleaner.email || null,
      cleaner_phone: cleaner.phone || null,
    } : {}),
    ...(metadata.sqm ? { square_meters: parseInt(metadata.sqm) } : {}),
    ...(metadata.customer_notes ? { notes: metadata.customer_notes } : {}),
  }).eq("id", bookingId);

  // Fas 6.3: logga payment_received (best-effort, ej i money-path)
  await logBookingEvent(sb, bookingId, "payment_received", {
    actorType: "system",
    metadata: {
      stripe_payment_intent_id: (session.payment_intent as string) || null,
      stripe_session_id: (session.id as string) || null,
      amount_total: (session.amount_total as number) || null,
      currency: (session.currency as string) || "sek",
      booking_status: bookingStatus,
      auto_confirm: autoConfirm,
    },
  });

  // Fas 8 §8.2: transitionera escrow-state om booking är i pending_payment
  // (escrow_v2-flödet). Legacy-bokningar har escrow_state='released_legacy'
  // och hoppas över här — de följer gamla destination-charge-flödet.
  // Anropar escrow-state-transition-EF som validerar + skriver audit.
  if ((booking as Record<string, unknown>).escrow_state === "pending_payment") {
    try {
      const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
        },
        body: JSON.stringify({
          booking_id: bookingId,
          action: "charge_succeeded",
          triggered_by: "system_webhook",
          metadata: {
            stripe_session_id: (session.id as string) || null,
            stripe_payment_intent_id: (session.payment_intent as string) || null,
            amount_total: (session.amount_total as number) || null,
          },
        }),
      });
      if (!transRes.ok) {
        console.warn("[SPICK] escrow-state-transition failed (booking paid, state-transition skipped):", {
          booking_id: bookingId,
          status: transRes.status,
        });
      }
    } catch (e) {
      console.warn("[SPICK] escrow-state-transition exception:", (e as Error).message);
    }
  }

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
  const matInfo = getMaterialInfo(service);

  // ── 1. Kvittomejl (Fas 2.5-R2) ──────────────────────────────
  // Ersätter tidigare "Bokning bekräftad"/"Bokning mottagen"-mejl.
  // generate-receipt skickar kvittomejl (bokföringslag-kompatibelt,
  // 11 fält) SAMT innehåller bokningsbekräftelse-kontext (magic link,
  // material-förberedelse, nöjdhetsgaranti). Ett mejl, inte två.
  //
  // Körs SYNKRONT för att kunna fallback-hantera fel. Om EF faller
  // eller returnerar HTTP 500 → skicka enkel bekräftelse + admin-notis,
  // bryt inte bokningsflödet.
  try {
    const receiptRes = await fetch(`${SUPABASE_URL}/functions/v1/generate-receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        "apikey": SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });
    if (!receiptRes.ok) {
      throw new Error(`generate-receipt HTTP ${receiptRes.status}: ${await receiptRes.text()}`);
    }
    console.log("✅ Kvittomejl skickat till kund för bokning:", bookingId);
  } catch (e) {
    const errMsg = (e as Error).message;
    console.error("[STRIPE-WEBHOOK] generate-receipt fallback triggered:", errMsg);
    // Fallback: enkel bekräftelse till kund så hen inte står utan något mejl
    const fallbackRecipient = customerEmail || booking.customer_email;
    if (fallbackRecipient) {
      await sendEmail(fallbackRecipient,
        `Bokningsbekräftelse — ${service} den ${date}`,
        wrap(`
<h2>Tack för din bokning! 🌿</h2>
<p>Vi har tagit emot din bokning och betalning. Ditt detaljerade kvitto skickas separat inom kort.</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date} kl ${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  <div class="row"><span class="lbl">Betalt</span><span class="val">${price}${rutNote}</span></div>
</div>
<p style="font-size:13px">Ändra/avboka senast 24h innan: <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
`)).catch((err: Error) => console.error("[STRIPE-WEBHOOK] Fallback-mejl misslyckades:", err.message));
    }
    // Notifiera admin om fallback triggades
    await sendEmail(ADMIN,
      `⚠️ generate-receipt fallback — bokning ${bookingId.slice(0, 8)}`,
      wrap(`
<h2>Kvittomejl misslyckades</h2>
<p>generate-receipt-EF svarade inte OK. Kunden fick fallback-bekräftelse utan kvitto.</p>
<div class="card">
  <div class="row"><span class="lbl">Bokning</span><span class="val">${esc(bookingId)}</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${esc(customerEmail || booking.customer_email)}</span></div>
  <div class="row"><span class="lbl">Fel</span><span class="val">${esc(errMsg)}</span></div>
</div>
<p>Åtgärd: anropa generate-receipt manuellt via CLI eller admin-UI. EF:n är idempotent (F-R2-7) — retry säkert.</p>
`)).catch((err: Error) => console.error("[STRIPE-WEBHOOK] Admin-fallback-notis misslyckades:", err.message));
    // Fas 10: parallell webhook-alert (additivt, mail förblir tills webhook verifierad)
    await sendAdminAlert({
      severity: "warn",
      title: "generate-receipt fallback",
      source: "stripe-webhook",
      message: "Kvitto-EF svarade inte OK — kunden fick fallback-bekräftelse utan kvitto. Retry via admin-UI.",
      booking_id: bookingId,
      metadata: {
        customer_email: customerEmail || booking.customer_email,
        error: errMsg,
      },
    });
  }

  // SMS-bekräftelse med magic-link (Fas 1.2)
  if (booking.customer_phone) {
    await sendMagicSms({
      phone: booking.customer_phone,
      email: booking.customer_email,
      redirect_to: `https://spick.se/min-bokning.html?bid=${booking.id}`,
      scope: "booking",
      resource_id: booking.id,
      ttl_hours: 168,
      sms_template: (link) =>
        autoConfirm
          ? `Spick: Bokning bekräftad ✅ ${service} den ${date} kl ${time} med ${cleaner?.full_name || "din städare"}. Se bokningen: ${link}`
          : `Spick: Bokning mottagen ⏳ ${service} den ${date} kl ${time}. Din städare bekräftar inom 90 min. Se bokningen: ${link}`,
    });
  }

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
      const cleanerHtml = autoConfirm
        ? wrap(`
<h2>Nytt uppdrag bekräftat! 🧹</h2>
<p>Hej ${cleaner.full_name?.split(" ")[0] || ""}! Du har ett nytt bekräftat städuppdrag.</p>
<div style="background:#E1F5EE;border-radius:8px;padding:12px;margin:12px 0;font-size:14px;color:#0F6E56">
  <strong>✅ Automatiskt bekräftat</strong> — Kunden har fått bekräftelse. Du behöver inte göra något förrän uppdragsdagen.
</div>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">${earning} kr</span></div>
  ${booking.key_info ? `<div class="row"><span class="lbl">Tillträde</span><span class="val">🔑 ${esc(booking.key_info)}</span></div>` : ''}
  ${booking.notes && booking.notes.includes('🐾') ? `<div class="row"><span class="lbl">Husdjur</span><span class="val">🐾 Husdjur hemma</span></div>` : ''}
</div>
${booking.notes ? `<div style="background:#F0F9FF;border-radius:8px;padding:12px;margin:12px 0;font-size:14px;color:#1E40AF"><strong>📝 Kundens önskemål:</strong> ${esc(booking.notes)}</div>` : ''}
${matInfo.emoji === "🧰" ? `<div style="background:#FEF3C7;border:2px solid #FCD34D;border-radius:8px;padding:14px;margin:12px 0;font-size:14px;color:#92400E"><strong>${matInfo.cleaner}</strong></div>` : `<div style="background:#F0FDF4;border-radius:8px;padding:12px;margin:12px 0;font-size:13px;color:#166534">${matInfo.emoji} ${matInfo.cleaner}</div>`}
<p>Kan du inte genomföra uppdraget? Avboka senast 24h innan i dashboarden eller kontakta <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
<a href="https://spick.se/portal" class="btn">Öppna dashboard →</a>
`)
        : wrap(`
<h2>Nytt uppdrag tilldelat! 🧹</h2>
<p>Hej ${cleaner.full_name?.split(" ")[0] || ""}! Du har fått ett nytt städuppdrag.</p>
<div style="background:#FEF3C7;border-radius:8px;padding:12px;margin:12px 0;font-size:14px;color:#92400E">
  <strong>⏰ Bekräfta inom 90 minuter</strong> — Kunden väntar på ditt svar. Logga in på dashboarden för att acceptera eller avvisa uppdraget.
</div>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${service} · ${hours}h</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${date}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">${time}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${address}</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">${earning} kr</span></div>
  ${booking.key_info ? `<div class="row"><span class="lbl">Tillträde</span><span class="val">🔑 ${esc(booking.key_info)}</span></div>` : ''}
  ${booking.notes && booking.notes.includes('🐾') ? `<div class="row"><span class="lbl">Husdjur</span><span class="val">🐾 Husdjur hemma</span></div>` : ''}
</div>
${booking.notes ? `<div style="background:#F0F9FF;border-radius:8px;padding:12px;margin:12px 0;font-size:14px;color:#1E40AF"><strong>📝 Kundens önskemål:</strong> ${esc(booking.notes)}</div>` : ''}
${matInfo.emoji === "🧰" ? `<div style="background:#FEF3C7;border:2px solid #FCD34D;border-radius:8px;padding:14px;margin:12px 0;font-size:14px;color:#92400E"><strong>${matInfo.cleaner}</strong></div>` : `<div style="background:#F0FDF4;border-radius:8px;padding:12px;margin:12px 0;font-size:13px;color:#166534">${matInfo.emoji} ${matInfo.cleaner}</div>`}
<p>⚠️ Kan du inte genomföra uppdraget? Hör av dig omgående till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> så vi kan omfördela.</p>
<a href="https://spick.se/portal" class="btn">Öppna dashboard →</a>
`);
      await sendEmail(cleanerEmail,
        autoConfirm
          ? `Nytt bekräftat uppdrag: ${service} den ${date} ✅`
          : `Nytt uppdrag: ${service} den ${date} — bekräfta inom 90 min 🧹`,
        cleanerHtml);

      // Also notify company owner if cleaner belongs to a company
      if (cleaner.company_id) {
        const { data: owner } = await sb.from("cleaners").select("email, full_name").eq("company_id", cleaner.company_id).eq("is_company_owner", true).maybeSingle();
        if (owner?.email && owner.email !== cleanerEmail) {
          await sendEmail(owner.email, `Nytt uppdrag för ${cleaner.full_name}: ${service} den ${date} 🧹`, cleanerHtml);
        }
      }
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
  ${booking.key_info ? `<div class="row"><span class="lbl">Tillträde</span><span class="val">🔑 ${esc(booking.key_info)}</span></div>` : ''}
  ${booking.notes ? `<div class="row"><span class="lbl">Notering</span><span class="val">${esc(booking.notes)}</span></div>` : ''}
  <div class="row"><span class="lbl">Belopp</span><span class="val">${price}${rutNote}</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${cleaner ? cleaner.full_name : "⚠️ EJ TILLDELAD"}</span></div>
  <div class="row"><span class="lbl">Status</span><span class="val">${autoConfirm ? "✅ Auto-bekräftad (erfaren)" : "⏳ Väntar på städarens svar (90 min)"}</span></div>
  <div class="row"><span class="lbl">Stripe Session</span><span class="val" style="font-size:11px">${stripeSessionId}</span></div>
</div>
${!cleaner ? `<div style="background:#FFF5E5;border-left:4px solid #F59E0B;padding:12px;border-radius:0 8px 8px 0;margin:8px 0"><strong>⚠️ Ingen städare tilldelad!</strong> Tilldela manuellt i admin-panelen.</div>` : ""}
<a href="https://spick.se/admin.html" class="btn">Admin-panel →</a>
`);
  await sendEmail(ADMIN, `💰 Ny bokning: ${esc(name)} – ${price} – ${date}`, adminHtml);
  // Fas 10: parallell webhook-alert
  await sendAdminAlert({
    severity: "info",
    title: `Ny bokning: ${name}`,
    source: "stripe-webhook",
    booking_id: booking.id,
    cleaner_id: cleaner?.id || undefined,
    metadata: {
      price,
      service,
      date,
      auto_confirmed: autoConfirm,
      cleaner_assigned: !!cleaner,
      stripe_session: stripeSessionId,
    },
  });

  // RUT-ansökan flyttad till Fas 7.5 (2026-04-23).
  // Tidigare trigger bruten: kolumnmismatch + fel XML-matematik +
  // saknad timing-guard. Se docs/audits/2026-04-23-rut-infrastructure-
  // decision.md för fullständig analys.

  // ── 5. (Tidigare: Generera kundkvitto) ─────────────────────
  // Fas 2.5-R2 (2026-04-23): Flyttat till synkront anrop i steg 1 ovan.
  // generate-receipt skickar nu kvittomejl + bekräftelse som ett enda
  // mejl till kund, med idempotens-skydd (receipt_email_sent_at).
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

  // Fas 6.3: logga refund_issued (stripe-webhook-initiated refund,
  // särskiljs från noshow-refund EF via initiated_by-metadata)
  await logBookingEvent(sb, booking.id, "refund_issued", {
    actorType: "system",
    metadata: {
      amount_sek: Math.round(refundAmount),
      stripe_charge_id: (charge.id as string) || null,
      stripe_payment_intent_id: paymentIntentId,
      initiated_by: "stripe-webhook",
      reason: "stripe_refund",
    },
  });

  // Fas 8 §8.7/§8.14: om booking är i resolved_full_refund (efter
  // dispute-admin-decide full_refund), transitionera till refunded.
  // Legacy-bokningar (escrow_state='released_legacy') eller andra
  // states skippas — bara dispute-driven refunds triggar state-change.
  if (booking.escrow_state === "resolved_full_refund") {
    try {
      const transRes = await fetch(`${SUPABASE_URL}/functions/v1/escrow-state-transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": Deno.env.get("INTERNAL_EF_SECRET") || "",
        },
        body: JSON.stringify({
          booking_id: booking.id,
          action: "transfer_full_refund",
          triggered_by: "system_webhook",
          metadata: {
            stripe_charge_id: (charge.id as string) || null,
            stripe_payment_intent_id: paymentIntentId,
            amount_refunded_sek: Math.round(refundAmount),
          },
        }),
      });
      if (!transRes.ok) {
        console.warn("[SPICK] escrow-state-transition after refund failed:", {
          booking_id: booking.id,
          status: transRes.status,
        });
      }
    } catch (e) {
      console.warn("[SPICK] escrow-state-transition exception:", (e as Error).message);
    }
  }
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
  // Fas 10: parallell webhook-alert
  await sendAdminAlert({
    severity: "info",
    title: `Refund: ${booking.customer_name}`,
    source: "stripe-webhook",
    booking_id: booking.id,
    metadata: {
      refund_sek: Math.round(refundAmount),
      booking_date: booking.booking_date,
    },
  });
}

// ── Huvud-handler ──────────────────────────────────────────────────────────

// ── FÅNGA BETALNING (escrow → faktisk debitering) ─────────────────────────
async function capturePayment(bookingId: string) {
  const stripeKey = await resolveStripeKeyFromFlag();
  const { data: booking } = await sb.from("bookings")
    .select("payment_intent_id,total_price,customer_email,service_type")
    .eq("id", bookingId).single();
  
  if (!booking?.payment_intent_id) return;

  // Capture payment via Stripe API
  // R3 (§13.3): idempotency-key förhindrar dubbel capture om webhook retry:as
  const idempotencyKey = `capture-${bookingId}`;
  const captureRes = await fetch(
    `https://api.stripe.com/v1/payment_intents/${booking.payment_intent_id}/capture`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": idempotencyKey,
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

// ── Subscription setup (kort-registrering) ────────────────────────────────
async function handleSubscriptionSetup(session: Record<string, unknown>, stripeKey: string = STRIPE_SECRET_KEY) {
  const metadata = session.metadata as Record<string, string>;
  const subscriptionId = metadata?.subscription_id;
  const customerEmail = metadata?.customer_email;
  const stripeCustomerId = session.customer as string;
  const setupIntentId = session.setup_intent as string;

  if (!subscriptionId || !setupIntentId) {
    console.error("[SPICK] Missing subscription_id or setup_intent");
    return;
  }

  // Hämta SetupIntent → PaymentMethod
  const siRes = await fetch(`https://api.stripe.com/v1/setup_intents/${setupIntentId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const setupIntent = await siRes.json();
  const paymentMethodId = setupIntent.payment_method;

  // Hämta kort-detaljer
  const pmRes = await fetch(`https://api.stripe.com/v1/payment_methods/${paymentMethodId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const pm = await pmRes.json();

  // Sätt default payment method på Stripe Customer
  await fetch(`https://api.stripe.com/v1/customers/${stripeCustomerId}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      "invoice_settings[default_payment_method]": paymentMethodId,
    }).toString(),
  });

  // Uppdatera customer_profiles
  if (customerEmail) {
    await sb.from("customer_profiles").upsert({
      email: customerEmail,
      stripe_customer_id: stripeCustomerId,
      default_payment_method_id: paymentMethodId,
      payment_method_last4: pm.card?.last4 || null,
      payment_method_brand: pm.card?.brand || null,
      payment_method_exp_month: pm.card?.exp_month || null,
      payment_method_exp_year: pm.card?.exp_year || null,
    }, { onConflict: "email" });
  }

  // Aktivera subscription
  await sb.from("subscriptions").update({
    status: "active",
    setup_completed_at: new Date().toISOString(),
    stripe_setup_intent_id: setupIntentId,
  }).eq("id", subscriptionId);

  // Skicka bekräftelsemejl
  try {
    const { data: sub } = await sb.from("subscriptions")
      .select("customer_name, service_type, booking_hours, frequency, next_booking_date")
      .eq("id", subscriptionId).single();

    if (sub && customerEmail) {
      const freqText = sub.frequency === "weekly" ? "varje vecka"
        : sub.frequency === "biweekly" ? "varannan vecka" : "varje månad";

      const emailHtml = wrap(`
        <h2>Prenumeration aktiverad! ✅</h2>
        <p>Hej ${esc((sub.customer_name || "").split(" ")[0])}!</p>
        <p>Ditt kort är registrerat och din prenumeration hos <strong>Spick</strong> är nu aktiv.</p>
        <p><strong>${esc(sub.service_type)}</strong> · ${sub.booking_hours} tim · ${freqText}</p>
        <p>Nästa städning: <strong>${sub.next_booking_date}</strong></p>
        <p style="font-size:13px;color:#6B6960;margin-top:16px">Ditt kort debiteras automatiskt dagen innan varje städtillfälle. Du kan avsluta prenumerationen när som helst genom att kontakta oss.</p>
      `);

      await sendEmail(customerEmail, "Prenumeration aktiverad — Spick", emailHtml);
    }
  } catch (e) { console.warn("[SPICK] Setup confirmation email failed:", e); }

  console.log("[SPICK] Subscription setup completed:", {
    subscriptionId,
    stripeCustomerId,
    paymentMethodId: paymentMethodId ? String(paymentMethodId).slice(-8) : null,
  });
}

// ── DISPUTE-HANTERING ──────────────────────────────────────────

async function findBookingByPaymentIntent(piId: string) {
  // Kolla BÅDA PI-kolumnerna (checkout vs subscription-charge)
  const { data: b1 } = await sb
    .from("bookings")
    .select("id, customer_name, customer_email, total_price, cleaner_id, booking_date")
    .eq("payment_intent_id", piId)
    .limit(1);
  if (b1 && b1.length > 0) return b1[0];

  const { data: b2 } = await sb
    .from("bookings")
    .select("id, customer_name, customer_email, total_price, cleaner_id, booking_date")
    .eq("stripe_payment_intent_id", piId)
    .limit(1);
  return b2?.[0] || null;
}

async function handleDisputeCreated(dispute: Record<string, unknown>) {
  const piId = dispute.payment_intent as string;
  if (!piId) { console.warn("[SPICK] No payment_intent in dispute"); return; }

  const booking = await findBookingByPaymentIntent(piId);
  if (!booking) {
    console.warn("[SPICK] No booking found for PI", piId);
    return;
  }

  const amountSek = Math.round((dispute.amount as number || 0) / 100);
  const reason = (dispute.reason as string) || "unknown";

  await sb.from("bookings").update({
    dispute_status: "pending",
    dispute_opened_at: new Date().toISOString(),
    dispute_amount_sek: amountSek,
    dispute_reason: reason,
  }).eq("id", booking.id);

  // §8.24-25 (2026-04-26): chargeback_events audit-trail
  try {
    await sb.from("chargeback_events").insert({
      booking_id: booking.id,
      stripe_dispute_id: dispute.id as string,
      stripe_charge_id: dispute.charge as string,
      stripe_payment_intent_id: piId,
      event_type: "created",
      payment_method: ((dispute.payment_method_details as Record<string, unknown>)?.type as string) || null,
      amount_ore: BigInt((dispute.amount as number) || 0).toString() as unknown as number,
      reason,
      status: dispute.status as string,
      evidence_due_by: dispute.evidence_details
        ? new Date(((dispute.evidence_details as Record<string, unknown>).due_by as number) * 1000).toISOString()
        : null,
      raw_event_jsonb: dispute,
    });
  } catch (e) {
    console.warn("[SPICK] chargeback_events insert failed:", (e as Error).message);
  }

  // Öka städarens tvist-räknare
  if (booking.cleaner_id) {
    try {
      const { data: cl } = await sb.from("cleaners")
        .select("disputes_count_total")
        .eq("id", booking.cleaner_id)
        .single();
      if (cl) {
        await sb.from("cleaners").update({
          disputes_count_total: (cl.disputes_count_total || 0) + 1
        }).eq("id", booking.cleaner_id);
      }
    } catch (e) { console.warn("[SPICK] Failed to update cleaner stats:", (e as Error).message); }
  }

  // Notifiera admin
  await sendEmail(ADMIN,
    `⚠️ Tvist öppnad: ${esc(booking.customer_name)} — ${amountSek} kr`,
    wrap(`
      <h2>Stripe-tvist öppnad ⚠️</h2>
      <p><strong>Kund:</strong> ${esc(booking.customer_name)}</p>
      <p><strong>Belopp:</strong> ${amountSek} kr</p>
      <p><strong>Orsak:</strong> ${esc(reason)}</p>
      <p><strong>Bokning:</strong> ${booking.booking_date} (${booking.id.slice(0,8)})</p>
      <p style="color:#DC2626;font-weight:600">Åtgärd krävs inom 7 dagar.</p>
      <p>Logga in på <a href="https://dashboard.stripe.com/disputes" style="color:#0F6E56">Stripe Dashboard</a> för att besvara tvisten.</p>
    `)
  );
  // Fas 10: parallell webhook-alert (dispute = critical, EU-deadline 7 dagar)
  await sendAdminAlert({
    severity: "critical",
    title: "Stripe dispute opened",
    source: "stripe-webhook",
    message: `Åtgärd krävs inom 7 dagar. Svara på dispute via Stripe Dashboard.`,
    booking_id: booking.id,
    cleaner_id: booking.cleaner_id || undefined,
    metadata: {
      customer: booking.customer_name,
      amount_sek: amountSek,
      reason,
      booking_date: booking.booking_date,
    },
  });

  console.log("[SPICK] Dispute created:", { bookingId: booking.id, amount: amountSek, reason });
}

async function handleDisputeClosed(dispute: Record<string, unknown>) {
  const piId = dispute.payment_intent as string;
  if (!piId) return;

  const booking = await findBookingByPaymentIntent(piId);
  if (!booking) return;

  const won = (dispute.status as string) === "won";
  const newStatus = won ? "won" : "lost";

  await sb.from("bookings").update({
    dispute_status: newStatus,
  }).eq("id", booking.id);

  // §8.24-25: chargeback_events audit-trail
  try {
    await sb.from("chargeback_events").insert({
      booking_id: booking.id,
      stripe_dispute_id: dispute.id as string,
      stripe_charge_id: dispute.charge as string,
      stripe_payment_intent_id: piId,
      event_type: won ? "won" : "lost",
      payment_method: ((dispute.payment_method_details as Record<string, unknown>)?.type as string) || null,
      amount_ore: BigInt((dispute.amount as number) || 0).toString() as unknown as number,
      reason: (dispute.reason as string) || null,
      status: dispute.status as string,
      raw_event_jsonb: dispute,
    });
  } catch (e) {
    console.warn("[SPICK] chargeback_events closed-insert failed:", (e as Error).message);
  }

  // Om förlorad: öka cleaner disputes_count_lost + clawback
  if (!won && booking.cleaner_id) {
    try {
      const { data: cl } = await sb.from("cleaners")
        .select("disputes_count_lost, clawback_balance_sek")
        .eq("id", booking.cleaner_id)
        .single();
      if (cl) {
        await sb.from("cleaners").update({
          disputes_count_lost: (cl.disputes_count_lost || 0) + 1,
          clawback_balance_sek: (cl.clawback_balance_sek || 0) + (booking.total_price || 0),
        }).eq("id", booking.cleaner_id);
      }
    } catch (e) { console.warn("[SPICK] Failed to update cleaner lost stats:", (e as Error).message); }
  }

  // Notifiera admin
  await sendEmail(ADMIN,
    `${won ? '✅ Tvist vunnen' : '❌ Tvist förlorad'}: ${esc(booking.customer_name)}`,
    wrap(`
      <h2>Tvist avslutad ${won ? '✅' : '❌'}</h2>
      <p><strong>Resultat:</strong> ${won ? 'Vunnen — pengarna behålls' : 'Förlorad — kunden får tillbaka pengarna'}</p>
      <p><strong>Kund:</strong> ${esc(booking.customer_name)}</p>
      <p><strong>Bokning:</strong> ${booking.booking_date} (${booking.id.slice(0,8)})</p>
      ${!won ? '<p style="color:#DC2626">Clawback: ' + (booking.total_price || 0) + ' kr tillagd på städarens balans.</p>' : ''}
    `)
  );
  // Fas 10: parallell webhook-alert (won=info, lost=warn pga clawback-impact)
  await sendAdminAlert({
    severity: won ? "info" : "warn",
    title: won ? "Dispute won" : "Dispute lost",
    source: "stripe-webhook",
    booking_id: booking.id,
    cleaner_id: booking.cleaner_id || undefined,
    metadata: {
      customer: booking.customer_name,
      result: won ? "won" : "lost",
      clawback_sek: !won ? (booking.total_price || 0) : 0,
      booking_date: booking.booking_date,
    },
  });

  console.log("[SPICK] Dispute closed:", { bookingId: booking.id, won, newStatus });
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

  let event: Record<string, unknown>;
  try { event = JSON.parse(body); } catch { return new Response("Bad JSON", { status: 400 }); }

  const eventId = event.id as string;
  // Dual-key: välj Stripe secret baserat på event.livemode (native flag)
  const stripeKey = stripeKeyForEvent(event);
  const isTestEvent = event.livemode === false;
  if (isTestEvent) {
    console.log(`[stripe-webhook] TEST event received: ${eventId} (${event.type})`);
  }

  // ── Mode-mismatch guard (hygien #21, defense-in-depth) ──────────────────
  // Stripe accepterar ibland test-keys i live-konto-konfiguration. Om
  // DB-flaggan säger live (stripe_test_mode=false) men event är test
  // (livemode=false) → reject. Förebygger cs_test_*-sessions i prod-DB.
  // Returnerar 200 så Stripe inte retryr (mismatch är permanent).
  const flagSaysTestMode = await getStripeTestModeFlag();
  if (flagSaysTestMode !== isTestEvent) {
    console.warn(
      `[stripe-webhook] BLOCKED mode-mismatch: ` +
      `flag=${flagSaysTestMode ? 'test' : 'live'} ` +
      `event=${isTestEvent ? 'test' : 'live'} ` +
      `eventId=${eventId} type=${event.type}`
    );
    return new Response("OK (blocked: mode mismatch)", { status: 200 });
  }

  if (eventId) {
    const isReal = await verifyEventWithStripe(eventId, stripeKey);
    if (!isReal) {
      console.error("Event verification failed:", eventId);
      return new Response("Unauthorized", { status: 401 });
    }
    console.log("Event verified via Stripe API:", eventId);
  }

  // ── IDEMPOTENCY: check before processing, insert after success ───────────
  if (eventId) {
    const { data: existing } = await sb
      .from("processed_webhook_events")
      .select("event_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existing) {
      console.log(`Skipping duplicate event: ${eventId} (${event.type})`);
      return new Response("Already processed", { status: 200 });
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handlePaymentSuccess(event.data.object as Record<string, unknown>, stripeKey);
        break;
      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Record<string, unknown>);
        break;
      case "charge.refunded":
        await handleRefund(event.data.object as Record<string, unknown>);
        break;
      case "charge.dispute.created":
        await handleDisputeCreated(event.data.object as Record<string, unknown>);
        break;
      case "charge.dispute.closed":
        await handleDisputeClosed(event.data.object as Record<string, unknown>);
        break;
      default:
        console.log("Unhandled event:", event.type);
    }

    if (eventId) {
      await sb.from("processed_webhook_events")
        .insert({ event_id: eventId, event_type: event.type as string });
    }

  } catch (e) {
    console.error("Webhook-fel:", e);
    return new Response("Internal Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
});

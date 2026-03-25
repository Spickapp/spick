import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ── Email-wrapper ──────────────────────────────────────────────────────────
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
.row:last-child{border:none;padding-top:12px}.row .lbl{color:#9B9B95}.row .val{font-weight:600;color:#1C1C1A}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}
.badge{display:inline-block;background:#E1F5EE;color:#0F6E56;padding:6px 14px;border-radius:100px;font-size:13px;font-weight:600;margin:8px 0}
.paid{background:#E1F5EE;border-radius:12px;padding:16px;text-align:center;margin:16px 0}
.paid-icon{font-size:2rem}.paid-text{font-weight:600;color:#0F6E56;font-size:16px}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">Spick</div></div>
  <div class="body">${content}</div>
  <div class="footer">Spick AB · 559402-4522 · hello@spick.se · spick.se</div>
</div></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
}

// ── Webhook handler ────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  // Verifiera signatur
  const valid = await verifyStripeSignature(body, sig, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error("Ogiltig Stripe-signatur");
    return new Response("Unauthorized", { status: 401 });
  }

  const event = JSON.parse(body);
  console.log("Stripe event:", event.type);

  // ── checkout.session.completed ──────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    const isRut = session.metadata?.rut === "true";
    const amountPaid = session.amount_total / 100; // öre → kr
    const customerEmail = session.customer_details?.email;
    const stripeSessionId = session.id;

    if (!bookingId) {
      console.error("Saknar booking_id i metadata");
      return new Response("OK", { status: 200 });
    }

    // Uppdatera bokning i Supabase
    const { data: booking, error } = await sb
      .from("bookings")
      .update({
        payment_status: "paid",
        payment_method: session.payment_method_types?.[0] || "card",
        stripe_session_id: stripeSessionId,
        stripe_payment_intent: session.payment_intent,
        paid_at: new Date().toISOString(),
        status: "bekräftad",
      })
      .eq("id", bookingId)
      .select()
      .single();

    if (error) {
      console.error("Supabase-uppdatering misslyckades:", error);
    }

    const b = booking || { id: bookingId, email: customerEmail };
    const name = b.name || b.customer_name || "Kund";
    const email = b.email || b.customer_email || customerEmail;
    const rutBadge = isRut ? `<div class="badge">✓ RUT-avdrag aktivt – du betalar ${amountPaid.toLocaleString("sv")} kr</div>` : "";

    // ── Mail till kund: betalningsbekräftelse ──────────────────
    if (email) {
      await sendEmail(email, `💳 Betalning mottagen – Spick bokning bekräftad!`, wrap(`
        <h2>Betalning mottagen! 🎉</h2>
        <p>Hej ${name.split(" ")[0]}! Vi har tagit emot din betalning och din bokning är nu helt bekräftad.</p>
        <div class="paid">
          <div class="paid-icon">✅</div>
          <div class="paid-text">${amountPaid.toLocaleString("sv")} kr betalt</div>
        </div>
        <div class="card">
          <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service || "Hemstädning"}</span></div>
          <div class="row"><span class="lbl">Datum</span><span class="val">${b.date || "–"} ${b.time ? "kl " + b.time : ""}</span></div>
          <div class="row"><span class="lbl">Adress</span><span class="val">${b.address || "–"}</span></div>
          <div class="row"><span class="lbl">Timmar</span><span class="val">${b.hours || 3} h</span></div>
          <div class="row"><span class="lbl">Betalt</span><span class="val" style="color:#0F6E56;font-size:18px">${amountPaid.toLocaleString("sv")} kr ✓</span></div>
        </div>
        ${rutBadge}
        <p style="font-size:13px;color:#9B9B95">En faktura skickas separat från Stripe. Gratis avbokning upp till 24h före.</p>
        <a class="btn" href="https://spick.se/min-bokning.html?email=${encodeURIComponent(email)}">Följ din bokning →</a>
      `));
    }

    // ── Automatisk RUT-ansökan till Skatteverket ──────────────
    if (isRut && bookingId) {
      fetch(`${SUPABASE_URL}/functions/v1/rut-claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ booking_id: bookingId }),
      }).catch((e) => console.error("RUT-anrop misslyckades:", e));
    }

    // ── Mail till admin: bekräftelse med betalning ─────────────
    await sendEmail(ADMIN, `💰 BETALD BOKNING: ${name} – ${b.service || ""} ${b.date || ""}`, wrap(`
      <h2>Bokning betald! 💰</h2>
      <div class="card">
        <div class="row"><span class="lbl">Kund</span><span class="val">${name}</span></div>
        <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
        <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service || "–"}</span></div>
        <div class="row"><span class="lbl">Datum/tid</span><span class="val">${b.date || "–"} ${b.time ? "kl " + b.time : ""}</span></div>
        <div class="row"><span class="lbl">Adress</span><span class="val">${b.address || "–"}</span></div>
        <div class="row"><span class="lbl">Betalt</span><span class="val" style="color:#0F6E56">${amountPaid.toLocaleString("sv")} kr ✓</span></div>
        <div class="row"><span class="lbl">Betalmetod</span><span class="val">${session.payment_method_types?.[0] || "–"}</span></div>
        <div class="row"><span class="lbl">RUT</span><span class="val">${isRut ? "✅ Ja" : "❌ Nej"}</span></div>
        <div class="row"><span class="lbl">Stripe session</span><span class="val" style="font-size:11px">${stripeSessionId}</span></div>
      </div>
      <a class="btn" href="https://spick.se/admin.html">Öppna admin →</a>
    `));
  }

  // ── checkout.session.expired (kund avbröt betalning) ────────
  else if (event.type === "checkout.session.expired") {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    if (bookingId) {
      await sb.from("bookings").update({ payment_status: "cancelled", status: "avbruten" }).eq("id", bookingId);
    }
  }

  // ── payment_intent.payment_failed ───────────────────────────
  else if (event.type === "payment_intent.payment_failed") {
    const pi = event.data.object;
    // Logga – Stripe skickar automatiskt retry-mail till kunden
    console.log("Betalning misslyckades:", pi.id);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" }
  });
});

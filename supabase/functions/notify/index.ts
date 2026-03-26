import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM  = "Spick <hello@spick.se>";
const ADMIN = "hello@spick.se";
const SUPA  = "https://urjeijcncsyuletprydy.supabase.co";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

// Spick branded email wrapper
function wrap(content: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>body{margin:0;padding:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.07)}
.header{background:#0F6E56;padding:24px 32px}
.logo{font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff}
.body{padding:32px}
.footer{padding:16px 32px;background:#F7F7F5;font-size:12px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:20px;color:#1C1C1A;margin:0 0 12px}
p{color:#6B6960;line-height:1.7;font-size:15px;margin:0 0 12px}
.card{background:#F7F7F5;border-radius:12px;padding:20px;margin:16px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}
.row:last-child{border:none;padding-top:12px}
.row .lbl{color:#9B9B95}.row .val{font-weight:600;color:#1C1C1A}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:15px;margin-top:8px}
.badge{display:inline-block;background:#E1F5EE;color:#0F6E56;padding:6px 14px;border-radius:100px;font-size:13px;font-weight:600}
</style></head><body>
<div class="wrap">
  <div class="header"><div class="logo">Spick</div></div>
  <div class="body">${content}</div>
  <div class="footer">Spick AB · 559402-4522 · hello@spick.se · spick.se</div>
</div></body></html>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html })
    });
    return res.ok;
  } catch { return false; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const payload = await req.json().catch(() => ({}));
  const type = payload.type || (payload.table === "bookings" ? "booking" : payload.table === "cleaner_applications" ? "application" : "unknown");
  const r = payload.record || payload;

  try {
    // ── BOKNING ───────────────────────────────────────────────
    if (type === "booking") {
      const name = r.name || r.customer_name || "kund";
      const email = r.email || r.customer_email;
      const price = r.total_price || r.price || 0;
      const rut = r.rut ? `<div class="badge">✓ RUT-avdrag aktivt – du betalar ${price.toLocaleString("sv")} kr</div>` : "";

      if (email) await sendEmail(email, `✅ Bokningsbekräftelse – ${r.service || "Städning"} ${r.date || ""}`, wrap(`
        <h2>Din bokning är bekräftad! 🎉</h2>
        <p>Hej ${name.split(" ")[0]}! Vi återkommer med bekräftelse och en tilldelad städare inom 2 timmar.</p>
        <div class="card">
          <div class="row"><span class="lbl">Tjänst</span><span class="val">${r.service || "Hemstädning"}</span></div>
          <div class="row"><span class="lbl">Datum</span><span class="val">${r.date || "–"} ${r.time ? "kl " + r.time : ""}</span></div>
          <div class="row"><span class="lbl">Adress</span><span class="val">${r.address || "–"}</span></div>
          <div class="row"><span class="lbl">Timmar</span><span class="val">${r.hours || 3} h</span></div>
          <div class="row"><span class="lbl">Du betalar</span><span class="val" style="color:#0F6E56;font-size:18px">${price.toLocaleString("sv")} kr</span></div>
        </div>
        ${rut}
        <p style="font-size:13px;color:#9B9B95;margin-top:16px">💳 Betala via Swish till städaren efter godkänd städning. Gratis avbokning upp till 24h före.</p>
        <a class="btn" href="https://spick.se/min-bokning.html?email=${encodeURIComponent(email || "")}">Följ din bokning →</a>
      `));

      await sendEmail(ADMIN, `🔔 NY BOKNING: ${name} – ${r.service || ""} ${r.date || ""}`, wrap(`
        <h2>Ny bokning inkommen!</h2>
        <div class="card">
          <div class="row"><span class="lbl">Kund</span><span class="val">${name}</span></div>
          <div class="row"><span class="lbl">Email</span><span class="val">${email}</span></div>
          <div class="row"><span class="lbl">Telefon</span><span class="val">${r.phone || r.customer_phone || "–"}</span></div>
          <div class="row"><span class="lbl">Tjänst</span><span class="val">${r.service || "–"}</span></div>
          <div class="row"><span class="lbl">Datum/tid</span><span class="val">${r.date || "–"} ${r.time ? "kl " + r.time : ""}</span></div>
          <div class="row"><span class="lbl">Adress</span><span class="val">${r.address || "–"}, ${r.city || ""}</span></div>
          <div class="row"><span class="lbl">Timmar</span><span class="val">${r.hours || 3} h</span></div>
          <div class="row"><span class="lbl">Pris</span><span class="val">${price.toLocaleString("sv")} kr</span></div>
          <div class="row"><span class="lbl">RUT</span><span class="val">${r.rut ? "✅ Ja" : "❌ Nej"}</span></div>
        </div>
        <a class="btn" href="https://spick.se/admin.html">Öppna admin →</a>
      `));
    }

    // ── NY BOKNING TILL STÄDARE ───────────────────────────────
    else if (type === "new_booking_cleaner") {
      const cleanerEmail = r.cleaner_email;
      const cname = r.cleaner_name || "Städare";
      if (cleanerEmail) {
        await sendEmail(cleanerEmail, `🔔 Ny bokningsbekräftelse – ${r.service || "Städning"} ${r.date || ""}`, wrap(`
          <h2>Du har fått en ny bekräftad bokning! 🎉</h2>
          <p>Hej ${cname.split(" ")[0]}! En kund har bekräftat en bokning hos dig.</p>
          <div class="card">
            <div class="row"><span class="lbl">Kund</span><span class="val">${r.name || "–"}</span></div>
            <div class="row"><span class="lbl">Tjänst</span><span class="val">${r.service || "Hemstädning"}</span></div>
            <div class="row"><span class="lbl">Datum/tid</span><span class="val">${r.date || "–"} ${r.time ? "kl " + r.time : ""}</span></div>
            <div class="row"><span class="lbl">Adress</span><span class="val">${r.address || "–"}, ${r.city || ""}</span></div>
            <div class="row"><span class="lbl">Timmar</span><span class="val">${r.hours || 3} h</span></div>
            <div class="row"><span class="lbl">Din ersättning</span><span class="val" style="color:#0F6E56;font-weight:700">${Math.round((r.total_price || 0) * 0.83).toLocaleString("sv")} kr</span></div>
          </div>
          <a class="btn" href="https://spick.se/stadare-dashboard.html">Visa i min dashboard →</a>
        `));
      }
    }

    // ── ANSÖKAN ───────────────────────────────────────────────
    else if (type === "application") {
      await sendEmail(ADMIN, `👷 Ny städaransökan: ${r.full_name || "okänd"} – ${r.city || ""}`, wrap(`
        <h2>Ny ansökan inkommen!</h2>
        <div class="card">
          <div class="row"><span class="lbl">Namn</span><span class="val">${r.full_name || "–"}</span></div>
          <div class="row"><span class="lbl">Email</span><span class="val">${r.email || "–"}</span></div>
          <div class="row"><span class="lbl">Telefon</span><span class="val">${r.phone || "–"}</span></div>
          <div class="row"><span class="lbl">Stad</span><span class="val">${r.city || "–"}</span></div>
          <div class="row"><span class="lbl">Tjänster</span><span class="val">${r.services || "–"}</span></div>
          <div class="row"><span class="lbl">F-skatt</span><span class="val">${r.has_fskatt ? "✅ Ja" : "❌ Nej"}</span></div>
        </div>
        <a class="btn" href="https://spick.se/admin.html">Granska ansökan →</a>
      `));
    }

    // ── VÄLKOMMEN STÄDARE ─────────────────────────────────────
    else if (type === "cleaner_approved") {
      await sendEmail(r.email, `🎉 Välkommen till Spick, ${r.full_name?.split(" ")[0]}!`, wrap(`
        <h2>Du är godkänd som städare! 🎉</h2>
        <p>Hej ${r.full_name?.split(" ")[0]}! Vi är glada att välkomna dig till Spick-teamet.</p>
        <div class="card">
          <div class="row"><span class="lbl">Ditt timpris</span><span class="val">${r.hourly_rate || 350} kr/h</span></div>
          <div class="row"><span class="lbl">Din andel</span><span class="val">83% (${Math.round((r.hourly_rate || 350) * 0.83)} kr/h)</span></div>
          <div class="row"><span class="lbl">Spick provision</span><span class="val">17%</span></div>
          <div class="row"><span class="lbl">Betalning</span><span class="val">10 bankdagar</span></div>
        </div>
        <p>Du visas nu på spick.se och kan ta emot bokningar. Logga in för att se dina uppdrag.</p>
        <a class="btn" href="https://spick.se/stadare-dashboard.html">Gå till min dashboard →</a>
      `));
    }

    // ── PÅMINNELSE ────────────────────────────────────────────
    else if (type === "reminder") {
      const email = r.email || r.customer_email;
      if (email) await sendEmail(email, `⏰ Påminnelse: Städning imorgon kl ${r.time || "–"}`, wrap(`
        <h2>Påminnelse om din städning 🧹</h2>
        <p>Hej ${(r.name || r.customer_name || "").split(" ")[0]}! Din städning är imorgon.</p>
        <div class="card">
          <div class="row"><span class="lbl">Datum</span><span class="val">${r.date || "Imorgon"} kl ${r.time || "–"}</span></div>
          <div class="row"><span class="lbl">Adress</span><span class="val">${r.address || "–"}</span></div>
          <div class="row"><span class="lbl">Tjänst</span><span class="val">${r.service || "Hemstädning"}</span></div>
        </div>
        <p style="font-size:13px;color:#9B9B95">Behöver du avboka? Det är gratis upp till 24h före.</p>
        <a class="btn" href="https://spick.se/min-bokning.html">Hantera bokning →</a>
      `));
    }

    // ── BETYGSFÖRFRÅGAN ───────────────────────────────────────
    else if (type === "review_request") {
      const email = r.email || r.customer_email;
      if (email) await sendEmail(email, "⭐ Hur gick städningen? Lämna ett betyg!", wrap(`
        <h2>Hur gick städningen? ⭐</h2>
        <p>Hej ${(r.name || r.customer_name || "").split(" ")[0]}! Vi hoppas du är nöjd med din städning.</p>
        <p>Ditt betyg hjälper andra kunder att välja rätt städare – och motiverar dina städare att hålla hög kvalitet.</p>
        <a class="btn" href="https://spick.se/betyg.html?bid=${r.id}&cname=${encodeURIComponent(r.cleaner_name || "")}">Lämna betyg →</a>
        <p style="font-size:13px;color:#9B9B95;margin-top:16px">Tar bara 30 sekunder. Tack!</p>
      `));
    }

    // ── VÄNTELISTA ────────────────────────────────────────────
    else if (type === "waitlist") {
      await sendEmail(ADMIN, `🗺️ Väntelista ${r.city}: ${r.email}`, wrap(`
        <h2>Ny väntelisteanmälan</h2>
        <div class="card">
          <div class="row"><span class="lbl">Stad</span><span class="val">${r.city || "–"}</span></div>
          <div class="row"><span class="lbl">Email</span><span class="val">${r.email || "–"}</span></div>
        </div>
      `));
    }

    // ── NÖJDHETSGARANTI ───────────────────────────────────────
    else if (type === "guarantee") {
      await sendEmail(ADMIN, `🛡️ Garantiärende: ${r.customer_email} – Betyg ${r.rating}★`, wrap(`
        <h2>Nytt garantiärende!</h2>
        <div class="card">
          <div class="row"><span class="lbl">Kund</span><span class="val">${r.customer_name || r.customer_email}</span></div>
          <div class="row"><span class="lbl">Betyg</span><span class="val">${r.rating}★</span></div>
          <div class="row"><span class="lbl">Kommentar</span><span class="val">${r.comment || "–"}</span></div>
        </div>
        <a class="btn" href="https://spick.se/admin.html">Hantera ärende →</a>
      `));
    }

    // ── UPTIME / SSL / RAPPORT ────────────────────────────────
    else if (type === "uptime_alert") {
      await sendEmail(ADMIN, "🚨 LARM: spick.se är nere!", wrap(`
        <h2>⚠️ Spick.se svarar inte!</h2>
        <p>${r.message || "Hemsidan verkar vara nere."}</p>
        <p>Tid: ${new Date().toLocaleString("sv-SE")}</p>
        <a class="btn" href="https://spick.se">Kontrollera →</a>
      `));
    }
    else if (type === "weekly_report") {
      await sendEmail(ADMIN, "📊 Spick Veckorapport", wrap(`
        <h2>Veckorapport 📊</h2>
        <div class="card">
          <div class="row"><span class="lbl">Bokningar</span><span class="val">${r.bookings || 0}</span></div>
          <div class="row"><span class="lbl">Aktiva städare</span><span class="val">${r.cleaners || 0}</span></div>
          <div class="row"><span class="lbl">Est. intäkt</span><span class="val">${((r.bookings || 0) * 178).toLocaleString("sv")} kr</span></div>
        </div>
        <a class="btn" href="https://spick.se/admin.html">Öppna admin →</a>
      `));
    }
    else if (type === "customer_report") {
      const r = payload.record || {};
      subject = `⚠️ Kundrapport från ${r.cleaner_name || "städare"}`;
      html = wrap(`
<h2>⚠️ Kund rapporterad</h2>
<div class="card">
  <div class="row"><span class="lbl">Städare</span><span class="val">${r.cleaner_name || "–"}</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${r.customer_email || "–"}</span></div>
  <div class="row"><span class="lbl">Boknings-ID</span><span class="val">${r.booking_id || "–"}</span></div>
  <div class="row"><span class="lbl">Orsak</span><span class="val">${r.reason || "–"}</span></div>
</div>
<p style="color:#92400E">Utred och vidta åtgärd om nödvändigt (varning/blockering).</p>
<a href="https://spick.se/admin.html" class="btn">Öppna admin →</a>
`);
      to = ADMIN;
    }
    else if (type === "cleaner_arrived") {
      const r = payload.record || {};
      subject = `✅ ${r.cleaner_name || "Din städare"} har anlänt – städningen startar!`;
      html = wrap(`
<h2>Din städare är på plats! 🌿</h2>
<p><strong>${r.cleaner_name || "Din städare"}</strong> checkade in kl. ${r.time || "nu"}.</p>
<div class="card">
  <p style="margin:0;font-size:14px;color:#6B6960">Städningen är igång. Du får ett mail när den är klar och redo att godkännas.</p>
</div>
<a href="https://spick.se/garanti.html" style="display:block;text-align:center;margin-top:12px;color:#6B6960;font-size:13px">Inte hemma? Se vad som ingår i städningen →</a>
`);
      const { data: bk } = await sb.from("bookings").select("customer_email,email").eq("id", r.booking_id).single();
      if (bk) to = bk.customer_email || bk.email || ADMIN;
    }
        else if (type === "sos_alert") {
      const r = payload.record || {};
      subject = `🆘 SOS NÖDLARM – ${r.cleaner_name || "Städare"} behöver hjälp!`;
      html = wrap(`
<div style="background:#FEE2E2;border-radius:12px;padding:20px;margin-bottom:20px;border:2px solid #DC2626">
  <h2 style="color:#DC2626;margin:0">🆘 NÖDLARM AKTIVERAT</h2>
</div>
<div class="card">
  <div class="row"><span class="lbl">Städare</span><span class="val">${r.cleaner_name || "–"}</span></div>
  <div class="row"><span class="lbl">Telefon</span><span class="val">${r.cleaner_phone || "–"}</span></div>
  <div class="row"><span class="lbl">Email</span><span class="val">${r.cleaner_email || "–"}</span></div>
  <div class="row"><span class="lbl">Kontakttyp</span><span class="val">${r.contact_type === 'ring' ? '📞 Ber om samtal' : '💬 SMS-kontakt'}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${r.address || "–"}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">${new Date(r.timestamp || Date.now()).toLocaleString('sv-SE')}</span></div>
</div>
<p style="color:#DC2626;font-weight:700;font-size:16px">Kontakta städaren OMEDELBART!</p>
`);
      to = ADMIN;
    }
    else if (type === "job_completed") {
      const r = payload.record || {};
      subject = `✅ Städningen är klar – betygsätt din städare!`;
      html = wrap(`
<h2>Städningen är klar! 🌿</h2>
<p><strong>${r.cleaner_name || "Din städare"}</strong> har markerat städningen som klar.</p>
<div class="card">
  <p style="margin:0;font-size:14px;color:#6B6960">Betalningen frigörs automatiskt. Är du inte nöjd? Kontakta oss inom 24h så aktiverar vi garantin.</p>
</div>
<a href="https://spick.se/betygsatt.html?bid=${r.booking_id || ''}" class="btn">⭐ Betygsätt städningen →</a>
<a href="https://spick.se/garanti.html" style="display:block;text-align:center;margin-top:12px;color:#DC2626;font-size:13px">Inte nöjd? Aktivera garantin →</a>
`);
      const { data: bk } = await sb.from("bookings").select("customer_email,email").eq("id", r.booking_id).single();
      if (bk) to = bk.customer_email || bk.email || ADMIN;
    }
    else if (type === "cleaner_accepted") {
      const r = payload.record || {};
      subject = `✅ Städare bekräftad – ${r.cleaner_name || "din städare"} är på väg!`;
      html = wrap(`
<h2>Din städare är bekräftad! 🌿</h2>
<p>Goda nyheter – <strong>${r.cleaner_name || "din städare"}</strong> (⭐ ${r.cleaner_rating || "5.0"}) har accepterat ditt uppdrag.</p>
<div class="card">
  <p style="margin:0;font-size:14px;color:#6B6960">Du får en påminnelse 24h innan städningen. Städaren anländer på bokad tid.</p>
</div>
<a href="https://spick.se/mitt-konto.html" class="btn">Visa min bokning →</a>
`);
      // Skicka till kunden – hämta email från booking
      const { data: bk } = await sb.from("bookings").select("customer_email,email").eq("id", r.booking_id).single();
      if (bk) to = bk.customer_email || bk.email || ADMIN;
    }
    else if (type === "booking_cancelled") {
      const r = payload.record || {};
      subject = `❌ Bokning avbokad – ${r.booking_id || ""}`;
      html = wrap(`
<h2>Bokning avbokad av kund</h2>
<div class="card">
  <div class="row"><span class="lbl">Boknings-ID</span><span class="val">${r.booking_id || "–"}</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${r.email || "–"}</span></div>
  <div class="row"><span class="lbl">Tidpunkt</span><span class="val">${new Date().toLocaleString("sv-SE")}</span></div>
</div>
<a href="https://spick.se/admin.html" class="btn">Öppna admin →</a>
`);
      to = ADMIN;
    }
    else if (type === "garanti_reklamation") {
      const r = payload.record || {};
      subject = `🔴 Garantireklamation – ${r.name || "Kund"}`;
      html = wrap(`
<h2>Ny garantireklamation!</h2>
<div class="card">
  <div class="row"><span class="lbl">Namn</span><span class="val">${r.name || "–"}</span></div>
  <div class="row"><span class="lbl">Email</span><span class="val">${r.email || "–"}</span></div>
  <div class="row"><span class="lbl">Bokning</span><span class="val">${r.booking || "–"}</span></div>
  <div class="row"><span class="lbl">Kontaktsätt</span><span class="val">${r.contact || "–"}</span></div>
</div>
<h3>Beskrivning:</h3>
<p>${r.desc || "–"}</p>
<a href="https://spick.se/admin.html" class="btn">Öppna admin →</a>
`);
      to = ADMIN;
    }
    else if (type === "contact") {
      await sendEmail(ADMIN, `📬 Kontakt: ${r.subject || "Meddelande"} – ${r.name || ""}`, wrap(`
        <h2>Nytt kontaktmeddelande</h2>
        <div class="card">
          <div class="row"><span class="lbl">Namn</span><span class="val">${r.name || "–"}</span></div>
          <div class="row"><span class="lbl">Email</span><span class="val">${r.email || "–"}</span></div>
          <div class="row"><span class="lbl">Ämne</span><span class="val">${r.subject || "–"}</span></div>
          <div class="row"><span class="lbl">Meddelande</span><span class="val">${r.message || "–"}</span></div>
        </div>
      `));
    }

    else if (type === "ssl_warning") {
      await sendEmail(ADMIN, "🔒 SSL-certifikat snart utgånget!", wrap(`
        <h2>SSL-varning</h2>
        <p>Certifikatet för spick.se går ut om <b>${r.days_left} dagar</b>!</p>
        <p>Förnya via Loopia Kundzon → spick.se → SSL.</p>
      `));
    }

    return new Response(JSON.stringify({ ok: true, type }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});


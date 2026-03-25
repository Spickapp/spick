import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Spick <hello@spick.se>";
const ADMIN = "hello@spick.se";

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
  return res.ok;
}

serve(async (req) => {
  const payload = await req.json().catch(() => ({}));
  const type = payload.type || (payload.table === "bookings" ? "booking" : payload.table === "cleaner_applications" ? "application" : "unknown");
  const record = payload.record || payload;

  try {
    if (type === "booking" || payload.table === "bookings") {
      const b = record;
      // Mail till kund
      await sendEmail(b.customer_email || ADMIN, "✅ Bokningsbekräftelse – Spick", `
        <h2>Tack för din bokning!</h2>
        <p>Hej ${b.customer_name || "kund"}!</p>
        <p>Vi bekräftar din städning:</p>
        <ul>
          <li><b>Datum:</b> ${b.booking_date || "Bekräftas"}</li>
          <li><b>Adress:</b> ${b.address || "Se detaljer"}</li>
          <li><b>Pris:</b> ${b.price ? b.price + " kr" : "Enligt offert"}</li>
        </ul>
        <p>Vi hör av oss inom kort. Tack för att du väljer Spick! 🧹</p>
      `);
      // Notis till admin
      await sendEmail(ADMIN, "🔔 Ny bokning!", `
        <h2>Ny bokning inkom!</h2>
        <p><b>Kund:</b> ${b.customer_name} (${b.customer_email})</p>
        <p><b>Telefon:</b> ${b.customer_phone || "-"}</p>
        <p><b>Adress:</b> ${b.address || "-"}</p>
        <p><b>Datum:</b> ${b.booking_date || "-"}</p>
        <p><b>Pris:</b> ${b.price ? b.price + " kr" : "-"}</p>
        <p><a href="https://spick.se/admin.html">👉 Öppna admin</a></p>
      `);
    }
    
    else if (type === "application" || payload.table === "cleaner_applications") {
      const a = record;
      await sendEmail(ADMIN, "👷 Ny städaransökan!", `
        <h2>Ny ansökan från ${a.full_name || "okänd"}!</h2>
        <p><b>Namn:</b> ${a.full_name}</p>
        <p><b>Email:</b> ${a.email}</p>
        <p><b>Telefon:</b> ${a.phone || "-"}</p>
        <p><b>Stad:</b> ${a.city || "-"}</p>
        <p><b>Erfarenhet:</b> ${a.experience || "-"}</p>
        <p><a href="https://spick.se/admin.html">👉 Granska ansökan</a></p>
      `);
    }

    else if (type === "uptime_alert") {
      await sendEmail(ADMIN, "🚨 LARM: spick.se är nere!", `
        <h2>⚠️ Spick.se svarar inte!</h2>
        <p>${record.message || "Hemsidan verkar vara nere."}</p>
        <p>Kontrollera: <a href="https://spick.se">spick.se</a></p>
        <p>Tid: ${new Date().toLocaleString("sv-SE")}</p>
      `);
    }

    else if (type === "weekly_report") {
      await sendEmail(ADMIN, "📊 Spick Veckorapport", `
        <h2>📊 Veckorapport</h2>
        <p><b>Vecka:</b> ${record.week || "-"}</p>
        <hr>
        <table style="font-size:18px">
          <tr><td>📅 Bokningar denna vecka:</td><td><b>${record.bookings || 0}</b></td></tr>
          <tr><td>👷 Aktiva städare:</td><td><b>${record.cleaners || 0}</b></td></tr>
          <tr><td>💰 Est. intäkt:</td><td><b>${(record.bookings || 0) * 178} kr</b></td></tr>
        </table>
        <p><a href="https://spick.se/admin.html">👉 Öppna admin</a></p>
      `);
    }

    else if (type === "ssl_warning") {
      await sendEmail(ADMIN, "🔒 SSL-certifikat snart utgånget!", `
        <h2>SSL-certifikat varning</h2>
        <p>Certifikatet för spick.se går ut om <b>${record.days_left} dagar</b>!</p>
        <p>Förnya via Loopia Kundzon → spick.se → SSL.</p>
      `);
    }

    return new Response(JSON.stringify({ ok: true, type }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
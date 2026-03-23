// Supabase Edge Function – email notifications
// Placera denna fil i: supabase/functions/notify/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const ADMIN_EMAIL = "hello@spick.se";

serve(async (req) => {
  const { type, record } = await req.json();

  let subject = "";
  let html = "";

  if (type === "booking") {
    subject = `⭐ Ny bokning – ${record.name}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0F6E56;padding:2rem;border-radius:12px 12px 0 0;">
          <h1 style="color:#E1F5EE;margin:0;font-size:1.5rem;">Ny bokning!</h1>
        </div>
        <div style="background:#F7F7F5;padding:2rem;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Kund</td><td style="padding:8px 0;font-weight:600;">${record.name}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">E-post</td><td style="padding:8px 0;">${record.email}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Telefon</td><td style="padding:8px 0;">${record.phone}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Tjänst</td><td style="padding:8px 0;">${record.service}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Datum</td><td style="padding:8px 0;">${record.date} kl ${record.time}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Timmar</td><td style="padding:8px 0;">${record.hours}h</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Adress</td><td style="padding:8px 0;">${record.address}, ${record.city}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">RUT</td><td style="padding:8px 0;">${record.rut ? "✅ Ja" : "Nej"}</td></tr>
            ${record.message ? `<tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Meddelande</td><td style="padding:8px 0;">${record.message}</td></tr>` : ""}
          </table>
          <div style="margin-top:1.5rem;">
            <a href="https://spick.se/admin.html" style="background:#0F6E56;color:white;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;">
              Hantera i admin →
            </a>
          </div>
        </div>
      </div>`;
  }

  if (type === "cleaner") {
    subject = `👷 Ny städaransökan – ${record.name}`;
    html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#0E0E0E;padding:2rem;border-radius:12px 12px 0 0;">
          <h1 style="color:#9FE1CB;margin:0;font-size:1.5rem;">Ny städaransökan!</h1>
        </div>
        <div style="background:#F7F7F5;padding:2rem;border-radius:0 0 12px 12px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Namn</td><td style="padding:8px 0;font-weight:600;">${record.name}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">E-post</td><td style="padding:8px 0;">${record.email}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Telefon</td><td style="padding:8px 0;">${record.phone}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Stad</td><td style="padding:8px 0;">${record.city}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Erfarenhet</td><td style="padding:8px 0;">${record.experience}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Tjänster</td><td style="padding:8px 0;">${record.services}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">F-skatt</td><td style="padding:8px 0;">${record.has_fskatt ? "✅ Ja" : "❌ Nej"}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Försäkring</td><td style="padding:8px 0;">${record.has_insurance ? "✅ Ja" : "❌ Nej"}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Nyckelrutin</td><td style="padding:8px 0;">${record.accepts_keys ? "✅ Godkänd" : "❌ Ej godkänd"}</td></tr>
            ${record.message ? `<tr><td style="padding:8px 0;color:#6B6960;font-size:14px;">Meddelande</td><td style="padding:8px 0;">${record.message}</td></tr>` : ""}
          </table>
          <div style="margin-top:1.5rem;">
            <a href="https://spick.se/admin.html" style="background:#0E0E0E;color:#9FE1CB;padding:12px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;">
              Hantera i admin →
            </a>
          </div>
        </div>
      </div>`;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "Spick <noreply@spick.se>",
      to: ADMIN_EMAIL,
      subject,
      html,
    }),
  });

  return new Response(JSON.stringify({ ok: res.ok }), {
    headers: { "Content-Type": "application/json" },
  });
});

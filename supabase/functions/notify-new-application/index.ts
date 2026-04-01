import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Spick <hello@spick.se>";
const ADMIN = "hello@spick.se";

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  try {
    const { record } = await req.json();
    const name = record?.name || record?.full_name || "Okänd";
    const email = record?.email || "–";
    const phone = record?.phone || "–";
    const city = record?.city || "–";
    const services = record?.services || "–";

    const html = `<div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E8E8E4">
      <div style="background:#0F6E56;padding:20px;text-align:center"><span style="font-family:serif;font-size:1.3rem;font-weight:700;color:#fff">Spick</span></div>
      <div style="padding:28px 24px">
        <h2 style="font-size:1.1rem;margin:0 0 16px">📋 Ny städaransökan!</h2>
        <table style="width:100%;font-size:.9rem;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#6B6960;border-bottom:1px solid #E8E8E4;width:100px">Namn</td><td style="padding:8px 0;font-weight:600;border-bottom:1px solid #E8E8E4">${esc(name)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B6960;border-bottom:1px solid #E8E8E4">E-post</td><td style="padding:8px 0;border-bottom:1px solid #E8E8E4"><a href="mailto:${esc(email)}" style="color:#0F6E56">${esc(email)}</a></td></tr>
          <tr><td style="padding:8px 0;color:#6B6960;border-bottom:1px solid #E8E8E4">Telefon</td><td style="padding:8px 0;border-bottom:1px solid #E8E8E4">${esc(phone)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B6960;border-bottom:1px solid #E8E8E4">Stad</td><td style="padding:8px 0;border-bottom:1px solid #E8E8E4">${esc(city)}</td></tr>
          <tr><td style="padding:8px 0;color:#6B6960">Tjänster</td><td style="padding:8px 0">${esc(services)}</td></tr>
        </table>
        <a href="https://spick.se/admin.html#applications" style="display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin:20px 0 0">Granska i admin →</a>
      </div>
      <div style="background:#F7F7F5;padding:16px 24px;text-align:center;font-size:12px;color:#6B6960">Automatiskt meddelande från Spick</div>
    </div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: ADMIN, subject: `📋 Ny ansökan: ${name} (${city})`, html })
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (e) {
    console.error("notify-new-application error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});

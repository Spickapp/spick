import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM = "Spick <hello@spick.se>";

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
  return res.ok;
}

function wrap(content: string): string {
  return `<div style="font-family:'DM Sans',Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E8E8E4">
    <div style="background:#0F6E56;padding:20px;text-align:center"><span style="font-family:serif;font-size:1.3rem;font-weight:700;color:#fff">Spick</span></div>
    <div style="padding:28px 24px">${content}</div>
    <div style="background:#F7F7F5;padding:16px 24px;text-align:center;font-size:12px;color:#6B6960">Spick · hello@spick.se</div>
  </div>`;
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const CRON = Deno.env.get("CRON_SECRET");
  const SKEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!(CRON && token === CRON) && !(SKEY && token === SKEY)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: stuckApplied } = await sb.from("cleaner_applications")
      .select("id, name, email, onboarding_phase, created_at")
      .eq("status", "pending")
      .or("onboarding_phase.is.null,onboarding_phase.eq.applied")
      .lt("created_at", twoDaysAgo)
      .limit(20);

    const { data: stuckRegistering } = await sb.from("cleaner_applications")
      .select("id, name, email, onboarding_phase, updated_at")
      .eq("onboarding_phase", "registering")
      .lt("updated_at", sevenDaysAgo)
      .limit(20);

    let sent = 0;

    for (const app of (stuckApplied || [])) {
      if (!app.email) continue;
      const name = app.name?.split(" ")[0] || "du";
      await sendEmail(app.email,
        name + ", vi hjalper dig komma igang!",
        wrap('<h2 style="font-size:1.1rem;margin:0 0 12px">Hej ' + name + '!</h2><p style="color:#6B6960;line-height:1.6">Vi sag att du ansokte om att bli stadare men inte kommit vidare. Registrera enskild firma pa verksamt.se — det tar 10 min och ar gratis.</p><a href="https://spick.se/registrera-firma.html" style="display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin:16px 0">Registrera firma →</a>')
      );
      sent++;
    }

    for (const app of (stuckRegistering || [])) {
      if (!app.email) continue;
      const name = app.name?.split(" ")[0] || "du";
      await sendEmail(app.email,
        "Har du fatt ditt org.nummer, " + name + "?",
        wrap('<h2 style="font-size:1.1rem;margin:0 0 12px">Hej ' + name + '!</h2><p style="color:#6B6960;line-height:1.6">Har du fatt ditt organisationsnummer fran Skatteverket? Skicka det till oss sa aktiverar vi ditt konto inom 24 timmar!</p><a href="mailto:hello@spick.se?subject=Mitt org.nummer" style="display:inline-block;background:#0F6E56;color:#fff;padding:12px 28px;border-radius:12px;text-decoration:none;font-weight:600;margin:16px 0">Skicka org.nummer →</a>')
      );
      sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent, stuck_applied: (stuckApplied||[]).length, stuck_registering: (stuckRegistering||[]).length }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("onboarding-reminders error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500 });
  }
});

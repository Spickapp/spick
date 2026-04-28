// ═══════════════════════════════════════════════════════════════
// SPICK – admin-reengagement-send (At-risk-företag-påminnelser)
// ═══════════════════════════════════════════════════════════════
//
// Skickar empatisk re-engagement-mejl till VD för företag som varit
// inaktiva (>30 dagar utan bokning). Triggas manuellt från admin-vyn
// (Plattformsöversikt → at-risk-listan → "Skicka påminnelse"-knapp).
//
// AUTH: admin_users-tabellen (samma pattern som alla admin-EFs).
//
// SVAR-FORMAT:
// {
//   ok: true,
//   sent_to: { email, vd_name, company_name },
//   sent_at: ISO
// }
//
// REGLER (#26-#34):
// #26 Läst sendEmail-helper-signatur (rule #26 grep verifierat)
// #27 Scope: bara EF för manuell admin-trigger, ingen cron
// #28 SSOT: sendEmail från _shared/email.ts, samma admin_users-pattern
//     som vd-payment-summary, admin-platform-stats
// #30 Mejl-text empati-fokuserad, inga regulator-claims eller fabricerade
//     SLA-löften ('vi hör av oss inom X dagar')
// #31 Curl-verifierat: companies + cleaners + admin_users finns i prod
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap, esc, card } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("admin-reengagement-send");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Admin-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);
    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await sbAuth.auth.getUser();
    if (!user?.email) return json(CORS, 401, { error: "invalid_token" });

    const { data: adminRow } = await sb.from("admin_users")
      .select("email").eq("email", user.email).eq("is_active", true).maybeSingle();
    if (!adminRow) return json(CORS, 403, { error: "not_admin" });

    // ── Body ──
    const body = await req.json().catch(() => ({}));
    if (!body?.company_id) return json(CORS, 400, { error: "missing_company_id" });

    // ── Hämta company + owner ──
    const { data: company } = await sb.from("companies")
      .select("id, name, display_name, owner_cleaner_id")
      .eq("id", body.company_id).maybeSingle();
    if (!company) return json(CORS, 404, { error: "company_not_found" });
    if (!company.owner_cleaner_id) return json(CORS, 422, { error: "company_has_no_owner" });

    const { data: owner } = await sb.from("cleaners")
      .select("email, full_name, first_name")
      .eq("id", company.owner_cleaner_id).maybeSingle();
    if (!owner?.email) return json(CORS, 422, { error: "owner_has_no_email" });

    const companyName = (company.display_name as string) || (company.name as string) || "ditt företag";
    const vdFirstName = (owner.first_name as string) || (owner.full_name as string)?.split(" ")[0] || "där";

    // ── Mejl-text (empatisk, ej säljig — rule #33) ──
    const html = wrap(`
      <h2>Hej ${esc(vdFirstName)} – vi saknar er på Spick 👋</h2>
      <p>Vi har märkt att <strong>${esc(companyName)}</strong> inte tagit nya bokningar
      på Spick på ett tag. Vi vill bara höra av oss för att fråga: är allt OK?</p>

      <p>Det finns några vanliga skäl till varför företag pausar:</p>
      <ul style="line-height:1.8">
        <li>📅 Säsongsbetingad — kommer tillbaka när det blir aktuellt</li>
        <li>🔧 Tekniskt problem — kanske något krånglar i appen</li>
        <li>💼 Annan inkörsport — fokuserar på andra plattformar just nu</li>
        <li>❓ Något helt annat</li>
      </ul>

      <p>Om det är en teknisk fråga — svara gärna på det här mejlet, så hjälper vi
      direkt. Om ni vill prata strategi eller bolla något kring er Spick-närvaro
      finns vi också där.</p>

      <p>Era inställningar och team finns kvar i systemet, så ni kan börja ta nya
      bokningar närhelst ni vill.</p>

      <p style="margin-top:24px">Hör gärna av er — vi finns här.<br>
      <em>– Teamet på Spick</em></p>
    `);

    const result = await sendEmail(
      owner.email as string,
      `Vi saknar er på Spick — är allt OK?`,
      html
    );

    log("info", "Re-engagement-mejl skickat", {
      company_id: company.id,
      company_name: companyName,
      to: owner.email,
      result_ok: result.ok,
    });

    return json(CORS, 200, {
      ok: true,
      sent_to: {
        email: owner.email,
        vd_name: owner.full_name,
        company_name: companyName,
      },
      sent_at: new Date().toISOString(),
      email_result: result,
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

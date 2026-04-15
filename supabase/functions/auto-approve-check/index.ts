/**
 * auto-approve-check – Kontrollerar om en ansökan uppfyller auto-approve-kriterier
 * och anropar i så fall admin-approve-cleaner internt.
 *
 * POST body: { application_id: string }
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPA_URL, SERVICE_KEY);

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { application_id } = await req.json();
    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id krävs" }), {
        status: 400, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // 1. Hämta ansökan
    const { data: app, error } = await sb
      .from("cleaner_applications")
      .select("*")
      .eq("id", application_id)
      .maybeSingle();

    if (error || !app) {
      return new Response(JSON.stringify({ error: "Ansökan hittades inte" }), {
        status: 404, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    if (app.status !== "pending") {
      return new Response(JSON.stringify({ auto_approved: false, reason: "Redan hanterad", status: app.status }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // 2. Kontrollera auto-approve-kriterier
    let shouldAutoApprove = false;
    let reason = "";

    // Kriterie 1: VD-tillagd teammedlem (invited_by_company_id finns)
    if (app.invited_by_company_id) {
      // Verifiera att företaget finns och har en aktiv ägare
      const { data: company } = await sb
        .from("companies")
        .select("id, name, owner_cleaner_id")
        .eq("id", app.invited_by_company_id)
        .maybeSingle();

      if (company && company.owner_cleaner_id) {
        shouldAutoApprove = true;
        reason = "VD-tillagd teammedlem (företag: " + company.name + ")";
      }
    }

    // Framtida kriterier (avkommenteras när det behövs):
    // Kriterie 2: Företag med org.nr
    // if (!shouldAutoApprove && app.is_company && app.org_number && /^\d{6}-\d{4}$/.test(app.org_number)) {
    //   shouldAutoApprove = true;
    //   reason = "Företag med validerat org.nr: " + app.org_number;
    // }
    //
    // Kriterie 3: Solo med F-skatt
    // if (!shouldAutoApprove && app.fskatt_confirmed) {
    //   shouldAutoApprove = true;
    //   reason = "Solo med F-skatt bekräftad";
    // }

    if (!shouldAutoApprove) {
      console.log("Auto-approve: AVSLAGET för", app.full_name || app.email, "— manuell granskning krävs");
      return new Response(JSON.stringify({ auto_approved: false, reason: "Uppfyller inte auto-approve-kriterier" }), {
        headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    // 3. Anropa admin-approve-cleaner med service_role key
    console.log("Auto-approve: GODKÄNT för", app.full_name || app.email, "—", reason);

    const approveRes = await fetch(`${SUPA_URL}/functions/v1/admin-approve-cleaner`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        application_id: application_id,
        action: "approve"
      }),
    });

    const approveData = await approveRes.json();

    if (!approveRes.ok) {
      console.error("Auto-approve: admin-approve-cleaner misslyckades:", approveData);
      return new Response(JSON.stringify({
        auto_approved: false,
        reason: "Approve misslyckades: " + (approveData.error || "okänt fel"),
        fallback: "manual"
      }), {
        status: 500, headers: { "Content-Type": "application/json", ...CORS }
      });
    }

    return new Response(JSON.stringify({
      auto_approved: true,
      reason,
      approve_result: approveData
    }), {
      headers: { "Content-Type": "application/json", ...CORS }
    });

  } catch (e) {
    console.error("auto-approve-check error:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS }
    });
  }
});

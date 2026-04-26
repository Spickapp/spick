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
    // Audit-data som loggas till admin_audit_log oavsett utfall (Sprint 1B)
    const auditMeta: Record<string, unknown> = { application_id, email: app.email };

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
        auditMeta.criterion = "company_invite";
      }
    }

    // Kriterie 2 (Sprint 1B 2026-04-26): Solo eller företag med VERIFIERAD F-skatt + städ-SNI
    // Kräver att verify-fskatt-EFen returnerat valid=true + has_fskatt=true + minst en städ-SNI.
    // Vi anropar EFen här (server-to-server) så att vi inte litar på frontend-claim.
    if (!shouldAutoApprove && app.org_number && app.fskatt_confirmed) {
      try {
        const verifyRes = await fetch(`${SUPA_URL}/functions/v1/verify-fskatt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ org_number: app.org_number }),
        });
        const verifyData = await verifyRes.json();
        auditMeta.fskatt_check = verifyData;

        const VALID_SNI = ["81210", "81220", "81290"];
        const hasMatchingSni = Array.isArray(verifyData?.sni_codes)
          && verifyData.sni_codes.some((c: string) => VALID_SNI.includes(c));

        if (verifyData?.valid && verifyData?.has_fskatt && hasMatchingSni
            && verifyData?.api_used === "foretagsapi.se") {
          shouldAutoApprove = true;
          reason = `F-skatt verifierad via Skatteverket+Bolagsverket (org ${app.org_number}, SNI ${verifyData.sni_codes.join(",")})`;
          auditMeta.criterion = "fskatt_verified";
        } else if (verifyData?.api_used === "fallback") {
          // Upstream nere ELLER FORETAGSAPI_KEY saknas → fall tillbaka på manuell granskning
          auditMeta.fskatt_skipped = "upstream_unavailable_fallback_to_manual";
        }
      } catch (e) {
        console.error("verify-fskatt fetch failed", (e as Error).message);
        auditMeta.fskatt_error = (e as Error).message;
        // Inte blockerande — manuell review tar över
      }
    }

    if (!shouldAutoApprove) {
      // Best-effort audit-log för "ej auto-approved" (rule #28 — observability)
      // Schema verifierat via migration 00006_fas_2_1_1_admin_bootstrap.sql:
      //   action, resource_type, resource_id, admin_email, old_value, new_value, reason
      try {
        await sb.from("admin_audit_log").insert({
          action: "auto_approve_skipped",
          resource_type: "cleaner_application",
          resource_id: application_id,
          admin_email: "system:auto-approve-check",
          new_value: auditMeta,
          reason: "Did not meet auto-approve criteria — manual review required",
        });
      } catch (_) { /* admin_audit_log skrivning ej kritiskt — manuell review tar över */ }

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

    // Audit-logga GODKÄND auto-approve (Sprint 1B observability)
    try {
      await sb.from("admin_audit_log").insert({
        action: "auto_approved",
        resource_type: "cleaner_application",
        resource_id: application_id,
        admin_email: "system:auto-approve-check",
        new_value: auditMeta,
        reason,
      });
    } catch (_) { /* ej kritiskt */ }

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

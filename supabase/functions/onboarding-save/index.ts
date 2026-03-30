import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  "https://urjeijcncsyuletprydy.supabase.co",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { action, application_id, data: payload } = await req.json();

    if (!application_id) {
      return new Response(JSON.stringify({ error: "application_id krävs" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    let result;

    switch (action) {
      case "update_phase": {
        const { phase } = payload || {};
        if (!["applied", "registering", "waiting_fskatt", "ready", "active"].includes(phase)) {
          return new Response(JSON.stringify({ error: "Ogiltig fas" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const { error } = await sb.from("cleaner_applications")
          .update({ onboarding_phase: phase, updated_at: new Date().toISOString() })
          .eq("id", application_id);
        if (error) throw error;
        result = { ok: true, phase };
        break;
      }

      case "save_org_number": {
        const { org_number } = payload || {};
        if (!org_number || !/^\d{6}-?\d{4}$/.test(org_number.replace(/\s/g, ""))) {
          return new Response(JSON.stringify({ error: "Ogiltigt org.nummer" }), {
            status: 400, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
        const { error } = await sb.from("cleaner_applications")
          .update({ org_number: org_number.replace(/\s/g, ""), onboarding_phase: "ready", updated_at: new Date().toISOString() })
          .eq("id", application_id);
        if (error) throw error;
        result = { ok: true, org_number };
        break;
      }

      case "save_tax_choice": {
        const { tax_type, moms_registered } = payload || {};
        const { error } = await sb.from("cleaner_applications")
          .update({ tax_type: tax_type || "f-skatt", moms_registered: !!moms_registered, updated_at: new Date().toISOString() })
          .eq("id", application_id);
        if (error) throw error;
        result = { ok: true };
        break;
      }

      case "save_progress": {
        const { current_step, form_data } = payload || {};
        const { error } = await sb.from("cleaner_applications")
          .update({ onboarding_step: current_step, onboarding_data: form_data, updated_at: new Date().toISOString() })
          .eq("id", application_id);
        if (error) throw error;
        result = { ok: true, step: current_step };
        break;
      }

      case "get_status": {
        const { data, error } = await sb.from("cleaner_applications")
          .select("id, name, email, onboarding_phase, onboarding_step, org_number, tax_type, moms_registered, status")
          .eq("id", application_id)
          .single();
        if (error) throw error;
        result = data;
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Okänd action: " + action }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    console.error("onboarding-save error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SPICK – admin-reject-company (Sprint B Dag 5)
//
// Admin avslår en pending företagsansökan.
// Aktioner:
//   1. companies.onboarding_status = 'rejected'
//   2. cleaners (VD).status = 'rejected', is_active = false
//   3. Skicka reject-email till VD med anledning
//   4. INTE radera — arkivera
//
// Auth: admin JWT.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPA_URL, SERVICE_KEY);

function json(cors: Record<string,string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn: "admin-reject-company", msg, ...extra, ts: new Date().toISOString() }));
}

async function isAdmin(email: string | undefined): Promise<boolean> {
  if (!email) return false;
  const { data } = await sbService
    .from("admin_users")
    .select("email, is_active")
    .eq("email", email)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });
  
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);
    
    const sbUser = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await sbUser.auth.getUser();
    
    if (!user?.email || !(await isAdmin(user.email))) {
      return json(CORS, 403, { error: "not_admin" });
    }
    
    const { company_id, reason } = await req.json();
    
    if (!company_id) return json(CORS, 400, { error: "missing_company_id" });
    if (!reason || reason.trim().length < 5) {
      return json(CORS, 400, { 
        error: "missing_reason",
        message: "Ange en anledning (minst 5 tecken) som skickas till VD."
      });
    }
    
    const { data: company } = await sbService
      .from("companies")
      .select("id, name, onboarding_status, owner_cleaner_id")
      .eq("id", company_id)
      .maybeSingle();
    
    if (!company) return json(CORS, 404, { error: "company_not_found" });
    
    if (company.onboarding_status === "active") {
      return json(CORS, 400, {
        error: "already_active",
        message: "Kan inte avslå ett redan godkänt företag. Använd 'suspend' istället."
      });
    }
    
    const { data: vd } = await sbService
      .from("cleaners")
      .select("id, full_name, first_name, email, phone")
      .eq("id", company.owner_cleaner_id)
      .maybeSingle();
    
    // ── Uppdatera ──
    await sbService
      .from("companies")
      .update({
        onboarding_status: "rejected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", company_id);
    
    if (vd) {
      await sbService
        .from("cleaners")
        .update({
          status: "rejected",
          is_active: false,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vd.id);
      
      // Email med anledning
      try {
        await sendEmail(
          vd.email,
          `Angående ${company.name} på Spick`,
          wrap(`
            <h2>Ansökan inte godkänd</h2>
            <p>Hej ${vd.first_name || vd.full_name},</p>
            <p>Vi har tyvärr inte kunnat godkänna <strong>${company.name}</strong> på Spick för närvarande.</p>
            <div style="margin:20px 0;padding:16px;background:#F7F7F5;border-left:4px solid #0F6E56;border-radius:4px">
              <strong>Anledning:</strong><br>${reason}
            </div>
            <p>Om du tror detta är ett misstag, eller om du har kompletterande information, svara på detta mejl eller kontakta <a href="mailto:hello@spick.se">hello@spick.se</a>.</p>
          `)
        );
      } catch (e) {
        log("warn", "Rejection email failed (not fatal)", { error: (e as Error).message });
      }
    }
    
    log("info", "Company rejected", {
      company_id: company.id,
      company_name: company.name,
      reason: reason.slice(0, 100),
      rejected_by: user.email,
    });
    
    return json(CORS, 200, {
      ok: true,
      company_id: company.id,
      company_name: company.name,
      rejected_at: new Date().toISOString(),
    });
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

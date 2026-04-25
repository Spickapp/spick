// ═══════════════════════════════════════════════════════════════
// SPICK – admin-approve-company (Sprint B Dag 5)
//
// Admin godkänner ett pending företag (self-signup eller legacy).
// Aktioner:
//   1. companies.onboarding_status = 'active'
//   2. cleaners (VD).is_approved = true + status = 'aktiv'
//   3. Skicka välkomst-email + SMS till VD
//   4. Logga till audit
//
// Auth: kräver admin-email via JWT (hello@spick.se eller liknande 
// i admin_users-tabellen).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap } from "../_shared/email.ts";
import { sendSms } from "../_shared/notifications.ts";
import { createLogger } from "../_shared/log.ts";

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

const log = createLogger("admin-approve-company");

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
    // ── Auth: admin JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    
    const sbUser = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await sbUser.auth.getUser();
    
    if (!user?.email || !(await isAdmin(user.email))) {
      log("warn", "Non-admin attempted approval", { email: user?.email });
      return json(CORS, 403, { error: "not_admin" });
    }
    
    // ── Body ──
    const { company_id, notes } = await req.json();
    
    if (!company_id) {
      return json(CORS, 400, { error: "missing_company_id" });
    }
    
    // ── Hämta company ──
    const { data: company, error: compErr } = await sbService
      .from("companies")
      .select("id, name, onboarding_status, owner_cleaner_id, org_number")
      .eq("id", company_id)
      .maybeSingle();
    
    if (compErr || !company) {
      return json(CORS, 404, { error: "company_not_found" });
    }
    
    if (company.onboarding_status === "active") {
      return json(CORS, 400, { 
        error: "already_active",
        message: "Företaget är redan godkänt."
      });
    }
    
    if (!company.owner_cleaner_id) {
      return json(CORS, 400, { 
        error: "no_owner",
        message: "Företaget saknar VD-koppling. Kontakta support."
      });
    }
    
    // ── Hämta VD ──
    const { data: vd, error: vdErr } = await sbService
      .from("cleaners")
      .select("id, full_name, first_name, email, phone, stripe_onboarding_status, is_approved, status")
      .eq("id", company.owner_cleaner_id)
      .maybeSingle();
    
    if (vdErr || !vd) {
      return json(CORS, 404, { error: "vd_not_found" });
    }
    
    // ── Uppdatera företag ──
    const { error: updateCompErr } = await sbService
      .from("companies")
      .update({
        onboarding_status: "active",
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", company_id);
    
    if (updateCompErr) {
      log("error", "Company update failed", { error: updateCompErr.message });
      return json(CORS, 500, { error: "update_failed", detail: updateCompErr.message });
    }
    
    // ── Uppdatera VD-cleaner ──
    const { error: updateVdErr } = await sbService
      .from("cleaners")
      .update({
        is_approved: true,
        status: "aktiv",
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", vd.id);
    
    if (updateVdErr) {
      // Rollback företag-update
      await sbService
        .from("companies")
        .update({
          onboarding_status: company.onboarding_status,
          onboarding_completed_at: null,
        })
        .eq("id", company_id);
      
      log("error", "VD update failed, rolled back company", { error: updateVdErr.message });
      return json(CORS, 500, { error: "vd_update_failed", detail: updateVdErr.message });
    }
    
    // ── Email till VD ──
    try {
      const stripeHint = vd.stripe_onboarding_status === "complete"
        ? "Du kan direkt börja ta bokningar."
        : "Slutför din Stripe-registrering så utbetalningar kan starta.";
      
      await sendEmail(
        vd.email,
        `${company.name} är godkänt på Spick!`,
        wrap(`
          <h2>Grattis, ${vd.first_name || vd.full_name}!</h2>
          <p>Ditt företag <strong>${company.name}</strong> är nu godkänt och aktivt på Spick.</p>
          <p>${stripeHint}</p>
          <p><a href="https://spick.se/foretag-dashboard.html" style="display:inline-block;padding:12px 24px;background:#0F6E56;color:white;text-decoration:none;border-radius:10px;font-weight:600">Öppna företagsdashboard →</a></p>
          ${notes ? `<div style="margin-top:20px;padding:12px;background:#F7F7F5;border-radius:8px"><strong>Meddelande från Spick:</strong><br>${notes}</div>` : ""}
        `)
      );
    } catch (e) {
      log("warn", "Welcome email failed (not fatal)", { error: (e as Error).message });
    }
    
    // ── SMS ──
    if (vd.phone) {
      try {
        await sendSms(
          vd.phone,
          `Spick: Ditt företag ${company.name} är nu godkänt och aktivt! Öppna: spick.se/foretag-dashboard.html`
        );
      } catch (e) {
        log("warn", "SMS failed (not fatal)", { error: (e as Error).message });
      }
    }
    
    log("info", "Company approved", {
      company_id: company.id,
      company_name: company.name,
      vd_id: vd.id,
      approved_by: user.email,
    });
    
    return json(CORS, 200, {
      ok: true,
      company_id: company.id,
      company_name: company.name,
      approved_at: new Date().toISOString(),
    });
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

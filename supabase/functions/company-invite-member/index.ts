// ═══════════════════════════════════════════════════════════════
// SPICK – company-invite-member (Sprint B Dag 4)
//
// VD bjuder in ny teammedlem via SMS.
// Skapar cleaner_applications-rad med 'invited'-status,
// genererar magic-link (scope="team_invite", ttl=7 dagar),
// skickar SMS till nya medlemmens telefonnummer.
//
// Ingen cleaner-rad skapas än — den skapas när medlemmen 
// accepterar via company-accept-invite EF.
//
// Auth: kräver company owner auth token (Supabase session).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendSms } from "../_shared/notifications.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPA_URL, SERVICE_KEY);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function validatePhone(v: string): boolean {
  const cleaned = v.replace(/[^0-9+]/g, "");
  return cleaned.length >= 10;
}

function normalizePhone(v: string): string {
  let c = v.replace(/[^0-9+]/g, "");
  if (c.startsWith("0")) c = "+46" + c.slice(1);
  if (!c.startsWith("+")) c = "+46" + c;
  return c;
}

function json(cors: Record<string,string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn: "company-invite-member", msg, ...extra, ts: new Date().toISOString() }));
}

// ─────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });
  
  try {
    // ── Auth: kräver Bearer-token från VD ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    
    // Validera token via Supabase
    const sbUser = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    
    if (userErr || !user) {
      log("warn", "Invalid auth token", { error: userErr?.message });
      return json(CORS, 401, { error: "invalid_auth" });
    }
    
    // ── Body ──
    const body = await req.json();
    const { member_name, member_phone, member_email } = body;
    
    // ── Validering ──
    if (!member_name || member_name.trim().length < 2) {
      return json(CORS, 400, { error: "invalid_name" });
    }
    if (!member_phone || !validatePhone(member_phone)) {
      return json(CORS, 400, { error: "invalid_phone" });
    }
    // Email optional men om angiven måste vara giltig
    if (member_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member_email)) {
      return json(CORS, 400, { error: "invalid_email" });
    }
    
    const phoneNorm = normalizePhone(member_phone);
    const emailNorm = member_email?.trim().toLowerCase() || `invite-${Date.now()}@spick.se`;
    
    // ── Hitta VD:s company via service-role ──
    const { data: vdCleaner, error: vdErr } = await sbService
      .from("cleaners")
      .select("id, full_name, company_id, is_company_owner")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    
    if (vdErr || !vdCleaner) {
      log("warn", "No cleaner row for auth user", { auth_user_id: user.id });
      return json(CORS, 403, { error: "not_a_cleaner" });
    }
    
    if (!vdCleaner.is_company_owner || !vdCleaner.company_id) {
      return json(CORS, 403, { error: "not_a_company_owner" });
    }
    
    // ── Hämta company-info för SMS-text ──
    const { data: company } = await sbService
      .from("companies")
      .select("id, name, onboarding_status")
      .eq("id", vdCleaner.company_id)
      .maybeSingle();
    
    if (!company) {
      return json(CORS, 404, { error: "company_not_found" });
    }
    
    // ── Kolla dubbletter: telefon redan inbjuden och pending? ──
    const { data: existingInvite } = await sbService
      .from("cleaner_applications")
      .select("id, invited_phone, status, created_at")
      .eq("invited_by_company_id", company.id)
      .eq("invited_phone", phoneNorm)
      .in("status", ["invited", "pending"])
      .maybeSingle();
    
    if (existingInvite) {
      return json(CORS, 409, {
        error: "already_invited",
        message: "Denna person är redan inbjuden till ditt företag. Avbryt den gamla inbjudan först.",
        application_id: existingInvite.id,
      });
    }
    
    // ── Kolla: har telefonen redan en cleaner-rad? ──
    const { data: existingCleaner } = await sbService
      .from("cleaners")
      .select("id, phone, company_id")
      .eq("phone", phoneNorm)
      .maybeSingle();
    
    if (existingCleaner) {
      return json(CORS, 409, {
        error: "cleaner_exists",
        message: "Denna person är redan registrerad som städare. Kontakta support om de ska flyttas till ditt företag.",
      });
    }
    
    // ── Skapa cleaner_applications-rad ──
    const nameParts = member_name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");
    
    const { data: application, error: appErr } = await sbService
      .from("cleaner_applications")
      .insert({
        full_name: member_name.trim(),
        first_name: firstName,
        last_name: lastName || null,
        email: emailNorm,
        phone: phoneNorm,
        invited_by_company_id: company.id,
        invited_phone: phoneNorm,
        status: "invited",
        onboarding_phase: "invited",
        gdpr_consent: false,  // samtycke ges av medlem vid accept
      })
      .select("id")
      .single();
    
    if (appErr || !application) {
      log("error", "Application insert failed", { error: appErr?.message });
      return json(CORS, 500, { error: "invite_create_failed", detail: appErr?.message });
    }
    
    // ── Generera magic-link ──
    const magicRes = await fetch(`${SUPA_URL}/functions/v1/public-auth-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        email: emailNorm,
        redirect_to: `https://spick.se/join-team.html?app_id=${application.id}`,
        scope: "team_invite",
        resource_id: application.id,
        ttl_hours: 168,  // 7 dagar
      }),
    });
    
    const magicData = await magicRes.json();
    
    if (!magicRes.ok || !magicData.short_url) {
      log("error", "Magic-link generation failed", {
        status: magicRes.status,
        error: magicData?.error,
      });
      // Rollback: radera applications-raden
      await sbService.from("cleaner_applications").delete().eq("id", application.id);
      return json(CORS, 500, { error: "magic_link_failed", detail: magicData?.error });
    }
    
    // Uppdatera application med magic-code för spårbarhet
    await sbService
      .from("cleaner_applications")
      .update({ invited_via_magic_code: magicData.short_code })
      .eq("id", application.id);
    
    // ── Skicka SMS ──
    const smsText = `Spick: ${vdCleaner.full_name} har bjudit in dig till ${company.name}. Registrera dig och börja ta städningar: ${magicData.short_url} (giltig 7 dagar)`;
    
    try {
      await sendSms(phoneNorm, smsText);
    } catch (e) {
      log("warn", "SMS failed (not fatal)", { error: (e as Error).message });
      // Invitation skapad OK, SMS failade. VD kan skicka länken manuellt.
    }
    
    log("info", "Team invite sent", {
      company_id: company.id,
      application_id: application.id,
      invited_phone: phoneNorm,
    });
    
    return json(CORS, 200, {
      ok: true,
      application_id: application.id,
      invited_name: member_name.trim(),
      invited_phone: phoneNorm,
      magic_short_url: magicData.short_url,
      expires_at: magicData.expires_at,
    });
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// SPICK – company-self-signup (Sprint B Dag 3)
//
// Publik EF för självregistrering av städföretag.
// Skapar: companies-rad + cleaners-rad (VD) + auth-user + 
// cleaner_applications-rad + startar Stripe Connect onboarding.
//
// Returnerar: stripe_onboarding_url som VD klickar för att
// slutföra Stripe-registreringen.
//
// Admin-verifiering: onboarding_status startar som 'pending_stripe'.
// När VD slutför Stripe → webhook uppdaterar till 'pending_team'.
// När admin manuellt godkänner → 'active'.
//
// Feature flag: REQUIRE_BANKID_SIGNUP (ej satt = false).
// När TIC produktion godkänts → sätt true → BankID blir obligatoriskt.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap } from "../_shared/email.ts";
import { sendSms } from "../_shared/notifications.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REQUIRE_BANKID = (Deno.env.get("REQUIRE_BANKID_SIGNUP") ?? "").toLowerCase() === "true";

const sb = createClient(SUPA_URL, SERVICE_KEY);

// ─────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────
function validateOrgNumber(v: string): boolean {
  const cleaned = v.replace(/[^0-9]/g, "");
  return cleaned.length === 10;
}

function validateEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validatePhone(v: string): boolean {
  const cleaned = v.replace(/[^0-9+]/g, "");
  return cleaned.length >= 10;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ─────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────
Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  
  try {
    const body = await req.json();
    const {
      org_number,
      company_name,
      has_fskatt,
      vd_name,
      vd_email,
      vd_phone,
      consent_terms,
      consent_gdpr,
      consent_authority,
    } = body;
    
    // ── Validering ──
    if (!org_number || !validateOrgNumber(org_number)) {
      return json(CORS, 400, { error: "invalid_org_number" });
    }
    if (!company_name || company_name.trim().length < 2) {
      return json(CORS, 400, { error: "invalid_company_name" });
    }
    if (!vd_name || vd_name.trim().split(" ").length < 2) {
      return json(CORS, 400, { error: "invalid_vd_name" });
    }
    if (!vd_email || !validateEmail(vd_email)) {
      return json(CORS, 400, { error: "invalid_email" });
    }
    if (!vd_phone || !validatePhone(vd_phone)) {
      return json(CORS, 400, { error: "invalid_phone" });
    }
    if (!consent_terms || !consent_gdpr || !consent_authority) {
      return json(CORS, 400, { error: "missing_consent" });
    }
    
    // ── Normalisera ──
    const emailNorm = vd_email.trim().toLowerCase();
    const orgCleaned = org_number.replace(/[^0-9]/g, "");
    const orgFormatted = `${orgCleaned.slice(0,6)}-${orgCleaned.slice(6)}`;
    const phoneCleaned = vd_phone.replace(/[^0-9+]/g, "");
    const phoneNormalized = phoneCleaned.startsWith("0") ? "+46" + phoneCleaned.slice(1) : phoneCleaned;
    
    // ── Kolla dubletter ──
    const { data: existingCompany } = await sb
      .from("companies")
      .select("id, name")
      .eq("org_number", orgFormatted)
      .maybeSingle();
    
    if (existingCompany) {
      log("warn", "company-self-signup", "Duplicate org_number", { org_number: orgFormatted });
      return json(CORS, 409, {
        error: "company_already_registered",
        message: "Detta företag är redan registrerat hos Spick. Kontakta hello@spick.se om du tror detta är fel.",
      });
    }
    
    const { data: existingCleaner } = await sb
      .from("cleaners")
      .select("id, email")
      .eq("email", emailNorm)
      .maybeSingle();
    
    if (existingCleaner) {
      log("warn", "company-self-signup", "Duplicate cleaner email", { email: emailNorm });
      return json(CORS, 409, {
        error: "email_already_registered",
        message: "Denna e-postadress är redan registrerad. Logga in istället, eller använd en annan e-post.",
      });
    }
    
    // ── Hämta commission från platform_settings (Regel #28) ──
    const { data: commissionSetting } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "commission_standard")
      .maybeSingle();
    
    const commissionRate = Number(commissionSetting?.value ?? 12);
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 50) {
      log("error", "company-self-signup", "Invalid commission config", { raw: commissionSetting?.value });
      return json(CORS, 500, { error: "config_error" });
    }
    
    // ── Skapa Auth-user ──
    const { data: authData, error: authErr } = await sb.auth.admin.createUser({
      email: emailNorm,
      email_confirm: true,  // skippa bekräftelseemail, vi skickar egen
      user_metadata: {
        full_name: vd_name.trim(),
        phone: phoneNormalized,
        role: "company_owner",
      },
    });
    
    if (authErr || !authData?.user?.id) {
      log("error", "company-self-signup", "Auth user create failed", { error: authErr?.message });
      return json(CORS, 500, { error: "auth_create_failed", detail: authErr?.message });
    }
    
    const authUserId = authData.user.id;
    
    // ── Skapa company ──
    const companySlug = slugify(company_name.trim());
    const { data: company, error: compErr } = await sb
      .from("companies")
      .insert({
        name: company_name.trim(),
        org_number: orgFormatted,
        slug: companySlug,
        commission_rate: commissionRate,
        self_signup: true,
        onboarding_status: "pending_stripe",
      })
      .select("id")
      .single();
    
    if (compErr || !company) {
      log("error", "company-self-signup", "Company insert failed", { error: compErr?.message });
      // Rollback: radera auth-user
      await sb.auth.admin.deleteUser(authUserId).catch(() => {});
      return json(CORS, 500, { error: "company_create_failed", detail: compErr?.message });
    }
    
    // ── Skapa cleaner (VD) ──
    const nameParts = vd_name.trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ");
    
    const { data: cleaner, error: cleanErr } = await sb
      .from("cleaners")
      .insert({
        auth_user_id: authUserId,
        full_name: vd_name.trim(),
        first_name: firstName,
        last_name: lastName,
        email: emailNorm,
        phone: phoneNormalized,
        city: "Stockholm",  // default, VD uppdaterar senare
        hourly_rate: 400,   // default, VD uppdaterar
        company_id: company.id,
        is_company_owner: true,
        status: "company_owner",
        tier: "new",
        is_active: true,
        is_approved: false,  // admin verifierar innan aktiv
        has_fskatt: !!has_fskatt,
        commission_rate: commissionRate,
        services: ["Hemstädning"],  // default, VD uppdaterar
        service_radius_km: 30,
      })
      .select("id")
      .single();
    
    if (cleanErr || !cleaner) {
      log("error", "company-self-signup", "Cleaner insert failed, rolling back", { error: cleanErr?.message });
      // Rollback
      await sb.from("companies").delete().eq("id", company.id);
      await sb.auth.admin.deleteUser(authUserId).catch(() => {});
      return json(CORS, 500, { error: "cleaner_create_failed", detail: cleanErr?.message });
    }
    
    // ── Uppdatera company med owner_cleaner_id ──
    await sb
      .from("companies")
      .update({ owner_cleaner_id: cleaner.id })
      .eq("id", company.id);
    
    // ── Skapa cleaner_applications-rad (historik) ──
    await sb.from("cleaner_applications").insert({
      full_name: vd_name.trim(),
      first_name: firstName,
      last_name: lastName,
      email: emailNorm,
      phone: phoneNormalized,
      city: "Stockholm",
      fskatt_confirmed: !!has_fskatt,
      onboarding_phase: "ready",
      status: "approved",
      is_company: true,
      company_name: company_name.trim(),
      org_number: orgFormatted,
      approved_at: new Date().toISOString(),
      reviewed_by: "self_signup",
      gdpr_consent: true,
      gdpr_consent_at: new Date().toISOString(),
    });
    
    // ── Starta Stripe Connect onboarding ──
    let stripeUrl: string | null = null;
    try {
      const stripeRes = await fetch(`${SUPA_URL}/functions/v1/stripe-connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({
          action: "onboard_cleaner",
          cleaner_id: cleaner.id,
          email: emailNorm,
          name: vd_name.trim(),
        }),
      });
      
      const stripeData = await stripeRes.json();
      
      if (stripeRes.ok && stripeData.ok && stripeData.url) {
        stripeUrl = stripeData.url;
      } else {
        log("warn", "company-self-signup", "Stripe onboarding init failed (not fatal)", {
          status: stripeRes.status,
          error: stripeData?.error,
        });
      }
    } catch (e) {
      log("warn", "company-self-signup", "Stripe call exception (not fatal)", { error: (e as Error).message });
    }
    
    // ── Notifiera VD (email + SMS) ──
    try {
      await sendEmail(
        emailNorm,
        `Välkommen till Spick, ${firstName}!`,
        wrap(`
          <h2>Tack för registreringen, ${firstName}!</h2>
          <p>Vi har tagit emot din registrering för <strong>${company_name.trim()}</strong> (${orgFormatted}).</p>
          <p><strong>Nästa steg:</strong></p>
          <ol>
            <li>Slutför din Stripe-registrering${stripeUrl ? ` <a href="${stripeUrl}">här</a>` : ""} (ca 5 min)</li>
            <li>Vårt team verifierar ditt företag inom 1 arbetsdag</li>
            <li>När du är godkänd kan du bjuda in dina städare och börja ta emot bokningar</li>
          </ol>
          <p>Har du frågor? Svara bara på detta mejl eller kontakta <a href="mailto:hello@spick.se">hello@spick.se</a>.</p>
        `)
      );
    } catch (e) {
      log("warn", "company-self-signup", "Email send failed (not fatal)", { error: (e as Error).message });
    }
    
    // ── Notifiera admin ──
    try {
      await sendEmail(
        "hello@spick.se",
        `📝 Ny företagsregistrering: ${company_name.trim()}`,
        wrap(`
          <h2>Ny företagsregistrering att granska</h2>
          <p><strong>Företag:</strong> ${company_name.trim()} (${orgFormatted})</p>
          <p><strong>VD:</strong> ${vd_name.trim()} (${emailNorm}, ${phoneNormalized})</p>
          <p><strong>F-skatt bekräftad:</strong> ${has_fskatt ? "Ja" : "Nej"}</p>
          <p><strong>Stripe onboarding startad:</strong> ${stripeUrl ? "Ja" : "Nej — behöver manuell start"}</p>
          <p>Granska i <a href="https://spick.se/admin.html">admin.html</a>.</p>
        `)
      );
    } catch (e) {
      log("warn", "company-self-signup", "Admin email failed (not fatal)", { error: (e as Error).message });
    }
    
    log("info", "company-self-signup", "Company registered", {
      company_id: company.id,
      cleaner_id: cleaner.id,
      org_number: orgFormatted,
      stripe_url_created: !!stripeUrl,
    });
    
    return json(CORS, 200, {
      ok: true,
      company_id: company.id,
      cleaner_id: cleaner.id,
      stripe_onboarding_url: stripeUrl,
      require_bankid: REQUIRE_BANKID,
    });
    
  } catch (err) {
    log("error", "company-self-signup", "Unhandled exception", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function json(cors: Record<string,string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, fn: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn, msg, ...extra, ts: new Date().toISOString() }));
}

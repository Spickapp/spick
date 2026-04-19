// ═══════════════════════════════════════════════════════════════
// SPICK – company-accept-invite (Sprint B Dag 4)
//
// Teammedlem klickade magic-link → landade på join-team.html → 
// fyllde i sin profil + samtycke → denna EF skapar cleaner-raden
// och triggar Stripe Connect.
//
// Auth: kräver valid session från magic-link (public-auth-link 
// etablerar session via PKCE/OTP).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders, sendEmail, wrap } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPA_URL, SERVICE_KEY);

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, "a").replace(/ä/g, "a").replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || `cleaner-${Date.now()}`;
}

function json(cors: Record<string,string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string,unknown> = {}) {
  console.log(JSON.stringify({ level, fn: "company-accept-invite", msg, ...extra, ts: new Date().toISOString() }));
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });
  
  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    
    const sbUser = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    
    if (userErr || !user) {
      return json(CORS, 401, { error: "invalid_auth" });
    }
    
    // ── Body ──
    const body = await req.json();
    const {
      application_id,
      real_email,           // medlemmens egna email (krävs — inte placeholder)
      phone,                // kan uppdatera fr?n invite
      hourly_rate,
      home_address,
      home_lat,
      home_lng,
      service_radius_km,
      languages,
      has_fskatt,
      pet_pref,
      consent_terms,
      consent_gdpr,
    } = body;
    
    // ── Validering ──
    if (!application_id) return json(CORS, 400, { error: "missing_application_id" });
    if (!real_email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(real_email)) {
      return json(CORS, 400, { error: "invalid_email" });
    }
    if (!consent_terms || !consent_gdpr) return json(CORS, 400, { error: "missing_consent" });
    
    // ── Hämta invitation ──
    const { data: app, error: appErr } = await sbService
      .from("cleaner_applications")
      .select("id, full_name, first_name, last_name, phone, status, invited_by_company_id, onboarding_phase")
      .eq("id", application_id)
      .maybeSingle();
    
    if (appErr || !app) {
      return json(CORS, 404, { error: "invitation_not_found" });
    }
    
    if (app.status !== "invited" || !app.invited_by_company_id) {
      return json(CORS, 400, {
        error: "invalid_invitation_state",
        message: "Denna inbjudan är antingen redan accepterad eller ogiltig.",
      });
    }
    
    // ── Hämta commission från platform_settings (Regel #28) ──
    const { data: commissionSetting } = await sbService
      .from("platform_settings")
      .select("value")
      .eq("key", "commission_standard")
      .maybeSingle();
    
    const commissionRate = Number(commissionSetting?.value ?? 12);
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 50) {
      log("error", "Invalid commission config", { raw: commissionSetting?.value });
      return json(CORS, 500, { error: "config_error" });
    }
    
    // ── Kolla: email redan använd? ──
    const emailNorm = real_email.trim().toLowerCase();
    const { data: existingCleaner } = await sbService
      .from("cleaners")
      .select("id, email")
      .eq("email", emailNorm)
      .maybeSingle();
    
    if (existingCleaner) {
      return json(CORS, 409, {
        error: "email_already_registered",
        message: "Denna e-postadress är redan registrerad. Logga in istället.",
      });
    }
    
    // ── Uppdatera auth.user email (om magic-link gav placeholder-email) ──
    // Försök sätta riktig email på auth.user via admin API
    try {
      await sbService.auth.admin.updateUserById(user.id, {
        email: emailNorm,
        email_confirm: true,
      });
    } catch (e) {
      // Non-fatal om email redan matchar
      log("warn", "Could not update auth email (maybe already set)", { error: (e as Error).message });
    }
    
    // ── Skapa cleaner-rad med slug-retry ──
    const baseSlug = slugify(app.full_name);
    let cleaner: { id: string } | null = null;
    let lastErr: { message: string } | null = null;
    
    for (let attempt = 0; attempt < 10; attempt++) {
      const trySlug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      
      const result = await sbService
        .from("cleaners")
        .insert({
          auth_user_id: user.id,
          full_name: app.full_name,
          first_name: app.first_name,
          last_name: app.last_name,
          email: emailNorm,
          phone: phone || app.phone,
          slug: trySlug,
          city: "Stockholm",  // default, medlem uppdaterar senare
          hourly_rate: Number.isFinite(Number(hourly_rate)) ? Number(hourly_rate) : 350,
          home_address: home_address || null,
          home_lat: home_lat || null,
          home_lng: home_lng || null,
          service_radius_km: service_radius_km || 30,
          languages: Array.isArray(languages) ? languages : ["sv"],
          has_fskatt: !!has_fskatt,
          pet_pref: pet_pref || "ok",
          company_id: app.invited_by_company_id,
          is_company_owner: false,
          is_active: true,
          is_approved: true,                    // AUTO-GODKÄND (VD vouchade)
          status: "onboarding",                 // blir "aktiv" efter Stripe complete
          tier: "new",
          commission_rate: commissionRate,
          services: ["Hemstädning"],            // default, medlem uppdaterar
          avg_rating: 0,
          review_count: 0,
          completed_jobs: 0,
        })
        .select("id")
        .single();
      
      if (!result.error) {
        cleaner = result.data;
        break;
      }
      
      if (!result.error.message?.includes("cleaners_slug_key")) {
        lastErr = result.error;
        break;
      }
      
      log("info", "Slug conflict, retrying", { attempt: attempt + 1, tried_slug: trySlug });
    }
    
    if (!cleaner) {
      log("error", "Cleaner insert failed", { error: lastErr?.message });
      return json(CORS, 500, { error: "cleaner_create_failed", detail: lastErr?.message });
    }
    
    // ── Uppdatera applications-raden ──
    await sbService
      .from("cleaner_applications")
      .update({
        email: emailNorm,
        status: "approved",
        onboarding_phase: "active",
        approved_at: new Date().toISOString(),
        reviewed_by: "team_invite_accepted",
        gdpr_consent: true,
        gdpr_consent_at: new Date().toISOString(),
      })
      .eq("id", application_id);
    
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
          name: app.full_name,
        }),
      });
      
      const stripeData = await stripeRes.json();
      if (stripeRes.ok && stripeData.ok && stripeData.url) {
        stripeUrl = stripeData.url;
      } else {
        log("warn", "Stripe onboarding init failed (not fatal)", {
          status: stripeRes.status,
          error: stripeData?.error,
        });
      }
    } catch (e) {
      log("warn", "Stripe call exception", { error: (e as Error).message });
    }
    
    // ── Notifiera medlem (email) ──
    try {
      await sendEmail(
        emailNorm,
        `Välkommen till ${app.full_name.split(" ")[0] || "Spick"}-teamet!`,
        wrap(`
          <h2>Välkommen, ${app.first_name || "hej"}!</h2>
          <p>Du är nu registrerad som städare på Spick.</p>
          <p><strong>Nästa steg:</strong></p>
          <ol>
            <li>Slutför din Stripe-registrering${stripeUrl ? ` <a href="${stripeUrl}">här</a>` : ""} så du kan få betalt</li>
            <li>Öppna <a href="https://spick.se/stadare-dashboard.html">din dashboard</a> för att se bokningar</li>
          </ol>
        `)
      );
    } catch (e) {
      log("warn", "Welcome email failed", { error: (e as Error).message });
    }
    
    log("info", "Invitation accepted, cleaner created", {
      cleaner_id: cleaner.id,
      company_id: app.invited_by_company_id,
      application_id,
    });
    
    return json(CORS, 200, {
      ok: true,
      cleaner_id: cleaner.id,
      stripe_onboarding_url: stripeUrl,
    });
    
  } catch (err) {
    log("error", "Unhandled exception", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

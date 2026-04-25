// ═══════════════════════════════════════════════════════════════
// SPICK – company-bankid-init (Fas 7.5 §B2B.1 — TIC BankID + CompanyRoles)
// ═══════════════════════════════════════════════════════════════
//
// Initierar TIC.io BankID-session för B2B-onboarding (firmatecknare-
// verifiering). Returnerar autoStartToken + sessionId till frontend.
// CompanyRoles + signing-authority hämtas senare i company-bankid-verify.
//
// PRIMÄRKÄLLA: docs/architecture/tic-integration.md §2
//
// FLÖDE:
//   1. Validate input (vd_email, org_number)
//   2. POST TIC /api/v1/auth/bankid/start (X-Api-Key + endUserIp)
//   3. INSERT rut_consents (purpose='company_signup', expires_at NOW()+30min)
//   4. Returnerar { sessionId, autoStartToken, consent_text }
//
// AUTH: Anon-callable (B2B-onboarding-flow).
//
// REGLER: #26 grep-före-edit (rut-bankid-init mönster följer), #27 scope
// (bara init-flow för B2B), #28 SSOT (rut_consents = TIC consents-tabell
// med purpose-flagga), #29 design-doc §2 reviewat, #30 PNR-via-BankID-
// consent jurist-OK kvarstår, #31 prod-state (rut_consents.purpose-
// kolumn pending Farhad SQL).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("company-bankid-init");

const CONSENT_WINDOW_MS = 30 * 60 * 1000;

const CONSENT_TEXT = `Spick ber om åtkomst till uppgifter om dig och bolaget för att bekräfta att du är firmatecknare.

**Vad lagras:**
• En envägshashs av ditt personnummer
• Ditt namn
• Bolagets organisationsnummer
• Roll-data från Bolagsverket (om du är styrelseledamot/firmatecknare)

**Vad lagras INTE:**
• Ditt klartext-personnummer

Genom att fortsätta verifierar du behörighet att registrera bolaget på Spick.`;

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidEmail(e: unknown): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function isValidOrgNumber(o: unknown): boolean {
  if (typeof o !== "string") return false;
  return o.replace(/[^0-9]/g, "").length === 10;
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // Flag-check
    const { data: flagRow } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "tic_enabled")
      .maybeSingle();
    if (!flagRow || flagRow.value !== "true") {
      return json(CORS, 503, { error: "tic_disabled" });
    }
    if (!TIC_API_KEY) {
      log("error", "TIC_API_KEY missing");
      return json(CORS, 500, { error: "tic_config_missing" });
    }

    // Input
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { vd_email, org_number } = body as Record<string, unknown>;
    if (!isValidEmail(vd_email)) {
      return json(CORS, 400, { error: "invalid_vd_email" });
    }
    if (!isValidOrgNumber(org_number)) {
      return json(CORS, 400, { error: "invalid_org_number" });
    }
    const email = (vd_email as string).toLowerCase().trim();
    const orgCleaned = (org_number as string).replace(/[^0-9]/g, "");
    const orgFormatted = `${orgCleaned.slice(0, 6)}-${orgCleaned.slice(6)}`;

    // POST TIC BankID start
    const endUserIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("x-real-ip")
      || "0.0.0.0";
    const userAgent = req.headers.get("user-agent") || "Spick/1.0";
    const ticRes = await fetch(`${TIC_BASE_URL}/api/v1/auth/bankid/start`, {
      method: "POST",
      headers: {
        "X-Api-Key": TIC_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ endUserIp, userAgent }),
    });

    if (!ticRes.ok) {
      const errBody = await ticRes.text();
      log("error", "TIC BankID start failed", {
        status: ticRes.status,
        body: errBody.slice(0, 500),
      });
      return json(CORS, 502, {
        error: "tic_bankid_start_failed",
        details: ticRes.status === 401 ? "TIC-auth-fel" : "TIC API-fel",
      });
    }

    const ticData = await ticRes.json();
    const sessionId = ticData.sessionId || ticData.session_id;
    const autoStartToken = ticData.autoStartToken || ticData.auto_start_token;

    if (!sessionId) {
      log("error", "TIC respons saknar sessionId", { ticData });
      return json(CORS, 502, { error: "tic_invalid_response" });
    }

    // INSERT rut_consents (purpose='company_signup', verified_org_number = orgFormatted)
    const expiresAt = new Date(Date.now() + CONSENT_WINDOW_MS).toISOString();
    const { error: insertErr } = await sb
      .from("rut_consents")
      .insert({
        booking_id: null,
        customer_email: email,
        tic_session_id: sessionId,
        consent_text: CONSENT_TEXT,
        pnr_hash: "PENDING",
        expires_at: expiresAt,
        purpose: "company_signup",
        verified_org_number: orgFormatted,
      });

    if (insertErr) {
      log("error", "INSERT rut_consents failed", { error: insertErr.message });
      return json(CORS, 500, { error: "consent_insert_failed", details: insertErr.message });
    }

    log("info", "TIC BankID-session startad (company_signup)", {
      session_id: sessionId, email_prefix: email.slice(0, 5), org: orgFormatted,
    });

    return json(CORS, 200, {
      ok: true,
      session_id: sessionId,
      auto_start_token: autoStartToken,
      consent_text: CONSENT_TEXT,
      expires_at: expiresAt,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

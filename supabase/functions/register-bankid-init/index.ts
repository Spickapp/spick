// ═══════════════════════════════════════════════════════════════
// SPICK – register-bankid-init (Item 1 Etapp 2)
// ═══════════════════════════════════════════════════════════════
//
// Initierar TIC.io BankID-session för terms-acceptance vid registrering.
// Skild från rut-bankid-init (RUT-PNR-flow) för att isolera prod-risk.
//
// PURPOSE-värden i rut_consents (konsolidering av tic-flows):
//   - cleaner_registration  — cleaner accepterar underleverantörsavtal
//   - company_signup        — firmatecknare accepterar B2B-tillägg
//
// FLÖDE:
//   1. Validate input (purpose, cleaner_id ELLER company_id, terms_versions)
//   2. POST TIC /api/v1/auth/bankid/start
//   3. INSERT rut_consents med purpose-flagga + terms_versions i jsonb-fält
//   4. Returnera { sessionId, autoStartToken, consent_text }
//
// AUTH:
//   Anon-callable (registrering kan ske innan login).
//   tic_enabled='true' krävs (samma flag-gate som rut-bankid-init).
//
// REGLER: #26 grep TIC-init pattern (kopiera från rut-bankid-init),
// #27 scope (bara terms-registration, ingen RUT-touch), #28 SSOT
// (TIC-call duplicerad medvetet — se Etapp 5 för ev. _shared-refactor),
// #30 BankID-binding kräver Farhads jurist-OK på drafts INNAN
// terms_signing_required='true' — denna EF kan deployas men flow är
// flag-gated, #31 prod-state: rut_consents.purpose-kolumn finns per
// TIC #1 SPAR-flow (handoff 2026-04-25-tic-discord).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("register-bankid-init");

const CONSENT_WINDOW_MS = 30 * 60 * 1000;

type Purpose = "cleaner_registration" | "company_signup";
const VALID_PURPOSES: ReadonlyArray<Purpose> = ["cleaner_registration", "company_signup"];

function buildConsentText(purpose: Purpose, versions: Record<string, string>): string {
  if (purpose === "cleaner_registration") {
    return `Spick ber dig att signera ditt underleverantörsavtal med BankID.

**Du godkänner härmed:**
• Underleverantörsavtal ${versions.underleverantorsavtal || "v1.0"}
• Code of Conduct ${versions.code_of_conduct || "v1.0"}
• Spicks integritetspolicy ${versions.integritetspolicy || "v1.0"}

**Vad lagras:**
• En envägshashs av ditt personnummer (för identitetsbevis)
• Ditt namn och folkbokföringsadress
• Tidpunkt och version av accepterade avtal
• En referens till denna BankID-session som juridisk signatur

**Vad lagras INTE:**
• Ditt klartext-personnummer

Genom att signera bekräftar du som juridisk person att du accepterar avtalen i sin helhet och förbinder dig till alla villkor.`;
  }

  // company_signup
  return `Spick ber dig som firmatecknare att signera företagsavtalet med BankID.

**Du godkänner härmed:**
• Underleverantörsavtal ${versions.underleverantorsavtal || "v1.0"}
• B2B-tillägg företag ${versions.b2b_tillagg || "v1.0"}
• Code of Conduct ${versions.code_of_conduct || "v1.0"}
• Spicks integritetspolicy ${versions.integritetspolicy || "v1.0"}

**Som firmatecknare binder du företaget** till alla avtalsvillkor genom denna signering.

**Vad lagras:**
• En envägshashs av ditt personnummer
• Ditt namn och folkbokföringsadress
• Tidpunkt och version av accepterade avtal
• Företagets organisationsnummer
• En referens till denna BankID-session som juridisk signatur

**Vad lagras INTE:**
• Ditt klartext-personnummer`;
}

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Flag-checks ──
    const { data: ticFlag } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "tic_enabled")
      .maybeSingle();
    if (!ticFlag || ticFlag.value !== "true") {
      return json(CORS, 503, {
        error: "tic_disabled",
        details: "TIC-integration är inte aktiverad. Kontakta admin.",
      });
    }

    if (!TIC_API_KEY) {
      log("error", "TIC_API_KEY missing in env");
      return json(CORS, 500, { error: "tic_config_missing" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }

    const {
      purpose,
      cleaner_id,
      company_id,
      terms_versions,
    } = body as Record<string, unknown>;

    if (!VALID_PURPOSES.includes(purpose as Purpose)) {
      return json(CORS, 400, {
        error: "invalid_purpose",
        details: { allowed: VALID_PURPOSES },
      });
    }

    const purposeStr = purpose as Purpose;
    const cleanerIdStr = isValidUuid(cleaner_id) ? cleaner_id as string : null;
    const companyIdStr = isValidUuid(company_id) ? company_id as string : null;

    // Subjekt-validation per purpose
    if (purposeStr === "cleaner_registration" && !cleanerIdStr) {
      return json(CORS, 400, { error: "cleaner_id_required_for_purpose" });
    }
    if (purposeStr === "company_signup" && !companyIdStr) {
      return json(CORS, 400, { error: "company_id_required_for_purpose" });
    }

    const versions = (terms_versions && typeof terms_versions === "object")
      ? terms_versions as Record<string, string>
      : {};

    // ── POST TIC BankID start ──
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
        purpose: purposeStr,
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

    const consentText = buildConsentText(purposeStr, versions);

    // ── INSERT rut_consents (pending) ──
    // Återanvänder rut_consents-tabellen via purpose-flaggan
    const expiresAt = new Date(Date.now() + CONSENT_WINDOW_MS).toISOString();
    const { error: insertErr } = await sb
      .from("rut_consents")
      .insert({
        booking_id: null,                  // Ej booking — registration
        cleaner_id: cleanerIdStr,
        company_id: companyIdStr,
        customer_email: null,              // Ej kund
        tic_session_id: sessionId,
        consent_text: consentText,
        pnr_hash: "PENDING",
        expires_at: expiresAt,
        purpose: purposeStr,
        terms_versions: versions,
      });

    if (insertErr) {
      log("error", "INSERT rut_consents failed", {
        error: insertErr.message,
        purpose: purposeStr,
      });
      return json(CORS, 500, {
        error: "consent_insert_failed",
        details: insertErr.message,
      });
    }

    log("info", "Register-BankID-session startad", {
      session_id: sessionId,
      purpose: purposeStr,
      cleaner_id: cleanerIdStr,
      company_id: companyIdStr,
    });

    return json(CORS, 200, {
      ok: true,
      session_id: sessionId,
      auto_start_token: autoStartToken,
      consent_text: consentText,
      expires_at: expiresAt,
      purpose: purposeStr,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

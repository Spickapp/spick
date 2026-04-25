// ═══════════════════════════════════════════════════════════════
// SPICK – company-bankid-verify (Fas 7.5 §B2B.2 — TIC CompanyRoles + signing-authority)
// ═══════════════════════════════════════════════════════════════
//
// Pollar TIC-session, hämtar CompanyRoles + signing-authority-analysis
// för att verifiera att inloggad person är firmatecknare för uppgivet
// org_number. Vid success: UPDATE rut_consents (purpose='company_signup')
// med verified_org_number, company_roles_jsonb, signing_authority_jsonb.
//
// PRIMÄRKÄLLA:
//   - https://id.tic.io/docs/api/enrichment (CompanyRoles)
//   - https://id.tic.io/docs/api/data-verification (signing-authority-analysis)
//   - docs/architecture/tic-integration.md §2
//
// FLÖDE:
//   1. Validate input (session_id, vd_email)
//   2. Verifiera consent-rad finns + purpose='company_signup' + ej expired
//   3. Polla TIC GET /api/v1/auth/{sessionId}/status
//   4. Om status='complete':
//      - POST /api/v1/enrichment {sessionId, types:['SPAR','CompanyRoles']}
//      - GET secureUrl → SPAR + CompanyRoles
//      - GET /api/v1/data/signing-authority-analysis?regNr=X&pnr=Y
//      - SHA-256-hash av PNR
//      - UPDATE rut_consents med all data + consumed_at=NOW()
//   5. Returnerar { verified: bool, full_name, signatory_status }
//
// AUTH: Anon-callable (frontend pollar). Email-match som ownership-check.
//
// REGLER: #26 grep-före-edit (rut-bankid-status mönster följer), #27 scope
// (bara verify-flow för B2B), #28 SSOT (rut_consents = generic TIC-consents),
// #29 design-doc §2 + TIC docs (enrichment + data-verification) lästa,
// #30 PNR ALDRIG i klartext (SHA-256-hash), företags-verifikation kräver
// jurist-OK FÖRE production. Signing-authority-analysis-respons sparas
// som JSON för audit-trail. #31 prod-state pending Farhad SQL för purpose-
// kolumn + nya jsonb-fält.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("company-bankid-verify");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidEmail(e: unknown): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
      return json(CORS, 500, { error: "tic_config_missing" });
    }

    // Input
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { session_id, vd_email } = body as Record<string, unknown>;
    if (typeof session_id !== "string" || session_id.length < 8) {
      return json(CORS, 400, { error: "invalid_session_id" });
    }
    if (!isValidEmail(vd_email)) {
      return json(CORS, 400, { error: "invalid_vd_email" });
    }
    const sessionId = session_id;
    const email = (vd_email as string).toLowerCase().trim();

    // Hämta consent-rad
    const { data: consent } = await sb
      .from("rut_consents")
      .select("id, customer_email, expires_at, consumed_at, purpose, verified_org_number")
      .eq("tic_session_id", sessionId)
      .maybeSingle();

    if (!consent) {
      return json(CORS, 404, { error: "consent_not_found" });
    }
    if (consent.purpose !== "company_signup") {
      return json(CORS, 422, { error: "wrong_purpose", details: { actual: consent.purpose } });
    }
    if (consent.customer_email !== email) {
      return json(CORS, 403, { error: "email_mismatch" });
    }
    if (consent.consumed_at) {
      return json(CORS, 200, {
        ok: true,
        status: "complete",
        already_consumed: true,
      });
    }
    if (new Date(consent.expires_at as string).getTime() < Date.now()) {
      return json(CORS, 410, { error: "consent_expired" });
    }

    // Polla TIC status
    const statusRes = await fetch(
      `${TIC_BASE_URL}/api/v1/auth/${encodeURIComponent(sessionId)}/status`,
      { method: "GET", headers: { "X-Api-Key": TIC_API_KEY } },
    );

    if (!statusRes.ok) {
      const errBody = await statusRes.text();
      log("warn", "TIC status fetch failed", { status: statusRes.status, body: errBody.slice(0, 200) });
      return json(CORS, 502, { error: "tic_status_failed" });
    }

    const statusData = await statusRes.json();
    const ticStatus = statusData.status || statusData.state;

    if (ticStatus !== "complete" && ticStatus !== "completed") {
      return json(CORS, 200, {
        ok: true,
        status: ticStatus || "pending",
        hint: statusData.hintCode || statusData.hint_code,
      });
    }

    // Trigger SPAR + CompanyRoles enrichment
    const enrichRes = await fetch(`${TIC_BASE_URL}/api/v1/enrichment`, {
      method: "POST",
      headers: {
        "X-Api-Key": TIC_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sessionId,
        types: ["SPAR", "CompanyRoles"],
      }),
    });

    if (!enrichRes.ok) {
      const errBody = await enrichRes.text();
      log("error", "TIC enrichment failed", { status: enrichRes.status, body: errBody.slice(0, 200) });
      return json(CORS, 502, { error: "tic_enrichment_failed" });
    }

    const enrichData = await enrichRes.json();
    const secureUrl = enrichData.secureUrl || enrichData.secure_url;
    if (!secureUrl) {
      return json(CORS, 502, { error: "tic_invalid_enrichment" });
    }

    // Hämta SPAR + CompanyRoles via secureUrl
    const dataUrl = secureUrl.startsWith("http") ? secureUrl : `${TIC_BASE_URL}${secureUrl}`;
    const dataRes = await fetch(dataUrl, { method: "GET" });
    if (!dataRes.ok) {
      log("error", "TIC data fetch failed", { status: dataRes.status });
      return json(CORS, 502, { error: "tic_data_fetch_failed" });
    }

    const ticPayload = await dataRes.json();
    // Format kan variera — försök båda namn-conventions
    const spar = ticPayload.SPAR || ticPayload.spar || ticPayload;
    const companyRoles = ticPayload.CompanyRoles || ticPayload.company_roles || [];
    const personalNumber = spar?.personalNumber || spar?.personal_number;
    const fullName = spar?.fullName || spar?.full_name;

    if (!personalNumber) {
      return json(CORS, 502, { error: "tic_spar_missing_pnr" });
    }

    // Signing-authority-analysis (separat data-verification-endpoint)
    const orgNumberClean = (consent.verified_org_number as string).replace(/[^0-9]/g, "");
    let signingAuthority: Record<string, unknown> = {};
    try {
      const signRes = await fetch(
        `${TIC_BASE_URL}/api/v1/data/signing-authority-analysis?regNr=${encodeURIComponent(orgNumberClean)}&pnr=${encodeURIComponent(personalNumber)}`,
        { method: "GET", headers: { "X-Api-Key": TIC_API_KEY } },
      );
      if (signRes.ok) {
        signingAuthority = await signRes.json();
      } else {
        log("warn", "signing-authority-analysis failed", { status: signRes.status });
      }
    } catch (e) {
      log("warn", "signing-authority exception", { error: (e as Error).message });
    }

    // Verifiera firmatecknare
    const isSignatory = signingAuthority.is_signatory === true ||
      signingAuthority.isSignatory === true ||
      signingAuthority.canSign === true;

    // SHA-256-hash + UPDATE rut_consents
    const pnrHash = await sha256Hex(personalNumber);
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("rut_consents")
      .update({
        pnr_hash: pnrHash,
        spar_full_name: fullName,
        company_roles_jsonb: companyRoles,
        signing_authority_jsonb: signingAuthority,
        consumed_at: nowIso,
        tic_enrichment_token: secureUrl.slice(0, 200),
      })
      .eq("id", consent.id);

    if (updateErr) {
      log("error", "rut_consents UPDATE failed", { id: consent.id, error: updateErr.message });
      return json(CORS, 500, { error: "consent_update_failed" });
    }

    log("info", "TIC company-verify klar", {
      consent_id: consent.id,
      org: consent.verified_org_number,
      is_signatory: isSignatory,
    });

    return json(CORS, 200, {
      ok: true,
      status: "complete",
      verified: isSignatory,
      full_name: fullName,
      org_number: consent.verified_org_number,
      signatory_status: isSignatory ? "confirmed" : "not_confirmed",
      company_roles_count: Array.isArray(companyRoles) ? companyRoles.length : 0,
    });
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    log("error", "Unexpected error", { error: errorMsg });
    return json(CORS, 500, { error: "internal_error", details: errorMsg });
  }
});

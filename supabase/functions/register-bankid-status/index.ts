// ═══════════════════════════════════════════════════════════════
// SPICK – register-bankid-status (Item 1 Etapp 2)
// ═══════════════════════════════════════════════════════════════
//
// Polls TIC.io BankID-session-status. Vid 'complete':
//   1. Hämta SPAR-data via secureUrl
//   2. SHA-256-hash av PNR
//   3. UPDATE rut_consents (pnr_hash + spar_data)
//   4. Per purpose:
//      - cleaner_registration → recordAcceptance(cleaner, version, signature_id)
//      - company_signup       → recordAcceptance(company, version, signature_id)
//
// Skild från rut-bankid-status (RUT-PNR-flow) för att isolera prod-risk.
//
// REGLER: #26 grep status-EF pattern, #27 scope (bara terms-acceptance),
// #28 SSOT — recordAcceptance från _shared/terms-acceptance.ts,
// #30 BankID-binding kräver Farhads OK på drafts (flag-gated),
// #31 schema curl-verifierat 2026-04-25.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";
import {
  recordAcceptance,
  type SubjectType,
} from "../_shared/terms-acceptance.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("register-bankid-status");

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
    // ── Flag-checks ──
    const { data: ticFlag } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "tic_enabled")
      .maybeSingle();
    if (!ticFlag || ticFlag.value !== "true") {
      return json(CORS, 503, { error: "tic_disabled" });
    }
    if (!TIC_API_KEY) {
      return json(CORS, 500, { error: "tic_config_missing" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { session_id } = body as Record<string, unknown>;
    if (typeof session_id !== "string" || session_id.length < 5) {
      return json(CORS, 400, { error: "invalid_session_id" });
    }

    // ── Fetch consent + verify ──
    const { data: consent, error: fetchErr } = await sb
      .from("rut_consents")
      .select("id, cleaner_id, company_id, expires_at, consumed_at, pnr_hash, purpose, terms_versions")
      .eq("tic_session_id", session_id)
      .maybeSingle();

    if (fetchErr || !consent) {
      return json(CORS, 404, { error: "consent_not_found" });
    }
    if (consent.consumed_at) {
      return json(CORS, 200, {
        ok: true,
        status: "complete",
        already_consumed: true,
        purpose: consent.purpose,
      });
    }
    if (new Date(consent.expires_at as string) < new Date()) {
      return json(CORS, 410, { error: "consent_expired" });
    }
    if (!["cleaner_registration", "company_signup"].includes(consent.purpose as string)) {
      return json(CORS, 400, {
        error: "wrong_purpose_use_rut_bankid_status",
        details: { purpose: consent.purpose },
      });
    }

    // ── Poll TIC status ──
    const ticRes = await fetch(`${TIC_BASE_URL}/api/v1/auth/bankid/collect/${session_id}`, {
      method: "GET",
      headers: { "X-Api-Key": TIC_API_KEY },
    });

    if (!ticRes.ok) {
      const errBody = await ticRes.text();
      log("error", "TIC collect failed", {
        status: ticRes.status, body: errBody.slice(0, 300), session_id,
      });
      return json(CORS, 502, { error: "tic_collect_failed" });
    }

    const ticData = await ticRes.json();
    const status = (ticData.status || "").toLowerCase();

    // Inte klar än → returnera status för polling
    if (status !== "complete" && status !== "completed") {
      return json(CORS, 200, {
        ok: true,
        status: status || "pending",
        hint: ticData.hint || ticData.hintCode,
      });
    }

    // ── Hämta SPAR-data via secureUrl ──
    const secureUrl = ticData.secureUrl || ticData.secure_url;
    if (!secureUrl) {
      log("error", "TIC complete utan secureUrl", { ticData });
      return json(CORS, 502, { error: "tic_missing_secure_url" });
    }
    const sparUrl = secureUrl.startsWith("http") ? secureUrl : `${TIC_BASE_URL}${secureUrl}`;
    const sparRes = await fetch(sparUrl, { method: "GET" });
    if (!sparRes.ok) {
      log("error", "SPAR fetch failed", { status: sparRes.status });
      return json(CORS, 502, { error: "tic_spar_fetch_failed" });
    }

    const sparData = await sparRes.json();
    const personalNumber = sparData.personalNumber || sparData.personal_number;
    const fullName = sparData.fullName || sparData.full_name;
    const addr = sparData.address || {};

    if (!personalNumber) {
      return json(CORS, 502, { error: "tic_spar_missing_pnr" });
    }

    // ── SHA-256-hash + UPDATE rut_consents ──
    const pnrHash = await sha256Hex(personalNumber);
    const nowIso = new Date().toISOString();
    const { error: consentUpdErr } = await sb
      .from("rut_consents")
      .update({
        pnr_hash: pnrHash,
        spar_full_name: fullName,
        spar_address_street: addr.street || null,
        spar_address_postal: addr.postalCode || addr.postal_code || null,
        spar_address_city: addr.city || null,
        spar_municipality_code: sparData.municipalityCode || sparData.municipality_code || null,
        spar_protected_identity: !!(sparData.protectedIdentity || sparData.protected_identity),
        consumed_at: nowIso,
        tic_enrichment_token: secureUrl.slice(0, 200),
      })
      .eq("id", consent.id);

    if (consentUpdErr) {
      log("error", "rut_consents UPDATE failed", { id: consent.id, error: consentUpdErr.message });
      return json(CORS, 500, { error: "consent_update_failed" });
    }

    // ── Per purpose: spara accept i cleaners/companies ──
    const purpose = consent.purpose as string;
    const subjectType: SubjectType = purpose === "cleaner_registration" ? "cleaner" : "company";
    const subjectId = (purpose === "cleaner_registration"
      ? consent.cleaner_id
      : consent.company_id) as string | null;

    if (!subjectId || !isValidUuid(subjectId)) {
      log("error", "Subject_id saknas i consent-rad", { consent_id: consent.id, purpose });
      return json(CORS, 500, { error: "consent_missing_subject_id" });
    }

    const versions = (consent.terms_versions as Record<string, string> | null) || {};
    // Spara accept för PRIMÄRT avtal (underleverantörsavtal). Övriga
    // versions sparas i rut_consents.terms_versions för audit-spår.
    const primaryVersion = subjectType === "cleaner"
      ? (versions.underleverantorsavtal || "v0.2-DRAFT")
      : (versions.b2b_tillagg || versions.underleverantorsavtal || "v0.2-DRAFT");

    const acceptResult = await recordAcceptance(sb, {
      subjectType,
      subjectId,
      version: primaryVersion,
      signatureId: consent.id as string,
    });

    if (!acceptResult.ok) {
      log("error", "recordAcceptance failed", {
        consent_id: consent.id,
        subject: `${subjectType}:${subjectId}`,
        error: acceptResult.error,
      });
      return json(CORS, 500, { error: "accept_save_failed", details: acceptResult.error });
    }

    log("info", "Register-BankID-flow klar", {
      consent_id: consent.id,
      purpose,
      subject: `${subjectType}:${subjectId}`,
      version: primaryVersion,
    });

    return json(CORS, 200, {
      ok: true,
      status: "complete",
      purpose,
      subject_type: subjectType,
      subject_id: subjectId,
      accepted_version: primaryVersion,
      customer_name: fullName,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

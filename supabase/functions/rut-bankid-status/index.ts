// ═══════════════════════════════════════════════════════════════
// SPICK – rut-bankid-status (Fas 7.5 §RUT.2 — TIC poll + SPAR)
// ═══════════════════════════════════════════════════════════════
//
// Pollar TIC BankID-session-status. Vid 'complete': initierar SPAR-
// enrichment, hämtar PNR + folkbokföringsadress, hashar PNR och
// uppdaterar rut_consents + ev. bookings.customer_pnr_hash.
//
// PRIMÄRKÄLLA:
//   - https://id.tic.io/docs/api/authentication (status-endpoint)
//   - https://id.tic.io/docs/api/enrichment (SPAR-data-fetch)
//   - docs/architecture/tic-integration.md §1.2
//
// FLÖDE:
//   1. Validate input (session_id)
//   2. Verifiera rut_consents-rad finns + ej expired
//   3. Polla TIC GET /api/v1/auth/{sessionId}/status
//   4. Om status='complete': POST /api/v1/enrichment {sessionId, types:['SPAR']}
//   5. GET secureUrl → SPAR-data
//   6. SHA-256-hash av PNR → uppdatera rut_consents + bookings
//   7. Returnera till frontend: { status, customer_name, address }
//
// AUTH:
//   Anon-callable (frontend pollar). Endast egna sessioner via
//   email-match som ownership-check.
//
// SECURITY:
//   - PNR lagras ALDRIG i klartext (rule #30)
//   - Klartext-PNR pga AES-GCM-encryption sparas i bookings.customer_pnr
//     via _shared/encryption.ts encryptPnr-helper
//   - rut_consents.consumed_at sätts efter lyckad enrichment → förhindrar
//     replay-attacks via samma session_id
//
// REGLER: #26 grep-före-edit (TIC docs verifierade via agent — X-Api-Key,
// session-id-baserad poll, secureUrl-pattern), #27 scope (bara status+
// SPAR, ingen company_roles eller andra enrichments), #28 SSOT (TIC =
// extern primärkälla, rut_consents = lokal audit), #30 PNR-via-BankID-
// consent kräver jurist-OK FÖRE production-aktivering, #31 prod-state
// (rut_consents + bookings.customer_pnr-kolumn verifierade).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";
import { encryptPnr } from "../_shared/encryption.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("rut-bankid-status");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidEmail(e: unknown): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// SHA-256-hash i hex (32 bytes → 64 hex chars). Används för pnr_hash.
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
    // ── Flag-check ──
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

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { session_id, customer_email } = body as Record<string, unknown>;

    if (typeof session_id !== "string" || session_id.length < 8) {
      return json(CORS, 400, { error: "invalid_session_id" });
    }
    if (!isValidEmail(customer_email)) {
      return json(CORS, 400, { error: "invalid_customer_email" });
    }
    const sessionId = session_id;
    const email = (customer_email as string).toLowerCase().trim();

    // ── Fetch + verify rut_consents-rad ──
    const { data: consent } = await sb
      .from("rut_consents")
      .select("id, booking_id, customer_email, expires_at, consumed_at, pnr_hash")
      .eq("tic_session_id", sessionId)
      .maybeSingle();

    if (!consent) {
      return json(CORS, 404, { error: "consent_not_found" });
    }
    if (consent.customer_email !== email) {
      return json(CORS, 403, { error: "email_mismatch" });
    }
    if (consent.consumed_at) {
      // Idempotent re-fetch: redan klart
      return json(CORS, 200, {
        ok: true,
        status: "complete",
        already_consumed: true,
      });
    }
    if (new Date(consent.expires_at as string).getTime() < Date.now()) {
      return json(CORS, 410, { error: "consent_expired" });
    }

    // ── Polla TIC status ──
    // KRITISKT 2026-04-26: använd POST /poll (INTE GET /status eller /collect).
    // Per TIC docs (https://id.tic.io/docs/api/authentication):
    //   - POST /poll = driver autentiseringsflödet framåt (kontaktar BankID)
    //   - GET /status = visar bara att session existerar (orderCount/maxOrders)
    //   - GET /collect = bara cachad data, kontaktar EJ BankID
    // Live-test 2026-04-26: med /status fastnade status:pending evigt eftersom
    // TIC aldrig kontaktade BankID. Med /poll triggas BankID-collect så att
    // status går pending → complete när användaren signerar.
    const statusRes = await fetch(
      `${TIC_BASE_URL}/api/v1/auth/${encodeURIComponent(sessionId)}/poll`,
      {
        method: "POST",
        headers: { "X-Api-Key": TIC_API_KEY },
      },
    );

    if (!statusRes.ok) {
      const errBody = await statusRes.text();
      log("warn", "TIC poll fetch failed", {
        session_id: sessionId.slice(0, 8) + "...",
        status: statusRes.status,
        body: errBody.slice(0, 300),
      });
      return json(CORS, 502, { error: "tic_status_failed", details: statusRes.status });
    }

    const statusData = await statusRes.json();
    const ticStatusRaw = statusData.status || statusData.state || statusData.result;
    const ticStatus = typeof ticStatusRaw === "string" ? ticStatusRaw.toLowerCase() : "";

    // Logga TIC-respons för diagnostik (kan tas bort efter stabilitet bekräftad)
    log("info", "TIC poll response", {
      session_id: sessionId.slice(0, 8) + "...",
      status_raw: ticStatusRaw,
      keys: Object.keys(statusData || {}),
      hint: statusData.hintCode || statusData.hint_code,
    });

    // Per TIC docs: status-värden = pending, complete, failed, cancelled
    if (ticStatus !== "complete") {
      return json(CORS, 200, {
        ok: true,
        status: ticStatus || "pending",
        hint: statusData.hintCode || statusData.hint_code,
        message: statusData.message,
        raw: statusData,
      });
    }

    // ── Hämta PNR + namn från /poll-respons (TIC docs bekräftar user-data
    //     finns när status=complete) ──
    // Per https://id.tic.io/docs/api/authentication: complete-respons
    // innehåller user: { personalNumber, givenName, surname, name }
    const userData = statusData.user || statusData.userData || {};
    const personalNumber = userData.personalNumber || userData.personal_number ||
      statusData.personalNumber || statusData.personal_number;
    const fullName = userData.name || userData.fullName ||
      [userData.givenName, userData.surname].filter(Boolean).join(" ") || null;

    if (!personalNumber || typeof personalNumber !== "string") {
      log("error", "TIC /poll complete-respons saknar personalNumber", {
        statusData_keys: Object.keys(statusData || {}),
        userData_keys: Object.keys(userData || {}),
      });
      return json(CORS, 502, { error: "tic_complete_missing_pnr" });
    }

    // ── (Best-effort) trigger SPAR-enrichment för folkbokföringsadress ──
    // I test-mode kan SPAR returnera annorlunda shape eller 4xx. Vi skippar
    // hellre adressen än 502:ar hela flowet — PNR + namn räcker för audit-
    // tracen. Adress kan kompletteras manuellt senare eller via SKV-batch.
    let secureUrl: string | null = null;
    let street: string | null = null;
    let postal: string | null = null;
    let city: string | null = null;
    let munCode: string | null = null;
    let protectedIdentity = false;

    try {
      const enrichRes = await fetch(`${TIC_BASE_URL}/api/v1/enrichment`, {
        method: "POST",
        headers: {
          "X-Api-Key": TIC_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId, types: ["SPAR"] }),
      });

      if (enrichRes.ok) {
        const enrichData = await enrichRes.json();
        secureUrl = enrichData.secureUrl || enrichData.secure_url || null;

        if (secureUrl) {
          const sparUrl = secureUrl.startsWith("http") ? secureUrl : `${TIC_BASE_URL}${secureUrl}`;
          const sparRes = await fetch(sparUrl, { method: "GET" });
          if (sparRes.ok) {
            const sparData = await sparRes.json();
            const addr = sparData.address || {};
            street = addr.street || addr.streetAddress || null;
            postal = addr.postalCode || addr.postal_code || null;
            city = addr.city || addr.locality || null;
            munCode = sparData.municipalityCode || sparData.municipality_code || null;
            protectedIdentity = !!(sparData.protectedIdentity || sparData.protected_identity);
          } else {
            log("warn", "SPAR fetch failed (best-effort, continuing)", { status: sparRes.status });
          }
        }
      } else {
        const errBody = await enrichRes.text();
        log("warn", "TIC SPAR-enrichment failed (best-effort, continuing)", {
          status: enrichRes.status, body: errBody.slice(0, 200),
        });
      }
    } catch (e) {
      log("warn", "SPAR enrichment-pipeline crashed (best-effort, continuing)", {
        error: (e as Error).message,
      });
    }

    // ── SHA-256-hash + UPDATE rut_consents ──
    const pnrHash = await sha256Hex(personalNumber);

    const nowIso = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("rut_consents")
      .update({
        pnr_hash: pnrHash,
        spar_full_name: fullName,
        spar_address_street: street,
        spar_address_postal: postal,
        spar_address_city: city,
        spar_municipality_code: munCode,
        spar_protected_identity: protectedIdentity,
        consumed_at: nowIso,
        tic_enrichment_token: secureUrl ? secureUrl.slice(0, 200) : null,
      })
      .eq("id", consent.id);

    if (updateErr) {
      log("error", "rut_consents UPDATE failed", { id: consent.id, error: updateErr.message });
      return json(CORS, 500, { error: "consent_update_failed" });
    }

    // ── UPDATE booking om kopplad ──
    // Alt B (2026-04-25): kryptera klartext-PNR med AES-256-GCM och spara
    // i bookings.customer_pnr. Hash kvar som anti-replay/audit-spår.
    // Klartext krävs vid framtida RUT-batch-export till SKV — kryptering
    // tillåter detta utan att ha klartext at-rest i DB.
    if (consent.booking_id) {
      let pnrEncrypted: string | null = null;
      try {
        pnrEncrypted = await encryptPnr(personalNumber);
      } catch (e) {
        log("error", "PNR-encryption failed — booking sparas med bara hash, RUT-batch kommer inte kunna dekryptera", {
          booking_id: consent.booking_id,
          error: (e as Error).message,
        });
      }

      const bookingUpdate: Record<string, unknown> = { customer_pnr_hash: pnrHash };
      if (pnrEncrypted) {
        bookingUpdate.customer_pnr = pnrEncrypted;
      }

      const { error: bookingErr } = await sb
        .from("bookings")
        .update(bookingUpdate)
        .eq("id", consent.booking_id);
      if (bookingErr) {
        log("warn", "booking customer_pnr/hash UPDATE failed (consent-rad sparad, manual reconciliation kan behövas)", {
          booking_id: consent.booking_id, error: bookingErr.message,
        });
      }
    }

    log("info", "RUT BankID-flow klar", {
      consent_id: consent.id,
      booking_id: consent.booking_id,
      protected_identity: protectedIdentity,
    });

    // Returnera SPAR-display-data till frontend (utan PNR — bara namn+adress)
    return json(CORS, 200, {
      ok: true,
      status: "complete",
      customer_name: fullName,
      address: street ? `${street}, ${postal || ""} ${city || ""}`.trim() : null,
      municipality_code: munCode,
      protected_identity: protectedIdentity,
    });
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    log("error", "Unexpected error", { error: errorMsg });
    return json(CORS, 500, { error: "internal_error", details: errorMsg });
  }
});

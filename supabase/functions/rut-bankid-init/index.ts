// ═══════════════════════════════════════════════════════════════
// SPICK – rut-bankid-init (Fas 7.5 §RUT.1 — TIC.io BankID-flow)
// ═══════════════════════════════════════════════════════════════
//
// Initierar TIC.io BankID-session för RUT-PNR-consent. Returnerar
// autoStartToken + sessionId till frontend för QR/redirect-flow.
// SPAR-data hämtas senare i rut-bankid-status (efter user signed in).
//
// PRIMÄRKÄLLA:
//   - https://id.tic.io/docs (API-mode, BankID-auth + SPAR-enrichment)
//   - docs/architecture/tic-integration.md §1
//
// FLÖDE:
//   1. Validate input (customer_email, optional booking_id)
//   2. POST TIC /api/v1/auth/bankid/start { userVisibleData: consent-text }
//   3. INSERT rut_consents (status=pending, expires_at=NOW()+30min)
//   4. Returnera { autoStartToken, sessionId, consent_text } till frontend
//
// AUTH:
//   Anon-callable (kund-flow). TIC_API_KEY i SUPABASE secrets autentiserar
//   mot TIC. Spick själv har ingen JWT-validation här (kund kan skapa
//   bookning utan inloggning enligt nuvarande flow).
//
// TIC PRICING/RATELIMIT:
//   Verifieras vid första call. Logga response-headers.
//
// REGLER: #26 grep-före-edit (TIC-docs läst via agent-rapport),
// #27 scope (bara init, status/enrichment i separat EF), #28 SSOT
// (rut_consents = lokal audit, TIC = extern primärkälla för identitet),
// #30 PNR-via-BankID-consent kräver jurist-OK INNAN tic_enabled='true'
// (verifierat via platform_settings.tic_enabled-flag),
// #31 prod-state: rut_consents-tabell verifierad live (curl 401 = RLS-OK).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TIC_API_KEY = Deno.env.get("TIC_API_KEY") || "";
const TIC_BASE_URL = Deno.env.get("TIC_BASE_URL") || "https://id.tic.io";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("rut-bankid-init");

// 30 min matchar TIC's enrichment-window. Fix-värde — DB CHECK eller cron
// rensar abandoned consents.
const CONSENT_WINDOW_MS = 30 * 60 * 1000;

const CONSENT_TEXT = `Spick ber om åtkomst till ditt personnummer och din folkbokföringsadress från Skatteverket (SPAR) för att rapportera ditt RUT-avdrag korrekt.

**Vad lagras:**
• En envägshashs av ditt personnummer
• Ditt namn och folkbokföringsadress
• En referens till denna BankID-session

**Vad lagras INTE:**
• Ditt klartext-personnummer

Genom att fortsätta godkänner du Spicks RUT-rapportering till Skatteverket enligt RUT-reglerna.`;

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function isValidEmail(e: unknown): e is string {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
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
    // ── Flag-check: tic_enabled måste vara 'true' i prod ──
    const { data: flagRow } = await sb
      .from("platform_settings")
      .select("value")
      .eq("key", "tic_enabled")
      .maybeSingle();
    if (!flagRow || flagRow.value !== "true") {
      return json(CORS, 503, {
        error: "tic_disabled",
        details: "TIC-integration är inte aktiverad. Kontakta admin.",
      });
    }

    // ── Auth-config-check: API-key måste finnas ──
    if (!TIC_API_KEY) {
      log("error", "TIC_API_KEY missing in env");
      return json(CORS, 500, { error: "tic_config_missing" });
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const { customer_email, booking_id } = body as Record<string, unknown>;

    if (!isValidEmail(customer_email)) {
      return json(CORS, 400, { error: "invalid_customer_email" });
    }
    if (booking_id !== undefined && booking_id !== null && !isValidUuid(booking_id)) {
      return json(CORS, 400, { error: "invalid_booking_id" });
    }

    const email = (customer_email as string).toLowerCase().trim();
    const bookingIdStr = (booking_id as string | undefined) ?? null;

    // ── POST TIC BankID start ──
    // VERIFIERAD shape mot TIC docs/api/authentication 2026-04-25:
    // - Header: X-Api-Key (rå key, INGEN Bearer-prefix)
    // - Body: { endUserIp, userAgent? } — INGEN userVisibleData/Format
    //   (de tillhör /sign, inte /start)
    // - Tenant-isolation via API-key (ingen INSTANCE_ID i header)
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
      body: JSON.stringify({
        endUserIp,
        userAgent,
      }),
    });

    if (!ticRes.ok) {
      const errBody = await ticRes.text();
      log("error", "TIC BankID start failed", {
        status: ticRes.status,
        body: errBody.slice(0, 500),
        email_prefix: email.slice(0, 5),
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

    // ── INSERT rut_consents (pending) ──
    const expiresAt = new Date(Date.now() + CONSENT_WINDOW_MS).toISOString();
    const { error: insertErr } = await sb
      .from("rut_consents")
      .insert({
        booking_id: bookingIdStr,
        customer_email: email,
        tic_session_id: sessionId,
        consent_text: CONSENT_TEXT,
        pnr_hash: "PENDING", // Sätts till riktig hash i rut-bankid-status
        expires_at: expiresAt,
      });

    if (insertErr) {
      log("error", "INSERT rut_consents failed", { error: insertErr.message });
      return json(CORS, 500, { error: "consent_insert_failed", details: insertErr.message });
    }

    log("info", "TIC BankID-session startad", {
      session_id: sessionId, email_prefix: email.slice(0, 5), booking_id: bookingIdStr,
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

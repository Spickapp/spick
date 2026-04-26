// ═══════════════════════════════════════════════════════════════
// SPICK – cleaner-application-submit (Audit-fix P2-3, 2026-04-26)
//
// BAKGRUND (audit 2026-04-26-test-cleaner-flow.md fynd #3 + #5):
//   registrera-stadare.html:1479 POST:ar direkt mot
//   /rest/v1/cleaner_applications med anon-key. Inget rate-limit
//   → spam-vektor (bot kan POST:a 1000+ rader, alla blir manuell-
//   review-job för Farhad).
//
// FIX:
//   Wrapper-EF som anropar check_rate_limit('cleaner_app:<ip>', 5, 60)
//   innan INSERT. Max 5 ansökningar per IP per 60 min → blockerar
//   spam men tillåter normal usage (en familj på samma WiFi kan
//   söka 5 gånger/h). Returnerar 429 vid överskridning.
//
//   Frontend behåller fortfarande direkt-PostgREST-fallback (om
//   denna EF skulle vara nere → registreringen funkar ändå). Men
//   primary path går via denna EF för rate-limit-skydd.
//
// AUTH: anon (publik registrering — ingen login krävs).
// Säkerhet kommer från check_rate_limit + duplicate-email-detect.
//
// REGLER:
//   #26 läst registrera-stadare.html:1465-1530 + save-booking-event
//       som mall för rate-limit-pattern.
//   #27 scope = exakt INSERT-wrapper med rate-limit
//   #28 SSOT = återanvänder check_rate_limit RPC (verifierat
//       returnerar `true` mot prod 2026-04-26)
//   #30 inga regulator-claims
//   #31 schema curl-verifierat: check_rate_limit(p_key, p_max,
//       p_window_minutes) RPC GRANT EXECUTE TO anon = OK.
//       cleaner_applications-tabell finns (fynd #2 i audit).
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPA_URL, SERVICE_KEY);

// Allowed-list över kolumner som klienten får sätta. Skydd mot
// privilege-escalation via dolda kolumner (status='approved' etc).
const ALLOWED_FIELDS = new Set<string>([
  "full_name", "first_name", "last_name",
  "email", "phone",
  "city", "home_address", "home_lat", "home_lng",
  "service_radius_km",
  "hourly_rate", "services", "bio", "languages", "experience",
  "fskatt_confirmed", "fskatt_needs_help", "has_fskatt",
  "is_company", "company_name", "org_number", "owner_only",
  "business_name", "business_org_number", "business_address",
  "vat_registered",
  "invited_by_company_id",
  "pet_pref", "notes",
  "gdpr_consent", "gdpr_consent_at",
]);

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  const t0 = Date.now();
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, CORS);

  try {
    // ── 1. RATE-LIMIT (5 / 60 min per IP) ───────────────────
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") || "unknown";

    try {
      const { data: allowed, error: rlErr } = await sb.rpc("check_rate_limit", {
        p_key: `cleaner_app:${ip}`,
        p_max: 5,
        p_window_minutes: 60,
      });
      if (rlErr) {
        // Fail-open — vi vill inte blockera registreringar om RPC failar
        console.warn("[cleaner-application-submit] rate-limit RPC fel (fail-open):", rlErr.message);
      } else if (allowed === false) {
        return json({
          error: "rate_limit_exceeded",
          message: "Du har skickat för många ansökningar nyligen. Försök igen om 60 min.",
          retry_after_seconds: 3600,
        }, 429, CORS);
      }
    } catch (rlEx) {
      console.warn("[cleaner-application-submit] rate-limit exception (fail-open):", (rlEx as Error).message);
    }

    // ── 2. PARSE BODY + filtrera fält ───────────────────────
    const raw = await req.json().catch(() => null);
    if (!raw || typeof raw !== "object") {
      return json({ error: "invalid_body" }, 400, CORS);
    }

    const cleanData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (ALLOWED_FIELDS.has(key) && value !== undefined) {
        cleanData[key] = value;
      }
    }

    // ── 3. Minimal validering ───────────────────────────────
    if (!cleanData.email || typeof cleanData.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanData.email)) {
      return json({ error: "invalid_email" }, 400, CORS);
    }
    const fullName = (cleanData.full_name as string) || "";
    const firstName = (cleanData.first_name as string) || "";
    const lastName = (cleanData.last_name as string) || "";
    if (!fullName && !(firstName && lastName)) {
      return json({ error: "name_required" }, 400, CORS);
    }

    // ── 4. INSERT ───────────────────────────────────────────
    // Force status='pending' (ej från klient — privilege-escalation-skydd)
    cleanData.status = "pending";

    const { data: inserted, error: insErr } = await sb
      .from("cleaner_applications")
      .insert(cleanData)
      .select("id")
      .single();

    if (insErr) {
      // Duplicate email → 409
      if (insErr.message?.includes("23505") || insErr.message?.toLowerCase().includes("duplicate")) {
        return json({
          error: "email_already_registered",
          message: "Du har redan en ansökan hos oss. Kolla din e-post eller kontakta hello@spick.se.",
        }, 409, CORS);
      }
      console.error("[cleaner-application-submit] insert failed:", insErr.message);
      return json({
        error: "insert_failed",
        detail: insErr.message,
      }, 500, CORS);
    }

    return json({
      ok: true,
      application_id: inserted?.id,
      ms: Date.now() - t0,
    }, 201, CORS);

  } catch (err) {
    console.error("[cleaner-application-submit] unhandled:", (err as Error).message);
    return json({
      error: "internal_error",
      detail: (err as Error).message,
      ms: Date.now() - t0,
    }, 500, CORS);
  }
});

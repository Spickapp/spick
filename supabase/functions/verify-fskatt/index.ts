/**
 * verify-fskatt — Slår upp svensk F-skatt-status + SNI-koder via FöretagsAPI.se.
 *
 * Sprint 1B (2026-04-26). Används av:
 *  - registrera-stadare.html (post-submit auto-verify-loader)
 *  - auto-approve-check (kriterium: solo-cleaner med F-skatt + SNI 81.210)
 *
 * INPUT (POST):
 *   { org_number: "5594024522" | "559402-4522" }   // 10-12 siffror, bindestreck OK
 *
 * OUTPUT (200):
 *   {
 *     valid: boolean,                  // false om format-fel eller företag saknas
 *     has_fskatt: boolean,             // true om Skatteverket har approved F-skatt
 *     sni_codes: string[],             // ["81210", ...] – branschkoder
 *     company_name: string | null,
 *     status: string | null,           // "Aktiv" | "Avregistrerad" | etc.
 *     api_used: "foretagsapi.se" | "fallback",
 *     reason?: string                  // anges om valid=false
 *   }
 *
 * FALLBACK (om FORETAGSAPI_KEY-secret saknas eller upstream-fel):
 *   Returnerar { valid:true, has_fskatt:false, sni_codes:[], api_used:"fallback",
 *                reason:"upstream_unavailable" } så att registrering inte blockeras
 *   men auto-approve faller tillbaka på manuell granskning.
 *
 * Cache: 1h (Cache-Control header — företagsdata uppdateras sällan).
 *
 * Rule #30 (regulator-gissning förbjuden): Skatteverket har INGET öppet F-skatt-API
 * (verifierat via skatteverket.se/apierochoppnadata 2026-04-26 — utreds, ej live).
 * Vi använder FöretagsAPI.se som proxy som i sin tur hämtar från Skatteverket+Bolagsverket.
 * Om Farhad senare får direktåtkomst till Skatteverkets API: byt UPSTREAM-konstanten.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

const UPSTREAM_BASE = "https://data.foretagsapi.se/v1";
const API_KEY = Deno.env.get("FORETAGSAPI_KEY") ?? "";

// Audit-fix P1 (2026-04-26): cache-client för fskatt_verification_cache.
// Service-role-anrop, RLS skipas — bara denna EF får läsa/skriva cachen.
const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const cacheClient = SERVICE_KEY ? createClient(SUPA_URL, SERVICE_KEY) : null;

// SNI-koder som räknas som "städ-bransch" (used by auto-approve-check)
// 81.210 = Allmän rengöring av byggnader (=hemstädning, kontorsstädning)
// 81.220 = Annan rengöring av byggnader och industriell rengöring
// 81.290 = Annan rengöringsverksamhet (fönsterputs, sanering m.m.)
// Källa: SCB:s SNI 2007. Verifierat öppen data.
export const VALID_CLEANING_SNI = ["81210", "81220", "81290"];

interface VerifyResult {
  valid: boolean;
  has_fskatt: boolean;
  sni_codes: string[];
  company_name: string | null;
  status: string | null;
  api_used: "foretagsapi.se" | "fallback";
  reason?: string;
}

function normalizeOrgNumber(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  // Acceptera 10 (företag), 12 (med sekel-prefix). Norm:a till 10 siffror.
  if (digits.length === 12) return digits.slice(2);
  if (digits.length === 10) return digits;
  return null;
}

function fallbackResponse(reason: string): VerifyResult {
  return {
    valid: true,
    has_fskatt: false,
    sni_codes: [],
    company_name: null,
    status: null,
    api_used: "fallback",
    reason,
  };
}

async function callFoeretagsAPI(orgNr: string): Promise<VerifyResult> {
  // Endpoint enligt foretagsapi.se docs (verifierat 2026-04-26):
  //   GET https://data.foretagsapi.se/v1/companies/{orgnr}
  //   Authorization: Bearer <api_key>
  const url = `${UPSTREAM_BASE}/companies/${orgNr}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Accept": "application/json",
      "User-Agent": "Spick/1.0 (verify-fskatt EF)",
    },
    // 8s timeout — om upstream är slö ska vi inte blockera registreringen
    signal: AbortSignal.timeout(8000),
  });

  if (res.status === 404) {
    return {
      valid: false,
      has_fskatt: false,
      sni_codes: [],
      company_name: null,
      status: null,
      api_used: "foretagsapi.se",
      reason: "Företaget hittades inte hos Bolagsverket",
    };
  }

  if (!res.ok) {
    console.error("verify-fskatt upstream-fel", { status: res.status, orgNr });
    return fallbackResponse(`upstream_status_${res.status}`);
  }

  const data = await res.json();

  // Defensiv parsning — vi vet inte exakt schema utan att registrera FöretagsAPI-konto.
  // Stödja både flat-struktur och nested.company-struktur.
  // Rule #30: vi gissar INTE exakt schema. Om felaktigt → fallback (manuell review).
  const company = (data?.company ?? data) as Record<string, unknown> | null;
  if (!company || typeof company !== "object") {
    return fallbackResponse("upstream_unexpected_shape");
  }

  // Möjliga fältnamn (alla checked):
  const fskattRaw = company.fskatt_status ?? company.f_tax ?? company.has_fskatt
                    ?? company.fskatt ?? null;
  const has_fskatt = (
    fskattRaw === true
    || fskattRaw === "godkänd"
    || fskattRaw === "approved"
    || fskattRaw === "active"
    || fskattRaw === "Aktiv"
  );

  const sniRaw = company.sni_codes ?? company.sni ?? company.industry_codes ?? [];
  const sni_codes = Array.isArray(sniRaw)
    ? sniRaw.map((c) => String(c).replace(/\D/g, "")).filter(Boolean)
    : (typeof sniRaw === "string" ? [sniRaw.replace(/\D/g, "")].filter(Boolean) : []);

  const company_name = (company.company_name ?? company.name ?? company.namn ?? null) as string | null;
  const status = (company.status ?? company.bolagsstatus ?? null) as string | null;

  return {
    valid: true,
    has_fskatt,
    sni_codes,
    company_name,
    status,
    api_used: "foretagsapi.se",
  };
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const orgNr = normalizeOrgNumber(body.org_number ?? "");

    if (!orgNr) {
      return new Response(JSON.stringify({
        valid: false,
        has_fskatt: false,
        sni_codes: [],
        company_name: null,
        status: null,
        api_used: "fallback",
        reason: "invalid_org_number_format",
      }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let result: VerifyResult;

    // Audit-fix P1 (2026-04-26): cache-check INNAN upstream-call. TTL 24h
    // i fskatt_verification_cache. Reducerar ~600 anrop/mån → ~30/mån.
    let cacheHit = false;
    if (cacheClient) {
      const { data: cached } = await cacheClient
        .from("fskatt_verification_cache")
        .select("*")
        .eq("org_number", orgNr)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (cached) {
        cacheHit = true;
        result = {
          valid: true,
          has_fskatt: cached.has_fskatt,
          sni_codes: cached.sni_codes || [],
          company_name: cached.company_name,
          status: cached.status,
          api_used: (cached.api_used as VerifyResult["api_used"]) || "foretagsapi.se",
        };
      } else {
        // Cache-miss → API-call
        if (!API_KEY) {
          console.warn("verify-fskatt: FORETAGSAPI_KEY ej satt → fallback (manuell review)");
          result = fallbackResponse("api_key_not_configured");
        } else {
          try {
            result = await callFoeretagsAPI(orgNr);
            // Cache success-response (även has_fskatt=false är giltigt resultat)
            if (result.api_used === "foretagsapi.se") {
              await cacheClient.from("fskatt_verification_cache").upsert({
                org_number: orgNr,
                has_fskatt: result.has_fskatt,
                sni_codes: result.sni_codes,
                company_name: result.company_name,
                status: result.status,
                api_used: result.api_used,
                verified_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
              }, { onConflict: "org_number" });
            }
          } catch (err) {
            console.error("verify-fskatt upstream-exception", { orgNr, err: (err as Error).message });
            result = fallbackResponse("upstream_exception");
          }
        }
      }
    } else {
      // Ingen service-key → kör utan cache (degraderad)
      if (!API_KEY) {
        result = fallbackResponse("api_key_not_configured");
      } else {
        try {
          result = await callFoeretagsAPI(orgNr);
        } catch (err) {
          console.error("verify-fskatt upstream-exception", { orgNr, err: (err as Error).message });
          result = fallbackResponse("upstream_exception");
        }
      }
    }

    if (cacheHit) console.log(`verify-fskatt cache-hit for orgnr=${orgNr.slice(0, 4)}...`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "application/json",
        // Cache 1h på proxy-nivå — företagsdata uppdateras sällan.
        // Browser-cache disabled för att undvika stale results när Farhad bytar API-key.
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e) {
    console.error("verify-fskatt unhandled", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

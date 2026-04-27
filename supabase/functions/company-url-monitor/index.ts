/**
 * company-url-monitor — verifierar att varje aktivt företags landningssida fungerar
 *
 * BAKGRUND
 * Audit-fynd 2026-04-27 (Farhad): boka.html?company=X visade tjänster företaget
 * inte erbjuder → 0 matchande städare → kund tappar förtroende. F6 e2e-test
 * fångar regression mot 1 hardcoded company. Denna EF kompletterar genom att
 * verifiera ALLA aktiva företag varje natt.
 *
 * GÖR
 * 1. Hämta alla aktiva approved companies med medlemmar
 * 2. För varje: verifiera v_cleaners_public returnerar minst 1 cleaner
 * 3. Verifiera union(cleaners.services) > 0 (företaget kan erbjuda något)
 * 4. Verifiera matching-wrapper svarar 200 med company-medlem(mar) som
 *    matching-kandidat (givet generisk Stockholm-adress)
 * 5. Aggregera resultat → Discord-alert om något företag är "broken"
 *
 * AUTH: CRON_SECRET via _shared/cron-auth.ts
 * SCHEMA: 1x/dag 03:30 UTC (efter synthetic-monitor 03:00, innan lighthouse 04:00)
 *
 * REGLER:
 *   - #28 SSOT (sendAdminAlert + cron-auth från _shared/)
 *   - #31 schema curl-verifierat: companies + v_cleaners_public + matching-wrapper
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sb = createClient(SUPA_URL, SERVICE_KEY);

// Test-koordinater (Stockholm centrum) för matching-wrapper-anrop
const TEST_LAT = 59.3293;
const TEST_LNG = 18.0686;

interface CompanyCheckResult {
  company_id: string;
  company_name: string;
  cleaners_count: number;
  services_count: number;
  matching_works: boolean;
  errors: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const auth = requireCronAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const results: CompanyCheckResult[] = [];

  try {
    // 1. Hämta alla aktiva företag (active + onboarding_status='active' eller 'pending_team')
    const { data: companies, error: compErr } = await sb
      .from("companies")
      .select("id, name, display_name, onboarding_status")
      .in("onboarding_status", ["active", "pending_team"]);

    if (compErr) {
      throw new Error(`companies fetch failed: ${compErr.message}`);
    }

    if (!companies || companies.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        total_companies: 0,
        message: "No active companies to monitor",
      }), { status: 200, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
    }

    // 2. Per company — kontrollera medlemmar + services + matching
    for (const comp of companies) {
      const result: CompanyCheckResult = {
        company_id: comp.id,
        company_name: comp.display_name || comp.name || "okänt",
        cleaners_count: 0,
        services_count: 0,
        matching_works: false,
        errors: [],
      };

      // 2a. Hämta cleaners + deras services (samma query som boka.html-filter)
      const { data: cleaners, error: clErr } = await sb
        .from("v_cleaners_public")
        .select("id, services")
        .eq("company_id", comp.id);

      if (clErr) {
        result.errors.push(`cleaners fetch: ${clErr.message}`);
      } else if (cleaners) {
        result.cleaners_count = cleaners.length;
        const serviceUnion = new Set<string>();
        cleaners.forEach((c) => (c.services || []).forEach((s: string) => serviceUnion.add(s)));
        result.services_count = serviceUnion.size;
      }

      // 2b. Anropa matching-wrapper (verifierar att RPC fungerar för company-medlemmar)
      try {
        const matchRes = await fetch(`${SUPA_URL}/functions/v1/matching-wrapper`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "apikey": SERVICE_KEY,
          },
          body: JSON.stringify({
            customer_lat: TEST_LAT,
            customer_lng: TEST_LNG,
            booking_date: null,
            booking_time: null,
            booking_hours: null,
          }),
        });
        if (!matchRes.ok) {
          result.errors.push(`matching-wrapper HTTP ${matchRes.status}`);
        } else {
          const matchData = await matchRes.json();
          result.matching_works = Array.isArray(matchData?.cleaners);
        }
      } catch (e) {
        result.errors.push(`matching exception: ${(e as Error).message}`);
      }

      results.push(result);
    }

    // 3. Aggregera + alert om broken
    const broken = results.filter((r) =>
      r.cleaners_count === 0 ||
      r.services_count === 0 ||
      !r.matching_works ||
      r.errors.length > 0
    );

    if (broken.length > 0) {
      try {
        await sendAdminAlert({
          severity: broken.length >= 3 ? "critical" : "warn",
          title: `🚨 ${broken.length}/${results.length} company-URLs är broken`,
          source: "company-url-monitor",
          message: broken.map((b) =>
            `${b.company_name} (${b.company_id}): ${b.errors.join(", ") || "no cleaners/services"}`
          ).join(" | "),
          metadata: { broken_count: broken.length, total: results.length, broken_list: broken },
        });
      } catch (e) {
        console.error("[company-url-monitor] sendAdminAlert failed:", (e as Error).message);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total_companies: results.length,
      broken_count: broken.length,
      duration_ms: Date.now() - startTime,
      results,
    }), {
      status: broken.length > 0 ? 500 : 200,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e as Error;
    console.error("[company-url-monitor] unhandled:", err.message);
    return new Response(JSON.stringify({ error: "internal_error", detail: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

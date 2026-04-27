/**
 * elks-balance-monitor — daily 46elks-saldo-check + Discord-alert vid lågt saldo
 *
 * BAKGRUND
 * 2026-04-26 brände Spick alla 46elks-credits utan förvarning. SMS-flödet
 * (rating-reminder, booking-bekräftelse till cleaner, admin-approve VD-SMS)
 * failade tyst. Denna EF förebygger genom daglig saldo-check.
 *
 * BETEENDE
 *   1. Anropar 46elks balance-endpoint via Basic Auth
 *    https://api.46elks.com/a1/me (returnerar { balance, currency, etc })
 *   2. Om balance < THRESHOLD_SEK → sendAdminAlert severity=warn (Discord)
 *   3. Om balance < CRITICAL_SEK → sendAdminAlert severity=critical
 *   4. Skriver senaste mätning till platform_settings.elks_balance_last
 *
 * THRESHOLDS
 *   - LOW: 200 SEK (= ~500 SMS)
 *   - CRITICAL: 50 SEK (= ~125 SMS, akut påfyllning)
 *
 * AUTH: CRON_SECRET via _shared/cron-auth.ts.
 *
 * SCHEMA: 1x/dag 06:00 UTC via .github/workflows/elks-balance-monitor.yml
 *
 * REGLER:
 *   #28 SSOT (sendAdminAlert + cron-auth från _shared/)
 *   #30 inga regulator-claims
 *   #31 N/A (extern API + platform_settings finns)
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ELKS_USER = Deno.env.get("ELKS_API_USER") || "";
const ELKS_PASS = Deno.env.get("ELKS_API_PASSWORD") || "";

const LOW_THRESHOLD_SEK = 200;
const CRITICAL_THRESHOLD_SEK = 50;

const sb = createClient(SUPA_URL, SERVICE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const auth = requireCronAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  if (!ELKS_USER || !ELKS_PASS) {
    return new Response(JSON.stringify({ error: "ELKS_API_USER/PASSWORD ej satt" }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch("https://api.46elks.com/a1/me", {
      headers: {
        "Authorization": "Basic " + btoa(ELKS_USER + ":" + ELKS_PASS),
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      await sendAdminAlert({
        severity: "error",
        title: "46elks balance-API failed",
        source: "elks-balance-monitor",
        message: `HTTP ${res.status}: ${errText.slice(0, 200)}`,
      });
      return new Response(JSON.stringify({ ok: false, error: "elks_api_failed", status: res.status }), {
        status: 502,
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      });
    }

    const data = await res.json() as { balance?: number; currency?: string; [k: string]: unknown };
    const balance = typeof data.balance === "number" ? data.balance : 0;
    const currency = data.currency || "SEK";

    // Persistera senaste mätning till platform_settings
    await sb.from("platform_settings").upsert(
      {
        key: "elks_balance_last",
        value: JSON.stringify({ balance, currency, ts: new Date().toISOString() }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

    // Alert-logik
    let alertLevel: "ok" | "low" | "critical" = "ok";
    if (balance < CRITICAL_THRESHOLD_SEK) {
      alertLevel = "critical";
      await sendAdminAlert({
        severity: "critical",
        title: `🚨 46elks-saldo KRITISKT: ${balance} ${currency}`,
        source: "elks-balance-monitor",
        message: `Saldo under ${CRITICAL_THRESHOLD_SEK} SEK. Fyll på OMEDELBART för att undvika SMS-fail. https://46elks.se/sv/start`,
        metadata: { balance, currency, threshold: CRITICAL_THRESHOLD_SEK },
      });
    } else if (balance < LOW_THRESHOLD_SEK) {
      alertLevel = "low";
      await sendAdminAlert({
        severity: "warn",
        title: `⚠️ 46elks-saldo lågt: ${balance} ${currency}`,
        source: "elks-balance-monitor",
        message: `Saldo under ${LOW_THRESHOLD_SEK} SEK. Planera påfyllning. https://46elks.se/sv/start`,
        metadata: { balance, currency, threshold: LOW_THRESHOLD_SEK },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      balance,
      currency,
      alert_level: alertLevel,
      thresholds: { low: LOW_THRESHOLD_SEK, critical: CRITICAL_THRESHOLD_SEK },
    }), {
      status: 200,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e as Error;
    console.error("[elks-balance-monitor] unhandled:", err.message);
    return new Response(JSON.stringify({ error: "internal_error", detail: err.message }), {
      status: 500,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

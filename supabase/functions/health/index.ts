/**
 * health – Production health check endpoint
 * Verifierar: Supabase DB, Resend, Stripe, edge runtime
 * Anropas av: uptime-monitor, externa monitoring-verktyg
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

serve(async (req) => {
  // CORS
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const start = Date.now();
  const checks: Record<string, {
    ok: boolean;
    ms: number;
    error?: string;
    metrics?: Record<string, number>;
    minutes_since_last_run?: number;
  }> = {};

  // 1. Database connectivity + business metrics
  try {
    const t0 = Date.now();
    const sb = createClient(SUPA_URL, SUPA_KEY);
    const [cleanerRes, bookingRes, staleRes, reviewRes] = await Promise.all([
      sb.from("cleaners").select("id", { count: "exact", head: true }).eq("is_approved", true),
      sb.from("bookings").select("id", { count: "exact", head: true }).eq("payment_status", "paid"),
      sb.from("bookings").select("id", { count: "exact", head: true }).eq("payment_status", "pending").lt("created_at", new Date(Date.now() - 30*60*1000).toISOString()),
      sb.from("reviews").select("id", { count: "exact", head: true }),
    ]);
    const dbOk = !cleanerRes.error && !bookingRes.error;
    checks.database = { 
      ok: dbOk, ms: Date.now() - t0, 
      ...(cleanerRes.error && { error: cleanerRes.error.message }),
      metrics: {
        active_cleaners: cleanerRes.count || 0,
        paid_bookings: bookingRes.count || 0,
        stale_pending: staleRes.count || 0,
        total_reviews: reviewRes.count || 0,
      }
    };
  } catch (e) {
    checks.database = { ok: false, ms: 0, error: (e as Error).message };
  }

  // 2. Resend API
  try {
    const t0 = Date.now();
    const r = await fetch("https://api.resend.com/domains", {
      headers: { "Authorization": `Bearer ${RESEND_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    checks.resend = { ok: r.ok, ms: Date.now() - t0, ...(! r.ok && { error: `HTTP ${r.status}` }) };
  } catch (e) {
    checks.resend = { ok: false, ms: 0, error: (e as Error).message };
  }

  // 3. Stripe API
  try {
    const t0 = Date.now();
    if (!STRIPE_KEY) {
      checks.stripe = { ok: false, ms: 0, error: "STRIPE_SECRET_KEY not set" };
    } else {
      const r = await fetch("https://api.stripe.com/v1/balance", {
        headers: { "Authorization": `Bearer ${STRIPE_KEY}` },
        signal: AbortSignal.timeout(5000),
      });
      checks.stripe = { ok: r.ok, ms: Date.now() - t0, ...(! r.ok && { error: `HTTP ${r.status}` }) };
    }
  } catch (e) {
    checks.stripe = { ok: false, ms: 0, error: (e as Error).message };
  }

  // 4. Auto-remind heartbeat
  try {
    const t0 = Date.now();
    const sb2 = createClient(SUPA_URL, SUPA_KEY);
    const { data } = await sb2.from("platform_settings").select("value").eq("key", "auto_remind_last_run").single();
    const lastRun = data?.value ? new Date(data.value) : null;
    const minutesAgo = lastRun ? Math.round((Date.now() - lastRun.getTime()) / 60000) : null;
    const isHealthy = minutesAgo !== null && minutesAgo < 120;
    checks["auto_remind"] = {
      ok: isHealthy,
      ms: Date.now() - t0,
      ...(minutesAgo !== null ? { minutes_since_last_run: minutesAgo } : { error: "Aldrig körd" }),
    };
    if (!isHealthy) {
      // Audit-fix P2-2 (2026-04-26): byte från notify-EF till sendAdminAlert
      // (rätt observability-kanal — notify är för transaktionsmail till kund,
      // inte för admin-uptime-alarm). Discord-leverans + console-fallback.
      try {
        const { sendAdminAlert } = await import("../_shared/alerts.ts");
        await sendAdminAlert({
          severity: "error",
          title: "auto-remind degraderad",
          source: "health",
          message: `Senaste auto-remind körning: ${lastRun?.toISOString() || "aldrig"}. ${minutesAgo} min sedan (gräns 120 min). Kontrollera GitHub Actions.`,
          metadata: { minutes_since_last_run: minutesAgo, last_run: lastRun?.toISOString() },
        });
      } catch (e) {
        console.error("[health] sendAdminAlert failed:", (e as Error).message);
      }
    }
  } catch (e) {
    checks["auto_remind"] = { ok: false, ms: 0, error: (e as Error).message };
  }

  // 5. Edge runtime
  checks.runtime = { ok: true, ms: 0 };

  // Health-status-policy (§13.3 load-test-fix 2026-04-24):
  // - 503 = EF är otillgänglig (DB nere). Uptime-monitor triggar larm.
  // - 200 + status="degraded" = EF svarar men någon integration har issues
  //   (Resend/Stripe timeout etc.). Uptime OK men monitoring-dashboards
  //   kan flagga. Förhindrar false alarms vid normala API-hiccups och
  //   cascading failures under load (load-test 2026-04-24 visade 100%
  //   503-rate vid 50 VUs pga Resend/Stripe timeouts).
  const CRITICAL_CHECKS = ["database", "runtime"];
  const criticalOk = CRITICAL_CHECKS.every(k => checks[k]?.ok);
  const allOk = Object.values(checks).every(c => c.ok);
  const totalMs = Date.now() - start;

  const responseStatus = criticalOk ? 200 : 503;
  const statusLabel = allOk ? "healthy" : (criticalOk ? "degraded" : "down");

  return new Response(JSON.stringify({
    status: statusLabel,
    timestamp: new Date().toISOString(),
    total_ms: totalMs,
    checks,
    critical_checks: CRITICAL_CHECKS,
    version: "3.0.1-health-policy-split",
  }), {
    status: responseStatus,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      ...CORS,
    },
  });
});

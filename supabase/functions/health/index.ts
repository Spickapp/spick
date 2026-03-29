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
  const checks: Record<string, { ok: boolean; ms: number; error?: string }> = {};

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

  // 4. Edge runtime
  checks.runtime = { ok: true, ms: 0 };

  const allOk = Object.values(checks).every(c => c.ok);
  const totalMs = Date.now() - start;

  return new Response(JSON.stringify({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    total_ms: totalMs,
    checks,
    version: "3.0.0-security-sprint",
  }), {
    status: allOk ? 200 : 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      ...CORS,
    },
  });
});

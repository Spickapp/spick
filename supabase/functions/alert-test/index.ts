// ═══════════════════════════════════════════════════════════════
// SPICK – alert-test
// Manuell trigger för att verifiera att ADMIN_ALERT_WEBHOOK_URL
// (Discord/Slack) är korrekt deployd. Skickar ett test-alert med
// alla 4 severity-nivåer.
//
// ANVÄNDNING (browser eller curl):
//   GET https://urjeijcncsyuletprydy.supabase.co/functions/v1/alert-test
//   → skickar 4 test-alerts till webhook
//   → returnerar JSON-status
//
// Auth: ingen (öppen). Säkerhet via webhook-URL i ENV som inte exponeras.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert, type AlertSeverity } from "../_shared/alerts.ts";

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const ts = new Date().toISOString();
  const severities: AlertSeverity[] = ["info", "warn", "error", "critical"];
  const results: Array<{ severity: string; ok: boolean }> = [];

  for (const severity of severities) {
    const ok = await sendAdminAlert({
      severity,
      title: `Test-alert (${severity})`,
      source: "alert-test",
      message: `Detta är ett test från alert-test EF, triggat ${ts}. Om du ser detta meddelande funkar Discord-webhook.`,
      metadata: {
        test_run_at: ts,
        purpose: "Verifiera ADMIN_ALERT_WEBHOOK_URL deploy",
      },
    });
    results.push({ severity, ok });
  }

  return new Response(JSON.stringify({
    ok: true,
    triggered: results.length,
    results,
    webhook_configured: !!Deno.env.get("ADMIN_ALERT_WEBHOOK_URL"),
    ts,
  }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});

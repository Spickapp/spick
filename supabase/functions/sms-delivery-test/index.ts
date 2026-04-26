// ═══════════════════════════════════════════════════════════════
// SPICK – sms-delivery-test (manuellt-triggad weekly health check)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE:
//   Verifiera end-to-end att 46elks-leverans fungerar (saldo OK,
//   kredentialer OK, gateway OK). Spickar går regression-tyst
//   eftersom ingen idag larmar om sms-EF returnerar 5xx eller
//   46elks-saldot är slut.
//
// PATTERN (#28 SSOT):
//   Wrap:ar bara existerande sms-EF (POST {to, message}).
//   Ingen egen 46elks-implementation — om 46elks-API ändras
//   uppdaterar vi sms-EF, inte denna.
//
// AUTH (#27 + säkerhet):
//   Kräver Bearer CRON_SECRET via _shared/cron-auth.ts. Annars
//   skulle vem som helst kunna spam:a Farhad's mobil + dränera
//   46elks-saldot.
//
// ANROP:
//   POST /functions/v1/sms-delivery-test
//     Authorization: Bearer <CRON_SECRET>
//     Body: { "to_phone": "+46701234567", "message"?: "..." }
//
//   Returnerar:
//     { ok: true, attempted_at, sms_id, cost_ore }  vid success
//     { ok: false, attempted_at, error, status }    vid fail
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const DEFAULT_MESSAGE =
  "Spick weekly SMS-leverans-test. Du behover inte svara. Tid: " +
  new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── AUTH: kräv CRON_SECRET (eller service-role bakåtkompat) ──
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const attempted_at = new Date().toISOString();

  let to_phone: string | undefined;
  let message: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    to_phone = body.to_phone || body.to;
    message = body.message || DEFAULT_MESSAGE;
  } catch (_) {
    // tom body OK om to_phone kommer från header
  }

  if (!to_phone) {
    return new Response(
      JSON.stringify({
        ok: false,
        attempted_at,
        error: "to_phone krävs i body — sätt TEST_PHONE_NUMBER GitHub Secret",
      }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  if (!SERVICE_ROLE_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        attempted_at,
        error: "SUPABASE_SERVICE_ROLE_KEY ej satt i EF-env",
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // ── DELEGERA till sms-EF (SSOT — ingen egen 46elks-impl här) ──
  let smsResult: { status: number; body: any };
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sms`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: to_phone, message }),
    });
    const body = await r.json().catch(() => ({}));
    smsResult = { status: r.status, body };
  } catch (e) {
    const err = (e as Error).message;
    console.error(`[sms-delivery-test] fetch failed: ${err}`);
    return new Response(
      JSON.stringify({
        ok: false,
        attempted_at,
        error: `network_error: ${err}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // ── Logga till console (Supabase function-logs är vår audit-trail) ──
  if (smsResult.status >= 200 && smsResult.status < 300 && smsResult.body?.ok) {
    console.log(
      `[sms-delivery-test] OK to=${to_phone} sms_id=${smsResult.body.id} cost=${smsResult.body.cost}`,
    );
    return new Response(
      JSON.stringify({
        ok: true,
        attempted_at,
        sms_id: smsResult.body.id,
        to: smsResult.body.to,
        cost_ore: smsResult.body.cost,
      }),
      { headers: { "Content-Type": "application/json", ...CORS } },
    );
  }

  // ── Fail-path ──
  const errMsg = smsResult.body?.error || `sms-EF status ${smsResult.status}`;
  console.error(
    `[sms-delivery-test] FAIL to=${to_phone} status=${smsResult.status} err=${errMsg}`,
  );
  return new Response(
    JSON.stringify({
      ok: false,
      attempted_at,
      status: smsResult.status,
      error: errMsg,
      details: smsResult.body,
    }),
    {
      status: smsResult.status >= 400 ? smsResult.status : 502,
      headers: { "Content-Type": "application/json", ...CORS },
    },
  );
});

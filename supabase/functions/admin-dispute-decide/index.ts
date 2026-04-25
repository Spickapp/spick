// ═══════════════════════════════════════════════════════════════
// SPICK – admin-dispute-decide (Fas 8 §8.14 wrapper)
// ═══════════════════════════════════════════════════════════════
//
// Admin-JWT-wrapper runt dispute-admin-decide EF. Låter admin.html
// anropa dispute-beslut utan att ha service-role-key i frontend.
//
// PRIMÄRKÄLLA: dispute-admin-decide (§8.14) gör all business-logic.
// Denna EF är pure auth-gate.
//
// FLÖDE:
//   1. Validate admin-JWT (via is_admin() RPC)
//   2. Forward body till dispute-admin-decide med service-role
//   3. Inkludera admin.id som triggered_by_id för audit
//
// AUTH:
//   Bearer <admin-JWT>. Verifieras via is_admin()-RPC som returnerar
//   true om auth.uid finns i admin_users-tabellen.
//
// REGLER: #26 grep is_admin-pattern + dispute-admin-decide-signatur,
// #27 scope (pure wrapper, 0 business-logic), #28 SSOT =
// dispute-admin-decide EF för all dispute-beslut-logic,
// #30 money-critical delegerat till §8.14, admin-auth defensivt
// via service-definer RPC, #31 is_admin()-RPC deployad i §8.11
// migration.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const log = createLogger("admin-dispute-decide");

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Admin-JWT-verifiering via is_admin() RPC ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);

    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();

    if (userErr || !user) {
      return json(CORS, 401, { error: "invalid_auth" });
    }

    // is_admin() är SECURITY DEFINER — validerar auth.uid() mot admin_users
    const { data: adminCheck, error: adminErr } = await sbUser.rpc("is_admin");

    if (adminErr) {
      log("error", "is_admin check failed", { error: adminErr.message });
      return json(CORS, 500, { error: "admin_check_failed" });
    }
    if (!adminCheck) {
      log("warn", "Non-admin tried dispute-decide", {
        auth_user_id: user.id.slice(0, 8),
      });
      return json(CORS, 403, { error: "not_admin" });
    }

    // ── Forward till dispute-admin-decide med service-role + admin-id ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }

    const forwardRes = await fetch(`${SUPABASE_URL}/functions/v1/dispute-admin-decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({
        ...body,
        admin_id: user.id, // stämplar admin-id i audit-trail
      }),
    });

    const forwardJson = await forwardRes.json();

    log("info", "Dispute-decision forwarded", {
      admin_user_id: user.id.slice(0, 8),
      status: forwardRes.status,
      decision: (body as Record<string, unknown>).decision,
    });

    // Forward response-status + body utan modifikation
    return json(CORS, forwardRes.status, forwardJson);
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

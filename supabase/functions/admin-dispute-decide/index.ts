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
import { permissionErrorToResponse, requireAdmin } from "../_shared/permissions.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    // ── Admin-JWT-verifiering (centraliserad via _shared/permissions.ts) ──
    // Tidigare: is_admin() RPC + auth.getUser. requireAdmin lägger till
    // is_active=true-filter (stricter än is_admin() RPC, samma förbättring
    // som steg 2a införde i admin-pnr-update).
    let adminUserId: string;
    try {
      const ctx = await requireAdmin(req, sbService);
      adminUserId = ctx.userId;
    } catch (e) {
      const r = permissionErrorToResponse(e, CORS);
      if (r) return r;
      throw e;
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
        admin_id: adminUserId, // stämplar admin-id i audit-trail
      }),
    });

    const forwardJson = await forwardRes.json();

    log("info", "Dispute-decision forwarded", {
      admin_user_id: adminUserId.slice(0, 8),
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

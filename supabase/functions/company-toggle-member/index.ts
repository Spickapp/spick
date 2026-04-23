// ═══════════════════════════════════════════════════════════════
// SPICK – company-toggle-member (Fas 9 §9.1)
// ═══════════════════════════════════════════════════════════════
//
// VD pausar eller aktiverar en team-medlem. Pausade städare
// filtreras automatiskt bort från matching + publika profiler
// (prod-konvention: idx_cleaners_approval_active WHERE status='aktiv'
// + 7 EFs filterar .eq("status","aktiv") för bookings/matching).
//
// POST-payload:
//   { member_id: uuid, action: "pause" | "activate" }
//
// Auth: Bearer-token från VD:s session (samma mönster som
// company-invite-member). VD får bara toggla medlemmar i sitt
// eget företag, och får inte toggla sig själv.
//
// GILTIGA STATUS-VÄRDEN (från migration 20260330600001):
//   aktiv | pausad | avstängd | godkänd (legacy) | onboarding
//
//   - 'avstängd' är admin-only (ej toggle:bart av VD)
//   - 'onboarding' får inte paus:as (Stripe-flöde pågår)
//
// REGLER: #26 grep-före-bygge, #27 scope (bara toggle, ingen
// UI-change här), #28 SSOT för valid statusar (migration-primärkälla),
// #30 N/A, #31 primärkälla = migration 20260330600001.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPA_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "company-toggle-member",
    msg,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);

    const sbUser = createClient(SUPA_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();

    if (userErr || !user) {
      log("warn", "Invalid auth token", { error: userErr?.message });
      return json(CORS, 401, { error: "invalid_auth" });
    }

    // ── Body ──
    const body = await req.json();
    const { member_id, action } = body;

    if (!isValidUuid(member_id)) {
      return json(CORS, 400, { error: "invalid_member_id" });
    }
    if (action !== "pause" && action !== "activate") {
      return json(CORS, 400, { error: "invalid_action", allowed: ["pause", "activate"] });
    }

    // ── Fetch VD ──
    const { data: vdCleaner, error: vdErr } = await sbService
      .from("cleaners")
      .select("id, full_name, company_id, is_company_owner")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (vdErr || !vdCleaner) {
      log("warn", "No cleaner row for auth user", { auth_user_id: user.id });
      return json(CORS, 403, { error: "not_a_cleaner" });
    }
    if (!vdCleaner.is_company_owner || !vdCleaner.company_id) {
      return json(CORS, 403, { error: "not_a_company_owner" });
    }

    // Self-toggle förbjuden (VD kan inte paus:a sig själv via denna path)
    if (vdCleaner.id === member_id) {
      return json(CORS, 400, { error: "cannot_toggle_self" });
    }

    // ── Fetch target member ──
    const { data: target, error: targetErr } = await sbService
      .from("cleaners")
      .select("id, full_name, company_id, is_company_owner, status")
      .eq("id", member_id)
      .maybeSingle();

    if (targetErr || !target) {
      return json(CORS, 404, { error: "member_not_found" });
    }

    // Ownership-validering: målet måste tillhöra VD:s företag
    if (target.company_id !== vdCleaner.company_id) {
      log("warn", "Cross-company toggle attempt", {
        vd_id: vdCleaner.id,
        target_id: target.id,
        vd_company: vdCleaner.company_id,
        target_company: target.company_id,
      });
      return json(CORS, 403, { error: "not_team_member" });
    }

    // VD får inte toggla andra VDs (är company_owner)
    if (target.is_company_owner) {
      return json(CORS, 400, { error: "cannot_toggle_owner" });
    }

    // Status-gate: bara toggle om nuvarande är aktiv eller pausad
    // (onboarding = Stripe-flöde, avstängd = admin-only)
    if (target.status === "onboarding") {
      return json(CORS, 400, { error: "member_onboarding_in_progress" });
    }
    if (target.status === "avstängd") {
      return json(CORS, 400, { error: "member_suspended_by_admin" });
    }

    // No-op check
    const newStatus = action === "pause" ? "pausad" : "aktiv";
    if (target.status === newStatus) {
      return json(CORS, 200, {
        ok: true,
        member_id: target.id,
        new_status: newStatus,
        noop: true,
      });
    }

    // ── Update ──
    const { error: updateErr } = await sbService
      .from("cleaners")
      .update({ status: newStatus })
      .eq("id", member_id);

    if (updateErr) {
      log("error", "Update failed", {
        member_id, error: updateErr.message,
      });
      return json(CORS, 500, { error: "update_failed", details: updateErr.message });
    }

    log("info", "Member status toggled", {
      vd_id: vdCleaner.id,
      vd_name: vdCleaner.full_name,
      member_id: target.id,
      member_name: target.full_name,
      company_id: vdCleaner.company_id,
      from: target.status,
      to: newStatus,
      action,
    });

    return json(CORS, 200, {
      ok: true,
      member_id: target.id,
      member_name: target.full_name,
      previous_status: target.status,
      new_status: newStatus,
    });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

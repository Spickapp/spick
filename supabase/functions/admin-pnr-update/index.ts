// ═══════════════════════════════════════════════════════════════
// SPICK – admin-pnr-update (Audit-fix P2-2, 2026-04-26)
//
// BAKGRUND (audit 2026-04-26-test-admin-flow.md fynd #3):
//   admin-pnr-verifiering.html:204-221 markVerifiedManual() +
//   markUnverified() skriver pnr_verification_method direkt via
//   PostgREST. Förlitar sig 100% på RLS — om policyn försvinner i
//   en migration kan vem som helst med anon-key ändra PNR-status
//   (RUT-bedrägeri-vektor).
//
// FIX:
//   Wrapper-EF med JWT-verifiering + admin-roll-check innan
//   bookings.pnr_verification_method UPDATE. Loggar till
//   admin_audit_log.
//
// AUTH: kräver admin-JWT (samma mönster som admin-cancel-booking).
//
// REGLER:
//   #26 läst admin-pnr-verifiering.html:180-225 + admin-cancel-booking
//   #27 scope = exakt PNR-method-update, ingen sido-städning
//   #28 SSOT = återanvänder admin_audit_log + auth-mönster
//   #30 inga regulator-claims (PNR-flow är intern audit, ej SKV-call)
//   #31 schema curl-verifierat: bookings.pnr_verification_method,
//       pnr_verified_at finns. admin_audit_log-schema från
//       auto-approve-check/index.ts:109.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";
import { withSentry } from "../_shared/sentry.ts";
import { permissionErrorToResponse, requireAdmin } from "../_shared/permissions.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SUPA_URL, SERVICE_KEY);

const ALLOWED_METHODS = new Set([
  "bankid",
  "manual_klartext",
  "pending_bankid",
  "unverified",
]);

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(withSentry("admin-pnr-update", async (req) => {
  const t0 = Date.now();
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, CORS);

  try {
    // ── AUTH: admin-JWT (centraliserad via _shared/permissions.ts) ──
    let adminEmail: string;
    try {
      const ctx = await requireAdmin(req, sb);
      adminEmail = ctx.email;
    } catch (e) {
      const r = permissionErrorToResponse(e, CORS);
      if (r) return r;
      throw e;
    }

    // ── PARSE BODY ──────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { booking_id, pnr_verification_method, reason } = body as {
      booking_id?: string;
      pnr_verification_method?: string;
      reason?: string;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json({ error: "booking_id krävs" }, 400, CORS);
    }
    if (!pnr_verification_method || !ALLOWED_METHODS.has(pnr_verification_method)) {
      return json({
        error: "invalid_method",
        allowed: Array.from(ALLOWED_METHODS),
      }, 400, CORS);
    }

    // ── 1. SELECT befintlig booking (audit-trail) ───────────
    const { data: booking, error: selErr } = await sb
      .from("bookings")
      .select("id, pnr_verification_method, pnr_verified_at")
      .eq("id", booking_id)
      .maybeSingle();

    if (selErr) {
      return json({ error: "DB-fel vid SELECT", detail: selErr.message }, 500, CORS);
    }
    if (!booking) {
      return json({ error: "booking_not_found" }, 404, CORS);
    }

    const oldValue = {
      pnr_verification_method: booking.pnr_verification_method,
      pnr_verified_at: booking.pnr_verified_at,
    };

    // ── 2. UPDATE bookings ──────────────────────────────────
    const updates: Record<string, unknown> = {
      pnr_verification_method,
    };
    // Vid bankid (manual override) → sätt verified_at till nu.
    // Vid unverified/pending → rensa verified_at (användaren har inte verifierat).
    if (pnr_verification_method === "bankid") {
      updates.pnr_verified_at = new Date().toISOString();
    } else if (pnr_verification_method === "unverified" || pnr_verification_method === "pending_bankid") {
      updates.pnr_verified_at = null;
    }
    // manual_klartext: behåll befintlig pnr_verified_at om den finns

    const { error: updErr } = await sb
      .from("bookings")
      .update(updates)
      .eq("id", booking_id);

    if (updErr) {
      return json({
        error: "update_failed",
        detail: updErr.message,
      }, 500, CORS);
    }

    // ── 3. admin_audit_log ──────────────────────────────────
    try {
      await sb.from("admin_audit_log").insert({
        action: "pnr_method_update",
        resource_type: "booking",
        resource_id: booking_id,
        admin_email: adminEmail,
        old_value: oldValue,
        new_value: updates,
        reason: reason || `Admin-override till ${pnr_verification_method}`,
      });
    } catch (auditErr) {
      console.warn("[admin-pnr-update] audit_log failed:", (auditErr as Error).message);
    }

    return json({
      ok: true,
      booking_id,
      pnr_verification_method,
      pnr_verified_at: updates.pnr_verified_at ?? null,
      ms: Date.now() - t0,
    }, 200, CORS);

  } catch (err) {
    console.error("[admin-pnr-update] unhandled:", (err as Error).message);
    return json({
      error: "internal_error",
      detail: (err as Error).message,
      ms: Date.now() - t0,
    }, 500, CORS);
  }
}));

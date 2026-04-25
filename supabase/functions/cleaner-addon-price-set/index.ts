// ═══════════════════════════════════════════════════════════════
// SPICK – cleaner-addon-price-set (Fas 4 §4.8c)
// ═══════════════════════════════════════════════════════════════
//
// Cleaner sätter sin egen addon-pris ELLER markerar "ingår gratis".
// Default = service_addons.price_sek används om cleaner ej har override.
//
// PRIMÄRKÄLLA: Farhad-direktiv 2026-04-25 ("städaren välja själv pris
// eller om det ska ingå, annars default").
//
// AUTH: Cleaner-JWT (cleaners.email match). VD kan sätta för team-member
// (is_company_owner=true + cleaner_id i samma company_id).
//
// FLÖDE:
//   1. Validate JWT → cleaner-row
//   2. Validate input (addon_id UUID, action: 'custom'|'free'|'reset')
//   3. Auth: cleaner sätter för sig själv ELLER VD för team-member
//   4. UPSERT cleaner_addon_prices via service-role
//
// REGLER: #26 cleaner-JWT-pattern (booking-cancel-v2:27-72) + service_role-
// upsert-pattern, #27 scope (bara price-set, ingen list/get-EF), #28 SSOT
// (cleaner_addon_prices är override-tabell), #29 §4.8b SQL-snippet design
// reviewat, #30 ej regulator (rena priser), #31 cleaner_addon_prices-
// tabell verifieras via INSERT (RLS service-role bypass).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const log = createLogger("cleaner-addon-price-set");

const MAX_CUSTOM_PRICE_SEK = 5000; // safety-cap

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
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
    // ── Auth: JWT ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);
    if (token === ANON_KEY) {
      return json(CORS, 401, { error: "anon_token_rejected" });
    }

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    });
    if (!authRes.ok) {
      return json(CORS, 401, { error: "invalid_token" });
    }
    const authUser = await authRes.json();
    const userEmail = (authUser.email || "").toLowerCase().trim();
    if (!userEmail) {
      return json(CORS, 401, { error: "email_missing_in_token" });
    }

    // ── Resolve callern: cleaner-row ELLER admin ──
    const { data: caller } = await sb
      .from("cleaners")
      .select("id, company_id, is_company_owner")
      .eq("email", userEmail)
      .maybeSingle();

    let isAdmin = false;
    if (!caller) {
      // Fallback: kontrollera om user är admin (admin-vy från admin.html / admin-as)
      const { data: adminRow } = await sb
        .from("admin_users")
        .select("id")
        .eq("email", userEmail)
        .maybeSingle();
      if (!adminRow) {
        return json(CORS, 403, { error: "not_a_cleaner_or_admin" });
      }
      isAdmin = true;
    }

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const b = body as Record<string, unknown>;

    if (!isValidUuid(b.addon_id)) {
      return json(CORS, 400, { error: "invalid_addon_id" });
    }
    if (b.target_cleaner_id !== undefined && b.target_cleaner_id !== null && !isValidUuid(b.target_cleaner_id)) {
      return json(CORS, 400, { error: "invalid_target_cleaner_id" });
    }
    if (typeof b.action !== "string" || !["custom", "free", "reset"].includes(b.action)) {
      return json(CORS, 400, {
        error: "invalid_action",
        details: { allowed: ["custom", "free", "reset"] },
      });
    }
    const action = b.action as "custom" | "free" | "reset";
    const addonId = b.addon_id as string;
    // Admin MÅSTE explicit ange target_cleaner_id (de har ingen "egen" cleaner-row)
    if (isAdmin && !b.target_cleaner_id) {
      return json(CORS, 400, { error: "admin_requires_target_cleaner_id" });
    }
    const targetCleanerId = (b.target_cleaner_id as string | undefined) ?? (caller!.id as string);

    // ── Auth check ──
    if (isAdmin) {
      // Admin: target måste vara giltig cleaner-row (validering)
      const { data: targetCleaner } = await sb
        .from("cleaners")
        .select("id")
        .eq("id", targetCleanerId)
        .maybeSingle();
      if (!targetCleaner) {
        return json(CORS, 404, { error: "target_cleaner_not_found" });
      }
    } else if (targetCleanerId !== caller!.id) {
      // VD-flow: target måste vara i samma company
      if (!caller!.is_company_owner || !caller!.company_id) {
        return json(CORS, 403, { error: "not_authorized_for_target" });
      }
      const { data: targetCleaner } = await sb
        .from("cleaners")
        .select("company_id")
        .eq("id", targetCleanerId)
        .maybeSingle();
      if (!targetCleaner || targetCleaner.company_id !== caller!.company_id) {
        return json(CORS, 403, { error: "target_not_in_company" });
      }
    }

    // ── Validate custom_price_sek om action='custom' ──
    let customPriceSek: number | null = null;
    if (action === "custom") {
      const price = b.custom_price_sek;
      if (typeof price !== "number" || !Number.isFinite(price) || price < 0 || price > MAX_CUSTOM_PRICE_SEK) {
        return json(CORS, 400, {
          error: "invalid_custom_price_sek",
          details: { min: 0, max: MAX_CUSTOM_PRICE_SEK },
        });
      }
      customPriceSek = Math.round(price);
    }

    // ── Verifiera addon_id finns ──
    const { data: addonRow } = await sb
      .from("service_addons")
      .select("id, label_sv, price_sek")
      .eq("id", addonId)
      .maybeSingle();
    if (!addonRow) {
      return json(CORS, 404, { error: "addon_not_found" });
    }

    // ── Action-handling ──
    if (action === "reset") {
      // Ta bort override → cleaner använder default
      const { error: deleteErr } = await sb
        .from("cleaner_addon_prices")
        .delete()
        .eq("cleaner_id", targetCleanerId)
        .eq("addon_id", addonId);
      if (deleteErr) {
        log("error", "Reset DELETE failed", { target: targetCleanerId, addon: addonId, error: deleteErr.message });
        return json(CORS, 500, { error: "reset_failed" });
      }
      log("info", "Addon-price reset", { caller: caller?.id || `admin:${userEmail}`, target: targetCleanerId, addon_id: addonId, is_admin: isAdmin });
      return json(CORS, 200, {
        ok: true,
        action: "reset",
        target_cleaner_id: targetCleanerId,
        addon_id: addonId,
        effective_price_sek: addonRow.price_sek,
      });
    }

    // UPSERT (custom eller free)
    const { error: upsertErr } = await sb
      .from("cleaner_addon_prices")
      .upsert({
        cleaner_id: targetCleanerId,
        addon_id: addonId,
        custom_price_sek: customPriceSek,
        included_free: action === "free",
        updated_at: new Date().toISOString(),
      }, { onConflict: "cleaner_id,addon_id" });

    if (upsertErr) {
      log("error", "UPSERT failed", { target: targetCleanerId, addon: addonId, error: upsertErr.message });
      return json(CORS, 500, { error: "upsert_failed", details: upsertErr.message });
    }

    log("info", "Addon-price set", {
      caller: caller?.id || `admin:${userEmail}`, target: targetCleanerId, addon_id: addonId,
      action, custom_price_sek: customPriceSek, is_admin: isAdmin,
    });

    return json(CORS, 200, {
      ok: true,
      action,
      target_cleaner_id: targetCleanerId,
      addon_id: addonId,
      addon_label: addonRow.label_sv,
      custom_price_sek: customPriceSek,
      included_free: action === "free",
      default_price_sek: addonRow.price_sek,
    });
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    const errorStack = (err as Error).stack || '';
    log("error", "Unexpected error", { error: errorMsg, stack: errorStack.slice(0, 500) });
    return json(CORS, 500, { error: "internal_error", details: errorMsg });
  }
});

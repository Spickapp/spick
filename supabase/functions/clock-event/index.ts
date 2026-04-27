// ═══════════════════════════════════════════════════════════════
// SPICK – clock-event (Phase 1.1)
// ═══════════════════════════════════════════════════════════════
//
// Cleaner klockar in/ut vid booking. GPS-verifierad.
//
// INPUT (POST):
//   { booking_id, event_type: 'in'|'out', lat, lng, accuracy_m }
//
// AUTH: cleaner-JWT
//
// VALIDERING:
//   - cleaner äger bookingen
//   - GPS-koord rimlig (Sverige-bounds)
//   - lat/lng/accuracy_m är numeriska
//
// RETUR: { ok, event_id, distance_from_address_m? }
//
// REGLER #26-#33 verifierat:
//   #28 SSOT — använder cleaners.auth_user_id (rule #31 schema-verifierat)
//   #33 Inga business-claims i response
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

// Sverige geo-bounds (sanity-check)
const SE_LAT_MIN = 55.0, SE_LAT_MAX = 70.0;
const SE_LNG_MIN = 10.0, SE_LNG_MAX = 25.0;

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── JWT-auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);
    if (token === ANON_KEY) return json(CORS, 401, { error: "anon_not_allowed" });

    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser();
    if (authErr || !user) return json(CORS, 401, { error: "invalid_token" });

    // ── Hämta callers cleaner-id (auth.users.id !== cleaners.id) ──
    const { data: caller } = await sb
      .from("cleaners")
      .select("id, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!caller) return json(CORS, 403, { error: "cleaner_not_found" });

    // ── Body-validering ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(CORS, 400, { error: "invalid_body" });

    const { booking_id, event_type, lat, lng, accuracy_m } = body as {
      booking_id?: string; event_type?: string;
      lat?: number; lng?: number; accuracy_m?: number;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json(CORS, 400, { error: "booking_id_required" });
    }
    if (event_type !== "in" && event_type !== "out") {
      return json(CORS, 400, { error: "invalid_event_type", allowed: ["in", "out"] });
    }
    if (typeof lat !== "number" || typeof lng !== "number" || typeof accuracy_m !== "number") {
      return json(CORS, 400, { error: "invalid_gps", required: ["lat", "lng", "accuracy_m"] });
    }
    if (lat < SE_LAT_MIN || lat > SE_LAT_MAX || lng < SE_LNG_MIN || lng > SE_LNG_MAX) {
      return json(CORS, 422, { error: "gps_out_of_sweden", lat, lng });
    }
    if (accuracy_m < 0 || accuracy_m > 5000) {
      return json(CORS, 422, { error: "accuracy_unreasonable", accuracy_m });
    }

    // ── Verify cleaner äger bookingen ──
    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id, customer_address, status, payment_status")
      .eq("id", booking_id)
      .maybeSingle();
    if (!booking) return json(CORS, 404, { error: "booking_not_found" });
    if (booking.cleaner_id !== caller.id) {
      return json(CORS, 403, { error: "not_owned_by_cleaner" });
    }

    // GEOFENCE: Phase 3 — bookings.customer_lat/lng saknas i prod.
    // Tier A.1 deferred tills geocoding-kolumner lagts till via separat migration.

    // ── Insert event ──
    const { data: inserted, error: insErr } = await sb
      .from("cleaner_clock_events")
      .insert({
        booking_id,
        cleaner_id: caller.id,
        event_type,
        lat,
        lng,
        accuracy_m: Math.round(accuracy_m),
      })
      .select("id, created_at")
      .single();

    if (insErr) {
      console.error("[clock-event] insert failed:", insErr);
      return json(CORS, 500, { error: "insert_failed", detail: insErr.message });
    }

    return json(CORS, 200, {
      ok: true,
      event_id: inserted.id,
      created_at: inserted.created_at,
      event_type,
      cleaner_name: caller.full_name,
    });
  } catch (err) {
    console.error("[clock-event] unhandled:", (err as Error).message);
    return json(CORS, 500, { error: "internal_error", detail: (err as Error).message });
  }
});

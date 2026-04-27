// ═══════════════════════════════════════════════════════════════
// SPICK – incident-create (Phase 1.3)
// ═══════════════════════════════════════════════════════════════
//
// Cleaner rapporterar avvikelse på plats. Skapar booking_incidents-rad.
// Skickar admin-notis (asynkron via sendAdminAlert).
//
// INPUT (POST):
//   { booking_id, incident_type, description, photo_storage_path? }
//
// AUTH: cleaner-JWT
//
// VALIDERING:
//   - cleaner äger bookingen
//   - incident_type är giltig enum
//   - description 5-2000 tecken
//
// RETUR: { ok, incident_id }
//
// REGLER #26-#33 verifierat:
//   #28 SSOT — incident_type-enum matchar DB CHECK-constraint
//   #30 GDPR — description bör ej innehålla PII (CRA i UI text)
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ADMIN_EMAIL = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const VALID_TYPES = [
  "access_problem",
  "damaged_property",
  "missing_supplies",
  "safety_issue",
  "customer_complaint",
  "other",
] as const;

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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(CORS, 401, { error: "missing_auth" });
    const token = authHeader.slice(7);
    if (token === ANON_KEY) return json(CORS, 401, { error: "anon_not_allowed" });

    const sbAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: authErr } = await sbAuth.auth.getUser();
    if (authErr || !user) return json(CORS, 401, { error: "invalid_token" });

    const { data: caller } = await sb
      .from("cleaners")
      .select("id, full_name")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!caller) return json(CORS, 403, { error: "cleaner_not_found" });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(CORS, 400, { error: "invalid_body" });

    const { booking_id, incident_type, description, photo_storage_path } = body as {
      booking_id?: string; incident_type?: string; description?: string;
      photo_storage_path?: string;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json(CORS, 400, { error: "booking_id_required" });
    }
    if (!incident_type || !(VALID_TYPES as readonly string[]).includes(incident_type)) {
      return json(CORS, 400, { error: "invalid_incident_type", allowed: VALID_TYPES });
    }
    if (!description || typeof description !== "string"
        || description.length < 5 || description.length > 2000) {
      return json(CORS, 400, { error: "description_length", min: 5, max: 2000 });
    }

    // Verify cleaner äger bookingen
    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id, customer_name, customer_address, booking_date, service_type")
      .eq("id", booking_id)
      .maybeSingle();
    if (!booking) return json(CORS, 404, { error: "booking_not_found" });
    if (booking.cleaner_id !== caller.id) {
      return json(CORS, 403, { error: "not_owned_by_cleaner" });
    }

    // Insert incident
    const { data: inserted, error: insErr } = await sb
      .from("booking_incidents")
      .insert({
        booking_id,
        cleaner_id: caller.id,
        incident_type,
        description: description.trim(),
        photo_storage_path: photo_storage_path?.trim() || null,
      })
      .select("id, created_at")
      .single();

    if (insErr) {
      console.error("[incident-create] insert failed:", insErr);
      return json(CORS, 500, { error: "insert_failed", detail: insErr.message });
    }

    // Async: skicka admin-notis (failar tyst — inte kritisk för cleaner-flow)
    try {
      const { sendAdminAlert } = await import("../_shared/alerts.ts");
      await sendAdminAlert({
        severity: incident_type === "safety_issue" ? "critical" : "warning",
        title: `Avvikelse: ${incident_type}`,
        source: "incident-create",
        booking_id,
        cleaner_id: caller.id,
        metadata: {
          cleaner_name: caller.full_name,
          customer_name: booking.customer_name,
          service: booking.service_type,
          booking_date: booking.booking_date,
          description_preview: description.slice(0, 200),
        },
      });
    } catch (alertErr) {
      console.warn("[incident-create] admin-alert failed (non-fatal):", (alertErr as Error).message);
    }

    return json(CORS, 200, {
      ok: true,
      incident_id: inserted.id,
      created_at: inserted.created_at,
    });
  } catch (err) {
    console.error("[incident-create] unhandled:", (err as Error).message);
    return json(CORS, 500, { error: "internal_error", detail: (err as Error).message });
  }
});

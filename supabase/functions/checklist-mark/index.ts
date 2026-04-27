// ═══════════════════════════════════════════════════════════════
// SPICK – checklist-mark (Phase 1.2)
// ═══════════════════════════════════════════════════════════════
//
// Cleaner bockar av (eller av-bockar) en checklist-item per booking.
// Skapar UPSERT i booking_checklist_completions.
//
// INPUT (POST):
//   { booking_id, item_key, checked: bool }
//
// AUTH: cleaner-JWT
//
// VALIDERING:
//   - cleaner äger bookingen
//   - item_key finns i template för booking.service_type
//
// RETUR: { ok, completion_id, all_required_done?: bool }
//
// REGLER #26-#33 verifierat:
//   #28 SSOT — service_checklist_templates är primärkälla
//   #31 schema-verifierat via curl mot prod (cleaners.auth_user_id)
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

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
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!caller) return json(CORS, 403, { error: "cleaner_not_found" });

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(CORS, 400, { error: "invalid_body" });

    const { booking_id, item_key, checked } = body as {
      booking_id?: string; item_key?: string; checked?: boolean;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json(CORS, 400, { error: "booking_id_required" });
    }
    if (!item_key || typeof item_key !== "string") {
      return json(CORS, 400, { error: "item_key_required" });
    }
    if (typeof checked !== "boolean") {
      return json(CORS, 400, { error: "checked_must_be_boolean" });
    }

    // Verify cleaner äger bookingen + hämta service_type
    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id, service_type")
      .eq("id", booking_id)
      .maybeSingle();
    if (!booking) return json(CORS, 404, { error: "booking_not_found" });
    if (booking.cleaner_id !== caller.id) {
      return json(CORS, 403, { error: "not_owned_by_cleaner" });
    }

    // Verify item_key finns i template för service_type
    const { data: template } = await sb
      .from("service_checklist_templates")
      .select("items")
      .eq("service_label_sv", booking.service_type)
      .eq("active", true)
      .maybeSingle();

    let itemValid = false;
    let allRequiredKeys: string[] = [];
    if (template?.items && Array.isArray(template.items)) {
      const items = template.items as Array<{ key: string; required?: boolean }>;
      itemValid = items.some((i) => i.key === item_key);
      allRequiredKeys = items.filter((i) => i.required).map((i) => i.key);
    }

    if (!itemValid) {
      return json(CORS, 422, {
        error: "item_key_not_in_template",
        booking_service: booking.service_type,
        provided_key: item_key,
      });
    }

    // UPSERT completion (UNIQUE booking_id + item_key)
    const { data: upserted, error: upErr } = await sb
      .from("booking_checklist_completions")
      .upsert(
        {
          booking_id,
          item_key,
          checked,
          checked_at: checked ? new Date().toISOString() : null,
          checked_by_cleaner_id: checked ? caller.id : null,
        },
        { onConflict: "booking_id,item_key" },
      )
      .select("id")
      .single();

    if (upErr) {
      console.error("[checklist-mark] upsert failed:", upErr);
      return json(CORS, 500, { error: "upsert_failed", detail: upErr.message });
    }

    // Beräkna om alla required är klara
    let allRequiredDone = false;
    if (allRequiredKeys.length > 0) {
      const { data: doneRows } = await sb
        .from("booking_checklist_completions")
        .select("item_key")
        .eq("booking_id", booking_id)
        .eq("checked", true)
        .in("item_key", allRequiredKeys);
      const doneKeys = new Set((doneRows || []).map((r) => r.item_key));
      allRequiredDone = allRequiredKeys.every((k) => doneKeys.has(k));
    }

    return json(CORS, 200, {
      ok: true,
      completion_id: upserted.id,
      item_key,
      checked,
      all_required_done: allRequiredDone,
    });
  } catch (err) {
    console.error("[checklist-mark] unhandled:", (err as Error).message);
    return json(CORS, 500, { error: "internal_error", detail: (err as Error).message });
  }
});

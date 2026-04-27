// ═══════════════════════════════════════════════════════════════
// SPICK – proof-photo-upload (Tier A.2)
// ═══════════════════════════════════════════════════════════════
//
// Cleaner laddar upp foto-bevis (före/efter) per booking.
// Filen sparas i Supabase Storage 'booking-proofs', metadata i DB.
//
// INPUT (POST):
//   { booking_id, phase: 'before'|'after', file_base64, mime_type, caption? }
//
// AUTH: cleaner-JWT
//
// MAX FILE: 10 MB
// MIME: image/jpeg, image/png, image/webp
//
// REGLER #26-#33:
//   #28 SSOT — phase enum matchar DB CHECK
//   #30 GDPR — foton roteras efter 90d (separat job)
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "booking-proofs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^,]+,/, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
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

    const { booking_id, phase, file_base64, mime_type, caption } = body as {
      booking_id?: string; phase?: string;
      file_base64?: string; mime_type?: string; caption?: string;
    };

    if (!booking_id || typeof booking_id !== "string") {
      return json(CORS, 400, { error: "booking_id_required" });
    }
    if (phase !== "before" && phase !== "after") {
      return json(CORS, 400, { error: "phase_must_be_before_or_after" });
    }
    if (!file_base64 || typeof file_base64 !== "string") {
      return json(CORS, 400, { error: "file_base64_required" });
    }
    if (!mime_type || !(ALLOWED_MIME as readonly string[]).includes(mime_type)) {
      return json(CORS, 400, { error: "invalid_mime", allowed: ALLOWED_MIME });
    }

    const bytes = base64ToBytes(file_base64);
    if (bytes.byteLength > MAX_BYTES) {
      return json(CORS, 413, { error: "file_too_large", max_mb: 10, actual_kb: Math.round(bytes.byteLength/1024) });
    }

    // Verify booking ownership
    const { data: booking } = await sb
      .from("bookings")
      .select("id, cleaner_id")
      .eq("id", booking_id)
      .maybeSingle();
    if (!booking) return json(CORS, 404, { error: "booking_not_found" });
    if (booking.cleaner_id !== caller.id) {
      return json(CORS, 403, { error: "not_owned_by_cleaner" });
    }

    // Upload till Storage: booking-proofs/{booking_id}/{phase}-{timestamp}.{ext}
    const ext = mime_type.split("/")[1] === "jpeg" ? "jpg" : mime_type.split("/")[1];
    const storagePath = `${booking_id}/${phase}-${Date.now()}.${ext}`;

    const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, bytes, {
      contentType: mime_type,
      cacheControl: "3600",
      upsert: false,
    });

    if (upErr) {
      // Bucket kan saknas — graceful felmeddelande
      const msg = upErr.message || String(upErr);
      if (msg.toLowerCase().includes("not found")) {
        return json(CORS, 503, { error: "storage_bucket_missing", detail: "Skapa 'booking-proofs'-bucket via Supabase Dashboard." });
      }
      console.error("[proof-photo-upload] storage upload failed:", upErr);
      return json(CORS, 500, { error: "upload_failed", detail: msg });
    }

    // Insert metadata
    const { data: inserted, error: insErr } = await sb
      .from("booking_proof_photos")
      .insert({
        booking_id,
        cleaner_id: caller.id,
        phase,
        storage_path: storagePath,
        caption: caption?.slice(0, 500) || null,
      })
      .select("id, created_at")
      .single();

    if (insErr) {
      console.error("[proof-photo-upload] db insert failed:", insErr);
      return json(CORS, 500, { error: "insert_failed", detail: insErr.message });
    }

    return json(CORS, 200, {
      ok: true,
      photo_id: inserted.id,
      storage_path: storagePath,
      created_at: inserted.created_at,
    });
  } catch (err) {
    console.error("[proof-photo-upload] unhandled:", (err as Error).message);
    return json(CORS, 500, { error: "internal_error", detail: (err as Error).message });
  }
});

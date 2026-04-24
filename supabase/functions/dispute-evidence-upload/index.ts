// ═══════════════════════════════════════════════════════════════
// SPICK – dispute-evidence-upload (Fas 8 §8.13)
// ═══════════════════════════════════════════════════════════════
//
// Både kund och städare laddar upp foto-bevis (eller PDF) till en
// öppen dispute. Admin läser sedan samlad bevisning i dispute-
// admin-decide-UI. EU PWD kräver att bägge parter får presentera
// bevis innan admin beslutar.
//
// PRIMÄRKÄLLA: docs/architecture/dispute-escrow-system.md §4
// (storage-bucket) + §8 (frontend-bevis-flöde). Schema i
// migration 20260427000007 dispute_evidence-tabell.
//
// FLÖDE:
//   1. JWT auth → getUser
//   2. Validera input (dispute_id, filename, content_type, file_base64)
//   3. Fetch dispute + booking
//   4. Verify dispute öppen (resolved_at IS NULL, admin_decision IS NULL)
//   5. Ownership-detection: customer (booking.customer_email==JWT.email)
//      ELLER cleaner (cleaners.auth_user_id==JWT.user.id + tilldelad
//      bokningen). Sätter uploaded_by='customer'|'cleaner'.
//   6. Validate MIME (whitelist från schema-CHECK) + size ≤ 5 MB
//   7. Count existing evidence för (dispute_id, uploaded_by) → max 5
//   8. Upload till bucket 'dispute-evidence' med path
//      '{uploaded_by}/{user_id}/{dispute_id}/{timestamp}-{filename}'
//   9. INSERT dispute_evidence-rad (storage_path refererar bucket-path)
//
// OUT-OF-SCOPE:
//   - Admin-upload (admin samlar, inte laddar upp själv)
//   - Signed URLs för läsning (separat read-EF eller admin-UI-fetch)
//   - Byt/radera evidence (framtida: evidence_delete EF)
//
// AUDIT: dispute_evidence-raden är i sig själv audit-trail. Ingen
// canonical booking-event läggs till (events.ts saknar matchande
// event-type; scope-respekt #27 → ingen ny event-type i denna EF).
//
// REGLER: #26 grep dispute-open + dispute-cleaner-respond för
// JWT-auth + ownership-patterns. #27 scope (upload only, no list/
// delete/read). #28 SSOT = dispute_evidence-tabellen. #30 EU PWD:
// bägge parter ska kunna presentera bevis; denna EF säkerställer
// balanserad tillgång. #31 schema verifierat i prod
// (dispute_evidence + disputes + storage-bucket 'dispute-evidence'
// alla live per farhad-action-items.md 2026-04-24).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

// Schema-CHECK (migration 20260427000007 rad 150-154):
// mime IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')
// file_size_bytes <= 5 242 880 (5 MB)
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "application/pdf",
]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FILES_PER_PART = 5;

const BUCKET = "dispute-evidence";

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "dispute-evidence-upload",
    msg,
    ...extra,
    ts: new Date().toISOString(),
  }));
}

function isValidUuid(id: unknown): boolean {
  return typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/heic": return "heic";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}

// Sanera filnamn: behåll [a-zA-Z0-9._-], ersätt resten med '_', max 80 tecken.
function sanitizeFilename(name: string): string {
  const cleaned = (name || "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return cleaned || "evidence";
}

// Decoder för base64 → Uint8Array utan padding-lek.
function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(CORS, 405, { error: "method_not_allowed" });

  try {
    // ── Auth: JWT (customer ELLER cleaner) ──
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

    // ── Input ──
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(CORS, 400, { error: "invalid_body" });
    }
    const b = body as Record<string, unknown>;

    if (!isValidUuid(b.dispute_id)) {
      return json(CORS, 400, { error: "invalid_dispute_id" });
    }
    if (typeof b.content_type !== "string" || !ALLOWED_MIME.has(b.content_type)) {
      return json(CORS, 400, {
        error: "unsupported_mime",
        details: { allowed: Array.from(ALLOWED_MIME) },
      });
    }
    if (typeof b.file_base64 !== "string" || b.file_base64.length === 0) {
      return json(CORS, 400, { error: "file_base64_required" });
    }

    const disputeId = b.dispute_id as string;
    const mime = b.content_type as string;
    const rawFilename = typeof b.filename === "string" ? b.filename : "";
    const filename = sanitizeFilename(rawFilename);

    // ── Decode + size-check (före storage-upload) ──
    const bytes = base64ToBytes(b.file_base64 as string);
    if (!bytes) {
      return json(CORS, 400, { error: "invalid_base64" });
    }
    if (bytes.byteLength === 0) {
      return json(CORS, 400, { error: "empty_file" });
    }
    if (bytes.byteLength > MAX_BYTES) {
      return json(CORS, 413, {
        error: "file_too_large",
        details: { max_bytes: MAX_BYTES, got_bytes: bytes.byteLength },
      });
    }

    // ── Fetch dispute ──
    const { data: dispute, error: disputeErr } = await sbService
      .from("disputes")
      .select("id, booking_id, admin_decision, resolved_at")
      .eq("id", disputeId)
      .maybeSingle();

    if (disputeErr) {
      log("error", "Dispute fetch failed", { dispute_id: disputeId, error: disputeErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }
    if (!dispute) {
      return json(CORS, 404, { error: "dispute_not_found" });
    }
    if (dispute.resolved_at || dispute.admin_decision) {
      return json(CORS, 422, {
        error: "dispute_closed",
        details: { resolved_at: dispute.resolved_at, admin_decision: dispute.admin_decision },
      });
    }

    // ── Fetch booking för ownership-koll ──
    const { data: booking, error: bookingErr } = await sbService
      .from("bookings")
      .select("id, customer_email, cleaner_id")
      .eq("id", dispute.booking_id as string)
      .maybeSingle();

    if (bookingErr || !booking) {
      return json(CORS, 404, { error: "booking_not_found" });
    }

    // ── Ownership-detection ──
    // 1) Customer: JWT-email matchar booking.customer_email
    // 2) Cleaner: cleaners.auth_user_id matchar JWT.user.id + tilldelad
    let uploadedBy: "customer" | "cleaner" | null = null;
    const jwtEmail = user.email?.toLowerCase().trim() || "";
    const bookingEmail = (booking.customer_email as string | null)?.toLowerCase().trim() || "";

    if (jwtEmail && bookingEmail && jwtEmail === bookingEmail) {
      uploadedBy = "customer";
    } else {
      const { data: cleaner } = await sbService
        .from("cleaners")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (cleaner && booking.cleaner_id === cleaner.id) {
        uploadedBy = "cleaner";
      }
    }

    if (!uploadedBy) {
      log("warn", "Evidence-upload ownership mismatch", {
        dispute_id: disputeId,
        booking_id: booking.id,
        user_id: user.id,
      });
      return json(CORS, 403, { error: "not_dispute_party" });
    }

    // ── Count-limit: max 5 per part per dispute ──
    const { count, error: countErr } = await sbService
      .from("dispute_evidence")
      .select("id", { count: "exact", head: true })
      .eq("dispute_id", disputeId)
      .eq("uploaded_by", uploadedBy);

    if (countErr) {
      log("error", "Evidence-count failed", { dispute_id: disputeId, error: countErr.message });
      return json(CORS, 500, { error: "count_failed" });
    }
    if ((count || 0) >= MAX_FILES_PER_PART) {
      return json(CORS, 422, {
        error: "max_files_reached",
        details: { max: MAX_FILES_PER_PART, current: count },
      });
    }

    // ── Upload till storage ──
    // Path-konvention per arkitektur-doc §4: '{role}/{user_id}/{dispute_id}/...'
    const ext = extFromMime(mime);
    const baseName = filename.includes(".") ? filename.replace(/\.[^.]+$/, "") : filename;
    const storagePath = `${uploadedBy}/${user.id}/${disputeId}/${Date.now()}-${baseName}.${ext}`;

    const { error: uploadErr } = await sbService
      .storage
      .from(BUCKET)
      .upload(storagePath, bytes, {
        contentType: mime,
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadErr) {
      log("error", "Storage upload failed", {
        dispute_id: disputeId,
        storage_path: storagePath,
        error: uploadErr.message,
      });
      return json(CORS, 500, { error: "upload_failed", details: uploadErr.message });
    }

    // ── INSERT dispute_evidence-rad ──
    const { data: evidenceRow, error: insertErr } = await sbService
      .from("dispute_evidence")
      .insert({
        dispute_id: disputeId,
        uploaded_by: uploadedBy,
        storage_path: storagePath,
        file_size_bytes: bytes.byteLength,
        mime_type: mime,
      })
      .select("id, uploaded_at")
      .single();

    if (insertErr) {
      // Rollback: radera storage-objektet om DB-insert failade
      await sbService.storage.from(BUCKET).remove([storagePath]).catch(() => {});
      log("error", "Evidence insert failed", {
        dispute_id: disputeId,
        storage_path: storagePath,
        error: insertErr.message,
      });
      return json(CORS, 500, { error: "evidence_insert_failed" });
    }

    log("info", "Evidence uploaded", {
      dispute_id: disputeId,
      evidence_id: evidenceRow.id,
      uploaded_by: uploadedBy,
      bytes: bytes.byteLength,
      mime,
    });

    return json(CORS, 200, {
      ok: true,
      evidence_id: evidenceRow.id,
      dispute_id: disputeId,
      uploaded_by: uploadedBy,
      storage_path: storagePath,
      uploaded_at: evidenceRow.uploaded_at,
      remaining_slots: MAX_FILES_PER_PART - ((count || 0) + 1),
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

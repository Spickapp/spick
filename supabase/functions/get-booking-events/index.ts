// ═══════════════════════════════════════════════════════════════
// SPICK – get-booking-events (Fas 6 §6.4-§6.6)
// ═══════════════════════════════════════════════════════════════
//
// Returnerar booking_events för en bokning med role-baserad filter.
// RLS på booking_events blockar direkta SELECT från authenticated-
// role → denna EF är den enda vägen för frontend att läsa events.
//
// PRIMÄRKÄLLA: docs/architecture/event-schema.md §8 (frontend-
// exponering). Tabell-RLS i migration 20260401181153 rad 104.
//
// FLÖDE:
//   1. JWT → getUser
//   2. Fetch booking (customer_email, cleaner_id, company_id)
//   3. Determine role:
//      - admin = admin_users-rad för user.id (om tabellen finns)
//      - customer = booking.customer_email === user.email
//      - company_owner = cleaners.company_id === booking.company_id
//                       + cleaners.is_company_owner = true
//      - cleaner = cleaners.id === booking.cleaner_id
//   4. Query booking_events via service_role
//   5. Filter events per role (whitelist för customer/cleaner, ALLA
//      för admin/company_owner)
//
// OUT-OF-SCOPE:
//   - Paginering (≤50 events per bokning är realistiskt idag)
//   - Write/update events (görs via _shared/events.ts → RPC)
//
// REGLER: #27 scope (read-only), #28 SSOT = events.ts EVENT_METADATA
// + booking_events-tabell, #31 schema verifierat: RLS 'service_role
// manage booking_events' på tabell (migration 20260401181153:104).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const sbService = createClient(SUPABASE_URL, SERVICE_KEY);

// Event-type-whitelist per role. Admin + company_owner ser allt.
const CUSTOMER_WHITELIST = new Set([
  "booking_created",
  "cleaner_assigned",
  "cleaner_reassigned",
  "checkin",
  "checkout",
  "completed",
  "payment_received",
  "payment_captured",
  "escrow_held",
  "escrow_released",
  "refund_issued",
  "cancelled_by_customer",
  "cancelled_by_cleaner",
  "cancelled_by_admin",
  "noshow_reported",
  "dispute_opened",
  "dispute_cleaner_responded",
  "dispute_resolved",
  "review_submitted",
  "recurring_generated",
  "recurring_skipped",
  "recurring_paused",
  "recurring_resumed",
  "recurring_cancelled",
  "schedule_changed",
]);

const CLEANER_WHITELIST = new Set([
  "cleaner_assigned",
  "cleaner_reassigned",
  "cleaner_invited",
  "cleaner_declined",
  "checkin",
  "checkout",
  "completed",
  "cancelled_by_customer",
  "cancelled_by_admin",
  "dispute_opened",
  "dispute_cleaner_responded",
  "dispute_resolved",
  "review_submitted",
  "schedule_changed",
]);

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function log(level: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    fn: "get-booking-events",
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
  if (req.method !== "GET" && req.method !== "POST") {
    return json(CORS, 405, { error: "method_not_allowed" });
  }

  try {
    // ── Auth ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json(CORS, 401, { error: "missing_auth" });
    }
    const token = authHeader.slice(7);

    const sbUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await sbUser.auth.getUser();
    if (userErr || !user) return json(CORS, 401, { error: "invalid_auth" });

    // ── Parse booking_id ──
    let bookingId: string | null = null;
    if (req.method === "GET") {
      const url = new URL(req.url);
      bookingId = url.searchParams.get("booking_id");
    } else {
      const body = await req.json().catch(() => null);
      bookingId = body && typeof body === "object"
        ? (body as Record<string, unknown>).booking_id as string
        : null;
    }
    if (!isValidUuid(bookingId)) {
      return json(CORS, 400, { error: "invalid_booking_id" });
    }

    // ── Fetch booking ──
    const { data: booking } = await sbService
      .from("bookings")
      .select("id, customer_email, cleaner_id, company_id")
      .eq("id", bookingId as string)
      .maybeSingle();

    if (!booking) return json(CORS, 404, { error: "booking_not_found" });

    const jwtEmail = user.email?.toLowerCase().trim() || "";
    const bookingEmail = (booking.customer_email as string | null)?.toLowerCase().trim() || "";

    // ── Determine role ──
    let role: "admin" | "customer" | "cleaner" | "company_owner" | null = null;

    // 1) Admin-check via email (admin_users.email är primärnyckeln,
    // matchar is_admin()-funktionen i 20260429000001-fixen).
    // Tidigare bug: refererade admin_users.user_id (kolumn finns ej) →
    // admin-check failade tyst, admins fick customer-events istället.
    try {
      const adminEmail = user.email?.toLowerCase().trim() || "";
      if (adminEmail) {
        const { data: adminRow } = await sbService
          .from("admin_users")
          .select("id")
          .eq("email", adminEmail)
          .maybeSingle();
        if (adminRow) role = "admin";
      }
    } catch (_) { /* tabell kanske inte existerar — fortsätt */ }

    // 2) Customer-check
    if (!role && jwtEmail && bookingEmail && jwtEmail === bookingEmail) {
      role = "customer";
    }

    // 3) Cleaner / company_owner-check
    if (!role) {
      const { data: cleaner } = await sbService
        .from("cleaners")
        .select("id, company_id, is_company_owner")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (cleaner) {
        if (
          cleaner.is_company_owner &&
          booking.company_id &&
          cleaner.company_id === booking.company_id
        ) {
          role = "company_owner";
        } else if (booking.cleaner_id === cleaner.id) {
          role = "cleaner";
        }
      }
    }

    if (!role) {
      log("warn", "Events-access denied", {
        booking_id: bookingId,
        user_id: user.id,
      });
      return json(CORS, 403, { error: "not_booking_party" });
    }

    // ── Fetch events (service_role bypassar RLS) ──
    const { data: events, error: eventsErr } = await sbService
      .from("booking_events")
      .select("id, event_type, actor_type, metadata, created_at")
      .eq("booking_id", bookingId as string)
      .order("created_at", { ascending: false })
      .limit(200);

    if (eventsErr) {
      log("error", "Events fetch failed", { booking_id: bookingId, error: eventsErr.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }

    // ── Role-filter ──
    let filtered = events || [];
    if (role === "customer") {
      filtered = filtered.filter((e) => CUSTOMER_WHITELIST.has(e.event_type as string));
    } else if (role === "cleaner") {
      filtered = filtered.filter((e) => CLEANER_WHITELIST.has(e.event_type as string));
    }
    // admin + company_owner: ingen filter, ser allt.

    return json(CORS, 200, {
      ok: true,
      role,
      events: filtered,
      count: filtered.length,
    });
  } catch (err) {
    log("error", "Unexpected", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

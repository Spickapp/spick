// export-cleaner-data — Fas 8 §8.20
// ═══════════════════════════════════════════════════════════════
// GDPR Art 15 (right of access) + Art 20 (data portability)
// EU Platform Work Directive — data-exporträtt för städare.
//
// POST (no body) med Authorization: Bearer <JWT>
// → JSON med all cleaner-data i strukturerat format.
//
// Auth: JWT → auth.uid() matchas mot cleaners.auth_user_id.
// Returnerar 401 om token saknas, 403 om auth-user inte är städare.
//
// Primärkälla: docs/architecture/dispute-escrow-system.md §8.20
// Rule #31: Alla tabeller verifierade via information_schema 2026-04-24
//           (35 cleaner_id-tabeller hittade, 25 valda per rule #27 scope).
// Rule #30: Inga antaganden om GDPR-format utöver vad arkitektur-doc specar.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";

const SUPA_URL  = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ── 1. Auth: JWT → auth.uid() → cleaner ────────────────────
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token || token === SUPA_ANON) {
    return json(401, { error: "Authorization required (cleaner JWT)" });
  }

  let authUserId: string;
  try {
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPA_ANON },
    });
    if (!authRes.ok) return json(401, { error: "Invalid token" });
    const authUser = await authRes.json();
    authUserId = authUser.id;
    if (!authUserId) return json(401, { error: "No user in token" });
  } catch (e) {
    log("error", "export-cleaner-data", "Auth check failed", { error: (e as Error).message });
    return json(401, { error: "Auth verification failed" });
  }

  const sb = createClient(SUPA_URL, SERVICE_KEY);

  const { data: cleaner, error: cErr } = await sb
    .from("cleaners")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (cErr) {
    log("error", "export-cleaner-data", "Cleaner lookup failed", { error: cErr.message });
    return json(500, { error: cErr.message });
  }
  if (!cleaner) {
    return json(403, { error: "Ingen städarprofil kopplad till detta konto" });
  }

  const cid = cleaner.id as string;

  // ── 2. Parallella fetches för cleaner-specifika tabeller ──
  const fetchCleanerTable = async (table: string, col: string = "cleaner_id") => {
    const { data, error } = await sb.from(table).select("*").eq(col, cid);
    if (error) {
      log("warn", "export-cleaner-data", `Fetch failed: ${table}`, { error: error.message });
      return [];
    }
    return data || [];
  };

  const [
    bookings,
    ratings,
    calendarEvents,
    availabilityV2,
    blockedDates,
    slotHolds,
    referrals,
    customerRelations,
    bookingPrefs,
    avoidTypes,
    petPrefs,
    preferredZones,
    servicePrices,
    skills,
    zones,
    commissionLog,
    bookingPhotos,
    bookingStaff,
    bookingTeam,
  ] = await Promise.all([
    fetchCleanerTable("bookings"),
    fetchCleanerTable("ratings"),
    fetchCleanerTable("calendar_events"),
    fetchCleanerTable("cleaner_availability_v2"),
    fetchCleanerTable("cleaner_blocked_dates"),
    // cleaner_languages borttagen 2026-04-25 (Fas 2-utökning §2.1.2):
    // tabellen DROP:ad, embedded cleaners.languages TEXT[] är SSOT (rule #28).
    fetchCleanerTable("subscription_slot_holds"),
    fetchCleanerTable("cleaner_referrals"),
    fetchCleanerTable("cleaner_customer_relations"),
    fetchCleanerTable("cleaner_booking_prefs"),
    fetchCleanerTable("cleaner_avoid_types"),
    fetchCleanerTable("cleaner_pet_prefs"),
    fetchCleanerTable("cleaner_preferred_zones"),
    fetchCleanerTable("cleaner_service_prices"),
    fetchCleanerTable("cleaner_skills"),
    fetchCleanerTable("cleaner_zones"),
    fetchCleanerTable("commission_log"),
    fetchCleanerTable("booking_photos"),
    fetchCleanerTable("booking_staff"),
    fetchCleanerTable("booking_team"),
  ]);

  // ── 3. Tabeller som refererar cleaner via booking_id (JOIN) ──
  const bookingIds = (bookings as Array<{ id: string }>).map((b) => b.id);

  const fetchByBookingIds = async (table: string) => {
    if (bookingIds.length === 0) return [];
    const { data, error } = await sb.from(table).select("*").in("booking_id", bookingIds);
    if (error) {
      log("warn", "export-cleaner-data", `Fetch-by-booking failed: ${table}`, { error: error.message });
      return [];
    }
    return data || [];
  };

  const [
    disputes,
    payoutAttempts,
    payoutAuditLog,
  ] = await Promise.all([
    fetchByBookingIds("disputes"),
    fetchByBookingIds("payout_attempts"),
    fetchByBookingIds("payout_audit_log"),
  ]);

  // ── 4. Företags-koppling (om städaren tillhör företag) ──
  let company: unknown = null;
  if (cleaner.company_id) {
    const { data } = await sb
      .from("companies")
      .select("id, name, display_name, org_number, created_at")
      .eq("id", cleaner.company_id as string)
      .maybeSingle();
    company = data;
  }

  // ── 5. Bygg export ──────────────────────────────────────────
  const exportedAt = new Date().toISOString();
  const exportData = {
    export_metadata: {
      generated_at: exportedAt,
      generated_for_cleaner_id: cid,
      generated_for_email: cleaner.email,
      gdpr_articles: [
        "Article 15 (right of access)",
        "Article 20 (data portability)",
      ],
      eu_pwd_reference: "EU Platform Work Directive",
      format: "JSON",
      generator: "Spick export-cleaner-data v1",
      retention_note:
        "Denna fil innehåller alla personuppgifter Spick har om dig. Förvara säkert.",
    },
    profile: cleaner,
    company,
    bookings,
    ratings,
    disputes,
    payout_attempts: payoutAttempts,
    payout_audit_log: payoutAuditLog,
    commission_log: commissionLog,
    calendar_events: calendarEvents,
    availability_v2: availabilityV2,
    blocked_dates: blockedDates,
    subscription_slot_holds: slotHolds,
    referrals,
    customer_relations: customerRelations,
    booking_prefs: bookingPrefs,
    avoid_types: avoidTypes,
    pet_prefs: petPrefs,
    preferred_zones: preferredZones,
    service_prices: servicePrices,
    skills,
    zones,
    booking_photos: bookingPhotos,
    booking_staff: bookingStaff,
    booking_team: bookingTeam,
  };

  log("info", "export-cleaner-data", "Export generated", {
    cleaner_id: cid,
    email: cleaner.email,
    bookings_count: bookings.length,
    ratings_count: ratings.length,
    total_sections: 23,
  });

  return json(200, exportData);
});

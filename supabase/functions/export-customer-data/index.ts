// export-customer-data — Fas 13 §13.4 gap A1
// ═══════════════════════════════════════════════════════════════
// GDPR Art 15 (right of access) + Art 20 (data portability) för kunder.
//
// Speglar export-cleaner-data (Fas 8 §8.20) men för customer-scope.
// Customer identifieras via magic-link JWT → auth.getUser().email →
// customer_email-match mot bookings/subscriptions/preferences/etc.
//
// POST (no body) med Authorization: Bearer <JWT>
// → JSON med all customer-data i strukturerat format.
//
// Auth: JWT → auth.uid() + email → customer_email-match.
// Returnerar 401 om token saknas, 403 om email inte finns i någon
// customer-tabell.
//
// Rule #30: Tolkar inte GDPR-artiklar. Speglar bara existerande
//           export-cleaner-data-mönster för customer-scope.
// Rule #31: Alla tabeller verifierade mot prod (curl limit=0 —
//           alla 5 returnerar 200/401, ingen 404).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) =>
    new Response(JSON.stringify(d), {
      status: s,
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ── 1. Auth: JWT → auth.uid() → email ──────────────────────
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
  if (!token || token === SUPA_ANON) {
    return json(401, { error: "Authorization required (customer JWT via magic link)" });
  }

  let email: string;
  try {
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPA_ANON },
    });
    if (!authRes.ok) return json(401, { error: "Invalid token" });
    const authUser = await authRes.json();
    email = (authUser.email || "").toLowerCase().trim();
    if (!email) return json(401, { error: "No email in token" });
  } catch (e) {
    log("error", "export-customer-data", "Auth check failed", {
      error: (e as Error).message,
    });
    return json(401, { error: "Auth verification failed" });
  }

  const sb = createClient(SUPA_URL, SERVICE_KEY);

  // ── 2. Parallella fetches för customer-tabeller ────────────
  const fetchByEmail = async (table: string, col: string = "customer_email") => {
    const { data, error } = await sb.from(table).select("*").eq(col, email);
    if (error) {
      log("warn", "export-customer-data", `Fetch failed: ${table}`, {
        error: error.message,
      });
      return [];
    }
    return data || [];
  };

  // customer_profiles använder `email` istället för `customer_email`
  const fetchProfile = async () => {
    const { data, error } = await sb
      .from("customer_profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      log("warn", "export-customer-data", "Profile fetch failed", {
        error: error.message,
      });
      return null;
    }
    return data;
  };

  const [
    profile,
    bookings,
    subscriptions,
    preferences,
    credits,
    slotHolds,
  ] = await Promise.all([
    fetchProfile(),
    fetchByEmail("bookings"),
    fetchByEmail("subscriptions"),
    fetchByEmail("customer_preferences"),
    fetchByEmail("customer_credits"),
    fetchByEmail("subscription_slot_holds").catch(() => []),
  ]);

  // ── 3. Tabeller kopplade via booking_id ────────────────────
  const bookingIds = (bookings as Array<{ id: string }>).map((b) => b.id);

  const fetchByBookingIds = async (table: string) => {
    if (bookingIds.length === 0) return [];
    const { data, error } = await sb
      .from(table)
      .select("*")
      .in("booking_id", bookingIds);
    if (error) {
      log("warn", "export-customer-data", `Fetch-by-booking failed: ${table}`, {
        error: error.message,
      });
      return [];
    }
    return data || [];
  };

  const [disputes, bookingEvents, ratings] = await Promise.all([
    fetchByBookingIds("disputes"),
    fetchByBookingIds("booking_events"),
    fetchByBookingIds("ratings"),
  ]);

  // ── 4. Reviews (som kund har skrivit om städare) ──────────
  let reviews: unknown[] = [];
  if (bookingIds.length > 0) {
    const { data } = await sb
      .from("reviews")
      .select("*")
      .in("booking_id", bookingIds);
    reviews = data || [];
  }

  // ── 5. Om inga rader alls hittades — returnera 403 ────────
  const hasAnyData =
    profile ||
    bookings.length > 0 ||
    subscriptions.length > 0 ||
    preferences.length > 0 ||
    credits.length > 0;

  if (!hasAnyData) {
    return json(403, {
      error: "Ingen kund-data hittades för detta email",
      hint:
        "Kontakta hello@spick.se om du tror att det finns data hos oss (kan finnas i andra tabeller)",
    });
  }

  // ── 6. Bygg export ─────────────────────────────────────────
  const exportedAt = new Date().toISOString();
  const exportData = {
    export_metadata: {
      generated_at: exportedAt,
      generated_for_email: email,
      gdpr_articles: [
        "Article 15 (right of access)",
        "Article 20 (data portability)",
      ],
      format: "JSON",
      generator: "Spick export-customer-data v1",
      retention_note:
        "Denna fil innehåller alla personuppgifter Spick har om dig som kund. Förvara säkert.",
      scope_note:
        "Exporten täcker kunddata (bokningar, prenumerationer, preferenser, disputes). " +
        "Om du också är registrerad som städare hos Spick, använd export-cleaner-data för städar-data separat.",
    },
    profile,
    bookings,
    subscriptions,
    customer_preferences: preferences,
    customer_credits: credits,
    subscription_slot_holds: slotHolds,
    disputes,
    booking_events: bookingEvents,
    ratings,
    reviews_written: reviews,
  };

  log("info", "export-customer-data", "Export generated", {
    email,
    bookings_count: bookings.length,
    subscriptions_count: subscriptions.length,
    total_sections: 10,
  });

  return json(200, exportData);
});

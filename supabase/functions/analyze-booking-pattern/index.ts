// analyze-booking-pattern — Fas 5 §5.8
// ═══════════════════════════════════════════════════════════════
// Customer-facing EF. Givet en kund-email: analyserar completed
// bokningar och föreslår recurring OM det finns ett tydligt pattern
// (≥3 bokningar samma weekday+tid+cleaner med rating ≥4).
//
// POST body: { customer_email }
// → { has_pattern, suggestion?: {cleaner_id, cleaner_name, weekday,
//     preferred_time, booking_hours, service_type, match_count,
//     avg_rating}, reason? }
//
// Används av mitt-konto.html Prenumerationer-tab för att visa
// "Vi har noticeat att du bokar tisdag 09:00 med Rafa — lägg in det
// varje vecka?"-banner.
//
// Rule #27: bara suggestion. Skapar INGEN subscription automatiskt.
// Rule #28: följer customer-subscription-manage auth-mönster (email +
//   DB-ownership). Ingen ny tabell krävs.
// Rule #31: bookings, ratings, subscriptions verifierade 2026-04-24.
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log } from "../_shared/email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MIN_BOOKINGS_FOR_PATTERN = 3;
const MIN_AVG_RATING           = 4;
const LOOKBACK_DAYS            = 120;       // analysera senaste 4 månaderna

function weekdayFromDateStr(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  const js = d.getUTCDay();
  return js === 0 ? 7 : js; // 1=mån...7=sön (matchar preferred_day-konvention)
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const email = String(body.customer_email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) {
    return json(400, { error: "customer_email required" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ── 1. Abort om kunden redan har aktiv/paused subscription ──
    const { data: existingSubs } = await sb
      .from("subscriptions")
      .select("id")
      .eq("customer_email", email)
      .in("status", ["active", "paused", "pending_setup"])
      .limit(1);
    if (existingSubs && existingSubs.length > 0) {
      return json(200, { has_pattern: false, reason: "already_has_subscription" });
    }

    // ── 2. Hämta completed bookings från senaste LOOKBACK_DAYS ──
    const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000)
      .toISOString().slice(0, 10);

    const { data: bookings, error: bErr } = await sb
      .from("bookings")
      .select("id, cleaner_id, cleaner_name, booking_date, booking_time, booking_hours, service_type, status, rut")
      .eq("customer_email", email)
      .gte("booking_date", lookback)
      .in("status", ["completed", "klar", "paid"])
      .not("cleaner_id", "is", null)
      .not("booking_date", "is", null)
      .not("booking_time", "is", null);

    if (bErr) {
      log("error", "analyze-booking-pattern", "Bookings fetch failed", { error: bErr.message });
      return json(500, { error: bErr.message });
    }
    if (!bookings || bookings.length < MIN_BOOKINGS_FOR_PATTERN) {
      return json(200, { has_pattern: false, reason: "not_enough_bookings", count: bookings?.length || 0 });
    }

    // ── 3. Hämta ratings för samma bookings (för avg) ──
    const bookingIds = (bookings as Array<{ id: string }>).map((b) => b.id);
    const { data: ratings } = await sb
      .from("ratings")
      .select("job_id, rating")
      .in("job_id", bookingIds);

    const ratingByBooking = new Map<string, number>();
    for (const r of (ratings || []) as Array<{ job_id: string; rating: number }>) {
      ratingByBooking.set(r.job_id, r.rating);
    }

    // ── 4. Gruppera per (weekday, time-slot, cleaner_id) ──
    type Group = {
      cleaner_id: string;
      cleaner_name: string | null;
      weekday: number;
      preferred_time: string;
      booking_hours: number;
      service_type: string;
      rut: boolean;
      match_count: number;
      ratings: number[];
    };
    const groups = new Map<string, Group>();

    for (const b of bookings as Array<Record<string, unknown>>) {
      const bookingDate = b.booking_date as string;
      const bookingTime = (b.booking_time as string).slice(0, 5); // HH:MM
      const cleanerId = b.cleaner_id as string;
      const weekday = weekdayFromDateStr(bookingDate);

      const key = `${weekday}|${bookingTime}|${cleanerId}`;
      const entry = groups.get(key);
      const r = ratingByBooking.get(b.id as string);

      if (entry) {
        entry.match_count += 1;
        if (typeof r === "number") entry.ratings.push(r);
      } else {
        groups.set(key, {
          cleaner_id: cleanerId,
          cleaner_name: (b.cleaner_name as string) || null,
          weekday,
          preferred_time: bookingTime,
          booking_hours: Number(b.booking_hours) || 3,
          service_type: (b.service_type as string) || "Hemstädning",
          rut: b.rut === true,
          match_count: 1,
          ratings: typeof r === "number" ? [r] : [],
        });
      }
    }

    // ── 5. Hitta bästa kandidat (högst match_count, sen högst avg_rating) ──
    const candidates = Array.from(groups.values())
      .filter((g) => g.match_count >= MIN_BOOKINGS_FOR_PATTERN)
      .map((g) => ({
        ...g,
        avg_rating: g.ratings.length > 0
          ? g.ratings.reduce((a, b) => a + b, 0) / g.ratings.length
          : null,
      }))
      .filter((g) => g.avg_rating === null || g.avg_rating >= MIN_AVG_RATING)
      .sort((a, b) => {
        if (b.match_count !== a.match_count) return b.match_count - a.match_count;
        return (b.avg_rating || 0) - (a.avg_rating || 0);
      });

    if (candidates.length === 0) {
      return json(200, {
        has_pattern: false,
        reason: "no_consistent_pattern",
        total_bookings_analyzed: bookings.length,
      });
    }

    const best = candidates[0];

    log("info", "analyze-booking-pattern", "Pattern detected", {
      email, cleaner_id: best.cleaner_id, weekday: best.weekday,
      time: best.preferred_time, count: best.match_count,
    });

    return json(200, {
      has_pattern: true,
      suggestion: {
        cleaner_id: best.cleaner_id,
        cleaner_name: best.cleaner_name,
        weekday: best.weekday,
        preferred_time: best.preferred_time,
        booking_hours: best.booking_hours,
        service_type: best.service_type,
        rut: best.rut,
        match_count: best.match_count,
        avg_rating: best.avg_rating,
      },
      total_bookings_analyzed: bookings.length,
    });
  } catch (e) {
    log("error", "analyze-booking-pattern", "Fatal", { error: (e as Error).message });
    return json(500, { error: (e as Error).message });
  }
});

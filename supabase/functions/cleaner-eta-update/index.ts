// ═══════════════════════════════════════════════════════════════
// SPICK – cleaner-eta-update (Smart-ETA primary EF)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE
//   När städare trycker "På väg" eller VD/städare manuellt sätter
//   "X min försening" → räkna ut nytt ETA via OSRM, uppdatera
//   bookings, skicka SMS+email till kund, logga event.
//
// ACTIONS
//   on_my_way      Första pressen — OSRM-routing från städare-pos →
//                  kund-adress → set cleaner_on_way_at + eta + SMS
//   manual_delay   Override (0-240 min) → recompute eta + SMS
//   arrived        Sätt checkin_time + reset delay_status
//   recompute      Re-anropa OSRM (används av eta-monitor cron)
//
// PRIMÄRKÄLLOR
//   - supabase/migrations/20260427240000_bookings_smart_eta.sql
//   - supabase/functions/cleaner-booking-response/index.ts (auth-pattern)
//   - supabase/functions/_shared/notifications.ts (notify)
//   - supabase/functions/_shared/email.ts (sendEmail + corsHeaders)
//   - supabase/functions/_shared/events.ts (logBookingEvent)
//   - supabase/functions/_shared/timezone.ts (formatStockholmDateLong)
//
// REGLER #26-#33
//   #28 SSOT: ETA-källor (osrm/manual/fallback) enforcas via DB-CHECK
//   #31 Curl-verified: bookings.cleaner_on_way_at saknas i prod
//                      (HTTP 400) — migration 20260427240000 lägger till
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";
import { formatStockholmDateLong } from "../_shared/timezone.ts";
import { logBookingEvent } from "../_shared/events.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ── OSRM-konstanter ───────────────────────────────────────────
const OSRM_BASE = "https://router.project-osrm.org/route/v1/driving";
const OSRM_TIMEOUT_MS = 5000;

// ── Delay-tröskelvärden (svenska kontexten — Stockholm-trafik) ─
const MINOR_DELAY_MIN = 15;     // > 15 min sent → minor
const MAJOR_DELAY_MIN = 30;     // > 30 min sent → major
const NO_SHOW_RISK_MIN = 60;    // > 60 min sent → eskalera

type EtaAction = "on_my_way" | "manual_delay" | "arrived" | "recompute";
type EtaSource = "osrm" | "manual" | "predictive" | "fallback_haversine";

interface EtaBody {
  booking_id: string;
  action: EtaAction;
  manual_delay_minutes?: number;
  cleaner_lat?: number;
  cleaner_lng?: number;
}

interface CleanerProfile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  company_id: string | null;
  is_company_owner: boolean;
  home_lat: number | null;
  home_lng: number | null;
}

interface BookingRow {
  id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_lat: number | null;
  customer_lng: number | null;
  booking_date: string | null;
  booking_time: string | null;
  status: string;
  cleaner_on_way_at: string | null;
  cleaner_eta_at: string | null;
  cleaner_eta_minutes: number | null;
  manual_delay_minutes: number | null;
  delay_notification_count: number | null;
  delay_status: string | null;
  checkin_time: string | null;
}

// ─── OSRM-hjälpare ───────────────────────────────────────────
async function osrmDriveTime(
  lat1: number, lng1: number, lat2: number, lng2: number,
): Promise<{ minutes: number; distance_km: number } | null> {
  const url = `${OSRM_BASE}/${lng1},${lat1};${lng2},${lat2}?overview=false`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), OSRM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Spick/1.0 hello@spick.se" } });
    if (!res.ok) return null;
    const data = await res.json();
    const route = Array.isArray(data?.routes) ? data.routes[0] : null;
    if (!route || typeof route.duration !== "number") return null;
    const minutes = Math.max(1, Math.round(route.duration / 60));
    const distance_km = typeof route.distance === "number"
      ? Math.round((route.distance / 1000) * 100) / 100
      : 0;
    return { minutes, distance_km };
  } catch (e) {
    log("warn", "cleaner-eta-update", "OSRM fetch failed", { error: (e as Error).message });
    return null;
  } finally {
    clearTimeout(t);
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackEta(lat1: number, lng1: number, lat2: number, lng2: number): { minutes: number; distance_km: number } {
  const distance_km = Math.round(haversineKm(lat1, lng1, lat2, lng2) * 100) / 100;
  // 1.4 = drive-factor (curvature), 50 km/h Stockholm-medel → minutes
  const minutes = Math.max(5, Math.round((distance_km * 1.4) / 50 * 60));
  return { minutes, distance_km };
}

// ─── Geocoding fallback (om bookings.customer_lat/lng saknas) ──
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address + ", Sweden")}&format=json&limit=1&countrycodes=se`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Spick/1.0 hello@spick.se" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

// ─── Delay-status från ETA + booking_time ─────────────────────
function computeDelayStatus(
  etaAt: Date,
  bookingDate: string,
  bookingTime: string,
): "on_time" | "minor_delay" | "major_delay" | "no_show_risk" {
  // bookingDate = "YYYY-MM-DD", bookingTime = "HH:MM" or "HH:MM:SS"
  const scheduled = new Date(`${bookingDate}T${bookingTime}+02:00`); // Stockholm-offset (CEST)
  const diffMin = Math.round((etaAt.getTime() - scheduled.getTime()) / 60000);
  if (diffMin > NO_SHOW_RISK_MIN) return "no_show_risk";
  if (diffMin > MAJOR_DELAY_MIN) return "major_delay";
  if (diffMin > MINOR_DELAY_MIN) return "minor_delay";
  return "on_time";
}

function formatTimeStockholm(d: Date): string {
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
}

// ─── HTTP-handler ─────────────────────────────────────────────
serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // ── AUTH: JWT-baserad, samma som cleaner-booking-response ──
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") || "";
    if (!token || token === Deno.env.get("SUPABASE_ANON_KEY")) {
      return json({ error: "Unauthorized" }, 401, CORS);
    }
    const authRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
    });
    if (!authRes.ok) return json({ error: "Invalid token" }, 401, CORS);
    const authUser = await authRes.json();

    const { data: cleaner, error: clErr } = await sb
      .from("cleaners")
      .select("id, full_name, email, phone, company_id, is_company_owner, home_lat, home_lng")
      .eq("auth_user_id", authUser.id)
      .eq("is_approved", true)
      .maybeSingle<CleanerProfile>();

    if (clErr || !cleaner) return json({ error: "Städarprofil hittades inte" }, 403, CORS);

    // ── PARSE BODY ──
    const body = await req.json() as EtaBody;
    const { booking_id, action } = body;
    if (!booking_id || !["on_my_way", "manual_delay", "arrived", "recompute"].includes(action)) {
      return json({ error: "booking_id + action (on_my_way|manual_delay|arrived|recompute) krävs" }, 400, CORS);
    }

    // ── FETCH BOOKING ──
    const { data: booking, error: bkErr } = await sb
      .from("bookings")
      .select("id, cleaner_id, cleaner_name, customer_name, customer_email, customer_phone, customer_address, customer_lat, customer_lng, booking_date, booking_time, status, cleaner_on_way_at, cleaner_eta_at, cleaner_eta_minutes, manual_delay_minutes, delay_notification_count, delay_status, checkin_time")
      .eq("id", booking_id)
      .maybeSingle<BookingRow>();

    if (bkErr || !booking) return json({ error: "Bokning hittades inte" }, 404, CORS);

    // ── AUTH: cleaner äger bokningen ELLER VD i samma företag ──
    let isAuthorized = booking.cleaner_id === cleaner.id;
    if (!isAuthorized && cleaner.is_company_owner && cleaner.company_id && booking.cleaner_id) {
      const { data: assigned } = await sb
        .from("cleaners")
        .select("company_id")
        .eq("id", booking.cleaner_id)
        .maybeSingle();
      if (assigned?.company_id === cleaner.company_id) isAuthorized = true;
    }
    if (!isAuthorized) {
      return json({ error: "Du har inte tillgång till denna bokning" }, 403, CORS);
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: on_my_way / recompute
    // ─────────────────────────────────────────────────────────
    if (action === "on_my_way" || action === "recompute") {
      // 1) Hämta städar-koordinater (request body > cleaners.home_lat/lng)
      const cLat = body.cleaner_lat ?? cleaner.home_lat;
      const cLng = body.cleaner_lng ?? cleaner.home_lng;
      if (cLat == null || cLng == null) {
        return json({ error: "Städar-position saknas (lägg till hem-adress eller skicka cleaner_lat/lng)" }, 400, CORS);
      }

      // 2) Hämta kund-koordinater (cached eller geocoda nu)
      let custLat = booking.customer_lat;
      let custLng = booking.customer_lng;
      if ((custLat == null || custLng == null) && booking.customer_address) {
        const geo = await geocodeAddress(booking.customer_address);
        if (geo) {
          custLat = geo.lat; custLng = geo.lng;
          // Cache för framtida ETA-recomputes
          await sb.from("bookings")
            .update({ customer_lat: geo.lat, customer_lng: geo.lng })
            .eq("id", booking_id);
        }
      }
      if (custLat == null || custLng == null) {
        return json({ error: "Kund-adress kunde inte geocodas" }, 400, CORS);
      }

      // 3) OSRM-routing → fallback haversine
      let etaResult = await osrmDriveTime(cLat, cLng, custLat, custLng);
      let source: EtaSource = "osrm";
      if (!etaResult) {
        etaResult = fallbackEta(cLat, cLng, custLat, custLng);
        source = "fallback_haversine";
      }

      // 4) Beräkna ETA + delay_status
      const now = new Date();
      const totalMinutes = etaResult.minutes + (booking.manual_delay_minutes ?? 0);
      const etaAt = new Date(now.getTime() + totalMinutes * 60_000);
      const delayStatus = booking.booking_date && booking.booking_time
        ? computeDelayStatus(etaAt, booking.booking_date, String(booking.booking_time))
        : "on_time";

      // 5) UPDATE bookings
      const updateFields: Record<string, unknown> = {
        cleaner_eta_at: etaAt.toISOString(),
        cleaner_eta_minutes: etaResult.minutes,
        cleaner_eta_distance_km: etaResult.distance_km,
        cleaner_eta_source: source,
        last_eta_update_at: now.toISOString(),
        delay_status: delayStatus,
      };
      if (action === "on_my_way" && !booking.cleaner_on_way_at) {
        updateFields.cleaner_on_way_at = now.toISOString();
      }
      const { error: updErr } = await sb.from("bookings").update(updateFields).eq("id", booking_id);
      if (updErr) {
        log("error", "cleaner-eta-update", "UPDATE failed", { booking_id, error: updErr.message });
        return json({ error: "Kunde inte uppdatera ETA" }, 500, CORS);
      }

      // 6) SMS + email (bara vid on_my_way, inte recompute — annars spam)
      if (action === "on_my_way") {
        const etaStr = formatTimeStockholm(etaAt);
        const customerName = booking.customer_name || "Kund";
        const cleanerName = cleaner.full_name;

        if (booking.customer_phone || booking.customer_email) {
          await notify({
            email: booking.customer_email || undefined,
            phone: booking.customer_phone || undefined,
            sms_message: `Spick: Din städare ${cleanerName} är på väg, beräknad ankomst kl ${etaStr}.`,
            push_type: "cleaner_on_the_way",
            push_data: { cleaner_name: cleanerName, eta_at: etaAt.toISOString(), booking_id },
          }).catch((e) => log("warn", "cleaner-eta-update", "notify failed", { error: (e as Error).message }));
        }

        if (booking.customer_email) {
          const html = wrap(`
            <h2>Din städare är på väg!</h2>
            <p>Hej ${esc(customerName)},</p>
            <p><strong>${esc(cleanerName)}</strong> har lämnat hemma och är på väg till dig nu.</p>
            ${card([
              ["Beräknad ankomst", etaStr],
              ["Avstånd", `${etaResult.distance_km} km`],
              ["Restid", `~${etaResult.minutes} min`],
            ])}
            <p>Vi ses snart! Om du behöver kontakta städaren, ring oss på <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
          `);
          await sendEmail(booking.customer_email, `${cleanerName} är på väg — ankomst kl ${etaStr}`, html)
            .catch((e) => log("warn", "cleaner-eta-update", "email failed", { error: (e as Error).message }));
        }
      }

      // 7) Logga event
      await logBookingEvent(sb, booking_id, "cleaner_on_the_way", {
        actorType: action === "on_my_way" ? "cleaner" : "system",
        metadata: {
          cleaner_id: cleaner.id,
          eta_minutes: etaResult.minutes,
          distance_km: etaResult.distance_km,
          source,
          eta_at: etaAt.toISOString(),
        },
      });

      log("info", "cleaner-eta-update", `ETA set (${action})`, {
        booking_id, eta_minutes: etaResult.minutes, source, delay_status: delayStatus,
      });

      return json({
        success: true,
        eta_at: etaAt.toISOString(),
        eta_minutes: etaResult.minutes,
        distance_km: etaResult.distance_km,
        source,
        delay_status: delayStatus,
        message: action === "on_my_way" ? "Kunden har notifierats." : "ETA uppdaterad.",
      }, 200, CORS);
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: manual_delay
    // ─────────────────────────────────────────────────────────
    if (action === "manual_delay") {
      const delayMin = Number(body.manual_delay_minutes);
      if (!Number.isFinite(delayMin) || delayMin < 0 || delayMin > 240) {
        return json({ error: "manual_delay_minutes måste vara 0-240" }, 400, CORS);
      }

      // Recompute ETA om städare redan är på väg
      let newEtaAt: Date | null = null;
      let delayStatus: "on_time" | "minor_delay" | "major_delay" | "no_show_risk" = "on_time";
      if (booking.cleaner_on_way_at && booking.cleaner_eta_minutes != null) {
        const baseEta = new Date(booking.cleaner_on_way_at);
        baseEta.setMinutes(baseEta.getMinutes() + booking.cleaner_eta_minutes + delayMin);
        newEtaAt = baseEta;
        if (booking.booking_date && booking.booking_time) {
          delayStatus = computeDelayStatus(newEtaAt, booking.booking_date, String(booking.booking_time));
        }
      }

      const updateFields: Record<string, unknown> = {
        manual_delay_minutes: delayMin,
        delay_notification_count: (booking.delay_notification_count ?? 0) + 1,
        last_eta_update_at: new Date().toISOString(),
        delay_status: delayStatus,
      };
      if (newEtaAt) updateFields.cleaner_eta_at = newEtaAt.toISOString();
      if (delayMin > 0 && booking.cleaner_eta_source !== "osrm") {
        updateFields.cleaner_eta_source = "manual";
      }

      const { error: updErr } = await sb.from("bookings").update(updateFields).eq("id", booking_id);
      if (updErr) {
        log("error", "cleaner-eta-update", "manual_delay UPDATE failed", { booking_id, error: updErr.message });
        return json({ error: "Kunde inte uppdatera försening" }, 500, CORS);
      }

      // SMS + email till kund
      const customerName = booking.customer_name || "Kund";
      const etaStr = newEtaAt ? formatTimeStockholm(newEtaAt) : "uppdateras snart";

      if (booking.customer_phone || booking.customer_email) {
        await notify({
          email: booking.customer_email || undefined,
          phone: booking.customer_phone || undefined,
          sms_message: `Spick: Uppdatering — din städare blir ca ${delayMin} min senare. Ny beräknad ankomst kl ${etaStr}. Vi beklagar.`,
          push_type: "cleaner_delayed",
          push_data: { manual_delay_minutes: delayMin, new_eta_at: newEtaAt?.toISOString() ?? null, booking_id },
        }).catch((e) => log("warn", "cleaner-eta-update", "notify failed", { error: (e as Error).message }));
      }

      if (booking.customer_email) {
        const html = wrap(`
          <h2>Uppdatering — försening på din städning</h2>
          <p>Hej ${esc(customerName)},</p>
          <p>Tyvärr blir din städare <strong>cirka ${delayMin} minuter senare</strong> än planerat. Vi beklagar besväret.</p>
          ${card([
            ["Ny beräknad ankomst", etaStr],
            ["Försening", `${delayMin} min`],
          ])}
          <p>Tack för ditt tålamod. Vid frågor: <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a>.</p>
        `);
        await sendEmail(booking.customer_email, `Försening: ny ankomst kl ${etaStr}`, html)
          .catch((e) => log("warn", "cleaner-eta-update", "email failed", { error: (e as Error).message }));
      }

      await logBookingEvent(sb, booking_id, "cleaner_delayed", {
        actorType: cleaner.is_company_owner ? "company_owner" : "cleaner",
        metadata: {
          cleaner_id: cleaner.id,
          manual_delay_minutes: delayMin,
          new_eta_at: newEtaAt?.toISOString() ?? null,
          delay_status: delayStatus,
        },
      });

      log("info", "cleaner-eta-update", "Manual delay set", { booking_id, delayMin, delayStatus });
      return json({
        success: true,
        eta_at: newEtaAt?.toISOString() ?? null,
        eta_minutes: booking.cleaner_eta_minutes,
        delay_status: delayStatus,
        message: `Kund notifierad om ${delayMin} min försening.`,
      }, 200, CORS);
    }

    // ─────────────────────────────────────────────────────────
    // ACTION: arrived
    // ─────────────────────────────────────────────────────────
    if (action === "arrived") {
      const now = new Date().toISOString();
      const updateFields: Record<string, unknown> = {
        delay_status: "on_time",
        last_eta_update_at: now,
      };
      // Sätt checkin_time bara om den inte redan finns (clock-event kan ha gjort det via GPS)
      if (!booking.checkin_time) {
        updateFields.checkin_time = now;
      }

      const { error: updErr } = await sb.from("bookings").update(updateFields).eq("id", booking_id);
      if (updErr) {
        log("error", "cleaner-eta-update", "arrived UPDATE failed", { booking_id, error: updErr.message });
        return json({ error: "Kunde inte markera ankomst" }, 500, CORS);
      }

      await logBookingEvent(sb, booking_id, "cleaner_arrived", {
        actorType: "cleaner",
        metadata: { cleaner_id: cleaner.id, arrived_at: now },
      });

      log("info", "cleaner-eta-update", "Cleaner arrived", { booking_id, cleaner_id: cleaner.id });
      return json({
        success: true,
        eta_at: booking.cleaner_eta_at,
        eta_minutes: 0,
        delay_status: "on_time",
        message: "Ankomst registrerad.",
      }, 200, CORS);
    }

    return json({ error: "Ogiltig action" }, 400, CORS);
  } catch (err) {
    log("error", "cleaner-eta-update", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// auto-rebook — Skapar bokningar för aktiva prenumerationer
// ═══════════════════════════════════════════════════════════
// Triggas dagligen 07:00 CET via GitHub Actions
//
// Flöde:
//   1. Hitta active subscriptions med next_booking_date <= idag+7
//   2. Dedup-check (undvik dubbletter)
//   3. Skapa bokning via booking-create (payment_mode='stripe_subscription')
//   4. Skicka påminnelse-email till kund
//   5. Uppdatera next_booking_date
//
// Kopplar till:
//   - booking-create EF (FAS 2) — skapar bokningen
//   - charge-subscription-booking EF (FAS 7) — debiterar dagen innan

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log, sendEmail, wrap, card } from "../_shared/email.ts";
import { getStockholmDateString } from "../_shared/timezone.ts";
import { logBookingEvent, type SupabaseRpcClient } from "../_shared/events.ts";
import { findSlotConflict } from "../_shared/slot-holds.ts";
import { isHoliday, nextNonHoliday } from "../_shared/holidays.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_URL     = Deno.env.get("BASE_URL") || "https://spick.se";
// Fas 5 §5.3: 4-veckors-fönster för kund-synlighet framåt + minskar sista-minuten-friktion.
// Dedup-check (line 149) garanterar max 1 bokning/sub/körning oavsett horisont → ingen burst.
// Vid skala >1000 aktiva subs: överväg platform_settings-key + batchning (separat iteration).
const HORIZON_DAYS = 28;

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const json = (s: number, d: unknown) => new Response(JSON.stringify(d), {
    status: s, headers: { ...CORS, "Content-Type": "application/json" }
  });

  try {
    await req.json().catch(() => ({}));

    // Datum att processa (HORIZON_DAYS framåt, Fas 5 §5.3)
    // §49 Fas 3: svenskt kalenderdatum, inte UTC
    const todayStr = getStockholmDateString();
    const horizonDate = new Date();
    horizonDate.setDate(horizonDate.getDate() + HORIZON_DAYS);
    const horizonStr = getStockholmDateString(horizonDate);

    log("info", "auto-rebook", "Starting", { today: todayStr, horizon: horizonStr });

    // 1. Hämta aktiva subscriptions med next_booking_date <= horizon
    const { data: subs, error: subErr } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("status", "active")
      .lte("next_booking_date", horizonStr)
      .not("next_booking_date", "is", null);

    if (subErr) {
      log("error", "auto-rebook", "Fetch failed", { error: subErr.message });
      return json(500, { error: subErr.message });
    }

    if (!subs || subs.length === 0) {
      log("info", "auto-rebook", "No subscriptions due", { horizon: horizonStr });
      return json(200, { processed: 0, horizon: horizonStr });
    }

    const results: Array<Record<string, unknown>> = [];

    for (const sub of subs) {
      try {
        const result = await processSubscription(supabase, sub);
        results.push({ id: sub.id, customer: sub.customer_name, ...result });
      } catch (e: unknown) {
        const msg = (e as Error).message || "Unknown error";
        log("error", "auto-rebook", `Failed for ${sub.id}`, { error: msg });
        results.push({ id: sub.id, customer: sub.customer_name, error: msg });
      }
    }

    log("info", "auto-rebook", "Complete", {
      processed: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      failed: results.filter((r) => r.error).length,
    });

    return json(200, { processed: results.length, horizon: horizonStr, results });
  } catch (err: unknown) {
    log("error", "auto-rebook", "Fatal", { error: (err as Error).message });
    return json(500, { error: (err as Error).message });
  }
});

// ── Beräkna nästa datum baserat på frekvens ──────────────────
function nextDate(current: string, frequency: string): string {
  const [y, m, d] = current.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));

  if (frequency === "weekly") {
    dt.setUTCDate(dt.getUTCDate() + 7);
  } else if (frequency === "biweekly") {
    dt.setUTCDate(dt.getUTCDate() + 14);
  } else {
    // monthly: samma dag nästa månad (hanterar 31→28 etc.)
    const targetDay = dt.getUTCDate();
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    // Om månaden "spillde över" (t.ex. 31 jan → 3 mars), backa
    if (dt.getUTCDate() !== targetDay) {
      dt.setUTCDate(0); // sista dagen i föregående månad
    }
  }

  return dt.toISOString().slice(0, 10);
}

// ── Processa en subscription ─────────────────────────────────
async function processSubscription(supabase: ReturnType<typeof createClient>, sub: Record<string, unknown>) {
  let bookingDate = sub.next_booking_date as string;
  const freq = sub.frequency as string;
  // §49 Fas 3: svenskt kalenderdatum, inte UTC
  const todayStr = getStockholmDateString();

  // ── Hantera förfallna datum (om auto-rebook missat körningar) ──
  // Avancera till nästa framtida datum UTAN att skapa bokningar för det förflutna
  let skippedPast = 0;
  while (bookingDate < todayStr) {
    bookingDate = nextDate(bookingDate, freq);
    skippedPast++;
  }
  if (skippedPast > 0) {
    log("warn", "auto-rebook", `Skipped ${skippedPast} past dates for sub ${sub.id}`, {
      original: sub.next_booking_date,
      advanced_to: bookingDate,
    });
    // Uppdatera next_booking_date till framtida datum
    await supabase.from("subscriptions").update({
      next_booking_date: bookingDate,
      updated_at: new Date().toISOString(),
    }).eq("id", sub.id as string);
  }

  // Fas 5 §5.3c: duration_mode stop-check
  // fixed_count: stoppa när total_bookings_created >= max_occurrences
  // end_date:    stoppa när nästa bokningsdatum > end_date
  // Status sätts till 'cancelled' per prod-constraint (active|paused|cancelled).
  const durationMode = (sub.duration_mode as string) || "open_ended";
  const totalBookings = (sub.total_bookings_created as number) || 0;

  if (durationMode === "fixed_count") {
    const maxOcc = sub.max_occurrences as number | null;
    if (maxOcc && totalBookings >= maxOcc) {
      await supabase.from("subscriptions").update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      }).eq("id", sub.id as string);
      if (sub.last_booking_id) {
        await logBookingEvent(
          supabase as unknown as SupabaseRpcClient,
          sub.last_booking_id as string,
          "recurring_cancelled",
          {
            actorType: "system",
            metadata: {
              subscription_id: sub.id as string,
              cancelled_by: "system",
              reason: "max_occurrences_reached",
              total_bookings: totalBookings,
              max_occurrences: maxOcc,
            },
          },
        );
      }
      log("info", "auto-rebook", "Ended: max_occurrences reached", {
        sub_id: sub.id, total_bookings: totalBookings, max: maxOcc,
      });
      return { status: "ended", reason: "max_occurrences_reached", total_bookings: totalBookings };
    }
  }

  if (durationMode === "end_date") {
    const endDate = sub.end_date as string | null;
    if (endDate && bookingDate > endDate) {
      await supabase.from("subscriptions").update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      }).eq("id", sub.id as string);
      if (sub.last_booking_id) {
        await logBookingEvent(
          supabase as unknown as SupabaseRpcClient,
          sub.last_booking_id as string,
          "recurring_cancelled",
          {
            actorType: "system",
            metadata: {
              subscription_id: sub.id as string,
              cancelled_by: "system",
              reason: "end_date_reached",
              end_date: endDate,
              attempted_booking_date: bookingDate,
            },
          },
        );
      }
      log("info", "auto-rebook", "Ended: end_date reached", {
        sub_id: sub.id, end_date: endDate, attempted: bookingDate,
      });
      return { status: "ended", reason: "end_date_reached", end_date: endDate };
    }
  }

  // Kolla om bokningsdatum är inom horizon (HORIZON_DAYS)
  // §49 Fas 3: svenskt kalenderdatum, inte UTC
  const horizonDate = new Date();
  horizonDate.setDate(horizonDate.getDate() + HORIZON_DAYS);
  const horizonStr = getStockholmDateString(horizonDate);
  if (bookingDate > horizonStr) {
    return { status: "skipped", reason: "not within horizon yet", next_date: bookingDate };
  }

  // §5.11 Helgdag-hantering: auto_skip | auto_shift | manual (null)
  const holidayMode = (sub.holiday_mode as string) || null;
  if (holidayMode && holidayMode !== "manual") {
    try {
      const holidayName = await isHoliday(supabase, bookingDate);
      if (holidayName) {
        if (holidayMode === "auto_skip") {
          const next = nextDate(bookingDate, freq);
          await supabase.from("subscriptions").update({
            next_booking_date: next,
            updated_at: new Date().toISOString(),
          }).eq("id", sub.id as string);
          log("info", "auto-rebook", "Skipped holiday (auto_skip)", {
            sub_id: sub.id, holiday: holidayName, date: bookingDate, next_date: next,
          });
          return { status: "skipped", reason: "holiday_auto_skip", holiday: holidayName, next_date: next };
        } else if (holidayMode === "auto_shift") {
          const shifted = await nextNonHoliday(supabase, bookingDate);
          if (shifted !== bookingDate) {
            log("info", "auto-rebook", "Shifted from holiday (auto_shift)", {
              sub_id: sub.id, holiday: holidayName, original: bookingDate, shifted,
            });
            bookingDate = shifted;
          }
        }
      }
    } catch (e) {
      log("warn", "auto-rebook", "Holiday-check misslyckades (non-fatal)", {
        sub_id: sub.id, error: (e as Error).message,
      });
    }
  }

  // §5.4.2 Slot-hold conflict-check: annan aktiv sub som delar cleaner+weekday+tid?
  // Blockerar INTE skapandet (rule #27 — varna, inte hård-block). booking-create har
  // calendar_events no_booking_overlap som hårt skydd mot faktiska dubbelbokningar.
  if (sub.cleaner_id && typeof sub.preferred_day === "number" && sub.preferred_time && sub.booking_hours) {
    try {
      const conflict = await findSlotConflict(supabase, {
        cleaner_id: sub.cleaner_id as string,
        weekday: sub.preferred_day as number,
        start_time: sub.preferred_time as string,
        duration_hours: Number(sub.booking_hours),
        exclude_subscription_id: sub.id as string,
      });
      if (conflict) {
        log("warn", "auto-rebook", "Slot-hold-konflikt upptäckt — fortsätter ändå", {
          sub_id: sub.id,
          conflicting_sub_id: conflict.subscription_id,
          cleaner_id: sub.cleaner_id,
          weekday: sub.preferred_day,
        });
      }
    } catch (e) {
      log("warn", "auto-rebook", "Slot-hold-check misslyckades (non-fatal)", {
        sub_id: sub.id, error: (e as Error).message,
      });
    }
  }

  // Dedup: finns redan bokning för denna sub + datum?
  const { data: existing } = await supabase
    .from("bookings")
    .select("id")
    .eq("subscription_id", sub.id as string)
    .eq("booking_date", bookingDate)
    .limit(1);

  if (existing && existing.length > 0) {
    // Bokning finns redan — uppdatera next_booking_date ändå
    const next = nextDate(bookingDate, freq);
    await supabase.from("subscriptions").update({
      next_booking_date: next,
      updated_at: new Date().toISOString(),
    }).eq("id", sub.id as string);
    return { status: "skipped", reason: "booking already exists", next_date: next };
  }

  // Dubbelkörningsskydd: verifiera att next_booking_date inte ändrats
  const { data: fresh } = await supabase
    .from("subscriptions")
    .select("next_booking_date")
    .eq("id", sub.id as string)
    .single();

  if (!fresh || fresh.next_booking_date !== bookingDate) {
    return { status: "skipped", reason: "already processed" };
  }

  // ── Skapa bokning via booking-create EF ──────────────────
  const bookingPayload = {
    name: sub.customer_name,
    email: sub.customer_email,
    phone: sub.customer_phone || null,
    address: sub.customer_address || null,
    date: bookingDate,
    time: (sub.preferred_time as string) || "09:00",
    hours: (sub.booking_hours as number) || 3,
    service: sub.service_type || "Hemstädning",
    cleaner_id: sub.cleaner_id || null,
    rut: sub.rut === true,
    frequency: sub.frequency,
    customer_notes: sub.customer_notes || null,
    key_type: sub.key_type || "open",
    key_info: sub.key_info || null,
    customer_type: sub.customer_type || "privat",
    business_name: sub.business_name || null,
    business_org_number: sub.business_org_number || null,
    business_reference: sub.business_reference || null,
    company_id: sub.company_id || null,
    auto_delegation_enabled: sub.auto_delegation_enabled,
    manual_override_price: sub.manual_override_price || null,
    // V1.0: subscription-specifika fält
    payment_mode: "stripe_subscription",
    subscription_id: sub.id,
    send_email_to_customer: false, // auto-rebook hanterar email
    manual_entry: false,
  };

  const createRes = await fetch(`${SUPABASE_URL}/functions/v1/booking-create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
    body: JSON.stringify(bookingPayload),
  });

  const createResult = await createRes.json();

  if (!createRes.ok || !createResult.booking_id) {
    throw new Error(createResult.error || "booking-create failed");
  }

  // Fas 6 §6.8: logga recurring_generated för timeline
  // (primär state-transition = booking skapad; email/sub-update är secondary)
  // H5: cast till SupabaseRpcClient pga supabase-js version-inferens-drift
  await logBookingEvent(supabase as unknown as SupabaseRpcClient, createResult.booking_id as string, "recurring_generated", {
    actorType: "system",
    metadata: {
      subscription_id: sub.id as string,
      series_position: ((sub.total_bookings_created as number) || 0) + 1,
      booking_date: bookingDate,
      frequency: freq,
      cleaner_id: sub.cleaner_id || null,
    },
  });

  // ── Skicka påminnelse-email ────────────────────────────────
  const freqText = freq === "weekly"
    ? "veckovis"
    : freq === "biweekly"
      ? "varannan vecka"
      : "månadsvis";
  const hours = (sub.booking_hours as number) || 3;
  const serviceType = (sub.service_type as string) || "Hemstädning";
  const firstName = ((sub.customer_name as string) || "").split(" ")[0] || "Kund";
  const bookingTime = (sub.preferred_time as string) || "09:00";
  const useRut = sub.rut === true && sub.customer_type !== "foretag";
  const rate = (sub.hourly_rate as number) || 350;
  let totalPrice = Math.round(hours * rate);
  if (sub.manual_override_price && (sub.manual_override_price as number) >= 100) {
    totalPrice = sub.manual_override_price as number;
  }
  const displayPrice = useRut ? Math.floor(totalPrice * 0.5) : totalPrice;

  // Hitta företagsnamn
  let companyName = "Spick";
  if (sub.company_id) {
    const { data: co } = await supabase
      .from("companies")
      .select("display_name, name")
      .eq("id", sub.company_id as string)
      .maybeSingle();
    if (co) companyName = (co.display_name || co.name) as string;
  }

  try {
    const dateObj = new Date(bookingDate + "T00:00:00");
    const dateStr = dateObj.toLocaleDateString("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const emailHtml = wrap(`
      <h2>Påminnelse: Din ${freqText}a städning</h2>
      <p>Hej ${firstName}!</p>
      <p>Din ${freqText}a städning hos <strong>Spick</strong> är schemalagd.</p>
      ${
      card([
        ["Tjänst", serviceType + " · " + hours + " tim"],
        ["Datum", dateStr],
        ["Tid", bookingTime],
        ["Adress", (sub.customer_address as string) || "—"],
        ["Utförs av", companyName],
        ["Pris", displayPrice + " kr" + (useRut ? " (efter RUT)" : "")],
      ])
    }
      <p style="font-size:13px;color:#6B6960;margin-top:16px">Ditt kort debiteras automatiskt dagen innan. Du behöver inte göra något.</p>
      <p style="font-size:13px;color:#6B6960">Vill du ändra eller pausa? <a href="${BASE_URL}/mitt-konto.html" style="color:#0F6E56">Hantera prenumeration</a></p>
    `);

    await sendEmail(
      sub.customer_email as string,
      `Påminnelse: ${serviceType} ${dateStr} — Spick`,
      emailHtml,
    );
  } catch (emailErr) {
    log("warn", "auto-rebook", "Email failed", {
      sub_id: sub.id,
      error: (emailErr as Error).message,
    });
  }

  // ── Uppdatera subscription ─────────────────────────────────
  const next = nextDate(bookingDate, freq);

  await supabase.from("subscriptions").update({
    next_booking_date: next,
    total_bookings_created: ((sub.total_bookings_created as number) || 0) + 1,
    last_booking_id: createResult.booking_id,
    updated_at: new Date().toISOString(),
  }).eq("id", sub.id as string);

  return {
    status: "ok",
    booking_id: createResult.booking_id,
    booking_date: bookingDate,
    next_date: next,
  };
}

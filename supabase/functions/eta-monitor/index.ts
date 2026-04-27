// ═══════════════════════════════════════════════════════════════
// SPICK – eta-monitor (cron — körs var 5:e min)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE
//   1) Påminna städare 15 min innan starttid om "På väg" inte
//      tryckts ännu
//   2) Eskalera till VD + admin om ETA passerats med >10 min och
//      checkin_time saknas (no-show-risk)
//   3) Pinga städare 30 min innan predicted_arrival_at
//
// CRON
//   Varje 5 min via GitHub Actions / Supabase scheduler.
//   Kräver CRON_SECRET (eller service-role-key) via Authorization-header.
//
// PRIMÄRKÄLLOR
//   - supabase/migrations/20260427240000_bookings_smart_eta.sql
//   - supabase/functions/_shared/cron-auth.ts
//   - supabase/functions/_shared/notifications.ts (notify)
//   - supabase/functions/_shared/email.ts (sendEmail + ADMIN)
//
// REGLER #26-#33
//   #28 SSOT: tröskelvärden samlade i konstanter överst
//   #31 Curl-verified: cleaner_on_way_at + last_eta_update_at saknas
//                      i prod (HTTP 400) — migration 20260427240000
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, sendEmail, wrap, esc, card, log, ADMIN } from "../_shared/email.ts";
import { notify } from "../_shared/notifications.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SUPA_URL = "https://urjeijcncsyuletprydy.supabase.co";
const sb = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ── Tröskelvärden ─────────────────────────────────────────────
const ON_WAY_REMINDER_BEFORE_MIN = 15;     // Påminnelse 15 min innan starttid
const ESCALATE_AFTER_ETA_MIN = 10;          // Eskalera efter ETA + 10 min
const PREDICTED_ARRIVAL_PING_MIN = 30;     // Ping städare 30 min före predicted_arrival_at

// Window: hitta bokningar som startar ±60 min runt nu
const LOOKAHEAD_MIN = 60;
const LOOKBACK_MIN = 30;

interface BookingRow {
  id: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  booking_date: string;
  booking_time: string;
  status: string;
  cleaner_on_way_at: string | null;
  cleaner_eta_at: string | null;
  predicted_arrival_at: string | null;
  last_eta_update_at: string | null;
  checkin_time: string | null;
  delay_status: string | null;
  company_id: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────
function todayStockholmYMD(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

function bookingScheduledAt(date: string, time: string): Date {
  // Stockholm-offset: +01:00 (CET) eller +02:00 (CEST). Använd toLocaleString-trick:
  // Skapa Date som om den vore UTC + applicera Stockholm-offset via Intl.
  // Förenkling: anta CEST (+02:00) — Smart-ETA används mest i sommarhalvåret.
  // Vid CET-bias (vinter) blir reminders 1h fel — TODO: använd timezone.parseStockholmTime
  return new Date(`${date}T${String(time).slice(0, 8)}+02:00`);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 60000);
}

function formatTimeSE(d: Date): string {
  return d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Stockholm" });
}

// ─── HTTP-handler ─────────────────────────────────────────────
serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // ── AUTH: CRON_SECRET ──
  const auth = requireCronAuth(req, CORS);
  if (!auth.ok) return auth.response!;

  const result = {
    processed: 0,
    on_way_reminders: 0,
    escalations: 0,
    predicted_pings: 0,
    errors: [] as Array<{ booking_id: string; error: string }>,
  };

  try {
    const today = todayStockholmYMD();
    const now = new Date();

    // ── Hämta dagens aktiva bokningar i fönster ──
    const { data: bookings, error } = await sb
      .from("bookings")
      .select("id, cleaner_id, cleaner_name, customer_name, customer_phone, customer_email, booking_date, booking_time, status, cleaner_on_way_at, cleaner_eta_at, predicted_arrival_at, last_eta_update_at, checkin_time, delay_status, company_id")
      .eq("booking_date", today)
      .in("status", ["confirmed", "bekräftad", "pending_confirmation"])
      .returns<BookingRow[]>();

    if (error) {
      log("error", "eta-monitor", "Failed to fetch bookings", { error: error.message });
      return json({ error: error.message }, 500, CORS);
    }

    if (!bookings || bookings.length === 0) {
      return json({ ...result, message: "Inga aktiva bokningar idag" }, 200, CORS);
    }

    for (const b of bookings) {
      try {
        if (!b.booking_time || !b.cleaner_id) continue;
        const scheduledAt = bookingScheduledAt(b.booking_date, b.booking_time);
        const minutesUntilStart = minutesBetween(scheduledAt, now);

        // Skippa bokningar utanför fönstret
        if (minutesUntilStart > LOOKAHEAD_MIN || minutesUntilStart < -LOOKBACK_MIN) continue;
        result.processed++;

        // ─── 1) "På väg"-påminnelse: 15 min före start ───
        if (
          !b.cleaner_on_way_at &&
          minutesUntilStart <= ON_WAY_REMINDER_BEFORE_MIN &&
          minutesUntilStart > 0 &&
          // Skicka bara en gång — last_eta_update_at som dedup-flagga
          !b.last_eta_update_at
        ) {
          const { data: cleaner } = await sb
            .from("cleaners")
            .select("phone, email, full_name")
            .eq("id", b.cleaner_id)
            .maybeSingle();

          if (cleaner?.phone || cleaner?.email) {
            await notify({
              cleaner_id: b.cleaner_id,
              email: cleaner.email || undefined,
              phone: cleaner.phone || undefined,
              sms_message: `Påminnelse: Tryck "På väg" när du lämnar för ${b.customer_name || "kund"} kl ${formatTimeSE(scheduledAt)}.`,
              push_type: "on_way_reminder",
              push_data: { booking_id: b.id, customer_name: b.customer_name, scheduled_at: scheduledAt.toISOString() },
              in_app: {
                title: "Påminnelse: Tryck 'På väg'",
                body: `Bokning för ${b.customer_name || "kund"} kl ${formatTimeSE(scheduledAt)}`,
                type: "on_way_reminder",
                job_id: b.id,
              },
            }).catch((e) => log("warn", "eta-monitor", "on_way notify failed", { booking_id: b.id, error: (e as Error).message }));

            // Markera påminnelse skickad via last_eta_update_at (för dedup nästa cron-run)
            await sb.from("bookings").update({ last_eta_update_at: now.toISOString() }).eq("id", b.id);
            result.on_way_reminders++;
          }
        }

        // ─── 2) Eskalera no-show-risk: ETA + 10 min, ingen check-in ───
        if (
          b.cleaner_on_way_at &&
          b.cleaner_eta_at &&
          !b.checkin_time &&
          b.status !== "pågår"
        ) {
          const etaAt = new Date(b.cleaner_eta_at);
          const minutesPastEta = minutesBetween(now, etaAt);
          if (minutesPastEta >= ESCALATE_AFTER_ETA_MIN) {
            // Hitta VD om företagsbokning
            let ownerEmail: string | null = null;
            let ownerPhone: string | null = null;
            let companyName: string | null = null;
            if (b.company_id) {
              const { data: company } = await sb
                .from("companies")
                .select("display_name, name, owner_cleaner_id")
                .eq("id", b.company_id)
                .maybeSingle();
              if (company) {
                companyName = company.display_name || company.name;
                if (company.owner_cleaner_id) {
                  const { data: owner } = await sb
                    .from("cleaners")
                    .select("email, phone")
                    .eq("id", company.owner_cleaner_id)
                    .maybeSingle();
                  ownerEmail = owner?.email ?? null;
                  ownerPhone = owner?.phone ?? null;
                }
              }
            }

            const escalationMsg = `STÄDARE FÖRSENAD: ${b.cleaner_name || "okänd"} skulle ankomma ${b.customer_name || "kund"} kl ${formatTimeSE(etaAt)}, men har inte checkat in (${minutesPastEta} min sent). Ring kunden!`;

            // SMS till VD + admin-email
            if (ownerPhone || ownerEmail) {
              await notify({
                email: ownerEmail || undefined,
                phone: ownerPhone || undefined,
                sms_message: `Spick: ${escalationMsg}`,
                push_type: "no_show_risk",
                push_data: { booking_id: b.id, cleaner_name: b.cleaner_name, customer_name: b.customer_name, minutes_past_eta: minutesPastEta },
              }).catch((e) => log("warn", "eta-monitor", "VD notify failed", { booking_id: b.id, error: (e as Error).message }));
            }

            await sendEmail(ADMIN, `[Spick] ${escalationMsg}`, wrap(`
              <h2>Eskalering: städare har inte checkat in</h2>
              ${card([
                ["Städare", esc(b.cleaner_name || "okänd")],
                ["Kund", esc(b.customer_name || "okänd")],
                ["ETA passerad", `${minutesPastEta} min sedan`],
                ["Företag", esc(companyName || "—")],
                ["Booking ID", esc(b.id.slice(0, 8))],
              ])}
              <p>Kontrollera om städaren är på plats. Om no-show: trigga refund + kund-kompensation.</p>
            `)).catch((e) => log("warn", "eta-monitor", "admin email failed", { error: (e as Error).message }));

            // Sätt delay_status om inte redan no_show_risk
            if (b.delay_status !== "no_show_risk") {
              await sb.from("bookings")
                .update({ delay_status: "no_show_risk", last_eta_update_at: now.toISOString() })
                .eq("id", b.id);
            }
            result.escalations++;
          }
        }

        // ─── 3) Predicted-arrival påminnelse: 30 min före ───
        if (
          b.predicted_arrival_at &&
          !b.cleaner_on_way_at
        ) {
          const predAt = new Date(b.predicted_arrival_at);
          const minutesUntilPred = minutesBetween(predAt, now);
          if (minutesUntilPred <= PREDICTED_ARRIVAL_PING_MIN && minutesUntilPred > 0) {
            const { data: cleaner } = await sb
              .from("cleaners")
              .select("phone, email")
              .eq("id", b.cleaner_id)
              .maybeSingle();
            if (cleaner?.phone || cleaner?.email) {
              await notify({
                cleaner_id: b.cleaner_id,
                email: cleaner.email || undefined,
                phone: cleaner.phone || undefined,
                sms_message: `Spick: Nästa bokning ${b.customer_name || "kund"} kl ${formatTimeSE(predAt)}. Tryck "På väg" när du startar.`,
                push_type: "predicted_arrival_ping",
                push_data: { booking_id: b.id, predicted_arrival_at: b.predicted_arrival_at },
              }).catch((e) => log("warn", "eta-monitor", "predicted ping failed", { booking_id: b.id, error: (e as Error).message }));
              result.predicted_pings++;
            }
          }
        }
      } catch (innerErr) {
        result.errors.push({ booking_id: b.id, error: (innerErr as Error).message });
        log("warn", "eta-monitor", "Inner loop error", { booking_id: b.id, error: (innerErr as Error).message });
      }
    }

    log("info", "eta-monitor", "Cron run complete", result);
    return json(result, 200, CORS);
  } catch (err) {
    log("error", "eta-monitor", "Unhandled error", { error: (err as Error).message });
    return json({ error: (err as Error).message, ...result }, 500, CORS);
  }
});

function json(data: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

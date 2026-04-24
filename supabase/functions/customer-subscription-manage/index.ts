// customer-subscription-manage — Fas 5 §5.4
// ═══════════════════════════════════════════════════════════
// Kund-facing action-wrapper för att hantera recurring subscriptions.
//
// POST body: { action, subscription_id, customer_email, data? }
//
// Actions:
//   pause        → status='paused', paused_at=NOW(), pause_reason
//   resume       → status='active', paused_at=NULL, pause_reason=NULL
//   skip-next    → next_booking_date = nextDate(current, frequency)
//   change-time  → preferred_time = data.preferred_time (HH:MM)
//   cancel       → status='cancelled', cancelled_at=NOW(), cancel_reason, end_date=idag
//
// Auth: ownership verifieras via (subscription_id + customer_email)-match i DB.
//
// Rule #31: Alla kolumner verifierade mot information_schema 2026-04-24.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, log, sendEmail, wrap, card, esc } from "../_shared/email.ts";
import { getStockholmDateString } from "../_shared/timezone.ts";
import {
  pauseHold,
  resumeHold,
  deleteHold,
  updateHoldTime,
  findSlotConflict,
} from "../_shared/slot-holds.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const WEEKDAY_NAMES = ["", "måndag", "tisdag", "onsdag", "torsdag", "fredag", "lördag", "söndag"];

type Action = "pause" | "resume" | "skip-next" | "change-time" | "cancel";

const VALID_ACTIONS: Action[] = ["pause", "resume", "skip-next", "change-time", "cancel"];

function nextDate(current: string, frequency: string): string {
  const [y, m, d] = current.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (frequency === "weekly") {
    dt.setUTCDate(dt.getUTCDate() + 7);
  } else if (frequency === "biweekly") {
    dt.setUTCDate(dt.getUTCDate() + 14);
  } else {
    const targetDay = dt.getUTCDate();
    dt.setUTCMonth(dt.getUTCMonth() + 1);
    if (dt.getUTCDate() !== targetDay) dt.setUTCDate(0);
  }
  return dt.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (status: number, data: unknown) => new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });

  const { action, subscription_id, customer_email, data } = body as {
    action?: string;
    subscription_id?: string;
    customer_email?: string;
    data?: Record<string, unknown>;
  };

  if (!action || !subscription_id || !customer_email) {
    return json(400, { error: "Missing required fields: action, subscription_id, customer_email" });
  }
  if (!VALID_ACTIONS.includes(action as Action)) {
    return json(400, { error: `Okänd action: ${action}. Giltiga: ${VALID_ACTIONS.join(", ")}` });
  }

  const email = String(customer_email).toLowerCase().trim();
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verifiera ownership + hämta fält för slot-holds + cleaner-notify
  const { data: sub, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("id, customer_email, customer_name, status, frequency, next_booking_date, preferred_day, preferred_time, booking_hours, cleaner_id, cleaner_name, service_type, customer_address")
    .eq("id", subscription_id)
    .eq("customer_email", email)
    .maybeSingle();

  if (fetchErr) {
    log("error", "customer-subscription-manage", "Fetch failed", { error: fetchErr.message, subscription_id });
    return json(500, { error: fetchErr.message });
  }
  if (!sub) {
    log("warn", "customer-subscription-manage", "Subscription not found or not owned", { subscription_id, email });
    return json(404, { error: "Prenumerationen hittades inte (kontrollera e-post)" });
  }

  const now = new Date().toISOString();
  const today = getStockholmDateString();
  const updateData: Record<string, unknown> = { updated_at: now };
  let resultMsg = "";
  const warnings: Array<{ type: string; message: string; details?: Record<string, unknown> }> = [];

  switch (action as Action) {
    case "pause":
      if (sub.status !== "active") {
        return json(400, { error: `Kan inte pausa: status är '${sub.status}' (måste vara 'active')` });
      }
      updateData.status = "paused";
      updateData.paused_at = now;
      updateData.pause_reason = typeof data?.reason === "string" ? data.reason : null;
      resultMsg = "Prenumerationen är pausad. Inga nya bokningar skapas förrän du återupptar.";
      break;

    case "resume": {
      if (sub.status !== "paused") {
        return json(400, { error: `Kan inte återuppta: status är '${sub.status}' (måste vara 'paused')` });
      }
      updateData.status = "active";
      updateData.paused_at = null;
      updateData.pause_reason = null;
      resultMsg = "Prenumerationen är återupptagen. Nästa bokning skapas enligt schema.";

      // §5.4.1 conflict-check: har någon annan aktiv sub tagit samma slot?
      if (sub.cleaner_id && typeof sub.preferred_day === "number" && sub.preferred_time && sub.booking_hours) {
        const conflict = await findSlotConflict(supabase, {
          cleaner_id: sub.cleaner_id,
          weekday: sub.preferred_day,
          start_time: sub.preferred_time,
          duration_hours: Number(sub.booking_hours),
          exclude_subscription_id: sub.id,
        });
        if (conflict) {
          const dayName = WEEKDAY_NAMES[sub.preferred_day] || "–";
          warnings.push({
            type: "slot_conflict",
            message: `${sub.cleaner_name || "Städaren"} har fått en ny återkommande kund ${dayName} kl ${(sub.preferred_time as string).slice(0, 5)} under din paus. Överväg att ändra tid eller välja ny städare.`,
            details: { cleaner_id: sub.cleaner_id, weekday: sub.preferred_day, preferred_time: sub.preferred_time },
          });
        }
      }

      // §5.4.1 calendar_events conflict-check för next_booking_date
      if (sub.cleaner_id && sub.next_booking_date && sub.preferred_time && sub.booking_hours) {
        const startTs = new Date(`${sub.next_booking_date}T${sub.preferred_time}Z`).toISOString();
        const endTs = new Date(
          new Date(startTs).getTime() + Number(sub.booking_hours) * 3600000,
        ).toISOString();
        const { data: bookedEvents } = await supabase
          .from("calendar_events")
          .select("id, event_type, start_at, end_at, booking_id")
          .eq("cleaner_id", sub.cleaner_id)
          .in("event_type", ["booking", "blocked"])
          .gte("start_at", sub.next_booking_date)
          .lte("start_at", sub.next_booking_date + "T23:59:59Z");
        const overlap = (bookedEvents || []).find((e) =>
          new Date(e.start_at) < new Date(endTs) && new Date(e.end_at) > new Date(startTs)
        );
        if (overlap) {
          warnings.push({
            type: "next_date_unavailable",
            message: `Nästa bokningsdatum (${sub.next_booking_date}) krockar med en annan bokning/blockering för ${sub.cleaner_name || "städaren"}. Kontakta hello@spick.se för alternativ.`,
            details: { next_booking_date: sub.next_booking_date, overlap_event_id: overlap.id },
          });
        }
      }
      break;
    }

    case "skip-next": {
      if (sub.status !== "active") {
        return json(400, { error: `Kan inte hoppa över: status är '${sub.status}' (måste vara 'active')` });
      }
      if (!sub.next_booking_date) {
        return json(400, { error: "Inget nästa datum definierat på prenumerationen" });
      }
      if (!sub.frequency) {
        return json(400, { error: "Ingen frekvens definierat på prenumerationen" });
      }
      const skipped = sub.next_booking_date;
      const nextAfter = nextDate(sub.next_booking_date, sub.frequency);
      updateData.next_booking_date = nextAfter;
      resultMsg = `Hoppade över ${skipped}. Nästa städning: ${nextAfter}.`;
      break;
    }

    case "change-time": {
      if (sub.status !== "active" && sub.status !== "paused") {
        return json(400, { error: `Kan inte ändra tid: status är '${sub.status}'` });
      }
      const newTime = data?.preferred_time;
      if (!newTime || typeof newTime !== "string") {
        return json(400, { error: "preferred_time krävs (HH:MM eller HH:MM:SS)" });
      }
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(newTime)) {
        return json(400, { error: "preferred_time måste vara HH:MM eller HH:MM:SS" });
      }
      updateData.preferred_time = newTime;
      resultMsg = `Tid uppdaterad till ${newTime}. Ändringen gäller framtida bokningar.`;

      // §5.4.1 conflict-check för NY tid
      if (sub.cleaner_id && typeof sub.preferred_day === "number" && sub.booking_hours) {
        const conflict = await findSlotConflict(supabase, {
          cleaner_id: sub.cleaner_id,
          weekday: sub.preferred_day,
          start_time: newTime,
          duration_hours: Number(sub.booking_hours),
          exclude_subscription_id: sub.id,
        });
        if (conflict) {
          const dayName = WEEKDAY_NAMES[sub.preferred_day] || "–";
          warnings.push({
            type: "slot_conflict_new_time",
            message: `${sub.cleaner_name || "Städaren"} har redan en annan återkommande kund ${dayName} kl ${newTime}. Nya bokningar på den tiden kan missas.`,
            details: { cleaner_id: sub.cleaner_id, weekday: sub.preferred_day, preferred_time: newTime },
          });
        }
      }
      break;
    }

    case "cancel":
      if (sub.status === "cancelled") {
        return json(400, { error: "Prenumerationen är redan avslutad" });
      }
      updateData.status = "cancelled";
      updateData.cancelled_at = now;
      updateData.cancel_reason = typeof data?.reason === "string" ? data.reason : null;
      updateData.end_date = today;
      resultMsg = "Prenumerationen är avslutad. Inga fler bokningar skapas.";
      break;
  }

  const { error: updateErr } = await supabase
    .from("subscriptions")
    .update(updateData)
    .eq("id", subscription_id);

  if (updateErr) {
    log("error", "customer-subscription-manage", "Update failed", {
      error: updateErr.message, subscription_id, action,
    });
    return json(500, { error: updateErr.message });
  }

  // ═══════════════════════════════════════════════════════
  // §5.4.2 Slot-hold-synk efter subscription-update.
  // Best-effort: fel här får inte rollback-a DB-update (kund ser inte holds).
  // ═══════════════════════════════════════════════════════
  try {
    if (action === "pause") {
      await pauseHold(supabase, subscription_id);
    } else if (action === "resume") {
      await resumeHold(supabase, subscription_id);
    } else if (action === "change-time" && typeof updateData.preferred_time === "string") {
      await updateHoldTime(supabase, subscription_id, updateData.preferred_time);
    } else if (action === "cancel") {
      await deleteHold(supabase, subscription_id);
    }
  } catch (e) {
    log("warn", "customer-subscription-manage", "Slot-hold sync failed", {
      subscription_id, action, error: (e as Error).message,
    });
  }

  // §5.4.1 change-time: notifiera städaren via email.
  if (action === "change-time" && sub.cleaner_id) {
    try {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("email, full_name")
        .eq("id", sub.cleaner_id)
        .maybeSingle();
      if (cleaner?.email) {
        const dayName = typeof sub.preferred_day === "number" ? WEEKDAY_NAMES[sub.preferred_day] : "–";
        const newTime = (updateData.preferred_time as string).slice(0, 5);
        const customerFirst = (sub.customer_name as string || "").split(" ")[0] || "Kunden";
        await sendEmail(
          cleaner.email,
          `Tidsändring i prenumeration — ${esc(customerFirst)}`,
          wrap(`
            <h2>Tidsändring i återkommande städning</h2>
            <p>Hej ${esc(cleaner.full_name || "")}!</p>
            <p><strong>${esc(customerFirst)}</strong> har ändrat tiden för sin återkommande städning.</p>
            ${card([
              ["Ny tid", `${dayName} kl ${newTime}`],
              ["Tjänst", esc(sub.service_type || "Hemstädning")],
              ["Timmar", `${sub.booking_hours || 3} h`],
              ["Adress", esc(sub.customer_address || "–")],
            ])}
            <p style="font-size:13px;color:#6B6960;margin-top:16px">Ändringen gäller framtida bokningar. Redan schemalagda städningar påverkas inte.</p>
            <p style="font-size:13px;color:#6B6960">Problem med den nya tiden? Svara på detta mejl eller kontakta hello@spick.se.</p>
          `),
        );
      }
    } catch (e) {
      log("warn", "customer-subscription-manage", "Cleaner notify-email failed", {
        subscription_id, error: (e as Error).message,
      });
    }
  }

  log("info", "customer-subscription-manage", "Action completed", {
    subscription_id, action, customer_email: email, warnings_count: warnings.length,
  });

  return json(200, {
    success: true,
    action,
    message: resultMsg,
    updated: updateData,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
});

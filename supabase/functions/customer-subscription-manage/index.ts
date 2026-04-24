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
import { corsHeaders, log } from "../_shared/email.ts";
import { getStockholmDateString } from "../_shared/timezone.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  // Verifiera ownership
  const { data: sub, error: fetchErr } = await supabase
    .from("subscriptions")
    .select("id, customer_email, status, frequency, next_booking_date, preferred_time")
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

    case "resume":
      if (sub.status !== "paused") {
        return json(400, { error: `Kan inte återuppta: status är '${sub.status}' (måste vara 'paused')` });
      }
      updateData.status = "active";
      updateData.paused_at = null;
      updateData.pause_reason = null;
      resultMsg = "Prenumerationen är återupptagen. Nästa bokning skapas enligt schema.";
      break;

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

  log("info", "customer-subscription-manage", "Action completed", {
    subscription_id, action, customer_email: email,
  });

  return json(200, {
    success: true,
    action,
    message: resultMsg,
    updated: updateData,
  });
});

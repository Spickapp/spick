// ═══════════════════════════════════════════════════════════════
// SPICK – n3-pnr-reminder-cron (N3 Sprint 3, 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// SYFTE:
//   Skickar SMS-påminnelser till kunder som inte signerat BankID
//   för RUT-PNR-verifiering efter 24h, 72h. Vid 168h (7d):
//   auto-faller method till 'unverified' (RUT förloras).
//
// AUTH: CRON_SECRET (header X-Cron-Secret)
//
// FLAG-GATE: platform_settings.n3_reminder_enabled
//
// REGLER: #26 N/A (ny EF), #27 scope (bara reminder-flow), #28 SSOT
//   (period-trösklar i platform_settings), #30 inga regulator-claims,
//   #31 schema curl-verifierat 2026-04-26 (reminder-fält ny migration).
// ═══════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "../_shared/email.ts";
import { sendSms } from "../_shared/notifications.ts";
import { createLogger } from "../_shared/log.ts";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const log = createLogger("n3-pnr-reminder-cron");

function json(cors: Record<string, string>, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function getSetting(key: string, fallback: number): Promise<number> {
  const { data } = await sb.from("platform_settings").select("value").eq("key", key).maybeSingle();
  const v = Number(data?.value);
  return isFinite(v) && v > 0 ? v : fallback;
}

async function getEnabled(): Promise<boolean> {
  const { data } = await sb.from("platform_settings").select("value").eq("key", "n3_reminder_enabled").maybeSingle();
  return data?.value === "true";
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // CRON_SECRET-verifiering
  const cronSecret = req.headers.get("X-Cron-Secret");
  if (cronSecret !== CRON_SECRET) {
    return json(CORS, 401, { error: "invalid_cron_secret" });
  }

  if (!await getEnabled()) {
    return json(CORS, 200, { ok: true, skipped: true, reason: "n3_reminder_enabled=false" });
  }

  const firstAfter = await getSetting("n3_reminder_first_after_hours", 24);
  const secondAfter = await getSetting("n3_reminder_second_after_hours", 72);
  const timeoutAfter = await getSetting("n3_reminder_timeout_hours", 168);

  const now = new Date();
  const stats = { first_sent: 0, second_sent: 0, timeouts_processed: 0, errors: 0 };

  try {
    // Hämta alla pending_bankid-bookings
    const { data: bookings, error } = await sb
      .from("bookings")
      .select("id, customer_email, customer_phone, customer_name, customer_pnr_verification_session_id, created_at, customer_pnr_reminder_count, customer_pnr_reminder_sent_at")
      .eq("pnr_verification_method", "pending_bankid")
      .order("created_at", { ascending: true });

    if (error) {
      log("error", "Fetch failed", { error: error.message });
      return json(CORS, 500, { error: "fetch_failed" });
    }

    if (!bookings || bookings.length === 0) {
      return json(CORS, 200, { ok: true, processed: 0, stats });
    }

    for (const b of bookings) {
      try {
        const createdAt = new Date(b.created_at as string);
        const ageHours = (now.getTime() - createdAt.getTime()) / 3600000;
        const reminderCount = (b.customer_pnr_reminder_count as number) || 0;
        const phone = b.customer_phone as string;

        // Timeout: 168h utan signering → faller till 'unverified'
        if (ageHours >= timeoutAfter) {
          await sb
            .from("bookings")
            .update({
              pnr_verification_method: "unverified",
              updated_at: now.toISOString(),
            })
            .eq("id", b.id);
          stats.timeouts_processed++;
          log("info", "Timeout: method → unverified", { booking_id: b.id, age_hours: Math.round(ageHours) });
          continue;
        }

        if (!phone) continue;  // ingen telefon = kan inte skicka SMS

        // Andra påminnelse vid 72h (om 1 redan skickad)
        if (ageHours >= secondAfter && reminderCount === 1) {
          const msg = `Hej ${(b.customer_name as string) || ""}! Påminnelse: signera BankID för din städning hos Spick så vi kan ansöka om RUT-avdrag. Det tar 30 sek. Annars förloras 50% rabatt. Tack!`;
          const r = await sendSms(phone, msg);
          if (r.success) {
            await sb
              .from("bookings")
              .update({
                customer_pnr_reminder_sent_at: now.toISOString(),
                customer_pnr_reminder_count: 2,
                updated_at: now.toISOString(),
              })
              .eq("id", b.id);
            stats.second_sent++;
          } else {
            stats.errors++;
          }
          continue;
        }

        // Första påminnelse vid 24h (om 0 skickade)
        if (ageHours >= firstAfter && reminderCount === 0) {
          const msg = `Hej ${(b.customer_name as string) || ""}! För att din städning hos Spick ska få RUT-avdrag (50% rabatt) behöver du signera med BankID. Det tar 30 sek. Tack!`;
          const r = await sendSms(phone, msg);
          if (r.success) {
            await sb
              .from("bookings")
              .update({
                customer_pnr_reminder_sent_at: now.toISOString(),
                customer_pnr_reminder_count: 1,
                updated_at: now.toISOString(),
              })
              .eq("id", b.id);
            stats.first_sent++;
          } else {
            stats.errors++;
          }
        }
      } catch (e) {
        stats.errors++;
        log("error", "Processing booking failed", { booking_id: b.id, error: (e as Error).message });
      }
    }

    log("info", "N3 reminder-cron klar", { ...stats, total_pending: bookings.length });
    return json(CORS, 200, { ok: true, processed: bookings.length, stats });
  } catch (err) {
    log("error", "Unexpected error", { error: (err as Error).message });
    return json(CORS, 500, { error: "internal_error" });
  }
});

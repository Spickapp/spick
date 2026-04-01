/**
 * cleanup-stale — Rensar pending-bokningar som aldrig betalats
 *
 * Körs via GitHub Actions cron varje timme.
 * Uppdaterar payment_status till 'cancelled' för obetalda bokningar
 * äldre än 30 minuter.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const ADMIN_EMAIL = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (_req) => {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    // 1. Find stale bookings (unpaid >30 min)
    const { data: stale, error: fetchErr } = await sb
      .from("bookings")
      .select("id, created_at")
      .eq("payment_status", "pending")
      .in("status", ["pending", "ny"])
      .lt("created_at", cutoff);

    if (fetchErr) throw fetchErr;

    if (!stale || stale.length === 0) {
      return new Response(JSON.stringify({
        cleaned: 0,
        message: "Inga stale bokningar",
        timestamp: new Date().toISOString(),
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const staleIds = stale.map((b) => b.id);

    // 2. Update payment_status only (avoid status check constraint issues)
    const { error: updateErr } = await sb
      .from("bookings")
      .update({ payment_status: "cancelled" })
      .in("id", staleIds);

    if (updateErr) throw updateErr;

    // 3. Log in booking_status_log (non-critical)
    try {
      await sb.from("booking_status_log").insert(
        staleIds.map((id) => ({
          booking_id: id,
          old_status: "pending",
          new_status: "cancelled (stale)",
          changed_by: "system:cleanup-stale",
        })),
      );
    } catch (_) { /* non-critical */ }

    // 4. Notify admin if many stale bookings
    if (stale.length >= 3 && RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Spick System <hello@spick.se>",
          to: ADMIN_EMAIL,
          subject: `⚠️ ${stale.length} stale bokningar rensade`,
          html: `<p>${stale.length} bokningar som aldrig betalats (>30 min) har markerats som cancelled.</p>
            <p>Detta kan indikera ett problem med Stripe checkout-flödet.</p>`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      cleaned: stale.length,
      ids: staleIds,
      timestamp: new Date().toISOString(),
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Cleanup error:", e);
    return new Response(JSON.stringify({
      error: (e as Error).message,
      timestamp: new Date().toISOString(),
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

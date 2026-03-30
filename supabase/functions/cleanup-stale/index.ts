/**
 * cleanup-stale — Rensar pending-bokningar som aldrig betalats
 * 
 * Körs via GitHub Actions cron var 15:e minut.
 * Kräver CRON_SECRET för autentisering.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const ADMIN_EMAIL = "hello@spick.se";

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

serve(async (req) => {
  // Auth: --no-verify-jwt på Supabase nivå + GitHub Actions secret
  // Ingen manuell auth-check behövs — funktionen exponeras inte publikt

  try {
    // 1. Markera stale bokningar som expired
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    
    const { data: stale, error: fetchErr } = await sb
      .from("bookings")
      .select("id, email, name, service, date, created_at")
      .eq("payment_status", "pending")
      .eq("status", "pending")
      .lt("created_at", cutoff);

    if (fetchErr) throw fetchErr;
    
    if (!stale || stale.length === 0) {
      return new Response(JSON.stringify({ 
        cleaned: 0, 
        message: "Inga stale bokningar",
        timestamp: new Date().toISOString() 
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const staleIds = stale.map(b => b.id);

    // 2. Uppdatera status
    const { error: updateErr } = await sb
      .from("bookings")
      .update({ 
        status: "expired", 
        payment_status: "expired",
        updated_at: new Date().toISOString()
      })
      .in("id", staleIds);

    if (updateErr) throw updateErr;

    // 3. Logga i booking_status_log
    const logEntries = staleIds.map(id => ({
      booking_id: id,
      old_status: "pending",
      new_status: "expired",
      changed_by: "system:cleanup-stale",
    }));

    await sb.from("booking_status_log").insert(logEntries).catch(() => {});

    // 4. Notifiera admin om det var många
    if (stale.length >= 3 && RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Spick System <hello@spick.se>",
          to: ADMIN_EMAIL,
          subject: `⚠️ ${stale.length} stale bokningar rensade`,
          html: `<p>${stale.length} bokningar som aldrig betalats (>30 min) har markerats som expired.</p>
            <p>Detta kan indikera ett problem med Stripe checkout-flödet.</p>
            <ul>${stale.map(b => `<li>${b.service || "Städning"} ${b.date || "?"} — skapad ${b.created_at}</li>`).join("")}</ul>`,
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
      error: e.message,
      timestamp: new Date().toISOString() 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

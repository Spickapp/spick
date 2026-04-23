/**
 * admin-morning-report – Daglig sammanfattning till hello@spick.se kl 08:00 svensk tid
 * Körs via GitHub Actions cron (06:00 UTC = 08:00 svensk sommartid)
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getStockholmDateString } from "../_shared/timezone.ts";

const SUPA_URL   = "https://urjeijcncsyuletprydy.supabase.co";
const SUPA_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM       = "Spick <hello@spick.se>";
const ADMIN      = "hello@spick.se";
const sb         = createClient(SUPA_URL, SUPA_KEY);

function wrap(html: string) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
body{margin:0;background:#F7F7F5;font-family:'DM Sans',Arial,sans-serif}
.w{max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.06)}
.h{background:#0F6E56;padding:20px 28px}.logo{font-family:Georgia,serif;font-size:20px;font-weight:700;color:#fff}
.b{padding:28px}.f{padding:14px 28px;background:#F7F7F5;font-size:11px;color:#9E9E9A;text-align:center}
h2{font-family:Georgia,serif;font-size:18px;color:#1C1C1A;margin:0 0 10px}
p{color:#6B6960;line-height:1.7;font-size:14px;margin:0 0 10px}
.card{background:#F7F7F5;border-radius:10px;padding:16px;margin:12px 0}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #E8E8E4;font-size:14px}
.row:last-child{border:none}.lbl{color:#6B6960}.val{font-weight:700;color:#1C1C1A}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:11px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;margin-top:10px}
.quiet{background:#DBEAFE;border-radius:10px;padding:14px;margin:10px 0;font-size:13px;color:#1E40AF;text-align:center}
</style></head><body><div class="w">
<div class="h"><div class="logo">Spick</div></div>
<div class="b">${html}</div>
<div class="f">Spick · hello@spick.se · <a href="https://spick.se" style="color:#0F6E56">spick.se</a></div>
</div></body></html>`;
}

async function mail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html })
  });
  if (!res.ok) console.error("Email-fel:", await res.text());
  return res.ok;
}

// Rule #31-fix: ymd() via UTC är FEL för "svensk dag". Om EF kör 06:07
// UTC (= 08:07 CEST), och bokning skapades 22:30 CEST (= 20:30 UTC),
// då är bokningen på "idag" svensk tid men "igår" UTC. Använder nu
// Stockholm-tidszon från _shared/timezone.ts för konsistent svensk
// dag-beräkning.

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const now = new Date();
    const today = getStockholmDateString(now);

    // Igår i svensk tid — skapa via Stockholm-midnatt, inte UTC-midnatt
    const yDate = new Date(now);
    yDate.setUTCDate(yDate.getUTCDate() - 1);
    const yesterday = getStockholmDateString(yDate);

    // 1. Dagens bokningar (alla statusar utom cancelled/avbokad)
    const { count: todayBookings } = await sb.from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("booking_date", today)
      .not("status", "in", "(cancelled,avbokad)");

    // 2. Väntande ansökningar
    const { count: pendingApps } = await sb.from("cleaner_applications")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    // 3. Väntande bekräftelser
    const { count: pendingConf } = await sb.from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending_confirmation");

    // 4. Städare i onboarding
    const { count: onboarding } = await sb.from("cleaners")
      .select("*", { count: "exact", head: true })
      .eq("status", "onboarding");

    // 5. Gårdagens intäkt (Spick-net-provision)
    const { data: revRows } = await sb.from("bookings")
      .select("spick_net_sek")
      .eq("booking_date", yesterday)
      .eq("payment_status", "paid");
    const yesterdayRevenue = (revRows || []).reduce(
      (sum: number, r: { spick_net_sek: number | null }) =>
        sum + (Number(r.spick_net_sek) || 0),
      0
    );

    // 6. Fas 10 §10.5: Intressanta events senaste 24h (från booking_events)
    // Filtrerar till events som kräver uppmärksamhet — inte rad-för-rad brus.
    // Primärkälla för event-types: docs/architecture/event-schema.md §3
    const INTERESTING_EVENTS = [
      "dispute_opened",       // EU-compliance, 7d-SLA
      "dispute_resolved",     // utfall viktigt
      "noshow_reported",      // cleaner-kvalitet
      "cancelled_by_cleaner", // reassignment-arbete
      "cancelled_by_admin",   // admin-action-spår
      "refund_issued",        // money-flöde audit
      "recurring_cancelled",  // retention-signal
    ] as const;

    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: eventRows } = await sb
      .from("booking_events")
      .select("event_type, created_at, booking_id, metadata")
      .in("event_type", INTERESTING_EVENTS as unknown as string[])
      .gte("created_at", since24h)
      .order("created_at", { ascending: false })
      .limit(100);

    const eventCounts: Record<string, number> = {};
    for (const e of (eventRows || []) as Array<{ event_type: string }>) {
      eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;
    }
    const hasCritical = (eventCounts.dispute_opened || 0) > 0 ||
      (eventCounts.noshow_reported || 0) > 0;

    const stats = {
      today_bookings: todayBookings || 0,
      pending_apps: pendingApps || 0,
      pending_conf: pendingConf || 0,
      onboarding: onboarding || 0,
      yesterday_revenue: Math.round(yesterdayRevenue),
      interesting_events_24h: Object.values(eventCounts).reduce((a, b) => a + b, 0),
    };

    const dateLabel = now.toLocaleDateString("sv-SE", {
      weekday: "long", day: "numeric", month: "long",
    });
    const subject = hasCritical
      ? `⚠️ Spick morgonrapport — ${dateLabel} — action needed`
      : `☀️ Spick morgonrapport — ${dateLabel} — ${stats.today_bookings} bokningar idag`;

    const quietDay = stats.today_bookings === 0 && stats.pending_apps === 0 &&
      stats.interesting_events_24h === 0;

    // Human-läsbara labels per event-type
    const EVENT_LABELS: Record<string, string> = {
      dispute_opened: "⚠️ Tvist öppnad",
      dispute_resolved: "✅ Tvist löst",
      noshow_reported: "🚨 No-show rapporterad",
      cancelled_by_cleaner: "❌ Avböjd av städare",
      cancelled_by_admin: "🛠️ Avbokad av admin",
      refund_issued: "↩️ Återbetalning",
      recurring_cancelled: "🔁 Prenumeration avslutad",
    };

    const eventsHtml = stats.interesting_events_24h === 0
      ? '<p style="color:#6B6960;font-size:13px;margin:4px 0">Inga intressanta events senaste 24h.</p>'
      : Object.entries(eventCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) =>
            `<div class="row"><span class="lbl">${EVENT_LABELS[type] || type}</span><span class="val">${count}</span></div>`
          ).join("");

    const html = wrap(`
<h2>${hasCritical ? "⚠️" : "☀️"} God morgon!</h2>
<p>Här är dagens läge:</p>
<div class="card">
  <div class="row"><span class="lbl">📅 Bokningar idag</span><span class="val">${stats.today_bookings}</span></div>
  <div class="row"><span class="lbl">👋 Nya ansökningar</span><span class="val">${stats.pending_apps}${stats.pending_apps > 0 ? " (väntar godkännande)" : ""}</span></div>
  <div class="row"><span class="lbl">⏳ Väntar bekräftelse</span><span class="val">${stats.pending_conf}</span></div>
  <div class="row"><span class="lbl">🔧 Onboarding</span><span class="val">${stats.onboarding} städare</span></div>
  <div class="row"><span class="lbl">💰 Gårdagens intäkt</span><span class="val">${stats.yesterday_revenue.toLocaleString("sv-SE")} kr</span></div>
</div>
<h2 style="margin-top:24px">${hasCritical ? "🚨 Senaste 24h (kräver uppmärksamhet)" : "📊 Senaste 24h"}</h2>
<div class="card">
  ${eventsHtml}
</div>
${quietDay ? `<div class="quiet">Lugnt idag — fokus på rekrytering! 💪</div>` : ""}
<a href="https://spick.se/admin.html" class="btn">Öppna admin →</a>
`);

    const sent = await mail(ADMIN, subject, html);

    return new Response(
      JSON.stringify({ ok: true, sent, stats }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("admin-morning-report-fel:", (e as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

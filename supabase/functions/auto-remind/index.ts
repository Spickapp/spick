/**
 * auto-remind – Automatiska påminnelser och uppföljningar
 * Körs var 30:e minut via GitHub Actions cron
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
.row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #E8E8E4;font-size:13px}
.row:last-child{border:none}.lbl{color:#9B9B95}.val{font-weight:600}
.btn{display:inline-block;background:#0F6E56;color:#fff;padding:11px 24px;border-radius:100px;text-decoration:none;font-weight:600;font-size:14px;margin-top:6px}
.warn{background:#FEF3C7;border-left:3px solid #F59E0B;padding:12px;border-radius:0 8px 8px 0;margin:10px 0;font-size:13px}
.info{background:#DBEAFE;border-radius:10px;padding:14px;margin:10px 0;font-size:13px;color:#1E40AF}
</style></head><body><div class="w">
<div class="h"><div class="logo">Spick</div></div>
<div class="b">${html}</div>
<div class="f">Spick AB · hello@spick.se · <a href="https://spick.se" style="color:#0F6E56">spick.se</a></div>
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, {headers:{"Access-Control-Allow-Origin":"https://spick.se"}});

  const now  = new Date();
  const sent: string[] = [];

  try {
    const { data: bookings } = await sb.from("bookings")
      .select("*")
      .eq("payment_status", "paid")
      .neq("status", "klar")
      .neq("status", "avbokad");

    for (const b of bookings || []) {
      const dateStr  = b.date || b.scheduled_date;
      if (!dateStr) continue;
      const dateTime = new Date(`${dateStr}T${(b.time || b.scheduled_time || "09:00")}:00`);
      const hoursLeft = (dateTime.getTime() - now.getTime()) / 3_600_000;
      const alreadySent = (b.reminders_sent || []) as string[];

      // 24h-påminnelse
      if (hoursLeft <= 24 && hoursLeft > 22 && !alreadySent.includes("24h")) {
        const fname = (b.customer_name || "Kund").split(" ")[0];
        const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(b.address || "")}`;

        // Till kund
        await mail(b.customer_email || b.email,
          `⏰ Påminnelse: Städning imorgon kl ${b.time || "09:00"}`,
          wrap(`<h2>Din städning är imorgon! 🧹</h2>
<p>Hej ${fname}! Påminnelse om din bokade städning.</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service||"Hemstädning"}</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${dateStr}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.address||"–"}</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${b.cleaner_name||"Tilldelas"}</span></div>
</div>
<div class="info">💡 Se till att städaren kan komma in. Lämna kod eller nyckel vid behov.</div>
<p>Avboka gratis senast kl ${b.time||"09:00"} idag – skriv till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
<a href="https://spick.se/min-bokning.html?bid=${b.id}" class="btn">Visa min bokning →</a>`));

        // Till städare
        if (b.cleaner_email || b.cleaners?.email) {
          const cEmail = b.cleaner_email || b.cleaners?.email;
          const cName  = b.cleaner_name || "Städare";
          const earn   = Math.round((b.total_price||0)*0.83);
          await mail(cEmail,
            `📍 Uppdrag imorgon kl ${b.time||"09:00"} – ${b.service||"Städning"}`,
            wrap(`<h2>Påminnelse: Uppdrag imorgon! 🗓</h2>
<p>Hej ${cName.split(" ")[0]}!</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service||"Hemstädning"} · ${b.hours||3}h</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.address||"–"}</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${b.customer_name||"–"}</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">${earn} kr</span></div>
  ${b.key_info?`<div class="row"><span class="lbl">🔑 Nyckel/Kod</span><span class="val">${b.key_info}</span></div>`:""}
  ${b.customer_notes?`<div class="row"><span class="lbl">Noteringar</span><span class="val">${b.customer_notes}</span></div>`:""}
</div>
<a href="${mapsUrl}" class="btn" style="margin-right:8px">📍 Navigera →</a>
<a href="https://spick.se/stadare-dashboard.html" class="btn" style="background:#1C1C1A">Öppna app →</a>`));
        }

        await sb.from("bookings").update({reminders_sent:[...alreadySent,"24h"]}).eq("id",b.id);
        sent.push(`24h:${b.id}`);
      }

      // 2h-påminnelse
      if (hoursLeft<=2 && hoursLeft>1 && !alreadySent.includes("2h")) {
        const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(b.address||"")}`;
        const cEmail  = b.cleaner_email || b.cleaners?.email;
        const cName   = b.cleaner_name || "";
        const earn    = Math.round((b.total_price||0)*0.83);

        if (cEmail) await mail(cEmail,
          `🚨 Om 2 timmar: Städning kl ${b.time||"09:00"} – ${b.address||""}`,
          wrap(`<h2>2 timmar kvar – dags att sätta igång! ⚡</h2>
<div class="card">
  <div class="row"><span class="lbl">Adress</span><span class="val" style="color:#0F6E56;font-size:15px">${b.address||"–"}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.time||"09:00"} (${b.hours||3}h)</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${b.customer_name||"–"}</span></div>
  <div class="row"><span class="lbl">Intjäning</span><span class="val" style="color:#0F6E56">${earn} kr</span></div>
  ${b.key_info?`<div class="row"><span class="lbl">🔑 Nyckel/Kod</span><span class="val" style="color:#DC2626">${b.key_info}</span></div>`:""}
  ${b.customer_notes?`<div class="row"><span class="lbl">📝 Noteringar</span><span class="val">${b.customer_notes}</span></div>`:""}
</div>
${!b.key_info?'<div class="warn">🔑 Inga nyckelinstruktioner sparade. Kontakta kunden om du inte kan komma in.</div>':""}
<a href="${mapsUrl}" class="btn">📍 Starta navigering →</a>`));

        await sb.from("bookings").update({reminders_sent:[...alreadySent,"2h"]}).eq("id",b.id);
        sent.push(`2h:${b.id}`);
      }

      // Admin-varning: ingen städare 6h innan
      if (hoursLeft<=6 && hoursLeft>5 && !b.cleaner_id && !alreadySent.includes("no-cleaner")) {
        await mail(ADMIN,
          `🚨 Akut: Ingen städare tilldelad – bokning om ${Math.round(hoursLeft)}h!`,
          wrap(`<h2>⚠️ Ingen städare tilldelad!</h2>
<div class="card">
  <div class="row"><span class="lbl">Kund</span><span class="val">${b.customer_name||"–"}</span></div>
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service||"Städning"}</span></div>
  <div class="row"><span class="lbl">Datum/tid</span><span class="val">${dateStr} kl ${b.time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.address||"–"}</span></div>
</div>
<a href="https://spick.se/admin.html" class="btn">Tilldela städare nu →</a>`));
        await sb.from("bookings").update({reminders_sent:[...alreadySent,"no-cleaner"]}).eq("id",b.id);
        sent.push(`no-cleaner:${b.id}`);
      }
    }

    // Review-request 3h efter klar
    const { data: done } = await sb.from("bookings")
      .select("*").eq("status","klar").is("review_requested_at",null);

    for (const b of done || []) {
      const comp = b.completed_at ? new Date(b.completed_at) : null;
      if (!comp) continue;
      const hoursAgo = (now.getTime()-comp.getTime())/3_600_000;
      if (hoursAgo<3 || hoursAgo>48) continue;

      const fname = (b.customer_name||"Kund").split(" ")[0];
      await mail(b.customer_email||b.email,
        `⭐ Hur gick städningen? Ditt betyg hjälper!`,
        wrap(`<h2>Hoppas du är nöjd, ${fname}! ⭐</h2>
<p>Din ${b.service||"städning"} är klar. Hur gick det? Ditt betyg tar 30 sekunder och hjälper ${b.cleaner_name||"städaren"} enormt.</p>
<a href="https://spick.se/betyg.html?bid=${b.id}&cname=${encodeURIComponent(b.cleaner_name||"")}" class="btn">Lämna betyg →</a>
<hr style="border:none;border-top:1px solid #E8E8E4;margin:16px 0">
<p style="font-size:12px">Inte nöjd? Vi städar om gratis. Skriv till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> inom 24h.</p>`));

      await sb.from("bookings").update({review_requested_at:now.toISOString()}).eq("id",b.id);
      sent.push(`review:${b.id}`);
    }

    // ── EMAIL RETRY QUEUE ─────────────────────────────────────
    // Processa misslyckade mejl (max 10 per körning)
    const { data: queued } = await sb.from("email_queue")
      .select("*")
      .eq("status", "pending")
      .lte("next_retry_at", now.toISOString())
      .lt("attempts", 3)
      .order("created_at", { ascending: true })
      .limit(10);

    for (const q of queued || []) {
      try {
        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to: q.to_email, subject: q.subject, html: q.html })
        });
        if (emailRes.ok) {
          await sb.from("email_queue").update({ status: "sent", sent_at: now.toISOString() }).eq("id", q.id);
          sent.push(`retry:${q.to_email}`);
        } else {
          const nextRetry = new Date(now.getTime() + (q.attempts + 1) * 10 * 60 * 1000); // exponential: 10min, 20min, 30min
          await sb.from("email_queue").update({
            attempts: q.attempts + 1,
            last_error: `HTTP ${emailRes.status}`,
            next_retry_at: nextRetry.toISOString(),
            status: q.attempts + 1 >= 3 ? "failed" : "pending",
          }).eq("id", q.id);
        }
      } catch (e) {
        await sb.from("email_queue").update({
          attempts: q.attempts + 1,
          last_error: (e as Error).message,
          status: q.attempts + 1 >= 3 ? "failed" : "pending",
        }).eq("id", q.id);
      }
    }

    // ── RATE LIMIT CLEANUP ────────────────────────────────────
    await sb.rpc("cleanup_rate_limits").catch(() => {});

  } catch(e) {
    console.error("auto-remind fel:", e);
    return new Response(JSON.stringify({error:(e as Error).message}), {status:500,headers:{"Content-Type":"application/json"}});
  }

  console.log("auto-remind klar:", sent);
  return new Response(JSON.stringify({ok:true,sent,ts:now.toISOString()}), {
    headers:{"Content-Type":"application/json"}
  });
});

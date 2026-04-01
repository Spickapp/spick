/**
 * auto-remind – Automatiska påminnelser och uppföljningar
 * Körs var 30:e minut via GitHub Actions cron
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/email.ts";

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


/** Fire-and-forget SMS via sms-EF. Loggar fel men kastar aldrig undantag. */
async function sendSms(to: string | null | undefined, message: string): Promise<void> {
  if (!to) return;
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ to, message }),
    });
  } catch (e) {
    console.warn("SMS skippat:", (e as Error).message);
  }
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Auth: --no-verify-jwt på Supabase nivå + GitHub Actions secret
  // Ingen manuell auth-check behövs

  const now  = new Date();
  const sent: string[] = [];

  try {
    const { data: bookings } = await sb.from("bookings")
      .select("*")
      .eq("payment_status", "paid")
      .neq("status", "klar")
      .neq("status", "avbokad");

    for (const b of bookings || []) {
      const dateStr  = b.booking_date;
      if (!dateStr) continue;
      const dateTime = new Date(`${dateStr}T${(b.booking_time || "09:00")}:00`);
      const hoursLeft = (dateTime.getTime() - now.getTime()) / 3_600_000;
      const alreadySent = (b.reminders_sent || []) as string[];

      // 24h-påminnelse
      if (hoursLeft <= 24 && hoursLeft > 22 && !alreadySent.includes("24h")) {
        const fname = (b.customer_name || "Kund").split(" ")[0];
        const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(b.customer_address || "")}`;

        // Till kund
        await mail(b.customer_email,
          `⏰ Påminnelse: Städning imorgon kl ${b.booking_time || "09:00"}`,
          wrap(`<h2>Din städning är imorgon! 🧹</h2>
<p>Hej ${fname}! Påminnelse om din bokade städning.</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service_type||"Hemstädning"}</span></div>
  <div class="row"><span class="lbl">Datum</span><span class="val">${dateStr}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.booking_time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.customer_address||"–"}</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${b.cleaner_name||"Tilldelas"}</span></div>
</div>
<div class="info">💡 Se till att städaren kan komma in. Lämna kod eller nyckel vid behov.</div>
<p>Avboka gratis senast kl ${b.booking_time||"09:00"} idag – skriv till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a></p>
<a href="https://spick.se/min-bokning.html?bid=${b.id}" class="btn">Visa min bokning →</a>`));

        // Till städare
        if (b.cleaner_email || b.cleaners?.email) {
          const cEmail = b.cleaner_email || b.cleaners?.email;
          const cName  = b.cleaner_name || "Städare";
          const earn   = Math.round((b.total_price||0)*0.83);
          await mail(cEmail,
            `📍 Uppdrag imorgon kl ${b.booking_time||"09:00"} – ${b.service_type||"Städning"}`,
            wrap(`<h2>Påminnelse: Uppdrag imorgon! 🗓</h2>
<p>Hej ${cName.split(" ")[0]}!</p>
<div class="card">
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service_type||"Hemstädning"} · ${b.booking_hours||3}h</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.booking_time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.customer_address||"–"}</span></div>
  <div class="row"><span class="lbl">Kund</span><span class="val">${b.customer_name||"–"}</span></div>
  <div class="row"><span class="lbl">Din intjäning</span><span class="val" style="color:#0F6E56">${earn} kr</span></div>
  ${b.key_info?`<div class="row"><span class="lbl">🔑 Nyckel/Kod</span><span class="val">${b.key_info}</span></div>`:""}
  ${b.customer_notes?`<div class="row"><span class="lbl">Noteringar</span><span class="val">${b.customer_notes}</span></div>`:""}
</div>
<a href="${mapsUrl}" class="btn" style="margin-right:8px">📍 Navigera →</a>
<a href="https://spick.se/portal" class="btn" style="background:#1C1C1A">Öppna app →</a>`));
        }

        // SMS-påminnelse 24h innan (fire-and-forget)
        await sendSms(
          b.customer_phone,
          `Spick: Påminnelse 🧹 Din städning är imorgon kl ${b.booking_time || "09:00"}. ` +
          `${b.cleaner_name ? `Städare: ${b.cleaner_name}. ` : ""}` +
          `Adress: ${b.customer_address || ""}. Frågor? hello@spick.se`
        );

        await sb.from("bookings").update({reminders_sent:[...alreadySent,"24h"]}).eq("id",b.id);
        sent.push(`24h:${b.id}`);
      }

      // 2h-påminnelse
      if (hoursLeft<=2 && hoursLeft>1 && !alreadySent.includes("2h")) {
        const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(b.customer_address||"")}`;
        const cEmail  = b.cleaner_email || b.cleaners?.email;
        const cName   = b.cleaner_name || "";
        const earn    = Math.round((b.total_price||0)*0.83);

        if (cEmail) await mail(cEmail,
          `🚨 Om 2 timmar: Städning kl ${b.booking_time||"09:00"} – ${b.customer_address||""}`,
          wrap(`<h2>2 timmar kvar – dags att sätta igång! ⚡</h2>
<div class="card">
  <div class="row"><span class="lbl">Adress</span><span class="val" style="color:#0F6E56;font-size:15px">${b.customer_address||"–"}</span></div>
  <div class="row"><span class="lbl">Tid</span><span class="val">kl ${b.booking_time||"09:00"} (${b.booking_hours||3}h)</span></div>
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
  <div class="row"><span class="lbl">Tjänst</span><span class="val">${b.service_type||"Städning"}</span></div>
  <div class="row"><span class="lbl">Datum/tid</span><span class="val">${dateStr} kl ${b.booking_time||"09:00"}</span></div>
  <div class="row"><span class="lbl">Adress</span><span class="val">${b.customer_address||"–"}</span></div>
</div>
<a href="https://spick.se/admin.html" class="btn">Tilldela städare nu →</a>`));
        await sb.from("bookings").update({reminders_sent:[...alreadySent,"no-cleaner"]}).eq("id",b.id);
        sent.push(`no-cleaner:${b.id}`);
      }
    }

    // ── SENTIMENT CHECK (T+2h) ───────────────────────────────
    // Skicka 3-knappars känslocheck INNAN review-förfrågan
    const { data: sentimentCandidates } = await sb.from("bookings")
      .select("*").eq("status","klar").not("reminders_sent","cs","{sentiment_2h}");

    for (const b of sentimentCandidates || []) {
      const comp = b.completed_at ? new Date(b.completed_at) : null;
      if (!comp) continue;
      const hoursAgo = (now.getTime() - comp.getTime()) / 3_600_000;
      if (hoursAgo < 2 || hoursAgo > 3) continue;

      const fname = (b.customer_name || "").split(" ")[0] || "Hej";
      const cname = b.cleaner_name || "din städare";
      const prevSent = (b.reminders_sent || []) as string[];
      const base = `https://spick.se/betyg.html?bid=${b.id}&cname=${encodeURIComponent(cname)}`;

      await mail(b.customer_email,
        `Hur gick din städning? (1 klick) 😊`,
        wrap(`<h2>Hur gick det, ${fname}? 🧹</h2>
<p>Din ${b.service_type ||"städning"} med ${cname} är klar. Hur upplevde du det?</p>
<div style="text-align:center;margin:24px 0">
  <a href="${base}&rating=5&sentiment=positive" style="display:inline-block;background:#ECFDF5;color:#065F46;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:1.4rem;font-weight:700;margin:0 8px;border:2px solid #6EE7B7">😊 Fantastiskt!</a>
  <a href="${base}&rating=3&sentiment=neutral" style="display:inline-block;background:#FEF3C7;color:#92400E;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:1.4rem;font-weight:700;margin:0 8px;border:2px solid #FCD34D">😐 Okej</a>
  <a href="mailto:hello@spick.se?subject=Feedback%20bokning%20${b.id}&body=Hej,%20jag%20var%20inte%20helt%20nöjd%20med%20min%20städning..." style="display:inline-block;background:#FEE2E2;color:#991B1B;padding:14px 28px;border-radius:12px;text-decoration:none;font-size:1.4rem;font-weight:700;margin:0 8px;border:2px solid #FCA5A5">😞 Inte nöjd</a>
</div>
<p style="font-size:12px;color:#9B9B95;text-align:center">Klicka den som passar bäst — tar 1 sekund</p>`));

      await sb.from("bookings").update({ reminders_sent: [...prevSent, "sentiment_2h"] }).eq("id", b.id);
      sent.push(`sentiment_2h:${b.id}`);
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
      await mail(b.customer_email,
        `⭐ Hur gick städningen? Ditt betyg hjälper!`,
        wrap(`<h2>Hoppas du är nöjd, ${fname}! ⭐</h2>
<p>Din ${b.service_type||"städning"} är klar. Hur gick det? Ditt betyg tar 30 sekunder och hjälper ${b.cleaner_name||"städaren"} enormt.</p>
<p style="font-size:13px;color:#6B6960">87% av våra kunder lämnar betyg — det gör stor skillnad! 💚</p>
<a href="https://spick.se/betyg.html?bid=${b.id}&cname=${encodeURIComponent(b.cleaner_name||"")}&rating=5" class="btn">⭐ Lämna betyg →</a>
<hr style="border:none;border-top:1px solid #E8E8E4;margin:16px 0">
<p style="font-size:12px">Inte nöjd? Vi städar om gratis. Skriv till <a href="mailto:hello@spick.se" style="color:#0F6E56">hello@spick.se</a> inom 24h.</p>`));

      await sb.from("bookings").update({review_requested_at:now.toISOString()}).eq("id",b.id);
      sent.push(`review:${b.id}`);
    }

    // ── REVIEW REMINDER (T+72h) ──────────────────────────────
    // Påminn kunder som inte lämnat betyg efter 3 dagar
    const { data: reminderCandidates } = await sb.from("bookings")
      .select("*").eq("status","klar").not("review_requested_at", "is", null).not("reminders_sent","cs","{review_72h}");

    for (const b of reminderCandidates || []) {
      const reqAt = b.review_requested_at ? new Date(b.review_requested_at) : null;
      if (!reqAt) continue;
      const hoursSinceReq = (now.getTime() - reqAt.getTime()) / 3_600_000;
      if (hoursSinceReq < 72 || hoursSinceReq > 120) continue;

      // Kolla om kund redan lämnat betyg
      const { data: existingReview } = await sb.from("reviews")
        .select("id").eq("booking_id", b.id).limit(1);
      if (existingReview && existingReview.length > 0) continue;

      const fname = (b.customer_name || "").split(" ")[0] || "Hej";
      const prevSent = (b.reminders_sent || []) as string[];

      await mail(b.customer_email,
        `Vi vill gärna höra från dig 🙏`,
        wrap(`<h2>${fname}, din åsikt spelar roll 🙏</h2>
<p>Vi frågade för några dagar sedan hur din städning gick. Ditt betyg hjälper ${b.cleaner_name || "städaren"} att bli ännu bättre.</p>
<a href="https://spick.se/betyg.html?bid=${b.id}&cname=${encodeURIComponent(b.cleaner_name || "")}" class="btn">Lämna betyg → 30 sekunder</a>
<p style="font-size:12px;color:#9B9B95;margin-top:16px">Vi frågar aldrig mer — detta är sista påminnelsen.</p>`));

      await sb.from("bookings").update({ reminders_sent: [...prevSent, "review_72h"] }).eq("id", b.id);
      sent.push(`review_72h:${b.id}`);
    }

    // ── GOOGLE REVIEW ROUTING (T+48h after 4-5★) ────────────
    // Be kunder som gett högt betyg att lämna Google-omdöme
    const { data: googleCandidates } = await sb.from("reviews")
      .select("*, bookings(id, customer_email, customer_name, reminders_sent)")
      .gte("rating", 4).not("google_review_requested", "is", true);

    for (const r of googleCandidates || []) {
      const reviewAge = (now.getTime() - new Date(r.created_at).getTime()) / 3_600_000;
      if (reviewAge < 48 || reviewAge > 96) continue;

      const booking = (r as any).bookings;
      if (!booking) continue;
      const email = booking.customer_email;
      if (!email) continue;
      const fname = (booking.customer_name || "").split(" ")[0] || "Hej";

      await mail(email,
        `En sista sak — hjälp oss på Google? 🙏`,
        wrap(`<h2>Tack för ditt fantastiska betyg, ${fname}! 🌟</h2>
<p>Om du har 30 sekunder till — ditt omdöme på Google hjälper andra hitta oss och ger oss kraft att fortsätta.</p>
<a href="https://search.google.com/local/writereview?placeid=ChIJYTN9T-53X0YREIXJlI2CvTM" class="btn">⭐ Lämna Google-omdöme →</a>
<p style="font-size:12px;color:#9B9B95;margin-top:16px">Bara om du vill — vi uppskattar det oavsett! 💚</p>`));

      await sb.from("reviews").update({ google_review_requested: true }).eq("id", r.id);
      sent.push(`google_review:${r.id}`);
    }

    // ── REBOOK CAMPAIGN (T+7d) ───────────────────────────────
    // Påminn kunder att boka igen 7 dagar efter slutförd städning
    const { data: rebookCandidates } = await sb.from("bookings")
      .select("*").eq("status","klar").not("reminders_sent","cs","{rebook_7d}");

    for (const b of rebookCandidates || []) {
      const comp = b.completed_at ? new Date(b.completed_at) : null;
      if (!comp) continue;
      const daysAgo = (now.getTime() - comp.getTime()) / 86_400_000;
      if (daysAgo < 7 || daysAgo > 10) continue;

      const fname = (b.customer_name || "").split(" ")[0] || "Hej";
      const cleanerName = b.cleaner_name || "din städare";
      const prevSent = (b.reminders_sent || []) as string[];

      await mail(b.customer_email,
        `🗓 Dags att boka igen? ${cleanerName} har lediga tider`,
        wrap(`<h2>Boka ${cleanerName} igen! 🧹</h2>
<p>Hej ${fname}! Det har gått en vecka sedan din senaste ${b.service_type ||"städning"}. Vill du boka samma städare igen?</p>
<div class="card">
  <div class="row"><span class="lbl">Senaste tjänst</span><span class="val">${b.service_type || "Hemstädning"} · ${b.booking_hours || 3}h</span></div>
  <div class="row"><span class="lbl">Städare</span><span class="val">${cleanerName}</span></div>
  <div class="row"><span class="lbl">Ditt betyg</span><span class="val">Tack! ⭐</span></div>
</div>
<p>Regelbunden städning = alltid rent hemma. Boka samma tid varje vecka eller varannan vecka!</p>
<a href="https://spick.se/stadare.html" class="btn">Boka igen →</a>`));

      await sb.from("bookings").update({ reminders_sent: [...prevSent, "rebook_7d"] }).eq("id", b.id);
      sent.push(`rebook_7d:${b.id}`);
    }

    // ── WIN-BACK (T+14d) ─────────────────────────────────────
    // Erbjud rabatt till kunder som inte bokat igen
    const { data: winbackCandidates } = await sb.from("bookings")
      .select("*").eq("status","klar").not("reminders_sent","cs","{winback_14d}");

    for (const b of winbackCandidates || []) {
      const comp = b.completed_at ? new Date(b.completed_at) : null;
      if (!comp) continue;
      const daysAgo = (now.getTime() - comp.getTime()) / 86_400_000;
      if (daysAgo < 14 || daysAgo > 17) continue;

      // Kolla om kund redan bokat nytt
      const { data: newBookings } = await sb.from("bookings")
        .select("id").eq("customer_email", b.customer_email)
        .gt("created_at", comp.toISOString()).limit(1);
      if (newBookings && newBookings.length > 0) continue; // Redan rebookat

      const fname = (b.customer_name || "").split(" ")[0] || "Hej";
      const prevSent = (b.reminders_sent || []) as string[];

      await mail(b.customer_email,
        `💚 10% rabatt — vi saknar dig!`,
        wrap(`<h2>Vi saknar dig, ${fname}! 💚</h2>
<p>Det har gått 2 veckor sedan din senaste städning. Vi vill gärna se dig igen!</p>
<div class="card" style="background:#ECFDF5;border:1px solid #6EE7B7">
  <h3 style="margin:0;color:#065F46;font-size:16px">🎟️ 10% rabatt på nästa bokning</h3>
  <p style="margin:6px 0 0;font-size:22px;font-weight:800;color:#0F6E56">Kod: KOMTILLBAKA</p>
</div>
<p style="font-size:13px;color:#9B9B95">Gäller 7 dagar. Kan inte kombineras med andra erbjudanden.</p>
<a href="https://spick.se/stadare.html" class="btn">Boka med rabatt →</a>`));

      await sb.from("bookings").update({ reminders_sent: [...prevSent, "winback_14d"] }).eq("id", b.id);
      sent.push(`winback_14d:${b.id}`);
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
    await sb.rpc("cleanup_rate_limits").catch((e) => { console.warn("auto-remind: suppressed error", e); });

  } catch(e) {
    console.error("auto-remind fel:", e);
    return new Response(JSON.stringify({error:(e as Error).message}), {status:500,headers:{"Content-Type":"application/json"}});
  }

  console.log("auto-remind klar:", sent);
  return new Response(JSON.stringify({ok:true,sent,ts:now.toISOString()}), {
    headers:{"Content-Type":"application/json"}
  });
});

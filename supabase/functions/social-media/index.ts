/**
 * social-media – AI-genererade inlägg till Facebook via Buffer API
 * Kör varje måndag kl 09:00 via GitHub Actions cron.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;
const BUFFER_ACCESS_TOKEN  = Deno.env.get("BUFFER_ACCESS_TOKEN")!;
const BUFFER_PROFILE_ID    = Deno.env.get("BUFFER_PROFILE_ID")!;   // Facebook Page profile ID i Buffer
const SUPABASE_URL         = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Hämta veckans statistik ───────────────────────────────────────────────
async function getWeeklyStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: bookings } = await sb.from("bookings").select("id,service,city,total_price,rut").gte("created_at", weekAgo);
  const { data: cleaners } = await sb.from("cleaners").select("id,avg_rating").eq("is_approved", true);
  const { data: reviews }  = await sb.from("reviews").select("rating,comment").gte("created_at", weekAgo).gte("rating", 4).limit(2);

  return {
    bookingsCount: bookings?.length || 0,
    cities:        [...new Set(bookings?.map(b => b.city).filter(Boolean))].slice(0, 3),
    cleanersCount: cleaners?.length || 0,
    avgRating:     cleaners?.length ? (cleaners.reduce((s,c) => s + (c.avg_rating||5), 0) / cleaners.length).toFixed(1) : "5.0",
    topReview:     reviews?.[0]?.comment || "",
    rutPercent:    bookings?.length ? Math.round((bookings.filter(b=>b.rut).length / bookings.length)*100) : 70,
  };
}

// ── Generera inlägg med Claude ────────────────────────────────────────────
async function generatePost(stats: Awaited<ReturnType<typeof getWeeklyStats>>): Promise<string> {
  const month  = new Date().toLocaleString("sv-SE", { month: "long" });
  const season = ["vinter","vinter","vår","vår","vår","sommar","sommar","sommar","höst","höst","höst","vinter"][new Date().getMonth()];

  const prompt = `Du är social media-ansvarig för Spick, ett städföretag i Sverige.
Skriv ett Facebook-inlägg på svenska baserat på denna veckas statistik.

FAKTA:
- ${stats.bookingsCount} bokningar denna vecka
- ${stats.cleanersCount} aktiva BankID-verifierade städare, snittbetyg ${stats.avgRating}/5
- Städer: ${stats.cities.join(", ") || "Stockholm, Göteborg"}
- ${stats.rutPercent}% av kunderna använder RUT-avdrag (betalar bara 175 kr/h)
${stats.topReview ? `- Kundrecension denna vecka: "${stats.topReview}"` : ""}
- Säsong: ${season}, månad: ${month}

REGLER:
- 80-150 ord
- Nämn RUT-avdraget och priset (från 175 kr/h)
- Nämn BankID-verifiering
- Avsluta alltid med: Boka på spick.se 🌿
- Inkludera 3-5 relevanta hashtags
- Varm och professionell ton
- SKRIV BARA INLÄGGET, inget annat`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "";
}

// ── Posta via Buffer API ──────────────────────────────────────────────────
async function postToBuffer(text: string): Promise<{ id: string } | null> {
  const res = await fetch("https://api.bufferapp.com/1/updates/create.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token:  BUFFER_ACCESS_TOKEN,
      "profile_ids[]": BUFFER_PROFILE_ID,
      text,
      now: "true",  // Posta direkt, inte schemalägg
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Buffer error:", err);
    return null;
  }

  const data = await res.json();
  return { id: data.updates?.[0]?.id || "posted" };
}

// ── Huvud-handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body    = await req.json().catch(() => ({}));
    const preview = body.preview === true;

    const stats  = await getWeeklyStats();
    const fbPost = await generatePost(stats);

    let postId: string | null = null;

    if (!preview) {
      const result = await postToBuffer(fbPost);
      postId = result?.id || null;

      // Logga i Supabase
      await sb.from("social_posts").insert({
        fb_post_id:     postId,
        fb_content:     fbPost,
        stats_snapshot: stats,
        posted_at:      new Date().toISOString(),
      }).catch(() => {});

      // Notifiera admin
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Spick <hello@spick.se>",
          to:   "hello@spick.se",
          subject: "📱 Veckans Facebook-inlägg postat!",
          html: `<div style="font-family:Arial;padding:24px">
            <h2>Veckoinlägg postat automatiskt ✅</h2>
            <h3>Facebook:</h3>
            <pre style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap">${fbPost}</pre>
            <p>Buffer post ID: ${postId}</p>
            <p>Statistik: ${stats.bookingsCount} bokningar, ${stats.cleanersCount} städare, snittbetyg ${stats.avgRating}</p>
          </div>`,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, preview, fb_post: fbPost, post_id: postId, stats }), {
      headers: { "Content-Type": "application/json", ...CORS },
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});

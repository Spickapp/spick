/**
 * social-media – AI-genererade inlägg till Instagram + Facebook
 * 
 * Körs varje måndag kl 09:00 via GitHub Actions cron.
 * Använder Claude API för att generera inlägg baserat på:
 * - Antal bokningar senaste veckan
 * - Städare-statistik
 * - Säsong/högtider
 * Postar via Meta Graph API.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY  = Deno.env.get("ANTHROPIC_API_KEY")!;
const META_ACCESS_TOKEN  = Deno.env.get("META_ACCESS_TOKEN")!;
const META_PAGE_ID       = Deno.env.get("META_PAGE_ID")!;
const META_IG_ACCOUNT_ID = Deno.env.get("META_IG_ACCOUNT_ID")!;
const SUPABASE_URL       = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY     = Deno.env.get("RESEND_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Hämta statistik från Supabase ─────────────────────────────────────────
async function getWeeklyStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: bookings } = await sb.from("bookings")
    .select("id, service, city, total_price, rut")
    .gte("created_at", weekAgo);

  const { data: cleaners } = await sb.from("cleaners")
    .select("id, avg_rating")
    .eq("is_approved", true);

  const { data: reviews } = await sb.from("reviews")
    .select("rating, comment")
    .gte("created_at", weekAgo)
    .gte("rating", 4)
    .limit(3);

  return {
    bookingsCount: bookings?.length || 0,
    revenue:       bookings?.reduce((s, b) => s + (b.total_price || 0), 0) || 0,
    cities:        [...new Set(bookings?.map(b => b.city).filter(Boolean))].slice(0, 3),
    cleanersCount: cleaners?.length || 0,
    avgRating:     cleaners?.length ? (cleaners.reduce((s, c) => s + (c.avg_rating || 5), 0) / cleaners.length).toFixed(1) : "5.0",
    topReviews:    reviews?.map(r => r.comment).filter(Boolean).slice(0, 2) || [],
    rutPercent:    bookings?.length ? Math.round((bookings.filter(b => b.rut).length / bookings.length) * 100) : 70,
  };
}

// ── Generera inlägg med Claude ────────────────────────────────────────────
async function generatePost(stats: ReturnType<typeof getWeeklyStats> extends Promise<infer T> ? T : never, postType: "instagram" | "facebook"): Promise<string> {
  const month = new Date().toLocaleString("sv-SE", { month: "long" });
  const season = (() => {
    const m = new Date().getMonth();
    if (m >= 2 && m <= 4) return "vår";
    if (m >= 5 && m <= 7) return "sommar";
    if (m >= 8 && m <= 10) return "höst";
    return "vinter";
  })();

  const prompt = postType === "instagram"
    ? `Du är social media-ansvarig för Spick, ett städföretag i Sverige. Skriv ett Instagram-inlägg på svenska.

FAKTA DENNA VECKA:
- ${stats.bookingsCount} bokningar gjorda
- ${stats.cleanersCount} aktiva städare, snittbetyg ${stats.avgRating}/5
- Städer: ${stats.cities.join(", ") || "Stockholm"}
- ${stats.rutPercent}% använder RUT-avdrag (betalar 175 kr/h)
${stats.topReviews.length ? `- Kundrecension: "${stats.topReviews[0]}"` : ""}
- Säsong: ${season}, månad: ${month}

REGLER:
- Max 150 ord
- Börja med en emoji och en catchy rubrik
- Inkludera 1-2 konkreta fördelar (RUT-avdrag, BankID-verifierade städare, gratis avbokning)
- Avsluta med en call-to-action: "Boka på spick.se 👉"
- Lägg till 5-8 relevanta hashtags på slutet
- Ton: varm, professionell, lite humoristisk
- SKRIV BARA INLÄGGET, ingen förklaring`
    : `Du är social media-ansvarig för Spick, ett städföretag i Sverige. Skriv ett Facebook-inlägg på svenska.

FAKTA DENNA VECKA:
- ${stats.bookingsCount} bokningar gjorda
- ${stats.cleanersCount} aktiva städare, snittbetyg ${stats.avgRating}/5
- Städer: ${stats.cities.join(", ") || "Stockholm"}
- ${stats.rutPercent}% använder RUT-avdrag (betalar bara 175 kr/h)
${stats.topReviews.length ? `- Kundrecension: "${stats.topReviews[0]}"` : ""}
- Säsong: ${season}, månad: ${month}

REGLER:
- 100-200 ord
- Mer informativ ton än Instagram
- Förklara RUT-avdraget tydligt (50% rabatt via Skatteverket)
- Nämn att städarna är BankID-verifierade
- Inkludera pris (från 175 kr/h med RUT)
- Avsluta med länk: spick.se
- SKRIV BARA INLÄGGET, ingen förklaring`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-opus-4-5",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ── Posta till Facebook Page ──────────────────────────────────────────────
async function postToFacebook(message: string): Promise<string | null> {
  const res = await fetch(`https://graph.facebook.com/v18.0/${META_PAGE_ID}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: META_ACCESS_TOKEN }),
  });
  const data = await res.json();
  return data.id || null;
}

// ── Posta till Instagram (text-only via container) ────────────────────────
async function postToInstagram(caption: string): Promise<string | null> {
  // Instagram kräver en bild – använd Spick-logotypen som standardbild
  const imageUrl = "https://spick.se/assets/og-image.jpg";

  // Steg 1: Skapa container
  const containerRes = await fetch(
    `https://graph.facebook.com/v18.0/${META_IG_ACCOUNT_ID}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: META_ACCESS_TOKEN }),
    }
  );
  const container = await containerRes.json();
  if (!container.id) return null;

  // Steg 2: Publicera container
  const publishRes = await fetch(
    `https://graph.facebook.com/v18.0/${META_IG_ACCOUNT_ID}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: container.id, access_token: META_ACCESS_TOKEN }),
    }
  );
  const publish = await publishRes.json();
  return publish.id || null;
}

// ── Huvud-handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const preview = body.preview === true; // preview=true → generera men posta inte

    const stats = await getWeeklyStats();

    // Generera båda inläggen parallellt
    const [igPost, fbPost] = await Promise.all([
      generatePost(stats, "instagram"),
      generatePost(stats, "facebook"),
    ]);

    let igId: string | null = null;
    let fbId: string | null = null;

    if (!preview) {
      // Posta på riktigt
      [igId, fbId] = await Promise.all([
        postToInstagram(igPost),
        postToFacebook(fbPost),
      ]);

      // Logga i Supabase
      await sb.from("social_posts").insert({
        ig_post_id:   igId,
        fb_post_id:   fbId,
        ig_content:   igPost,
        fb_content:   fbPost,
        stats_snapshot: stats,
        posted_at:    new Date().toISOString(),
      }).catch(() => {});

      // Notifiera admin
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Spick <hello@spick.se>",
          to: "hello@spick.se",
          subject: "📱 Veckans sociala medier-inlägg postat!",
          html: `<div style="font-family:Arial;padding:24px">
            <h2>Veckoinlägg postat automatiskt ✅</h2>
            <h3>Instagram:</h3><pre style="background:#f5f5f5;padding:16px;border-radius:8px">${igPost}</pre>
            <h3>Facebook:</h3><pre style="background:#f5f5f5;padding:16px;border-radius:8px">${fbPost}</pre>
            <p>Statistik: ${stats.bookingsCount} bokningar, ${stats.cleanersCount} städare, snittbetyg ${stats.avgRating}</p>
          </div>`,
        }),
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      preview,
      ig_post: igPost,
      fb_post: fbPost,
      ig_id: igId,
      fb_id: fbId,
      stats,
    }), { headers: { "Content-Type": "application/json", ...CORS } });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});

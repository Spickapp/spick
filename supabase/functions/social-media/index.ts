/**
 * social-media – AI-genererade inlägg till Facebook via Buffer MCP
 * Kör varje måndag kl 09:00 via GitHub Actions cron.
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;
const BUFFER_ACCESS_TOKEN  = Deno.env.get("BUFFER_ACCESS_TOKEN")!;
// Känd Buffer kanal-ID för Spick.se (hämtad 2026-03-26)
const BUFFER_CHANNEL_ID    = Deno.env.get("BUFFER_CHANNEL_ID") || "69c417e0af47dacb69542274";
const SUPABASE_URL         = "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "https://spick.se",
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
    cities:        [...new Set(bookings?.map((b: Record<string, unknown>) => b.city).filter(Boolean))].slice(0, 3),
    cleanersCount: cleaners?.length || 0,
    avgRating:     cleaners?.length ? (cleaners.reduce((s: number, c: Record<string, unknown>) => s + ((c.avg_rating as number)||5), 0) / cleaners.length).toFixed(1) : "5.0",
    topReview:     (reviews?.[0] as Record<string, unknown>)?.comment || "",
    rutPercent:    bookings?.length ? Math.round((bookings.filter((b: Record<string, unknown>) => b.rut).length / bookings.length)*100) : 70,
  };
}

// ── Claude + Buffer MCP: generera inlägg OCH posta ───────────────────────
async function generateAndPost(stats: Awaited<ReturnType<typeof getWeeklyStats>>, preview: boolean): Promise<{
  post: string;
  postId: string | null;
  channelId: string | null;
}> {
  const month  = new Date().toLocaleString("sv-SE", { month: "long" });
  const season = ["vinter","vinter","vår","vår","vår","sommar","sommar","sommar","höst","höst","höst","vinter"][new Date().getMonth()];

  const systemPrompt = preview
    ? "Du är social media-ansvarig för Spick. Generera ett Facebook-inlägg men posta det INTE. Returnera bara texten."
    : "Du är social media-ansvarig för Spick. Generera ett Facebook-inlägg och posta det direkt via Buffer-verktyget. Välj Facebook-kanalen.";

  const userPrompt = `Skriv ett Facebook-inlägg på svenska för Spick (städföretag).

VECKANS STATISTIK:
- ${stats.bookingsCount} bokningar
- ${stats.cleanersCount} BankID-verifierade städare, snittbetyg ${stats.avgRating}/5
- Städer: ${stats.cities.join(", ") || "Stockholm, Göteborg"}
- ${stats.rutPercent}% använder RUT-avdrag (175 kr/h)
${stats.topReview ? `- Kundrecension: "${stats.topReview}"` : ""}
- Säsong: ${season}, ${month}

KRAV:
- 80-150 ord, varm & professionell ton
- Nämn RUT-avdrag och priset (från 175 kr/h)
- Nämn BankID-verifiering
- Avsluta med: Boka på spick.se 🌿
- 3-5 hashtags
${preview ? "- Returnera bara inlägget som text" : "- Posta inlägget direkt via Buffer till Facebook-sidan"}`;

  const requestBody: Record<string, unknown> = {
    model: "claude-opus-4-5",
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  };

  // Lägg till Buffer MCP om vi faktiskt ska posta
  if (!preview) {
    requestBody.mcp_servers = [{
      type: "url",
      url: "https://mcp.buffer.com/mcp",
      name: "buffer",
      authorization_token: BUFFER_ACCESS_TOKEN,
    }];
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "mcp-client-2025-04-04",
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const data = await res.json();

  // Extrahera text från svaret
  const textBlock = data.content?.find((b: Record<string, unknown>) => b.type === "text");
  const postText = textBlock?.text?.trim() || "";

  // Hitta tool-result med post ID om vi postade
  let postId: string | null = null;
  let channelId: string | null = null;

  if (!preview && data.content) {
    for (const block of data.content) {
      if (block.type === "mcp_tool_result") {
        try {
          const resultText = block.content?.[0]?.text || "";
          const parsed = JSON.parse(resultText);
          postId = parsed?.id || parsed?.data?.id || null;
          channelId = parsed?.channel_id || parsed?.data?.channel_id || null;
        } catch {
          // fortsätt
        }
      }
    }
  }

  return { post: postText, postId, channelId };
}

// ── Huvud-handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body    = await req.json().catch(() => ({}));
    const preview = body.preview === true;

    const stats = await getWeeklyStats();
    const { post, postId, channelId } = await generateAndPost(stats, preview);

    if (!preview && postId) {
      // Logga i Supabase
      await sb.from("social_posts").insert({
        fb_post_id:     postId,
        fb_content:     post,
        stats_snapshot: stats,
        posted_at:      new Date().toISOString(),
      }).catch(() => {});

      // Mail till admin
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Spick <hello@spick.se>",
          to:   "hello@spick.se",
          subject: "📱 Veckans Facebook-inlägg postat via Buffer!",
          html: `<div style="font-family:Arial;padding:24px">
            <h2>Veckoinlägg postat automatiskt ✅</h2>
            <pre style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap">${post}</pre>
            <p>Buffer Post ID: ${postId} | Kanal: ${channelId}</p>
            <p>Bokningar: ${stats.bookingsCount} | Städare: ${stats.cleanersCount} | Betyg: ${stats.avgRating}</p>
          </div>`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: true,
      preview,
      post,
      post_id: postId,
      channel_id: channelId,
      stats,
    }), { headers: { "Content-Type": "application/json", ...CORS } });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});

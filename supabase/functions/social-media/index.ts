/**
 * social-media v2 — Autonomous Content Engine
 * 
 * Features:
 * - 5 content pillars with rotation
 * - Multi-platform: Facebook + Instagram via Buffer
 * - Daily posting (not just weekly)
 * - Dynamic hooks based on performance data
 * - Seasonal/contextual awareness
 * - Feedback loop integration
 * 
 * Triggers: GitHub Actions cron (daily 07:00 UTC = 09:00 Swedish)
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY    = Deno.env.get("ANTHROPIC_API_KEY")!;
const BUFFER_ACCESS_TOKEN  = Deno.env.get("BUFFER_ACCESS_TOKEN")!;
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

// ── CONTENT PILLARS ──────────────────────────────────────────
const PILLARS = [
  { id: "tips", name: "Städtips & Lifehacks", emoji: "🏠", weight: 30 },
  { id: "transformation", name: "Transformationer & Resultat", emoji: "✨", weight: 25 },
  { id: "trust", name: "Trust & Transparens", emoji: "🤝", weight: 20 },
  { id: "rut", name: "RUT & Ekonomi", emoji: "💰", weight: 15 },
  { id: "bts", name: "Bakom Kulisserna", emoji: "👋", weight: 10 },
];

// Day-of-week → pillar mapping
const DAILY_PILLAR: Record<number, string> = {
  0: "bts",           // Söndag
  1: "tips",          // Måndag
  2: "transformation",// Tisdag
  3: "trust",         // Onsdag
  4: "rut",           // Torsdag
  5: "tips",          // Fredag
  6: "transformation",// Lördag
};

// ── HOOK LIBRARY ─────────────────────────────────────────────
const HOOKS: Record<string, string[]> = {
  tips: [
    "Visste du att du kan spara 20 minuter med det här tricket?",
    "3 saker din städare vill att du vet 🧹",
    "Sluta göra det här misstaget i badrummet 🚿",
    "Det enklaste sättet att hålla köket rent mellan städningarna",
    "5-minutersregeln som förändrade mitt hem",
  ],
  transformation: [
    "Samma lägenhet. 3 timmars skillnad ✨",
    "Svep för att se skillnaden →",
    "Före: kaos. Efter: lugn. Priset: 525 kr.",
    "Den här transformationen tog 3 timmar",
    "Från stökigt till skinande — timelapse 🎥",
  ],
  trust: [
    "Varför 92% av våra kunder bokar igen",
    "Så verifierar vi varje städare med BankID 🔒",
    "Äkta kundrecension, ingen betalade ord",
    "100+ bokningar. 4.9/5 i betyg. Så här gör vi det.",
    "Din trygghet är viktigare än allt annat",
  ],
  rut: [
    "Du betalar 175 kr/h istället för 350 kr/h — så funkar RUT",
    "Visste du att du kan dra av 50% på städkostnaden?",
    "Räkna ut ditt RUT-avdrag på 10 sekunder 🧮",
    "3h städning kostar bara 525 kr med RUT ✅",
    "RUT-avdrag 2026: Allt du behöver veta",
  ],
  bts: [
    "En dag som Spick-städare 🧹",
    "Möt Sara — vår toppstädare i Solna",
    "Varför vi startade Spick",
    "Så ser en vanlig vecka ut för våra städare",
    "83% behåller du. 0 kr att börja. Välj dina tider.",
  ],
};

// ── SEASONAL CONTEXT ─────────────────────────────────────────
function getSeasonalContext(): string {
  const month = new Date().getMonth();
  const contexts: Record<number, string> = {
    0: "Nytt år, rent hem! Nyårslöften om en renare vardag.",
    1: "Valentines — ge bort en städning. Presentkort på spick.se.",
    2: "Vårstädning! Dags att öppna fönstren och fräscha upp.",
    3: "Påskstädning — checklista för ett påskrent hem.",
    4: "Studenttider! Flyttstädning för alla som byter bostad.",
    5: "Sommar! Fixa semesterstädningen innan du åker.",
    6: "Semester — boka så du kommer hem till ett rent hus.",
    7: "Skolstart! Ny rutin, ny städvanor. Boka löpande.",
    8: "Höststädning — 5 saker att göra innan vintern.",
    9: "Höstmys! Rent hem = bättre mysfaktor.",
    10: "50% med RUT — bättre deal än Black Friday!",
    11: "Julstädning! Boka storstädning före julhelgen.",
  };
  return contexts[month] || "";
}

// ── DATA COLLECTION ──────────────────────────────────────────
async function getStats() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  
  const [bookingsRes, cleanersRes, reviewsRes, topPostRes] = await Promise.all([
    sb.from("bookings").select("id,service,city,total_price,rut").gte("created_at", weekAgo),
    sb.from("cleaners").select("id,avg_rating,full_name,city").eq("is_approved", true),
    sb.from("reviews").select("rating,customer_comment").gte("created_at", weekAgo).gte("rating", 4).limit(3),
    sb.from("social_posts").select("fb_content,pillar,engagement_rate").order("engagement_rate", { ascending: false }).limit(1),
  ]);

  const bookings = bookingsRes.data || [];
  const cleaners = cleanersRes.data || [];
  const reviews = reviewsRes.data || [];
  const topPost = topPostRes.data?.[0];

  return {
    bookingsCount: bookings.length,
    cities: [...new Set(bookings.map((b: any) => b.city).filter(Boolean))].slice(0, 3),
    cleanersCount: cleaners.length,
    avgRating: cleaners.length
      ? (cleaners.reduce((s: number, c: any) => s + (c.avg_rating || 5), 0) / cleaners.length).toFixed(1)
      : "4.9",
    topReview: reviews[0]?.customer_comment || "",
    topCleanerName: cleaners[0]?.full_name?.split(" ")[0] || "Sara",
    topCleanerCity: cleaners[0]?.city || "Stockholm",
    rutPercent: bookings.length
      ? Math.round((bookings.filter((b: any) => b.rut).length / bookings.length) * 100)
      : 70,
    topPerformingHook: topPost?.fb_content?.split("\n")[0] || "",
    season: getSeasonalContext(),
  };
}

// ── AI CONTENT GENERATION ────────────────────────────────────
async function generateContent(
  stats: Awaited<ReturnType<typeof getStats>>,
  pillar: typeof PILLARS[0],
  platform: "facebook" | "instagram",
  preview: boolean
) {
  const month = new Date().toLocaleString("sv-SE", { month: "long" });
  const dayName = new Date().toLocaleString("sv-SE", { weekday: "long" });
  const hooks = HOOKS[pillar.id] || HOOKS.tips;
  const randomHook = hooks[Math.floor(Math.random() * hooks.length)];

  const platformGuide = platform === "instagram"
    ? `FORMAT: Instagram caption (80-120 ord). 
       Inkludera line breaks för läsbarhet.
       5-8 hashtags i slutet (på egen rad).
       Emojis: 3-5, naturligt integrerade.`
    : `FORMAT: Facebook-inlägg (100-180 ord).
       Längre, mer berättande ton.
       Direktlänk till spick.se i texten.
       2-3 hashtags (inte fler på Facebook).`;

  const prompt = `Skriv ett ${platform}-inlägg på svenska för Spick (städmarknadsplats).

CONTENT PILLAR: ${pillar.emoji} ${pillar.name}
HOOK-INSPIRATION: "${randomHook}"
SÄSONG: ${stats.season || month}
DAG: ${dayName}

STATISTIK:
- ${stats.bookingsCount} bokningar denna vecka
- ${stats.cleanersCount} BankID-verifierade städare, snittbetyg ${stats.avgRating}/5
- Aktiva städer: ${stats.cities.join(", ") || "Stockholm, Göteborg, Malmö"}
- ${stats.rutPercent}% använder RUT-avdrag (175 kr/h)
${stats.topReview ? `- Senaste kundrecension: "${stats.topReview}"` : ""}
- Topstädare: ${stats.topCleanerName} i ${stats.topCleanerCity}

${platformGuide}

KRAV:
- Starta med en scroll-stoppande HOOK (första raden)
- Nämn RUT-avdrag och priset (från 175 kr/h)
- Avsluta med CTA: Boka på spick.se 🌿
- Var aldrig säljig eller desperat — var hjälpsam och varm
- Skriv som en människa, inte en marknadsföringsbot
${stats.topPerformingHook ? `- Förra veckans bästa hook var: "${stats.topPerformingHook}" — lär av den` : ""}

Returnera BARA inlägget som text, inga förklaringar.`;

  const requestBody: Record<string, unknown> = {
    model: "claude-sonnet-4-20250514",
    max_tokens: 800,
    system: "Du är social media-copywriter för Spick.se, en svensk städmarknadsplats. Du skriver engagerande, varma inlägg som aldrig känns AI-genererade. Ton: som en vän som verkligen brinner för rent hem.",
    messages: [{ role: "user", content: prompt }],
  };

  // Buffer MCP for actual posting
  if (!preview) {
    requestBody.mcp_servers = [{
      type: "url",
      url: "https://mcp.buffer.com/mcp",
      name: "buffer",
      authorization_token: BUFFER_ACCESS_TOKEN,
    }];
    // Add instruction to post via Buffer
    (requestBody.messages as any[])[0].content += `\n\nEFTER att du skrivit inlägget, posta det via Buffer till ${platform === "facebook" ? "Facebook" : "Instagram"}-kanalen.`;
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
  const textBlock = data.content?.find((b: any) => b.type === "text");
  const postText = textBlock?.text?.trim() || "";

  let postId: string | null = null;
  if (!preview && data.content) {
    for (const block of data.content) {
      if (block.type === "mcp_tool_result") {
        try {
          const parsed = JSON.parse(block.content?.[0]?.text || "");
          postId = parsed?.id || parsed?.data?.id || null;
        } catch { /* continue */ }
      }
    }
  }

  return { post: postText, postId, platform, pillar: pillar.id };
}

// ── MAIN HANDLER ─────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const body = await req.json().catch(() => ({}));
    const preview = body.preview === true;
    const forcePillar = body.pillar as string | undefined;
    const forcePlatform = body.platform as "facebook" | "instagram" | undefined;

    // Select today's pillar
    const dayOfWeek = new Date().getDay();
    const pillarId = forcePillar || DAILY_PILLAR[dayOfWeek] || "tips";
    const pillar = PILLARS.find(p => p.id === pillarId) || PILLARS[0];

    // Select platform (alternate: odd days = FB, even days = IG)
    const platform = forcePlatform || (dayOfWeek % 2 === 0 ? "instagram" : "facebook");

    // Get stats
    const stats = await getStats();

    // Generate + post
    const result = await generateContent(stats, pillar, platform, preview);

    // Log to database
    if (!preview && result.post) {
      await sb.from("social_posts").insert({
        fb_post_id: result.postId,
        fb_content: result.post,
        pillar: result.pillar,
        platform: result.platform,
        stats_snapshot: stats,
        posted_at: new Date().toISOString(),
      }).catch(() => {});
    }

    // Admin notification
    if (!preview && result.postId) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Spick <hello@spick.se>",
          to: "hello@spick.se",
          subject: `📱 ${pillar.emoji} ${platform} — Nytt inlägg postat!`,
          html: `<div style="font-family:Arial;padding:24px;max-width:600px">
            <h2>Dagens inlägg postat ✅</h2>
            <p><strong>Pillar:</strong> ${pillar.emoji} ${pillar.name}</p>
            <p><strong>Plattform:</strong> ${platform}</p>
            <pre style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap;font-size:14px">${result.post}</pre>
            <p style="color:#888;font-size:12px">Buffer Post ID: ${result.postId} | Bokningar: ${stats.bookingsCount} | Städare: ${stats.cleanersCount}</p>
          </div>`,
        }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: true,
      preview,
      pillar: pillar.id,
      platform,
      post: result.post,
      post_id: result.postId,
      stats,
    }), { headers: { "Content-Type": "application/json", ...CORS } });

  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json", ...CORS },
    });
  }
});

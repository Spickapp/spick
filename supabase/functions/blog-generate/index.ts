// ═══════════════════════════════════════════════════════════════
// SPICK – blog-generate (Sprint 6 Content-Engine, 2026-04-26)
// ═══════════════════════════════════════════════════════════════
//
// Genererar svensk SEO-blogg-post via Anthropic Claude API.
// Anropas av:
//   - blog-auto-publish-cron (tis+tor 09:00) — 2 ggr/vecka
//   - admin-UI (manuell trigger för testning)
//
// Input: { topic: string, target_keyword: string, city?: string }
// Output: { title, slug, html_content, meta_description, og_image_prompt }
//
// MODELL: claude-haiku-4-5 (kostnad-effektiv för content-generation,
// 200K context, $1/$5 per 1M tokens — skip Opus/Sonnet för rena content-jobb).
//
// REGLER (#26-#31):
// - #28 SSOT: prompt-template centraliserad i denna fil
// - #30 INGA regulator-claims: prompten instruerar modell att hänvisa
//   till skatteverket.se vid RUT/skatte-frågor (ingen egen tolkning)
// - #31 ANTHROPIC_API_KEY redan i Supabase secrets (verifierat
//   i .github/workflows/content-engine.yml — samma secret)
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders, log } from "../_shared/email.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

// Slug-genererare: lower-case, ASCII-fy svenska tecken, ersätt non-alphanumerics med "-"
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/é/g, "e")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// System-prompt: instruerar modellen om Spick-kontext + regulator-skydd
const SYSTEM_PROMPT = `Du är en svensk SEO-skribent för Spick, Sveriges städplattform.

OM SPICK:
- Plattform där kunder bokar betygsatta städare direkt (Uber-modellen)
- Städare sätter egna priser (250–600 kr/h)
- RUT-avdrag 50% för privatpersoner
- Aktiv i Stockholm, Göteborg, Malmö och 17+ andra städer
- Boka på spick.se/boka

INSTRUKTIONER:
- Skriv 800–1200 ord på svenska
- SEO-struktur: H2/H3-rubriker, intro-stycke, bullet-listor där lämpligt, slutsats med CTA
- CTA i slutet ska länka till https://spick.se/boka.html med ankartext "Boka städning" eller liknande
- Ton: hjälpsam, professionell, lättläst — undvik AI-floskler
- Naturligt SEO: använd target-keyword 3–5 ggr inkl. en gång i title + intro
- Lokal touch om city anges (nämn staden 2–3 ggr i kontext)

VIKTIGT — REGULATOR-SKYDD:
- ALDRIG specifika juridiska tolkningar om RUT-avdrag, skatt, GDPR, BokfL eller liknande
- Vid RUT/skatte-relaterat innehåll: ge GENERISK info ("RUT-avdrag är en skattereduktion på 50%") och
  hänvisa läsaren till skatteverket.se för aktuella regler och belopp
- Inga påståenden om "garanterad" RUT-godkänning, max-belopp, eller skatte-effekter
- Ingen juridisk rådgivning — håll dig till praktiska städtips och bokningstips

OUTPUT-FORMAT (strikt JSON, inga markdown-fences):
{
  "title": "SEO-titel max 60 tecken",
  "slug": "kebab-case-utan-svenska-tecken",
  "html_content": "<p>Intro...</p><h2>...</h2>...<p>Slutsats med <a href='https://spick.se/boka.html'>CTA</a></p>",
  "meta_description": "Meta-description max 155 tecken som lockar klick",
  "og_image_prompt": "Beskrivning för OG-bild-generation (engelska, för bildmodell)"
}

Returnera ENBART JSON-objektet, inget annat.`;

interface BlogInput {
  topic: string;
  target_keyword: string;
  city?: string;
}

interface BlogOutput {
  title: string;
  slug: string;
  html_content: string;
  meta_description: string;
  og_image_prompt: string;
}

serve(async (req) => {
  const CORS = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (!ANTHROPIC_KEY) {
    log("error", "blog-generate", "ANTHROPIC_API_KEY saknas");
    return new Response(JSON.stringify({ error: "anthropic_key_missing" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json() as BlogInput;
    const { topic, target_keyword, city } = body;

    if (!topic || !target_keyword) {
      return new Response(JSON.stringify({ error: "topic_and_target_keyword_required" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const userPrompt = city
      ? `Skapa en blogg-post om: "${topic}"\nTarget keyword: "${target_keyword}"\nLokal touch: ${city}`
      : `Skapa en blogg-post om: "${topic}"\nTarget keyword: "${target_keyword}"`;

    log("info", "blog-generate", "Anropar Anthropic API", { topic, target_keyword, city });

    const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => `HTTP ${apiRes.status}`);
      log("error", "blog-generate", "Anthropic API-fel", { status: apiRes.status, body: errText });
      return new Response(JSON.stringify({ error: `anthropic_api_error_${apiRes.status}`, detail: errText }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const apiData = await apiRes.json();
    const rawText = apiData.content?.[0]?.text || "";

    // Parse JSON-output (modell kan ibland wrappa i markdown trots instruktion)
    let parsed: BlogOutput;
    try {
      // Strip ev. markdown-fences
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      log("error", "blog-generate", "JSON-parse-fel", { raw: rawText.slice(0, 500), error: (e as Error).message });
      return new Response(JSON.stringify({ error: "json_parse_failed", raw_preview: rawText.slice(0, 500) }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Validera obligatoriska fält
    if (!parsed.title || !parsed.html_content || !parsed.meta_description) {
      return new Response(JSON.stringify({ error: "incomplete_output", parsed }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Garantera deterministisk slug (modellen kan svaja)
    if (!parsed.slug || !/^[a-z0-9-]+$/.test(parsed.slug)) {
      parsed.slug = slugify(parsed.title);
    }

    log("info", "blog-generate", "Genererad", {
      slug: parsed.slug,
      title_len: parsed.title.length,
      content_len: parsed.html_content.length,
    });

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    log("error", "blog-generate", "Fatal", { error: (e as Error).message });
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

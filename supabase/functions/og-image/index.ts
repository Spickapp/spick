// ═══════════════════════════════════════════════════════════════
// SPICK – og-image (Sprint B3, 2026-04-26)
//
// Dynamisk OG-image (1200x630) per cleaner/company. Visas i preview
// när någon delar profil-länk på Facebook, LinkedIn, Twitter,
// Slack, iMessage etc.
//
// IMPLEMENTATION:
//   Returnerar SVG istället för PNG. SVG är en valid image/svg+xml
//   för OG-spec, fungerar i alla moderna scrapers (FB Sharing Debugger,
//   Twitter Card Validator etc), och är trivialt att generera utan
//   externa libs (Sharp, satori, resvg) — viktigt för Edge runtime
//   där cold-start matters.
//
//   Bakgrund: dynamisk gradient från entitetens namn (samma nameToColor()-
//   logik som SPA, ger visuell konsistens). Avatar/logo kan ev. embeddas
//   i framtida iteration via base64 (skip för v1 — för komplext).
//
// FUTURE (deferred — för komplext för 45 min):
//   - Riktig PNG via satori + resvg-js (tunga deps)
//   - Embed cleaner.avatar_url som <image href> (CORS + base64-fetch)
//   - Custom font (Playfair Display) via base64-embed (~150KB)
//   Tills dess: SVG ger 90% av värdet med 10% av komplexiteten.
//
// Anrop:
//   GET /functions/v1/og-image?type=cleaner&id=UUID
//   GET /functions/v1/og-image?type=company&id=UUID
//
// Cache: 24h (max-age=86400). Profilnamn ändras nästan aldrig.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SITE_URL = "https://spick.se";

// XML/SVG-escape — nödvändigt för user-content (namn, city, services)
function escSvg(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// nameToColor: deterministisk hash → HSL (matchar js/components.js + stadare-profil.html)
// Undviker röd (0-30, 330-360) och gul (45-65) för professionell look.
function nameToColor(name: string): { main: string; light: string; pale: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  let h = Math.abs(hash) % 360;
  if (h < 30) h += 120;
  if (h > 330) h -= 120;
  if (h > 45 && h < 65) h += 80;
  return {
    main: `hsl(${h}, 55%, 32%)`,
    light: `hsl(${h}, 55%, 42%)`,
    pale: `hsl(${h}, 45%, 95%)`,
  };
}

interface RenderOpts {
  title: string;       // "Anna Andersson" eller "Solid Service AB"
  subtitle: string;    // "Städare i Stockholm" eller "Städföretag · 12 städare"
  rating: string | null; // "★ 4.8 (24 omdömen)" eller null
  badge: string | null;  // "ID-verifierad" eller "F-skatt"
  services: string[];  // tjänster från cleaner/company-data (visas som tag-text)
}

function svgImage(opts: RenderOpts): string {
  const palette = nameToColor(opts.title);
  // Texttrunc — undvik overflow (1200px wide)
  const titleText = opts.title.length > 32 ? opts.title.slice(0, 30) + "…" : opts.title;
  const subtitle = opts.subtitle.length > 56 ? opts.subtitle.slice(0, 54) + "…" : opts.subtitle;
  const servicesText = opts.services.slice(0, 4).join(" · ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.main}"/>
      <stop offset="100%" stop-color="${palette.light}"/>
    </linearGradient>
    <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="2" fill="rgba(255,255,255,0.06)"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#dots)"/>

  <!-- Spick-logo top-right -->
  <g transform="translate(1050,60)">
    <text x="0" y="0" font-family="Georgia, serif" font-size="36" font-weight="700" fill="#fff" text-anchor="end" opacity="0.95">Spick</text>
    <text x="0" y="22" font-family="-apple-system, sans-serif" font-size="14" fill="#fff" text-anchor="end" opacity="0.7">spick.se</text>
  </g>

  <!-- White content card -->
  <g transform="translate(80,140)">
    <rect width="1040" height="380" rx="24" fill="#ffffff" opacity="0.95"/>
    <text x="60" y="100" font-family="Georgia, serif" font-size="64" font-weight="700" fill="#1C1C1A">${escSvg(titleText)}</text>
    <text x="60" y="150" font-family="-apple-system, sans-serif" font-size="28" fill="#6B6960">${escSvg(subtitle)}</text>
    ${opts.rating ? `<text x="60" y="220" font-family="-apple-system, sans-serif" font-size="32" font-weight="600" fill="#D4A853">${escSvg(opts.rating)}</text>` : ""}
    ${opts.badge ? `<g transform="translate(60,250)"><rect width="220" height="44" rx="22" fill="${palette.pale}"/><text x="110" y="30" font-family="-apple-system, sans-serif" font-size="18" font-weight="600" fill="${palette.main}" text-anchor="middle">✓ ${escSvg(opts.badge)}</text></g>` : ""}
    ${servicesText ? `<text x="60" y="340" font-family="-apple-system, sans-serif" font-size="22" fill="#9B9B95">${escSvg(servicesText)}</text>` : ""}
  </g>

  <!-- Footer -->
  <text x="600" y="585" font-family="-apple-system, sans-serif" font-size="20" fill="#fff" text-anchor="middle" opacity="0.85">Boka städare direkt på spick.se · ID-verifierade · RUT-avdrag · Trygg betalning</text>
</svg>`;
}

async function renderCleanerImage(id: string): Promise<string | null> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: cleaners } = await sb
    .from("v_cleaners_public")
    .select("id,full_name,city,avg_rating,review_count,services,identity_verified,company_id,is_company_owner")
    .eq("id", id)
    .eq("is_approved", true)
    .limit(1);
  if (!cleaners || cleaners.length === 0) return null;

  const c = cleaners[0] as unknown as {
    full_name: string | null;
    city: string | null;
    avg_rating: number | null;
    review_count: number | null;
    services: string[] | null;
    identity_verified: boolean | null;
  };

  const city = c.city ? c.city.charAt(0).toUpperCase() + c.city.slice(1).toLowerCase() : "Stockholm";
  const hasRatings = c.avg_rating != null && (c.review_count || 0) > 0;
  const services = Array.isArray(c.services) ? c.services : [];

  return svgImage({
    title: c.full_name || "Städare",
    subtitle: `Städare i ${city}`,
    rating: hasRatings ? `★ ${(c.avg_rating || 0).toFixed(1)} (${c.review_count} omdömen)` : "Ny på Spick",
    badge: c.identity_verified ? "ID-verifierad" : null,
    services,
  });
}

async function renderCompanyImage(id: string): Promise<string | null> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: companies } = await sb
    .from("companies")
    .select("id,name,description")
    .eq("id", id)
    .limit(1);
  if (!companies || companies.length === 0) return null;

  const co = companies[0] as unknown as { name: string | null; description: string | null };

  // Hämta team-info för subtitle + rating-aggregat
  const { data: team } = await sb
    .from("v_cleaners_public")
    .select("avg_rating,review_count,services,city")
    .eq("company_id", id)
    .eq("is_approved", true);
  const teamArr = (team || []) as Array<{ avg_rating: number | null; review_count: number | null; services: string[] | null; city: string | null }>;

  const totalReviews = teamArr.reduce((s, t) => s + (t.review_count || 0), 0);
  const ratingSum = teamArr.reduce((s, t) => s + ((t.avg_rating || 0) * (t.review_count || 0)), 0);
  const avgRating = totalReviews > 0 ? ratingSum / totalReviews : 0;
  const cities = Array.from(new Set(teamArr.map((t) => t.city).filter((c): c is string => Boolean(c))));
  const primaryCity = cities[0] || "Stockholm";
  const allServices = Array.from(new Set(teamArr.flatMap((t) => Array.isArray(t.services) ? t.services : [])));

  const subtitle = teamArr.length > 1
    ? `Städföretag i ${primaryCity} · ${teamArr.length} städare`
    : `Städföretag i ${primaryCity}`;

  return svgImage({
    title: co.name || "Städföretag",
    subtitle,
    rating: totalReviews > 0 ? `★ ${avgRating.toFixed(1)} (${totalReviews} omdömen)` : null,
    badge: "F-skatt",
    services: allServices,
  });
}

serve(async (req) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id");

  // Fallback redirect till statisk default-image om query saknas eller vid fel
  function fallbackRedirect(): Response {
    return new Response(null, {
      status: 302,
      headers: { ...CORS, "Location": `${SITE_URL}/assets/og-image.png`, "Cache-Control": "public, max-age=300" },
    });
  }

  if (!type || !id || (type !== "cleaner" && type !== "company")) {
    return fallbackRedirect();
  }

  try {
    const svg = type === "cleaner" ? await renderCleanerImage(id) : await renderCompanyImage(id);
    if (!svg) return fallbackRedirect();

    return new Response(svg, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (e) {
    console.error("og-image error:", e);
    return fallbackRedirect();
  }
});

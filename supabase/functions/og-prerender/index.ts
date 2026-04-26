// ═══════════════════════════════════════════════════════════════
// SPICK – og-prerender (Sprint B1, 2026-04-26)
//
// SSR-HTML för crawlers (Googlebot, Facebook, Twitter, LinkedIn).
// /s/{slug} och /f/{slug} är SPA — utan pre-render ser bots bara
// "Laddar profil..." och indexerar inget. Denna EF returnerar full
// HTML med <title>, <meta description>, <meta og:*>, <h1>, reviews
// och länk tillbaka till SPA-versionen.
//
// Cloudflare/CDN-rewrite-strategi (framtida deploy): edge-worker
// detekterar User-Agent (bot eller utan JS) → proxy:ar till denna EF
// istället för att serva tom SPA-HTML. Tills dess kan EF:n användas
// av sitemap-ping eller andra index-services.
//
// Anrop:
//   GET /functions/v1/og-prerender?type=cleaner&slug=anna-andersson
//   GET /functions/v1/og-prerender?type=company&slug=solid-service
//
// Cache: 1h CDN (max-age=3600). Profilerna ändras sällan, och stale
// content är OK för crawlers (de re-crawlar regelbundet).
//
// SSOT: läser från v_cleaners_public + companies + reviews. Samma
// vyer som SPA-rendering använder, så ingen drift mellan SSR och CSR.
// Schema.org JSON-LD inkluderas också (samma som B2 i HTML-sidan).
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SITE_URL = "https://spick.se";

// Sprint B1: HTML-escape mot XSS i SSR-output (crawlers ser vår HTML
// direkt, så user-controlled fields måste escapas).
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface CleanerPublic {
  id: string;
  slug: string | null;
  full_name: string | null;
  city: string | null;
  bio: string | null;
  hourly_rate: number | null;
  avg_rating: number | null;
  review_count: number | null;
  services: string[] | null;
  avatar_url: string | null;
  identity_verified: boolean | null;
  member_since: string | null;
  completed_jobs: number | null;
  company_id: string | null;
  is_company_owner: boolean | null;
}

interface CompanyRow {
  id: string;
  name: string | null;
  slug: string | null;
  description: string | null;
  logo_url: string | null;
  hero_bg_url: string | null;
  website_url: string | null;
}

interface ReviewRow {
  cleaner_rating: number | null;
  comment: string | null;
  created_at: string | null;
}

function htmlPage(opts: {
  title: string;
  description: string;
  ogImage: string;
  canonical: string;
  jsonLd: Record<string, unknown>;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="Spick">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:image" content="${esc(opts.ogImage)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<meta name="twitter:image" content="${esc(opts.ogImage)}">
<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:680px;margin:2rem auto;padding:0 1.25rem;color:#1C1C1A;line-height:1.6}
h1{font-family:Georgia,serif;font-size:1.8rem;margin:0 0 .5rem}
h2{font-family:Georgia,serif;font-size:1.2rem;margin:1.5rem 0 .5rem}
.meta{color:#6B6960;font-size:.95rem;margin-bottom:1rem}
.bio{margin:1rem 0}
.tags{display:flex;flex-wrap:wrap;gap:.5rem;margin:.75rem 0}
.tag{background:#E1F5EE;color:#0F6E56;font-size:.85rem;padding:.3rem .7rem;border-radius:99px}
.review{padding:1rem 0;border-bottom:1px solid #E8E8E4}
.review-stars{color:#D4A853}
.cta{display:inline-block;background:#0F6E56;color:#fff;padding:.75rem 1.5rem;border-radius:8px;text-decoration:none;font-weight:600;margin-top:1rem}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}

async function renderCleaner(slug: string): Promise<{ status: number; html: string }> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: cleaners, error } = await sb
    .from("v_cleaners_public")
    .select("id,slug,full_name,city,bio,hourly_rate,avg_rating,review_count,services,avatar_url,identity_verified,member_since,completed_jobs,company_id,is_company_owner")
    .or(`slug.eq.${slug},id.eq.${slug}`)
    .eq("is_approved", true)
    .limit(1);

  if (error || !cleaners || cleaners.length === 0) {
    return { status: 404, html: htmlPage({
      title: "Städare hittades inte | Spick",
      description: "Profilen är inte tillgänglig. Hitta andra städare på spick.se.",
      ogImage: `${SITE_URL}/assets/og-image.png`,
      canonical: `${SITE_URL}/stadare`,
      jsonLd: { "@context": "https://schema.org", "@type": "WebPage", "name": "Profil saknas" },
      body: `<h1>Profilen kunde inte hittas</h1><p>Sök efter andra städare på <a href="${SITE_URL}/stadare">spick.se/stadare</a>.</p>`,
    }) };
  }

  const c = cleaners[0] as unknown as CleanerPublic;

  // Reviews — exakt samma kolumner som SPA-versionen
  const { data: reviews } = await sb
    .from("reviews")
    .select("cleaner_rating,comment,created_at")
    .eq("cleaner_id", c.id)
    .order("created_at", { ascending: false })
    .limit(10);
  const reviewArr: ReviewRow[] = (reviews || []) as unknown as ReviewRow[];

  const city = c.city ? c.city.charAt(0).toUpperCase() + c.city.slice(1).toLowerCase() : "Stockholm";
  const rate = c.hourly_rate || 350;
  const rutPrice = Math.round(rate * 0.5);
  const services = Array.isArray(c.services) ? c.services : [];
  const servicesText = services.join(", ") || "Hemstädning";
  const bioPart = (c.bio && c.bio.trim().length > 10) ? c.bio.trim() : "";
  const hasRatings = c.avg_rating != null && (c.review_count || 0) > 0;

  const title = `${c.full_name || "Städare"} — Städning i ${city} | Spick`;
  const description = bioPart
    ? `${bioPart.slice(0, 120)}${bioPart.length > 120 ? "…" : ""} Boka för ${rutPrice} kr/h med RUT.`
    : `Boka ${c.full_name || "städare"} för ${servicesText.toLowerCase()} i ${city}. Från ${rutPrice} kr/h med RUT-avdrag.`;

  const canonical = `${SITE_URL}/s/${c.slug || c.id}`;
  const ogImage = c.avatar_url
    || `${SITE_URL}/functions/v1/og-image?type=cleaner&id=${encodeURIComponent(c.id)}`;

  // Schema.org JSON-LD (samma struktur som SPA — Sprint Prof-5)
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${canonical}#cleaner-${c.id}`,
    "name": `${c.full_name || "Städare"} — Städare via Spick`,
    "description": description,
    "url": canonical,
    "image": c.avatar_url || `${SITE_URL}/assets/og-image.png`,
    "priceRange": `${rate} kr/h (${rutPrice} kr/h med RUT)`,
    "address": { "@type": "PostalAddress", "addressLocality": city, "addressCountry": "SE" },
    "areaServed": { "@type": "City", "name": city },
    "parentOrganization": { "@type": "Organization", "name": "Spick", "url": SITE_URL },
  };
  if (hasRatings) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": (c.avg_rating || 0).toFixed(1),
      "reviewCount": c.review_count,
      "bestRating": "5",
      "worstRating": "1",
    };
  }
  if (reviewArr.length > 0) {
    jsonLd.review = reviewArr.slice(0, 3).map((r) => ({
      "@type": "Review",
      "reviewRating": { "@type": "Rating", "ratingValue": r.cleaner_rating, "bestRating": "5", "worstRating": "1" },
      "author": { "@type": "Person", "name": "Kund" },
      "reviewBody": r.comment || "",
      "datePublished": r.created_at ? r.created_at.split("T")[0] : undefined,
    }));
  }
  if (services.length > 0) {
    jsonLd.hasOfferCatalog = {
      "@type": "OfferCatalog",
      "name": "Städtjänster",
      "itemListElement": services.map((s) => ({
        "@type": "Offer",
        "itemOffered": { "@type": "Service", "name": s },
      })),
    };
  }

  // SSR-body
  const reviewsHtml = reviewArr.length === 0
    ? `<p>Inga omdömen ännu.</p>`
    : reviewArr.slice(0, 5).map((r) => {
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString("sv-SE") : "";
        const stars = r.cleaner_rating ? "★".repeat(Math.round(r.cleaner_rating)) + "☆".repeat(5 - Math.round(r.cleaner_rating)) : "";
        return `<div class="review"><div class="review-stars">${esc(stars)}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}<div class="meta">${esc(date)}</div></div>`;
      }).join("");

  const tagsHtml = services.map((s) => `<span class="tag">${esc(s)}</span>`).join("");

  const body = `
<h1>${esc(c.full_name || "Städare")}</h1>
<div class="meta">📍 ${esc(city)}${c.identity_verified ? " · ID-verifierad" : ""}${hasRatings ? ` · ★ ${(c.avg_rating || 0).toFixed(1)} (${c.review_count} omdömen)` : ""}</div>
${bioPart ? `<div class="bio">${esc(bioPart)}</div>` : ""}
<div class="tags">${tagsHtml}</div>
<p><strong>Pris:</strong> ${rate} kr/h (${rutPrice} kr/h med RUT-avdrag)</p>
<p><strong>Tjänster:</strong> ${esc(servicesText)}</p>
<a class="cta" href="${esc(canonical)}">Läs mer & boka →</a>
<h2>Recensioner</h2>
${reviewsHtml}
<h2>Om Spick</h2>
<p>Spick är Sveriges städplattform. Boka ID-verifierade städare direkt med säker betalning via Stripe och RUT-avdrag.</p>
<p><a href="${SITE_URL}">spick.se</a> · <a href="${SITE_URL}/stadare">Hitta fler städare</a></p>
`;

  return { status: 200, html: htmlPage({ title, description, ogImage, canonical, jsonLd, body }) };
}

async function renderCompany(slug: string): Promise<{ status: number; html: string }> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data: companies, error } = await sb
    .from("companies")
    .select("id,name,slug,description,logo_url,hero_bg_url,website_url")
    .or(`slug.eq.${slug},id.eq.${slug}`)
    .limit(1);

  if (error || !companies || companies.length === 0) {
    return { status: 404, html: htmlPage({
      title: "Företaget hittades inte | Spick",
      description: "Företagsprofilen är inte tillgänglig.",
      ogImage: `${SITE_URL}/assets/og-image.png`,
      canonical: `${SITE_URL}/foretag.html`,
      jsonLd: { "@context": "https://schema.org", "@type": "WebPage", "name": "Företag saknas" },
      body: `<h1>Företaget kunde inte hittas</h1><p>Bläddra bland städföretag på <a href="${SITE_URL}/foretag.html">spick.se/foretag</a>.</p>`,
    }) };
  }

  const co = companies[0] as unknown as CompanyRow;

  // Hämta team + aggregerade reviews via cleaner_id
  const { data: teamCleaners } = await sb
    .from("v_cleaners_public")
    .select("id,full_name,avg_rating,review_count,services,city,completed_jobs")
    .eq("company_id", co.id)
    .eq("is_approved", true);
  const team = (teamCleaners || []) as Array<{ id: string; full_name: string | null; avg_rating: number | null; review_count: number | null; services: string[] | null; city: string | null; completed_jobs: number | null }>;

  let reviews: ReviewRow[] = [];
  let totalReviewCount = 0;
  let avgRating = 0;
  if (team.length > 0) {
    const teamIds = team.map((t) => t.id);
    const { data: reviewData } = await sb
      .from("reviews")
      .select("cleaner_rating,comment,created_at")
      .in("cleaner_id", teamIds)
      .order("created_at", { ascending: false })
      .limit(20);
    reviews = (reviewData || []) as unknown as ReviewRow[];
    totalReviewCount = team.reduce((s, t) => s + (t.review_count || 0), 0);
    const ratingSum = team.reduce((s, t) => s + ((t.avg_rating || 0) * (t.review_count || 0)), 0);
    avgRating = totalReviewCount > 0 ? ratingSum / totalReviewCount : 0;
  }

  const cities = Array.from(new Set(team.map((t) => t.city).filter((c): c is string => Boolean(c))));
  const primaryCity = cities[0] || "Stockholm";
  const allServices = Array.from(new Set(team.flatMap((t) => Array.isArray(t.services) ? t.services : [])));
  const totalJobs = team.reduce((s, t) => s + (t.completed_jobs || 0), 0);

  const displayName = co.name || "Städföretag";
  const descPart = (co.description && co.description.trim().length > 10) ? co.description.trim() : "";
  const title = `${displayName} — Städföretag i ${primaryCity} | Spick`;
  const description = descPart
    ? `${descPart.slice(0, 120)}${descPart.length > 120 ? "…" : ""}`
    : `${displayName} erbjuder professionell städning i ${primaryCity}. ${team.length} städare i teamet, ${totalJobs} utförda jobb.`;

  const canonical = `${SITE_URL}/f/${co.slug || co.id}`;
  const ogImage = co.hero_bg_url || co.logo_url
    || `${SITE_URL}/functions/v1/og-image?type=company&id=${encodeURIComponent(co.id)}`;

  // Schema.org JSON-LD
  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${canonical}#company-${co.id}`,
    "name": displayName,
    "description": description,
    "url": canonical,
    "image": ogImage,
    "address": { "@type": "PostalAddress", "addressLocality": primaryCity, "addressCountry": "SE" },
    "priceRange": "$$",
    "parentOrganization": { "@type": "Organization", "name": "Spick", "url": SITE_URL },
  };
  if (cities.length > 1) {
    jsonLd.areaServed = cities.map((cty) => ({ "@type": "City", "name": cty }));
  } else {
    jsonLd.areaServed = { "@type": "City", "name": primaryCity };
  }
  if (totalReviewCount > 0 && avgRating > 0) {
    jsonLd.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": avgRating.toFixed(1),
      "reviewCount": totalReviewCount,
      "bestRating": "5",
      "worstRating": "1",
    };
  }
  if (reviews.length > 0) {
    jsonLd.review = reviews.slice(0, 3).map((r) => ({
      "@type": "Review",
      "reviewRating": { "@type": "Rating", "ratingValue": r.cleaner_rating, "bestRating": "5", "worstRating": "1" },
      "author": { "@type": "Person", "name": "Kund" },
      "reviewBody": r.comment || "",
      "datePublished": r.created_at ? r.created_at.split("T")[0] : undefined,
    }));
  }
  if (allServices.length > 0) {
    jsonLd.hasOfferCatalog = {
      "@type": "OfferCatalog",
      "name": "Städtjänster",
      "itemListElement": allServices.map((s) => ({
        "@type": "Offer",
        "itemOffered": { "@type": "Service", "name": s },
      })),
    };
  }

  const reviewsHtml = reviews.length === 0
    ? `<p>Inga omdömen ännu.</p>`
    : reviews.slice(0, 5).map((r) => {
        const date = r.created_at ? new Date(r.created_at).toLocaleDateString("sv-SE") : "";
        const stars = r.cleaner_rating ? "★".repeat(Math.round(r.cleaner_rating)) + "☆".repeat(5 - Math.round(r.cleaner_rating)) : "";
        return `<div class="review"><div class="review-stars">${esc(stars)}</div>${r.comment ? `<p>${esc(r.comment)}</p>` : ""}<div class="meta">${esc(date)}</div></div>`;
      }).join("");

  const teamHtml = team.length === 0 ? "" : `
<h2>Teamet (${team.length} städare)</h2>
<ul>
${team.slice(0, 10).map((t) => `<li>${esc(t.full_name || "Städare")}${t.avg_rating ? ` — ★ ${Number(t.avg_rating).toFixed(1)}` : ""}</li>`).join("")}
</ul>`;

  const tagsHtml = allServices.map((s) => `<span class="tag">${esc(s)}</span>`).join("");

  const body = `
<h1>${esc(displayName)}</h1>
<div class="meta">📍 ${esc(cities.join(", ") || primaryCity)}${totalReviewCount > 0 ? ` · ★ ${avgRating.toFixed(1)} (${totalReviewCount} omdömen)` : ""}${totalJobs > 0 ? ` · ${totalJobs} utförda städningar` : ""}</div>
${descPart ? `<div class="bio">${esc(descPart)}</div>` : ""}
<div class="tags">${tagsHtml}</div>
<a class="cta" href="${esc(canonical)}">Läs mer & boka →</a>
${teamHtml}
<h2>Recensioner</h2>
${reviewsHtml}
<h2>Om Spick</h2>
<p>Spick är Sveriges städplattform. ${esc(displayName)} är ett av flera verifierade städföretag på Spick — alla med F-skatt och ansvarsförsäkring.</p>
<p><a href="${SITE_URL}">spick.se</a> · <a href="${SITE_URL}/foretag.html">Hitta fler företag</a></p>
`;

  return { status: 200, html: htmlPage({ title, description, ogImage, canonical, jsonLd, body }) };
}

serve(async (req) => {
  // CORS — open för crawlers (de skickar inget Origin alls oftast)
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const slug = url.searchParams.get("slug");

  if (!type || !slug) {
    return new Response(JSON.stringify({ error: "type and slug required" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  if (type !== "cleaner" && type !== "company") {
    return new Response(JSON.stringify({ error: "type must be 'cleaner' or 'company'" }), {
      status: 400,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const result = type === "cleaner" ? await renderCleaner(slug) : await renderCompany(slug);
    return new Response(result.html, {
      status: result.status,
      headers: {
        ...CORS,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=3600",
        "X-Robots-Tag": "index, follow",
      },
    });
  } catch (e) {
    console.error("og-prerender error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

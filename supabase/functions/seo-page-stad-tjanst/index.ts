// ═══════════════════════════════════════════════════════════════
// SPICK – seo-page-stad-tjanst (Sprint 4A, 2026-04-26)
//
// SSR-HTML för stad+tjänst-aggregat-sidor (local SEO-explosion).
// Renderar t.ex. "Hemstädning i Stockholm" som SEO-optimerad
// landningssida med top-10 cleaners, JSON-LD LocalBusiness +
// FAQPage, breadcrumbs och CTA till boka.html med pre-fill.
//
// Kombinationer (initial): 5 städer × 5 tjänster = 25 sidor.
// Kan utökas linjärt utan kodändring (lägg städer i SUPPORTED_CITIES,
// tjänster i SUPPORTED_SERVICES).
//
// Anrop:
//   GET /functions/v1/seo-page-stad-tjanst?stad=stockholm&tjanst=hemstadning
//   GET /functions/v1/seo-page-stad-tjanst?stad=goteborg&tjanst=flyttstadning
//
// Cache: 6h CDN (max-age=21600). Cleaner-listan ändras sällan, och
// stale-content är OK för SEO-crawlers — de re-crawlar regelbundet.
//
// SSOT: läser från v_cleaners_for_booking (samma view som boka.html).
// Inga hardcoded priser — base_price/RUT-procent är affärsdata, inte
// regulator-claims (rule #30).
//
// SEO-strategi: 4D-länkning från index.html + tjanster.html +
// 4C sitemap-utökning säkerställer att Googlebot hittar dessa sidor.
// ═══════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "https://urjeijcncsyuletprydy.supabase.co";
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SITE_URL = "https://spick.se";

// Sprint 4A: HTML-escape mot XSS i SSR-output (samma pattern som og-prerender)
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Konfiguration: städer + tjänster ───
// Synkad med 4C sitemap-workflow + 4D länkar i index/tjanster.

interface CityConfig {
  slug: string;        // URL-segment ("stockholm")
  name: string;        // Visningsnamn ("Stockholm")
  geo: { lat: number; lng: number }; // För LocalBusiness JSON-LD
}

interface ServiceConfig {
  slug: string;        // URL-segment ("hemstadning")
  name: string;        // Visningsnamn ("Hemstädning") — exakt match mot DB
  intent: string;      // SEO-fras, t.ex. "hemstädning"
  description: string; // Kort beskrivning för meta + h1-context
  duration: string;    // T.ex. "2–4 timmar"
}

const SUPPORTED_CITIES: Record<string, CityConfig> = {
  stockholm: { slug: "stockholm", name: "Stockholm", geo: { lat: 59.3293, lng: 18.0686 } },
  goteborg:  { slug: "goteborg",  name: "Göteborg",  geo: { lat: 57.7089, lng: 11.9746 } },
  malmo:     { slug: "malmo",     name: "Malmö",     geo: { lat: 55.6050, lng: 13.0038 } },
  uppsala:   { slug: "uppsala",   name: "Uppsala",   geo: { lat: 59.8586, lng: 17.6389 } },
  linkoping: { slug: "linkoping", name: "Linköping", geo: { lat: 58.4108, lng: 15.6214 } },
};

const SUPPORTED_SERVICES: Record<string, ServiceConfig> = {
  hemstadning: {
    slug: "hemstadning",
    name: "Hemstädning",
    intent: "hemstädning",
    description: "Löpande hemstädning veckovis, varannan vecka eller månadsvis.",
    duration: "2–4 timmar",
  },
  storstadning: {
    slug: "storstadning",
    name: "Storstädning",
    intent: "storstädning",
    description: "Grundlig städning med insidan av kylskåp, ugn och köksskåp.",
    duration: "4–6 timmar",
  },
  flyttstadning: {
    slug: "flyttstadning",
    name: "Flyttstädning",
    intent: "flyttstädning",
    description: "Besiktningsgodkänd städning vid flytt — för att få tillbaka depositionen.",
    duration: "4–8 timmar",
  },
  fonsterputs: {
    slug: "fonsterputs",
    name: "Fönsterputs",
    intent: "fönsterputs",
    description: "Putsning av fönster invändigt och utvändigt.",
    duration: "10–15 min/fönster",
  },
  kontorsstadning: {
    slug: "kontorsstadning",
    name: "Kontorsstädning",
    intent: "kontorsstädning",
    description: "Regelbunden städning av kontor, arbetsplatser och lokaler.",
    duration: "Variabel",
  },
};

// Snapshot från platform_settings.base_price_per_hour (399). RUT halverar.
// Hardcoded HÄR enbart som SSR-default; runtime/booking läser alltid DB.
const RUT_PCT = 0.5;

// ─── Cleaner-typ + DB-fetch ───

interface CleanerRow {
  id: string;
  full_name: string | null;
  city: string | null;
  services: string[] | null;
  hourly_rate: number | null;
  avg_rating: number | null;
  review_count: number | null;
  completed_jobs: number | null;
  avatar_url: string | null;
  company_id: string | null;
  company_name: string | null;
}

async function fetchCleaners(city: CityConfig, service: ServiceConfig): Promise<CleanerRow[]> {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // PostgREST jsonb-contains: services=cs.["Hemstädning"]
  // (city är ilike för case-insensitive match: "Stockholm" / "stockholm")
  const { data, error } = await sb
    .from("v_cleaners_for_booking")
    .select("id,full_name,city,services,hourly_rate,avg_rating,review_count,completed_jobs,avatar_url,company_id,company_name")
    .ilike("city", city.name)
    .contains("services", [service.name])
    .order("avg_rating", { ascending: false, nullsFirst: false })
    .order("completed_jobs", { ascending: false, nullsFirst: false })
    .limit(10);

  if (error) {
    console.error("seo-page-stad-tjanst fetch error:", error);
    return [];
  }
  return (data || []) as unknown as CleanerRow[];
}

// ─── HTML-rendering ───

interface PageOpts {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  jsonLd: Array<Record<string, unknown>>;
  body: string;
}

function htmlPage(opts: PageOpts): string {
  const ldBlocks = opts.jsonLd.map((ld) =>
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Spick">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:image" content="${esc(opts.ogImage)}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<meta name="twitter:image" content="${esc(opts.ogImage)}">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
${ldBlocks}
<style>
:root{--g:#0F6E56;--gm:#1D9E75;--gp:#E1F5EE;--gl:#9FE1CB;--b:#0E0E0E;--gr:#F7F7F5;--grd:#E8E8E4;--t:#1C1C1A;--m:#6B6960;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'DM Sans',sans-serif;color:var(--t);background:#fff;line-height:1.6;}
nav{background:#fff;padding:1.25rem 5rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--grd);position:sticky;top:0;z-index:100;}
.logo{font-family:'Playfair Display',serif;font-size:1.6rem;font-weight:700;color:var(--g);text-decoration:none;}
.nav-links{display:flex;gap:1.75rem;align-items:center;}
.nl{color:var(--m);text-decoration:none;font-size:.9rem;}
.nl:hover{color:var(--g);}
.nl-btn{background:var(--g);color:#fff;padding:.55rem 1.4rem;border-radius:100px;font-weight:600;font-size:.875rem;text-decoration:none;}
.nl-btn:hover{background:var(--gm);}
.crumbs{padding:1rem 5rem;background:var(--gr);font-size:.825rem;color:var(--m);}
.crumbs a{color:var(--g);text-decoration:none;}
.crumbs a:hover{text-decoration:underline;}
.hero{background:linear-gradient(135deg,#0a2a1e,var(--g));padding:5rem 5rem 4rem;color:#fff;}
.hero h1{font-family:'Playfair Display',serif;font-size:clamp(2rem,4vw,3rem);font-weight:700;margin-bottom:1rem;line-height:1.15;}
.hero h1 span{color:var(--gl);}
.hero p{max-width:600px;font-size:1.05rem;color:rgba(255,255,255,.85);margin-bottom:2rem;}
.hero-cta{display:inline-flex;align-items:center;gap:.5rem;padding:1rem 2.25rem;background:#fff;color:var(--g);border-radius:100px;text-decoration:none;font-weight:700;}
.hero-cta:hover{background:var(--gp);}
.hero-stats{display:flex;gap:2.5rem;margin-top:2.5rem;flex-wrap:wrap;}
.hero-stats .v{font-family:'Playfair Display',serif;font-size:2rem;font-weight:700;color:var(--gl);}
.hero-stats .l{font-size:.85rem;color:rgba(255,255,255,.65);margin-top:.25rem;}
.sec{padding:4rem 5rem;max-width:1200px;margin:0 auto;}
.sec-tag{display:inline-block;background:var(--gp);color:var(--g);font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:.3rem .875rem;border-radius:100px;margin-bottom:1rem;}
h2{font-family:'Playfair Display',serif;font-size:1.85rem;font-weight:700;color:var(--b);margin-bottom:1rem;}
.intro{color:var(--m);max-width:780px;margin-bottom:2.5rem;font-size:1rem;}
.cleaner-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.25rem;}
.cleaner-card{background:#fff;border:1px solid var(--grd);border-radius:18px;padding:1.5rem;display:flex;flex-direction:column;gap:.5rem;transition:all .2s;}
.cleaner-card:hover{border-color:var(--g);box-shadow:0 6px 20px rgba(15,110,86,.08);transform:translateY(-2px);}
.cc-head{display:flex;align-items:center;gap:.875rem;}
.cc-av{width:54px;height:54px;border-radius:50%;background:var(--gp);color:var(--g);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:1.2rem;overflow:hidden;flex-shrink:0;}
.cc-av img{width:100%;height:100%;object-fit:cover;}
.cc-name{font-weight:700;font-size:.98rem;}
.cc-meta{font-size:.78rem;color:var(--m);margin-top:.15rem;}
.cc-stars{color:#F59E0B;font-size:.875rem;margin:.4rem 0;}
.cc-stars .ng{color:var(--m);font-size:.78rem;margin-left:.35rem;}
.cc-svc{display:flex;flex-wrap:wrap;gap:.3rem;margin:.4rem 0;}
.cc-svc span{background:var(--gp);color:var(--g);font-size:.68rem;padding:.2rem .55rem;border-radius:99px;font-weight:600;}
.cc-price{font-weight:700;color:var(--g);font-size:1.05rem;margin-top:.4rem;}
.cc-price small{color:var(--m);font-weight:400;font-size:.75rem;}
.cc-cta{display:block;text-align:center;background:var(--g);color:#fff;padding:.7rem;border-radius:10px;text-decoration:none;font-weight:600;font-size:.85rem;margin-top:.75rem;}
.cc-cta:hover{background:var(--gm);}
.empty{text-align:center;padding:3rem 1rem;color:var(--m);background:var(--gr);border-radius:18px;}
.faq-sec{padding:4rem 5rem;background:var(--gr);}
.faq-inner{max-width:780px;margin:0 auto;}
.fi{background:#fff;border:1.5px solid var(--grd);border-radius:14px;overflow:hidden;margin-bottom:.75rem;}
.fq{padding:1.1rem 1.5rem;cursor:pointer;font-size:.95rem;font-weight:600;display:flex;justify-content:space-between;align-items:center;}
.fa{padding:0 1.5rem 1.25rem;font-size:.875rem;color:var(--m);line-height:1.75;display:none;}
.fi.open .fa{display:block;}
.fi.open .fq{color:var(--g);}
.cta{background:var(--b);padding:5rem 5rem;text-align:center;color:#fff;}
.cta h2{color:#fff;font-family:'Playfair Display',serif;font-size:2.2rem;margin-bottom:.75rem;}
.cta p{color:#9E9E99;max-width:520px;margin:0 auto 2rem;}
.cta a{display:inline-block;background:var(--g);color:#fff;padding:1rem 2.75rem;border-radius:100px;text-decoration:none;font-weight:700;}
.cta a:hover{background:var(--gm);}
.related{padding:3rem 5rem;background:#fff;border-top:1px solid var(--grd);}
.related-grid{display:flex;flex-wrap:wrap;gap:.6rem;}
.related a{padding:.5rem 1rem;background:var(--gp);color:var(--g);border-radius:99px;font-size:.825rem;text-decoration:none;font-weight:600;}
.related a:hover{background:var(--gl);}
footer{padding:2.5rem 5rem;background:var(--b);color:#9E9E99;font-size:.8rem;text-align:center;}
footer a{color:var(--gl);text-decoration:none;}
@media(max-width:900px){nav,.crumbs,.hero,.sec,.faq-sec,.cta,.related,footer{padding-left:1.5rem;padding-right:1.5rem;}.hero{padding-top:3rem;padding-bottom:3rem;}.sec{padding-top:3rem;padding-bottom:3rem;}}
</style>
</head>
<body>
${opts.body}
</body>
</html>`;
}

function renderCleanerCard(c: CleanerRow, service: ServiceConfig, city: CityConfig): string {
  const rate = c.hourly_rate || 399;
  const rutPrice = Math.round(rate * RUT_PCT);
  const initials = (c.full_name || "?").split(" ").map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();
  const ratingHtml = (c.avg_rating && c.review_count) ?
    `<div class="cc-stars">★ ${c.avg_rating.toFixed(1)}<span class="ng">(${c.review_count} omdömen)</span></div>` :
    `<div class="cc-stars" style="color:var(--m)">Ny på Spick<span class="ng"></span></div>`;
  const jobsHtml = c.completed_jobs ? `<div class="cc-meta">${c.completed_jobs} utförda jobb</div>` : "";

  // CTA pre-fill: ?service=Hemstädning&city=Stockholm&cleaner=<id>
  const ctaUrl = `/boka.html?service=${encodeURIComponent(service.name)}&city=${encodeURIComponent(city.name)}&cleaner=${encodeURIComponent(c.id)}`;
  const avHtml = c.avatar_url
    ? `<img src="${esc(c.avatar_url)}" alt="${esc(c.full_name || "Städare")}" loading="lazy">`
    : esc(initials);

  return `
<div class="cleaner-card">
  <div class="cc-head">
    <div class="cc-av">${avHtml}</div>
    <div>
      <div class="cc-name">${esc(c.full_name || "Städare")}</div>
      <div class="cc-meta">${esc(city.name)}${c.company_name ? " · " + esc(c.company_name) : ""}</div>
    </div>
  </div>
  ${ratingHtml}
  ${jobsHtml}
  <div class="cc-svc">${(c.services || []).slice(0, 3).map((s) => `<span>${esc(s)}</span>`).join("")}</div>
  <div class="cc-price">${rate} kr/h <small>(${rutPrice} kr/h med RUT)</small></div>
  <a href="${esc(ctaUrl)}" class="cc-cta">Boka ${esc(c.full_name?.split(" ")[0] || "städare")} →</a>
</div>`;
}

function buildFaqJsonLd(faqs: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map((f) => ({
      "@type": "Question",
      "name": f.q,
      "acceptedAnswer": { "@type": "Answer", "text": f.a },
    })),
  };
}

function buildBreadcrumbJsonLd(city: CityConfig, service: ServiceConfig, canonical: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Hem", "item": SITE_URL + "/" },
      { "@type": "ListItem", "position": 2, "name": city.name, "item": `${SITE_URL}/${city.slug}.html` },
      { "@type": "ListItem", "position": 3, "name": `${service.name} ${city.name}`, "item": canonical },
    ],
  };
}

function buildLocalBusinessJsonLd(
  city: CityConfig,
  service: ServiceConfig,
  canonical: string,
  cleaners: CleanerRow[],
  minPrice: number,
  maxPrice: number,
): Record<string, unknown> {
  // Aggregate-rating på sidnivå (om det finns betyg från cleaners)
  let agg: Record<string, unknown> | undefined;
  const rated = cleaners.filter((c) => (c.review_count || 0) > 0 && c.avg_rating != null);
  if (rated.length > 0) {
    const totalReviews = rated.reduce((s, c) => s + (c.review_count || 0), 0);
    const weightedSum = rated.reduce((s, c) => s + ((c.avg_rating || 0) * (c.review_count || 0)), 0);
    const avg = totalReviews > 0 ? weightedSum / totalReviews : 0;
    if (avg > 0) {
      agg = {
        "@type": "AggregateRating",
        "ratingValue": avg.toFixed(1),
        "reviewCount": totalReviews,
        "bestRating": "5",
        "worstRating": "1",
      };
    }
  }

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
    "@id": `${canonical}#service`,
    "name": `Spick — ${service.name} i ${city.name}`,
    "description": `${service.name} i ${city.name} via Spick. ${cleaners.length} verifierade städare. RUT-avdrag 50%.`,
    "url": canonical,
    "image": `${SITE_URL}/assets/og-image.png`,
    "telephone": "+46760505153",
    "email": "hello@spick.se",
    "areaServed": { "@type": "City", "name": city.name },
    "geo": { "@type": "GeoCoordinates", "latitude": String(city.geo.lat), "longitude": String(city.geo.lng) },
    "priceRange": `${minPrice}-${maxPrice} kr/h`,
    "paymentAccepted": "Card, Klarna",
    "openingHours": "Mo-Su 07:00-20:00",
    "parentOrganization": { "@type": "Organization", "name": "Spick", "url": SITE_URL },
  };
  if (agg) ld.aggregateRating = agg;
  return ld;
}

function renderPage(city: CityConfig, service: ServiceConfig, cleaners: CleanerRow[]): string {
  const canonical = `${SITE_URL}/${service.slug}-${city.slug}`;
  const minPrice = cleaners.length > 0
    ? Math.min(...cleaners.map((c) => c.hourly_rate || 399))
    : 250;
  const maxPrice = cleaners.length > 0
    ? Math.max(...cleaners.map((c) => c.hourly_rate || 399))
    : 600;
  const minRut = Math.round(minPrice * RUT_PCT);

  const title = `${service.name} i ${city.name} — Boka från ${minRut} kr/h | Spick`;
  const description = `Hitta verifierade städare för ${service.intent} i ${city.name}. RUT-avdrag direkt på fakturan. Bokning på 60 sekunder.`;

  // FAQ — skräddarsydd för stad+tjänst (5 frågor)
  const faqs = [
    {
      q: `Hur mycket kostar ${service.intent} i ${city.name}?`,
      a: `Priserna varierar mellan ${minPrice}–${maxPrice} kr/timme beroende på vilken städare du väljer. Med RUT-avdrag betalar du bara hälften, från ${minRut} kr/timme.`,
    },
    {
      q: `Hur lång tid tar ${service.intent}?`,
      a: `${service.name} tar normalt ${service.duration} beroende på bostadsstorlek och städarens arbetstakt. Du anger din yta vid bokning så får du en tidsestimering.`,
    },
    {
      q: `Vilka områden i ${city.name} täcker ni?`,
      a: `Vi har verifierade städare i hela ${city.name} med omnejd. Ange din adress vid bokning så matchar vi dig med en städare i ditt område.`,
    },
    {
      q: `Hur fungerar RUT-avdraget?`,
      a: `RUT-avdraget ger dig 50% rabatt på ${service.intent}. Vi hanterar hela administrationen mot Skatteverket åt dig — du betalar bara halva priset direkt vid bokning.`,
    },
    {
      q: `Vad händer om jag inte är nöjd?`,
      a: `Vi har nöjdhetsgaranti. Är du inte nöjd med städningen? Kontakta oss inom 24 timmar så löser vi det — kostnadsfri kompletterande städning.`,
    },
  ];

  // ─── HTML body ───
  const cleanersHtml = cleaners.length === 0 ?
    `<div class="empty">
      <h3 style="margin-bottom:.5rem;font-family:'Playfair Display',serif">Inga städare tillgängliga ännu i ${esc(city.name)}</h3>
      <p style="margin-bottom:1.5rem">Vi expanderar löpande. Anmäl dig till väntelistan så kontaktar vi dig när ${esc(service.intent)} blir tillgängligt här.</p>
      <a href="/${esc(city.slug)}.html" style="display:inline-block;background:var(--g);color:#fff;padding:.75rem 1.5rem;border-radius:100px;text-decoration:none;font-weight:600">Anmäl intresse →</a>
    </div>` :
    `<div class="cleaner-grid">${cleaners.map((c) => renderCleanerCard(c, service, city)).join("")}</div>`;

  const faqsHtml = faqs.map((f) =>
    `<div class="fi"><div class="fq" onclick="this.closest('.fi').classList.toggle('open')"><span>${esc(f.q)}</span><span>▼</span></div><div class="fa">${esc(f.a)}</div></div>`,
  ).join("");

  // Cross-link till andra tjänster i samma stad
  const otherServices = Object.values(SUPPORTED_SERVICES).filter((s) => s.slug !== service.slug);
  const otherCities = Object.values(SUPPORTED_CITIES).filter((c) => c.slug !== city.slug);
  const relatedHtml = `
<div class="related-grid">
  ${otherServices.map((s) => `<a href="/${s.slug}-${city.slug}">${esc(s.name)} i ${esc(city.name)} →</a>`).join("")}
  ${otherCities.map((c) => `<a href="/${service.slug}-${c.slug}">${esc(service.name)} i ${esc(c.name)} →</a>`).join("")}
</div>`;

  const body = `
<nav>
  <a href="/" class="logo">Spick</a>
  <div class="nav-links">
    <a href="/hur-det-funkar.html" class="nl">Hur det funkar</a>
    <a href="/priser.html" class="nl">Priser</a>
    <a href="/tjanster.html" class="nl">Tjänster</a>
    <a href="/boka.html" class="nl-btn">Boka städning</a>
  </div>
</nav>

<div class="crumbs">
  <a href="/">Hem</a> &rsaquo;
  <a href="/${esc(city.slug)}.html">${esc(city.name)}</a> &rsaquo;
  <span>${esc(service.name)}</span>
</div>

<div class="hero">
  <h1>${esc(service.name)} i <span>${esc(city.name)}</span></h1>
  <p>Hitta verifierade städare för ${esc(service.intent)} i ${esc(city.name)}. ${esc(service.description)} Med RUT-avdrag betalar du bara hälften, från ${minRut} kr/h.</p>
  <a href="/boka.html?service=${encodeURIComponent(service.name)}&city=${encodeURIComponent(city.name)}" class="hero-cta">Boka städning &rarr;</a>
  <div class="hero-stats">
    <div><div class="v">${cleaners.length}</div><div class="l">verifierade städare</div></div>
    <div><div class="v">${minRut} kr/h</div><div class="l">från, med RUT</div></div>
    <div><div class="v">50%</div><div class="l">RUT-avdrag</div></div>
  </div>
</div>

<div class="sec">
  <div class="sec-tag">Top städare</div>
  <h2>${esc(service.name)} i ${esc(city.name)} — välj din städare</h2>
  <p class="intro">Alla städare på Spick är ID-verifierade och kvalitetsgranskade. Du ser deras betyg, tidigare jobb och timpris innan du bokar. Med RUT-avdrag betalar du bara hälften av priset.</p>
  ${cleanersHtml}
</div>

<div class="faq-sec">
  <div class="faq-inner">
    <div class="sec-tag">Vanliga frågor</div>
    <h2>Om ${esc(service.intent)} i ${esc(city.name)}</h2>
    <div style="margin-top:1.5rem">${faqsHtml}</div>
  </div>
</div>

<div class="related">
  <h2 style="font-size:1.2rem;margin-bottom:1rem">Andra tjänster och städer</h2>
  ${relatedHtml}
</div>

<div class="cta">
  <h2>Redo att boka ${esc(service.intent)} i ${esc(city.name)}?</h2>
  <p>Boka på 60 sekunder. Med RUT-avdrag betalar du bara hälften — vi hanterar Skatteverket åt dig.</p>
  <a href="/boka.html?service=${encodeURIComponent(service.name)}&city=${encodeURIComponent(city.name)}">Boka städning &rarr;</a>
</div>

<footer>
  © ${new Date().getFullYear()} Spick · <a href="/">spick.se</a> · <a href="/kontakt.html">Kontakt</a> · <a href="/integritetspolicy.html">Integritet</a>
</footer>`;

  const jsonLd: Array<Record<string, unknown>> = [
    buildLocalBusinessJsonLd(city, service, canonical, cleaners, minPrice, maxPrice),
    buildBreadcrumbJsonLd(city, service, canonical),
    buildFaqJsonLd(faqs),
  ];

  return htmlPage({
    title,
    description,
    canonical,
    ogImage: `${SITE_URL}/assets/og-image.png`,
    jsonLd,
    body,
  });
}

function render400(message: string): string {
  return htmlPage({
    title: "Ogiltig SEO-sida | Spick",
    description: "Sidan kunde inte renderas. Hitta städare på spick.se.",
    canonical: `${SITE_URL}/stadare.html`,
    ogImage: `${SITE_URL}/assets/og-image.png`,
    jsonLd: [{ "@context": "https://schema.org", "@type": "WebPage", "name": "Ogiltig sida" }],
    body: `<div style="text-align:center;padding:4rem 1rem"><h1>Ogiltig sida</h1><p>${esc(message)}</p><p style="margin-top:1rem"><a href="/stadare.html">Hitta städare på spick.se</a></p></div>`,
  });
}

// ─── Server ───

serve(async (req) => {
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
  const stadParam = (url.searchParams.get("stad") || "").toLowerCase().trim();
  const tjanstParam = (url.searchParams.get("tjanst") || "").toLowerCase().trim();

  if (!stadParam || !tjanstParam) {
    return new Response(render400("Saknar 'stad' eller 'tjanst' query-parameter."), {
      status: 400,
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const city = SUPPORTED_CITIES[stadParam];
  const service = SUPPORTED_SERVICES[tjanstParam];

  if (!city) {
    return new Response(render400(`Staden "${stadParam}" stöds inte ännu. Stödda städer: ${Object.keys(SUPPORTED_CITIES).join(", ")}.`), {
      status: 404,
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (!service) {
    return new Response(render400(`Tjänsten "${tjanstParam}" stöds inte ännu. Stödda tjänster: ${Object.keys(SUPPORTED_SERVICES).join(", ")}.`), {
      status: 404,
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  try {
    const cleaners = await fetchCleaners(city, service);
    const html = renderPage(city, service, cleaners);
    return new Response(html, {
      status: 200,
      headers: {
        ...CORS,
        "Content-Type": "text/html; charset=utf-8",
        // 6h CDN-cache, 12h SWR — cleaner-listan ändras sällan
        "Cache-Control": "public, max-age=21600, s-maxage=21600, stale-while-revalidate=43200",
        "X-Robots-Tag": "index, follow",
      },
    });
  } catch (e) {
    console.error("seo-page-stad-tjanst render error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

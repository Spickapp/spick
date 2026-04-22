// supabase/functions/sitemap-profiles/index.ts
// =============================================================
// Sprint Prof-5: Dynamisk sitemap för profil-URL:er (/f/<slug>, /s/<slug>)
//
// Varför EF istället för statisk sitemap.xml:
//   - Nya företag och städare läggs till kontinuerligt via registrering
//   - Manuell sitemap-uppdatering är sticka i ögonen
//   - Statiska sitemap.xml behåller vi för landing-pages (stads-sidor etc.)
//
// Google Search Console: lägg till båda som sitemaps i spick.se property.
// robots.txt listar båda som Sitemap-referenser (Google följer alla).
//
// Output: application/xml med <urlset> enligt sitemaps.org protokoll.
// Cache: 1h (public) — OK för SEO-discovery, inte realtidskritiskt.
//
// Primärkälla: docs/profile-routing är /f/<company-slug> för företag,
//              /s/<cleaner-slug> för solo-städare. VD får 301-redirect
//              från /s/ till /f/ (Prof-5 stadare-profil.html-change).
//
// Regler: #27 scope (endast profile-URLs, statisk sitemap orörd),
//         #31 primärkälla (DB-data, inte hårdkodad lista).
// =============================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1. Företag med slug
    const { data: companies } = await supabase
      .from("companies")
      .select("slug")
      .not("slug", "is", null);

    // 2. Solo-städare (company_id IS NULL) med slug, godkända
    const { data: soloCleaners } = await supabase
      .from("v_cleaners_public")
      .select("slug")
      .is("company_id", null)
      .eq("is_approved", true)
      .not("slug", "is", null);

    const today = new Date().toISOString().split("T")[0];
    const urls: string[] = [];

    for (const c of companies ?? []) {
      const slug = escapeXml(String(c.slug));
      urls.push(
        `  <url><loc>https://spick.se/f/${slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`,
      );
    }

    for (const c of soloCleaners ?? []) {
      const slug = escapeXml(String(c.slug));
      urls.push(
        `  <url><loc>https://spick.se/s/${slug}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`,
      );
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("sitemap-profiles error:", errMsg);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<!-- sitemap-profiles error: ${escapeXml(errMsg)} -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`,
      {
        status: 500,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      },
    );
  }
});

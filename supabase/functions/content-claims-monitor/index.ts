/**
 * content-claims-monitor — daily prod-HTML-scan mot godkända claims
 *
 * BAKGRUND
 * Audit 2026-04-27 (Farhad-fynd): foretag.html sa "30 dagars betalvillkor"
 * trots att Spick INTE erbjuder det. Min audit-batteri täckte tekniskt
 * men inte business-content-accuracy. Denna EF kompletterar genom att
 * curlea prod-HTML och flagga okända/disallowed claims.
 *
 * GÖR
 * 1. Curl varje publik HTML-sida (lista nedan)
 * 2. Grep mot disallowed_claims-mönster i approved-claims.json
 * 3. Aggregera fynd
 * 4. Discord-alert om nya disallowed-claims hittas
 *
 * AUTH: CRON_SECRET via _shared/cron-auth.ts
 * SCHEMA: 1x/dag 04:30 UTC (efter lighthouse 04:00, innan playwright 05:00)
 *
 * REGLER:
 *   - #28 SSOT: approved-claims.json är primärkällan
 *   - #30 N/A (vi söker bara avvikelser, inte legal-tolkning)
 *   - #31 curlar prod direkt, inte cached
 */
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/email.ts";
import { sendAdminAlert } from "../_shared/alerts.ts";
import { requireCronAuth } from "../_shared/cron-auth.ts";

const SITE = "https://spick.se";

// Lista av publika sidor att scanna (kärn-content + B2B)
const PUBLIC_PAGES = [
  "/",
  "/boka.html",
  "/foretag.html",
  "/tjanster.html",
  "/priser.html",
  "/bli-stadare.html",
  "/bli-foretag.html",
  "/villkor-stadare.html",
  "/skatt-utbetalningar.html",
  "/hur-det-funkar.html",
  "/blogg/jobba-som-stadare-stockholm.html",
];

// Disallowed claim-patterns (regex). Lägg till i approved-claims.json
// och replikera här om policy ändras.
const DISALLOWED_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "30/60/90 dagars betalvillkor", pattern: /\b\d{2,3}\s*-?\s*dagars?\s+betalvillkor\b/i },
  { name: "17% provision (gammalt värde)", pattern: /\b17\s*%\s*(provision|kommission)|provision[^a-z]{1,5}17\s*%/i },
  { name: "Trappsystem (Brons/Silver/Guld/Platinum)", pattern: /\b(brons|silver|guld|platinum)[\s\S]{0,40}(provision|tier|nivå)/i },
  { name: "Sveriges största städplattform", pattern: /Sveriges\s+(största|bästa|ledande)\s+städ/i },
  { name: "100% garanti utan villkor", pattern: /100\s*%\s*garanti(?!\s*med|\s+vid|\s+enligt)/i },
];

interface PageScanResult {
  url: string;
  http_status: number;
  matched_disallowed: { name: string; snippet: string }[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });

  const auth = requireCronAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    });
  }

  const startTime = Date.now();
  const results: PageScanResult[] = [];

  for (const path of PUBLIC_PAGES) {
    const url = `${SITE}${path}`;
    const result: PageScanResult = { url, http_status: 0, matched_disallowed: [] };
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Spick-content-monitor/1.0" } });
      result.http_status = res.status;
      if (!res.ok) {
        results.push(result);
        continue;
      }
      const html = await res.text();
      // Strip script/style för att inte trigga på dev-comments
      const visibleText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<!--[\s\S]*?-->/g, "");
      for (const dp of DISALLOWED_PATTERNS) {
        const match = dp.pattern.exec(visibleText);
        if (match) {
          // Extrahera snippet runt match (60 char före + after)
          const idx = visibleText.indexOf(match[0]);
          const snippet = visibleText.slice(Math.max(0, idx - 40), idx + match[0].length + 40)
            .replace(/\s+/g, " ").trim();
          result.matched_disallowed.push({ name: dp.name, snippet });
        }
      }
    } catch (e) {
      result.matched_disallowed.push({
        name: "fetch_failed",
        snippet: (e as Error).message,
      });
    }
    results.push(result);
  }

  // Aggregera fynd
  const totalMatches = results.reduce((sum, r) => sum + r.matched_disallowed.length, 0);
  const pagesWithIssues = results.filter((r) => r.matched_disallowed.length > 0);

  if (totalMatches > 0) {
    const summary = pagesWithIssues
      .map((r) => `${r.url}: ${r.matched_disallowed.map((m) => m.name).join(", ")}`)
      .join(" | ");
    try {
      await sendAdminAlert({
        severity: totalMatches >= 5 ? "critical" : "warn",
        title: `📋 Content-monitor: ${totalMatches} disallowed claim(s) i prod`,
        source: "content-claims-monitor",
        message: summary.slice(0, 800),
        metadata: { total_matches: totalMatches, pages_with_issues: pagesWithIssues.length, results: pagesWithIssues },
      });
    } catch (e) {
      console.error("[content-claims-monitor] sendAdminAlert failed:", (e as Error).message);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    pages_scanned: results.length,
    total_matches: totalMatches,
    pages_with_issues: pagesWithIssues.length,
    duration_ms: Date.now() - startTime,
    results,
  }), {
    status: totalMatches > 0 ? 422 : 200,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
});

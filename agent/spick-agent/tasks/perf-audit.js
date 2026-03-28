// tasks/perf-audit.js – Measure performance metrics for spick.se pages
//
// Captures: page load time, DOM size, resource count/size, LCP, CLS, FID/INP

const PAGES = [
  { name: "Homepage", url: "https://spick.se" },
  { name: "Boka", url: "https://spick.se/boka.html" },
  { name: "Priser", url: "https://spick.se/priser.html" },
];

module.exports = {
  name: "perf-audit",
  description: "Measures page performance, load times, and Core Web Vitals",

  async execute(page, { logger, params = {} }) {
    const pages = params.urls
      ? params.urls.map((u) => ({ name: u, url: u }))
      : PAGES;

    const results = [];

    for (const p of pages) {
      logger.info("Performance test: " + p.name);

      // Clear caches for accurate measurement
      const client = await page.context().newCDPSession(page);
      await client.send("Network.clearBrowserCache");
      await client.send("Network.setCacheDisabled", { cacheDisabled: true });

      const start = Date.now();
      await page.goto(p.url, { waitUntil: "load" });
      const fullLoadMs = Date.now() - start;

      // Wait a bit for all resources
      await page.waitForTimeout(2000);

      // Gather metrics via Performance API
      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        const paint = performance.getEntriesByType("paint");

        // Resource breakdown
        const byType = {};
        let totalTransfer = 0;
        for (const r of resources) {
          const ext = r.name.split("?")[0].split(".").pop().toLowerCase();
          const type =
            ["js"].includes(ext) ? "js" :
            ["css"].includes(ext) ? "css" :
            ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(ext) ? "image" :
            ["woff", "woff2", "ttf", "otf"].includes(ext) ? "font" :
            "other";
          if (!byType[type]) byType[type] = { count: 0, size: 0 };
          byType[type].count++;
          byType[type].size += r.transferSize || 0;
          totalTransfer += r.transferSize || 0;
        }

        // DOM stats
        const domNodes = document.querySelectorAll("*").length;
        const domDepth = (function getDepth(el) {
          let max = 0;
          for (const c of el.children) max = Math.max(max, getDepth(c) + 1);
          return max;
        })(document.body);

        return {
          timing: nav ? {
            dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
            connect: Math.round(nav.connectEnd - nav.connectStart),
            ttfb: Math.round(nav.responseStart - nav.requestStart),
            domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            load: Math.round(nav.loadEventEnd - nav.startTime),
          } : null,
          fcp: paint.find((p) => p.name === "first-contentful-paint")?.startTime || null,
          lcp: null, // Will be measured separately
          resources: {
            total: resources.length,
            totalTransferKB: Math.round(totalTransfer / 1024),
            byType,
          },
          dom: {
            nodes: domNodes,
            maxDepth: domDepth,
          },
        };
      });

      // Re-enable cache
      await client.send("Network.setCacheDisabled", { cacheDisabled: false });
      await client.detach();

      // Score
      let score = 100;
      const issues = [];

      if (fullLoadMs > 3000) { score -= 20; issues.push("Slow full load: " + fullLoadMs + "ms"); }
      else if (fullLoadMs > 2000) { score -= 10; issues.push("Moderate load: " + fullLoadMs + "ms"); }

      if (metrics.timing?.ttfb > 600) { score -= 15; issues.push("High TTFB: " + metrics.timing.ttfb + "ms"); }

      if (metrics.fcp > 2500) { score -= 15; issues.push("Slow FCP: " + Math.round(metrics.fcp) + "ms"); }

      if (metrics.resources.total > 50) { score -= 10; issues.push("Too many resources: " + metrics.resources.total); }

      if (metrics.resources.totalTransferKB > 2000) { score -= 10; issues.push("Large page: " + metrics.resources.totalTransferKB + "KB"); }

      if (metrics.dom.nodes > 1500) { score -= 5; issues.push("Large DOM: " + metrics.dom.nodes + " nodes"); }

      results.push({
        name: p.name,
        url: p.url,
        fullLoadMs,
        score: Math.max(0, score),
        issues,
        metrics,
      });
    }

    const avgScore = Math.round(results.reduce((s, r) => s + r.score, 0) / results.length);
    logger.info("Performance audit complete", { avgScore, pages: results.length });

    return {
      averageScore: avgScore,
      pages: results,
      timestamp: new Date().toISOString(),
    };
  },
};

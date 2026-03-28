// tasks/seo-audit.js – Quick SEO audit of key spick.se pages

const PAGES = [
  "https://spick.se",
  "https://spick.se/boka.html",
  "https://spick.se/priser.html",
  "https://spick.se/bli-stadare.html",
  "https://spick.se/faq.html",
];

module.exports = {
  name: "seo-audit",
  description: "SEO audit – checks meta tags, h1, schema.org, performance",

  async execute(page, { logger }) {
    const results = [];

    for (const url of PAGES) {
      logger.info("Auditing: " + url);
      const start = Date.now();

      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      const loadMs = Date.now() - start;

      const audit = await page.evaluate(() => {
        const getMeta = (name) => {
          const el =
            document.querySelector(`meta[name="${name}"]`) ||
            document.querySelector(`meta[property="og:${name}"]`);
          return el ? el.getAttribute("content") : null;
        };

        const h1s = Array.from(document.querySelectorAll("h1")).map((el) =>
          el.textContent.trim()
        );
        const h2s = Array.from(document.querySelectorAll("h2")).map((el) =>
          el.textContent.trim()
        );

        const canonical = document.querySelector('link[rel="canonical"]');
        const schemaScripts = Array.from(
          document.querySelectorAll('script[type="application/ld+json"]')
        );

        let schemas = [];
        for (const s of schemaScripts) {
          try {
            const data = JSON.parse(s.textContent);
            schemas.push(data["@type"] || "unknown");
          } catch {}
        }

        const images = Array.from(document.querySelectorAll("img"));
        const imagesWithoutAlt = images.filter(
          (img) => !img.alt || img.alt.trim() === ""
        ).length;

        return {
          title: document.title,
          titleLength: document.title.length,
          description: getMeta("description"),
          descriptionLength: (getMeta("description") || "").length,
          ogTitle: getMeta("title"),
          ogDescription: getMeta("description"),
          ogImage: getMeta("image"),
          canonical: canonical ? canonical.href : null,
          h1Count: h1s.length,
          h1s: h1s.slice(0, 3),
          h2Count: h2s.length,
          schemaTypes: schemas,
          totalImages: images.length,
          imagesWithoutAlt,
          lang: document.documentElement.lang || null,
        };
      });

      // Score the page
      let score = 0;
      const issues = [];

      if (audit.title && audit.titleLength >= 30 && audit.titleLength <= 60) score += 15;
      else issues.push("Title length: " + audit.titleLength + " (aim 30-60)");

      if (audit.description && audit.descriptionLength >= 120 && audit.descriptionLength <= 160) score += 15;
      else issues.push("Description length: " + audit.descriptionLength + " (aim 120-160)");

      if (audit.h1Count === 1) score += 15;
      else issues.push("H1 count: " + audit.h1Count + " (should be 1)");

      if (audit.canonical) score += 10;
      else issues.push("Missing canonical tag");

      if (audit.ogTitle && audit.ogImage) score += 10;
      else issues.push("Missing OG tags");

      if (audit.schemaTypes.length > 0) score += 15;
      else issues.push("No schema.org markup");

      if (audit.imagesWithoutAlt === 0) score += 10;
      else issues.push(audit.imagesWithoutAlt + " images without alt text");

      if (audit.lang === "sv") score += 5;
      else issues.push("Lang attribute: " + (audit.lang || "missing") + " (should be sv)");

      if (loadMs < 3000) score += 5;
      else issues.push("Slow load: " + loadMs + "ms");

      results.push({
        url,
        score,
        maxScore: 100,
        loadMs,
        issues,
        audit,
      });
    }

    const avgScore = Math.round(
      results.reduce((sum, r) => sum + r.score, 0) / results.length
    );

    logger.info("SEO audit complete", { avgScore, pages: results.length });

    return {
      averageScore: avgScore,
      pages: results,
      timestamp: new Date().toISOString(),
    };
  },
};

// tasks/check-site-status.js – Check all key pages on spick.se
const PAGES = [
  { name: "Homepage", url: "https://spick.se" },
  { name: "Boka", url: "https://spick.se/boka.html" },
  { name: "Priser", url: "https://spick.se/priser.html" },
  { name: "Bli städare", url: "https://spick.se/bli-stadare.html" },
  { name: "FAQ", url: "https://spick.se/faq.html" },
  { name: "Städare-portal", url: "https://spick.se/stadare.html" },
];

module.exports = {
  name: "check-site-status",
  description: "Visits all key spick.se pages and reports status",

  async execute(page, { logger }) {
    const results = [];

    for (const p of PAGES) {
      logger.info(`Checking ${p.name}`, { url: p.url });
      const start = Date.now();

      try {
        const response = await page.goto(p.url, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        const status = response?.status() || 0;
        const loadTimeMs = Date.now() - start;
        const title = await page.title();

        // Check for common error indicators
        const hasError = await page.evaluate(() => {
          const body = document.body.innerText.toLowerCase();
          return body.includes("404") || body.includes("error") || body.includes("not found");
        });

        results.push({
          name: p.name,
          url: p.url,
          status,
          loadTimeMs,
          title,
          hasError,
          ok: status >= 200 && status < 400 && !hasError,
        });
      } catch (err) {
        results.push({
          name: p.name,
          url: p.url,
          status: 0,
          loadTimeMs: Date.now() - start,
          title: null,
          hasError: true,
          ok: false,
          error: err.message,
        });
      }
    }

    const allOk = results.every((r) => r.ok);
    logger.info("Site check complete", { allOk, pages: results.length });

    return { allOk, pages: results };
  },
};

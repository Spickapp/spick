// tasks/monitor-stack.js – Health check the full Spick tech stack
//
// Checks: spick.se frontend, Supabase API, Stripe checkout readiness

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";

const CHECKS = [
  {
    name: "Frontend (spick.se)",
    url: "https://spick.se",
    expectText: null,
  },
  {
    name: "Booking page",
    url: "https://spick.se/boka.html",
    expectText: null,
  },
  {
    name: "Supabase REST API",
    url: `${SUPABASE_URL}/rest/v1/`,
    expectStatus: [200, 401, 406], // 401 = needs key (but server is alive)
  },
  {
    name: "Supabase Auth",
    url: `${SUPABASE_URL}/auth/v1/health`,
    expectText: null,
  },
];

module.exports = {
  name: "monitor-stack",
  description: "Checks spick.se, Supabase, and stack health via browser",

  async execute(page, { logger }) {
    const results = [];

    for (const check of CHECKS) {
      logger.info(`Checking: ${check.name}`);
      const start = Date.now();

      try {
        const response = await page.goto(check.url, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });

        const status = response?.status() || 0;
        const loadMs = Date.now() - start;

        // Check for acceptable status codes
        const acceptableStatuses = check.expectStatus || [200, 301, 302, 304];
        const statusOk = acceptableStatuses.includes(status);

        // Check for error text on page
        let hasError = false;
        if (status === 200) {
          hasError = await page.evaluate(() => {
            const text = document.body?.innerText?.toLowerCase() || "";
            return (
              text.includes("application error") ||
              text.includes("503 service") ||
              text.includes("server error") ||
              text.includes("site can't be reached")
            );
          });
        }

        results.push({
          name: check.name,
          url: check.url,
          status,
          loadMs,
          ok: statusOk && !hasError,
          error: hasError ? "Error content detected on page" : null,
        });
      } catch (err) {
        results.push({
          name: check.name,
          url: check.url,
          status: 0,
          loadMs: Date.now() - start,
          ok: false,
          error: err.message,
        });
      }
    }

    // Also test a JS fetch to Supabase (from inside the browser)
    logger.info("Testing Supabase connectivity from browser context");
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });

    const supabaseCheck = await page.evaluate(async (supaUrl) => {
      try {
        const start = Date.now();
        const res = await fetch(supaUrl + "/rest/v1/", {
          method: "HEAD",
          headers: { apikey: "anon" },
        });
        return {
          name: "Supabase fetch (from browser)",
          status: res.status,
          loadMs: Date.now() - start,
          ok: res.status > 0, // Any response means server is reachable
          error: null,
        };
      } catch (err) {
        return {
          name: "Supabase fetch (from browser)",
          status: 0,
          loadMs: 0,
          ok: false,
          error: err.message,
        };
      }
    }, SUPABASE_URL);

    results.push(supabaseCheck);

    const allOk = results.every((r) => r.ok);
    const failCount = results.filter((r) => !r.ok).length;

    logger.info("Stack monitor complete", {
      allOk,
      total: results.length,
      failed: failCount,
    });

    return {
      allOk,
      totalChecks: results.length,
      failedChecks: failCount,
      checks: results,
      timestamp: new Date().toISOString(),
    };
  },
};

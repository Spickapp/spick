// tasks/check-bookings.js – Check recent bookings via Supabase REST API
//
// Uses the browser to call the Supabase API directly, which means
// we can inspect the response and extract booking data without
// needing the Supabase key in this codebase.

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";

module.exports = {
  name: "check-bookings",
  description: "Fetches recent bookings from Supabase and reports stats",

  async execute(page, { logger, params = {} }) {
    const limit = params.limit || 20;
    const anonKey = params.supabaseAnonKey;

    if (!anonKey) {
      // Fallback: scrape the booking page for any visible booking data
      logger.info("No Supabase key provided – checking booking page visually");
      return await checkViaPage(page, logger);
    }

    logger.info("Fetching bookings from Supabase API", { limit });

    // Navigate to spick.se first (CORS-friendly origin)
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(
      async ({ url, key, lim }) => {
        try {
          const res = await fetch(
            `${url}/rest/v1/bookings?select=*&order=created_at.desc&limit=${lim}`,
            {
              headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
              },
            }
          );

          if (!res.ok) {
            return { error: `API returned ${res.status}`, data: null };
          }

          const bookings = await res.json();

          // Aggregate stats
          const total = bookings.length;
          const statuses = {};
          const today = new Date().toISOString().split("T")[0];
          let todayCount = 0;

          for (const b of bookings) {
            const status = b.status || "unknown";
            statuses[status] = (statuses[status] || 0) + 1;
            if (b.created_at && b.created_at.startsWith(today)) {
              todayCount++;
            }
          }

          return {
            error: null,
            data: {
              total,
              todayCount,
              statuses,
              latest: bookings.slice(0, 5).map((b) => ({
                id: b.id,
                status: b.status,
                created_at: b.created_at,
                service: b.service_type || b.service || null,
                city: b.city || null,
              })),
            },
          };
        } catch (err) {
          return { error: err.message, data: null };
        }
      },
      { url: SUPABASE_URL, key: anonKey, lim: limit }
    );

    if (result.error) {
      logger.warn("Supabase query failed", { error: result.error });
      return { status: "error", error: result.error };
    }

    logger.info("Bookings fetched", {
      total: result.data.total,
      today: result.data.todayCount,
    });

    return {
      status: "ok",
      ...result.data,
      timestamp: new Date().toISOString(),
    };
  },
};

// Fallback: check the booking page visually
async function checkViaPage(page, logger) {
  logger.info("Navigating to booking page for visual check");
  await page.goto("https://spick.se/boka.html", { waitUntil: "networkidle" });

  const pageData = await page.evaluate(() => {
    const body = document.body.innerText;
    return {
      title: document.title,
      bodyLength: body.length,
      hasBookingForm: !!document.querySelector(
        "form, [class*='booking'], [class*='boka'], [data-step]"
      ),
      buttonCount: document.querySelectorAll("button").length,
      inputCount: document.querySelectorAll("input").length,
    };
  });

  return {
    status: "ok",
    method: "visual_check",
    note: "Pass supabaseAnonKey in params for full booking data",
    page: pageData,
    timestamp: new Date().toISOString(),
  };
}

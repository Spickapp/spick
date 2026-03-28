// tasks/check-supabase.js – Query Supabase for live platform data
//
// Navigates to spick.se and runs fetch() calls from the browser context
// to the Supabase REST API, checking table counts and recent activity.

const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";

module.exports = {
  name: "check-supabase",
  description: "Checks Supabase for bookings, cleaners, and platform stats",

  async execute(page, { logger, params = {} }) {
    // We need the anon key – get it from the spick.se source code
    logger.info("Loading spick.se to extract Supabase anon key");
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });

    const anonKey = await page.evaluate(() => {
      // Try to find the key in script tags or global vars
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        const match = s.textContent.match(/supabase[^"]*["']([a-zA-Z0-9._-]{30,})["']/);
        if (match) return match[1];
        // Also check for SUPABASE_ANON_KEY or anon key pattern
        const keyMatch = s.textContent.match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
        if (keyMatch) return keyMatch[0];
      }
      // Check meta tags
      const meta = document.querySelector('meta[name*="supabase"]');
      if (meta) return meta.content;
      return null;
    });

    if (!anonKey) {
      logger.warn("Could not find Supabase anon key on page");
      return {
        status: "partial",
        warning: "Supabase anon key not found – checking connectivity only",
        connectivity: await checkConnectivity(page, SUPABASE_URL),
      };
    }

    logger.info("Found Supabase key, querying tables");

    // Query various tables from browser context
    const stats = await page.evaluate(async ({ url, key }) => {
      const headers = {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "count=exact",
      };

      async function tableCount(table) {
        try {
          const res = await fetch(url + "/rest/v1/" + table + "?select=*&limit=0", {
            headers: { ...headers, Prefer: "count=exact" },
          });
          const count = res.headers.get("content-range");
          return { table, count: count ? parseInt(count.split("/")[1]) || 0 : null, status: res.status };
        } catch (err) {
          return { table, count: null, status: 0, error: err.message };
        }
      }

      async function recentRows(table, limit = 5) {
        try {
          const res = await fetch(
            url + "/rest/v1/" + table + "?select=*&order=created_at.desc&limit=" + limit,
            { headers }
          );
          if (!res.ok) return { table, rows: [], status: res.status };
          const rows = await res.json();
          return { table, rows, status: res.status };
        } catch (err) {
          return { table, rows: [], error: err.message };
        }
      }

      // Check table counts
      const tables = ["bookings", "cleaners", "cleaner_availability", "ratings", "notifications"];
      const counts = await Promise.all(tables.map(tableCount));

      // Get recent bookings
      const recentBookings = await recentRows("bookings", 5);

      // Get active cleaners
      const activeCleaner = await recentRows("cleaners", 10);

      return { counts, recentBookings, activeCleaner };
    }, { url: SUPABASE_URL, key: anonKey });

    logger.info("Supabase query complete", {
      tables: stats.counts.map((c) => c.table + ":" + c.count).join(", "),
    });

    return {
      status: "ok",
      supabaseUrl: SUPABASE_URL,
      tableCounts: stats.counts,
      recentBookings: {
        count: stats.recentBookings.rows.length,
        latest: stats.recentBookings.rows.map((r) => ({
          id: r.id,
          status: r.status,
          created_at: r.created_at,
          service_type: r.service_type,
        })),
      },
      activeCleaner: {
        count: stats.activeCleaner.rows.length,
        names: stats.activeCleaner.rows.map((r) => r.name || r.first_name || "unnamed"),
      },
      timestamp: new Date().toISOString(),
    };
  },
};

async function checkConnectivity(page, supabaseUrl) {
  return page.evaluate(async (url) => {
    try {
      const res = await fetch(url + "/rest/v1/", { method: "HEAD" });
      return { reachable: true, status: res.status };
    } catch (err) {
      return { reachable: false, error: err.message };
    }
  }, supabaseUrl);
}

// tasks/watch-bookings.js – Check for new bookings since last check
//
// Designed to run on a schedule (via scheduler.js).
// Compares current booking count with stored count.
// Sends push notification when new bookings arrive.

const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "..", "logs", ".booking-state.json");
const SUPABASE_URL = "https://urjeijcncsyuletprydy.supabase.co";

module.exports = {
  name: "watch-bookings",
  description: "Checks for new bookings since last check – notifies on new ones",

  async execute(page, { logger }) {
    // Load previous state
    let prevState = { count: 0, lastChecked: null, lastBookingId: null };
    try {
      if (fs.existsSync(STATE_FILE)) {
        prevState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      }
    } catch {}

    logger.info("Previous state", prevState);

    // Navigate to spick.se to get Supabase anon key
    await page.goto("https://spick.se/boka.html", { waitUntil: "domcontentloaded" });

    const anonKey = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script:not([src])");
      for (const s of scripts) {
        const m = s.textContent.match(/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
        if (m) return m[0];
      }
      return null;
    });

    if (!anonKey) {
      logger.warn("Could not find Supabase anon key");
      return { status: "error", reason: "no_anon_key" };
    }

    // Query bookings from browser context
    const data = await page.evaluate(async ({ url, key, lastId }) => {
      const headers = {
        apikey: key,
        Authorization: "Bearer " + key,
        Prefer: "count=exact",
      };

      // Get total count
      const countRes = await fetch(url + "/rest/v1/bookings?select=id&limit=0", {
        headers: { ...headers, Prefer: "count=exact" },
      });
      const countRange = countRes.headers.get("content-range");
      const totalCount = countRange ? parseInt(countRange.split("/")[1]) || 0 : 0;

      // Get latest 5 bookings
      const latestRes = await fetch(
        url + "/rest/v1/bookings?select=id,created_at,status,service_type,customer_email,gross_price&order=created_at.desc&limit=5",
        { headers }
      );
      const latest = latestRes.ok ? await latestRes.json() : [];

      // Find new bookings (after lastId if we have one)
      let newBookings = [];
      if (lastId) {
        const newRes = await fetch(
          url + "/rest/v1/bookings?select=id,created_at,status,service_type,customer_email,gross_price&id=gt." + lastId + "&order=created_at.desc",
          { headers }
        );
        newBookings = newRes.ok ? await newRes.json() : [];
      }

      return { totalCount, latest, newBookings };
    }, { url: SUPABASE_URL, key: anonKey, lastId: prevState.lastBookingId });

    // Calculate diff
    const newCount = data.totalCount - prevState.count;
    const hasNew = newCount > 0 || data.newBookings.length > 0;

    // Save state
    const newState = {
      count: data.totalCount,
      lastChecked: new Date().toISOString(),
      lastBookingId: data.latest[0]?.id || prevState.lastBookingId,
    };
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2));
    } catch {}

    // Send notification if new bookings found
    if (hasNew && newCount > 0) {
      logger.info("New bookings detected!", { newCount });
      try {
        const { notify } = require("../notify");
        const booking = data.latest[0];
        await notify(
          `🎉 ${newCount} ny${newCount > 1 ? "a" : ""} bokning${newCount > 1 ? "ar" : ""}!`,
          booking
            ? `${booking.service_type || "Städning"} – ${booking.gross_price ? booking.gross_price + " kr" : ""} – ${booking.status || "ny"}`
            : `Totalt: ${data.totalCount} bokningar`,
          { priority: 4, tags: "tada" }
        );
      } catch {}
    }

    logger.info("Booking watch complete", {
      total: data.totalCount,
      new: newCount,
      previousTotal: prevState.count,
    });

    return {
      status: hasNew ? "new_bookings" : "no_change",
      totalBookings: data.totalCount,
      newSinceLastCheck: Math.max(0, newCount),
      latestBookings: data.latest.map((b) => ({
        id: b.id,
        service: b.service_type,
        status: b.status,
        price: b.gross_price,
        created: b.created_at,
      })),
      lastChecked: newState.lastChecked,
      previousCheck: prevState.lastChecked,
      timestamp: new Date().toISOString(),
    };
  },
};

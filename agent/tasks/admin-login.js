// tasks/admin-login.js – Open spick.se/admin.html and trigger magic link login
//
// REAL admin.html flow:
//   - #pw is a hidden input (value="auth")
//   - doLogin() sends a magic link to hello@spick.se via Supabase
//   - No password field exists – it's magic-link-only
//
// This task navigates to admin, checks login state, and optionally triggers magic link.

module.exports = {
  name: "admin-login",
  description: "Opens admin panel, checks login state, optionally triggers magic link",

  async execute(page, { logger, params = {} }) {
    logger.info("Navigating to admin panel");
    await page.goto("https://spick.se/admin.html", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Check if login screen is visible
    const loginVisible = await page.locator("#login-screen").isVisible().catch(() => false);

    if (!loginVisible) {
      // Already logged in (e.g. persistent session)
      logger.info("Already authenticated – admin dashboard visible");

      const dashData = await page.evaluate(() => {
        const badges = {};
        document.querySelectorAll(".badge-count").forEach((el) => {
          const parent = el.closest(".nav-item");
          const label = parent ? parent.textContent.trim().split("\n")[0].trim() : el.id;
          badges[label] = el.textContent.trim();
        });
        return {
          loggedIn: true,
          currentPage: document.querySelector(".nav-item.active")?.textContent?.trim() || "dashboard",
          badges,
        };
      });

      return { status: "already_logged_in", ...dashData };
    }

    logger.info("Login screen visible – magic link auth");

    // Check if we should trigger the magic link
    if (params.triggerMagicLink === true) {
      logger.info("Triggering magic link send");

      // The #pw hidden input has value="auth" – doLogin() checks this
      const pwValue = await page.locator("#pw").inputValue().catch(() => null);

      // Click the login button / trigger doLogin()
      await page.evaluate(() => {
        if (typeof doLogin === "function") doLogin();
      });
      await page.waitForTimeout(2000);

      // Check if success message appeared
      const successText = await page.evaluate(() => {
        const els = document.querySelectorAll(".login-card *");
        for (const el of els) {
          if (el.textContent.includes("skickad") || el.textContent.includes("✅")) {
            return el.textContent.trim();
          }
        }
        return null;
      });

      return {
        status: successText ? "magic_link_sent" : "magic_link_attempted",
        message: successText || "Check hello@spick.se for the login link",
        pwFieldValue: pwValue,
        timestamp: new Date().toISOString(),
      };
    }

    // Default: just report the login screen state
    return {
      status: "login_screen_visible",
      message: "Admin requires magic link auth. Set params.triggerMagicLink=true to send link.",
      url: page.url(),
      timestamp: new Date().toISOString(),
    };
  },
};

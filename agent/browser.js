// browser.js – Playwright browser manager (Microsoft Edge)
const { chromium } = require("playwright");
const logger = require("./logger");
const path = require("path");
const fs = require("fs");

class BrowserManager {
  constructor() {
    this.browser = null;
    this.context = null;
  }

  /**
   * Launch Microsoft Edge (or reuse existing instance).
   * Returns a BrowserContext ready for page creation.
   */
  async launch() {
    if (this.browser && this.browser.isConnected()) {
      logger.info("Reusing existing browser instance");
      return this.context;
    }

    const headless = process.env.HEADLESS === "true";
    const timeout = parseInt(process.env.DEFAULT_TIMEOUT_MS, 10) || 30000;

    const launchOptions = {
      channel: "msedge",
      headless,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
      ],
      timeout,
    };

    logger.info("Launching Microsoft Edge", { headless, timeout });
    this.browser = await chromium.launch(launchOptions);

    // Create a persistent-like context
    const contextOptions = {
      viewport: null, // use full window
      locale: "sv-SE",
      timezoneId: "Europe/Stockholm",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    };

    // If a user data dir is specified, use persistent context instead
    if (process.env.EDGE_USER_DATA_DIR) {
      await this.browser.close();
      this.browser = null;
      const persistCtx = await chromium.launchPersistentContext(
        process.env.EDGE_USER_DATA_DIR,
        { ...launchOptions, ...contextOptions }
      );
      this.context = persistCtx;
      this.browser = persistCtx; // persistent context acts as both
      logger.info("Using persistent Edge profile", {
        dir: process.env.EDGE_USER_DATA_DIR,
      });
      return this.context;
    }

    this.context = await this.browser.newContext(contextOptions);
    logger.info("Browser context created");
    return this.context;
  }

  /**
   * Get a fresh page (tab) within the current context.
   * Auto-recovers if browser has crashed.
   */
  async newPage() {
    let retries = 2;
    while (retries > 0) {
      try {
        const ctx = await this.launch();
        const page = await ctx.newPage();
        page.setDefaultTimeout(parseInt(process.env.DEFAULT_TIMEOUT_MS, 10) || 30000);

        // Log browser console errors
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            logger.debug("Browser console error", { text: msg.text() });
          }
        });

        // Auto-dismiss dialogs
        page.on("dialog", async (dialog) => {
          logger.info("Browser dialog dismissed", { type: dialog.type(), message: dialog.message() });
          await dialog.dismiss().catch(() => {});
        });

        return page;
      } catch (err) {
        retries--;
        logger.warn("Failed to create page, retrying...", { error: err.message, retriesLeft: retries });
        // Force close and relaunch
        await this.close();
        if (retries === 0) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  /**
   * Take a screenshot – used for error debugging.
   */
  async screenshot(page, label = "error") {
    if (process.env.SCREENSHOT_ON_ERROR !== "true") return null;

    const dir = path.join(__dirname, "logs", "screenshots");
    fs.mkdirSync(dir, { recursive: true });

    const filename = `${label}_${Date.now()}.png`;
    const filepath = path.join(dir, filename);
    await page.screenshot({ path: filepath, fullPage: true });
    logger.info("Screenshot saved", { filepath });
    return filepath;
  }

  /**
   * Close everything.
   */
  async close() {
    try {
      if (this.context && this.context !== this.browser) {
        await this.context.close();
      }
      if (this.browser) {
        await this.browser.close();
      }
      this.browser = null;
      this.context = null;
      logger.info("Browser closed");
    } catch (err) {
      logger.error("Error closing browser", { error: err.message });
    }
  }
}

// Singleton
module.exports = new BrowserManager();

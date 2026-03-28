// tasks/screenshot-page.js – Screenshot any page and save it
module.exports = {
  name: "screenshot-page",
  description: "Takes a full-page screenshot of a given URL (default: spick.se)",

  async execute(page, { logger, params = {} }) {
    const url = params.url || "https://spick.se";
    const device = params.device || "desktop"; // desktop | mobile

    if (device === "mobile") {
      await page.setViewportSize({ width: 375, height: 812 });
      logger.info("Set viewport to mobile (375x812)");
    }

    logger.info("Navigating", { url });
    await page.goto(url, { waitUntil: "networkidle" });

    const title = await page.title();
    const browser = require("../browser");
    const screenshotPath = await browser.screenshot(page, `manual_${device}`);

    return {
      url,
      title,
      device,
      screenshot: screenshotPath,
      timestamp: new Date().toISOString(),
    };
  },
};

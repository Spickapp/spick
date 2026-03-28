// tasks/open-spick.js – Navigate to spick.se and verify it loaded
module.exports = {
  name: "open-spick",
  description: "Opens spick.se and verifies the homepage loaded correctly",

  async execute(page, { logger }) {
    logger.info("Navigating to spick.se");
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });

    // Wait for the page to be interactive
    await page.waitForLoadState("networkidle");

    const title = await page.title();
    logger.info("Page loaded", { title });

    // Verify key elements exist
    const heroVisible = await page
      .locator("h1, .hero, [class*='hero']")
      .first()
      .isVisible()
      .catch(() => false);

    const url = page.url();

    return {
      url,
      title,
      heroVisible,
      timestamp: new Date().toISOString(),
    };
  },
};

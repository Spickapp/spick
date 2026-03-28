// tasks/test-flow.js – Health check: launch Edge, load a page, screenshot
module.exports = {
  name: "test-flow",
  description: "Quick smoke test – opens Edge, loads spick.se, takes screenshot",

  async execute(page, { logger }) {
    logger.info("Running test flow");

    // Step 1: Go to spick.se
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const title = await page.title();
    const url = page.url();
    logger.info("Page loaded", { title, url });

    // Step 2: Capture basic page info
    const pageInfo = await page.evaluate(() => ({
      title: document.title,
      links: document.querySelectorAll("a").length,
      images: document.querySelectorAll("img").length,
      buttons: document.querySelectorAll("button").length,
      h1: document.querySelector("h1")?.textContent?.trim() || null,
      bodyLength: document.body.innerText.length,
    }));

    // Step 3: Screenshot
    const browser = require("../browser");
    const screenshotPath = await browser.screenshot(page, "test-flow");

    return {
      status: "ok",
      url,
      pageInfo,
      screenshot: screenshotPath,
      timestamp: new Date().toISOString(),
    };
  },
};

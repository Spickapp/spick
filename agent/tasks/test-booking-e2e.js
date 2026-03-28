// tasks/test-booking-e2e.js – End-to-end validation of the booking flow
//
// Unlike start-booking-flow (which automates), this task VALIDATES
// that each step works correctly and reports pass/fail per step.
// Think of it as a QA test runner.

module.exports = {
  name: "test-booking-e2e",
  description: "QA test: validates each booking step works (does not actually book)",

  async execute(page, { logger }) {
    const report = { passed: 0, failed: 0, steps: [] };

    // ── Test 1: Booking page loads ──
    await test(report, "Booking page loads", async () => {
      const res = await page.goto("https://spick.se/boka.html", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      assert(res.status() === 200, `Expected 200, got ${res.status()}`);
      await page.waitForLoadState("networkidle");
      const title = await page.title();
      assert(title.length > 0, "Page title is empty");
      return { status: res.status(), title };
    });

    // ── Test 2: Page has no JS errors ──
    const jsErrors = [];
    page.on("pageerror", (err) => jsErrors.push(err.message));

    await test(report, "No critical JS errors", async () => {
      // Wait a moment for any JS to execute
      await page.waitForTimeout(2000);
      const critical = jsErrors.filter(
        (e) => !e.includes("favicon") && !e.includes("analytics")
      );
      assert(critical.length === 0, `JS errors: ${critical.join("; ")}`);
      return { errorCount: critical.length };
    });

    // ── Test 3: Service selection exists ──
    await test(report, "Service options visible", async () => {
      const serviceElements = await page
        .locator(
          ".service-card, .service-option, [class*='service'], " +
            "[data-step='1'] button, [data-step='service']"
        )
        .count();
      assert(serviceElements > 0, "No service selection elements found");
      return { serviceElements };
    });

    // ── Test 4: Interactive elements work ──
    await test(report, "Buttons are clickable", async () => {
      const buttons = await page.locator("button:visible").count();
      assert(buttons > 0, "No visible buttons found");

      // Try clicking the first non-disabled button
      const firstBtn = page.locator("button:visible:not(:disabled)").first();
      if ((await firstBtn.count()) > 0) {
        const box = await firstBtn.boundingBox();
        assert(box !== null, "Button has no bounding box");
        assert(box.width > 0 && box.height > 0, "Button has zero dimensions");
      }
      return { visibleButtons: buttons };
    });

    // ── Test 5: Mobile viewport works ──
    await test(report, "Mobile responsive", async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForTimeout(500);

      const overflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth > 375;
      });
      assert(!overflow, "Page overflows on mobile viewport");

      // Reset
      await page.setViewportSize({ width: 1280, height: 800 });
      return { mobileOk: true };
    });

    // ── Test 6: No broken images ──
    await test(report, "No broken images", async () => {
      await page.goto("https://spick.se/boka.html", { waitUntil: "networkidle" });
      const brokenImages = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));
        return imgs
          .filter((img) => !img.complete || img.naturalWidth === 0)
          .map((img) => img.src);
      });
      assert(brokenImages.length === 0, `Broken: ${brokenImages.join(", ")}`);
      return { totalImages: await page.locator("img").count(), broken: brokenImages.length };
    });

    // ── Test 7: Key pages return 200 ──
    const keyPages = [
      "https://spick.se",
      "https://spick.se/boka.html",
      "https://spick.se/priser.html",
      "https://spick.se/bli-stadare.html",
    ];

    for (const url of keyPages) {
      const name = url.split("/").pop() || "index";
      await test(report, `${name} returns 200`, async () => {
        const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });
        assert(res.status() === 200, `Got ${res.status()}`);
        return { url, status: res.status() };
      });
    }

    // ── Summary ──
    const passRate = report.steps.length > 0
      ? Math.round((report.passed / report.steps.length) * 100)
      : 0;

    logger.info("E2E test complete", {
      passed: report.passed,
      failed: report.failed,
      passRate: passRate + "%",
    });

    return {
      passed: report.passed,
      failed: report.failed,
      total: report.steps.length,
      passRate: passRate + "%",
      allPassed: report.failed === 0,
      steps: report.steps,
      timestamp: new Date().toISOString(),
    };
  },
};

// ── Helpers ──

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(report, name, fn) {
  try {
    const details = await fn();
    report.passed++;
    report.steps.push({ name, status: "pass", details });
  } catch (err) {
    report.failed++;
    report.steps.push({ name, status: "fail", error: err.message });
  }
}

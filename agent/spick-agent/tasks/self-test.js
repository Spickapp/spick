// tasks/self-test.js – Comprehensive self-diagnostic
//
// Checks: Edge launch, page navigation, JS execution, screenshot,
// Supabase connectivity, all form selectors, API responsiveness.

const fs = require("fs");
const path = require("path");

module.exports = {
  name: "self-test",
  description: "Full system self-test – browser, navigation, selectors, connectivity",

  async execute(page, { logger }) {
    const results = [];
    const t = (name) => ({ name, start: Date.now() });
    const pass = (test, detail) => {
      results.push({ ...test, ok: true, ms: Date.now() - test.start, detail });
    };
    const fail = (test, error) => {
      results.push({ ...test, ok: false, ms: Date.now() - test.start, error });
    };

    // ─── 1. Browser + Page creation ───
    let test = t("browser_launch");
    try {
      const title = await page.title();
      pass(test, "Page created, title: " + (title || "about:blank"));
    } catch (e) { fail(test, e.message); }

    // ─── 2. Navigate to spick.se ───
    test = t("navigate_spick");
    try {
      const resp = await page.goto("https://spick.se", { waitUntil: "domcontentloaded", timeout: 15000 });
      const status = resp?.status() || 0;
      if (status >= 200 && status < 400) pass(test, "Status: " + status);
      else fail(test, "HTTP " + status);
    } catch (e) { fail(test, e.message); }

    // ─── 3. JavaScript execution ───
    test = t("js_execution");
    try {
      const result = await page.evaluate(() => {
        return { calc: 2 + 2, hasDocument: typeof document !== "undefined" };
      });
      if (result.calc === 4) pass(test, "JS OK");
      else fail(test, "Unexpected result: " + JSON.stringify(result));
    } catch (e) { fail(test, e.message); }

    // ─── 4. DOM selectors (homepage) ───
    test = t("homepage_selectors");
    try {
      const checks = await page.evaluate(() => ({
        hasH1: !!document.querySelector("h1"),
        hasNav: !!document.querySelector("nav, .nav, header"),
        hasLinks: document.querySelectorAll("a").length,
        hasImages: document.querySelectorAll("img").length,
        bodyLength: document.body.innerText.length,
      }));
      pass(test, `h1:${checks.hasH1} nav:${checks.hasNav} links:${checks.hasLinks} images:${checks.hasImages}`);
    } catch (e) { fail(test, e.message); }

    // ─── 5. Booking page selectors ───
    test = t("booking_selectors");
    try {
      await page.goto("https://spick.se/boka.html", { waitUntil: "domcontentloaded", timeout: 15000 });
      const selectors = await page.evaluate(() => {
        const has = (sel) => !!document.querySelector(sel);
        return {
          svcButtons: document.querySelectorAll(".svc-btn").length,
          sqmInput: has("#sqm"),
          step1: has("#step1"),
          step2: has("#step2"),
          step3: has("#step3"),
          step4: has("#step4"),
          step1Next: has("#step1-next"),
          payBtn: has("#pay-btn"),
          dateInput: has("#date"),
          timeInput: has("#time"),
        };
      });
      const criticalOk = selectors.svcButtons >= 2 && selectors.step1 && selectors.payBtn;
      if (criticalOk) pass(test, `svc:${selectors.svcButtons} steps:4 payBtn:${selectors.payBtn}`);
      else fail(test, "Missing critical selectors: " + JSON.stringify(selectors));
    } catch (e) { fail(test, e.message); }

    // ─── 6. Cleaner signup selectors ───
    test = t("signup_selectors");
    try {
      await page.goto("https://spick.se/bli-stadare.html", { waitUntil: "domcontentloaded", timeout: 15000 });
      const selectors = await page.evaluate(() => {
        const has = (sel) => !!document.querySelector(sel);
        return {
          fn: has("#fn"), ln: has("#ln"), em: has("#em"), ph: has("#ph"),
          city: has("#city"), exp: has("#exp"), form: has("#form"),
          nextBtn: document.querySelectorAll(".next-btn").length,
          langBtns: document.querySelectorAll(".lp").length,
        };
      });
      const allFields = selectors.fn && selectors.ln && selectors.em && selectors.ph;
      if (allFields) pass(test, `fields:OK form:${selectors.form} langs:${selectors.langBtns}`);
      else fail(test, "Missing fields: " + JSON.stringify(selectors));
    } catch (e) { fail(test, e.message); }

    // ─── 7. Screenshot capability ───
    test = t("screenshot");
    try {
      const browser = require("../browser");
      const filepath = await browser.screenshot(page, "self-test");
      if (filepath && fs.existsSync(filepath)) pass(test, filepath);
      else pass(test, "Screenshot disabled or skipped");
    } catch (e) { fail(test, e.message); }

    // ─── 8. Supabase connectivity ───
    test = t("supabase_connectivity");
    try {
      await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });
      const result = await page.evaluate(async () => {
        try {
          const res = await fetch("https://urjeijcncsyuletprydy.supabase.co/rest/v1/", {
            method: "HEAD",
          });
          return { reachable: true, status: res.status };
        } catch (e) {
          return { reachable: false, error: e.message };
        }
      });
      if (result.reachable) pass(test, "Status: " + result.status);
      else fail(test, result.error);
    } catch (e) { fail(test, e.message); }

    // ─── 9. Task registry ───
    test = t("task_registry");
    try {
      const taskDir = path.join(__dirname);
      const files = fs.readdirSync(taskDir).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
      let loadable = 0;
      for (const f of files) {
        try {
          const mod = require("./" + f);
          if (typeof mod.execute === "function") loadable++;
        } catch {}
      }
      pass(test, `${loadable}/${files.length} tasks loadable`);
    } catch (e) { fail(test, e.message); }

    // ─── Summary ───
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const totalMs = results.reduce((s, r) => s + r.ms, 0);

    logger.info("Self-test complete", { passed, failed, totalMs });

    return {
      status: failed === 0 ? "all_pass" : "has_failures",
      passed,
      failed,
      total: results.length,
      totalMs,
      tests: results,
      timestamp: new Date().toISOString(),
    };
  },
};

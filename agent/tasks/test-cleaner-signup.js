// tasks/test-cleaner-signup.js – Test bli-stadare.html signup with REAL selectors
//
// Real fields from bli-stadare.html:
//   Step 1: #fn (förnamn), #ln (efternamn), #em (email), #ph (phone), #city (select), #exp (select)
//   Step 2: Service buttons (.sv), #langs, #bio (textarea)
//   Navigation: goStep(2) button with class .next-btn
//   Multi-language: setLang('sv'), setLang('ar'), etc.

module.exports = {
  name: "test-cleaner-signup",
  description: "Tests the cleaner signup form on bli-stadare.html (dry run, never submits)",

  async execute(page, { logger }) {
    logger.info("Navigating to cleaner signup page");
    await page.goto("https://spick.se/bli-stadare.html", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    const title = await page.title();
    logger.info("Page loaded", { title });

    const results = { fields: [], steps: [] };

    // ─── Check Step 1 fields ───
    logger.info("Checking step 1 fields");
    const step1Fields = [
      { id: "fn", label: "Förnamn", testValue: "Test" },
      { id: "ln", label: "Efternamn", testValue: "Städare" },
      { id: "em", label: "E-post", testValue: "test@example.com" },
      { id: "ph", label: "Telefon", testValue: "0701234567" },
    ];

    for (const field of step1Fields) {
      const el = page.locator("#" + field.id);
      const visible = await el.isVisible().catch(() => false);
      if (visible) {
        await el.fill(field.testValue);
        results.fields.push({ id: field.id, label: field.label, found: true, filled: true });
      } else {
        results.fields.push({ id: field.id, label: field.label, found: false });
      }
    }

    // ─── Check dropdowns ───
    const citySelect = page.locator("#city");
    if (await citySelect.isVisible().catch(() => false)) {
      const options = await citySelect.locator("option").count();
      results.fields.push({ id: "city", label: "Stad", found: true, type: "select", options });
      if (options > 1) {
        await citySelect.selectOption({ index: 1 }); // Select first city
      }
    } else {
      results.fields.push({ id: "city", label: "Stad", found: false });
    }

    const expSelect = page.locator("#exp");
    if (await expSelect.isVisible().catch(() => false)) {
      const options = await expSelect.locator("option").count();
      results.fields.push({ id: "exp", label: "Erfarenhet", found: true, type: "select", options });
    } else {
      results.fields.push({ id: "exp", label: "Erfarenhet", found: false });
    }

    // ─── Try clicking Nästa to go to step 2 ───
    logger.info("Attempting step 2 navigation");
    const nextBtn = page.locator(".next-btn").first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
      results.steps.push({ action: "click_next", ok: true });

      // ─── Check Step 2 fields ───
      logger.info("Checking step 2 fields");

      // Service buttons
      const svcBtns = await page.locator(".sv").count();
      results.fields.push({ id: "services", label: "Tjänster (knappar)", found: svcBtns > 0, count: svcBtns });

      // Click first service
      if (svcBtns > 0) {
        await page.locator(".sv").first().click();
        await page.waitForTimeout(200);
      }

      // Languages field
      const langsInput = page.locator("#langs");
      if (await langsInput.isVisible().catch(() => false)) {
        await langsInput.fill("arabiska, engelska");
        results.fields.push({ id: "langs", label: "Språk", found: true, filled: true });
      }

      // Bio textarea
      const bioInput = page.locator("#bio");
      if (await bioInput.isVisible().catch(() => false)) {
        results.fields.push({ id: "bio", label: "Om dig", found: true });
      }
    } else {
      results.steps.push({ action: "click_next", ok: false, reason: "next button not found" });
    }

    // ─── Check language switcher ───
    const langBtns = await page.locator(".lp").count();
    results.languageSwitcher = { found: langBtns > 0, languages: langBtns };

    // ─── Summary ───
    const foundCount = results.fields.filter((f) => f.found).length;
    const totalFields = results.fields.length;

    // Check for form element
    const formId = await page.locator("#form").isVisible().catch(() => false);

    logger.info("Signup form test complete", { fieldsFound: foundCount + "/" + totalFields });

    return {
      url: "https://spick.se/bli-stadare.html",
      pageTitle: title,
      formPresent: formId,
      fieldsFound: foundCount,
      totalChecked: totalFields,
      fields: results.fields,
      steps: results.steps,
      languageSwitcher: results.languageSwitcher,
      timestamp: new Date().toISOString(),
    };
  },
};

// tasks/start-booking-flow.js – Automate spick.se/boka.html with REAL selectors
//
// Real flow from boka.html:
//   Step 1: Select service (.svc-btn) → set sqm (#sqm) → pick date/time → #step1-next
//   Step 2: Select cleaner (cleaner cards rendered dynamically)
//   Step 3: Fill customer info (#fname, #lname, #email, #phone, #address, #pnr)
//   Step 4: Review & pay (#pay-btn) ← WE STOP HERE
//
// SAFETY: This task NEVER clicks #pay-btn (doBook). It stops at step 4.

module.exports = {
  name: "start-booking-flow",
  description: "Runs through the spick.se booking flow step by step (stops before payment)",

  async execute(page, { logger, params = {} }) {
    const results = { steps: [] };

    // ─── STEP 1: Navigate to booking page ───
    logger.info("Step 1: Navigating to boka.html");
    await page.goto("https://spick.se/boka.html", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    results.steps.push({ step: 1, action: "navigate", url: page.url(), ok: true });

    // ─── STEP 2: Select service ───
    logger.info("Step 2: Selecting service");
    const service = params.service || "Hemstädning";
    try {
      await page.click(`.svc-btn[data-svc="${service}"]`);
      await page.waitForTimeout(400);
      results.steps.push({ step: 2, action: "select_service", service, ok: true });
    } catch (err) {
      // Fallback: click first service button
      await page.click(".svc-btn").catch(() => {});
      results.steps.push({ step: 2, action: "select_service", service, ok: false, fallback: true });
    }

    // ─── STEP 3: Set apartment size ───
    logger.info("Step 3: Setting apartment size");
    const sqm = params.sqm || "65";
    try {
      const sqmInput = page.locator("#sqm");
      if (await sqmInput.isVisible()) {
        await sqmInput.fill("");
        await sqmInput.fill(sqm);
        // Trigger input event for price calculation
        await sqmInput.dispatchEvent("input");
        await page.waitForTimeout(300);
      }
      results.steps.push({ step: 3, action: "set_sqm", sqm, ok: true });
    } catch {
      results.steps.push({ step: 3, action: "set_sqm", ok: false });
    }

    // ─── STEP 4: Select date and time ───
    logger.info("Step 4: Selecting date/time");
    try {
      // Click first available date card
      const dateCard = page.locator(".date-card:not(.disabled), .tl-card:not(.disabled)").first();
      if (await dateCard.isVisible().catch(() => false)) {
        await dateCard.click();
        await page.waitForTimeout(500);
      }

      // Check if date and time hidden inputs have values
      const dateVal = await page.locator("#date").inputValue().catch(() => "");
      const timeVal = await page.locator("#time").inputValue().catch(() => "");
      results.steps.push({ step: 4, action: "select_datetime", date: dateVal, time: timeVal, ok: !!(dateVal || timeVal) });
    } catch {
      results.steps.push({ step: 4, action: "select_datetime", ok: false });
    }

    // ─── STEP 5: Click "Nästa" to go to step 2 (cleaners) ───
    logger.info("Step 5: Proceeding to cleaner selection");
    try {
      await page.click("#step1-next");
      await page.waitForTimeout(1500); // Wait for cleaners to load
      
      // Check if step2 is now visible
      const step2Visible = await page.locator("#step2.active, #step2").first().isVisible().catch(() => false);
      results.steps.push({ step: 5, action: "go_step2", ok: step2Visible });
    } catch (err) {
      results.steps.push({ step: 5, action: "go_step2", ok: false, error: err.message });
    }

    // ─── STEP 6: Select first cleaner ───
    logger.info("Step 6: Selecting cleaner");
    try {
      await page.waitForSelector(".cleaner-card, #cleaners-wrap .card", { timeout: 10000 });
      const cleanerCard = page.locator(".cleaner-card, #cleaners-wrap .card").first();
      
      if (await cleanerCard.isVisible()) {
        await cleanerCard.click();
        await page.waitForTimeout(800);
        
        // Check if step 3 appeared
        const step3Visible = await page.locator("#step3").first().isVisible().catch(() => false);
        
        // Get cleaner name if visible
        const cleanerName = await cleanerCard.locator(".cleaner-name, .card-name, strong").first().textContent().catch(() => "unknown");
        results.steps.push({ step: 6, action: "select_cleaner", cleaner: cleanerName.trim(), advancedToStep3: step3Visible, ok: true });
      } else {
        results.steps.push({ step: 6, action: "select_cleaner", ok: false, reason: "no cleaners visible" });
      }
    } catch (err) {
      results.steps.push({ step: 6, action: "select_cleaner", ok: false, error: err.message });
    }

    // ─── STEP 7: Fill customer info (test data) ───
    logger.info("Step 7: Filling customer info");
    const testData = {
      fname: params.fname || "Test",
      lname: params.lname || "Testsson",
      email: params.email || "test@example.com",
      phone: params.phone || "0701234567",
      address: params.address || "Kungsgatan 10, Stockholm",
    };

    try {
      const filled = {};
      for (const [id, value] of Object.entries(testData)) {
        const input = page.locator("#" + id);
        if (await input.isVisible().catch(() => false)) {
          await input.fill(value);
          filled[id] = true;
        } else {
          filled[id] = false;
        }
      }
      results.steps.push({ step: 7, action: "fill_customer_info", filled, ok: Object.values(filled).some(v => v) });
    } catch (err) {
      results.steps.push({ step: 7, action: "fill_customer_info", ok: false, error: err.message });
    }

    // ─── STEP 8: Capture summary (DO NOT pay) ───
    logger.info("Step 8: Capturing current state");
    const pageState = await page.evaluate(() => {
      const get = (id) => { const el = document.getElementById(id); return el ? (el.value || el.textContent || "").trim() : null; };
      return {
        currentStep: document.querySelector(".step-panel.active")?.id || "unknown",
        service: get("booking-freq") ? "set" : null,
        date: get("date"),
        time: get("time"),
        fname: get("fname"),
        email: get("email"),
        address: get("address"),
        payButtonVisible: !!document.querySelector("#pay-btn") && document.getElementById("step4")?.classList.contains("active"),
      };
    });

    results.steps.push({ step: 8, action: "capture_state", state: pageState, ok: true });
    results.summary = pageState;
    results.stoppedBeforePayment = true;

    logger.info("Booking flow completed – stopped before payment");
    return results;
  },
};

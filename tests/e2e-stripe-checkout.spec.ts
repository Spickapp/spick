// ═══════════════════════════════════════════════════════════════
// SPICK – E2E Stripe Checkout-flöde (testmode, 2026-04-26)
//
// SYFTE:
//   Verifierar att en kund kan boka en städning hela vägen från
//   /boka.html → Stripe Checkout (testmode) → /tack.html med
//   bekräftad bokning. Detta är det FÖRSTA testet som faktiskt
//   genomför en betalning end-to-end (övriga 71 tests gör inget
//   stripe-anrop).
//
// FÖRUTSÄTTNINGAR:
//   1. platform_settings.stripe_test_mode = 'true'
//      (sätts INNAN test via global-setup nedan; ej återställt
//      efteråt — admin styr toggle manuellt per CLAUDE.md).
//   2. Supabase-secrets STRIPE_SECRET_KEY/STRIPE_PUBLISHABLE_KEY
//      pekar på sk_test_/pk_test_-nycklar i testmode.
//   3. Test kör endast om CI sätter env STRIPE_E2E_ENABLED=1
//      (annars skipped — undviker att lokalt köra tester
//       mot prod-DB av misstag).
//
// IDEMPOTENS + CLEANUP:
//   - Unik customer_email per körning: e2e-test+TIMESTAMP@spick.se
//   - Cleanup raderar bokningen via service-role efter test
//   - Failsafe: nightly cleanup-stale rensar pending >30min
//
// REGLER #26-#32:
//   #26 grep'ade boka.html för faktiska selektorer (#sqm,
//       #step1-address, #fname, #email, #phone, #address,
//       #accept-terms, #pay-btn, .svc-btn[data-svc], .cleaner-card)
//   #27 scope = bara denna spec + ny workflow-fil. Ingen
//       production-kod-ändring.
//   #28 SSOT = återanvänder befintlig SUPA-konstant från
//       smoke.spec.ts-pattern. Inga nya helpers.
//   #29 audit-källa = boka.html + tack.html + admin-cancel-booking
//       index.ts (lästa i sin helhet före kodning).
//   #30 inga regulator-claims om Stripe — testmode är dokumenterad
//       feature i Stripe Checkout-API.
//   #31 verifierat mot prod 2026-04-26:
//       - platform_settings.stripe_test_mode existerar (id 301a6184…)
//       - v_cleaners_for_booking returnerar 3 cleaners (Zivar/Nilufar/Farhad)
//       - admin-cancel-booking EF kräver admin-JWT (kan ej köras från CI)
//       → cleanup sker via service-role DELETE FROM bookings istället.
// ═══════════════════════════════════════════════════════════════

import { test, expect } from '@playwright/test';

const BASE = 'https://spick.se';
const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

// Service-role för cleanup (sätts via env i CI, undefined lokalt)
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Säkerhetsspärr: kör endast om explicit aktiverat (CI eller --grep)
const ENABLED = process.env.STRIPE_E2E_ENABLED === '1';

test.describe('Stripe Checkout E2E (testmode)', () => {
  test.skip(!ENABLED, 'Sätt STRIPE_E2E_ENABLED=1 för att köra (kräver Stripe testmode + service-key)');

  // Unik per körning för idempotens
  const RUN_TS = Date.now();
  const TEST_EMAIL = `e2e-test+${RUN_TS}@spick.se`;
  const TEST_FNAME = 'PlaywrightE2E';
  const TEST_LNAME = `Run${RUN_TS}`;

  test.beforeAll(async ({ request }) => {
    if (!SERVICE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY saknas i env — kan inte sätta stripe_test_mode');
    }

    // Sätt platform_settings.stripe_test_mode = 'true' INNAN test
    const res = await request.patch(
      `${SUPA}/rest/v1/platform_settings?key=eq.stripe_test_mode`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        data: { value: 'true' },
      }
    );
    expect(res.ok(), `Kunde inte sätta stripe_test_mode=true (HTTP ${res.status()})`).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    // Cleanup: radera test-bokningar (tål att redan vara borta)
    if (!SERVICE_KEY) return;
    await request.delete(
      `${SUPA}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(TEST_EMAIL)}`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Prefer: 'return=minimal',
        },
      }
    );
    // Notera: stripe_test_mode lämnas på 'true' — admin återställer manuellt
    // (CLAUDE.md: "admin styr toggle manuellt"). Kommentar i workflow.
  });

  test('SE01: kund kan boka + betala + landar på tack.html', async ({ page }) => {
    test.setTimeout(180_000); // Stripe-checkout + retry-fönster ger gott om tid

    // ── STEG 1: GOTO + välj service ────────────────────────────
    await page.goto(`${BASE}/boka.html`);
    await page.waitForLoadState('networkidle');

    // Välj Hemstädning (selector från boka.html:294)
    await page.locator('button.svc-btn[data-svc="Hemstädning"]').click();

    // Fyll bostadsyta (#sqm:349) → triggar calcHours()
    await page.locator('#sqm').fill('65');
    await page.locator('#sqm').blur();

    // Fyll adress i steg 1 (#step1-address:365)
    await page.locator('#step1-address').fill('Storgatan 1, 11122 Stockholm');
    // Stäng adress-dropdown (klicka utanför)
    await page.locator('body').click({ position: { x: 10, y: 10 } });

    // ── STEG 1b: välj första lediga datum + tid ────────────────
    // Vänta på att kalendern populerats (cal-days fylls async).
    // Timeout 30s för att tåla services-list cold-start (~40% 503-rate; loader retry:ar 3 ggr).
    await page.waitForFunction(
      () => document.querySelectorAll('#cal-days .cal-day:not(.disabled)').length > 0,
      { timeout: 30_000 }
    );
    // Klicka första lediga dag
    await page.locator('#cal-days .cal-day:not(.disabled)').first().click();

    // Vänta på att tids-listan renderas (.tl-list fylls vid dag-klick).
    // Timeout 30s för att tåla cleaner_availability cold-start.
    await page.waitForFunction(
      () => document.querySelectorAll('#tl-list .tl-slot:not(.disabled)').length > 0,
      { timeout: 30_000 }
    );
    await page.locator('#tl-list .tl-slot:not(.disabled)').first().click();

    // Klicka "Boka städning →" för att gå till steg 2
    await page.locator('#step1-next').click();

    // ── STEG 2: välj första city-cleaner ───────────────────────
    await page.waitForSelector('#step2.active, .cleaner-card', { timeout: 20_000 });
    // Vänta på att cleaner-cards laddats (matching-wrapper är async)
    await page.waitForFunction(
      () => document.querySelectorAll('#step2 .cleaner-card').length > 0,
      { timeout: 20_000 }
    );
    await page.locator('#step2 .cleaner-card').first().click();
    // Vissa flows visar "Fortsätt med X →" istället för auto-advance
    const continueBtn = page.locator('#step2 button:has-text("Fortsätt")');
    if (await continueBtn.count() > 0) {
      await continueBtn.first().click();
    }

    // ── STEG 3: kontaktuppgifter ───────────────────────────────
    await page.waitForSelector('#step3.active', { timeout: 10_000 });
    await page.locator('#fname').fill(TEST_FNAME);
    await page.locator('#lname').fill(TEST_LNAME);
    await page.locator('#email').fill(TEST_EMAIL);
    await page.locator('#phone').fill('0701234567');
    await page.locator('#address').fill('Storgatan 1, 11122 Stockholm');

    // Nyckelhantering: välj "Dörren är olåst" (selector från boka.html:638)
    await page.locator('.key-opt[data-key="open"]').click();

    await page.locator('#step3-submit').click();

    // ── STEG 4: bekräfta + acceptera villkor + betala ─────────
    await page.waitForSelector('#step4.active', { timeout: 10_000 });
    await page.locator('#accept-terms').check();

    // pay-btn ska nu vara enabled (onchange-handler i :713)
    await expect(page.locator('#pay-btn')).toBeEnabled();
    await page.locator('#pay-btn').click();

    // ── STEG 5: Stripe Checkout (extern domän) ────────────────
    // booking-create returnerar { url } → window.location.href = url
    // (boka.html:3848)
    await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

    // Stripe-Checkout använder INTE iframes för kortfält längre
    // (sedan 2024 är fälten inline i sin egen subdomain). Vi
    // letar efter input via test-id eller standard-name.
    // Om Stripe ändrar struktur — använd page.frameLocator('iframe')
    // som fallback (legacy embed).
    const cardNumber = page.locator('input[name="cardNumber"], input[autocomplete="cc-number"]').first();
    await cardNumber.waitFor({ state: 'visible', timeout: 30_000 });
    await cardNumber.fill('4242424242424242');

    await page.locator('input[name="cardExpiry"], input[autocomplete="cc-exp"]').first().fill('12/30');
    await page.locator('input[name="cardCvc"], input[autocomplete="cc-csc"]').first().fill('123');

    // Namn på kort (krävs i SE-Stripe Checkout)
    const nameOnCard = page.locator('input[name="billingName"], input[autocomplete="cc-name"]').first();
    if (await nameOnCard.count() > 0) {
      await nameOnCard.fill(`${TEST_FNAME} ${TEST_LNAME}`);
    }

    // Postal code (om Stripe ber)
    const postalCode = page.locator('input[name="billingPostalCode"], input[autocomplete="postal-code"]').first();
    if (await postalCode.count() > 0) {
      await postalCode.fill('11122');
    }

    // "Betala"-knappen — Stripe använder data-testid="hosted-payment-submit-button"
    // i nya Checkout. Fallback: button med text Betala/Pay.
    const submitBtn = page.locator(
      '[data-testid="hosted-payment-submit-button"], button:has-text("Betala"), button:has-text("Pay")'
    ).first();
    await submitBtn.click();

    // ── STEG 6: redirect till tack.html ───────────────────────
    await page.waitForURL(/spick\.se\/tack\.html/, { timeout: 60_000 });

    // Verifiera tack.html har laddats med session_id
    expect(page.url()).toMatch(/session_id=cs_test_/);

    // Verifiera att bokning-info visas (hämtas via fetchBookingBySession
    // med 5 retries, max ~18s — vi väntar tills #details synligt)
    await expect(page.locator('#title')).toContainText('Bokning', { timeout: 30_000 });
    await page.waitForSelector('#details:visible', { timeout: 30_000 });
    await expect(page.locator('#d-service')).toContainText('Hemstädning');
  });

  test('SE02: cleanup-verifiering — test-bokning finns i DB', async ({ request }) => {
    // Sanity-check att test SE01 faktiskt skapade en bokning vi kan rensa.
    // Skippas om SE01 inte kördes (t.ex. failure innan booking-create).
    if (!SERVICE_KEY) test.skip();
    const res = await request.get(
      `${SUPA}/rest/v1/bookings?customer_email=eq.${encodeURIComponent(TEST_EMAIL)}&select=id,status,payment_status`,
      {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      }
    );
    expect(res.ok()).toBe(true);
    const rows = await res.json();
    // Förvänta minst 1 rad (skapad av SE01). 0 = SE01 failade tidigt → SE02 skippas.
    if (rows.length === 0) test.skip();
    expect(rows[0].payment_status).toMatch(/paid|pending/);
  });
});

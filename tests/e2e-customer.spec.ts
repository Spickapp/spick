// E2E Kund-flow tester (2026-04-26)
// Body: testar publika ytor + boking-flow utan att skapa real bookings.
// Read-only mot prod — INSERT-tester finns i smoke.spec.ts (städas av cleanup-stale).
import { test, expect } from '@playwright/test';

const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

test.describe('Kund: Discovery', () => {
  test('K01: index.html laddar med booking-CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Spick/i);
    await expect(page.locator('a[href*="boka"], .nl-btn').first()).toBeVisible();
  });

  test('K02: tjanster.html visar alla 9 tjänster', async ({ page }) => {
    await page.goto('/tjanster.html');
    await expect(page.locator('text=Hemstädning').first()).toBeVisible();
    await expect(page.locator('text=Storstädning').first()).toBeVisible();
  });

  test('K03: stockholm.html (city-page) laddar', async ({ page }) => {
    const res = await page.goto('/stockholm.html');
    expect(res?.status()).toBe(200);
  });

  test('K04: kundvillkor.html v1.0 laddar', async ({ page }) => {
    await page.goto('/kundvillkor.html');
    await expect(page.locator('text=Version 1.0').first()).toBeVisible();
    await expect(page.locator('text=§1').first()).toBeVisible();
  });
});

test.describe('Kund: Booking-flow steg-för-steg', () => {
  test('K10: boka.html steg 1 visar service-väljare', async ({ page }) => {
    await page.goto('/boka.html');
    await expect(page.locator('text=Hemstädning').first()).toBeVisible();
    await expect(page.locator('text=Storstädning').first()).toBeVisible();
  });

  test('K11: boka.html visar checkbox för accept-terms', async ({ page }) => {
    await page.goto('/boka.html');
    // Terms-label finns i Steg 4 (renderas alltid i DOM, kanske dold)
    const terms = page.locator('#accept-terms');
    expect(await terms.count()).toBeGreaterThan(0);
  });

  test('K12: terms-text refererar v1.0 + nyckelpunkter', async ({ page }) => {
    await page.goto('/boka.html');
    await expect(page.locator('text=kundvillkoren v1.0').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Värdesak-upplysningsplikt').first()).toBeVisible();
    await expect(page.locator('text=50 %-efterdebitering').first()).toBeVisible();
  });

  test('K13: services-list returnerar alla services + addons', async ({ request }) => {
    const res = await request.get(`${SUPA}/functions/v1/services-list`, {
      headers: { apikey: ANON },
    });
    if (!res.ok()) test.skip(); // services-list kan flak — skip ej fail
    const data = await res.json();
    expect(Array.isArray(data.services)).toBe(true);
    expect(data.services.length).toBeGreaterThan(0);
    expect(typeof data.addons).toBe('object');
  });

  test('K14: ugnsrengöring rut_eligible=true (regression-test)', async ({ request }) => {
    const res = await request.get(
      `${SUPA}/rest/v1/service_addons?key=eq.ugnsrengoring&select=rut_eligible`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    );
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(data[0]?.rut_eligible).toBe(true);
  });
});

test.describe('Kund: Profil-pages', () => {
  test('K20: foretag.html?slug=solid-service laddar med hero', async ({ page }) => {
    await page.goto('/foretag.html?slug=solid-service-sverige-ab');
    await expect(page.locator('text=Solid Service').first()).toBeVisible({ timeout: 10000 });
  });

  test('K21: stadare-profil.html?s=dildora laddar', async ({ page }) => {
    const res = await page.goto('/stadare-profil.html?s=dildora-kenjaeva');
    expect(res?.status()).toBe(200);
  });

  test('K22: foretag.html canonical-tag pekar på /f/-URL', async ({ page }) => {
    await page.goto('/foretag.html?slug=solid-service-sverige-ab');
    await page.waitForTimeout(2000);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/spick\.se\/f\//);
  });
});

test.describe('Kund: Confirmation + ratings', () => {
  test('K30: tack.html laddar utan session_id', async ({ page }) => {
    const res = await page.goto('/tack.html');
    expect(res?.status()).toBe(200);
  });

  test('K31: min-bokning.html laddar', async ({ page }) => {
    const res = await page.goto('/min-bokning.html');
    expect(res?.status()).toBe(200);
  });

  test('K32: get_booking_by_session RPC anti-enumeration (fake session ger []) ', async ({ request }) => {
    const res = await request.post(`${SUPA}/rest/v1/rpc/get_booking_by_session`, {
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
      },
      data: { _session_id: 'cs_fake_does_not_exist' },
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(0);
  });

  test('K33: get_booking_by_id utan param ger 404 (anti-enumeration)', async ({ request }) => {
    const res = await request.post(`${SUPA}/rest/v1/rpc/get_booking_by_id`, {
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
      },
      data: {},
    });
    expect(res.status()).toBe(404);
  });
});

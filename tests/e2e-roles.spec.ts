// E2E Roller (Cleaner/VD/Admin) — publika ytor + login-ladningstester
// Auth-flöden testas EJ (kräver test-konto). Här verifierar vi att UI laddas + ej kraschar.
import { test, expect } from '@playwright/test';

const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

test.describe('Cleaner: Onboarding-publika ytor', () => {
  test('CL01: bli-stadare.html laddar med CTA', async ({ page }) => {
    await page.goto('/bli-stadare.html');
    await expect(page.locator('a[href*="registrera-stadare"], a[href*="register"]').first()).toBeVisible();
  });

  test('CL02: registrera-stadare.html visar form', async ({ page }) => {
    await page.goto('/registrera-stadare.html');
    await expect(page.locator('input').first()).toBeVisible({ timeout: 10000 });
  });

  test('CL03: stadare-dashboard.html visar login-form', async ({ page }) => {
    await page.goto('/stadare-dashboard.html');
    await expect(page.locator('#login-btn, input[type="email"], .login-tagline').first()).toBeVisible({ timeout: 10000 });
  });

  test('CL04: villkor-stadare.html laddar', async ({ page }) => {
    const res = await page.goto('/villkor-stadare.html');
    expect(res?.status()).toBe(200);
  });
});

test.describe('VD: Onboarding-publika ytor', () => {
  test('VD01: bli-foretag.html laddar med CTA', async ({ page }) => {
    await page.goto('/bli-foretag.html');
    await expect(page.locator('a[href*="registrera-foretag"]').first()).toBeVisible();
  });

  test('VD02: registrera-foretag.html visar multi-step-form', async ({ page }) => {
    await page.goto('/registrera-foretag.html');
    await expect(page.locator('input').first()).toBeVisible({ timeout: 10000 });
  });

  test('VD03: VD-Sentry-toggle döljt om ej tic_enabled+company_bankid_enabled', async ({ page }) => {
    await page.goto('/registrera-foretag.html');
    await page.waitForTimeout(2000);
    const wrapVisible = await page.locator('#company-bankid-wrap').isVisible().catch(() => false);
    expect(wrapVisible).toBe(false);
  });
});

test.describe('Admin: Login + skyddade routes', () => {
  test('A01: admin.html visar login-form', async ({ page }) => {
    await page.goto('/admin.html');
    await expect(page.locator('input[type="email"], input[type="text"]').first()).toBeVisible();
  });

  test('A02: admin-pnr-verifiering.html laddar (gatas via JS)', async ({ page }) => {
    const res = await page.goto('/admin-pnr-verifiering.html');
    expect(res?.status()).toBe(200);
  });

  test('A03: admin-chargebacks.html laddar', async ({ page }) => {
    const res = await page.goto('/admin-chargebacks.html');
    expect(res?.status()).toBe(200);
  });

  test('A04: admin-matching.html laddar', async ({ page }) => {
    const res = await page.goto('/admin-matching.html');
    expect(res?.status()).toBe(200);
  });
});

test.describe('Health-check', () => {
  test('H01: health-EF rapporterar status (healthy/degraded/ok)', async ({ request }) => {
    const res = await request.post(`${SUPA}/functions/v1/health`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.ok()).toBe(true);
    const data = await res.json();
    // health/index.ts:136 returnerar 'healthy' | 'degraded' | 'down' — test
    // var inte i sync med EF:n. 'ok' behålls för bakåtkompatibilitet.
    expect(['healthy', 'ok', 'degraded']).toContain(data.status);
  });

  test('H02: auto_remind cron senast körd inom 24h', async ({ request }) => {
    const res = await request.post(`${SUPA}/functions/v1/health`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    const data = await res.json();
    const ar = data.checks?.auto_remind;
    if (ar?.minutes_since_last_run !== undefined) {
      expect(ar.minutes_since_last_run).toBeLessThan(24 * 60);
    }
  });
});

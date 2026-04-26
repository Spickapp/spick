// E2E Security-regression tester (2026-04-26)
// Säkerställer att audit-fixarna från 2026-04-26 INTE regredieras.
import { test, expect } from '@playwright/test';

const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

test.describe('Security: PII-läckage stängd', () => {
  test('SEC01: booking_confirmation REVOKE från anon (var 200+52 PII-rader)', async ({ request }) => {
    const res = await request.get(`${SUPA}/rest/v1/booking_confirmation?limit=5`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    expect(res.status()).toBe(401);
  });

  test('SEC02: v_customer_bookings REVOKE från anon', async ({ request }) => {
    const res = await request.get(`${SUPA}/rest/v1/v_customer_bookings?limit=5`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    expect(res.status()).toBe(401);
  });

  test('SEC03: calendar_events REVOKE (cleaner-adresser läckte)', async ({ request }) => {
    const res = await request.get(`${SUPA}/rest/v1/calendar_events?limit=5`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('Security: Cron-EFs auth-skyddade', () => {
  for (const ef of ['cleanup-stale', 'auto-remind', 'auto-rebook', 'charge-subscription-booking']) {
    test(`SEC04-${ef}: ${ef} kräver auth (utan = 401)`, async ({ request }) => {
      const res = await request.post(`${SUPA}/functions/v1/${ef}`, {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      expect(res.status()).toBe(401);
    });
  }
});

test.describe('Security: HTTP-headers via Cloudflare', () => {
  test('SEC05: Strict-Transport-Security finns', async ({ request }) => {
    const res = await request.get('https://spick.se');
    expect(res.headers()['strict-transport-security']).toMatch(/max-age=\d+/);
  });

  test('SEC06: X-Frame-Options DENY', async ({ request }) => {
    const res = await request.get('https://spick.se');
    expect(res.headers()['x-frame-options']?.toUpperCase()).toBe('DENY');
  });

  test('SEC07: X-Content-Type-Options nosniff', async ({ request }) => {
    const res = await request.get('https://spick.se');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('SEC08: Referrer-Policy strict-origin', async ({ request }) => {
    const res = await request.get('https://spick.se');
    expect(res.headers()['referrer-policy']).toContain('strict-origin');
  });

  test('SEC09: Permissions-Policy finns', async ({ request }) => {
    const res = await request.get('https://spick.se');
    expect(res.headers()['permissions-policy']).toBeTruthy();
  });
});

test.describe('Security: Sitemap utan admin-paths', () => {
  test('SEC10: sitemap.xml INTE exponerar admin-* eller _f1_test', async ({ request }) => {
    const res = await request.get('https://spick.se/sitemap.xml');
    const text = await res.text();
    expect(text).not.toMatch(/admin-chargebacks/);
    expect(text).not.toMatch(/admin-disputes/);
    expect(text).not.toMatch(/admin-matching/);
    expect(text).not.toMatch(/admin-pnr-verifiering/);
    expect(text).not.toMatch(/_f1_test/);
  });
});

test.describe('Security: Webhook-secret ej läckt', () => {
  test('SEC11: sakerhetsplan.html innehåller INTE whsec_-strängar', async ({ request }) => {
    const res = await request.get('https://spick.se/sakerhetsplan.html');
    const text = await res.text();
    expect(text).not.toMatch(/whsec_[a-zA-Z0-9]{20,}/);
  });
});

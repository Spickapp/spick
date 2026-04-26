// E2E SEO-grunden tester (Sprint B regression 2026-04-26)
// Säkerställer canonical, og-tags, schema.org JSON-LD, sitemap.
import { test, expect } from '@playwright/test';

const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';

test.describe('SEO: Canonical-URLs', () => {
  test('SEO01: index.html canonical pekar på spick.se/', async ({ page }) => {
    await page.goto('/');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/spick\.se\/?$/);
  });

  test('SEO02: kundvillkor.html canonical', async ({ page }) => {
    await page.goto('/kundvillkor.html');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toMatch(/spick\.se\/kundvillkor\.html/);
  });

  test('SEO03: foretag.html har default canonical (SPA-fallback för crawlers)', async ({ page }) => {
    await page.goto('/foretag.html');
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    expect(canonical).toBeTruthy();
    expect(canonical).toMatch(/spick\.se/);
  });
});

test.describe('SEO: Open Graph + Twitter Cards', () => {
  test('SEO10: index.html har og:title + og:image', async ({ page }) => {
    await page.goto('/');
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(ogTitle).toBeTruthy();
    expect(ogImage).toBeTruthy();
  });

  test('SEO11: foretag.html har og:type=website', async ({ page }) => {
    await page.goto('/foretag.html?slug=solid-service-sverige-ab');
    const ogType = await page.locator('meta[property="og:type"]').getAttribute('content');
    expect(['website', 'business.business']).toContain(ogType);
  });
});

test.describe('SEO: Sitemap.xml struktur', () => {
  test('SEO20: sitemap.xml laddar 200 OK', async ({ request }) => {
    const res = await request.get('https://spick.se/sitemap.xml');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/xml/);
  });

  test('SEO21: sitemap.xml innehåller minst 10 sidor', async ({ request }) => {
    const res = await request.get('https://spick.se/sitemap.xml');
    const text = await res.text();
    const matches = text.match(/<loc>/g) || [];
    expect(matches.length).toBeGreaterThan(10);
  });

  test('SEO22: sitemap.xml innehåller hemstad-sidor (om byggts)', async ({ request }) => {
    const res = await request.get('https://spick.se/sitemap.xml');
    const text = await res.text();
    expect(text).toMatch(/stockholm/i);
  });
});

test.describe('SEO: Pre-render EF (Sprint B B1)', () => {
  test('SEO30: og-prerender EF svarar för cleaner-slug', async ({ request }) => {
    const res = await request.get(
      `${SUPA}/functions/v1/og-prerender?type=cleaner&slug=dildora-kenjaeva`
    );
    if (res.status() === 404 || res.status() === 503) test.skip(); // EF kanske ej deployad än
    expect(res.ok()).toBe(true);
    const html = await res.text();
    expect(html).toMatch(/<title>/);
    expect(html).toMatch(/<meta name="description"/);
  });

  test('SEO31: og-prerender EF svarar för company-slug', async ({ request }) => {
    const res = await request.get(
      `${SUPA}/functions/v1/og-prerender?type=company&slug=solid-service-sverige-ab`
    );
    if (res.status() === 404 || res.status() === 503) test.skip();
    expect(res.ok()).toBe(true);
    const html = await res.text();
    expect(html).toMatch(/Solid Service/);
  });
});

test.describe('SEO: Schema.org JSON-LD', () => {
  test('SEO40: foretag.html injicerar JSON-LD efter laddning', async ({ page }) => {
    await page.goto('/foretag.html?slug=solid-service-sverige-ab');
    await page.waitForTimeout(3000); // Vänta på data-fetch
    const jsonLd = await page.locator('script[type="application/ld+json"]').count();
    expect(jsonLd).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// SPICK – PWA Installability Audit
// ═══════════════════════════════════════════════════════════════
//
// SYFTE:
//   Validera att Spick går att installera som PWA på iOS + Android.
//   Kollar manifest.json, sw.js, ikoner, och påkrävda fält.
//
// KÖRS:
//   npx playwright test tests/pwa-installability.spec.ts
//
// REGLER:
//   #27 scope = PWA installability only — Lighthouse PWA-audit ligger
//        i separat fil om/när Lighthouse-agenten implementerar det.
//   #28 SSOT — manifest-fält läses från manifest.json (live), inte
//        från hårdkodade förväntningar.
//
// TÄCKER:
//   1. manifest.json reachable (200) + content-type
//   2. Required fields: name, short_name, start_url, display,
//      theme_color, background_color, icons
//   3. Required icons: 192x192 + 512x512 maskable
//   4. Optional fields: scope, orientation, lang (logga warning om saknas)
//   5. sw.js reachable + registreras utan fel (browser-side)
//   6. Apple-specifika meta-tags i index.html (touch-icon, status-bar)
// ═══════════════════════════════════════════════════════════════

import { test, expect } from '@playwright/test';

const BASE = 'https://spick.se';

interface Manifest {
  name?: string;
  short_name?: string;
  description?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  lang?: string;
  categories?: string[];
  icons?: Array<{
    src: string;
    sizes: string;
    type?: string;
    purpose?: string;
  }>;
  shortcuts?: unknown[];
  screenshots?: unknown[];
}

test.describe('PWA Installability Audit', () => {
  let manifest: Manifest;
  let manifestContentType: string | null;

  test.beforeAll(async ({ request }) => {
    const res = await request.get(`${BASE}/manifest.json`);
    expect(res.ok(), `manifest.json måste returnera 200 — fick ${res.status()}`).toBe(true);
    manifestContentType = res.headers()['content-type'] || null;
    manifest = await res.json();
  });

  // ── 1. MANIFEST REACHABLE + CONTENT-TYPE ──────────────────
  test('P01: manifest.json returnerar 200 och giltig JSON', async () => {
    expect(manifest).toBeTruthy();
    expect(typeof manifest).toBe('object');
  });

  test('P02: manifest content-type är application/manifest+json (eller application/json)', () => {
    // Spec rekommenderar application/manifest+json men många servers
    // (inkl. GitHub Pages) levererar application/json. Båda accepteras
    // av iOS Safari + Chrome — men vi loggar warning för spec-strict.
    expect(manifestContentType).toBeTruthy();
    const ok =
      manifestContentType!.includes('application/manifest+json') ||
      manifestContentType!.includes('application/json');
    expect(ok, `Oväntad content-type: ${manifestContentType}`).toBe(true);

    if (!manifestContentType!.includes('application/manifest+json')) {
      console.warn(
        `[PWA WARN] manifest.json serveras med "${manifestContentType}" — ` +
        `spec rekommenderar "application/manifest+json". Fungerar i ` +
        `praktiken på iOS/Android men misslyckas i strikta validators.`
      );
    }
  });

  // ── 2. REQUIRED FIELDS ────────────────────────────────────
  test('P03: required field — name', () => {
    expect(manifest.name, 'name är required för PWA-install').toBeTruthy();
    expect(manifest.name!.length).toBeGreaterThan(0);
  });

  test('P04: required field — short_name (max 12 tecken för Android-launcher)', () => {
    expect(manifest.short_name).toBeTruthy();
    if (manifest.short_name!.length > 12) {
      console.warn(
        `[PWA WARN] short_name="${manifest.short_name}" är ${manifest.short_name!.length} tecken ` +
        `— Android trunkerar till 12 i launcher.`
      );
    }
  });

  test('P05: required field — start_url', () => {
    expect(manifest.start_url, 'start_url krävs för PWA-install').toBeTruthy();
  });

  test('P06: required field — display (standalone | fullscreen | minimal-ui)', () => {
    expect(manifest.display).toBeTruthy();
    const valid = ['standalone', 'fullscreen', 'minimal-ui', 'browser'];
    expect(valid).toContain(manifest.display);
    if (manifest.display === 'browser') {
      console.warn(
        `[PWA WARN] display="browser" → installerar inte som PWA. ` +
        `Använd "standalone" för app-känsla.`
      );
    }
  });

  test('P07: required field — theme_color (visas i Android-statusbar)', () => {
    expect(manifest.theme_color).toBeTruthy();
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  test('P08: required field — background_color (splash-screen)', () => {
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  // ── 3. ICONS ──────────────────────────────────────────────
  test('P09: icons array innehåller minst 192x192 och 512x512', () => {
    expect(manifest.icons).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons!.length).toBeGreaterThanOrEqual(2);

    const sizes = manifest.icons!.map((i) => i.sizes);
    expect(sizes, '192x192 krävs av Chrome-install-prompt').toEqual(
      expect.arrayContaining(['192x192'])
    );
    expect(sizes, '512x512 krävs av Chrome-install-prompt + Android-splash').toEqual(
      expect.arrayContaining(['512x512'])
    );
  });

  test('P10: minst en ikon har purpose="maskable" (Android adaptive)', () => {
    const maskable = manifest.icons!.filter((i) =>
      (i.purpose || '').includes('maskable')
    );
    expect(
      maskable.length,
      'Minst en icon måste vara maskable för Android adaptive icons'
    ).toBeGreaterThan(0);
  });

  test('P11: alla deklarerade icons är reachable (200)', async ({ request }) => {
    for (const icon of manifest.icons!) {
      const url = icon.src.startsWith('http') ? icon.src : `${BASE}${icon.src}`;
      const res = await request.get(url);
      expect(res.ok(), `Icon ${url} returnerade ${res.status()}`).toBe(true);
    }
  });

  // ── 4. OPTIONAL FIELDS (warnings) ─────────────────────────
  test('P12: optional field — scope', () => {
    if (!manifest.scope) {
      console.warn('[PWA WARN] scope saknas — defaultar till start_url-katalog.');
    } else {
      expect(manifest.scope).toBeTruthy();
    }
  });

  test('P13: optional field — orientation', () => {
    if (!manifest.orientation) {
      console.warn('[PWA WARN] orientation saknas — defaultar till "any".');
    } else {
      const valid = [
        'any', 'natural', 'landscape', 'landscape-primary',
        'landscape-secondary', 'portrait', 'portrait-primary', 'portrait-secondary',
      ];
      expect(valid).toContain(manifest.orientation);
    }
  });

  test('P14: optional field — lang (för i18n-screen-readers)', () => {
    if (!manifest.lang) {
      console.warn('[PWA WARN] lang saknas — sätt "sv" för svensk publik.');
    }
  });

  test('P15: optional field — description (visas i install-prompt på vissa enheter)', () => {
    if (!manifest.description) {
      console.warn('[PWA WARN] description saknas — visas i install-prompt.');
    }
  });

  // ── 5. SERVICE WORKER ─────────────────────────────────────
  test('P16: sw.js är reachable (200) i prod', async ({ request }) => {
    const res = await request.get(`${BASE}/sw.js`);
    expect(
      res.ok(),
      `sw.js returnerade ${res.status()} — utan service worker går PWA INTE att installera ` +
      `på Chrome/Edge. (iOS Safari mer förlåtande men cache fungerar inte offline.)`
    ).toBe(true);

    const ct = res.headers()['content-type'] || '';
    expect(
      ct.includes('javascript') || ct.includes('application/javascript'),
      `sw.js content-type fel: ${ct} — måste vara text/javascript eller application/javascript`
    ).toBe(true);
  });

  test('P17: sw.js registreras utan fel i browsern', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(BASE);

    // Vänta tills navigator.serviceWorker.ready resolvar (eller timeout)
    const swState = await page
      .evaluate(async () => {
        if (!('serviceWorker' in navigator)) return { supported: false };
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
          ]);
          return {
            supported: true,
            scope: (reg as ServiceWorkerRegistration).scope,
            active: !!(reg as ServiceWorkerRegistration).active,
            scriptURL: (reg as ServiceWorkerRegistration).active?.scriptURL || null,
          };
        } catch (e) {
          return { supported: true, error: (e as Error).message };
        }
      })
      .catch(() => ({ supported: false }));

    if ((swState as { supported: boolean }).supported === false) {
      // Browsern stödjer inte SW — sällsynt i moderna Playwright-builds
      console.warn('[PWA WARN] navigator.serviceWorker saknas i test-browser');
      return;
    }

    if ('error' in swState) {
      throw new Error(
        `Service worker registrerades INTE inom 5s: ${swState.error}. ` +
        `Detta blockerar Chrome-install-prompt. Kontrollera att ` +
        `navigator.serviceWorker.register('/sw.js') anropas i någon page-script.`
      );
    }

    const swErrors = consoleErrors.filter(
      (e) => e.toLowerCase().includes('service') || e.toLowerCase().includes('sw.js')
    );
    expect(
      swErrors,
      `Service-worker console-errors: ${swErrors.join('\n')}`
    ).toEqual([]);
  });

  // ── 6. APPLE-SPECIFIKA META-TAGS (iOS A2HS) ───────────────
  test('P18: index.html har apple-touch-icon (krävs för iOS-install)', async ({ page }) => {
    await page.goto(BASE);
    const touchIcon = await page.locator('link[rel="apple-touch-icon"]').count();
    expect(
      touchIcon,
      'apple-touch-icon krävs för "Lägg till på hemskärm" på iOS Safari'
    ).toBeGreaterThan(0);
  });

  test('P19: index.html har apple-mobile-web-app-capable (iOS standalone-mode)', async ({ page }) => {
    await page.goto(BASE);
    const meta = await page
      .locator('meta[name="apple-mobile-web-app-capable"]')
      .getAttribute('content')
      .catch(() => null);
    if (meta !== 'yes') {
      console.warn(
        '[PWA WARN] <meta name="apple-mobile-web-app-capable" content="yes"> ' +
        'saknas — iOS öppnar PWA i Safari-chrome istället för standalone.'
      );
    }
  });

  test('P20: index.html länkar manifest.json via <link rel="manifest">', async ({ page }) => {
    await page.goto(BASE);
    const manifestLink = await page.locator('link[rel="manifest"]').count();
    expect(
      manifestLink,
      '<link rel="manifest" href="/manifest.json"> krävs i <head>'
    ).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// LIGHTHOUSE PWA-AUDIT (placeholder — körs som separat test)
// ═══════════════════════════════════════════════════════════════
//
// Lighthouse PWA-kategorin avskaffades i Lighthouse 12 (oktober 2024)
// och ersattes av "Installable" + "PWA Optimized" som warnings.
// Vi täcker samma checks manuellt ovan (P01-P20). Om Spick framöver
// kör Lighthouse-CI separat (t.ex. via @lhci/cli) återanvänd config från
// .lighthouserc.json (skapas i den uppgiften, inte här).
// ═══════════════════════════════════════════════════════════════

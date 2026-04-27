import { test, expect } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════════════
// Visual Regression Tests (gratis, in-repo Percy/Chromatic-alternativ)
// ═══════════════════════════════════════════════════════════════════════
//
// SYFTE:
//   Upptäcker layout-/font-/design-regressions automatiskt genom att
//   jämföra full-page screenshots mot baseline-bilder lagrade i repo
//   (`tests/visual-regression.spec.ts-snapshots/`).
//
// STRATEGI:
//   - 8 nyckel-sidor täcker hero-CTA, B2C-bokningsflöde, B2B-vy,
//     priser, foretag, profil-sida och blogg.
//   - 3s wait för full render (animations + Supabase-async-data + fonts).
//   - maxDiffPixels=100 (global default i playwright.config.ts) tolererar
//     font-rendering-jitter mellan headless Chromium-versioner.
//   - Endast Chromium-desktop (visual-tests beror på exakt rendering;
//     cross-browser-quirks hanteras av playwright-cross-browser.yml).
//
// BASELINE-HANTERING:
//   - Första körning: Playwright skapar baseline-bilder och commitar dem
//     via workflow-artifact (.github/workflows/visual-regression.yml).
//   - Vid avsiktlig design-ändring: kör lokalt
//       `npx playwright test --update-snapshots tests/visual-regression.spec.ts`
//     och commita uppdaterade `.png`-filer i samma PR som design-changen.
//   - Vid oavsiktlig regression: workflow failar och uploadar
//     diff-bilder + actual/expected som artifact för manuell granskning.
//
// REGLER #26-#32 (för denna fil):
//   #26 Läste playwright.config.ts + smoke.spec.ts INNAN bygge för att
//       matcha BASE-URL-konvention och test-struktur.
//   #27 Scope = bara visual-regression. Ingen ändring i existerande tests.
//   #28 BASE-URL från playwright.config.ts (single source of truth).
//   #31 URL-strukturer curl-verifierade mot prod 2026-04-26
//       (alla 8 returnerar 200 utom /s/* som är 302-redirect →
//        därför används /stadare-profil.html?s=... direkt här).
// ═══════════════════════════════════════════════════════════════════════

const BASE = 'https://spick.se';

// 3s wait för: (1) Playfair/DM Sans web-font load, (2) Supabase async-data
// (services-loader, social proof toasts, calendar slots), (3) lazy-loaded
// images. Allt under denna gräns kan ge falska positiver i diff.
const RENDER_WAIT_MS = 3000;

interface VisualTarget {
  name: string;
  path: string;
  description: string;
}

const TARGETS: VisualTarget[] = [
  { name: 'homepage',         path: '/',                                                              description: 'Startsidan (hero + CTA + statistik)' },
  { name: 'boka',             path: '/boka.html',                                                     description: 'Kund-bokning (steg 1 — service-val)' },
  { name: 'boka-b2b-solid',   path: '/boka.html?company=1b969ed7-99f7-4553-be0e-8bedcaa7f5eb',       description: 'B2B-vy med Solid Service (company-param)' },
  { name: 'tjanster',         path: '/tjanster.html',                                                 description: 'Tjänster-översikt' },
  { name: 'priser',           path: '/priser.html',                                                   description: 'Priser + RUT-info' },
  { name: 'foretag',          path: '/foretag.html',                                                  description: 'Företagssidan (B2B-pitch)' },
  { name: 'stadare-profil',   path: '/stadare-profil.html?s=dildora-kenjaeva',                        description: 'Städar-profil (Dildora Kenjaeva)' },
  { name: 'blogg',            path: '/blogg/',                                                         description: 'Blogg-index' },
];

test.describe('Visual Regression (Chromium desktop)', () => {
  // SKIP I CI: Snapshots taggas chromium-{platform}.png. Win-baselines (skapas lokalt)
  // matchar inte Linux-render i CI pga font-rendering/anti-aliasing-skillnader.
  // Cross-platform baselines kräver Docker/WSL eller separat CI-job som genererar
  // Linux-baselines automatiskt. Skip tills vi sätter upp det → körs lokalt manuellt.
  test.skip(!!process.env.CI, 'Visual-regression skippas i CI: cross-platform-baseline-missmatch');

  // Sätt deterministisk viewport — annars kan CI-runner-defaults variera
  // mellan github-runner-versioner och ge falska diffs.
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const target of TARGETS) {
    test(`VR-${target.name}: ${target.description}`, async ({ page }) => {
      await page.goto(`${BASE}${target.path}`);

      // networkidle = inga in-flight HTTP-requests >500ms (täcker
      // Supabase REST-anrop som triggas vid DOMContentLoaded).
      await page.waitForLoadState('networkidle');

      // Extra render-wait för animations + late hydration (CRO-toasts,
      // exit-intent popup-listener, services-loader feature-flag-check).
      await page.waitForTimeout(RENDER_WAIT_MS);

      // fullPage: true → screenshot hela scroll-höjden, inte bara viewport.
      // maxDiffPixels: 100 → tolererar 100 px diff (anti-flaky för fonts).
      // Filnamn → tests/visual-regression.spec.ts-snapshots/<name>-chromium-*.png
      await expect(page).toHaveScreenshot(`${target.name}.png`, {
        fullPage: true,
        maxDiffPixels: 100,
      });
    });
  }
});

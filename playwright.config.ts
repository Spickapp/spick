import { defineConfig, devices } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────
// Cross-browser projects (2026-04-26)
// Default kör endast Chromium (matchar tidigare beteende, snabbare CI).
// För att köra alla 5 browsers: `npx playwright test --project=all`
// eller via env: `CROSS_BROWSER=1 npx playwright test`
//
// CI-workflow `playwright-cross-browser.yml` kör samtliga via matrix:
//   chromium / firefox / webkit / mobile-chrome / mobile-safari
//
// Firefox + WebKit körs som "warning"-nivå i CI (continue-on-error)
// för att inte blockera deploy på icke-kritiska browser-quirks.
// Chromium är hard-fail (den dominerar svenska användarbasen).
// ─────────────────────────────────────────────────────────────────────

const CROSS_BROWSER = process.env.CROSS_BROWSER === '1';

const allProjects = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
  { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
];

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'https://spick.se',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // ─────────────────────────────────────────────────────────────────
  // Visual regression defaults (tests/visual-regression.spec.ts)
  // maxDiffPixels=100 tolererar font-rendering-jitter mellan headless
  // Chromium-versioner. Per-test override möjlig via { maxDiffPixels: N }.
  // ─────────────────────────────────────────────────────────────────
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
    },
  },
  // Cross-browser via env-flagga eller explicit --project=<name>
  // Visual-regression-specen körs alltid Chromium-only (oavsett CROSS_BROWSER)
  // — baselines är browser-specifika och cross-browser-rendering hanteras
  // av playwright-cross-browser.yml.
  projects: CROSS_BROWSER
    ? allProjects
    : [allProjects[0]], // default: chromium-only (bakåtkompatibelt med befintliga workflows)
});

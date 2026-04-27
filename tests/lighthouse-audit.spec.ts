// Lighthouse CI audit — 8 nyckelsidor mot prod (spick.se).
// Triggas nightly via .github/workflows/lighthouse-nightly.yml (04:00 UTC).
// Fail om Performance / Accessibility / Best-Practices / SEO < 90.
//
// Tekniskt val:
//   - Använder lighthouse npm-paketet direkt mot Chromium som Playwright redan
//     har installerat (--with-deps chromium i CI). Detta undviker beroenden på
//     playwright-lighthouse-paketets peer-versioner och låter oss styra
//     reporten själva.
//   - Vi startar lighthouse i ett separat Node-child-process eftersom Lighthouse
//     ESM och Playwright CJS test-runner inte alltid samspelar via dynamic import
//     i alla node-versioner. child_process är robust och fail-safe.
//
// Reglerna #26-#32 (CLAUDE.md):
//   - SSOT: använder existerande playwright-setup, inga duplicerade configs.
//   - Scope: bara Lighthouse + Rich Results, ingen extra refactor.

import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const BASE = 'https://spick.se';

// 8 nyckelsidor (spec från Farhad 2026-04-26).
const PAGES: Array<{ name: string; url: string }> = [
  { name: 'homepage',          url: `${BASE}/` },
  { name: 'boka',              url: `${BASE}/boka.html` },
  { name: 'tjanster',          url: `${BASE}/tjanster.html` },
  { name: 'priser',            url: `${BASE}/priser.html` },
  { name: 'foretag',           url: `${BASE}/foretag.html` },
  { name: 'stadare-profil',    url: `${BASE}/stadare-profil.html?s=dildora-kenjaeva` },
  { name: 'blogg',             url: `${BASE}/blogg/` },
  { name: 'stockholm',         url: `${BASE}/stockholm.html` },
];

// Score-tröskel — fail under 90 (Farhad-spec).
const MIN_SCORE = 90;

// Output-katalog för Lighthouse JSON-rapporter.
const REPORT_DIR = join(process.cwd(), 'lighthouse-reports');

interface LhScores {
  performance: number;
  accessibility: number;
  'best-practices': number;
  seo: number;
}

/**
 * Kör lighthouse-CLI i ett child-process och returnerar scores.
 * Använder --quiet + JSON-output. Skriver också rapport till disk för CI-artifact.
 */
function runLighthouse(url: string, name: string): Promise<LhScores> {
  return new Promise((resolve, reject) => {
    if (!existsSync(REPORT_DIR)) {
      mkdirSync(REPORT_DIR, { recursive: true });
    }
    const reportPath = join(REPORT_DIR, `${name}.report.json`);

    // Lighthouse CLI args:
    //   --output=json           – ge oss strukturerad output
    //   --output-path=…         – skriv till disk
    //   --only-categories=…     – kör bara våra 4 kategorier (snabbare)
    //   --chrome-flags=…        – headless + no-sandbox för CI/Linux
    //   --quiet                 – minska brus
    //   --max-wait-for-load     – ge sidan 45s att ladda (boka.html är tung)
    //   --form-factor=desktop   – desktop-perspektiv (mobile-audit kan adderas senare)
    const args = [
      'lighthouse',
      url,
      '--output=json',
      `--output-path=${reportPath}`,
      '--only-categories=performance,accessibility,best-practices,seo',
      '--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage',
      '--quiet',
      '--max-wait-for-load=45000',
      '--form-factor=desktop',
      '--screenEmulation.disabled',
      '--throttling-method=provided',
    ];

    // npx på Windows → npx.cmd, på Linux → npx. shell:true gör portabelt.
    const child = spawn('npx', args, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`lighthouse exit ${code} for ${url}\n${stderr.slice(-2000)}`));
      }
      try {
        // Ladda JSON-rapporten lighthouse skrev.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const report = require(reportPath);
        const scores: LhScores = {
          performance: Math.round((report.categories.performance?.score ?? 0) * 100),
          accessibility: Math.round((report.categories.accessibility?.score ?? 0) * 100),
          'best-practices': Math.round((report.categories['best-practices']?.score ?? 0) * 100),
          seo: Math.round((report.categories.seo?.score ?? 0) * 100),
        };
        resolve(scores);
      } catch (err) {
        reject(err as Error);
      }
    });
  });
}

// Sammanställd resultatfil för Discord-alert i workflow:n.
const SUMMARY_FILE = join(REPORT_DIR, 'summary.json');
const summary: Record<string, LhScores & { url: string; failed: string[] }> = {};

test.describe('Lighthouse CI — 8 nyckelsidor', () => {
  // Kör en sida i taget — CI-runner blir inte CPU-bunden.
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000); // 3 min per sida (Lighthouse-runs varierar)

  for (const page of PAGES) {
    test(`LH: ${page.name} (${page.url}) score >= ${MIN_SCORE}`, async () => {
      const scores = await runLighthouse(page.url, page.name);

      // Spara summary.
      const failed = (Object.entries(scores) as Array<[keyof LhScores, number]>)
        .filter(([, score]) => score < MIN_SCORE)
        .map(([cat, score]) => `${cat}=${score}`);

      summary[page.name] = { ...scores, url: page.url, failed };
      writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));

      // Logga för CI-output (synas i playwright list-reporter).
      console.log(`[LH] ${page.name}: P=${scores.performance} A=${scores.accessibility} BP=${scores['best-practices']} SEO=${scores.seo}`);

      // Soft-assert per kategori → vi rapporterar ALLA failures, inte bara första.
      expect.soft(scores.performance, 'performance').toBeGreaterThanOrEqual(MIN_SCORE);
      expect.soft(scores.accessibility, 'accessibility').toBeGreaterThanOrEqual(MIN_SCORE);
      expect.soft(scores['best-practices'], 'best-practices').toBeGreaterThanOrEqual(MIN_SCORE);
      expect.soft(scores.seo, 'seo').toBeGreaterThanOrEqual(MIN_SCORE);
    });
  }
});

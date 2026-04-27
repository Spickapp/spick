// Rich Results / Schema.org JSON-LD validering — 5 nyckelsidor.
// Hämtar HTML från prod, extraherar alla <script type="application/ld+json">,
// validerar JSON-syntax + förväntade @type-fält per sida.
//
// Bakgrund: Google har ingen officiell publik Rich Results Test API
// (validator.schema.org tillåter heller inte automatiserade POSTs utan
// captcha). Vi validerar därför struktur lokalt — exakt det Google testar
// (parsbar JSON, korrekt @context, krävda properties per @type).
// Dokumentation: https://developers.google.com/search/docs/appearance/structured-data
//
// Reglerna #26-#32 (CLAUDE.md):
//   - #28 SSOT: validerings-regler centraliserade i SCHEMA_REQUIREMENTS-mappen
//     nedan (inte spridda över tester).
//   - #30: ingen tolkning av "vad Google kräver" — vi följer Schema.org spec
//     publika required-properties + Google's documented dataspecs.

import { test, expect, request as pwRequest } from '@playwright/test';

const BASE = 'https://spick.se';

// Page → Förväntade JSON-LD-typer (@type-värden som MÅSTE finnas på sidan).
// Krav per sida från Farhad-spec (2026-04-26).
const PAGES: Array<{
  name: string;
  url: string;
  requiredTypes: string[];        // minst en JSON-LD-block med dessa @type måste finnas
  requiredProperties?: Record<string, string[]>; // @type → required props
  // Vissa sidor injicerar JSON-LD via JS efter data-fetch — markera så vi
  // använder Playwright istället för raw fetch.
  needsBrowserRender?: boolean;
}> = [
  {
    name: 'homepage',
    url: `${BASE}/`,
    requiredTypes: ['LocalBusiness', 'Organization'],
    requiredProperties: {
      LocalBusiness: ['name', 'url'],
      Organization: ['name', 'url'],
    },
  },
  {
    // Företagsprofil med slug → JSON-LD är LocalBusiness/CleaningService
    // (verifierat via grep i foretag.html — Service-blocket renderas bara på
    // standardvyn utan slug). Farhad-spec sa "Service" men den semantiken
    // ligger på LocalBusiness@type-arrayen via CleaningService-subtyp.
    name: 'foretag-company',
    url: `${BASE}/foretag.html?slug=solid-service-sverige-ab`,
    requiredTypes: ['LocalBusiness'],
    requiredProperties: {
      LocalBusiness: ['name', 'url'],
    },
    needsBrowserRender: true, // injicerar JSON-LD efter Supabase-fetch
  },
  {
    // Standardvyn (utan slug) injicerar @type: 'Service' (rad 1138 i foretag.html)
    name: 'foretag-standard',
    url: `${BASE}/foretag.html`,
    requiredTypes: ['Service'],
    requiredProperties: {
      Service: ['serviceType', 'provider'],
    },
    needsBrowserRender: true,
  },
  {
    name: 'stadare-profil',
    url: `${BASE}/stadare-profil.html?s=dildora-kenjaeva`,
    requiredTypes: ['Person'],
    requiredProperties: {
      Person: ['name'],
    },
    needsBrowserRender: true,
  },
  {
    name: 'blogg',
    url: `${BASE}/blogg/`,
    requiredTypes: ['Blog'],
    requiredProperties: {
      Blog: ['name'],
    },
  },
  {
    name: 'hemstadning-stockholm',
    url: `${BASE}/hemstadning-stockholm.html`,
    requiredTypes: ['LocalBusiness'],
    requiredProperties: {
      LocalBusiness: ['name', 'url'],
    },
  },
];

interface JsonLdBlock {
  raw: string;
  parsed: any;
  parseError?: string;
}

/**
 * Plocka ut alla <script type="application/ld+json">…</script>-block ur HTML.
 * Använder regex (snabbt, ingen DOM-parser-dep) — Schema.org JSON-LD är alltid
 * platt text utan nested script-tags så regex är tillräckligt.
 */
function extractJsonLd(html: string): JsonLdBlock[] {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks: JsonLdBlock[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      blocks.push({ raw, parsed });
    } catch (err) {
      blocks.push({ raw, parsed: null, parseError: (err as Error).message });
    }
  }
  return blocks;
}

/**
 * Returnera alla @type-värden i ett JSON-LD-block.
 * Hanterar både string och array (Schema.org tillåter @type: ["LocalBusiness", "HomeAndConstructionBusiness"]).
 */
function getTypes(block: any): string[] {
  if (!block) return [];
  const t = block['@type'];
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

/** Hitta första JSON-LD-block med matchande @type. */
function findBlockByType(blocks: JsonLdBlock[], type: string): any | null {
  for (const b of blocks) {
    if (b.parsed && getTypes(b.parsed).includes(type)) return b.parsed;
  }
  return null;
}

test.describe('Rich Results / Schema.org JSON-LD validering', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  for (const pageSpec of PAGES) {
    test(`SCHEMA: ${pageSpec.name} har giltig JSON-LD med @type=[${pageSpec.requiredTypes.join(', ')}]`, async ({ page }) => {
      let html: string;

      if (pageSpec.needsBrowserRender) {
        // JS injicerar JSON-LD efter data-fetch → vi måste rendera sidan.
        await page.goto(pageSpec.url, { waitUntil: 'networkidle', timeout: 30_000 });
        // Polla tills minst en JSON-LD-script finns (max 10s) — deterministisk
        // jämfört med fast waitForTimeout. Vissa sidor injicerar via async fetch.
        await page.waitForFunction(
          () => document.querySelectorAll('script[type="application/ld+json"]').length > 0,
          { timeout: 10_000 },
        ).catch(() => { /* fallthrough — failure asserts senare ger bättre felmeddelande */ });
        // Extra buffer för andra block (foretag.html injicerar 2 separata).
        await page.waitForTimeout(2000);
        html = await page.content();
      } else {
        // Statisk JSON-LD i HTML — raw fetch räcker (snabbare).
        const ctx = await pwRequest.newContext();
        const res = await ctx.get(pageSpec.url);
        expect(res.ok(), `HTTP-status för ${pageSpec.url}`).toBe(true);
        html = await res.text();
        await ctx.dispose();
      }

      const blocks = extractJsonLd(html);
      console.log(`[SCHEMA] ${pageSpec.name}: ${blocks.length} JSON-LD-block hittat`);

      // 1) Måste finnas minst ett block.
      expect(blocks.length, `${pageSpec.name} har minst 1 JSON-LD-block`).toBeGreaterThan(0);

      // 2) Alla block måste vara parsbar JSON (Google-krav: ogiltig JSON = ignoreras).
      for (const [i, b] of blocks.entries()) {
        expect.soft(b.parseError, `Block #${i} på ${pageSpec.name} är giltig JSON`).toBeUndefined();
      }

      // 3) @context ska vara https://schema.org (eller variant).
      for (const [i, b] of blocks.entries()) {
        if (!b.parsed) continue;
        const ctx = b.parsed['@context'];
        const ctxStr = typeof ctx === 'string' ? ctx : '';
        expect.soft(ctxStr, `Block #${i} på ${pageSpec.name} har @context=schema.org`).toMatch(/schema\.org/i);
      }

      // 4) Förväntade @type måste finnas.
      for (const reqType of pageSpec.requiredTypes) {
        const block = findBlockByType(blocks, reqType);
        expect.soft(block, `${pageSpec.name} har JSON-LD med @type="${reqType}"`).not.toBeNull();

        // 5) Förväntade properties per @type.
        if (block && pageSpec.requiredProperties?.[reqType]) {
          for (const prop of pageSpec.requiredProperties[reqType]) {
            expect.soft(
              block[prop],
              `${pageSpec.name} ${reqType}.${prop} finns och är inte tom`,
            ).toBeTruthy();
          }
        }
      }
    });
  }

  // Bonus: kolla att homepage Organization har sameAs (Google rekommenderar
  // för knowledge-graph). Soft-fail.
  test('SCHEMA: homepage Organization har sameAs (sociala länkar) — rekommendation', async ({ }) => {
    const ctx = await pwRequest.newContext();
    const res = await ctx.get(`${BASE}/`);
    const html = await res.text();
    await ctx.dispose();

    const blocks = extractJsonLd(html);
    const org = findBlockByType(blocks, 'Organization');
    if (!org) test.skip(true, 'Inget Organization-block — separat test fångar detta');
    expect.soft(org.sameAs, 'Organization.sameAs finns (rekommenderat för knowledge-graph)').toBeTruthy();
  });
});

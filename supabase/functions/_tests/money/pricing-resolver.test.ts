/**
 * Sprint 1 Dag 2 (2026-04-24) — enhetstester för pricing-resolver hierarki
 *
 * Primärkälla: supabase/functions/_shared/pricing-resolver.ts
 * Hygien-task: #30 — Fönsterputs-testbokning 681aaa93 debiterades 100 kr/h
 *              istället för 349 kr/h (services.default_hourly_price).
 *
 * Täcker 6-stegs-hierarkin:
 *   1. company_service_prices (use_company_pricing=true)
 *   2. cleaner_service_prices
 *   3. company_service_prices (fallback)
 *   4. cleaners.hourly_rate (ENDAST om >= min_hourly_rate)
 *   5. services.default_hourly_price
 *   6. platform_settings.base_price_per_hour
 *
 * Körs med:
 *   deno test --allow-net=esm.sh supabase/functions/_tests/money/pricing-resolver.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resolvePricing } from '../../_shared/pricing-resolver.ts';

type PlatformSettings = Record<string, string>;
type CleanerRow = { company_id?: string | null; hourly_rate?: number | null };
type CompanyRow = { use_company_pricing?: boolean };
type PriceRow = { price: number; price_type?: string };
type ServiceRow = { default_hourly_price?: number | null };

type MockOptions = {
  settings?: PlatformSettings;
  cleaners?: Record<string, CleanerRow>;
  companies?: Record<string, CompanyRow>;
  cleanerServicePrices?: Record<string, Record<string, PriceRow>>;
  companyServicePrices?: Record<string, Record<string, PriceRow>>;
  services?: Record<string, ServiceRow>;
};

// deno-lint-ignore no-explicit-any
function createMockSb(opts: MockOptions = {}): any {
  const settings = opts.settings ?? {};
  const cleaners = opts.cleaners ?? {};
  const companies = opts.companies ?? {};
  const cleanerServicePrices = opts.cleanerServicePrices ?? {};
  const companyServicePrices = opts.companyServicePrices ?? {};
  const services = opts.services ?? {};

  return {
    from(table: string) {
      if (table === 'platform_settings') {
        return {
          select: () => ({
            eq: (_col: string, key: string) => ({
              async single() {
                const value = settings[key];
                if (value === undefined) {
                  return { data: null, error: { message: `not found: ${key}` } };
                }
                return { data: { value }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'cleaners') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              async maybeSingle() {
                const row = cleaners[id];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'companies') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              async maybeSingle() {
                const row = companies[id];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'cleaner_service_prices') {
        let cleanerId = '';
        let serviceType = '';
        const builder = {
          select: () => builder,
          eq(col: string, val: string) {
            if (col === 'cleaner_id') cleanerId = val;
            if (col === 'service_type') serviceType = val;
            return builder;
          },
          async maybeSingle() {
            const row = cleanerServicePrices[cleanerId]?.[serviceType];
            if (!row) return { data: null, error: null };
            return { data: row, error: null };
          },
        };
        return builder;
      }
      if (table === 'company_service_prices') {
        let companyId = '';
        let serviceType = '';
        const builder = {
          select: () => builder,
          eq(col: string, val: string) {
            if (col === 'company_id') companyId = val;
            if (col === 'service_type') serviceType = val;
            return builder;
          },
          async maybeSingle() {
            const row = companyServicePrices[companyId]?.[serviceType];
            if (!row) return { data: null, error: null };
            return { data: row, error: null };
          },
        };
        return builder;
      }
      if (table === 'services') {
        return {
          select: () => ({
            eq: (_col: string, key: string) => ({
              async maybeSingle() {
                const row = services[key];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`mock: unexpected table '${table}'`);
    },
  };
}

// ============================================================
// Test 1 — Lager 1: use_company_pricing=true + company_service_prices
// ============================================================

Deno.test('pricing-resolver: use_company_pricing=true läser company_service_prices', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: 'co1', hourly_rate: 300 } },
    companies: { co1: { use_company_pricing: true } },
    companyServicePrices: { co1: { Hemstadning: { price: 425, price_type: 'hourly' } } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Hemstadning' });
  assertEquals(result.basePricePerHour, 425);
  assertEquals(result.source, 'company_prices');
  assertEquals(result.commissionPct, 12);
});

// ============================================================
// Test 2 — Lager 2: cleaner_service_prices har företräde över hourly_rate
// ============================================================

Deno.test('pricing-resolver: cleaner_service_prices vinner över hourly_rate', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 300 } },
    cleanerServicePrices: { c1: { Hemstadning: { price: 450, price_type: 'hourly' } } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Hemstadning' });
  assertEquals(result.basePricePerHour, 450);
  assertEquals(result.source, 'cleaner_prices');
});

// ============================================================
// Test 3 — Lager 3: company_service_prices som fallback utan flaggan
// ============================================================

Deno.test('pricing-resolver: company_service_prices fallback när use_company_pricing=false', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: 'co1', hourly_rate: 300 } },
    companies: { co1: { use_company_pricing: false } },
    companyServicePrices: { co1: { Hemstadning: { price: 400, price_type: 'hourly' } } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Hemstadning' });
  assertEquals(result.basePricePerHour, 400);
  assertEquals(result.source, 'company_prices');
});

// ============================================================
// Test 4 — Lager 4: cleaner.hourly_rate >= min_hourly_rate → används
// ============================================================

Deno.test('pricing-resolver: cleaner.hourly_rate=300 (>= min 200) används', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 300 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Fonsterputs' });
  assertEquals(result.basePricePerHour, 300);
  assertEquals(result.source, 'hourly_rate');
});

// ============================================================
// Test 5 — MIN-GUARD: cleaner.hourly_rate=100 (< min 200) → services-fallback
// REPRO: Fönsterputs-testbokning 681aaa93 (hygien #30)
// ============================================================

Deno.test('pricing-resolver: cleaner.hourly_rate=100 (< min 200) hoppar till services.default_hourly_price', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 100 } }, // för låg
    services: { fonsterputs: { default_hourly_price: 349 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'fonsterputs' });
  assertEquals(result.basePricePerHour, 349, 'Kund ska inte debiteras 100 kr/h — services-default vinner');
  assertEquals(result.source, 'service_default');
});

// ============================================================
// Test 6 — cleaner.hourly_rate vid exakt min-gränsen används (>= inklusivt)
// ============================================================

Deno.test('pricing-resolver: cleaner.hourly_rate=200 (= min 200) används', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 200 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Hemstadning' });
  assertEquals(result.basePricePerHour, 200);
  assertEquals(result.source, 'hourly_rate');
});

// ============================================================
// Test 7 — Ingen cleaner + services har default → services-fallback
// ============================================================

Deno.test('pricing-resolver: saknad cleaner → services.default_hourly_price', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: {}, // ingen cleaner-row
    services: { hemstadning: { default_hourly_price: 349 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'missing', serviceType: 'hemstadning' });
  assertEquals(result.basePricePerHour, 349);
  assertEquals(result.source, 'service_default');
});

// ============================================================
// Test 8 — services.default_hourly_price=NULL → sista fallback
// ============================================================

Deno.test('pricing-resolver: services.default_hourly_price=NULL → base_price_per_hour', async () => {
  const sb = createMockSb({
    settings: {
      commission_standard: '12',
      min_hourly_rate: '200',
      base_price_per_hour: '399',
    },
    cleaners: { c1: { company_id: null, hourly_rate: 50 } }, // för låg
    services: { mattrengoring: { default_hourly_price: null } }, // mattrengoring har NULL
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'mattrengoring' });
  assertEquals(result.basePricePerHour, 399);
  assertEquals(result.source, 'fallback');
});

// ============================================================
// Test 9 — Allt saknas → base_price_per_hour default 399
// ============================================================

Deno.test('pricing-resolver: allt saknas → hårdkodad fallback 399', async () => {
  const sb = createMockSb({
    // inga settings (commission_standard fallback 12, min 200)
    cleaners: {},
    services: {},
  });
  const result = await resolvePricing(sb, { cleanerId: 'x', serviceType: 'okand' });
  assertEquals(result.basePricePerHour, 399);
  assertEquals(result.commissionPct, 12);
  assertEquals(result.source, 'fallback');
});

// ============================================================
// Test 10 — min_hourly_rate saknas → default 200 (regression-guard)
// ============================================================

Deno.test('pricing-resolver: min_hourly_rate saknas → default 200 (cleaner 150 hoppas över)', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12' }, // ingen min_hourly_rate
    cleaners: { c1: { company_id: null, hourly_rate: 150 } },
    services: { hemstadning: { default_hourly_price: 349 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'hemstadning' });
  assertEquals(result.basePricePerHour, 349, '150 < default-min 200 → services-fallback');
  assertEquals(result.source, 'service_default');
});

// ============================================================
// Test 11 — per_sqm-prissättning (per-kvm) bevaras
// ============================================================

Deno.test('pricing-resolver: per_sqm-pris från cleaner_service_prices bevaras', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 300 } },
    cleanerServicePrices: { c1: { Flyttstadning: { price: 35, price_type: 'per_sqm' } } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Flyttstadning' });
  assertEquals(result.pricePerSqm, 35);
  assertEquals(result.priceType, 'per_sqm');
  assertEquals(result.basePricePerHour, 0);
  assertEquals(result.source, 'cleaner_prices');
});

// ============================================================
// Test 12 — Commission respekterar platform_settings
// ============================================================

Deno.test('pricing-resolver: commission läser platform_settings.commission_standard=15', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '15', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 300 } },
  });
  const result = await resolvePricing(sb, { cleanerId: 'c1', serviceType: 'Hemstadning' });
  assertEquals(result.commissionPct, 15);
});

// ============================================================
// Test 13 — Kombinerad tjänst "Hemstädning + Fönsterputs" → första delen
// ============================================================

Deno.test('pricing-resolver: kombinerad tjänst splittrar på " + " och tar första', async () => {
  const sb = createMockSb({
    settings: { commission_standard: '12', min_hourly_rate: '200' },
    cleaners: { c1: { company_id: null, hourly_rate: 100 } }, // för låg
    services: { Hemstadning: { default_hourly_price: 349 } },
  });
  const result = await resolvePricing(sb, {
    cleanerId: 'c1',
    serviceType: 'Hemstadning + Fonsterputs',
  });
  // Splittade till "Hemstadning", cleaner.hourly_rate=100 < min → services-lookup
  assertEquals(result.basePricePerHour, 349);
  assertEquals(result.source, 'service_default');
});

/**
 * Fas 1.3 — enhetstester for getCommission() hierarki
 *
 * Primarkalla: docs/architecture/money-layer.md §4.1 + §5
 *
 * Kors med Deno:
 *   deno test --allow-net=esm.sh --import-map=supabase/functions/import_map.json \
 *     supabase/functions/_tests/money/commission-hierarchy.test.ts
 *
 * Eller utan import-map, lat Deno resolva esm.sh direkt.
 *
 * Testerna anvander en mock-SupabaseClient som speglar exakt de
 * kedjor money.ts gor: from().select().eq().single() for
 * platform_settings och from().select().eq().maybeSingle() for cleaners.
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { getCommission } from '../../_shared/money.ts';

// ============================================================
// Mock-helpers
// ============================================================

type PlatformSettings = Record<string, string>;
type CleanerRow = { completed_jobs?: number | null; total_jobs?: number | null };

type MockOptions = {
  settings?: PlatformSettings;
  cleaners?: Record<string, CleanerRow>;
  /** Simulera DB-fel pa specifik key-lookup */
  failSettingKey?: string;
};

// deno-lint-ignore no-explicit-any
function createMockSb(opts: MockOptions = {}): any {
  const settings = opts.settings ?? {};
  const cleaners = opts.cleaners ?? {};
  const failKey = opts.failSettingKey;

  return {
    from(table: string) {
      if (table === 'platform_settings') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, key: string) => ({
              async single() {
                if (failKey && key === failKey) {
                  return { data: null, error: { message: 'simulated db error' } };
                }
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
          select: (_cols: string) => ({
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
      throw new Error(`mock: unexpected table '${table}'`);
    },
  };
}

// ============================================================
// Test 1 — Feature flag av: kastar MoneyLayerDisabled
// ============================================================

Deno.test('getCommission: money_layer_enabled=false kastar MoneyLayerDisabled', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'false',
      commission_standard: '12',
    },
  });

  await assertRejects(
    () => getCommission(sb, { cleaner_id: 'c1' }),
    Error,
    'MoneyLayerDisabled'
  );
});

// ============================================================
// Test 2 — Nyckel saknas: fel propageras (ej MoneyLayerDisabled)
// ============================================================

Deno.test('getCommission: saknad money_layer_enabled-nyckel propagerar DB-fel', async () => {
  const sb = createMockSb({
    settings: {
      commission_standard: '12',
    },
  });

  await assertRejects(
    () => getCommission(sb, { cleaner_id: 'c1' }),
    Error,
    'money_layer_enabled'
  );
});

// ============================================================
// Test 3 — Default: platform_settings.commission_standard
// ============================================================

Deno.test('getCommission: default laser commission_standard=12', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { cleaner_id: 'c1' });

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'platform_settings');
  assertEquals(result.tier, undefined);
});

Deno.test('getCommission: platform_settings respekterar annat varde (15)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      commission_standard: '15',
    },
  });

  const result = await getCommission(sb, {});

  assertEquals(result.pct, 15);
  assertEquals(result.source, 'platform_settings');
});

// ============================================================
// Test 4 — Smart Trappstege AV, commission_standard vinner
// ============================================================

Deno.test('getCommission: smart_trappstege_enabled=false ignorerar completed_jobs', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, {
    cleaner_id: 'c1',
    completed_jobs: 150,
  });

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'platform_settings');
  assertEquals(result.tier, undefined);
});

// ============================================================
// Test 5 — Smart Trappstege PA, varje tier
// ============================================================

Deno.test('getCommission: trappstege tier=new (0 jobs)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 0 });

  assertEquals(result.pct, 17);
  assertEquals(result.source, 'smart_trappstege');
  assertEquals(result.tier, 'new');
});

Deno.test('getCommission: trappstege tier=new vid threshold-1 (19 jobs)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 19 });

  assertEquals(result.pct, 17);
  assertEquals(result.tier, 'new');
});

Deno.test('getCommission: trappstege tier=established vid threshold (20 jobs)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 20 });

  assertEquals(result.pct, 15);
  assertEquals(result.tier, 'established');
});

Deno.test('getCommission: trappstege tier=professional (50 jobs)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 50 });

  assertEquals(result.pct, 13);
  assertEquals(result.tier, 'professional');
});

Deno.test('getCommission: trappstege tier=elite (150 jobs)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 150 });

  assertEquals(result.pct, 12);
  assertEquals(result.tier, 'elite');
});

// ============================================================
// Test 6 — Trappstege med cleaner_id-lookup
// ============================================================

Deno.test('getCommission: trappstege hamtar completed_jobs fran cleaner-rad', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
    cleaners: {
      'cleaner-uuid-42': { completed_jobs: 25 },
    },
  });

  const result = await getCommission(sb, { cleaner_id: 'cleaner-uuid-42' });

  assertEquals(result.pct, 15);
  assertEquals(result.tier, 'established');
  assertEquals(result.source, 'smart_trappstege');
});

Deno.test('getCommission: trappstege fallback till total_jobs om completed_jobs=null', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
    cleaners: {
      'c1': { completed_jobs: null, total_jobs: 60 },
    },
  });

  const result = await getCommission(sb, { cleaner_id: 'c1' });

  assertEquals(result.pct, 13);
  assertEquals(result.tier, 'professional');
});

// ============================================================
// Test 7 — Trappstege utan data: fallback till platform_settings
// ============================================================

Deno.test('getCommission: trappstege=true men inga jobs-data → faller till platform_settings', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
    // ingen cleaner_id, ingen completed_jobs
  });

  const result = await getCommission(sb, {});

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'platform_settings');
  assertEquals(result.tier, undefined);
});

Deno.test('getCommission: trappstege=true men cleaner finns ej → platform_settings', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'true',
      commission_standard: '12',
    },
    cleaners: {}, // cleaner_id finns inte
  });

  const result = await getCommission(sb, { cleaner_id: 'missing' });

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'platform_settings');
});

// ============================================================
// Test 8 — DB-fel pa commission_standard: fallback 12
// ============================================================

Deno.test('getCommission: DB-fel pa commission_standard → fallback=12', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      // commission_standard saknas -> "not found" error
    },
  });

  const result = await getCommission(sb, {});

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'fallback');
});

Deno.test('getCommission: simulerat db-fel pa commission_standard → fallback=12', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      commission_standard: '12', // finns men faller via failSettingKey
    },
    failSettingKey: 'commission_standard',
  });

  const result = await getCommission(sb, {});

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'fallback');
});

// ============================================================
// Test 9 — Smart Trappstege key saknas → faller till platform_settings
// ============================================================

Deno.test('getCommission: smart_trappstege_enabled-nyckel saknas → platform_settings', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      // smart_trappstege_enabled saknas
      commission_standard: '12',
    },
  });

  const result = await getCommission(sb, { completed_jobs: 150 });

  assertEquals(result.pct, 12);
  assertEquals(result.source, 'platform_settings');
});

// ============================================================
// Test 10 — Format-verifiering: pct ar alltid heltal-procent
// ============================================================

Deno.test('getCommission: commission_standard=17 returnerar pct=17 (heltal-procent)', async () => {
  const sb = createMockSb({
    settings: {
      money_layer_enabled: 'true',
      smart_trappstege_enabled: 'false',
      commission_standard: '17',
    },
  });

  const result = await getCommission(sb, {});

  assertEquals(result.pct, 17);
  // Verifiera att det INTE ar decimal (0.17)
  assertEquals(result.pct > 1, true, 'pct ska vara heltal-procent, ej decimal');
});

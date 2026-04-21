/**
 * Fas 1.6a — enhetstester for isMoneyLayerEnabled()
 *
 * Primarkalla: docs/architecture/money-layer.md §4.7
 *
 * isMoneyLayerEnabled() lasar platform_settings.money_layer_enabled
 * och returnerar true ENDAST om varde ar exakt strang 'true'.
 * Strikt match — 'True', '1', 'yes', tom strang ar alla false.
 *
 * Kors med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/is-money-layer-enabled.test.ts
 */

import {
  assertEquals,
  assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { isMoneyLayerEnabled } from '../../_shared/money.ts';

// ============================================================
// Mock-helper
// ============================================================

type MockOptions = {
  value?: string;
  /** Om true, returnerar error istallet for rad */
  fail?: boolean;
};

// deno-lint-ignore no-explicit-any
function createMockSb(opts: MockOptions = {}): any {
  return {
    from(_table: string) {
      return {
        select: (_cols: string) => ({
          eq: (_col: string, _key: string) => ({
            async single() {
              if (opts.fail) {
                return { data: null, error: { message: 'simulated db error' } };
              }
              if (opts.value === undefined) {
                return { data: null, error: { message: 'not found' } };
              }
              return { data: { value: opts.value }, error: null };
            },
          }),
        }),
      };
    },
  };
}

// ============================================================
// Test 1 — 'true' → true
// ============================================================

Deno.test("isMoneyLayerEnabled: value='true' → true", async () => {
  const sb = createMockSb({ value: 'true' });
  assertEquals(await isMoneyLayerEnabled(sb), true);
});

// ============================================================
// Test 2 — 'false' → false
// ============================================================

Deno.test("isMoneyLayerEnabled: value='false' → false", async () => {
  const sb = createMockSb({ value: 'false' });
  assertEquals(await isMoneyLayerEnabled(sb), false);
});

// ============================================================
// Test 3 — Saknad nyckel → error propageras
// ============================================================

Deno.test('isMoneyLayerEnabled: saknad nyckel → error propageras fran getSettingString', async () => {
  const sb = createMockSb({ value: undefined });
  await assertRejects(
    () => isMoneyLayerEnabled(sb),
    Error,
    "Failed to fetch platform_setting 'money_layer_enabled'"
  );
});

// ============================================================
// Test 4 — Capitalized 'True' → false (strict match)
// ============================================================

Deno.test("isMoneyLayerEnabled: value='True' capitalized → false (strict match)", async () => {
  const sb = createMockSb({ value: 'True' });
  assertEquals(await isMoneyLayerEnabled(sb), false);
});

// ============================================================
// Test 5 — Sifferstrang '1' → false (strict match, inte truthy-parse)
// ============================================================

Deno.test("isMoneyLayerEnabled: value='1' → false (strict match, inte truthy-parse)", async () => {
  const sb = createMockSb({ value: '1' });
  assertEquals(await isMoneyLayerEnabled(sb), false);
});

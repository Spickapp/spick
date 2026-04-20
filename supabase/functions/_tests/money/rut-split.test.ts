/**
 * Fas 1.5 — enhetstester for calculateRutSplit() (pure function)
 *
 * Primarkalla: docs/architecture/money-layer.md §4.3
 * Skatteverket 2026: 50% av arbetskostnad, 75000 kr/ar/person tak.
 *
 * Kors med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/rut-split.test.ts
 *
 * Mock-monstret speglar commission-hierarchy.test.ts + payout-
 * calculation.test.ts.
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  calculateRutSplit,
  MoneyLayerDisabled,
  InvalidRutAmount,
  RutSplitError,
} from '../../_shared/money.ts';

// ============================================================
// Mock-helper
// ============================================================

type PlatformSettings = Record<string, string>;

// deno-lint-ignore no-explicit-any
function createMockSb(settings: PlatformSettings = {}): any {
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
      throw new Error(`mock: unexpected table '${table}'`);
    },
  };
}

const ENABLED_BASE = {
  money_layer_enabled: 'true',
  rut_pct: '50',
  rut_yearly_cap_kr: '75000',
};

// ============================================================
// Test 1 — Feature flag disabled
// ============================================================

Deno.test('calculateRutSplit: money_layer_enabled=false → MoneyLayerDisabled', async () => {
  const sb = createMockSb({ money_layer_enabled: 'false', rut_pct: '50' });

  await assertRejects(() => calculateRutSplit(sb, 1000, true), MoneyLayerDisabled);
});

// ============================================================
// Test 2 — Eligible=false + gross=1000
// ============================================================

Deno.test('calculateRutSplit: eligible=false → rut=0, customer=gross', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 1000, false);

  assertEquals(r.gross_sek, 1000);
  assertEquals(r.rut_eligible, false);
  assertEquals(r.rut_amount_sek, 0);
  assertEquals(r.customer_paid_sek, 1000);
  assertEquals(r.rut_claim_amount_sek, 0);
});

// ============================================================
// Test 3 — Eligible=true + gross=1000 + rut_pct=50
// ============================================================

Deno.test('calculateRutSplit: gross=1000 rut_pct=50 → rut=500', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 1000, true);

  assertEquals(r.gross_sek, 1000);
  assertEquals(r.rut_eligible, true);
  assertEquals(r.rut_amount_sek, 500);
  assertEquals(r.customer_paid_sek, 500);
  assertEquals(r.rut_claim_amount_sek, 500);
  // Invariant
  assertEquals(r.customer_paid_sek + r.rut_amount_sek, r.gross_sek);
});

// ============================================================
// Test 4 — Math.floor: gross=999 rut_pct=50 → 499 (av 499.5)
// ============================================================

Deno.test('calculateRutSplit: gross=999 → rut=499 (Math.floor av 499.5)', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 999, true);

  assertEquals(r.rut_amount_sek, 499);
  assertEquals(r.customer_paid_sek, 500);
  assertEquals(r.rut_claim_amount_sek, 499);
  assertEquals(r.customer_paid_sek + r.rut_amount_sek, r.gross_sek);
});

// ============================================================
// Test 5 — Math.floor: gross=1 → rut=0 (av 0.5)
// ============================================================

Deno.test('calculateRutSplit: gross=1 → rut=0 (Math.floor av 0.5)', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 1, true);

  assertEquals(r.rut_amount_sek, 0);
  assertEquals(r.customer_paid_sek, 1);
  assertEquals(r.rut_claim_amount_sek, 0);
});

// ============================================================
// Test 6 — Exakt heltal: gross=2 → rut=1
// ============================================================

Deno.test('calculateRutSplit: gross=2 → rut=1', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 2, true);

  assertEquals(r.rut_amount_sek, 1);
  assertEquals(r.customer_paid_sek, 1);
  assertEquals(r.rut_claim_amount_sek, 1);
});

// ============================================================
// Test 7 — Math.floor: gross=3 → rut=1 (av 1.5)
// ============================================================

Deno.test('calculateRutSplit: gross=3 → rut=1 (Math.floor av 1.5)', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const r = await calculateRutSplit(sb, 3, true);

  assertEquals(r.rut_amount_sek, 1);
  assertEquals(r.customer_paid_sek, 2);
  assertEquals(r.rut_claim_amount_sek, 1);
});

// ============================================================
// Test 8 — rut_pct=0 edge case
// ============================================================

Deno.test('calculateRutSplit: rut_pct=0 → rut=0, customer=gross', async () => {
  const sb = createMockSb({ ...ENABLED_BASE, rut_pct: '0' });

  const r = await calculateRutSplit(sb, 1000, true);

  assertEquals(r.rut_amount_sek, 0);
  assertEquals(r.customer_paid_sek, 1000);
  assertEquals(r.rut_claim_amount_sek, 0);
});

// ============================================================
// Test 9 — rut_pct=100 edge case
// ============================================================

Deno.test('calculateRutSplit: rut_pct=100 → rut=gross, customer=0', async () => {
  const sb = createMockSb({ ...ENABLED_BASE, rut_pct: '100' });

  const r = await calculateRutSplit(sb, 1000, true);

  assertEquals(r.rut_amount_sek, 1000);
  assertEquals(r.customer_paid_sek, 0);
  assertEquals(r.rut_claim_amount_sek, 1000);
});

// ============================================================
// Test 10 — gross=0 → InvalidRutAmount
// ============================================================

Deno.test('calculateRutSplit: gross=0 → InvalidRutAmount', async () => {
  const sb = createMockSb(ENABLED_BASE);

  await assertRejects(
    () => calculateRutSplit(sb, 0, true),
    InvalidRutAmount,
    'must be positive'
  );
});

// ============================================================
// Test 11 — gross=-100 → InvalidRutAmount
// ============================================================

Deno.test('calculateRutSplit: gross=-100 → InvalidRutAmount', async () => {
  const sb = createMockSb(ENABLED_BASE);

  await assertRejects(
    () => calculateRutSplit(sb, -100, true),
    InvalidRutAmount,
    'must be positive'
  );
});

// ============================================================
// Test 12 — gross > warn-threshold → kor men varnar
// ============================================================

Deno.test('calculateRutSplit: gross=1500000 → warn men kors', async () => {
  const sb = createMockSb(ENABLED_BASE);

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    const r = await calculateRutSplit(sb, 1_500_000, true);
    assertEquals(r.rut_amount_sek, 750_000);
    assertEquals(r.customer_paid_sek, 750_000);
    assertEquals(r.rut_claim_amount_sek, 750_000);
  } finally {
    console.warn = origWarn;
  }
  // Forvantade varningar: (1) gross > 1M, (2) rut > yearly_cap 75000
  assertEquals(warnings.length >= 1, true);
  const hasUnusuallyHigh = warnings.some((w) => w.includes('unusually high'));
  assertEquals(hasUnusuallyHigh, true);
});

// ============================================================
// Test 13 — Invariant-brott via rut_pct=Infinity → RutSplitError
// (data-korruption i platform_settings.rut_pct)
// ============================================================

Deno.test('calculateRutSplit: rut_pct=Infinity → RutSplitError (invariant)', async () => {
  const sb = createMockSb({ ...ENABLED_BASE, rut_pct: 'Infinity' });

  await assertRejects(
    () => calculateRutSplit(sb, 1000, true),
    RutSplitError,
    'invariant broken'
  );
});

// ============================================================
// Test 14 — Eligible=false override: gross=1000 OAVSETT rut_pct
// ============================================================

Deno.test('calculateRutSplit: eligible=false ignorerar rut_pct=100', async () => {
  const sb = createMockSb({ ...ENABLED_BASE, rut_pct: '100' });

  const r = await calculateRutSplit(sb, 1000, false);

  // Garanterat rut=0 oavsett rut_pct
  assertEquals(r.rut_amount_sek, 0);
  assertEquals(r.rut_eligible, false);
  assertEquals(r.customer_paid_sek, 1000);
  assertEquals(r.rut_claim_amount_sek, 0);
});

/**
 * Fas 1.4 — enhetstester for calculatePayout() (pure function)
 *
 * Primarkalla: docs/architecture/money-layer.md §4.2
 *
 * Kors med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/payout-calculation.test.ts
 *
 * Mock-monstret speglar commission-hierarchy.test.ts: from().select()
 * .eq().maybeSingle() for bookings + samma platform_settings-kedja.
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  calculatePayout,
  MoneyLayerDisabled,
  BookingNotFound,
  PayoutCalculationError,
} from '../../_shared/money.ts';

// ============================================================
// Mock-helpers
// ============================================================

type PlatformSettings = Record<string, string>;

type BookingRow = {
  total_price: number | null;
  commission_pct: number | string | null;
  stripe_fee_sek: number | string | null;
  cleaner_id?: string | null;
  company_id?: string | null;
  customer_type?: string | null;
};

type CleanerRow = { completed_jobs?: number | null; total_jobs?: number | null };

type MockOptions = {
  settings?: PlatformSettings;
  bookings?: Record<string, BookingRow>;
  cleaners?: Record<string, CleanerRow>;
};

// deno-lint-ignore no-explicit-any
function createMockSb(opts: MockOptions = {}): any {
  const settings = opts.settings ?? {};
  const bookings = opts.bookings ?? {};
  const cleaners = opts.cleaners ?? {};

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
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              async maybeSingle() {
                const row = bookings[id];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
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
      throw new Error(`mock: unexpected table '${table}'`);
    },
  };
}

const ENABLED = { money_layer_enabled: 'true', smart_trappstege_enabled: 'false' };

// ============================================================
// Test 1 — Feature flag disabled
// ============================================================

Deno.test('calculatePayout: money_layer_enabled=false → MoneyLayerDisabled', async () => {
  const sb = createMockSb({
    settings: { money_layer_enabled: 'false' },
    bookings: {
      b1: { total_price: 1000, commission_pct: 12, stripe_fee_sek: 30 },
    },
  });

  await assertRejects(() => calculatePayout(sb, 'b1'), MoneyLayerDisabled);
});

// ============================================================
// Test 2 — Booking not found
// ============================================================

Deno.test('calculatePayout: okand booking_id → BookingNotFound', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {},
  });

  await assertRejects(() => calculatePayout(sb, 'missing'), BookingNotFound);
});

// ============================================================
// Test 3 — total_price NULL
// ============================================================

Deno.test('calculatePayout: total_price=NULL → PayoutCalculationError', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: null, commission_pct: 12, stripe_fee_sek: 30 },
    },
  });

  await assertRejects(
    () => calculatePayout(sb, 'b1'),
    PayoutCalculationError,
    'Invalid total_price'
  );
});

// ============================================================
// Test 4 — Standard case
// ============================================================

Deno.test('calculatePayout: standard total=1000 pct=12 fee=30', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: 1000, commission_pct: 12, stripe_fee_sek: 30 },
    },
  });

  const r = await calculatePayout(sb, 'b1');

  assertEquals(r.total_price_sek, 1000);
  assertEquals(r.commission_pct, 12);
  assertEquals(r.commission_sek, 120);
  assertEquals(r.stripe_fee_sek, 30);
  assertEquals(r.cleaner_payout_sek, 880);
  assertEquals(r.spick_gross_sek, 120);
  assertEquals(r.spick_net_sek, 90);
  // Invariant
  assertEquals(r.cleaner_payout_sek + r.spick_net_sek + r.stripe_fee_sek, 1000);
});

// ============================================================
// Test 5 — Hog commission
// ============================================================

Deno.test('calculatePayout: hog commission total=1000 pct=17 fee=30', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '17' },
    bookings: {
      b1: { total_price: 1000, commission_pct: 17, stripe_fee_sek: 30 },
    },
  });

  const r = await calculatePayout(sb, 'b1');

  assertEquals(r.commission_sek, 170);
  assertEquals(r.cleaner_payout_sek, 830);
  assertEquals(r.spick_gross_sek, 170);
  assertEquals(r.spick_net_sek, 140);
  assertEquals(r.cleaner_payout_sek + r.spick_net_sek + r.stripe_fee_sek, 1000);
});

// ============================================================
// Test 6 — Stripe fee NULL → default 0
// ============================================================

Deno.test('calculatePayout: stripe_fee_sek=NULL → default 0, warn', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: 1000, commission_pct: 12, stripe_fee_sek: null },
    },
  });

  // Fanga console.warn
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    const r = await calculatePayout(sb, 'b1');
    assertEquals(r.stripe_fee_sek, 0);
    assertEquals(r.spick_net_sek, 120); // 120 - 0
    assertEquals(r.cleaner_payout_sek + r.spick_net_sek + r.stripe_fee_sek, 1000);
  } finally {
    console.warn = origWarn;
  }
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].includes('stripe_fee_sek NULL'), true);
});

// ============================================================
// Test 7 — commission_pct NULL → fallback getCommission()
// ============================================================

Deno.test('calculatePayout: commission_pct=NULL → fallback getCommission(), warn', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: {
        total_price: 1000,
        commission_pct: null,
        stripe_fee_sek: 30,
        cleaner_id: 'c1',
      },
    },
  });

  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  try {
    const r = await calculatePayout(sb, 'b1');
    assertEquals(r.commission_pct, 12);
    assertEquals(r.commission_sek, 120);
    assertEquals(r.cleaner_payout_sek, 880);
  } finally {
    console.warn = origWarn;
  }
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].includes('commission_pct NULL'), true);
});

// ============================================================
// Test 8 — Small amount
// ============================================================

Deno.test('calculatePayout: small amount total=100 pct=12', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: 100, commission_pct: 12, stripe_fee_sek: 3 },
    },
  });

  const r = await calculatePayout(sb, 'b1');

  assertEquals(r.commission_sek, 12);
  assertEquals(r.cleaner_payout_sek, 88);
  assertEquals(r.spick_net_sek, 9); // 12 - 3
  assertEquals(r.cleaner_payout_sek + r.spick_net_sek + r.stripe_fee_sek, 100);
});

// ============================================================
// Test 9 — Rounding
// ============================================================

Deno.test('calculatePayout: rounding total=999 pct=12 → commission=120', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: 999, commission_pct: 12, stripe_fee_sek: 0 },
    },
  });

  const r = await calculatePayout(sb, 'b1');

  // 999 * 0.12 = 119.88 → round → 120
  assertEquals(r.commission_sek, 120);
  assertEquals(r.cleaner_payout_sek, 879);
  // Invariant: 879 + 120 + 0 = 999
  assertEquals(r.cleaner_payout_sek + r.spick_net_sek + r.stripe_fee_sek, 999);
});

// ============================================================
// Test 10 — Zero total_price
// ============================================================

Deno.test('calculatePayout: total_price=0 → PayoutCalculationError', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: 0, commission_pct: 12, stripe_fee_sek: 0 },
    },
  });

  await assertRejects(
    () => calculatePayout(sb, 'b1'),
    PayoutCalculationError,
    'Invalid total_price'
  );
});

// ============================================================
// Test 11 — Negativ total_price
// ============================================================

Deno.test('calculatePayout: total_price=-100 → PayoutCalculationError', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      b1: { total_price: -100, commission_pct: 12, stripe_fee_sek: 0 },
    },
  });

  await assertRejects(
    () => calculatePayout(sb, 'b1'),
    PayoutCalculationError,
    'Invalid total_price'
  );
});

// ============================================================
// Test 12 — Data-korruption: commission_pct icke-numeriskt
//         (invariant-matematiken ar en identitet som aldrig kan
//          brytas via ren mock; simulera data-korruption istallet)
// ============================================================

Deno.test('calculatePayout: commission_pct="abc" → PayoutCalculationError', async () => {
  const sb = createMockSb({
    settings: { ...ENABLED, commission_standard: '12' },
    bookings: {
      // deno-lint-ignore no-explicit-any
      b1: { total_price: 1000, commission_pct: 'abc' as any, stripe_fee_sek: 30 },
    },
  });

  await assertRejects(
    () => calculatePayout(sb, 'b1'),
    PayoutCalculationError,
    'Non-numeric commission_pct'
  );
});

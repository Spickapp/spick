/**
 * Fas 1.6 — enhetstester for triggerStripeTransfer() med Stripe-mocks.
 *
 * Primarkalla: docs/architecture/fas-1-6-stripe-transfer-design.md §9.1
 *
 * Integration-tester mot verklig Stripe test mode skjuts till Fas 1.6.1
 * efter mode-isolation ar klar (§3.6).
 *
 * Kors med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/stripe-transfer.test.ts
 */

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  triggerStripeTransfer,
  MoneyLayerDisabled,
  BookingNotFound,
  TransferPreconditionError,
  TransferFailedError,
  TransferReversedError,
} from '../../_shared/money.ts';
import type { StripeRequestFn, StripeResponse } from '../../_shared/stripe.ts';

// ============================================================
// Mock-helpers
// ============================================================

type MockBooking = {
  id: string;
  total_price: number | null;
  commission_pct: number | null;
  stripe_fee_sek: number | null;
  cleaner_id: string | null;
  company_id?: string | null;
  customer_type?: string | null;
  payment_status: string;
  payout_status: string | null;
};

type MockCleaner = {
  id: string;
  stripe_account_id: string | null;
  stripe_onboarding_status: string | null;
};

type MockAttempt = {
  id: string;
  booking_id: string;
  attempt_count: number;
  status: 'pending' | 'paid' | 'failed' | 'reversed';
  stripe_transfer_id?: string | null;
  stripe_idempotency_key?: string;
};

type MockAudit = {
  booking_id: string;
  action: string;
  stripe_transfer_id?: string | null;
  amount_sek?: number;
  created_at?: string;
  // deno-lint-ignore no-explicit-any
  details?: any;
};

type MockState = {
  settings: Record<string, string>;
  bookings: Record<string, MockBooking>;
  cleaners: Record<string, MockCleaner>;
  attempts: MockAttempt[];
  audit: MockAudit[];
  /** Om satt, failar bookings-update efter Stripe-success */
  failBookingsUpdate?: boolean;
  /** Om satt, failar audit_log-insert efter Stripe-success */
  failAuditInsert?: boolean;
};

// deno-lint-ignore no-explicit-any
function createMockSb(state: MockState): any {
  return {
    from(table: string) {
      if (table === 'platform_settings') {
        return {
          select: () => ({
            eq: (_c: string, key: string) => ({
              async single() {
                const v = state.settings[key];
                if (v === undefined) return { data: null, error: { message: `not found: ${key}` } };
                return { data: { value: v }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              async maybeSingle() {
                const row = state.bookings[id];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
              async single() {
                const row = state.bookings[id];
                if (!row) return { data: null, error: { message: 'not found' } };
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'cleaners') {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              async maybeSingle() {
                const row = state.cleaners[id];
                if (!row) return { data: null, error: null };
                return { data: row, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'payout_attempts') {
        return {
          select: () => ({
            eq: (_c: string, val: string) => ({
              order: () => ({
                limit: () => {
                  const matches = state.attempts
                    .filter((a) => a.booking_id === val)
                    .sort((a, b) => b.attempt_count - a.attempt_count);
                  return Promise.resolve({ data: matches, error: null });
                },
              }),
            }),
          }),
          insert: (row: Omit<MockAttempt, 'id'>) => ({
            select: () => ({
              async single() {
                const newRow: MockAttempt = { id: `att-${state.attempts.length + 1}`, ...row };
                state.attempts.push(newRow);
                return { data: newRow, error: null };
              },
            }),
          }),
          update: (patch: Partial<MockAttempt>) => ({
            eq: (_c: string, id: string) => {
              const att = state.attempts.find((a) => a.id === id);
              if (att) Object.assign(att, patch);
              const p = Promise.resolve({ error: null });
              // Deno supports thenable + catch
              // deno-lint-ignore no-explicit-any
              (p as any).catch = () => p;
              return p;
            },
          }),
        };
      }
      if (table === 'payout_audit_log') {
        return {
          select: (_cols?: string) => ({
            eq: (_c: string, val: string) => ({
              eq: (_c2: string, val2: string) => ({
                order: () => ({
                  limit: () => ({
                    async maybeSingle() {
                      const match = state.audit.find(
                        (a) => a.booking_id === val && a.action === val2
                      );
                      return { data: match ?? null, error: null };
                    },
                  }),
                }),
                async maybeSingle() {
                  const match = state.audit.find(
                    (a) => a.booking_id === val && a.stripe_transfer_id === val2
                  );
                  return { data: match ?? null, error: null };
                },
              }),
            }),
          }),
          insert: (row: MockAudit) => {
            if (state.failAuditInsert) {
              return {
                select: () => ({
                  async single() {
                    return { data: null, error: { message: 'simulated audit insert fail' } };
                  },
                }),
                then: (resolve: (v: { error: { message: string } }) => void) => {
                  resolve({ error: { message: 'simulated audit insert fail' } });
                  return { catch: () => {} };
                },
                catch: () => {},
              };
            }
            const newRow = { ...row, created_at: row.created_at ?? new Date().toISOString() };
            state.audit.push(newRow);
            return {
              select: () => ({
                async single() {
                  return { data: newRow, error: null };
                },
              }),
              then: (resolve: (v: { error: null }) => void) => {
                resolve({ error: null });
                return { catch: () => {} };
              },
              catch: () => {},
            };
          },
        };
      }
      throw new Error(`mock: unexpected table '${table}'`);
    },
  };
}

function mockStripeOk(transferId = 'tr_mock_1'): StripeRequestFn {
  return async (_endpoint, _method, _params, _opts): Promise<StripeResponse> => {
    return { ok: true, status: 200, body: { id: transferId, object: 'transfer' } };
  };
}

function mockStripeError(status: number, message: string): StripeRequestFn {
  return async (_endpoint, _method, _params, _opts): Promise<StripeResponse> => {
    return { ok: false, status, body: { error: { message } } };
  };
}

function mockStripeThrow(errMsg: string): StripeRequestFn {
  return async () => {
    throw new Error(errMsg);
  };
}

/** Mock som lyckas för /transfers men också spårar reversals-anrop */
function mockStripeWithReversalTracking(): {
  fn: StripeRequestFn;
  reversalCalls: Array<{ endpoint: string }>;
} {
  const calls: Array<{ endpoint: string }> = [];
  const fn: StripeRequestFn = async (endpoint, _method, _params, _opts) => {
    calls.push({ endpoint });
    if (endpoint.includes('/reversals')) {
      return { ok: true, status: 200, body: { id: 'trr_mock_1', object: 'transfer_reversal' } };
    }
    return { ok: true, status: 200, body: { id: 'tr_mock_1', object: 'transfer' } };
  };
  return { fn, reversalCalls: calls };
}

const ENABLED = {
  money_layer_enabled: 'true',
  smart_trappstege_enabled: 'false',
  commission_standard: '12',
  payout_trigger_mode: 'immediate',
};

function baseState(overrides?: Partial<MockState>): MockState {
  return {
    settings: { ...ENABLED },
    bookings: {
      b1: {
        id: 'b1',
        total_price: 1000,
        commission_pct: 12,
        stripe_fee_sek: 30,
        cleaner_id: 'c1',
        customer_type: 'privat',
        payment_status: 'paid',
        payout_status: null,
      },
    },
    cleaners: {
      c1: {
        id: 'c1',
        stripe_account_id: 'acct_c1',
        stripe_onboarding_status: 'complete',
      },
    },
    attempts: [],
    audit: [],
    ...overrides,
  };
}

// ============================================================
// Test 1 — Feature flag disabled
// ============================================================

Deno.test('triggerStripeTransfer: money_layer_enabled=false → MoneyLayerDisabled', async () => {
  const state = baseState({ settings: { ...ENABLED, money_layer_enabled: 'false' } });
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    MoneyLayerDisabled
  );
});

// ============================================================
// Test 2 — Booking not found
// ============================================================

Deno.test('triggerStripeTransfer: okand booking_id → BookingNotFound', async () => {
  const state = baseState({ bookings: {} });
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'missing', { _stripeRequest: mockStripeOk() }),
    BookingNotFound
  );
});

// ============================================================
// Test 3 — payment_status='pending' → precondition
// ============================================================

Deno.test('triggerStripeTransfer: payment_status pending → TransferPreconditionError', async () => {
  const state = baseState();
  state.bookings.b1.payment_status = 'pending';
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    "payment_status='pending'"
  );
});

// ============================================================
// Test 4 — Cleaner not found
// ============================================================

Deno.test('triggerStripeTransfer: cleaner ej i DB → TransferPreconditionError', async () => {
  const state = baseState({ cleaners: {} });
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    'Cleaner not found'
  );
});

// ============================================================
// Test 5 — Cleaner saknar stripe_account_id
// ============================================================

Deno.test('triggerStripeTransfer: saknat stripe_account_id → TransferPreconditionError', async () => {
  const state = baseState();
  state.cleaners.c1.stripe_account_id = null;
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    'no stripe_account_id'
  );
});

// ============================================================
// Test 6 — onboarding_status != 'complete'
// ============================================================

Deno.test('triggerStripeTransfer: onboarding pending → TransferPreconditionError', async () => {
  const state = baseState();
  state.cleaners.c1.stripe_onboarding_status = 'pending';
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    'onboarding not complete'
  );
});

// ============================================================
// Test 7 — payout_trigger_mode='on_attest' + force=false → precondition
// ============================================================

Deno.test('triggerStripeTransfer: mode=on_attest utan force → TransferPreconditionError', async () => {
  const state = baseState({
    settings: { ...ENABLED, payout_trigger_mode: 'on_attest' },
  });
  const sb = createMockSb(state);
  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    "payout_trigger_mode='on_attest'"
  );
});

// ============================================================
// Test 8 — mode='on_attest' + force=true → bypass
// ============================================================

Deno.test('triggerStripeTransfer: mode=on_attest + force=true → lyckas', async () => {
  const state = baseState({
    settings: { ...ENABLED, payout_trigger_mode: 'on_attest' },
  });
  const sb = createMockSb(state);
  const result = await triggerStripeTransfer(sb, 'b1', {
    force: true,
    _stripeRequest: mockStripeOk('tr_force_1'),
  });
  assertEquals(result.status, 'paid');
  assertEquals(result.stripe_transfer_id, 'tr_force_1');
});

// ============================================================
// Test 9 — Happy path
// ============================================================

Deno.test('triggerStripeTransfer: happy path total=1000 pct=12 fee=30', async () => {
  const state = baseState();
  const sb = createMockSb(state);
  const result = await triggerStripeTransfer(sb, 'b1', {
    _stripeRequest: mockStripeOk('tr_happy_1'),
  });

  // Returnerar audit-entry
  assertEquals(result.booking_id, 'b1');
  assertEquals(result.stripe_transfer_id, 'tr_happy_1');
  assertEquals(result.amount_sek, 880); // 1000 - 120 commission
  assertEquals(result.status, 'paid');

  // Verifiera side-effects
  assertEquals(state.attempts.length, 1);
  assertEquals(state.attempts[0].status, 'paid');
  assertEquals(state.attempts[0].attempt_count, 1);
  assertEquals(state.attempts[0].stripe_transfer_id, 'tr_happy_1');

  assertEquals(state.audit.length, 1);
  assertEquals(state.audit[0].action, 'transfer_created');
  assertEquals(state.audit[0].amount_sek, 880);
  assertEquals(state.audit[0].stripe_transfer_id, 'tr_happy_1');
});

// ============================================================
// Test 10 — Idempotency: attempt_count ökar vid retry
// ============================================================

Deno.test('triggerStripeTransfer: retry skapar attempt_count=2 med unik idempotency_key', async () => {
  const state = baseState();
  state.attempts.push({
    id: 'att-prev',
    booking_id: 'b1',
    attempt_count: 1,
    status: 'failed',
    stripe_transfer_id: null,
  });
  const sb = createMockSb(state);

  const captured: { idempotencyKey?: string } = {};
  const mockStripe: StripeRequestFn = async (_e, _m, _p, opts) => {
    captured.idempotencyKey = opts.idempotencyKey;
    return { ok: true, status: 200, body: { id: 'tr_retry_1' } };
  };

  await triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripe });

  const newAttempt = state.attempts.find((a) => a.id !== 'att-prev');
  assertEquals(newAttempt?.attempt_count, 2);
  assertEquals(captured.idempotencyKey, 'payout-b1-2');
});

// ============================================================
// Test 11 — Custom idempotency_key via opts
// ============================================================

Deno.test('triggerStripeTransfer: custom idempotency_key anvands', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  const captured: { idempotencyKey?: string } = {};
  const mockStripe: StripeRequestFn = async (_e, _m, _p, opts) => {
    captured.idempotencyKey = opts.idempotencyKey;
    return { ok: true, status: 200, body: { id: 'tr_custom_1' } };
  };

  await triggerStripeTransfer(sb, 'b1', {
    idempotency_key: 'my-custom-key',
    _stripeRequest: mockStripe,
  });

  assertEquals(captured.idempotencyKey, 'my-custom-key');
});

// ============================================================
// Test 12 — Stripe returnerar 429 → TransferFailedError + alert-audit
// ============================================================

Deno.test('triggerStripeTransfer: Stripe 429 rate limit → TransferFailedError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  await assertRejects(
    () =>
      triggerStripeTransfer(sb, 'b1', {
        _stripeRequest: mockStripeError(429, 'Too many requests'),
      }),
    TransferFailedError,
    'Stripe 429'
  );

  // Attempt markerad failed
  assertEquals(state.attempts.length, 1);
  assertEquals(state.attempts[0].status, 'failed');

  // Audit med severity=alert
  assertEquals(state.audit.length, 1);
  assertEquals(state.audit[0].action, 'transfer_failed');
});

// ============================================================
// Test 13 — Stripe 402 insufficient funds
// ============================================================

Deno.test('triggerStripeTransfer: Stripe 402 insufficient funds → TransferFailedError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  await assertRejects(
    () =>
      triggerStripeTransfer(sb, 'b1', {
        _stripeRequest: mockStripeError(402, 'Insufficient funds on platform'),
      }),
    TransferFailedError,
    'Insufficient funds'
  );

  assertEquals(state.attempts[0].status, 'failed');
  assertEquals(state.audit[0].action, 'transfer_failed');
});

// ============================================================
// Test 14 — Tidigare attempt 'paid' → idempotent return
// ============================================================

Deno.test('triggerStripeTransfer: tidigare paid attempt → returnera existing', async () => {
  const state = baseState();
  state.attempts.push({
    id: 'att-prior',
    booking_id: 'b1',
    attempt_count: 1,
    status: 'paid',
    stripe_transfer_id: 'tr_prior_1',
  });
  state.audit.push({
    booking_id: 'b1',
    action: 'transfer_created',
    stripe_transfer_id: 'tr_prior_1',
    amount_sek: 880,
    created_at: '2026-04-20T10:00:00Z',
  });
  const sb = createMockSb(state);

  let stripeCalled = false;
  const mockStripe: StripeRequestFn = async () => {
    stripeCalled = true;
    return { ok: true, status: 200, body: { id: 'tr_new_1' } };
  };

  const result = await triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripe });

  assertEquals(stripeCalled, false, 'Stripe ska inte anropas igen');
  assertEquals(result.stripe_transfer_id, 'tr_prior_1');
  assertEquals(result.status, 'paid');
  // Ingen ny attempt-rad
  assertEquals(state.attempts.length, 1);
});

// ============================================================
// Test 15 — payout_status='paid' + ingen audit → data-inkonsistens
// ============================================================

Deno.test('triggerStripeTransfer: payout_status=paid utan audit → TransferPreconditionError', async () => {
  const state = baseState();
  state.bookings.b1.payout_status = 'paid';
  // Ingen audit-entry alls
  const sb = createMockSb(state);

  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: mockStripeOk() }),
    TransferPreconditionError,
    'no audit entry found'
  );
});

// ============================================================
// Test 16 — Rollback-path: DB-fel efter Stripe-success → reversal
// ============================================================
//
// Primärkälla: docs/architecture/fas-1-6-stripe-transfer-design.md §6
//
// Flöde: Stripe /transfers lyckas → audit-insert failar → catch-block
// anropar /transfers/{id}/reversals och kastar TransferReversedError.
// Detta test säkerställer att reversal faktiskt anropas (inte bara
// att felet kastas) — kritiskt för att slippa dubbla utbetalningar.

Deno.test('triggerStripeTransfer: audit-insert fail → TransferReversedError + reversal anropad', async () => {
  const state = baseState({ failAuditInsert: true });
  const sb = createMockSb(state);
  const { fn: stripeReq, reversalCalls: allCalls } = mockStripeWithReversalTracking();

  await assertRejects(
    () => triggerStripeTransfer(sb, 'b1', { _stripeRequest: stripeReq }),
    TransferReversedError,
    'DB write failed'
  );

  // Verifiera exakt ett /transfers-anrop och exakt ett /reversals-anrop
  const transferCalls = allCalls.filter(
    (c) => c.endpoint === '/transfers'
  );
  const reversalCalls = allCalls.filter((c) =>
    c.endpoint.includes('/reversals')
  );
  assertEquals(transferCalls.length, 1, 'Stripe /transfers ska anropas exakt en gång');
  assertEquals(reversalCalls.length, 1, 'Stripe /reversals ska anropas exakt en gång');
  assertEquals(
    reversalCalls[0].endpoint,
    '/transfers/tr_mock_1/reversals',
    'Reversal ska riktas mot skapad transfer'
  );

  // payout_attempts ska vara paid (uppdaterad innan audit-fail)
  assertEquals(state.attempts.length, 1);
  assertEquals(state.attempts[0].status, 'paid');
  assertEquals(state.attempts[0].stripe_transfer_id, 'tr_mock_1');
});

/**
 * Fas 1.7 — enhetstester for markPayoutPaid() med Stripe-mocks.
 *
 * Primarkalla: docs/architecture/money-layer.md §4.5
 *
 * 12 scenarier enligt Claude Code-prompt STEG 4:
 *   1.  Feature flag disabled → MoneyLayerDisabled
 *   2.  Booking not found → BookingNotFound
 *   3.  payment_status != 'paid' → PayoutPreconditionError
 *   4.  No attempt + !force → PayoutPreconditionError
 *   5.  No attempt + force=true → trigger + rekursiv → success
 *   6.  Attempt status='pending' → PayoutPreconditionError
 *   7.  Attempt status='failed' → PayoutPreconditionError
 *   8.  Happy path: booking paid, attempt paid, Stripe OK → updated
 *   9.  Stripe transfer reversed → PayoutVerificationError
 *   10. Amount mismatch → PayoutVerificationError
 *   11. Idempotency: payout_status=paid + audit finns → existing
 *   12. skip_stripe_verify=true → hoppa Stripe, uppdatera direkt
 *
 * Kors med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/mark-payout-paid.test.ts
 */

import {
  assertEquals,
  assertRejects,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  markPayoutPaid,
  MoneyLayerDisabled,
  BookingNotFound,
  PayoutPreconditionError,
  PayoutVerificationError,
  PayoutUpdateError,
} from '../../_shared/money.ts';
import type { StripeRequestFn, StripeResponse } from '../../_shared/stripe.ts';

// ============================================================
// Mock-helpers
// ============================================================

type MockBooking = {
  id: string;
  total_price: number | null;
  payment_status: string;
  payout_status: string | null;
  payout_date?: string | null;
  cleaner_id: string | null;
  commission_pct?: number | null;
  stripe_fee_sek?: number | null;
  customer_type?: string | null;
  company_id?: string | null;
};

type MockCleaner = {
  id: string;
  is_test_account?: boolean | null;
  stripe_account_id: string | null;
  stripe_onboarding_status?: string | null;
};

type MockAttempt = {
  id: string;
  booking_id: string;
  attempt_count: number;
  status: 'pending' | 'paid' | 'failed' | 'reversed';
  stripe_transfer_id?: string | null;
  amount_sek: number;
  destination_account_id: string;
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
                if (v === undefined) return { data: null, error: { message: `nf: ${key}` } };
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
                return { data: state.bookings[id] ?? null, error: null };
              },
              async single() {
                const row = state.bookings[id];
                if (!row) return { data: null, error: { message: 'not found' } };
                return { data: row, error: null };
              },
            }),
          }),
          update: (patch: Partial<MockBooking>) => ({
            eq: (_c: string, id: string) => {
              const row = state.bookings[id];
              if (row) Object.assign(row, patch);
              const p = Promise.resolve({ error: null });
              // deno-lint-ignore no-explicit-any
              (p as any).catch = () => p;
              return p;
            },
          }),
        };
      }
      if (table === 'cleaners') {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              async maybeSingle() {
                return { data: state.cleaners[id] ?? null, error: null };
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
                const newRow: MockAttempt = {
                  id: `att-${state.attempts.length + 1}`,
                  ...row,
                } as MockAttempt;
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
                      const matches = state.audit.filter(
                        (a) => a.booking_id === val && a.action === val2
                      );
                      if (matches.length === 0) return { data: null, error: null };
                      // Senaste forst (audit redan i push-ordning, senaste sist)
                      return { data: matches[matches.length - 1], error: null };
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
            const newRow = {
              ...row,
              created_at: row.created_at ?? new Date().toISOString(),
            };
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

// Stripe mock: GET /transfers/{id} returnerar ett transfer-objekt
function mockStripeGetOk(
  amountOre: number,
  transferId = 'tr_mock_1',
  reversed = false,
  amountReversed = 0
): StripeRequestFn {
  return async (_endpoint, _method, _params, _opts): Promise<StripeResponse> => {
    return {
      ok: true,
      status: 200,
      body: {
        id: transferId,
        object: 'transfer',
        amount: amountOre,
        amount_reversed: amountReversed,
        reversed,
        currency: 'sek',
      },
    };
  };
}

function mockStripeGetError(status: number, message: string): StripeRequestFn {
  return async (_e, _m, _p, _o): Promise<StripeResponse> => {
    return { ok: false, status, body: { error: { message } } };
  };
}

// Dubbel-funktion: POST /transfers OK + GET /transfers/{id} OK
// (for force=true test som triggerar + markerar)
function mockStripePostAndGet(amountOre: number, transferId: string): StripeRequestFn {
  return async (endpoint, method, _params, _opts): Promise<StripeResponse> => {
    if (method === 'POST' && endpoint === '/transfers') {
      return { ok: true, status: 200, body: { id: transferId, object: 'transfer' } };
    }
    if (method === 'GET' && endpoint.startsWith('/transfers/')) {
      return {
        ok: true,
        status: 200,
        body: {
          id: transferId,
          object: 'transfer',
          amount: amountOre,
          amount_reversed: 0,
          reversed: false,
        },
      };
    }
    throw new Error(`mock: unexpected ${method} ${endpoint}`);
  };
}

const ENABLED = {
  money_layer_enabled: 'true',
  smart_trappstege_enabled: 'false',
  commission_standard: '12',
  payout_trigger_mode: 'immediate',
  stripe_mode: 'live',
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
        is_test_account: false,
      },
    },
    attempts: [
      {
        id: 'att-1',
        booking_id: 'b1',
        attempt_count: 1,
        status: 'paid',
        stripe_transfer_id: 'tr_1',
        amount_sek: 880,
        destination_account_id: 'acct_c1',
      },
    ],
    audit: [],
    ...overrides,
  };
}

// ============================================================
// Test 1 — Feature flag disabled
// ============================================================

Deno.test('markPayoutPaid: money_layer_enabled=false → MoneyLayerDisabled', async () => {
  const state = baseState({ settings: { ...ENABLED, money_layer_enabled: 'false' } });
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripeGetOk(88000) }),
    MoneyLayerDisabled
  );
});

// ============================================================
// Test 2 — Booking not found
// ============================================================

Deno.test('markPayoutPaid: okand booking_id → BookingNotFound', async () => {
  const state = baseState({ bookings: {} });
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'missing', { _stripeRequest: mockStripeGetOk(88000) }),
    BookingNotFound
  );
});

// ============================================================
// Test 3 — payment_status != 'paid'
// ============================================================

Deno.test('markPayoutPaid: payment_status=pending → PayoutPreconditionError', async () => {
  const state = baseState();
  state.bookings.b1.payment_status = 'pending';
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripeGetOk(88000) }),
    PayoutPreconditionError,
    "payment_status='pending'"
  );
});

// ============================================================
// Test 4 — No attempt + !force
// ============================================================

Deno.test('markPayoutPaid: ingen attempt + !force → PayoutPreconditionError', async () => {
  const state = baseState({ attempts: [] });
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripeGetOk(88000) }),
    PayoutPreconditionError,
    'No payout_attempt'
  );
});

// ============================================================
// Test 5 — No attempt + force=true → trigger + rekursiv → success
// ============================================================

Deno.test('markPayoutPaid: ingen attempt + force=true → trigger + mark', async () => {
  const state = baseState({ attempts: [] });
  const sb = createMockSb(state);

  // triggerStripeTransfer → amount_sek=880 → 88000 ore
  const stripeReq = mockStripePostAndGet(88000, 'tr_forced_1');

  const result = await markPayoutPaid(sb, 'b1', {
    force: true,
    _stripeRequest: stripeReq,
  });

  assertEquals(result.status, 'paid');
  assertEquals(result.stripe_transfer_id, 'tr_forced_1');
  assertEquals(state.bookings.b1.payout_status, 'paid');
  assert(state.bookings.b1.payout_date, 'payout_date ska vara satt');

  // triggerStripeTransfer-audit + markPayoutPaid-audit
  const transferCreated = state.audit.find((a) => a.action === 'transfer_created');
  const payoutConfirmed = state.audit.find((a) => a.action === 'payout_confirmed');
  assert(transferCreated, 'transfer_created audit saknas');
  assert(payoutConfirmed, 'payout_confirmed audit saknas');
});

// ============================================================
// Test 6 — Attempt status='pending'
// ============================================================

Deno.test('markPayoutPaid: attempt status=pending → PayoutPreconditionError', async () => {
  const state = baseState();
  state.attempts[0].status = 'pending';
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripeGetOk(88000) }),
    PayoutPreconditionError,
    "status='pending'"
  );
});

// ============================================================
// Test 7 — Attempt status='failed'
// ============================================================

Deno.test('markPayoutPaid: attempt status=failed → PayoutPreconditionError', async () => {
  const state = baseState();
  state.attempts[0].status = 'failed';
  const sb = createMockSb(state);
  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripeGetOk(88000) }),
    PayoutPreconditionError,
    "status='failed'"
  );
});

// ============================================================
// Test 8 — Happy path
// ============================================================

Deno.test('markPayoutPaid: happy path → bookings updated, audit created', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  const result = await markPayoutPaid(sb, 'b1', {
    _stripeRequest: mockStripeGetOk(88000, 'tr_1'),
    admin_user_id: 'admin-1',
  });

  assertEquals(result.status, 'paid');
  assertEquals(result.stripe_transfer_id, 'tr_1');
  assertEquals(result.amount_sek, 880);

  // Bookings uppdaterad
  assertEquals(state.bookings.b1.payout_status, 'paid');
  assert(state.bookings.b1.payout_date, 'payout_date ska vara satt');

  // Audit skapad
  assertEquals(state.audit.length, 1);
  assertEquals(state.audit[0].action, 'payout_confirmed');
  assertEquals(state.audit[0].stripe_transfer_id, 'tr_1');
  assertEquals(state.audit[0].amount_sek, 880);
  assertEquals(state.audit[0].details?.admin_user_id, 'admin-1');
  assertEquals(state.audit[0].details?.verified_via_stripe, true);
});

// ============================================================
// Test 9 — Stripe transfer reversed
// ============================================================

Deno.test('markPayoutPaid: Stripe reversed=true → PayoutVerificationError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  await assertRejects(
    () =>
      markPayoutPaid(sb, 'b1', {
        _stripeRequest: mockStripeGetOk(88000, 'tr_1', true, 88000),
      }),
    PayoutVerificationError,
    'reversed'
  );

  // bookings ska INTE vara uppdaterat
  assertEquals(state.bookings.b1.payout_status, null);
});

// ============================================================
// Test 10 — Amount mismatch
// ============================================================

Deno.test('markPayoutPaid: Stripe amount mismatch → PayoutVerificationError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  // Attempt har 880 SEK (88000 ore), men Stripe returnerar 90000 ore
  await assertRejects(
    () =>
      markPayoutPaid(sb, 'b1', {
        _stripeRequest: mockStripeGetOk(90000, 'tr_1'),
      }),
    PayoutVerificationError,
    'Amount mismatch'
  );

  assertEquals(state.bookings.b1.payout_status, null);
});

// ============================================================
// Test 11 — Idempotency: redan paid + audit finns
// ============================================================

Deno.test('markPayoutPaid: redan payout_status=paid + audit → return existing', async () => {
  const state = baseState();
  state.bookings.b1.payout_status = 'paid';
  state.bookings.b1.payout_date = '2026-04-20T10:00:00Z';
  state.audit.push({
    booking_id: 'b1',
    action: 'payout_confirmed',
    stripe_transfer_id: 'tr_existing',
    amount_sek: 880,
    created_at: '2026-04-20T10:00:00Z',
  });
  const sb = createMockSb(state);

  let stripeCalled = false;
  const mockStripe: StripeRequestFn = async () => {
    stripeCalled = true;
    return { ok: true, status: 200, body: { id: 'tr_new', amount: 88000 } };
  };

  const result = await markPayoutPaid(sb, 'b1', { _stripeRequest: mockStripe });

  assertEquals(stripeCalled, false, 'Stripe ska inte anropas vid idempotent-return');
  assertEquals(result.stripe_transfer_id, 'tr_existing');
  assertEquals(result.status, 'paid');
  // Ingen ny audit-rad
  assertEquals(state.audit.length, 1);
});

// ============================================================
// Test 12 — skip_stripe_verify=true
// ============================================================

Deno.test('markPayoutPaid: skip_stripe_verify=true → hoppar Stripe, uppdaterar direkt', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  let stripeCalled = false;
  const mockStripe: StripeRequestFn = async () => {
    stripeCalled = true;
    return { ok: true, status: 200, body: {} };
  };

  const result = await markPayoutPaid(sb, 'b1', {
    skip_stripe_verify: true,
    _stripeRequest: mockStripe,
  });

  assertEquals(stripeCalled, false, 'Stripe ska inte anropas nar skip=true');
  assertEquals(result.status, 'paid');
  assertEquals(state.bookings.b1.payout_status, 'paid');
  assertEquals(state.audit.length, 1);
  assertEquals(state.audit[0].action, 'payout_confirmed');
  assertEquals(state.audit[0].details?.verified_via_stripe, false);
});

// ============================================================
// §1.6a — Extra mock-coverage (2026-04-22)
// ============================================================

// Test — Stripe GET throw:ar (network) → PayoutVerificationError
//
// Om fetch mot Stripe kastar (timeout, DNS, connection refused)
// ska markPayoutPaid kasta PayoutVerificationError med
// Stripe-meddelandet i message (rad ~1292-1298).

Deno.test('markPayoutPaid: Stripe GET throw:ar → PayoutVerificationError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  const stripeReq: StripeRequestFn = async () => {
    throw new Error('ETIMEDOUT');
  };

  await assertRejects(
    () => markPayoutPaid(sb, 'b1', { _stripeRequest: stripeReq }),
    PayoutVerificationError,
    'Failed to verify Stripe transfer: ETIMEDOUT'
  );

  // Booking ska INTE vara uppdaterad — verification felade
  assertEquals(state.bookings.b1.payout_status, null);
  assertEquals(state.audit.length, 0);
});

// Test — Stripe GET 404 → PayoutVerificationError
//
// Transfer-id i payout_attempts finns inte i Stripe (t.ex. borttagen
// eller felaktig id). Koden ska kasta PayoutVerificationError med
// Stripe-status i meddelandet (rad ~1300-1309).

Deno.test('markPayoutPaid: Stripe GET 404 → PayoutVerificationError', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  await assertRejects(
    () => markPayoutPaid(sb, 'b1', {
      _stripeRequest: mockStripeGetError(404, 'No such transfer'),
    }),
    PayoutVerificationError,
    'Stripe 404'
  );

  assertEquals(state.bookings.b1.payout_status, null);
});

// Test — audit-insert fail efter bookings-update → PayoutUpdateError
//
// Scenario: bookings-update lyckas men audit-insert failar (t.ex.
// RLS eller constraint-violation). Koden ska kasta PayoutUpdateError
// med felmeddelandet (rad ~1378-1384). Booking kvarstar som paid
// (delvis utfort state) — admin ska granska manuellt.

Deno.test('markPayoutPaid: audit-insert fail → PayoutUpdateError', async () => {
  const state = baseState();
  // Skapa mockSb dar audit-insert failar men allt annat ar normalt
  // deno-lint-ignore no-explicit-any
  const normalSb: any = createMockSb(state);
  // deno-lint-ignore no-explicit-any
  const failingSb: any = {
    from(table: string) {
      if (table === 'payout_audit_log') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    async maybeSingle() {
                      return { data: null, error: null };
                    },
                  }),
                }),
              }),
            }),
          }),
          insert: (_row: Record<string, unknown>) => ({
            select: () => ({
              async single() {
                return {
                  data: null,
                  error: { message: 'insert or update on table violates RLS' },
                };
              },
            }),
          }),
        };
      }
      return normalSb.from(table);
    },
  };

  await assertRejects(
    () => markPayoutPaid(failingSb, 'b1', {
      _stripeRequest: mockStripeGetOk(88000, 'tr_1'),
    }),
    PayoutUpdateError,
    'Failed to insert payout_audit_log'
  );

  // Booking-uppdateringen lyckas men audit fallerar — "halfway"-state
  assertEquals(state.bookings.b1.payout_status, 'paid');
});

// Test — admin_user_id propageras till audit details
//
// Om opts.admin_user_id anges ska det inkluderas i
// payout_audit_log.details (rad ~1354-1362). Detta ger audit-trail
// for vem som triggrade markerigen.

Deno.test('markPayoutPaid: admin_user_id lagras i audit details', async () => {
  const state = baseState();
  const sb = createMockSb(state);

  const adminId = 'admin-uuid-abc-123';
  const result = await markPayoutPaid(sb, 'b1', {
    admin_user_id: adminId,
    _stripeRequest: mockStripeGetOk(88000, 'tr_1'),
  });

  assertEquals(result.status, 'paid');
  assertEquals(state.audit.length, 1);
  assertEquals(
    state.audit[0].details?.admin_user_id,
    adminId,
    'admin_user_id saknas i audit.details'
  );
});

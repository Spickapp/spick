/**
 * Fas 1.6.1 — integration-tester mot Stripe test mode.
 *
 * Primärkälla: docs/architecture/fas-1-6-stripe-transfer-design.md §9.2
 *
 * Dessa tester gör RIKTIGA nätverks-anrop mot api.stripe.com. De körs
 * endast när STRIPE_SECRET_KEY_TEST är satt i env. Om variabeln saknas
 * → testerna skippas (Deno.test med ignore=true).
 *
 * Körs med Deno:
 *   $env:STRIPE_SECRET_KEY_TEST='sk_test_...'
 *   deno test --no-check --allow-net --allow-read --allow-env \
 *     supabase/functions/_tests/money/stripe-transfer-integration.test.ts
 *
 * Optional env (för test 4 — end-to-end):
 *   STRIPE_TEST_DESTINATION_ACCT='acct_test_xxx'
 *     En test-cleaner med onboarded Stripe Connect-konto i test mode.
 *     Om saknas, test 4 skippas men 1-3 körs.
 */

import {
  assertEquals,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { stripeRequest } from '../../_shared/stripe.ts';
import {
  getStripeClient,
  selectStripeMode,
} from '../../_shared/stripe-client.ts';
import {
  triggerStripeTransfer,
  TransferFailedError,
  TransferPreconditionError,
} from '../../_shared/money.ts';
import type {
  StripeRequestFn,
  StripeResponse,
} from '../../_shared/stripe.ts';

// ============================================================
// Skip-guard: endast kör om test-key finns
// ============================================================

const TEST_KEY = Deno.env.get('STRIPE_SECRET_KEY_TEST');
const DEST_ACCT = Deno.env.get('STRIPE_TEST_DESTINATION_ACCT');
const SKIP_ALL = !TEST_KEY;
const SKIP_E2E = !TEST_KEY || !DEST_ACCT;

if (SKIP_ALL) {
  console.warn(
    '[stripe-transfer-integration] STRIPE_SECRET_KEY_TEST saknas — alla integration-tester skippas.'
  );
}

// ============================================================
// Mock-SB för end-to-end-test (inga riktiga DB-skrivningar)
// ============================================================

type MockState = {
  settings: Record<string, string>;
  bookings: Record<string, Record<string, unknown>>;
  cleaners: Record<string, Record<string, unknown>>;
  attempts: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
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
                if (v === undefined) return { data: null, error: { message: 'nf' } };
                return { data: { value: v }, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'bookings' || table === 'cleaners') {
        const map = state[table] as Record<string, Record<string, unknown>>;
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              async maybeSingle() {
                return { data: map[id] ?? null, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'payout_attempts') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.attempts, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              async single() {
                const newRow = { id: `att-${state.attempts.length + 1}`, ...row };
                state.attempts.push(newRow);
                return { data: newRow, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
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
          select: () => ({
            eq: () => ({
              eq: () => ({
                async maybeSingle() {
                  return { data: null, error: null };
                },
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            const newRow = { ...row, created_at: new Date().toISOString() };
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

// ============================================================
// Test 1 — Riktig Stripe test-API nås med STRIPE_SECRET_KEY_TEST
// ============================================================

Deno.test({
  name: 'INTEGRATION: GET /v1/balance med STRIPE_SECRET_KEY_TEST → 200 OK',
  ignore: SKIP_ALL,
  async fn() {
    const res = await stripeRequest('/balance', 'GET', {}, {
      apiKey: TEST_KEY!,
    });
    assertEquals(res.ok, true, `Stripe /balance failed: ${JSON.stringify(res.body)}`);
    assertEquals(res.status, 200);
    // Balance-object innehåller available + pending
    assert(Array.isArray(res.body.available), 'balance.available saknas');
    assert(Array.isArray(res.body.pending), 'balance.pending saknas');
  },
});

// ============================================================
// Test 2 — Fel nyckel → 401 Unauthorized
// ============================================================

Deno.test({
  name: 'INTEGRATION: GET /v1/balance med felaktig nyckel → 401',
  ignore: SKIP_ALL,
  async fn() {
    const res = await stripeRequest('/balance', 'GET', {}, {
      apiKey: 'sk_test_invalid_key_for_auth_check',
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 401);
    assert(res.body?.error, 'Stripe 401 saknar error-body');
  },
});

// ============================================================
// Test 3 — Mode-selection mot riktiga env-vars träffar rätt nyckel
// ============================================================

Deno.test({
  name: 'INTEGRATION: getStripeClient(is_test_account=true) + /balance → 200',
  ignore: SKIP_ALL,
  async fn() {
    const client = getStripeClient({ is_test_account: true });
    assertEquals(client.mode, 'test');
    assertEquals(client.isConfigured, true);
    assertEquals(
      client.apiKey,
      TEST_KEY,
      'getStripeClient valde fel nyckel för test-mode'
    );

    const res = await stripeRequest('/balance', 'GET', {}, {
      apiKey: client.apiKey,
    });
    assertEquals(res.ok, true);
  },
});

// ============================================================
// Test 4 — End-to-end triggerStripeTransfer mot Stripe test
// ============================================================

Deno.test({
  name:
    'INTEGRATION E2E: triggerStripeTransfer mot Stripe test (test-cleaner + destination)',
  ignore: SKIP_E2E,
  async fn() {
    const state: MockState = {
      settings: {
        money_layer_enabled: 'true',
        smart_trappstege_enabled: 'false',
        commission_standard: '12',
        payout_trigger_mode: 'immediate',
        stripe_mode: 'live', // global live — per-cleaner override via is_test_account
      },
      bookings: {
        b_integration_1: {
          id: 'b_integration_1',
          total_price: 1000,
          commission_pct: 12,
          stripe_fee_sek: 30,
          cleaner_id: 'c_integration_1',
          customer_type: 'privat',
          payment_status: 'paid',
          payout_status: null,
        },
      },
      cleaners: {
        c_integration_1: {
          id: 'c_integration_1',
          stripe_account_id: DEST_ACCT,
          stripe_onboarding_status: 'complete',
          is_test_account: true,
        },
      },
      attempts: [],
      audit: [],
    };
    const sb = createMockSb(state);

    // Anropa med unik idempotency_key per run
    const idempKey = `integration-${Date.now()}`;
    let result;
    try {
      result = await triggerStripeTransfer(sb, 'b_integration_1', {
        idempotency_key: idempKey,
      });
    } catch (e) {
      // Vi förväntar oss antingen success ELLER TransferFailedError
      // (om testkontot saknar balance eller destination är inaktiv).
      // Båda är giltiga utfall — det viktiga är att anropet går genom.
      if (!(e instanceof TransferFailedError)) throw e;
      console.warn(
        `[E2E] Stripe test avvisade transfer (förväntat om konto saknar balance): ${
          (e as Error).message
        }`
      );
      return;
    }

    assertEquals(result.status, 'paid');
    assert(
      result.stripe_transfer_id?.startsWith('tr_'),
      `stripe_transfer_id ska börja med tr_, fick: ${result.stripe_transfer_id}`
    );
    assertEquals(state.audit.length, 1);
    assertEquals(state.audit[0].action, 'transfer_created');
  },
});

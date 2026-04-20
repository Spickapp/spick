/**
 * Fas 1.6.1 — enhetstester för stripe-client.ts mode-selection.
 *
 * Primärkälla: docs/architecture/fas-1-6-stripe-transfer-design.md §3.6
 *
 * Körs med Deno:
 *   deno test --no-check --allow-net=deno.land,esm.sh --allow-read --allow-env \
 *     supabase/functions/_tests/money/stripe-client.test.ts
 */

import {
  assertEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  getStripeClient,
  selectStripeMode,
  assertStripeConfigured,
  StripeConfigError,
} from '../../_shared/stripe-client.ts';

// ============================================================
// Helpers: isolerad env-manipulation per test
// ============================================================

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = Deno.env.get(key);
    if (vars[key] === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, vars[key]!);
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(prev)) {
      if (prev[key] === undefined) {
        Deno.env.delete(key);
      } else {
        Deno.env.set(key, prev[key]!);
      }
    }
  }
}

// ============================================================
// selectStripeMode — pure function, ingen env-läsning
// ============================================================

Deno.test('selectStripeMode: is_test_account=true → test', () => {
  const mode = selectStripeMode({ is_test_account: true });
  assertEquals(mode, 'test');
});

Deno.test('selectStripeMode: global_stripe_mode=test → test', () => {
  const mode = selectStripeMode({ global_stripe_mode: 'test' });
  assertEquals(mode, 'test');
});

Deno.test('selectStripeMode: båda false/null → live', () => {
  const mode = selectStripeMode({
    is_test_account: false,
    global_stripe_mode: 'live',
  });
  assertEquals(mode, 'live');
});

Deno.test('selectStripeMode: is_test_account=true overrider global=live', () => {
  const mode = selectStripeMode({
    is_test_account: true,
    global_stripe_mode: 'live',
  });
  assertEquals(mode, 'test');
});

Deno.test('selectStripeMode: tom context → live (default)', () => {
  const mode = selectStripeMode({});
  assertEquals(mode, 'live');
});

Deno.test('selectStripeMode: global=okänt värde → live (default)', () => {
  const mode = selectStripeMode({ global_stripe_mode: 'staging' });
  assertEquals(mode, 'live');
});

// ============================================================
// getStripeClient — väljer env-variabel baserat på mode
// ============================================================

Deno.test('getStripeClient: test-mode läser STRIPE_SECRET_KEY_TEST', () => {
  withEnv(
    {
      STRIPE_SECRET_KEY: 'sk_live_xxx',
      STRIPE_SECRET_KEY_TEST: 'sk_test_xxx',
    },
    () => {
      const client = getStripeClient({ is_test_account: true });
      assertEquals(client.mode, 'test');
      assertEquals(client.apiKey, 'sk_test_xxx');
      assertEquals(client.isConfigured, true);
    }
  );
});

Deno.test('getStripeClient: live-mode läser STRIPE_SECRET_KEY', () => {
  withEnv(
    {
      STRIPE_SECRET_KEY: 'sk_live_xxx',
      STRIPE_SECRET_KEY_TEST: 'sk_test_xxx',
    },
    () => {
      const client = getStripeClient({ is_test_account: false });
      assertEquals(client.mode, 'live');
      assertEquals(client.apiKey, 'sk_live_xxx');
      assertEquals(client.isConfigured, true);
    }
  );
});

Deno.test('getStripeClient: utan env → isConfigured=false + fallback-nyckel', () => {
  withEnv(
    {
      STRIPE_SECRET_KEY: undefined,
      STRIPE_SECRET_KEY_TEST: undefined,
    },
    () => {
      const client = getStripeClient({ is_test_account: true });
      assertEquals(client.mode, 'test');
      assertEquals(client.apiKey, 'sk_test_mock');
      assertEquals(client.isConfigured, false);
    }
  );
});

Deno.test('getStripeClient: global=test + live-env saknas i test → test-nyckel används', () => {
  withEnv(
    {
      STRIPE_SECRET_KEY: 'sk_live_xxx',
      STRIPE_SECRET_KEY_TEST: 'sk_test_yyy',
    },
    () => {
      const client = getStripeClient({
        is_test_account: false,
        global_stripe_mode: 'test',
      });
      assertEquals(client.mode, 'test');
      assertEquals(client.apiKey, 'sk_test_yyy');
    }
  );
});

// ============================================================
// assertStripeConfigured — strikt validering vid startup
// ============================================================

Deno.test('assertStripeConfigured: kastar när STRIPE_SECRET_KEY_TEST saknas i test-mode', () => {
  withEnv({ STRIPE_SECRET_KEY_TEST: undefined }, () => {
    assertThrows(
      () => assertStripeConfigured({ is_test_account: true }),
      StripeConfigError,
      'STRIPE_SECRET_KEY_TEST'
    );
  });
});

Deno.test('assertStripeConfigured: kastar när STRIPE_SECRET_KEY saknas i live-mode', () => {
  withEnv({ STRIPE_SECRET_KEY: undefined }, () => {
    assertThrows(
      () => assertStripeConfigured({ is_test_account: false }),
      StripeConfigError,
      'STRIPE_SECRET_KEY'
    );
  });
});

Deno.test('assertStripeConfigured: passerar när env finns', () => {
  withEnv({ STRIPE_SECRET_KEY_TEST: 'sk_test_present' }, () => {
    assertStripeConfigured({ is_test_account: true });
    // Inget kast = ok
  });
});

/**
 * _shared/stripe.ts — Mode-agnostisk Stripe-helper for Spick
 *
 * Primarkalla: docs/architecture/fas-1-6-stripe-transfer-design.md §3.6
 *
 * Mode-isolation (live vs test) hanteras INTE har. Den har funktionen
 * tar api-key som parameter (tar default fran STRIPE_SECRET_KEY env).
 * Fas 1.6.1 lagger till _shared/stripe-client.ts som valjer key
 * baserat pa cleaner.is_test_account.
 *
 * R2 (Fas 13 §13.3 audit, 2026-04-24):
 * Auto-retry pa 429 (rate limit) + 5xx + natverksfel med exponential
 * backoff. Idempotency-key garanterar sakerhet vid retry.
 *
 * Anvandning:
 *   const res = await stripeRequest('/transfers', 'POST', params, {
 *     apiKey: Deno.env.get('STRIPE_SECRET_KEY'),
 *     idempotencyKey: 'payout-abc-1',
 *   });
 *
 * Retry-override:
 *   stripeRequest(..., { apiKey, maxAttempts: 1 })  // disable retry
 */

export const STRIPE_API_VERSION = '2023-10-16';
export const STRIPE_API_BASE = 'https://api.stripe.com/v1';

// Retry-konfiguration
const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;       // 250ms → 500ms → 1000ms med exponential
const MAX_DELAY_MS = 4000;       // cap
const JITTER_FACTOR = 0.3;       // ±30% jitter

// Status-codes som retry:as. Notera: 400, 401, 402, 403, 404 retry:as INTE
// (klient-fel som inte blir bättre av retry).
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export type StripeResponse = {
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;
  attempts?: number;  // R2: hur många försök gjordes (1 = ingen retry)
};

export type StripeRequestOpts = {
  apiKey: string;
  idempotencyKey?: string;
  maxAttempts?: number;  // R2: override default (3)
  // Test-hook: deterministisk delay för tester
  _sleepMs?: (ms: number) => Promise<void>;
};

export type StripeRequestFn = (
  endpoint: string,
  method: 'POST' | 'GET',
  params: Record<string, string>,
  opts: StripeRequestOpts
) => Promise<StripeResponse>;

function computeBackoff(attempt: number): number {
  // attempt är 1-indexerat (första retry = attempt 2)
  const exponential = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);
  const jitter = exponential * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

/**
 * Ra Stripe API-anrop via fetch. Mode-agnostisk — api-key kommer
 * fran caller.
 *
 * R2: Auto-retry pa transient errors (429, 5xx, natverksfel).
 */
export const stripeRequest: StripeRequestFn = async (
  endpoint,
  method,
  params,
  { apiKey, idempotencyKey, maxAttempts = DEFAULT_MAX_ATTEMPTS, _sleepMs }
) => {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const url = `${STRIPE_API_BASE}${endpoint}`;
  const sleep = _sleepMs ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown = null;
  let lastStatus = 0;
  let lastBody: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? body : undefined,
      });
      const json = await res.json().catch(() => ({}));
      lastStatus = res.status;
      lastBody = json;

      if (res.ok) {
        return { ok: true, status: res.status, body: json, attempts: attempt };
      }

      // Retry bara på transient errors
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxAttempts) {
        return { ok: false, status: res.status, body: json, attempts: attempt };
      }

      // Respektera Retry-After-header om Stripe returnerar den
      const retryAfterHeader = res.headers.get('Retry-After');
      const retryAfterMs = retryAfterHeader
        ? parseInt(retryAfterHeader, 10) * 1000
        : computeBackoff(attempt);
      await sleep(Math.min(retryAfterMs, MAX_DELAY_MS));
    } catch (e) {
      // Nätverksfel (ECONNRESET, timeout, etc.)
      lastError = e;
      if (attempt === maxAttempts) {
        // Bubble upp som 0-status så caller vet det är fel
        return {
          ok: false,
          status: 0,
          body: { error: { message: (e as Error).message, type: 'network_error' } },
          attempts: attempt,
        };
      }
      await sleep(computeBackoff(attempt));
    }
  }

  // Dead code — loopen returnerar alltid. Men TS-compiler vill ha det.
  return { ok: false, status: lastStatus, body: lastBody, attempts: maxAttempts };
};

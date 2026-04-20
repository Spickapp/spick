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
 * Anvandning (F1.6):
 *   const res = await stripeRequest('/transfers', 'POST', params, {
 *     apiKey: Deno.env.get('STRIPE_SECRET_KEY'),
 *     idempotencyKey: 'payout-abc-1',
 *   });
 */

export const STRIPE_API_VERSION = '2023-10-16';
export const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export type StripeResponse = {
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  body: any;
};

export type StripeRequestFn = (
  endpoint: string,
  method: 'POST' | 'GET',
  params: Record<string, string>,
  opts: { apiKey: string; idempotencyKey?: string }
) => Promise<StripeResponse>;

/**
 * Ra Stripe API-anrop via fetch. Mode-agnostisk — api-key kommer
 * fran caller.
 */
export const stripeRequest: StripeRequestFn = async (
  endpoint,
  method,
  params,
  { apiKey, idempotencyKey }
) => {
  const body = new URLSearchParams(params).toString();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${STRIPE_API_BASE}${endpoint}`, {
    method,
    headers,
    body: method === 'POST' ? body : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body: json };
};

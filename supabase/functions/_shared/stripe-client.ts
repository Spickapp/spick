/**
 * _shared/stripe-client.ts — Stripe mode-selection för Spick (Fas 1.6.1)
 *
 * Primärkälla: docs/architecture/fas-1-6-stripe-transfer-design.md §3.6
 *
 * Syfte: Välj rätt Stripe-nyckel (live vs test) baserat på kontext.
 *        - Global default: platform_settings.stripe_mode
 *        - Per-cleaner override: cleaners.is_test_account=true
 *
 * Semantik (test-vinner):
 *   is_test_account=true       → test mode (override)
 *   stripe_mode='test'         → test mode (global)
 *   båda false/null            → live mode (default)
 *
 * Regler: #27 (primärkälla §3.6), #28 (central), #30 (API-version låst)
 *
 * Användning i money.ts:
 *   const client = getStripeClient({
 *     is_test_account: cleaner.is_test_account,
 *     global_stripe_mode: await getSettingString(sb, 'stripe_mode'),
 *   });
 *   await stripeRequest('/transfers', 'POST', params, {
 *     apiKey: client.apiKey, idempotencyKey,
 *   });
 */

export type StripeMode = 'live' | 'test';

export type StripeClientConfig = {
  apiKey: string;
  mode: StripeMode;
  /** true om env var faktiskt satt; false = fallback-nyckel används */
  isConfigured: boolean;
};

export type ClientSelectContext = {
  is_test_account?: boolean | null;
  global_stripe_mode?: string | null;
};

/**
 * Kastas när asserted config saknas (env var ej satt).
 * Används av assertStripeConfigured() — inte av getStripeClient().
 */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(`StripeConfigError: ${message}`);
    this.name = 'StripeConfigError';
  }
}

/**
 * Bestäm mode för given kontext. Pure function — ingen env-läsning.
 *
 * Test-vinner-semantik: om antingen cleaner eller global flagg säger
 * 'test' → test mode. Default till 'live' för säkerhet (live är
 * produktions-standard; test krävs explicit).
 */
export function selectStripeMode(ctx: ClientSelectContext): StripeMode {
  if (ctx.is_test_account === true) return 'test';
  if (ctx.global_stripe_mode === 'test') return 'test';
  return 'live';
}

/**
 * Returnerar rätt Stripe-nyckel baserat på kontext.
 *
 * Env-variabler:
 *   live-mode → STRIPE_SECRET_KEY
 *   test-mode → STRIPE_SECRET_KEY_TEST
 *
 * Om env saknas: returnerar 'sk_test_mock' som apiKey och
 * isConfigured=false. Detta tillåter tester att köra utan env-setup
 * medan prod-startup ska anropa assertStripeConfigured() för att
 * validera.
 */
export function getStripeClient(ctx: ClientSelectContext): StripeClientConfig {
  const mode = selectStripeMode(ctx);
  const envName = mode === 'test' ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY';
  const apiKey = Deno.env.get(envName);
  return {
    apiKey: apiKey ?? 'sk_test_mock',
    mode,
    isConfigured: Boolean(apiKey),
  };
}

/**
 * Strikt validering — kastar StripeConfigError om rätt env-var saknas.
 *
 * Anropas vid startup av Edge Functions som ska göra riktiga Stripe-
 * anrop (ej mocks). Säkerställer att fel nyckel inte går genom tyst
 * via fallback-värdet i getStripeClient().
 */
export function assertStripeConfigured(ctx: ClientSelectContext): void {
  const client = getStripeClient(ctx);
  if (!client.isConfigured) {
    const envName =
      client.mode === 'test' ? 'STRIPE_SECRET_KEY_TEST' : 'STRIPE_SECRET_KEY';
    throw new StripeConfigError(
      `Missing env var ${envName} for mode='${client.mode}'`
    );
  }
}

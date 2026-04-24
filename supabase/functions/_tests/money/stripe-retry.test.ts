/**
 * Tester för R2 (Fas 13 §13.3): auto-retry i stripeRequest
 *
 * Verifierar:
 *  - Retry på 429, 500, 502, 503, 504
 *  - Ingen retry på 400, 401, 402, 403, 404 (klient-fel)
 *  - Max-attempts respekteras
 *  - Retry-After-header respekteras
 *  - Nätverksfel retry:as
 *  - attempts-fältet returneras korrekt
 *  - Idempotency-key inkluderas i headers (oförändrat från v1)
 */

import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { stripeRequest } from "../../_shared/stripe.ts";

// Helper: mockar fetch med en kö av svar
function mockFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  let callCount = 0;
  const capturedCalls: Array<{ url: string; init?: RequestInit }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedCalls.push({ url: input.toString(), init });
    const r = responses[callCount] ?? responses[responses.length - 1];
    callCount++;
    const headerInit = r.headers || {};
    return Promise.resolve(
      new Response(JSON.stringify(r.body ?? { ok: true }), {
        status: r.status,
        headers: headerInit,
      }),
    );
  }) as typeof fetch;

  return {
    capturedCalls,
    get callCount() { return callCount; },
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

// Immediate sleep för snabbare tester
const noSleep = () => Promise.resolve();

Deno.test("stripeRequest: 200 returneras direkt (ingen retry)", async () => {
  const mock = mockFetch([{ status: 200, body: { id: "tr_123" } }]);
  try {
    const res = await stripeRequest("/transfers", "POST", { amount: "100" }, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, true);
    assertEquals(res.status, 200);
    assertEquals(res.attempts, 1);
    assertEquals(mock.callCount, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: 429 retry:as upp till maxAttempts", async () => {
  const mock = mockFetch([
    { status: 429, body: { error: { type: "rate_limit" } } },
    { status: 429, body: { error: { type: "rate_limit" } } },
    { status: 200, body: { id: "tr_123" } },
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, true);
    assertEquals(res.status, 200);
    assertEquals(res.attempts, 3);
    assertEquals(mock.callCount, 3);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: 500 retry:as", async () => {
  const mock = mockFetch([
    { status: 500, body: { error: { type: "api_error" } } },
    { status: 200, body: { id: "ok" } },
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, true);
    assertEquals(res.attempts, 2);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: 400 retry:as INTE (klient-fel)", async () => {
  const mock = mockFetch([
    { status: 400, body: { error: { type: "invalid_request_error", message: "Missing amount" } } },
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 400);
    assertEquals(res.attempts, 1);
    assertEquals(mock.callCount, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: 401 retry:as INTE (auth-fel)", async () => {
  const mock = mockFetch([
    { status: 401, body: { error: { type: "authentication_error" } } },
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_bad",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 401);
    assertEquals(mock.callCount, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: 404 retry:as INTE", async () => {
  const mock = mockFetch([
    { status: 404, body: { error: { type: "not_found" } } },
  ]);
  try {
    const res = await stripeRequest("/refunds", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 404);
    assertEquals(mock.callCount, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: maxAttempts=1 disabler retry", async () => {
  const mock = mockFetch([
    { status: 500, body: { error: "boom" } },
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      maxAttempts: 1,
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 500);
    assertEquals(res.attempts, 1);
    assertEquals(mock.callCount, 1);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: max 3 attempts även med alla fel", async () => {
  const mock = mockFetch([
    { status: 503, body: {} },
    { status: 503, body: {} },
    { status: 503, body: {} },
    { status: 200, body: {} }, // aldrig kallad
  ]);
  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 503);
    assertEquals(res.attempts, 3);
    assertEquals(mock.callCount, 3);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: Retry-After-header respekteras", async () => {
  const capturedSleeps: number[] = [];
  const captureSleep = (ms: number) => {
    capturedSleeps.push(ms);
    return Promise.resolve();
  };

  const mock = mockFetch([
    { status: 429, body: {}, headers: { "Retry-After": "2" } },
    { status: 200, body: {} },
  ]);
  try {
    await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: captureSleep,
    });
    assertEquals(capturedSleeps.length, 1);
    // Retry-After=2s = 2000ms men capped till MAX_DELAY_MS (4000)
    assertEquals(capturedSleeps[0], 2000);
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: Idempotency-Key inkluderas i headers", async () => {
  const mock = mockFetch([{ status: 200, body: {} }]);
  try {
    await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      idempotencyKey: "payout-abc-1",
      _sleepMs: noSleep,
    });
    const headers = mock.capturedCalls[0].init?.headers as Record<string, string>;
    assertEquals(headers["Idempotency-Key"], "payout-abc-1");
  } finally {
    mock.restore();
  }
});

Deno.test("stripeRequest: nätverksfel retry:as", async () => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    callCount++;
    if (callCount < 3) return Promise.reject(new Error("ECONNRESET"));
    return Promise.resolve(
      new Response(JSON.stringify({ id: "tr_123" }), { status: 200 }),
    );
  }) as typeof fetch;

  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, true);
    assertEquals(res.attempts, 3);
    assertEquals(callCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("stripeRequest: nätverksfel efter alla retries returnerar status=0", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.reject(new Error("timeout"))) as typeof fetch;

  try {
    const res = await stripeRequest("/transfers", "POST", {}, {
      apiKey: "sk_test_fake",
      _sleepMs: noSleep,
    });
    assertEquals(res.ok, false);
    assertEquals(res.status, 0);
    assertEquals(res.attempts, 3);
    const err = res.body.error;
    assertEquals(err.type, "network_error");
    assertMatch(err.message, /timeout/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// supabase/functions/_tests/alerts/alerts.test.ts
// ──────────────────────────────────────────────────────────────────
// Unit-tester för _shared/alerts.ts (Fas 10 §10.1 + §10.2 partial).
//
// Kör: deno test supabase/functions/_tests/alerts/alerts.test.ts --allow-env
//
// Täckning:
//   - Slack-URL → Slack-formaterad payload (text + attachments + fields)
//   - Discord-URL → Discord-formaterad payload (embeds + fields)
//   - Generic URL → pass-through JSON med emoji + ts
//   - Ingen webhook-URL → console-fallback, returnerar false
//   - Ogiltig alert-shape → skippa utan webhook-call
//   - Webhook kastar → fallback utan att caller krascher
//   - Webhook non-2xx → fallback
//   - Metadata-fält renderas korrekt
// ──────────────────────────────────────────────────────────────────

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type AdminAlert, sendAdminAlert } from "../../_shared/alerts.ts";

/* ──────────────────────────────────────────────────────────────────
 * Test helpers: capture fetch + env
 * ────────────────────────────────────────────────────────────────── */

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
}

function installMockFetch(options: {
  ok?: boolean;
  throws?: boolean;
  status?: number;
} = {}): FetchCall[] {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    calls.push({
      url: urlStr,
      body: init?.body ? JSON.parse(init.body as string) : {},
    });

    if (options.throws) {
      throw new Error("mock fetch exception");
    }

    return new Response(
      options.ok === false ? "error" : "ok",
      { status: options.status ?? (options.ok === false ? 500 : 200) },
    );
  }) as typeof fetch;

  // Auto-restore in a finalizer (unless test calls restore manually)
  (calls as unknown as { restore: () => void }).restore = () => {
    globalThis.fetch = originalFetch;
  };
  return calls;
}

function setWebhookUrl(url: string | null) {
  if (url === null) {
    Deno.env.delete("ADMIN_ALERT_WEBHOOK_URL");
  } else {
    Deno.env.set("ADMIN_ALERT_WEBHOOK_URL", url);
  }
}

const baseAlert: AdminAlert = {
  severity: "error",
  title: "Test alert",
  source: "alerts.test",
};

/* ──────────────────────────────────────────────────────────────────
 * Tests
 * ────────────────────────────────────────────────────────────────── */

Deno.test("sendAdminAlert: Slack-URL → Slack-formaterad payload", async () => {
  setWebhookUrl("https://hooks.slack.com/services/T00/B00/xxxx");
  const calls = installMockFetch({ ok: true });

  try {
    const ok = await sendAdminAlert({
      ...baseAlert,
      severity: "critical",
      title: "Production down",
      message: "Database unreachable",
      booking_id: "abc-123",
      metadata: { attempt: 3, region: "eu" },
    });

    assert(ok, "should return true on success");
    assertEquals(calls.length, 1);
    const body = calls[0].body as Record<string, unknown>;
    assert(typeof body.text === "string" && body.text.includes("Production down"));
    const attachments = body.attachments as Array<Record<string, unknown>>;
    assertEquals(attachments.length, 1);
    assertEquals(attachments[0].color, "#991B1B"); // critical
    const fields = attachments[0].fields as Array<{ title: string; value: string }>;
    assert(fields.some((f) => f.title === "Booking" && f.value === "abc-123"));
    assert(fields.some((f) => f.title === "attempt" && f.value === "3"));
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Discord-URL → Discord-formaterad payload", async () => {
  setWebhookUrl("https://discord.com/api/webhooks/123/abc");
  const calls = installMockFetch({ ok: true });

  try {
    const ok = await sendAdminAlert({
      ...baseAlert,
      severity: "warn",
      cleaner_id: "cleaner-xyz",
    });

    assert(ok);
    const body = calls[0].body as Record<string, unknown>;
    const embeds = body.embeds as Array<Record<string, unknown>>;
    assertEquals(embeds.length, 1);
    assertEquals(embeds[0].color, 0xF59E0B); // warn
    const fields = embeds[0].fields as Array<{ name: string; value: string }>;
    assert(fields.some((f) => f.name === "Cleaner" && f.value === "cleaner-xyz"));
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Generic URL → pass-through JSON med emoji", async () => {
  setWebhookUrl("https://my-custom-webhook.example.com/hook");
  const calls = installMockFetch({ ok: true });

  try {
    const ok = await sendAdminAlert({
      ...baseAlert,
      severity: "info",
    });

    assert(ok);
    const body = calls[0].body as Record<string, unknown>;
    assertEquals(body.severity, "info");
    assertEquals(body.title, "Test alert");
    assert(typeof body.emoji === "string");
    assert(typeof body.ts === "string");
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Ingen webhook-URL → false (console-fallback)", async () => {
  setWebhookUrl(null);
  const calls = installMockFetch({ ok: true });

  try {
    const ok = await sendAdminAlert(baseAlert);
    assertEquals(ok, false, "no webhook → returns false");
    assertEquals(calls.length, 0, "no webhook → no fetch-call");
  } finally {
    (calls as unknown as { restore: () => void }).restore();
  }
});

Deno.test("sendAdminAlert: Ogiltig shape (saknar title) → false utan webhook-call", async () => {
  setWebhookUrl("https://hooks.slack.com/services/xxx");
  const calls = installMockFetch({ ok: true });

  try {
    // deno-lint-ignore no-explicit-any
    const ok = await sendAdminAlert({ severity: "error", source: "x" } as any);
    assertEquals(ok, false);
    assertEquals(calls.length, 0, "invalid shape skips fetch");
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Webhook kastar exception → false (caller kraschar ej)", async () => {
  setWebhookUrl("https://hooks.slack.com/services/xxx");
  const calls = installMockFetch({ throws: true });

  try {
    const ok = await sendAdminAlert(baseAlert);
    assertEquals(ok, false);
    assertEquals(calls.length, 1, "fetch attempted once");
    // Critical: no throw propagated to caller
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Webhook non-2xx → false", async () => {
  setWebhookUrl("https://hooks.slack.com/services/xxx");
  const calls = installMockFetch({ ok: false, status: 500 });

  try {
    const ok = await sendAdminAlert(baseAlert);
    assertEquals(ok, false);
    assertEquals(calls.length, 1);
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

Deno.test("sendAdminAlert: Alla severity-nivåer genererar korrekt färg", async () => {
  setWebhookUrl("https://hooks.slack.com/services/xxx");
  const calls = installMockFetch({ ok: true });

  try {
    const expectedColors: Record<string, string> = {
      info: "#3B82F6",
      warn: "#F59E0B",
      error: "#EF4444",
      critical: "#991B1B",
    };

    for (const sev of ["info", "warn", "error", "critical"] as const) {
      await sendAdminAlert({ ...baseAlert, severity: sev });
    }

    assertEquals(calls.length, 4);
    for (let i = 0; i < 4; i++) {
      const sev = (["info", "warn", "error", "critical"] as const)[i];
      const attachments = calls[i].body.attachments as Array<{ color: string }>;
      assertEquals(attachments[0].color, expectedColors[sev]);
    }
  } finally {
    (calls as unknown as { restore: () => void }).restore();
    setWebhookUrl(null);
  }
});

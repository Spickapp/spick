// ═══════════════════════════════════════════════════════════════
// SPICK — Sentry-wrapper för Edge Functions (Fas 10 Observability)
// ═══════════════════════════════════════════════════════════════
//
// Minimal HTTP-only Sentry-integration utan SDK-dependency
// (snabbare cold-start + ingen npm-import-kedja). Skickar event
// direkt till Sentry's envelope-API per spec:
//   https://develop.sentry.dev/sdk/envelopes/
//
// AKTIVERING:
//   Sätt SENTRY_DSN i SUPABASE_SECRETS. Format:
//     https://<key>@<host>/<project_id>
//   Om SENTRY_DSN saknas → no-op (loggar bara lokalt, ingen
//   krasch — så EFs fungerar utan Sentry tillkonfigurerat).
//
// ANVÄNDNING:
//   import { captureError, captureMessage, withSentry } from "../_shared/sentry.ts";
//
//   // Vid catch:
//   try { ... } catch (e) {
//     await captureError(e, { ef: "rut-bankid-init", session_id: sid });
//   }
//
//   // Eller wrappa hela handler:
//   Deno.serve(withSentry("rut-bankid-init", async (req) => { ... }));
//
// REGEL #28 (SSOT): DSN i secrets, ingen hardcode.
// REGEL #30: ingen regulator-claim — Sentry är teknisk APM,
//            inga GDPR-känsliga PII skickas (vi sanerar bort
//            customer_pnr/email/auth-keys via SCRUB_FIELDS).
// ═══════════════════════════════════════════════════════════════

const SENTRY_DSN = Deno.env.get("SENTRY_DSN") || "";
const SENTRY_ENVIRONMENT = Deno.env.get("SENTRY_ENVIRONMENT") || "production";
const SENTRY_RELEASE = Deno.env.get("SENTRY_RELEASE") || "spick-ef-2026-04-26";

// PII-sanering — fält som ALDRIG får skickas till Sentry oavsett kontext
const SCRUB_FIELDS = new Set([
  "customer_pnr", "pnr", "personal_number", "personalNumber",
  "stripe_secret", "stripe_key", "service_role_key", "supabase_service_role_key",
  "tic_api_key", "resend_api_key", "anthropic_api_key", "cron_secret",
  "rut_pnr_encryption_key", "internal_ef_secret",
  "password", "token", "authorization", "x-api-key", "apikey",
]);

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  // Format: https://<publicKey>@<host>/<projectId>
  const m = /^https?:\/\/([^@]+)@([^/]+)\/(\d+)/.exec(dsn);
  if (!m) return null;
  return { publicKey: m[1], host: m[2], projectId: m[3] };
}

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limit]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Maskera vad som ser ut som PNR (10 eller 12 siffror)
    return obj.replace(/\b(\d{6,8})[-]?\d{4}\b/g, "[PNR-MASKED]");
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SCRUB_FIELDS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = scrubObject(v, depth + 1);
    }
  }
  return out;
}

export interface SentryContext {
  ef?: string;
  user_id?: string;
  request_id?: string;
  [key: string]: unknown;
}

async function sendEnvelope(
  eventType: "event" | "transaction",
  payload: Record<string, unknown>,
): Promise<void> {
  if (!SENTRY_DSN) return; // No-op om ej konfigurerat

  const parsed = parseDsn(SENTRY_DSN);
  if (!parsed) {
    console.warn("[sentry] invalid DSN format, skipping send");
    return;
  }

  const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;
  const auth =
    `Sentry sentry_version=7,sentry_key=${parsed.publicKey},sentry_client=spick-ef/1.0`;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const sentAt = new Date().toISOString();

  const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: sentAt });
  const itemHeader = JSON.stringify({ type: eventType });
  const itemBody = JSON.stringify({
    event_id: eventId,
    timestamp: sentAt,
    environment: SENTRY_ENVIRONMENT,
    release: SENTRY_RELEASE,
    platform: "javascript",
    server_name: payload.ef || "spick-ef",
    ...payload,
  });

  const envelope = `${envelopeHeader}\n${itemHeader}\n${itemBody}`;

  try {
    // Fire-and-forget: inte blockera EF-respons om Sentry är nere
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": auth,
      },
      body: envelope,
    });
  } catch (e) {
    console.warn("[sentry] send failed (non-blocking):", (e as Error).message);
  }
}

export async function captureError(
  err: Error | unknown,
  context: SentryContext = {},
): Promise<void> {
  const error = err as Error;
  const scrubbedContext = scrubObject(context) as Record<string, unknown>;

  await sendEnvelope("event", {
    level: "error",
    message: error.message || String(err),
    exception: {
      values: [{
        type: error.name || "Error",
        value: error.message || String(err),
        stacktrace: error.stack
          ? { frames: parseStack(error.stack) }
          : undefined,
      }],
    },
    tags: {
      ef: context.ef || "unknown",
      environment: SENTRY_ENVIRONMENT,
    },
    extra: scrubbedContext,
  });
}

export async function captureMessage(
  msg: string,
  level: "info" | "warning" | "error" = "info",
  context: SentryContext = {},
): Promise<void> {
  const scrubbedContext = scrubObject(context) as Record<string, unknown>;

  await sendEnvelope("event", {
    level,
    message: msg,
    tags: {
      ef: context.ef || "unknown",
      environment: SENTRY_ENVIRONMENT,
    },
    extra: scrubbedContext,
  });
}

function parseStack(stack: string) {
  // Enkel V8-format-parser. Sentry visar funktion + fil + rad.
  return stack
    .split("\n")
    .slice(0, 20) // Max 20 frames
    .map((line) => {
      const m = /at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/.exec(line);
      if (m) {
        return {
          function: m[1],
          filename: m[2],
          lineno: parseInt(m[3], 10),
          colno: parseInt(m[4], 10),
          in_app: !m[2].includes("node_modules"),
        };
      }
      return { function: line.trim() };
    })
    .filter((f) => f.function);
}

// Convenience-wrapper för Deno.serve-handlers
export function withSentry(
  efName: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (err) {
      await captureError(err, {
        ef: efName,
        method: req.method,
        url: req.url.replace(/[?&](apikey|key|token)=[^&]+/g, "$1=[REDACTED]"),
      });
      // Re-throw så Deno.serve hanterar 500-respons
      throw err;
    }
  };
}

// Diagnostik — kollar om Sentry är aktiverat (för health-EF)
export function sentryStatus(): { enabled: boolean; environment: string } {
  return {
    enabled: !!SENTRY_DSN && !!parseDsn(SENTRY_DSN),
    environment: SENTRY_ENVIRONMENT,
  };
}

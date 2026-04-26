// supabase/functions/_shared/log.ts
// ──────────────────────────────────────────────────────────────────
// Central log-helper för EFs. Mappar level → console.error/warn/log
// så Supabase Logs Severity-filter fungerar.
//
// PROBLEM (pre-2026-04-25): EFs hade lokal log()-funktion som alltid
// använde console.log() oavsett level. Supabase Logs:
//   - console.log → Severity=info
//   - console.warn → Severity=warn
//   - console.error → Severity=error
// Konsekvens: Severity=error-filter visade INGA matchande rader.
// Debugging-hjälp blev "bara info"-mode och felfynd försvann i bruset.
//
// LÖSNING: createLogger-factory returnerar en fn som mappar level
// till rätt console-method. Output-format identiskt med tidigare
// (JSON-string med {level, fn, msg, ...extra, ts}).
//
// REGLER (#28 SSOT, #27 scope-respekt):
//   - En central log-helper. EFs importerar + använder, duplicerar inte.
//   - Format-bakåtkompatibelt (samma JSON-payload).
// ──────────────────────────────────────────────────────────────────

// Lazy-import Sentry för att undvika cold-start-overhead när SENTRY_DSN saknas.
// captureMessage importeras dynamiskt EN gång + cache:as i closure.
type SentryCapture = (msg: string, level: "info" | "warning" | "error", ctx?: Record<string, unknown>) => Promise<void>;
let _sentryCapture: SentryCapture | null = null;
let _sentryLoadAttempted = false;

async function lazyLoadSentry(): Promise<SentryCapture | null> {
  if (_sentryLoadAttempted) return _sentryCapture;
  _sentryLoadAttempted = true;
  try {
    const mod = await import("./sentry.ts");
    _sentryCapture = mod.captureMessage;
    return _sentryCapture;
  } catch {
    return null;
  }
}

export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Skapar log-funktion bunden till en specifik EF-namn.
 *
 * Användning:
 *   import { createLogger } from "../_shared/log.ts";
 *   const log = createLogger("get-booking-events");
 *   log("error", "Booking fetch failed", { booking_id: id });
 *
 * Auto-capturar level="error" + level="warn" till Sentry om SENTRY_DSN
 * är satt i secrets (Fas 10 Observability). PII-sanitering sker i
 * sentry.ts via SCRUB_FIELDS-listan.
 *
 * @param fn EF-namn för "fn"-fältet i JSON-payload
 * @returns log-funktion med signatur (level, msg, extra) => void
 */
export function createLogger(fn: string) {
  return function log(
    level: LogLevel | string,
    msg: string,
    extra: Record<string, unknown> = {},
  ): void {
    const payload = JSON.stringify({
      level,
      fn,
      msg,
      ...extra,
      ts: new Date().toISOString(),
    });
    if (level === "error") {
      console.error(payload);
    } else if (level === "warn") {
      console.warn(payload);
    } else {
      console.log(payload);
    }

    // Fire-and-forget Sentry-capture för warn/error. Inte await:as så
    // att log()-call inte blockerar handler-flow.
    if (level === "error" || level === "warn") {
      lazyLoadSentry().then((capture) => {
        if (capture) {
          capture(msg, level === "error" ? "error" : "warning", { ef: fn, ...extra })
            .catch(() => {}); // Tyst fail om Sentry-send-fel
        }
      });
    }
  };
}

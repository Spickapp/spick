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

export type LogLevel = "info" | "warn" | "error" | "debug";

/**
 * Skapar log-funktion bunden till en specifik EF-namn.
 *
 * Användning:
 *   import { createLogger } from "../_shared/log.ts";
 *   const log = createLogger("get-booking-events");
 *   log("error", "Booking fetch failed", { booking_id: id });
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
  };
}

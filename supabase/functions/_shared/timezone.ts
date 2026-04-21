// ─────────────────────────────────────────────────────────────
// SPICK – Tidszon-hjälpare
// ─────────────────────────────────────────────────────────────
// Problem: Supabase Edge Functions körs på UTC-servrar (Deno).
// new Date("2026-04-22T08:00:00") tolkas som UTC, men booking_time
// i DB lagras som svensk lokaltid (Europe/Stockholm).
//
// Utan timezone-aware parsing blir alla tidsjämförelser 1-2h off
// (1h vintertid, 2h sommartid pga DST).
//
// Konvention: 'Europe/Stockholm' matchar platform_settings.company_timezone
// (seedad i 20260423_f2_7_1_b2b_schema.sql). Hårdkodad här för performance
// — ingen DB-lookup per anrop i hot paths.
// ─────────────────────────────────────────────────────────────

const SWEDEN_TZ = "Europe/Stockholm";

/**
 * Tolkar ett svenskt lokaldatum + lokaltid och returnerar
 * motsvarande UTC-Date. DST-säker via Intl.DateTimeFormat.
 *
 * @param dateStr YYYY-MM-DD (t.ex. "2026-04-22")
 * @param timeStr HH:MM eller HH:MM:SS (t.ex. "08:00" eller "08:00:00")
 * @returns Date-objekt som representerar motsvarande UTC-tidsstämpel
 *
 * @example
 * parseStockholmTime("2026-04-22", "08:00")
 * // vintertid: returnerar Date(2026-04-22T07:00:00Z)
 * // sommartid: returnerar Date(2026-04-22T06:00:00Z)
 */
export function parseStockholmTime(dateStr: string, timeStr: string): Date {
  // Normalisera time till HH:MM:SS
  const time = timeStr.length === 5 ? `${timeStr}:00` : timeStr;

  // Bygg en initial Date som om strängen var UTC (dvs "naiv")
  const naive = new Date(`${dateStr}T${time}Z`);

  // Använd Intl för att få ut vad den naiva UTC-tiden ser ut som i Stockholm
  // Genom att jämföra kan vi räkna ut offsetten för just detta datum (DST-medveten)
  const sthlmFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SWEDEN_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  const parts = sthlmFormatter.formatToParts(naive);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "0";

  // Återbygg som om parts var UTC-tid
  const sthlmAsUTC = Date.UTC(
    parseInt(get("year")),
    parseInt(get("month")) - 1,
    parseInt(get("day")),
    parseInt(get("hour")),
    parseInt(get("minute")),
    parseInt(get("second")),
  );

  // Offsetten = skillnaden mellan "vad klockan visar i Stockholm för naiv UTC-input"
  // och "vad den naiva UTC-timestamp är i ms"
  const offset = sthlmAsUTC - naive.getTime();

  // Korrigera: naive.getTime() - offset = korrekt UTC-timestamp för "SEK-lokaltid som strängen representerade"
  return new Date(naive.getTime() - offset);
}

/**
 * Formaterar ett datum som "22 april 2026" på svenska, tidszon-säkert.
 * Null-safe: returnerar "–" vid tom input.
 *
 * Används av auto-delegate, company-propose-substitute,
 * customer-approve-proposal för notifikationsmeddelanden.
 */
export function formatStockholmDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "–";
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: SWEDEN_TZ,
      day: "numeric", month: "long", year: "numeric",
    }).format(new Date(`${dateStr}T12:00:00Z`));
  } catch {
    return "–";
  }
}

/**
 * Formaterar ett datum som "tisdagen den 22 april 2026" på svenska, tidszon-säkert.
 * Inkluderar veckodag. Null-safe: returnerar "–" vid tom input.
 *
 * Används av cleaner-booking-response för cleaner-notifikationer
 * där veckodag är relevant kontext.
 */
export function formatStockholmDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return "–";
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: SWEDEN_TZ,
      weekday: "long", year: "numeric", month: "long", day: "numeric",
    }).format(new Date(`${dateStr}T12:00:00Z`));
  } catch {
    return "–";
  }
}

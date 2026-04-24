// _shared/holidays.ts — Fas 5 §5.11
// ═══════════════════════════════════════════════════════════════
// Helper för swedish_holidays-tabellen. Används av auto-rebook för
// att skippa eller flytta bokningar som landar på allmän helgdag.
//
// Rule #28 SSOT: alla holiday-frågor via denna helper. Ingen
// hardcoded holiday-lista i andra EFs.
// Rule #30: helgdagar är fakta per kalenderlagen, inte regulator-gissning.
// ═══════════════════════════════════════════════════════════════

// deno-lint-ignore no-explicit-any
export type HolidayClient = any;

export interface SwedishHoliday {
  holiday_date: string; // YYYY-MM-DD
  name: string;
}

let _cachedHolidays: Map<string, string> | null = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 timme — helgdagar ändras inte

async function ensureCache(sb: HolidayClient): Promise<Map<string, string>> {
  const now = Date.now();
  if (_cachedHolidays && now - _cacheLoadedAt < CACHE_TTL_MS) {
    return _cachedHolidays;
  }
  const { data, error } = await sb
    .from("swedish_holidays")
    .select("holiday_date, name");
  const map = new Map<string, string>();
  if (!error && data) {
    for (const h of data as SwedishHoliday[]) {
      map.set(h.holiday_date, h.name);
    }
  }
  _cachedHolidays = map;
  _cacheLoadedAt = now;
  return map;
}

/**
 * Returnerar namnet på helgdag om datum är rött, annars null.
 * date: YYYY-MM-DD
 */
export async function isHoliday(
  sb: HolidayClient,
  date: string,
): Promise<string | null> {
  const cache = await ensureCache(sb);
  return cache.get(date) ?? null;
}

/**
 * Shiftar ett datum framåt till närmaste icke-helgdag.
 * Max 30 försök (safety). Returnerar input om inget skift hittas.
 */
export async function nextNonHoliday(
  sb: HolidayClient,
  date: string,
  maxDays = 30,
): Promise<string> {
  let current = date;
  for (let i = 0; i < maxDays; i++) {
    const holiday = await isHoliday(sb, current);
    if (!holiday) return current;
    const [y, m, d] = current.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    current = dt.toISOString().slice(0, 10);
  }
  return current; // fallback — borde aldrig nås med 30 dagars max
}

/**
 * Rensa cache (för tester eller efter manuell uppdatering).
 */
export function resetHolidayCache(): void {
  _cachedHolidays = null;
  _cacheLoadedAt = 0;
}

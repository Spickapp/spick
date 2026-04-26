// supabase/functions/_shared/chargeback-buffer.ts
// ──────────────────────────────────────────────────────────────────
// Chargeback-buffer Etapp 1 (2026-04-26) — helpers + flag-gating.
//
// SYFTE:
//   Reservera 5% av cleaner-share per Stripe-transfer som intern buffer.
//   Frigör efter 180 dagar (chargeback-fönster passerat). Vid chargeback
//   inom fönstret: dra från buffer först.
//
// FLAG-GATE: platform_settings.chargeback_buffer_enabled
//   - 'false' (default) = funktionerna no-op:ar (returnerar tom reserved=0)
//   - 'true' = aktiv (Etapp 2-4 implementeras separat)
//
// SCOPE: Etapp 1 = bara helpers + DB-access. Ingen integration med
//   triggerStripeTransfer ännu (Etapp 2 kräver Farhad-OK + jurist).
//
// REGLER: #26 N/A (ny fil), #27 scope (bara buffer-helpers), #28 SSOT
//   (alla buffer-rörelser går via dessa funktioner), #30 inga regulator-
//   claims (BokfL/Konkurslagen behandlas i design-doc, inte här), #31
//   schema curl-verifierat 2026-04-26 (chargeback_buffer + log existerar
//   ej före migration; verifieras igen efter migration körs i prod).
// ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface SupabaseChargebackClient {
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
}

export interface BufferStatus {
  buffer_id: string | null;
  balance_ore: bigint;
  total_reserved_lifetime_ore: bigint;
  total_released_lifetime_ore: bigint;
  total_consumed_lifetime_ore: bigint;
  last_reserved_at: string | null;
  last_released_at: string | null;
}

export interface ReserveResult {
  enabled: boolean;
  reserved_ore: bigint;
  transfer_ore: bigint;
  buffer_id: string | null;
  log_id: string | null;
  reason: string;
}

export interface ReleaseResult {
  released_count: number;
  total_released_ore: bigint;
}

export interface ConsumeResult {
  consumed_ore: bigint;
  shortfall_ore: bigint;
  escalate_needed: boolean;
}

export const BUFFER_DEFAULT_PCT = 5;
export const BUFFER_DEFAULT_RELEASE_DAYS = 180;

// ============================================================
// Flag-läsning
// ============================================================

/**
 * Returnerar true om chargeback_buffer_enabled = 'true' i platform_settings.
 * Default: false (säker — Etapp 2-4 kräver explicit Farhad-aktivering).
 */
export async function isBufferEnabled(supabase: SupabaseChargebackClient): Promise<boolean> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "chargeback_buffer_enabled")
    .maybeSingle();
  return (data?.value as string | undefined) === "true";
}

/**
 * Returnerar konfigurerad buffer-procent (default 5).
 */
export async function getBufferPct(supabase: SupabaseChargebackClient): Promise<number> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "chargeback_buffer_pct")
    .maybeSingle();
  const v = Number(data?.value);
  return isFinite(v) && v > 0 && v <= 100 ? v : BUFFER_DEFAULT_PCT;
}

/**
 * Returnerar konfigurerad release-period i dagar (default 180).
 */
export async function getBufferReleaseDays(supabase: SupabaseChargebackClient): Promise<number> {
  const { data } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "chargeback_buffer_release_days")
    .maybeSingle();
  const v = Number(data?.value);
  return isFinite(v) && v > 0 ? v : BUFFER_DEFAULT_RELEASE_DAYS;
}

// ============================================================
// Buffer-helpers
// ============================================================

/**
 * Hämtar (eller skapar) buffer-rad för company eller cleaner.
 * XOR: exakt en av company_id / cleaner_id måste vara satt.
 */
async function getOrCreateBuffer(
  supabase: SupabaseChargebackClient,
  opts: { companyId?: string; cleanerId?: string },
): Promise<{ id: string; balance_ore: bigint } | null> {
  if (!!opts.companyId === !!opts.cleanerId) {
    throw new Error("getOrCreateBuffer: exact one of companyId / cleanerId required");
  }
  const filterCol = opts.companyId ? "company_id" : "cleaner_id";
  const filterVal = opts.companyId ?? opts.cleanerId;

  const { data: existing } = await supabase
    .from("chargeback_buffer")
    .select("id, balance_ore")
    .eq(filterCol, filterVal)
    .maybeSingle();
  if (existing) {
    return {
      id: existing.id as string,
      balance_ore: BigInt(existing.balance_ore as string | number),
    };
  }

  // Skapa ny rad
  const insertRow: Record<string, unknown> = { balance_ore: 0 };
  insertRow[filterCol] = filterVal;
  const { data: created, error } = await supabase
    .from("chargeback_buffer")
    .insert(insertRow)
    .select("id, balance_ore")
    .maybeSingle();
  if (error || !created) return null;
  return {
    id: created.id as string,
    balance_ore: BigInt(created.balance_ore as string | number),
  };
}

/**
 * Reservera buffer för en booking-transfer.
 *
 * Etapp 1: returnerar bara beräkning + cache-update OM enabled. Annars
 * no-op (transfer_ore = cleanerShareOre, reserved_ore = 0).
 *
 * Säker att kalla ENS från triggerStripeTransfer i Etapp 2 — om flaggan
 * är OFF så har den ingen effekt på money-flow.
 */
export async function reserveBufferForBooking(opts: {
  supabase: SupabaseChargebackClient;
  bookingId: string;
  companyId?: string;
  cleanerId?: string;
  cleanerShareOre: bigint;
}): Promise<ReserveResult> {
  if (!await isBufferEnabled(opts.supabase)) {
    return {
      enabled: false,
      reserved_ore: 0n,
      transfer_ore: opts.cleanerShareOre,
      buffer_id: null,
      log_id: null,
      reason: "buffer_disabled",
    };
  }

  const pct = await getBufferPct(opts.supabase);
  const reservedOre = (opts.cleanerShareOre * BigInt(Math.round(pct * 100))) / 10000n;
  const transferOre = opts.cleanerShareOre - reservedOre;

  if (reservedOre <= 0n) {
    return {
      enabled: true,
      reserved_ore: 0n,
      transfer_ore: opts.cleanerShareOre,
      buffer_id: null,
      log_id: null,
      reason: "amount_too_small",
    };
  }

  const buf = await getOrCreateBuffer(opts.supabase, {
    companyId: opts.companyId,
    cleanerId: opts.cleanerId,
  });
  if (!buf) {
    return {
      enabled: true,
      reserved_ore: 0n,
      transfer_ore: opts.cleanerShareOre,
      buffer_id: null,
      log_id: null,
      reason: "buffer_create_failed",
    };
  }

  const balanceBefore = buf.balance_ore;

  // Atomic increment via RPC
  const { data: newBalance, error: incErr } = await opts.supabase.rpc(
    "increment_chargeback_buffer_balance",
    { p_buffer_id: buf.id, p_delta_ore: Number(reservedOre) },
  );
  if (incErr) {
    return {
      enabled: true,
      reserved_ore: 0n,
      transfer_ore: opts.cleanerShareOre,
      buffer_id: buf.id,
      log_id: null,
      reason: "increment_failed",
    };
  }
  const balanceAfter = BigInt(newBalance as string | number);

  // Logg-rad
  const nowIso = new Date().toISOString();
  await opts.supabase
    .from("chargeback_buffer")
    .update({
      total_reserved_lifetime_ore: Number(balanceAfter), // approximation; rättas i Etapp 2 RPC
      last_reserved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", buf.id);

  const { data: logRow } = await opts.supabase
    .from("chargeback_buffer_log")
    .insert({
      buffer_id: buf.id,
      booking_id: opts.bookingId,
      action: "reserve",
      amount_ore: Number(reservedOre),
      balance_before_ore: Number(balanceBefore),
      balance_after_ore: Number(balanceAfter),
      reason: `${pct}% reservation av cleaner-share ${opts.cleanerShareOre} öre`,
    })
    .select("id")
    .maybeSingle();

  return {
    enabled: true,
    reserved_ore: reservedOre,
    transfer_ore: transferOre,
    buffer_id: buf.id,
    log_id: (logRow?.id as string) ?? null,
    reason: "reserved",
  };
}

/**
 * Frigör reservationer äldre än release-perioden (180 dagar default).
 * Returnerar count + total ore.
 *
 * Implementeras i Etapp 3. Här bara stub som returnerar 0.
 */
export async function releaseExpiredReservations(
  _supabase: SupabaseChargebackClient,
): Promise<ReleaseResult> {
  return { released_count: 0, total_released_ore: 0n };
}

/**
 * Konsumera buffer vid chargeback. Returnerar shortfall om buffer otillräcklig.
 *
 * Implementeras i Etapp 4. Här bara stub.
 */
export async function consumeBufferForChargeback(_opts: {
  supabase: SupabaseChargebackClient;
  chargebackId: string;
  bookingId: string;
  amountOre: bigint;
}): Promise<ConsumeResult> {
  return { consumed_ore: 0n, shortfall_ore: 0n, escalate_needed: false };
}

/**
 * Hämtar buffer-status för VD-dashboard.
 */
export async function getBufferStatus(opts: {
  supabase: SupabaseChargebackClient;
  companyId?: string;
  cleanerId?: string;
}): Promise<BufferStatus> {
  if (!!opts.companyId === !!opts.cleanerId) {
    throw new Error("getBufferStatus: exact one of companyId / cleanerId required");
  }
  const filterCol = opts.companyId ? "company_id" : "cleaner_id";
  const filterVal = opts.companyId ?? opts.cleanerId;

  const { data } = await opts.supabase
    .from("chargeback_buffer")
    .select("id, balance_ore, total_reserved_lifetime_ore, total_released_lifetime_ore, total_consumed_lifetime_ore, last_reserved_at, last_released_at")
    .eq(filterCol, filterVal)
    .maybeSingle();

  if (!data) {
    return {
      buffer_id: null,
      balance_ore: 0n,
      total_reserved_lifetime_ore: 0n,
      total_released_lifetime_ore: 0n,
      total_consumed_lifetime_ore: 0n,
      last_reserved_at: null,
      last_released_at: null,
    };
  }

  return {
    buffer_id: data.id as string,
    balance_ore: BigInt(data.balance_ore as string | number),
    total_reserved_lifetime_ore: BigInt(data.total_reserved_lifetime_ore as string | number),
    total_released_lifetime_ore: BigInt(data.total_released_lifetime_ore as string | number),
    total_consumed_lifetime_ore: BigInt(data.total_consumed_lifetime_ore as string | number),
    last_reserved_at: (data.last_reserved_at as string | null) ?? null,
    last_released_at: (data.last_released_at as string | null) ?? null,
  };
}

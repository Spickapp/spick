// supabase/functions/_shared/sms-billing.ts
// ──────────────────────────────────────────────────────────────────
// SMS-saldo per cleaner-owner — Sprint A (2026-04-26)
//
// SYFTE:
//   Logga + debitera VD/cleaner-owner per skickat SMS via 46elks.
//   0,52 kr/segment (160 tecken) default. Saldo dras vid utbetalning.
//
// FLAG-GATE: platform_settings.sms_billing_enabled
//   - 'false' (default) = bara loggas (för analys), ingen debitering
//   - 'true' = aktiv debitering (Sprint B-D implementeras separat)
//
// SCOPE: Sprint A = bara helpers + DB-access. Sprint B (sendSms-wrapper-
//   utvidgning) integration kräver Farhad-OK + jurist på moms-fråga.
//
// REGLER: #26 N/A (ny fil), #27 scope (bara billing-helpers), #28 SSOT
//   (alla SMS-billing-rörelser via dessa funktioner), #30 inga regulator-
//   claims (moms 25% behandlas i design-doc, inte här), #31 schema
//   curl-verifierat 2026-04-26 (sms_log + company_sms_balance existerar
//   ej före migration).
// ──────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
export interface SupabaseSmsClient {
  from: (table: string) => any;
  // deno-lint-ignore no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => any;
}

export interface SmsBillingConfig {
  enabled: boolean;
  price_per_segment_ore: number;
  throttle_ore: number;
}

export interface SmsLogResult {
  enabled: boolean;
  logged: boolean;
  charged: boolean;
  segment_count: number;
  total_charge_ore: number;
  log_id: string | null;
  reason: string;
}

export interface CompanySmsBalance {
  company_id: string;
  balance_ore: bigint;
  total_charged_lifetime_ore: bigint;
  total_settled_lifetime_ore: bigint;
  last_charged_at: string | null;
  last_settled_at: string | null;
}

export const SMS_DEFAULT_PRICE_ORE = 52;
export const SMS_SEGMENT_LENGTH = 160;
export const SMS_DEFAULT_THROTTLE_ORE = 100000; // 1000 kr

// ============================================================
// Beräknings-helpers
// ============================================================

/**
 * Beräknar antal SMS-segment för ett meddelande.
 * 160-tecken-segment standard (GSM-7-encoding).
 *
 * NOTERA: Unicode-tecken (åäö, emoji) gör segmentet 70 tecken istället
 * för 160. Här använder vi enkel approximation (160). Sprint B kan
 * utöka för UCS-2-detection om viktigt.
 */
export function calcSegments(message: string): number {
  if (!message) return 0;
  return Math.max(1, Math.ceil(message.length / SMS_SEGMENT_LENGTH));
}

/**
 * Returnerar sista 4 siffror av telefon (för PII-min audit).
 */
export function phoneSuffix(phone: string): string {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.slice(-4);
}

/**
 * Returnerar billing_period 'YYYY-MM' för en given datum.
 */
export function billingPeriod(d: Date = new Date()): string {
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yr}-${mo}`;
}

// ============================================================
// Flag-läsning
// ============================================================

/**
 * Hämtar nuvarande SMS-billing-config från platform_settings.
 * Returnerar defaults om värden saknas.
 */
export async function getSmsBillingConfig(supabase: SupabaseSmsClient): Promise<SmsBillingConfig> {
  const { data: enabledRow } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "sms_billing_enabled")
    .maybeSingle();
  const enabled = (enabledRow?.value as string | undefined) === "true";

  const { data: priceRow } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "sms_price_per_segment_ore")
    .maybeSingle();
  const priceVal = Number(priceRow?.value);
  const price = isFinite(priceVal) && priceVal > 0 ? priceVal : SMS_DEFAULT_PRICE_ORE;

  const { data: throttleRow } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "sms_billing_throttle_ore")
    .maybeSingle();
  const throttleVal = Number(throttleRow?.value);
  const throttle = isFinite(throttleVal) && throttleVal > 0 ? throttleVal : SMS_DEFAULT_THROTTLE_ORE;

  return { enabled, price_per_segment_ore: price, throttle_ore: throttle };
}

// ============================================================
// SMS-loggning + debitering
// ============================================================

/**
 * Loggar ett skickat SMS i sms_log + (om enabled) ökar saldo i
 * company_sms_balance.
 *
 * Sprint A: kallas EXPLICIT från sendSms-wrappers. Sprint B integrerar
 * detta automatiskt.
 *
 * SUCCESS-ONLY-CHARGE: kalla bara denna funktion EFTER 46elks bekräftat
 * leverans (inte vid fail).
 */
export async function logSmsAndCharge(opts: {
  supabase: SupabaseSmsClient;
  companyId: string | null;
  triggeredByCleanerId: string | null;
  recipientPhone: string;
  message: string;
  providerMessageId?: string | null;
  smsProvider?: string;
  isSystemSms?: boolean;
}): Promise<SmsLogResult> {
  const cfg = await getSmsBillingConfig(opts.supabase);
  const segments = calcSegments(opts.message);
  const totalCharge = segments * cfg.price_per_segment_ore;
  const period = billingPeriod();
  const isSystem = opts.isSystemSms === true;

  // Logga ALLTID (även om disabled — för analys-data + framtida billing)
  const insertRow: Record<string, unknown> = {
    company_id: opts.companyId,
    triggered_by_cleaner_id: opts.triggeredByCleanerId,
    recipient_phone_suffix: phoneSuffix(opts.recipientPhone),
    message_excerpt: (opts.message || "").slice(0, 50),
    segment_count: segments,
    price_per_segment_ore: cfg.price_per_segment_ore,
    total_charge_ore: totalCharge,
    sms_provider: opts.smsProvider || "46elks",
    provider_message_id: opts.providerMessageId ?? null,
    billing_period: period,
    billing_status: isSystem ? "system" : (cfg.enabled && opts.companyId ? "pending" : "waived"),
  };
  const { data: logRow, error: logErr } = await opts.supabase
    .from("sms_log")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (logErr) {
    return {
      enabled: cfg.enabled,
      logged: false,
      charged: false,
      segment_count: segments,
      total_charge_ore: totalCharge,
      log_id: null,
      reason: "log_insert_failed",
    };
  }

  const logId = (logRow?.id as string) ?? null;

  // Debitera bara om: enabled + företag har company_id + inte system-SMS
  if (!cfg.enabled) {
    return {
      enabled: false,
      logged: true,
      charged: false,
      segment_count: segments,
      total_charge_ore: totalCharge,
      log_id: logId,
      reason: "billing_disabled",
    };
  }
  if (!opts.companyId) {
    return {
      enabled: true,
      logged: true,
      charged: false,
      segment_count: segments,
      total_charge_ore: totalCharge,
      log_id: logId,
      reason: "no_company_id",
    };
  }
  if (isSystem) {
    return {
      enabled: true,
      logged: true,
      charged: false,
      segment_count: segments,
      total_charge_ore: totalCharge,
      log_id: logId,
      reason: "system_sms_not_billable",
    };
  }

  // Atomic increment via RPC
  const { error: incErr } = await opts.supabase.rpc("increment_sms_balance", {
    p_company_id: opts.companyId,
    p_delta_ore: totalCharge,
  });
  if (incErr) {
    return {
      enabled: true,
      logged: true,
      charged: false,
      segment_count: segments,
      total_charge_ore: totalCharge,
      log_id: logId,
      reason: "balance_increment_failed",
    };
  }

  return {
    enabled: true,
    logged: true,
    charged: true,
    segment_count: segments,
    total_charge_ore: totalCharge,
    log_id: logId,
    reason: "logged_and_charged",
  };
}

/**
 * Reducera saldo (vid Stripe-transfer-tid) — för Sprint C.
 * Returnerar nytt saldo efter avdrag (i öre).
 */
export async function settleCompanySmsBalance(
  supabase: SupabaseSmsClient,
  companyId: string,
  amountOre: number,
): Promise<{ ok: boolean; new_balance_ore: bigint | null; reason: string }> {
  if (amountOre <= 0) {
    return { ok: true, new_balance_ore: null, reason: "noop_zero_amount" };
  }
  const { data, error } = await supabase.rpc("increment_sms_balance", {
    p_company_id: companyId,
    p_delta_ore: -amountOre,
  });
  if (error) {
    return { ok: false, new_balance_ore: null, reason: "settle_failed" };
  }
  return { ok: true, new_balance_ore: BigInt(data as string | number), reason: "settled" };
}

/**
 * Hämtar saldo för company (för VD-dashboard-vy).
 */
export async function getCompanySmsBalance(
  supabase: SupabaseSmsClient,
  companyId: string,
): Promise<CompanySmsBalance | null> {
  const { data } = await supabase
    .from("company_sms_balance")
    .select("company_id, balance_ore, total_charged_lifetime_ore, total_settled_lifetime_ore, last_charged_at, last_settled_at")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  return {
    company_id: data.company_id as string,
    balance_ore: BigInt(data.balance_ore as string | number),
    total_charged_lifetime_ore: BigInt(data.total_charged_lifetime_ore as string | number),
    total_settled_lifetime_ore: BigInt(data.total_settled_lifetime_ore as string | number),
    last_charged_at: (data.last_charged_at as string | null) ?? null,
    last_settled_at: (data.last_settled_at as string | null) ?? null,
  };
}

/**
 * Kollar om SMS-funktionen ska throttlas pga skuld överstigande tröskel.
 * Returnerar true om SMS BÖR blockeras.
 */
export async function shouldThrottleSms(
  supabase: SupabaseSmsClient,
  companyId: string,
): Promise<{ throttle: boolean; balance_ore: bigint; threshold_ore: number }> {
  const cfg = await getSmsBillingConfig(supabase);
  const balance = await getCompanySmsBalance(supabase, companyId);
  const balanceOre = balance?.balance_ore ?? 0n;
  return {
    throttle: cfg.enabled && balanceOre >= BigInt(cfg.throttle_ore),
    balance_ore: balanceOre,
    threshold_ore: cfg.throttle_ore,
  };
}

/**
 * _shared/money.ts — Central money-layer for Spick
 *
 * PRIMARY SOURCE: docs/architecture/money-layer.md (commit 7236bee)
 *
 * Alla money-operationer i Spick MASTE ga genom denna fil.
 * Ingen hardcoded commission, payout-berakning, RUT-split, eller
 * Stripe-transfer far existera nagon annanstans i kodbasen.
 *
 * Regel #28: Central config, ingen fragmentering.
 * Regel #26: Verifiera med grep innan andring.
 *
 * Status: Skelett (Fas 1.2 Dag 1, 2026-04-20). Ingen business-logik.
 * Implementation: Fas 1.3-1.10 per v3.1-plan.
 *
 * Feature flag: platform_settings.money_layer_enabled
 *   - 'false' = legacy-mode (hardcoded commission ligger kvar)
 *   - 'true'  = ny mode (alla anrop ska ga genom money.ts)
 *   Aktiveras efter Fas 1.3-1.9 verifierade i staging.
 *
 * RUT-regler (Skatteverket 2026, verifierat 20 apr):
 *   - RUT-procent: 50% av arbetskostnaden
 *   - Tak: 75 000 kr per person och ar (delat med ROT)
 *   - Spick hanterar inte ROT, hela potten tillganglig for RUT
 *   - Kunden ansvarar sjalv for tak-overclaim (Skatteverket fangar)
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { stripeRequest as defaultStripeRequest, type StripeRequestFn } from './stripe.ts';
import { getStripeClient } from './stripe-client.ts';

// ============================================================
// Types
// ============================================================

export type CommissionContext = {
  booking_id?: string;
  cleaner_id?: string;
  company_id?: string | null;
  customer_type?: 'privat' | 'foretag';
  /** override för Smart Trappstege om aktiv */
  completed_jobs?: number;
};

/**
 * Commission-resultat per design-dok §4.1.
 *
 * pct = heltal-procent (ex. 12 betyder 12%), konsistent med
 * platform_settings.commission_standard='12'.
 *
 * source beskriver var i hierarkin (§5) värdet kom från — används
 * för audit-loggning och reconciliation.
 */
export type CommissionSource =
  | 'platform_settings'
  | 'company_override'
  | 'cleaner_override'
  | 'smart_trappstege'
  | 'manual_override'
  | 'fallback';

export type CommissionTier = 'new' | 'established' | 'professional' | 'elite';

export type CommissionResult = {
  pct: number;
  source: CommissionSource;
  tier?: CommissionTier;
};

/**
 * Smart Trappstege-tiers (spegel av js/commission.js:15-18).
 *
 * Proc-värden lagras som heltal här (17, 15, 13, 12) — konsistent
 * med platform_settings.commission_standard-formatet. Frontend-filen
 * js/commission.js använder decimal (0.17, 0.15) men är display-only.
 *
 * Thresholds = minsta antal completed_jobs för att kvalificera.
 */
const SMART_TRAPPSTEGE_TIERS: Array<{
  id: CommissionTier;
  pct: number;
  threshold: number;
}> = [
  { id: 'new', pct: 17, threshold: 0 },
  { id: 'established', pct: 15, threshold: 20 },
  { id: 'professional', pct: 13, threshold: 50 },
  { id: 'elite', pct: 12, threshold: 100 },
];

const FALLBACK_COMMISSION_PCT = 12;
const DEFAULT_COMMISSION_KEY = 'commission_standard';

// ============================================================
// Error-klasser
// ============================================================

/**
 * Kastas nar money_layer_enabled='false' eller nyckel saknas.
 * Caller ska fanga och falla tillbaka till legacy-kodvag.
 */
export class MoneyLayerDisabled extends Error {
  constructor() {
    super('MoneyLayerDisabled');
    this.name = 'MoneyLayerDisabled';
  }
}

/**
 * Kastas nar booking_id inte hittas i bookings-tabellen.
 */
export class BookingNotFound extends Error {
  constructor(public booking_id: string) {
    super(`BookingNotFound: ${booking_id}`);
    this.name = 'BookingNotFound';
  }
}

/**
 * Kastas vid data-korruption eller bruten invariant under payout-
 * berakning. Details-object innehaller all kontext for debug.
 */
export class PayoutCalculationError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(message);
    this.name = 'PayoutCalculationError';
  }
}

/**
 * Kastas nar gross_sek inte ar positivt heltal i calculateRutSplit().
 */
export class InvalidRutAmount extends Error {
  constructor(message: string) {
    super(`InvalidRutAmount: ${message}`);
    this.name = 'InvalidRutAmount';
  }
}

/**
 * Kastas vid data-korruption eller bruten invariant under RUT-split.
 * Details-object innehaller all kontext for debug.
 */
export class RutSplitError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(message);
    this.name = 'RutSplitError';
  }
}

/**
 * Kastas nar pre-conditions for triggerStripeTransfer() ar brutna
 * (payment_status, onboarding_status, destination_account, etc.).
 * Inte retry-bar.
 */
export class TransferPreconditionError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`TransferPreconditionError: ${message}`);
    this.name = 'TransferPreconditionError';
  }
}

/**
 * Kastas nar Stripe avvisar eller retries ar uttomda.
 * Details innehaller Stripe-svaret.
 */
export class TransferFailedError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`TransferFailedError: ${message}`);
    this.name = 'TransferFailedError';
  }
}

/**
 * Kastas nar DB-write failar efter Stripe-success. Reversal
 * (stripe.transfers.createReversal) har korts for att undvika
 * dubbel-utbetalning. Kritisk incident - admin-alert i F1.10.
 */
export class TransferReversedError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`TransferReversedError: ${message}`);
    this.name = 'TransferReversedError';
  }
}

/**
 * Fas 1.7: kastas nar pre-conditions for markPayoutPaid() ar brutna
 * (payment_status, attempt-state, saknad cleaner, saknad attempt).
 */
export class PayoutPreconditionError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`PayoutPreconditionError: ${message}`);
    this.name = 'PayoutPreconditionError';
  }
}

/**
 * Fas 1.7: kastas nar Stripe Transfer-verifiering misslyckas
 * (transfer reversed, amount mismatch, GET /transfers failar).
 */
export class PayoutVerificationError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`PayoutVerificationError: ${message}`);
    this.name = 'PayoutVerificationError';
  }
}

/**
 * Fas 1.7: kastas vid DB-fel under bookings-uppdatering eller
 * audit_log-insert. Inte retry-bar — kraver manuell granskning.
 */
export class PayoutUpdateError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`PayoutUpdateError: ${message}`);
    this.name = 'PayoutUpdateError';
  }
}

/**
 * Fas 1.8: kastas nar Stripe auth failar eller env saknas i reconciliation.
 */
export class ReconcileConfigError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`ReconcileConfigError: ${message}`);
    this.name = 'ReconcileConfigError';
  }
}

/**
 * Fas 1.8: kastas nar RLS blockerar service_role-writes mot audit_log.
 */
export class ReconcilePermissionError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(`ReconcilePermissionError: ${message}`);
    this.name = 'ReconcilePermissionError';
  }
}

export type PayoutBreakdown = {
  total_price_sek: number;
  commission_pct: number;
  commission_sek: number;
  stripe_fee_sek: number;
  cleaner_payout_sek: number;
  spick_gross_sek: number;
  spick_net_sek: number;
};

export type RutSplit = {
  gross_sek: number;
  rut_eligible: boolean;
  rut_amount_sek: number;
  customer_paid_sek: number;
  rut_claim_amount_sek: number;
};

export type PayoutAuditEntry = {
  booking_id: string;
  stripe_transfer_id: string | null;
  amount_sek: number;
  status: 'pending' | 'paid' | 'failed' | 'reconciled';
  created_at: string;
  reconciled_at: string | null;
};

/**
 * Fas 1.8: reconciliation mismatch-typer enligt design-dok §4.
 *
 * Severity-mapping:
 *   alert    → admin bor granska (ej akut)
 *   critical → potentiell dubbel-utbetalning eller saknad transfer
 */
export type MismatchType =
  | 'stripe_paid_db_pending'   // alert: Stripe paid, DB sager pending
  | 'stripe_reversed_db_paid'  // critical: reversed men DB tror paid
  | 'db_paid_stripe_missing'   // critical: DB paid, Stripe 404
  | 'amount_mismatch'          // critical: belopp skiljer
  | 'no_local_attempt'         // alert: Stripe har, DB saknar
  | 'stale_pending';           // alert: DB pending > 48h

export type ReconciliationMismatch = {
  severity: 'alert' | 'critical';
  type: MismatchType;
  booking_id: string | null;
  stripe_transfer_id: string;
  details: Record<string, unknown>;
};

export type ReconciliationReport = {
  run_id: string;
  started_at: string;
  completed_at: string;
  transfers_checked: number;
  matches: number;
  mismatches: ReconciliationMismatch[];
  api_calls_used: number;
  errors: string[];
};

// ============================================================
// Helpers
// ============================================================

/**
 * Safe cast av platform_settings.value (text) till number.
 *
 * @throws Error om varde ej kan parsas som nummer
 */
function parseSettingAsNumber(value: string | null, key: string): number {
  if (value === null || value === undefined) {
    throw new Error(`Platform setting '${key}' is null/undefined`);
  }
  const n = Number(value);
  if (isNaN(n)) {
    throw new Error(`Platform setting '${key}' is not a valid number: '${value}'`);
  }
  return n;
}

/**
 * Hamta en platform_setting som nummer.
 *
 * @internal
 */
async function getSettingNumeric(
  supabase: SupabaseClient,
  key: string
): Promise<number> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error) {
    throw new Error(`Failed to fetch platform_setting '${key}': ${error.message}`);
  }

  return parseSettingAsNumber(data.value, key);
}

/**
 * Hamta platform_setting som string (for feature flags 'true'/'false').
 *
 * @internal
 */
async function getSettingString(
  supabase: SupabaseClient,
  key: string
): Promise<string> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error) {
    throw new Error(`Failed to fetch platform_setting '${key}': ${error.message}`);
  }

  return data.value;
}

// ============================================================
// Public API (Fas 1.3+ implementerar)
// ============================================================

/**
 * Hamtar kommissions-procent for en given kontext.
 *
 * Hierarki (design-dok §5), implementerade steg markerade [✓]:
 *   0. [✓] Feature flag money_layer_enabled — om 'false' kastas
 *          MoneyLayerDisabled. Caller måste gate:a anrop.
 *   1. [—] booking.commission_pct_override — kolumn saknas. Framtida.
 *   2. [✓] Smart Trappstege — om platform_settings.smart_trappstege_enabled='true'
 *          mappas cleaner.completed_jobs mot tier och returneras.
 *          Fallback till platform_settings om completed_jobs saknas.
 *   3. [—] cleaner.commission_pct — kolumn saknas. Framtida.
 *   4. [—] company.commission_pct — kolumn saknas. Framtida.
 *   5. [✓] platform_settings.commission_standard — huvudväg.
 *   6. [✓] Hardcoded fallback 12 — vid DB-fel eller saknat värde.
 *
 * IGNORERAR (per design-dok §2.4 + Appendix C):
 *   - cleaners.commission_rate (4 format i 17 rader, droppas F1.10)
 *   - companies.commission_rate (0 egna värden, droppas F1.10)
 *
 * @returns CommissionResult { pct, source, tier? } där pct är
 *          heltal-procent (ex. 12 betyder 12%).
 * @throws Error('MoneyLayerDisabled') om money_layer_enabled='false'.
 */
export async function getCommission(
  supabase: SupabaseClient,
  context: CommissionContext
): Promise<CommissionResult> {
  // Steg 0: feature flag
  if (!(await isMoneyLayerEnabled(supabase))) {
    throw new MoneyLayerDisabled();
  }

  // Steg 2: Smart Trappstege (om aktiverad)
  const trappstegeResult = await _resolveSmartTrappstege(supabase, context);
  if (trappstegeResult) {
    return trappstegeResult;
  }

  // Steg 5 + 6: platform_settings.commission_standard, annars fallback
  try {
    const pct = await getSettingNumeric(supabase, DEFAULT_COMMISSION_KEY);
    return { pct, source: 'platform_settings' };
  } catch (_err) {
    return { pct: FALLBACK_COMMISSION_PCT, source: 'fallback' };
  }
}

/**
 * Steg 2 i hierarkin: Smart Trappstege-lookup.
 *
 * Returnerar null om:
 *   - smart_trappstege_enabled='false' (eller nyckel saknas)
 *   - completed_jobs saknas både i context och på cleaner-rad
 *
 * När null returneras faller getCommission() tillbaka till steg 5.
 */
async function _resolveSmartTrappstege(
  supabase: SupabaseClient,
  context: CommissionContext
): Promise<CommissionResult | null> {
  let trappstegeEnabled: string;
  try {
    trappstegeEnabled = await getSettingString(
      supabase,
      'smart_trappstege_enabled'
    );
  } catch (_err) {
    return null;
  }
  if (trappstegeEnabled !== 'true') {
    return null;
  }

  let completedJobs = context.completed_jobs;
  if (completedJobs === undefined && context.cleaner_id) {
    const { data, error } = await supabase
      .from('cleaners')
      .select('completed_jobs, total_jobs')
      .eq('id', context.cleaner_id)
      .maybeSingle();
    if (error || !data) return null;
    completedJobs = Number(data.completed_jobs ?? data.total_jobs ?? 0);
  }

  if (completedJobs === undefined || Number.isNaN(completedJobs)) {
    return null;
  }

  const tier = _pickTier(completedJobs);
  return { pct: tier.pct, source: 'smart_trappstege', tier: tier.id };
}

/**
 * Mappa completed_jobs → tier. Högsta tröskel som uppnås vinner.
 */
function _pickTier(completedJobs: number): (typeof SMART_TRAPPSTEGE_TIERS)[number] {
  let selected = SMART_TRAPPSTEGE_TIERS[0];
  for (const tier of SMART_TRAPPSTEGE_TIERS) {
    if (completedJobs >= tier.threshold) selected = tier;
  }
  return selected;
}

/**
 * Beraknar payout-struktur for en booking — pure function, ingen DB-write.
 *
 * Primarkalla: docs/architecture/money-layer.md §4.2
 * Per Farhads beslut 2026-04-20: Stripe destination charges-modell,
 * Spick betalar Stripe-fees (dras fran spick_net).
 *
 * Formel:
 *   commission_sek     = round(total_price * commission_pct / 100)
 *   stripe_fee_sek     = bookings.stripe_fee_sek ?? 0
 *   cleaner_payout_sek = total_price - commission_sek
 *   spick_gross_sek    = commission_sek
 *   spick_net_sek      = commission_sek - stripe_fee_sek
 *
 * Invariant:
 *   cleaner_payout_sek + spick_net_sek + stripe_fee_sek === total_price
 *
 * Frozen commission:
 *   bookings.commission_pct ar sanning (satt vid bokningsskapande).
 *   getCommission() anropas endast om commission_pct saknas (legacy-data).
 *
 * @throws MoneyLayerDisabled — om money_layer_enabled='false'
 * @throws BookingNotFound — om booking_id ej finns
 * @throws PayoutCalculationError — ogiltigt total_price, data-korruption
 *         eller bruten invariant
 */
export async function calculatePayout(
  supabase: SupabaseClient,
  booking_id: string
): Promise<PayoutBreakdown> {
  // Steg 0: feature flag
  if (!(await isMoneyLayerEnabled(supabase))) {
    throw new MoneyLayerDisabled();
  }

  // Fetch booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      'total_price, commission_pct, stripe_fee_sek, cleaner_id, company_id, customer_type'
    )
    .eq('id', booking_id)
    .maybeSingle();

  if (error || !booking) {
    throw new BookingNotFound(booking_id);
  }

  // Validera total_price: NULL / 0 / negativ / icke-numeriskt
  if (booking.total_price === null || booking.total_price === undefined) {
    throw new PayoutCalculationError(
      `Invalid total_price (null) for booking ${booking_id}`,
      { booking_id, total_price: booking.total_price }
    );
  }
  const totalPrice = Number(booking.total_price);
  if (Number.isNaN(totalPrice) || totalPrice <= 0) {
    throw new PayoutCalculationError(
      `Invalid total_price for booking ${booking_id}: ${booking.total_price}`,
      { booking_id, total_price: booking.total_price }
    );
  }

  // Commission: bookings.commission_pct (sanning) med getCommission()-fallback
  let commissionPct: number;
  if (booking.commission_pct === null || booking.commission_pct === undefined) {
    console.warn(
      `[money.ts] commission_pct NULL for booking ${booking_id}, falling back to getCommission()`
    );
    const ctx: CommissionContext = {
      booking_id,
      cleaner_id: booking.cleaner_id ?? undefined,
      company_id: booking.company_id ?? null,
      customer_type: booking.customer_type ?? undefined,
    };
    const result = await getCommission(supabase, ctx);
    commissionPct = result.pct;
  } else {
    commissionPct = Number(booking.commission_pct);
    if (Number.isNaN(commissionPct)) {
      throw new PayoutCalculationError(
        `Non-numeric commission_pct for booking ${booking_id}: ${booking.commission_pct}`,
        { booking_id, commission_pct: booking.commission_pct }
      );
    }
  }

  // Stripe-fee: default 0 om NULL (gamla bokningar)
  let stripeFeeSek: number;
  if (booking.stripe_fee_sek === null || booking.stripe_fee_sek === undefined) {
    console.warn(
      `[money.ts] stripe_fee_sek NULL for booking ${booking_id}, defaulting to 0`
    );
    stripeFeeSek = 0;
  } else {
    stripeFeeSek = Number(booking.stripe_fee_sek);
    if (Number.isNaN(stripeFeeSek)) {
      throw new PayoutCalculationError(
        `Non-numeric stripe_fee_sek for booking ${booking_id}: ${booking.stripe_fee_sek}`,
        { booking_id, stripe_fee_sek: booking.stripe_fee_sek }
      );
    }
  }

  // Formel
  const commissionSek = Math.round((totalPrice * commissionPct) / 100);
  const cleanerPayoutSek = totalPrice - commissionSek;
  const spickGrossSek = commissionSek;
  const spickNetSek = commissionSek - stripeFeeSek;

  // Invariant: cleaner + spick_net + fee === total_price
  const sum = cleanerPayoutSek + spickNetSek + stripeFeeSek;
  if (sum !== totalPrice) {
    throw new PayoutCalculationError(
      `Payout invariant broken for booking ${booking_id}: ${sum} !== ${totalPrice}`,
      {
        booking_id,
        sum,
        total_price: totalPrice,
        cleaner_payout_sek: cleanerPayoutSek,
        spick_net_sek: spickNetSek,
        stripe_fee_sek: stripeFeeSek,
        commission_sek: commissionSek,
        commission_pct: commissionPct,
      }
    );
  }

  return {
    total_price_sek: totalPrice,
    commission_pct: commissionPct,
    commission_sek: commissionSek,
    stripe_fee_sek: stripeFeeSek,
    cleaner_payout_sek: cleanerPayoutSek,
    spick_gross_sek: spickGrossSek,
    spick_net_sek: spickNetSek,
  };
}

/**
 * Delar ett belopp i RUT-del och kund-del — pure function.
 *
 * Primarkalla: docs/architecture/money-layer.md §4.3
 * Skatteverket 2026: RUT = 50% av arbetskostnad, tak 75000 kr/ar/person.
 *
 * Formel (heltal-procent, konsistent med commission_standard):
 *   rut_amount_sek       = Math.floor(gross_sek * rut_pct / 100)
 *   customer_paid_sek    = gross_sek - rut_amount_sek
 *   rut_claim_amount_sek = rut_amount_sek
 *
 * Math.floor = Skatteverket-sakert, konservativt mot overclaim
 * (aldrig runda UPP RUT-andelen).
 *
 * Invariant:
 *   customer_paid_sek + rut_amount_sek === gross_sek
 *
 * Per-bokning cap-warning: om rut_amount > rut_yearly_cap_kr loggas
 * varning. Ingen hard block — historisk kund-cap-check implementeras
 * i F1.5.1 (kraver customer_id + SUM over ar).
 *
 * @param gross_sek Brutto-belopp fore RUT (arbetskostnad, heltal SEK)
 * @param eligible Ar tjansten RUT-grundande?
 *                 (Hemstadning, Storstadning, Flyttstadning,
 *                  Fonsterputs, Trappstadning = ja.
 *                  Kontorsstadning, Byggstadning = nej.)
 * @throws MoneyLayerDisabled om money_layer_enabled='false'
 * @throws InvalidRutAmount om gross_sek <= 0
 * @throws RutSplitError om invariant bruts (data-korruption / NaN-drift)
 */
export async function calculateRutSplit(
  supabase: SupabaseClient,
  gross_sek: number,
  eligible: boolean
): Promise<RutSplit> {
  // Steg 0: feature flag
  if (!(await isMoneyLayerEnabled(supabase))) {
    throw new MoneyLayerDisabled();
  }

  // Validering
  if (gross_sek <= 0 || Number.isNaN(gross_sek)) {
    throw new InvalidRutAmount(
      `gross_sek must be positive, got ${gross_sek}`
    );
  }
  if (gross_sek > 1_000_000) {
    console.warn(
      `[money.ts] calculateRutSplit: gross_sek=${gross_sek} is unusually high`
    );
  }

  // Ej RUT-grundande tjanst → kund betalar allt
  if (!eligible) {
    return {
      gross_sek,
      rut_eligible: false,
      rut_amount_sek: 0,
      customer_paid_sek: gross_sek,
      rut_claim_amount_sek: 0,
    };
  }

  // Formel per platform_settings.rut_pct (default '50')
  const rutPct = await getSettingNumeric(supabase, 'rut_pct');
  const rutAmountSek = Math.floor((gross_sek * rutPct) / 100);
  const customerPaidSek = gross_sek - rutAmountSek;
  const rutClaimAmountSek = rutAmountSek;

  // Invariant-check (fangar NaN-drift via Infinity/konstig rut_pct)
  if (customerPaidSek + rutAmountSek !== gross_sek) {
    throw new RutSplitError(
      `RUT invariant broken: ${customerPaidSek} + ${rutAmountSek} !== ${gross_sek}`,
      {
        gross_sek,
        rut_pct: rutPct,
        rut_amount_sek: rutAmountSek,
        customer_paid_sek: customerPaidSek,
      }
    );
  }

  // Mjuk warning om enskild bokning overstiger arligt tak
  // (historisk kund-cap-enforcement i F1.5.1)
  try {
    const yearlyCap = await getSettingNumeric(supabase, 'rut_yearly_cap_kr');
    if (rutAmountSek > yearlyCap) {
      console.warn(
        `[money.ts] calculateRutSplit: rut_amount=${rutAmountSek} exceeds yearly cap ${yearlyCap} — unusual`
      );
    }
  } catch (_err) {
    // rut_yearly_cap_kr saknas → inte blockera berakning
  }

  return {
    gross_sek,
    rut_eligible: true,
    rut_amount_sek: rutAmountSek,
    customer_paid_sek: customerPaidSek,
    rut_claim_amount_sek: rutClaimAmountSek,
  };
}

/**
 * Utfor Stripe Transfer till cleaner's Connect-konto.
 *
 * Primarkalla: docs/architecture/fas-1-6-stripe-transfer-design.md
 *              §4-§7 (commit aa0a0e0).
 *
 * Flode (design-dok §5):
 *   1. Feature flag (money_layer_enabled)
 *   2. payout_trigger_mode-check (om !force)
 *   3. Fetch booking + pre-condition validering
 *   4. Fetch cleaner + Stripe Connect-verifiering
 *   5. Idempotency: berakna attempt_count
 *   6. calculatePayout() for belopp
 *   7. Insert payout_attempts (status=pending)
 *   8. Call stripeRequest('/transfers') med Idempotency-Key
 *   9. Success: update attempts + insert audit_log
 *      Fel: update attempts + alert-audit, throw TransferFailedError
 *      DB-fel efter Stripe-success: createReversal + throw
 *      TransferReversedError
 *
 * Separation of concerns (§3.5):
 *   Satter INTE bookings.payout_status. F1.7 markPayoutPaid() gor det.
 *
 * @throws MoneyLayerDisabled — money_layer_enabled='false'
 * @throws BookingNotFound — booking_id finns ej
 * @throws TransferPreconditionError — payment_status, cleaner-state,
 *         eller trigger_mode blockerar
 * @throws TransferFailedError — Stripe avvisade eller retries uttomda
 * @throws TransferReversedError — DB-write failade efter Stripe-success,
 *         reversal kord (kritisk)
 */
export async function triggerStripeTransfer(
  supabase: SupabaseClient,
  booking_id: string,
  opts?: {
    idempotency_key?: string;
    force?: boolean;
    /** Dependency-injection for tester */
    _stripeRequest?: StripeRequestFn;
  }
): Promise<PayoutAuditEntry> {
  // Steg 1: feature flag
  if (!(await isMoneyLayerEnabled(supabase))) {
    throw new MoneyLayerDisabled();
  }

  // Steg 2: payout_trigger_mode-check (om !force)
  if (!opts?.force) {
    let mode: string;
    try {
      mode = await getSettingString(supabase, 'payout_trigger_mode');
    } catch (_err) {
      throw new TransferPreconditionError(
        'payout_trigger_mode not configured',
        { booking_id }
      );
    }
    if (mode !== 'immediate') {
      throw new TransferPreconditionError(
        `payout_trigger_mode='${mode}' does not allow automatic trigger`,
        { booking_id, mode }
      );
    }
  }

  // Steg 3: fetch booking + pre-condition validering
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(
      'id, total_price, commission_pct, stripe_fee_sek, cleaner_id, company_id, customer_type, payment_status, payout_status'
    )
    .eq('id', booking_id)
    .maybeSingle();

  if (bErr || !booking) {
    throw new BookingNotFound(booking_id);
  }

  if (booking.payment_status !== 'paid') {
    throw new TransferPreconditionError(
      `Booking payment_status='${booking.payment_status}', must be 'paid'`,
      { booking_id, payment_status: booking.payment_status }
    );
  }

  if (booking.total_price === null || booking.total_price <= 0) {
    throw new TransferPreconditionError(
      `Invalid total_price for transfer: ${booking.total_price}`,
      { booking_id, total_price: booking.total_price }
    );
  }

  // Idempotent re-anrop: om payout_status='paid' OCH existing audit finns
  if (booking.payout_status === 'paid') {
    const { data: existing } = await supabase
      .from('payout_audit_log')
      .select('booking_id, stripe_transfer_id, amount_sek, action, created_at')
      .eq('booking_id', booking_id)
      .eq('action', 'transfer_created')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return _mapAuditLogToEntry(existing);
    }
    // payout_status=paid men ingen audit — data-inkonsistens
    throw new TransferPreconditionError(
      'Booking marked paid but no audit entry found',
      { booking_id }
    );
  }

  // Steg 4: fetch cleaner + Stripe Connect-verifiering
  //   is_test_account krävs för Fas 1.6.1 mode-isolation (§3.6).
  const { data: cleaner, error: cErr } = await supabase
    .from('cleaners')
    .select('id, stripe_account_id, stripe_onboarding_status, is_test_account')
    .eq('id', booking.cleaner_id)
    .maybeSingle();

  if (cErr || !cleaner) {
    throw new TransferPreconditionError('Cleaner not found', {
      booking_id,
      cleaner_id: booking.cleaner_id,
    });
  }

  if (!cleaner.stripe_account_id) {
    throw new TransferPreconditionError('Cleaner has no stripe_account_id', {
      booking_id,
      cleaner_id: booking.cleaner_id,
    });
  }

  if (cleaner.stripe_onboarding_status !== 'complete') {
    throw new TransferPreconditionError(
      `Cleaner onboarding not complete: ${cleaner.stripe_onboarding_status}`,
      {
        booking_id,
        cleaner_id: booking.cleaner_id,
        status: cleaner.stripe_onboarding_status,
      }
    );
  }

  // Steg 5: idempotency — berakna attempt_count
  const { data: priorAttempts } = await supabase
    .from('payout_attempts')
    .select('attempt_count, status, stripe_transfer_id')
    .eq('booking_id', booking_id)
    .order('attempt_count', { ascending: false })
    .limit(1);

  const prior = priorAttempts?.[0];
  // Om tidigare attempt redan paid → idempotent return
  if (prior?.status === 'paid' && prior.stripe_transfer_id) {
    const { data: existing } = await supabase
      .from('payout_audit_log')
      .select('booking_id, stripe_transfer_id, amount_sek, action, created_at')
      .eq('booking_id', booking_id)
      .eq('stripe_transfer_id', prior.stripe_transfer_id)
      .maybeSingle();
    if (existing) return _mapAuditLogToEntry(existing);
  }

  const attemptCount = prior?.attempt_count ? prior.attempt_count + 1 : 1;
  const idempotencyKey =
    opts?.idempotency_key ?? `payout-${booking_id}-${attemptCount}`;

  // Steg 6: calculatePayout
  const payout = await calculatePayout(supabase, booking_id);

  // Steg 7: insert payout_attempts (status=pending)
  const { data: attempt, error: aErr } = await supabase
    .from('payout_attempts')
    .insert({
      booking_id,
      attempt_count: attemptCount,
      stripe_idempotency_key: idempotencyKey,
      status: 'pending',
      amount_sek: payout.cleaner_payout_sek,
      destination_account_id: cleaner.stripe_account_id,
    })
    .select()
    .single();

  if (aErr || !attempt) {
    throw new TransferFailedError('Failed to insert payout_attempts', {
      booking_id,
      error: aErr?.message,
    });
  }

  // Steg 8: call Stripe /transfers
  //   Mode-isolation (Fas 1.6.1 §3.6): getStripeClient väljer rätt nyckel
  //   baserat på cleaner.is_test_account + platform_settings.stripe_mode.
  const stripeReq = opts?._stripeRequest ?? defaultStripeRequest;
  let globalStripeMode: string | null = null;
  try {
    globalStripeMode = await getSettingString(supabase, 'stripe_mode');
  } catch (_e) {
    globalStripeMode = 'live';
  }
  const stripeClient = getStripeClient({
    is_test_account: cleaner.is_test_account ?? false,
    global_stripe_mode: globalStripeMode,
  });
  const apiKey = stripeClient.apiKey;

  const stripeParams: Record<string, string> = {
    amount: String(payout.cleaner_payout_sek * 100), // SEK → öre
    currency: 'sek',
    destination: cleaner.stripe_account_id,
    transfer_group: `booking_${booking_id}`,
    'metadata[booking_id]': booking_id,
    'metadata[cleaner_id]': String(booking.cleaner_id ?? ''),
    'metadata[commission_pct]': String(payout.commission_pct),
    'metadata[attempt_count]': String(attemptCount),
  };

  let stripeResp;
  try {
    stripeResp = await stripeReq('/transfers', 'POST', stripeParams, {
      apiKey,
      idempotencyKey,
    });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await _logTransferFailure(supabase, attempt.id, booking_id, payout.cleaner_payout_sek, attemptCount, errMsg);
    throw new TransferFailedError(`Stripe transfer failed: ${errMsg}`, {
      booking_id,
      attempt_count: attemptCount,
      stripe_error: errMsg,
    });
  }

  if (!stripeResp.ok) {
    const errMsg = stripeResp.body?.error?.message ?? `HTTP ${stripeResp.status}`;
    await _logTransferFailure(supabase, attempt.id, booking_id, payout.cleaner_payout_sek, attemptCount, errMsg);
    throw new TransferFailedError(`Stripe ${stripeResp.status}: ${errMsg}`, {
      booking_id,
      attempt_count: attemptCount,
      stripe_status: stripeResp.status,
      stripe_error: errMsg,
    });
  }

  const stripeTransferId: string = stripeResp.body?.id ?? '';
  if (!stripeTransferId) {
    await _logTransferFailure(supabase, attempt.id, booking_id, payout.cleaner_payout_sek, attemptCount, 'missing transfer id in response');
    throw new TransferFailedError('Stripe response missing transfer id', {
      booking_id,
      stripe_response: stripeResp.body,
    });
  }

  // Steg 9: success — update attempts + insert audit
  // Vid DB-fel EFTER Stripe-success: rollback via createReversal
  try {
    const completedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('payout_attempts')
      .update({
        status: 'paid',
        stripe_transfer_id: stripeTransferId,
        completed_at: completedAt,
      })
      .eq('id', attempt.id);
    if (updErr) throw updErr;

    const { data: auditEntry, error: auditErr } = await supabase
      .from('payout_audit_log')
      .insert({
        booking_id,
        action: 'transfer_created',
        severity: 'info',
        amount_sek: payout.cleaner_payout_sek,
        stripe_transfer_id: stripeTransferId,
        details: {
          commission_pct: payout.commission_pct,
          spick_gross_sek: payout.spick_gross_sek,
          spick_net_sek: payout.spick_net_sek,
          stripe_fee_sek: payout.stripe_fee_sek,
          attempt_count: attemptCount,
          idempotency_key: idempotencyKey,
        },
      })
      .select('booking_id, stripe_transfer_id, amount_sek, action, created_at')
      .single();
    if (auditErr || !auditEntry) throw auditErr ?? new Error('audit insert returned null');

    return _mapAuditLogToEntry(auditEntry);
  } catch (dbError) {
    // DB-fel EFTER Stripe-success → rollback via reversal
    const errMsg = dbError instanceof Error ? dbError.message : String(dbError);
    try {
      await stripeReq(
        `/transfers/${stripeTransferId}/reversals`,
        'POST',
        {
          'metadata[reason]': 'db_write_failed',
          'metadata[booking_id]': booking_id,
        },
        { apiKey, idempotencyKey: `reverse-${idempotencyKey}` }
      );
      // Best-effort audit-log av reversal (kan failar igen, vi sväljer)
      try {
        await supabase
          .from('payout_audit_log')
          .insert({
            booking_id,
            action: 'transfer_reversed',
            severity: 'critical',
            amount_sek: payout.cleaner_payout_sek,
            stripe_transfer_id: stripeTransferId,
            details: {
              reason: 'db_write_failed_after_stripe_success',
              db_error: errMsg,
            },
          });
      } catch {
        // swallow — best-effort
      }
    } catch (reversalErr) {
      throw new TransferReversedError(
        `Reversal attempt also failed: ${reversalErr instanceof Error ? reversalErr.message : String(reversalErr)}`,
        {
          booking_id,
          stripe_transfer_id: stripeTransferId,
          original_db_error: errMsg,
          reversal_error: reversalErr instanceof Error ? reversalErr.message : String(reversalErr),
        }
      );
    }
    throw new TransferReversedError(
      `DB write failed after Stripe success; transfer reversed`,
      {
        booking_id,
        stripe_transfer_id: stripeTransferId,
        db_error: errMsg,
      }
    );
  }
}

/**
 * Intern helper: logga Stripe-fel till payout_attempts + payout_audit_log.
 * Best-effort — failar tyst om DB inte ar tillganglig.
 */
async function _logTransferFailure(
  supabase: SupabaseClient,
  attemptId: string,
  bookingId: string,
  amountSek: number,
  attemptCount: number,
  errorMsg: string
): Promise<void> {
  const completedAt = new Date().toISOString();
  try {
    await supabase
      .from('payout_attempts')
      .update({
        status: 'failed',
        error_message: errorMsg,
        completed_at: completedAt,
      })
      .eq('id', attemptId);
  } catch {
    // swallow — best-effort
  }

  try {
    await supabase
      .from('payout_audit_log')
      .insert({
        booking_id: bookingId,
        action: 'transfer_failed',
        severity: 'alert',
        amount_sek: amountSek,
        details: { error: errorMsg, attempt_count: attemptCount },
      });
  } catch {
    // swallow — best-effort
  }
}

/**
 * Konvertera payout_audit_log-rad till PayoutAuditEntry-typ.
 */
// deno-lint-ignore no-explicit-any
function _mapAuditLogToEntry(row: any): PayoutAuditEntry {
  const action = String(row.action ?? '');
  const status: PayoutAuditEntry['status'] =
    action === 'transfer_created' || action === 'payout_confirmed'
      ? 'paid'
      : action === 'transfer_failed' || action === 'transfer_reversed'
      ? 'failed'
      : 'pending';
  return {
    booking_id: row.booking_id,
    stripe_transfer_id: row.stripe_transfer_id ?? null,
    amount_sek: Number(row.amount_sek ?? 0),
    status,
    created_at: String(row.created_at),
    reconciled_at: row.reconciled_at ?? null,
  };
}

/**
 * Markera payout som betald (ersatter admin.html:4478 fake markPaid).
 *
 * Primarkalla: docs/architecture/money-layer.md §4.5 + v3.1-plan F1.7.
 *
 * Separation of concerns (§3.5):
 *   - Fas 1.6 triggerStripeTransfer: skickar pengar via Stripe /transfers
 *   - Fas 1.7 markPayoutPaid: bekraftar transfer + uppdaterar bookings
 *
 * Flode (10 steg):
 *   1. Feature flag (money_layer_enabled)
 *   2. Fetch booking + validera payment_status='paid'
 *   3. Idempotency: om payout_status='paid' → return existing audit
 *   4. Fetch senaste payout_attempt
 *      - Om ingen + !force → PayoutPreconditionError
 *      - Om ingen + force=true → trigger transfer + rekursiv markPayoutPaid
 *      - Om status != 'paid' → PayoutPreconditionError
 *   5. Fetch cleaner for getStripeClient()
 *   6. Verifiera Stripe Transfer (om !skip_stripe_verify):
 *      - GET /transfers/{id}
 *      - Check reversed-flag
 *      - Verify amount matches
 *   7. Update bookings.payout_status='paid' + payout_date=now()
 *   8. Insert payout_audit_log (action='payout_confirmed')
 *   9. Return PayoutAuditEntry
 *
 * IDEMPOTENT — safe att kora flera ganger med samma booking_id.
 * Self-healing: om payout_status='paid' men ingen audit → skapar audit nu.
 *
 * @throws MoneyLayerDisabled — money_layer_enabled='false'
 * @throws BookingNotFound — booking_id finns ej
 * @throws PayoutPreconditionError — payment_status, attempt-state,
 *         eller saknad cleaner blockerar
 * @throws PayoutVerificationError — Stripe transfer reversed eller
 *         amount mismatch
 * @throws PayoutUpdateError — DB-fel under bookings-update eller audit-insert
 */
export async function markPayoutPaid(
  supabase: SupabaseClient,
  booking_id: string,
  opts?: {
    skip_stripe_verify?: boolean;
    admin_user_id?: string;
    force?: boolean;
    _stripeRequest?: StripeRequestFn;
  }
): Promise<PayoutAuditEntry> {
  // Steg 1: feature flag
  if (!(await isMoneyLayerEnabled(supabase))) {
    throw new MoneyLayerDisabled();
  }

  // Steg 2: fetch booking + validera
  const { data: booking, error: bErr } = await supabase
    .from('bookings')
    .select(
      'id, total_price, payment_status, payout_status, cleaner_id'
    )
    .eq('id', booking_id)
    .maybeSingle();

  if (bErr || !booking) {
    throw new BookingNotFound(booking_id);
  }

  if (booking.payment_status !== 'paid') {
    throw new PayoutPreconditionError(
      `Cannot mark payout paid: payment_status='${booking.payment_status}'`,
      { booking_id, payment_status: booking.payment_status }
    );
  }

  // Steg 3: idempotency — om redan paid, returnera existing audit
  if (booking.payout_status === 'paid') {
    const { data: existing } = await supabase
      .from('payout_audit_log')
      .select('booking_id, stripe_transfer_id, amount_sek, action, created_at')
      .eq('booking_id', booking_id)
      .eq('action', 'payout_confirmed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) return _mapAuditLogToEntry(existing);

    // Self-healing: payout_status='paid' men ingen audit — fortsatt
    // och skapa audit nu (datakorruption fran legacy markPaid).
    console.warn(
      `[money.ts] Data drift: payout_status=paid but no audit for ${booking_id} — self-healing`
    );
  }

  // Steg 4: fetch senaste payout_attempt
  const { data: attempts } = await supabase
    .from('payout_attempts')
    .select(
      'id, stripe_transfer_id, status, amount_sek, destination_account_id, attempt_count'
    )
    .eq('booking_id', booking_id)
    .order('attempt_count', { ascending: false })
    .limit(1);

  const attempt = attempts?.[0];

  if (!attempt) {
    if (!opts?.force) {
      throw new PayoutPreconditionError(
        'No payout_attempt found. Run triggerStripeTransfer first or use force=true',
        { booking_id }
      );
    }
    // Force-mode: trigger transfer + rekursiv markPayoutPaid.
    // Rekursionen terminerar pga attempt nu finns i steg 4 nasta varv.
    await triggerStripeTransfer(supabase, booking_id, {
      force: true,
      _stripeRequest: opts?._stripeRequest,
    });
    return markPayoutPaid(supabase, booking_id, opts);
  }

  if (attempt.status !== 'paid') {
    throw new PayoutPreconditionError(
      `Latest payout_attempt has status='${attempt.status}', must be 'paid'`,
      { booking_id, attempt_id: attempt.id, status: attempt.status }
    );
  }

  // Steg 5: fetch cleaner for getStripeClient
  const { data: cleaner, error: cErr } = await supabase
    .from('cleaners')
    .select('id, is_test_account, stripe_account_id')
    .eq('id', booking.cleaner_id)
    .maybeSingle();

  if (cErr || !cleaner) {
    throw new PayoutPreconditionError('Cleaner not found', {
      booking_id,
      cleaner_id: booking.cleaner_id,
    });
  }

  // Steg 6: verifiera Stripe Transfer
  if (!opts?.skip_stripe_verify) {
    if (!attempt.stripe_transfer_id) {
      throw new PayoutPreconditionError(
        'Attempt marked paid but no stripe_transfer_id',
        { booking_id, attempt_id: attempt.id }
      );
    }

    let globalStripeMode: string | null = null;
    try {
      globalStripeMode = await getSettingString(supabase, 'stripe_mode');
    } catch (_e) {
      globalStripeMode = 'live';
    }
    const stripeClient = getStripeClient({
      is_test_account: cleaner.is_test_account ?? false,
      global_stripe_mode: globalStripeMode,
    });
    const stripeReq = opts?._stripeRequest ?? defaultStripeRequest;

    let stripeResp;
    try {
      stripeResp = await stripeReq(
        `/transfers/${attempt.stripe_transfer_id}`,
        'GET',
        {},
        { apiKey: stripeClient.apiKey }
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      throw new PayoutVerificationError(
        `Failed to verify Stripe transfer: ${errMsg}`,
        { booking_id, stripe_transfer_id: attempt.stripe_transfer_id }
      );
    }

    if (!stripeResp.ok) {
      throw new PayoutVerificationError(
        `Stripe ${stripeResp.status}: ${stripeResp.body?.error?.message ?? 'unknown'}`,
        {
          booking_id,
          stripe_transfer_id: attempt.stripe_transfer_id,
          stripe_status: stripeResp.status,
        }
      );
    }

    if (stripeResp.body?.reversed === true) {
      throw new PayoutVerificationError(
        'Stripe transfer has been reversed',
        {
          booking_id,
          stripe_transfer_id: attempt.stripe_transfer_id,
          amount_reversed: stripeResp.body.amount_reversed,
        }
      );
    }

    const expectedOre = attempt.amount_sek * 100;
    if (stripeResp.body?.amount !== expectedOre) {
      throw new PayoutVerificationError(
        `Amount mismatch: expected ${expectedOre} ore, got ${stripeResp.body?.amount}`,
        {
          booking_id,
          stripe_transfer_id: attempt.stripe_transfer_id,
          expected: expectedOre,
          actual: stripeResp.body?.amount,
        }
      );
    }
  }

  // Steg 7: update bookings
  const payoutDate = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('bookings')
    .update({
      payout_status: 'paid',
      payout_date: payoutDate,
    })
    .eq('id', booking_id);

  if (updateErr) {
    throw new PayoutUpdateError(
      `Failed to update bookings: ${updateErr.message}`,
      { booking_id, error: updateErr.message }
    );
  }

  // Steg 8: insert payout_audit_log
  const auditDetails = {
    attempt_id: attempt.id,
    attempt_count: attempt.attempt_count,
    stripe_transfer_id: attempt.stripe_transfer_id,
    amount_sek: attempt.amount_sek,
    destination_account_id: attempt.destination_account_id,
    payout_date: payoutDate,
    admin_user_id: opts?.admin_user_id ?? null,
    verified_via_stripe: !opts?.skip_stripe_verify,
  };

  const { data: auditEntry, error: auditErr } = await supabase
    .from('payout_audit_log')
    .insert({
      booking_id,
      action: 'payout_confirmed',
      severity: 'info',
      amount_sek: attempt.amount_sek,
      stripe_transfer_id: attempt.stripe_transfer_id,
      details: auditDetails,
      created_at: payoutDate,
    })
    .select('booking_id, stripe_transfer_id, amount_sek, action, created_at')
    .single();

  if (auditErr || !auditEntry) {
    throw new PayoutUpdateError(
      `Failed to insert payout_audit_log: ${auditErr?.message ?? 'unknown'}`,
      { booking_id, error: auditErr?.message }
    );
  }

  // Steg 9: return
  return _mapAuditLogToEntry(auditEntry);
}

/**
 * Reconciliation — hamtar senaste Stripe Transfer-list och matchar
 * mot lokal bookings/payout_attempts-state. Flaggar mismatches i
 * payout_audit_log. Ingen auto-heal.
 *
 * Primarkalla: docs/architecture/fas-1-8-reconciliation-design.md
 *
 * Flode (9 steg):
 *   1. Feature flag (om !dry_run)
 *   2. Generate run_id (16-char SHA256-prefix)
 *   3. Fetch local state (bookings + payout_attempts senaste N dagar)
 *   4. Fetch Stripe List Transfers (limit=max_transfers, rate-skydd)
 *   5. Matchningsalgoritm (6 mismatch-typer)
 *   6. Insert mismatch-audits (om !dry_run) med idempotens-check
 *   7. Insert reconciliation_completed-audit
 *   8. Return ReconciliationReport
 *   9. Rate-limit-skydd genom hela flode (abort vid 80% av max)
 *
 * Idempotent: samma run_id + stripe_transfer_id skriver inte duplikat.
 *
 * @throws MoneyLayerDisabled — om money_layer_enabled='false' och !dry_run
 * @throws ReconcileConfigError — Stripe auth failar (401)
 * @throws ReconcilePermissionError — RLS blockerar service_role-writes
 */
export async function reconcilePayouts(
  supabase: SupabaseClient,
  opts?: {
    since_days?: number;
    max_transfers?: number;
    max_api_calls?: number;
    dry_run?: boolean;
    _stripeRequest?: StripeRequestFn;
  }
): Promise<ReconciliationReport> {
  const sinceDays = opts?.since_days ?? 7;
  const maxTransfers = opts?.max_transfers ?? 100;
  const maxApiCalls = opts?.max_api_calls ?? 50;
  const dryRun = opts?.dry_run === true;

  // Steg 1: feature flag (dry_run bypasses for testning)
  if (!dryRun) {
    if (!(await isMoneyLayerEnabled(supabase))) {
      throw new MoneyLayerDisabled();
    }
  }

  // Steg 2: generate run_id
  const runStarted = new Date().toISOString();
  const salt = crypto.randomUUID();
  const run_id = (await _sha256Hex(runStarted + salt)).slice(0, 16);

  const report: ReconciliationReport = {
    run_id,
    started_at: runStarted,
    completed_at: '',
    transfers_checked: 0,
    matches: 0,
    mismatches: [],
    api_calls_used: 0,
    errors: [],
  };

  const sinceIso = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const sinceTs = Math.floor(Date.parse(sinceIso) / 1000);
  const staleIso = new Date(Date.now() - 48 * 3600000).toISOString();

  // Steg 3: fetch local state — tva separata queries (enklare mocka)
  const { data: recentBookings } = await supabase
    .from('bookings')
    .select('id, payout_status, payout_date, cleaner_id')
    .or(`payout_date.gte.${sinceIso},payout_status.eq.paid`);

  const { data: recentAttempts } = await supabase
    .from('payout_attempts')
    .select(
      'id, booking_id, stripe_transfer_id, status, amount_sek, attempt_count, created_at'
    )
    .gte('created_at', sinceIso);

  const { data: stalePending } = await supabase
    .from('payout_attempts')
    .select(
      'id, booking_id, stripe_transfer_id, amount_sek, status, created_at'
    )
    .eq('status', 'pending')
    .lt('created_at', staleIso);

  // Index: stripe_transfer_id → { booking_id, payout_status, attempt_status, amount_sek }
  const bookingById = new Map<string, { payout_status: string | null }>();
  for (const b of recentBookings ?? []) bookingById.set(b.id, b);

  const localByTransferId = new Map<
    string,
    {
      booking_id: string;
      payout_status: string | null;
      attempt_status: string;
      amount_sek: number;
      attempt_id: string;
    }
  >();
  for (const a of recentAttempts ?? []) {
    if (!a.stripe_transfer_id) continue;
    const b = bookingById.get(a.booking_id);
    localByTransferId.set(a.stripe_transfer_id, {
      booking_id: a.booking_id,
      payout_status: b?.payout_status ?? null,
      attempt_status: a.status,
      amount_sek: a.amount_sek,
      attempt_id: a.id,
    });
  }

  // Steg 4: fetch Stripe List
  let globalStripeMode: string | null = null;
  try {
    globalStripeMode = await getSettingString(supabase, 'stripe_mode');
  } catch (_e) {
    globalStripeMode = 'live';
  }
  const stripeClient = getStripeClient({
    is_test_account: false,
    global_stripe_mode: globalStripeMode,
  });
  const stripeReq = opts?._stripeRequest ?? defaultStripeRequest;

  let stripeTransfers: Array<{
    id: string;
    amount: number;
    amount_reversed: number;
    reversed: boolean;
    created: number;
  }> = [];

  try {
    const listResp = await stripeReq(
      `/transfers?limit=${maxTransfers}&created[gte]=${sinceTs}`,
      'GET',
      {},
      { apiKey: stripeClient.apiKey }
    );
    report.api_calls_used++;

    if (!listResp.ok) {
      if (listResp.status === 401) {
        throw new ReconcileConfigError('Stripe auth failed (401)', {
          run_id,
          status: 401,
        });
      }
      report.completed_at = new Date().toISOString();
      report.errors.push(
        `stripe_list_failed:${listResp.status}:${listResp.body?.error?.message ?? 'unknown'}`
      );
      return report;
    }

    stripeTransfers = Array.isArray(listResp.body?.data)
      ? (listResp.body.data as typeof stripeTransfers)
      : [];
  } catch (e) {
    if (e instanceof ReconcileConfigError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    report.completed_at = new Date().toISOString();
    report.errors.push(`stripe_list_exception:${msg}`);
    return report;
  }

  report.transfers_checked = stripeTransfers.length;

  // Steg 5: matchningsalgoritm
  // A) For varje Stripe-transfer: jamfor med local
  const stripeIds = new Set<string>();
  for (const t of stripeTransfers) {
    stripeIds.add(t.id);
    const local = localByTransferId.get(t.id);

    if (!local) {
      report.mismatches.push({
        severity: 'alert',
        type: 'no_local_attempt',
        booking_id: null,
        stripe_transfer_id: t.id,
        details: { stripe_amount_ore: t.amount, stripe_created: t.created },
      });
      continue;
    }

    // Reversed check (critical, mest allvarligt)
    if (t.reversed && local.payout_status === 'paid') {
      report.mismatches.push({
        severity: 'critical',
        type: 'stripe_reversed_db_paid',
        booking_id: local.booking_id,
        stripe_transfer_id: t.id,
        details: {
          reversed_amount_ore: t.amount_reversed,
          db_amount_sek: local.amount_sek,
          attempt_id: local.attempt_id,
        },
      });
      continue;
    }

    // Amount-mismatch (critical)
    const expectedOre = local.amount_sek * 100;
    if (t.amount !== expectedOre) {
      report.mismatches.push({
        severity: 'critical',
        type: 'amount_mismatch',
        booking_id: local.booking_id,
        stripe_transfer_id: t.id,
        details: {
          stripe_ore: t.amount,
          db_ore: expectedOre,
          diff_ore: t.amount - expectedOre,
          attempt_id: local.attempt_id,
        },
      });
      continue;
    }

    // Stripe paid + DB pending
    if (local.attempt_status === 'pending') {
      report.mismatches.push({
        severity: 'alert',
        type: 'stripe_paid_db_pending',
        booking_id: local.booking_id,
        stripe_transfer_id: t.id,
        details: {
          db_status: 'pending',
          attempt_id: local.attempt_id,
        },
      });
      continue;
    }

    report.matches++;
  }

  // B) Stale pending (> 48h)
  for (const s of stalePending ?? []) {
    if (s.stripe_transfer_id && stripeIds.has(s.stripe_transfer_id)) continue;
    report.mismatches.push({
      severity: 'alert',
      type: 'stale_pending',
      booking_id: s.booking_id,
      stripe_transfer_id: s.stripe_transfer_id ?? 'unknown',
      details: {
        attempt_id: s.id,
        pending_since: s.created_at,
        amount_sek: s.amount_sek,
      },
    });
  }

  // C) DB paid men saknas i Stripe-list → verifiera via GET
  const rateAbortThreshold = Math.floor(maxApiCalls * 0.8);
  for (const b of recentBookings ?? []) {
    if (b.payout_status !== 'paid') continue;
    for (const a of recentAttempts ?? []) {
      if (a.booking_id !== b.id) continue;
      if (!a.stripe_transfer_id) continue;
      if (stripeIds.has(a.stripe_transfer_id)) continue;

      if (report.api_calls_used >= rateAbortThreshold) {
        if (!report.errors.includes('rate_limit_approaching')) {
          report.errors.push('rate_limit_approaching');
        }
        continue;
      }

      const singleResp = await stripeReq(
        `/transfers/${a.stripe_transfer_id}`,
        'GET',
        {},
        { apiKey: stripeClient.apiKey }
      );
      report.api_calls_used++;

      if (singleResp.status === 404 || !singleResp.ok) {
        report.mismatches.push({
          severity: 'critical',
          type: 'db_paid_stripe_missing',
          booking_id: b.id,
          stripe_transfer_id: a.stripe_transfer_id,
          details: {
            attempt_id: a.id,
            stripe_status: singleResp.status,
          },
        });
      } else {
        // Finns i Stripe — bara inte i list (cutoff-fragan)
        report.matches++;
      }
    }
  }

  // Steg 6: mismatch-audits (ENDAST i live-mode; dry_run ska inte
  // trassla admin-granskning av riktiga mismatches)
  if (!dryRun) {
    for (const mm of report.mismatches) {
      // Idempotens: skip om audit med samma run_id + stripe_transfer_id finns
      const { data: existing } = await supabase
        .from('payout_audit_log')
        .select('id, details')
        .eq('action', 'reconciliation_mismatch')
        .eq('stripe_transfer_id', mm.stripe_transfer_id);

      const alreadyExists = (existing ?? []).some(
        // deno-lint-ignore no-explicit-any
        (r: any) => r.details?.run_id === run_id
      );
      if (alreadyExists) continue;

      const dbAmountSek =
        typeof mm.details.db_ore === 'number'
          ? Math.round((mm.details.db_ore as number) / 100)
          : typeof mm.details.db_amount_sek === 'number'
          ? (mm.details.db_amount_sek as number)
          : null;

      const diffKr =
        typeof mm.details.diff_ore === 'number'
          ? Math.round((mm.details.diff_ore as number) / 100)
          : null;

      const { error: insErr } = await supabase
        .from('payout_audit_log')
        .insert({
          booking_id: mm.booking_id,
          action: 'reconciliation_mismatch',
          severity: mm.severity,
          amount_sek: dbAmountSek,
          stripe_transfer_id: mm.stripe_transfer_id,
          diff_kr: diffKr,
          details: {
            run_id,
            mismatch_type: mm.type,
            ...mm.details,
          },
          created_at: new Date().toISOString(),
        });

      if (insErr) {
        const msg =
          (insErr as { message?: string })?.message ?? String(insErr);
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('rls')) {
          throw new ReconcilePermissionError(
            `audit_log insert blocked: ${msg}`,
            { run_id, mismatch_type: mm.type }
          );
        }
        report.errors.push(`audit_insert_failed:${msg}`);
      }
    }
  }

  // Steg 7: run-audit (ALLTID, aven i dry_run)
  // Motivation: auto-activation i EF-lagret behover reconciliation_completed-
  // entries for att rakna clean runs. Utan denna rad = aldrig auto-activation.
  await supabase.from('payout_audit_log').insert({
    action: 'reconciliation_completed',
    severity: report.mismatches.length > 0 ? 'alert' : 'info',
    amount_sek: null,
    details: {
      run_id,
      transfers_checked: report.transfers_checked,
      matches: report.matches,
      mismatches_count: report.mismatches.length,
      api_calls_used: report.api_calls_used,
      since_days: sinceDays,
      errors: report.errors,
      mode: dryRun ? 'dry_run' : 'live',
    },
    created_at: new Date().toISOString(),
  });

  // Steg 8: return
  report.completed_at = new Date().toISOString();
  return report;
}

/**
 * SHA-256 hex-digest via WebCrypto. Anvands av reconcilePayouts
 * for run_id-generering.
 */
async function _sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// Feature flag-helpers
// ============================================================

/**
 * Ar money-layer aktiverat? (platform_settings.money_layer_enabled)
 */
export async function isMoneyLayerEnabled(
  supabase: SupabaseClient
): Promise<boolean> {
  const value = await getSettingString(supabase, 'money_layer_enabled');
  return value === 'true';
}

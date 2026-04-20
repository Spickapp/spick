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
 * @todo Fas 1.6: implementera
 */
export async function triggerStripeTransfer(
  supabase: SupabaseClient,
  booking_id: string
): Promise<PayoutAuditEntry> {
  throw new Error('Not implemented yet (Fas 1.6)');
}

/**
 * Markera payout som betald (ersatter admin.html:4478 fake markPaid).
 *
 * IDEMPOTENT — safe att kora flera ganger med samma booking_id.
 * Verifierar Stripe Transfer INNAN DB-uppdatering.
 *
 * @todo Fas 1.7: implementera
 */
export async function markPayoutPaid(
  supabase: SupabaseClient,
  booking_id: string
): Promise<PayoutAuditEntry> {
  throw new Error('Not implemented yet (Fas 1.7)');
}

/**
 * Reconciliation-cron. Hamtar senaste Stripe Transfer events och
 * matchar mot bookings.payout_status.
 *
 * @todo Fas 1.8: implementera
 */
export async function reconcilePayouts(
  supabase: SupabaseClient
): Promise<{ checked: number; matched: number; mismatched: number }> {
  throw new Error('Not implemented yet (Fas 1.8)');
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

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
    throw new Error('MoneyLayerDisabled');
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
 * Beraknar payout-struktur for en booking.
 *
 * @todo Fas 1.4: implementera
 */
export async function calculatePayout(
  supabase: SupabaseClient,
  booking_id: string
): Promise<PayoutBreakdown> {
  throw new Error('Not implemented yet (Fas 1.4)');
}

/**
 * Delar ett belopp i RUT-del (50%, Skatteverket 2026) och kund-del.
 *
 * Math.floor anvands for RUT-berakning (Skatteverket-sakert,
 * konservativt mot overclaim).
 *
 * Primarkalla: docs/architecture/money-layer.md §6
 *
 * @param gross_sek Brutto-belopp fore RUT
 * @param eligible Ar tjansten RUT-grundande?
 *                 (Hemstadning, Storstadning, Flyttstadning,
 *                  Fonsterputs, Trappstadning = ja.
 *                  Kontorsstadning, Byggstadning = nej.)
 * @todo Fas 1.5: implementera
 */
export async function calculateRutSplit(
  supabase: SupabaseClient,
  gross_sek: number,
  eligible: boolean
): Promise<RutSplit> {
  throw new Error('Not implemented yet (Fas 1.5)');
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

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
 * Hierarki (per design-dok §5):
 *   1. Smart Trappstege (om smart_trappstege_enabled=true)
 *      - Baserat pa cleaner.completed_jobs
 *   2. platform_settings.commission_standard (default)
 *
 * IGNORERAR:
 *   - cleaners.commission_rate (inkonsistent format, droppas Fas 1.10)
 *   - companies.commission_rate (samma)
 *
 * @returns commission_pct som heltal (ex. 12, 17)
 * @todo Fas 1.3: implementera
 */
export async function getCommission(
  supabase: SupabaseClient,
  context: CommissionContext
): Promise<number> {
  throw new Error('Not implemented yet (Fas 1.3)');
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

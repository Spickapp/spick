// supabase/functions/_shared/pricing-resolver.ts
// ──────────────────────────────────────────────────────────────────
// Central pricing-resolver för Spick — single source of truth.
//
// Commission läses ALLTID från platform_settings.commission_standard.
// Pris löses i 5-stegs hierarki:
//   1. company_service_prices (om companies.use_company_pricing=true)
//   2. cleaner_service_prices (individpris)
//   3. company_service_prices (fallback oavsett flaggan)
//   4. cleaners.hourly_rate
//   5. platform_settings.base_price_per_hour (default 399)
//
// Se docs/7-ARKITEKTUR-SANNING.md för full kontext.
// ──────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PricingResult {
  basePricePerHour: number;
  pricePerSqm: number | null;
  priceType: 'hourly' | 'per_sqm';
  commissionPct: number;
  source: 'company_prices' | 'cleaner_prices' | 'hourly_rate' | 'fallback';
}

type PriceRow = { price: number; price_type?: string | null };

function buildFromRow(
  row: PriceRow,
  source: PricingResult['source'],
  commissionPct: number
): PricingResult {
  const priceType: 'hourly' | 'per_sqm' =
    row.price_type === 'per_sqm' ? 'per_sqm' : 'hourly';
  return {
    basePricePerHour: priceType === 'hourly' ? row.price : 0,
    pricePerSqm: priceType === 'per_sqm' ? row.price : null,
    priceType,
    commissionPct,
    source,
  };
}

export async function resolvePricing(
  sb: SupabaseClient,
  params: { cleanerId: string; serviceType: string }
): Promise<PricingResult> {
  // Hantera "Hemstädning + Fönsterputs" → "Hemstädning"
  const serviceType = params.serviceType.split(' + ')[0].trim();

  // ── 1. Commission från platform_settings (sanning) ────────────────
  let commissionPct = 12; // fallback om platform_settings ej tillgänglig
  try {
    const { data } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', 'commission_standard')
      .single();
    if (data?.value != null) {
      const parsed = parseFloat(String(data.value));
      if (!Number.isNaN(parsed) && parsed > 0) commissionPct = parsed;
    }
  } catch (_) {
    // fallback 12 behålls
  }

  // ── 2. Hämta cleaner (company_id + hourly_rate) ───────────────────
  const { data: cleaner } = await sb
    .from('cleaners')
    .select('company_id, hourly_rate')
    .eq('id', params.cleanerId)
    .maybeSingle();

  // ── 3. Hämta use_company_pricing om cleaner tillhör företag ───────
  let useCompanyPricing = false;
  if (cleaner?.company_id) {
    const { data: company } = await sb
      .from('companies')
      .select('use_company_pricing')
      .eq('id', cleaner.company_id)
      .maybeSingle();
    useCompanyPricing = company?.use_company_pricing === true;
  }

  // ── 4a. Lager 1: use_company_pricing=true + company_service_prices ─
  if (useCompanyPricing && cleaner?.company_id) {
    const { data } = await sb
      .from('company_service_prices')
      .select('price, price_type')
      .eq('company_id', cleaner.company_id)
      .eq('service_type', serviceType)
      .maybeSingle();
    if (data?.price) return buildFromRow(data, 'company_prices', commissionPct);
  }

  // ── 4b. Lager 2: cleaner_service_prices (individpris) ─────────────
  const { data: svcPrice } = await sb
    .from('cleaner_service_prices')
    .select('price, price_type')
    .eq('cleaner_id', params.cleanerId)
    .eq('service_type', serviceType)
    .maybeSingle();
  if (svcPrice?.price) {
    return buildFromRow(svcPrice, 'cleaner_prices', commissionPct);
  }

  // ── 4c. Fallback: company_service_prices oavsett flaggan ──────────
  if (cleaner?.company_id) {
    const { data } = await sb
      .from('company_service_prices')
      .select('price, price_type')
      .eq('company_id', cleaner.company_id)
      .eq('service_type', serviceType)
      .maybeSingle();
    if (data?.price) return buildFromRow(data, 'company_prices', commissionPct);
  }

  // ── 4d. Fallback: cleaners.hourly_rate ────────────────────────────
  if (cleaner?.hourly_rate && cleaner.hourly_rate > 0) {
    return {
      basePricePerHour: cleaner.hourly_rate,
      pricePerSqm: null,
      priceType: 'hourly',
      commissionPct,
      source: 'hourly_rate',
    };
  }

  // ── 4e. Sista fallback: platform_settings.base_price_per_hour ─────
  let basePrice = 399;
  try {
    const { data } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', 'base_price_per_hour')
      .single();
    if (data?.value != null) {
      const parsed = parseFloat(String(data.value));
      if (!Number.isNaN(parsed) && parsed > 0) basePrice = parsed;
    }
  } catch (_) {
    // fallback 399 behålls
  }

  return {
    basePricePerHour: basePrice,
    pricePerSqm: null,
    priceType: 'hourly',
    commissionPct,
    source: 'fallback',
  };
}

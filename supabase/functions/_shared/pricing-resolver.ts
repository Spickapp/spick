// supabase/functions/_shared/pricing-resolver.ts
// ──────────────────────────────────────────────────────────────────
// Central pricing-resolver för Spick — single source of truth.
//
// Commission läses ALLTID från platform_settings.commission_standard.
// Min-pris-guard läses från platform_settings.min_hourly_rate (default 200).
//
// Pris löses i 6-stegs hierarki:
//   1. company_service_prices (om companies.use_company_pricing=true)
//   2. cleaner_service_prices (individpris)
//   3. company_service_prices (fallback oavsett flaggan)
//   4. cleaners.hourly_rate (ENDAST om >= min_hourly_rate — Sprint 1 Dag 2 guard)
//   5. services.default_hourly_price (fallback per tjänst — Sprint 1 Dag 2 ny)
//   6. platform_settings.base_price_per_hour (sista fallback, default 399)
//
// Hygien #30 (2026-04-23): Fönsterputs-testbokning 681aaa93 debiterades 100 kr/h
// istället för 349 kr/h eftersom cleaner.hourly_rate=100 (testdata) gick genom
// utan min-pris-check. Sprint 1 Dag 2 (2026-04-24) introducerar:
// (a) min-pris-guard i lager 4, (b) ny services-fallback i lager 5.
//
// Se docs/7-ARKITEKTUR-SANNING.md för full kontext.
// ──────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PricingResult {
  basePricePerHour: number;
  pricePerSqm: number | null;
  priceType: 'hourly' | 'per_sqm';
  commissionPct: number;
  source:
    | 'company_prices'
    | 'cleaner_prices'
    | 'hourly_rate'
    | 'service_default'
    | 'fallback';
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

async function readNumericSetting(
  sb: SupabaseClient,
  key: string,
  fallback: number
): Promise<number> {
  try {
    const { data } = await sb
      .from('platform_settings')
      .select('value')
      .eq('key', key)
      .single();
    if (data?.value != null) {
      const parsed = parseFloat(String(data.value));
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  } catch (_) {
    // fallback behålls
  }
  return fallback;
}

export async function resolvePricing(
  sb: SupabaseClient,
  params: { cleanerId: string; serviceType: string }
): Promise<PricingResult> {
  // Hantera "Hemstädning + Fönsterputs" → "Hemstädning"
  const serviceType = params.serviceType.split(' + ')[0].trim();

  // ── 1. Commission från platform_settings (sanning) ────────────────
  const commissionPct = await readNumericSetting(sb, 'commission_standard', 12);

  // ── 2. Min-pris-guard från platform_settings (Sprint 1 Dag 2) ─────
  const minHourlyRate = await readNumericSetting(sb, 'min_hourly_rate', 200);

  // ── 3. Hämta cleaner (company_id + hourly_rate) ───────────────────
  const { data: cleaner } = await sb
    .from('cleaners')
    .select('company_id, hourly_rate')
    .eq('id', params.cleanerId)
    .maybeSingle();

  // ── 4. Hämta use_company_pricing om cleaner tillhör företag ───────
  let useCompanyPricing = false;
  if (cleaner?.company_id) {
    const { data: company } = await sb
      .from('companies')
      .select('use_company_pricing')
      .eq('id', cleaner.company_id)
      .maybeSingle();
    useCompanyPricing = company?.use_company_pricing === true;
  }

  // ── 5a. Lager 1: use_company_pricing=true + company_service_prices ─
  if (useCompanyPricing && cleaner?.company_id) {
    const { data } = await sb
      .from('company_service_prices')
      .select('price, price_type')
      .eq('company_id', cleaner.company_id)
      .eq('service_type', serviceType)
      .maybeSingle();
    if (data?.price) return buildFromRow(data, 'company_prices', commissionPct);
  }

  // ── 5b. Lager 2: cleaner_service_prices (individpris) ─────────────
  const { data: svcPrice } = await sb
    .from('cleaner_service_prices')
    .select('price, price_type')
    .eq('cleaner_id', params.cleanerId)
    .eq('service_type', serviceType)
    .maybeSingle();
  if (svcPrice?.price) {
    return buildFromRow(svcPrice, 'cleaner_prices', commissionPct);
  }

  // ── 5c. Fallback: company_service_prices oavsett flaggan ──────────
  if (cleaner?.company_id) {
    const { data } = await sb
      .from('company_service_prices')
      .select('price, price_type')
      .eq('company_id', cleaner.company_id)
      .eq('service_type', serviceType)
      .maybeSingle();
    if (data?.price) return buildFromRow(data, 'company_prices', commissionPct);
  }

  // ── 5d. Fallback: cleaners.hourly_rate (ENDAST om >= min_hourly_rate) ──
  // Min-pris-guard skyddar mot testdata + misstag där cleaner satt för lågt pris.
  if (cleaner?.hourly_rate && cleaner.hourly_rate >= minHourlyRate) {
    return {
      basePricePerHour: cleaner.hourly_rate,
      pricePerSqm: null,
      priceType: 'hourly',
      commissionPct,
      source: 'hourly_rate',
    };
  }

  // ── 5e. Fallback: services.default_hourly_price (per tjänst) ──────
  // Säkerhetsnät när cleaner-specifik rate är låg/saknas men tjänsten har default.
  const { data: serviceRow } = await sb
    .from('services')
    .select('default_hourly_price')
    .eq('key', serviceType)
    .maybeSingle();
  if (serviceRow?.default_hourly_price && serviceRow.default_hourly_price > 0) {
    return {
      basePricePerHour: serviceRow.default_hourly_price,
      pricePerSqm: null,
      priceType: 'hourly',
      commissionPct,
      source: 'service_default',
    };
  }

  // ── 5f. Sista fallback: platform_settings.base_price_per_hour ─────
  const basePrice = await readNumericSetting(sb, 'base_price_per_hour', 399);

  return {
    basePricePerHour: basePrice,
    pricePerSqm: null,
    priceType: 'hourly',
    commissionPct,
    source: 'fallback',
  };
}

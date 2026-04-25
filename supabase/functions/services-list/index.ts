// ============================================================
// services-list: Public read of services + addons
// ============================================================
// F1 Dag 1 - arkitekturplan v3
// Design: docs/architecture/fas-1-services-design.md Section 6
//
// Returns { services: [...], addons: { service_key: [...] } }
// filtered on active=true, sorted by display_order.
// Cache-Control: max-age=300 (5 min) for CDN + client caching.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=300',
};

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Read services (RLS filters active=true for anon)
    const { data: services, error: svcError } = await supabase
      .from('services')
      .select('key, label_sv, label_en, description_sv, rut_eligible, is_b2b, is_b2c, hour_multiplier, default_hourly_price, display_order, icon_key, ui_config')
      .order('display_order', { ascending: true });

    if (svcError) {
      console.error('services-list: services query failed', svcError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch services' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // §4.8 Coverage-filter (Farhad-direktiv 2026-04-25): visa bara
    // tjänster som minst en aktiv cleaner faktiskt erbjuder. Undviker
    // "tom-tjänst-känsla" där kund kan välja t.ex. Mattrengöring men
    // inga städare matchar. Aktiva cleaners: status IN ('aktiv',
    // 'company_owner'). Testdata/onboarding-cleaners exkluderas.
    const { data: activeCleaners, error: cleanerErr } = await supabase
      .from('v_cleaners_public')
      .select('services, status')
      .in('status', ['aktiv', 'company_owner']);

    let filteredServices = services ?? [];
    if (cleanerErr) {
      console.warn('services-list: cleaner-coverage-fetch failed, returnerar alla services', cleanerErr);
      // Fail-soft: om coverage-filter misslyckas → returnera alla services
      // (gamla beteendet, ingen breaking change vid DB-issue).
    } else {
      const offeredLabels = new Set<string>();
      for (const c of (activeCleaners ?? [])) {
        if (Array.isArray((c as { services?: unknown }).services)) {
          for (const s of (c as { services: string[] }).services) {
            if (typeof s === 'string') offeredLabels.add(s);
          }
        }
      }
      filteredServices = filteredServices.filter((s: { label_sv: string }) =>
        offeredLabels.has(s.label_sv)
      );
    }

    // Read addons with service_id join (RLS filters active=true for anon)
    const { data: addonRows, error: addonError } = await supabase
      .from('service_addons')
      .select('id, key, label_sv, label_en, price_sek, display_order, service_id, rut_eligible, services!inner(key)')
      .order('display_order', { ascending: true });

    if (addonError) {
      console.error('services-list: addons query failed', addonError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch addons' }),
        { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
      );
    }

    // Group addons by service key
    const addons: Record<string, any[]> = {};
    for (const row of addonRows ?? []) {
      const serviceKey = (row as any).services?.key;
      if (!serviceKey) continue;
      if (!addons[serviceKey]) addons[serviceKey] = [];
      addons[serviceKey].push({
        id: row.id,
        key: row.key,
        label_sv: row.label_sv,
        label_en: row.label_en,
        price_sek: row.price_sek,
        display_order: row.display_order,
        rut_eligible: row.rut_eligible === true,
      });
    }

    return new Response(
      JSON.stringify({ services: filteredServices, addons }),
      {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          ...CACHE_HEADERS,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (err) {
    console.error('services-list: unexpected error', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});

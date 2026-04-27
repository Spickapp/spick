/**
 * commission-helpers.js – delad commission-rate-infrastruktur
 *
 * Läser platform_settings.commission_standard vid sidladdning och
 * cache:ar i window.SPICK_COMMISSION. Exponerar synchrona helpers
 * som throw:ar om init inte kört klart.
 *
 * Användning:
 *   <script src="js/config.js"></script>
 *   <script src="js/commission-helpers.js"></script>
 *   ...
 *   await window.SPICK_COMMISSION_READY;  // i init-flödet
 *   const keep = getKeepRate();            // synkron läsning efteråt
 *
 * Primärkälla: docs/planning/spick-arkitekturplan-v3.md §1.9 (rad 149)
 * Etablerad: §1.7 (stadare-dashboard.html), centraliserad §1.9a.
 */

window.SPICK_COMMISSION_READY = (async function loadCommissionSettings() {
  const r = await fetch(
    SPICK.SUPA_URL + '/rest/v1/platform_settings?key=eq.commission_standard&select=value',
    { headers: { apikey: SPICK.SUPA_KEY, Authorization: 'Bearer ' + SPICK.SUPA_KEY } }
  );
  if (!r.ok) throw new Error('platform_settings fetch failed: HTTP ' + r.status);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error('commission_standard saknas i platform_settings');
  const pct = Number(rows[0].value);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100)
    throw new Error('ogiltigt commission_standard: ' + rows[0].value);
  window.SPICK_COMMISSION = { keepRate: (100 - pct) / 100, commissionPct: pct };
})();

// Helpers fallback:ar tyst med default 12% commission om kallad innan
// SPICK_COMMISSION_READY resolved. Förr throw:ade vi → spammade Sentry
// pga race conditions i 25+ callers. Default = nuvarande prod-värde
// (platform_settings.commission_standard=12). Caller som vill säkert
// färskt värde gör await window.SPICK_COMMISSION_READY först.
function getKeepRate() {
  if (!window.SPICK_COMMISSION) return 0.88;
  return window.SPICK_COMMISSION.keepRate;
}

function getCommissionRate() {
  if (!window.SPICK_COMMISSION) return 0.12;
  return window.SPICK_COMMISSION.commissionPct / 100;
}

function getCommissionPct() {
  if (!window.SPICK_COMMISSION) return 12;
  return window.SPICK_COMMISSION.commissionPct;
}

/* ── PRICING HELPERS (§1.8, 2026-04-22) ──────────────────────────────
 * default_hourly_rate används som UI-default i admin/bli-stadare/join-team
 * när cleaner.hourly_rate saknas. Skild från platform_settings.base_price_per_hour
 * (pricing-resolver-fallback) — se docs/v3-phase1-progress.md hygien-task.
 */
window.SPICK_PRICING_READY = (async function loadPricingSettings() {
  const r = await fetch(
    SPICK.SUPA_URL + '/rest/v1/platform_settings?key=eq.default_hourly_rate&select=value',
    { headers: { apikey: SPICK.SUPA_KEY, Authorization: 'Bearer ' + SPICK.SUPA_KEY } }
  );
  if (!r.ok) throw new Error('default_hourly_rate fetch failed: HTTP ' + r.status);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error('default_hourly_rate saknas i platform_settings');
  const rate = Number(rows[0].value);
  if (!Number.isFinite(rate) || rate < 100 || rate > 2000)
    throw new Error('ogiltigt default_hourly_rate: ' + rows[0].value);
  window.SPICK_PRICING = { defaultHourlyRate: rate };
})();

function getDefaultHourlyRate() {
  if (!window.SPICK_PRICING)
    throw new Error('getDefaultHourlyRate anropad före SPICK_PRICING_READY');
  return window.SPICK_PRICING.defaultHourlyRate;
}

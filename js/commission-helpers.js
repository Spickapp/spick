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

function getKeepRate() {
  if (!window.SPICK_COMMISSION)
    throw new Error('getKeepRate anropad före SPICK_COMMISSION_READY');
  return window.SPICK_COMMISSION.keepRate;
}

function getCommissionRate() {
  if (!window.SPICK_COMMISSION)
    throw new Error('getCommissionRate anropad före SPICK_COMMISSION_READY');
  return window.SPICK_COMMISSION.commissionPct / 100;
}

function getCommissionPct() {
  if (!window.SPICK_COMMISSION)
    throw new Error('getCommissionPct anropad före SPICK_COMMISSION_READY');
  return window.SPICK_COMMISSION.commissionPct;
}

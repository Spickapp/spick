// ============================================================
// services-loader.js -- Shared helper for F1 DB-services migration
// ============================================================
// F1 Dag 2 - arkitekturplan v3
// Design: docs/architecture/fas-1-services-design.md Section 7
//
// Loads feature flag + services + addons from DB.
// Populates window.SPICK_SERVICES and window.SPICK_FLAGS.
// Consumers check window.SPICK_FLAGS?.F1_USE_DB_SERVICES before
// using DB-backed data; fallback to hardcoded arrays otherwise.
//
// Dependencies: config.js (SPICK.SUPA_URL, SPICK.SUPA_KEY) must be
// loaded before this script. Declare as <script defer> after config.js.
//
// Cache strategy: Relies on HTTP Cache-Control (5 min) set by
// services-list Edge Function. No in-memory or sessionStorage layer.
// ============================================================

(function() {
  'use strict';

  if (typeof SPICK === 'undefined' || !SPICK.SUPA_URL || !SPICK.SUPA_KEY) {
    console.error('[services-loader] SPICK config missing. services-loader.js must load after config.js.');
    return;
  }

  window.SPICK_FLAGS = window.SPICK_FLAGS || {};
  window.SPICK_SERVICES = window.SPICK_SERVICES || { services: [], addons: {} };

  window.SPICK_SERVICES_READY = (async function loadServicesAndFlags() {
    try {
      const flagRes = await fetch(
        SPICK.SUPA_URL + '/rest/v1/platform_settings?key=eq.F1_USE_DB_SERVICES&select=value',
        { headers: { apikey: SPICK.SUPA_KEY, Authorization: 'Bearer ' + SPICK.SUPA_KEY } }
      );

      if (flagRes.ok) {
        const flagRows = await flagRes.json();
        const flagValue = flagRows[0]?.value || 'false';
        window.SPICK_FLAGS.F1_USE_DB_SERVICES = String(flagValue).toLowerCase() === 'true';
      } else {
        console.warn('[services-loader] Flag fetch failed, defaulting to false');
        window.SPICK_FLAGS.F1_USE_DB_SERVICES = false;
      }

      if (!window.SPICK_FLAGS.F1_USE_DB_SERVICES) {
        return { flag: false, services: 0, addons: 0 };
      }

      const svcRes = await fetch(
        SPICK.SUPA_URL + '/functions/v1/services-list',
        { headers: { apikey: SPICK.SUPA_KEY } }
      );

      if (!svcRes.ok) {
        console.error('[services-loader] services-list EF returned ' + svcRes.status);
        return { flag: true, services: 0, addons: 0, error: svcRes.status };
      }

      const data = await svcRes.json();
      window.SPICK_SERVICES.services = Array.isArray(data.services) ? data.services : [];
      window.SPICK_SERVICES.addons = data.addons && typeof data.addons === 'object' ? data.addons : {};

      return {
        flag: true,
        services: window.SPICK_SERVICES.services.length,
        addons: Object.keys(window.SPICK_SERVICES.addons).length
      };
    } catch (err) {
      console.error('[services-loader] Unexpected error, falling back to hardcoded lists:', err);
      window.SPICK_FLAGS.F1_USE_DB_SERVICES = false;
      return { flag: false, error: err.message };
    }
  })();

  window.SPICK_SERVICES.filterB2B = function() {
    return (window.SPICK_SERVICES.services || []).filter(function(s) { return s.is_b2b; });
  };

  window.SPICK_SERVICES.filterB2C = function() {
    return (window.SPICK_SERVICES.services || []).filter(function(s) { return s.is_b2c; });
  };

  window.SPICK_SERVICES.getByKey = function(key) {
    return (window.SPICK_SERVICES.services || []).find(function(s) { return s.key === key; });
  };

  window.SPICK_SERVICES.getByLabel = function(label) {
    return (window.SPICK_SERVICES.services || []).find(function(s) { return s.label_sv === label; });
  };

  window.SPICK_SERVICES.rutLabels = function() {
    return (window.SPICK_SERVICES.services || [])
      .filter(function(s) { return s.rut_eligible; })
      .map(function(s) { return s.label_sv; });
  };

  window.SPICK_SERVICES.b2bLabels = function() {
    return (window.SPICK_SERVICES.services || [])
      .filter(function(s) { return s.is_b2b; })
      .map(function(s) { return s.label_sv; });
  };
})();

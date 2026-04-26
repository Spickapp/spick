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
// RENDERING (F1 Dag 2C.2, moved here from boka.html inline):
// If any element in DOM has [data-services-render], renderer replaces
// its children with DB-driven buttons when flag=true. Opt-in per page.
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

  function renderServicesToGrid(grid, services) {
    if (!grid || !services || services.length === 0) return 0;
    grid.innerHTML = '';
    services.forEach(function(s) {
      var uc = s.ui_config || {};
      var emoji = uc.emoji || '';
      var desc = uc.desc_sv || '';
      var isPopular = uc.is_popular === true;
      var b2bId = uc.b2b_id || '';
      var isB2B = !!b2bId;
      var btn = document.createElement('button');
      btn.className = 'svc-btn';
      btn.setAttribute('data-svc', s.label_sv);
      (function(svc) {
        btn.addEventListener('click', function() {
          if (typeof selectService === 'function') {
            selectService(svc.label_sv, '', '', '');
          }
        });
      })(s);
      if (isB2B) {
        btn.id = b2bId;
        btn.style.display = 'none';
      }
      if (isPopular) {
        btn.style.position = 'relative';
        var badge = document.createElement('span');
        badge.style.cssText = 'position:absolute;top:-8px;right:-8px;background:#F59E0B;color:#fff;font-size:.65rem;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:.02em';
        badge.textContent = 'POPULÄRAST';
        btn.appendChild(badge);
      }
      var iconSpan = document.createElement('span');
      iconSpan.className = 'svc-icon';
      iconSpan.textContent = emoji;
      var nameSpan = document.createElement('span');
      nameSpan.className = 'svc-name';
      nameSpan.textContent = s.label_sv;
      var descSpan = document.createElement('span');
      descSpan.className = 'svc-desc';
      descSpan.textContent = desc;
      btn.appendChild(iconSpan);
      btn.appendChild(nameSpan);
      btn.appendChild(descSpan);
      grid.appendChild(btn);
    });
    return services.length;
  }

  function triggerRender() {
    if (!window.SPICK_FLAGS.F1_USE_DB_SERVICES) return;
    var grids = document.querySelectorAll('[data-services-render]');
    if (grids.length === 0) return;
    var services = window.SPICK_SERVICES.services;
    if (!services || services.length === 0) return;
    var totalRendered = 0;
    grids.forEach(function(grid) {
      totalRendered += renderServicesToGrid(grid, services);
    });
    console.log('[F1] Rendered ' + totalRendered + ' services into ' + grids.length + ' grid(s)');
  }

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

      // Audit-fix 2026-04-26: services-list EF flakar 40% 503 (cold-start/
      // transient). Defensive: sessionStorage-cache (5 min TTL) + retry 2x.
      const _CACHE_KEY = 'spick_services_cache_v1';
      const _CACHE_TTL_MS = 5 * 60 * 1000;
      let data = null;
      try {
        const cached = sessionStorage.getItem(_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && (Date.now() - parsed.ts) < _CACHE_TTL_MS && parsed.data) {
            data = parsed.data;
          }
        }
      } catch(_) { /* cache-fel ignoreras */ }

      if (!data) {
        let svcRes = null;
        for (let attempt = 0; attempt < 3 && !data; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 200 * attempt));
          try {
            svcRes = await fetch(
              SPICK.SUPA_URL + '/functions/v1/services-list',
              { headers: { apikey: SPICK.SUPA_KEY } }
            );
            if (svcRes.ok) {
              data = await svcRes.json();
              try { sessionStorage.setItem(_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
              break;
            }
          } catch(_) { /* network-fel → retry */ }
        }
        if (!data) {
          console.error('[services-loader] services-list EF failed after 3 retries (status ' + (svcRes ? svcRes.status : 'no-response') + ')');
          return { flag: true, services: 0, addons: 0, error: svcRes ? svcRes.status : 0 };
        }
      }
      window.SPICK_SERVICES.services = Array.isArray(data.services) ? data.services : [];
      window.SPICK_SERVICES.addons = data.addons && typeof data.addons === 'object' ? data.addons : {};

      // §4 services-migration (rule #28 SSOT + rule #30 Skatteverket): expose
      // RUT-eligible service-labels som primärkälla från DB. Konsumerande sidor
      // (boka.html, stadare-dashboard.html, admin.html etc) ska använda
      // window.SPICK_RUT_SERVICES med fallback till hardcoded-default vid
      // load-fail. services.rut_eligible-kolumn är primärkällan.
      window.SPICK_RUT_SERVICES = window.SPICK_SERVICES.services
        .filter(function(s) { return s.rut_eligible === true; })
        .map(function(s) { return s.label_sv; });

      // §4.5 ALL services (RUT + non-RUT). Konsumerande sidor använder för
      // dropdown/checkbox-listor, t.ex. cleaner-services-edit (väljer vilka
      // tjänster städaren erbjuder).
      window.SPICK_ALL_SERVICES = window.SPICK_SERVICES.services
        .map(function(s) { return s.label_sv; });

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', triggerRender);
      } else {
        triggerRender();
      }

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

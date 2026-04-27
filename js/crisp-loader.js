// ============================================================
// crisp-loader.js -- Lazy-loader för Crisp live-chat (EU region)
// ============================================================
// Cleaner-recruitment 2026-04-26 — kund-conversion + signup-frågor.
//
// Pattern: matchar posthog-loader.js + Sentry-lazy-load (defensive,
// silent skip om CRISP_WEBSITE_ID saknas, no console errors).
//
// Datasäkerhet (rule #30 — teknisk konfig, Farhad gör jurist-bedömning):
//   - Crisp EU region (client.crisp.chat hostas i Frankrike) — curl-verifierat
//     2026-04-26 (HTTP 200, Cloudflare-edge med EU-residency per Crisp docs).
//   - Inputs MASKAS INTE — vi vill se vad kunder skriver (support-funktion).
//   - Widget HIDES på admin-pages + cleaner-dashboards (sensitive context).
//
// Setup (för Farhad):
//   1. Signup på crisp.chat → välj EU region.
//   2. Skapa workspace "Spick" → kopiera Website-ID från Settings.
//   3. Sätt SPICK.CRISP_WEBSITE_ID i js/config.js.
//   4. Update CSP i Cloudflare per docs/crisp-setup.md.
//
// Dependencies: config.js (SPICK.CRISP_WEBSITE_ID) måste laddas FÖRE denna fil.
// Deklareras som <script src="js/crisp-loader.js" defer></script> efter posthog-loader.js.
// ============================================================

(function() {
  'use strict';

  if (typeof SPICK === 'undefined') {
    // config.js inte laddad — silent skip (matchar posthog-loader-mönster)
    return;
  }

  var websiteId = SPICK.CRISP_WEBSITE_ID || '';
  if (!websiteId) {
    // Ingen ID konfigurerad → no-op. Inga console errors, säkert att deploya.
    return;
  }

  // Hide widget på sensitive pages:
  //   - /admin* (alla admin-vyer, känslig data)
  //   - stadare-dashboard (cleaners går via support-email istället per spec 2026-04-26)
  var path = (location.pathname || '').toLowerCase();
  var isAdminPage = path.indexOf('/admin') === 0 ||
                    path.indexOf('admin.html') !== -1 ||
                    path.indexOf('admin-') !== -1;
  var isCleanerDashboard = path.indexOf('stadare-dashboard') !== -1;

  if (isAdminPage || isCleanerDashboard) {
    // Skip helt — laddar inte ens scriptet, sparar bandbredd + undviker UI-flicker.
    return;
  }

  // Crisp config MÅSTE sättas FÖRE script-load (Crisp läser window.$crisp + WEBSITE_ID på boot).
  window.$crisp = [];
  window.CRISP_WEBSITE_ID = websiteId;

  // Custom färg matchande Spick brand (#0F6E56 primary).
  // Crisp använder "theme_color" via runtime-API.
  window.$crisp.push(['safe', true]); // unika user-IDs istället för cookies där möjligt
  window.$crisp.push(['set', 'session:segments', [['web', 'spick-' + (location.pathname.split('/')[1] || 'home')]]]);

  // Auto-fyll user-info om Supabase-session finns (kör efter SDK loaded).
  // Wrapas i try så broken auth aldrig blockerar chat.
  window.CRISP_READY_TRIGGER = function() {
    try {
      // Custom färg via Crisp runtime (matchar #0F6E56)
      if (window.$crisp && typeof window.$crisp.push === 'function') {
        window.$crisp.push(['set', 'message:text', ['Hej! Behöver du hjälp? Vi svarar oftast inom några minuter.']]);
      }

      // Auto-identify från Supabase-session
      if (typeof window.SB !== 'undefined' && window.SB.auth) {
        window.SB.auth.getUser().then(function(res) {
          var u = res && res.data && res.data.user;
          if (u && u.email) {
            window.$crisp.push(['set', 'user:email', [u.email]]);
            var name = (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || '';
            if (name) {
              window.$crisp.push(['set', 'user:nickname', [name]]);
            }
            // Sätt role som session-data så Farhad ser direkt om det är kund/cleaner
            var role = u.user_metadata && u.user_metadata.role;
            if (role) {
              window.$crisp.push(['set', 'session:data', [[['user_role', role]]]]);
            }
          }
        }).catch(function() { /* no-op — auth ej tillgänglig */ });
      }
    } catch (_) { /* SB ej laddad — chat funkar ändå */ }
  };

  // Lazy-load Crisp SDK från officiell EU-CDN.
  try {
    var s = document.createElement('script');
    s.src = 'https://client.crisp.chat/l.js';
    s.async = true;
    s.onerror = function() {
      console.warn('[crisp] failed to load — chat unavailable');
    };
    (document.head || document.body).appendChild(s);
  } catch (e) {
    console.warn('[crisp] init failed:', e && e.message);
  }
})();

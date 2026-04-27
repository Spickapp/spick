// ============================================================
// posthog-loader.js -- Lazy-loader för PostHog (EU Cloud)
// ============================================================
// Fas 11.x Observability — PostHog session replay + product analytics + feature flags.
//
// Pattern: matchar Sentry-lazy-load i config.js + services-loader.js (defensive,
// silent skip om key saknas, no console errors).
//
// Datasäkerhet (rule #30 — teknisk PII-masking, ej juridisk tolkning):
//   - PostHog EU Cloud (eu.i.posthog.com) → data lagras i Frankfurt, ingen
//     EU→US-transfer. Curl-verifierat 2026-04-26.
//   - mask_all_input: true → PNR, email, telefon, lösenord MASKAS i replay.
//   - mask_all_text: false → vi vill se rendered text för debug (inte input-fält).
//   - Disable autocapture på admin/dashboard-sidor (känslig data syns).
//
// Setup (för Farhad):
//   1. Signup på posthog.com → välj "EU Cloud" region (Frankfurt).
//   2. Skapa projekt "Spick web" → kopiera "Project API Key" (phc_...).
//   3. Sätt SPICK.POSTHOG_KEY i js/config.js.
//   4. Update CSP i Cloudflare per docs/csp-update-posthog.md.
//
// Dependencies: config.js (SPICK.POSTHOG_KEY) måste laddas FÖRE denna fil.
// Deklareras som <script src="js/posthog-loader.js" defer></script> efter config.js.
// ============================================================

(function() {
  'use strict';

  if (typeof SPICK === 'undefined') {
    // config.js inte laddad — silent skip (matchar services-loader-mönster)
    return;
  }

  var key = SPICK.POSTHOG_KEY || '';
  if (!key) {
    // Ingen key konfigurerad → no-op. Inga console errors, inga consent-issues.
    return;
  }

  // Disable autocapture för admin + cleaner dashboards (PII-tunga vyer).
  // Replay är aktiverat globalt med input-masking, men autocapture (klick på
  // alla element) skippar dessa pages helt för att undvika onödig event-volym.
  var path = (location.pathname || '').toLowerCase();
  var isAdminPage = path.indexOf('/admin') === 0 ||
                    path.indexOf('admin.html') !== -1 ||
                    path.indexOf('admin-') !== -1;
  var isCleanerDashboard = path.indexOf('stadare-dashboard') !== -1 ||
                           path.indexOf('foretag-dashboard') !== -1 ||
                           path.indexOf('mitt-konto') !== -1;
  var disableAutocapture = isAdminPage || isCleanerDashboard;

  // PostHog snippet (officiell EU-variant).
  // Källa: https://posthog.com/docs/libraries/js (EU-host swap).
  // Inline snippet undviker race condition med defer-loading; SDK lazy-laddas
  // från eu-assets.i.posthog.com inom snippet:en.
  !function(t,e){
    var o,n,p,r;
    e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){
      function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}
      (p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,
      p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",
      (r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);
      var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],
      u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},
      u.people.toString=function(){return u.toString(1)+".people (stub)"},
      o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);
      e._i.push([i,s,a])
    },e.__SV=1)
  }(document,window.posthog||[]);

  try {
    window.posthog.init(key, {
      api_host: 'https://eu.i.posthog.com',
      ui_host: 'https://eu.posthog.com',
      person_profiles: 'identified_only', // skapa profile först vid identify (sparar event-volym)

      // Session Replay
      session_recording: {
        maskAllInputs: true,           // PNR, email, telefon, lösenord MASKAS
        maskTextSelector: '[data-ph-mask]', // opt-in masking via data-attr
        maskInputOptions: {
          password: true,
          email: true,
          tel: true,
          number: true,
        },
        // Block helt på betal-/PNR-element (extra säkerhet om input-masking skulle missa)
        blockSelector: '[data-ph-block], input[type="password"], input[autocomplete="cc-number"], input[name*="pnr" i], input[name*="personnummer" i]',
      },
      disable_session_recording: false, // replay PÅ globalt (utom admin/dashboard pga autocapture-disable nedan)

      // Autocapture (klick/scroll/form). Av på admin + cleaner dashboards.
      autocapture: !disableAutocapture,
      capture_pageview: true,
      capture_pageleave: true,

      // PII-defaults (rule #30 — teknisk default, Farhad bedömer juridiskt)
      respect_dnt: true,                   // honor Do-Not-Track
      mask_all_text: false,                // se rendered text för debug
      mask_all_element_attributes: false,

      // EU-cloud cookies. cross_subdomain_cookie=false så cookien stannar på spick.se.
      cross_subdomain_cookie: false,
      persistence: 'localStorage+cookie',

      loaded: function(ph) {
        // Identify user om Supabase-session finns (set efter SB.auth.getUser).
        // Kör i nästa tick så supabase-client hinner bootstrap:a.
        try {
          if (typeof window.SB !== 'undefined' && window.SB.auth) {
            window.SB.auth.getUser().then(function(res) {
              var u = res && res.data && res.data.user;
              if (u && u.id) {
                ph.identify(u.id, {
                  // Inga PII här. Email + namn lägger Farhad till manuellt
                  // efter consent-flöde är på plats.
                  user_role: u.user_metadata && u.user_metadata.role,
                  signup_date: u.created_at,
                });
              }
            }).catch(function() { /* no-op */ });
          }
        } catch(_) { /* SB ej tillgänglig — skip */ }

        if (disableAutocapture) {
          console.info('[posthog] autocapture disabled on this page (admin/dashboard)');
        }
      },
    });
  } catch (e) {
    console.warn('[posthog] init failed:', e && e.message);
  }
})();

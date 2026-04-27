// ═══════════════════════════════════════════════════════════════
// SPICK – Centraliserad konfiguration
// Importera denna fil ISTÄLLET för att hårdkoda nycklar i HTML
// ═══════════════════════════════════════════════════════════════

const SPICK = Object.freeze({
  SUPA_URL:  'https://urjeijcncsyuletprydy.supabase.co',
  SUPA_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0',
  SITE_URL:  'https://spick.se',
  ADMIN_EMAIL: 'hello@spick.se',
  VERSION:   '3.0.0',
  GOOGLE_PLACES_KEY: 'AIzaSyCScYORJPxXCyp0J-Wmr84HtiZc9FteVrs',
  // Fas 10 Sentry frontend — DSN är public per Sentry's design.
  // Aktiverat 2026-04-26 av Farhad. EU-region (.de.sentry.io) per GDPR.
  // Lazy-load Sentry browser SDK från CDN vid första error/spickCaptureException.
  SENTRY_DSN: 'https://c59290e72560cf7d14bea89e86a603bf@o4511287877828608.ingest.de.sentry.io/4511287893229648',
  SENTRY_ENVIRONMENT: 'production',
  SENTRY_RELEASE: 'spick-web-2026-04-26',
  // PostHog (Fas 11.x Observability) — EU Cloud (Frankfurt) per GDPR.
  // Tom = no-op (lazy-loader skippar silent). Sätts av Farhad efter signup
  // på posthog.com → välj EU region → kopiera "Project API Key" (phc_...).
  // Setup-guide: docs/csp-update-posthog.md.
  POSTHOG_KEY: 'phc_uyAZjjps4RGHEPVT23yrV4mbZSCNMJopEkpmYBVh7BiB',
});

// Exponera globalt för pages som boot-checkar `window.SPICK`
// (Sprint B-era: foretag-dashboard, join-team, registrera-foretag).
// const-deklaration skapar INTE automatiskt window-property i moderna
// browsers — måste sättas explicit.
window.SPICK = SPICK;

// Gemensamma headers för Supabase REST API
const SPICK_HEADERS = Object.freeze({
  'Content-Type': 'application/json',
  'apikey': SPICK.SUPA_KEY,
  'Authorization': 'Bearer ' + SPICK.SUPA_KEY,
});

// Helper: POST till Edge Function
async function spickFetch(fnName, body) {
  const res = await fetch(`${SPICK.SUPA_URL}/functions/v1/${fnName}`, {
    method: 'POST',
    headers: SPICK_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fnName}: HTTP ${res.status}`);
  return res.json();
}

// Helper: Supabase REST GET
async function spickGet(table, query = '') {
  const res = await fetch(`${SPICK.SUPA_URL}/rest/v1/${table}?${query}`, {
    headers: SPICK_HEADERS,
  });
  if (!res.ok) throw new Error(`GET ${table}: HTTP ${res.status}`);
  return res.json();
}

// Helper: Supabase REST POST (insert)
async function spickInsert(table, data) {
  const res = await fetch(`${SPICK.SUPA_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...SPICK_HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(data),
  });
  return res;
}

// Helper: Skicka notifikation via notify Edge Function
async function spickNotify(type, record) {
  try {
    return await spickFetch('notify', { type, record });
  } catch(e) {
    console.error('spickNotify:', e.message);
    return { ok: false };
  }
}
// XSS Prevention
function escHtml(s) {
  if (typeof s !== 'string') return String(s || '');
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
window.escHtml = escHtml;

// ── SENTRY (Fas 10 Observability) ────────────────────────────
// Lazy-load Sentry browser SDK från CDN vid första error/explicit captureException.
// Inget bundle-overhead om Sentry aldrig triggas. DSN=null → no-op.
//
// PII-sanering: Sentry's beforeSend-hook strippar PNR-mönster + auth-headers.
(function initSentryLazy() {
  if (!SPICK.SENTRY_DSN) return; // Av tills DSN konfigurerats
  let sentryReady = null;

  window.spickCaptureException = function(err, ctx) {
    if (!sentryReady) {
      sentryReady = new Promise(function(resolve) {
        var s = document.createElement('script');
        s.src = 'https://browser.sentry-cdn.com/8.0.0/bundle.min.js';
        s.crossOrigin = 'anonymous';
        s.onload = function() {
          window.Sentry.init({
            dsn: SPICK.SENTRY_DSN,
            environment: SPICK.SENTRY_ENVIRONMENT,
            release: SPICK.SENTRY_RELEASE,
            sampleRate: 1.0,
            tracesSampleRate: 0.1, // 10% performance-sampling
            beforeSend: function(event) {
              // PII-sanering: maska PNR + strippa auth-headers
              try {
                var json = JSON.stringify(event)
                  .replace(/\b(\d{6,8})[-]?\d{4}\b/g, '[PNR-MASKED]')
                  .replace(/("(?:apikey|authorization|x-api-key|password|token)"\s*:\s*)"[^"]+"/gi, '$1"[REDACTED]"');
                event = JSON.parse(json);
              } catch(_) {}
              return event;
            },
          });
          resolve(window.Sentry);
        };
        s.onerror = function() { resolve(null); };
        document.head.appendChild(s);
      });
    }
    sentryReady.then(function(Sentry) {
      if (Sentry) {
        Sentry.captureException(err, { extra: ctx || {} });
      }
    });
  };
})();
// ── PRODUCTION RESILIENCE ────────────────────────────────────

// Global error handler — fångar uncaught errors utan att visa rå stacktraces
window.addEventListener('error', function(e) {
  console.error('[SPICK]', e.message, e.filename, e.lineno);
  // Fas 10: skicka även till Sentry om aktiverat
  if (typeof window.spickCaptureException === 'function') {
    try {
      window.spickCaptureException(e.error || new Error(e.message), {
        file: e.filename, line: e.lineno, page: location.pathname,
      });
    } catch(_) {}
  }
  // Skicka till analytics (fire-and-forget). sendBeacon kan inte sätta apikey-
  // header → CORS-fel mot Supabase. Använd fetch+keepalive istället så vi kan
  // inkludera apikey + Authorization-headers (krav för PostgREST).
  try {
    fetch(SPICK.SUPA_URL + '/rest/v1/analytics_events', {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SPICK.SUPA_KEY,
        'Authorization': 'Bearer ' + SPICK.SUPA_KEY,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        event_type: 'js_error',
        // Schema-verifierat 2026-04-26: kolumnen heter 'metadata' (jsonb), inte 'data'
        metadata: { msg: e.message, file: e.filename, line: e.lineno, page: location.pathname },
      }),
    }).catch(function() {});
  } catch(_) {}
});

// Unhandled promise rejection
window.addEventListener('unhandledrejection', function(e) {
  console.error('[SPICK] Unhandled:', e.reason?.message || e.reason);
  if (typeof window.spickCaptureException === 'function') {
    try {
      var err = (e.reason instanceof Error) ? e.reason : new Error(String(e.reason));
      window.spickCaptureException(err, { type: 'unhandledrejection', page: location.pathname });
    } catch(_) {}
  }
});

// Fetch med timeout + retry (för frontend-anrop)
async function spickFetchSafe(url, opts = {}, retries = 2, timeoutMs = 10000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(tid);
      if (res.ok || res.status < 500) return res;
      // 5xx → retry
      if (i < retries) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    } catch(e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Graceful degradation: visa användarvänligt felmeddelande
function spickShowError(containerSelector, message) {
  const el = document.querySelector(containerSelector);
  if (el) {
    el.innerHTML = '<div style="text-align:center;padding:2rem;color:#92400E;background:#FEF3C7;border-radius:12px;margin:1rem 0">' +
      '<p style="font-weight:600;margin:0 0 .5rem">Något gick fel</p>' +
      '<p style="margin:0;font-size:.9rem">' + (message || 'Försök igen om en stund eller kontakta hello@spick.se') + '</p></div>';
  }
}

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
// ── PRODUCTION RESILIENCE ────────────────────────────────────

// Global error handler — fångar uncaught errors utan att visa rå stacktraces
window.addEventListener('error', function(e) {
  console.error('[SPICK]', e.message, e.filename, e.lineno);
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

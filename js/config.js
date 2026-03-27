// ═══════════════════════════════════════════════════════════════
// SPICK – Centraliserad konfiguration
// Importera denna fil ISTÄLLET för att hårdkoda nycklar i HTML
// ═══════════════════════════════════════════════════════════════

const SPICK = Object.freeze({
  SUPA_URL:  'https://urjeijcncsyuletprydy.supabase.co',
  SUPA_KEY:  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0',
  SITE_URL:  'https://spick.se',
  ADMIN_EMAIL: 'hello@spick.se',
  VERSION:   '2.1.0',
});

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

// ═══════════════════════════════════════════════════════════════
// Spick Email Engine v3 – använder centraliserad config
// Anropar Supabase Edge Function (notify) – aldrig Resend direkt
// ═══════════════════════════════════════════════════════════════

// Kräver att js/config.js laddas först (SPICK.SUPA_URL, SPICK.SUPA_KEY)

async function callNotify(type, record) {
  try {
    const res = await fetch(`${SPICK.SUPA_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SPICK.SUPA_KEY,
        'Authorization': `Bearer ${SPICK.SUPA_KEY}`
      },
      body: JSON.stringify({ type, record })
    });
    return res.ok;
  } catch(e) {
    console.error('Email-engine fel:', e);
    return false;
  }
}

// 1. Bokningsbekräftelse till kund
function sendBookingConfirmation(booking) {
  return callNotify('booking', booking);
}

// 2. Admin-notis om ny bokning
function sendAdminNotification(booking) {
  return callNotify('booking', booking);
}

// 3. Välkomstmail till godkänd städare
function sendCleanerWelcome(cleaner) {
  return callNotify('cleaner_approved', cleaner);
}

// 4. Ny ansökan bekräftelse + admin-notis
function sendApplicationNotification(application) {
  return callNotify('application', application);
}

// 5. Betygsförfrågan
function sendReviewRequest(booking) {
  return callNotify('review_request', booking);
}

// 6. Påminnelse 24h före
function sendReminder(booking) {
  return callNotify('reminder', booking);
}

// 7. Garantiärende
function sendGuaranteeClaim(data) {
  return callNotify('guarantee', data);
}

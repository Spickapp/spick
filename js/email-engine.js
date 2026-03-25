// Spick Email Engine v2 – anropar Supabase Edge Function (notify)
// Aldrig anropa Resend direkt från frontend - API-nyckeln ska vara server-side

const SUPA_URL = 'https://urjeijcncsyuletprydy.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

async function callNotify(type, record) {
  try {
    const res = await fetch(`${SUPA_URL}/functions/v1/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`
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
export async function sendBookingConfirmation(booking) {
  return callNotify('booking', booking);
}

// 2. Admin-notis om ny bokning
export async function sendAdminNotification(booking) {
  return callNotify('booking', booking);
}

// 3. Välkomstmail till godkänd städare
export async function sendCleanerWelcome(cleaner) {
  return callNotify('cleaner_approved', cleaner);
}

// 4. Betygsförfrågan
export async function sendReviewRequest(booking) {
  return callNotify('review_request', booking);
}

// 5. Påminnelse 24h före
export async function sendReminder(booking) {
  return callNotify('reminder', booking);
}

// 6. Garantiärende
export async function sendGuaranteeClaim(data) {
  return callNotify('guarantee', data);
}

// Bakåtkompatibilitet
export async function sendEmail(to, subject, html) {
  return callNotify('custom', { to, subject, html });
}

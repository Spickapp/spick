/**
 * contact-guard.js - Spick Contact Guard
 * Drop-in: <div data-contact-guard data-cleaner-id="UUID" data-booking-id="UUID"></div>
 * Visar lås-ikon tills bekräftad bokning finns, sedan telefon + email.
 */
(function() {
  const SUPA = 'https://urjeijcncsyuletprydy.supabase.co';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVyamVpamNuY3N5dWxldHByeWR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzIyNDQsImV4cCI6MjA4OTg0ODI0NH0.CH5MSMaWTBfkuzZQOBKgxu-B6Vfy8w9DLh49WPU1Vd0';

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function renderLocked(el) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#F7F7F5;border-radius:12px;border:1px solid #E8E8E4;">
        <span style="font-size:1.4rem;">🔒</span>
        <div>
          <div style="font-weight:600;font-size:.9rem;color:#1C1C1A;">Kontaktuppgifter skyddade</div>
          <div style="font-size:.8rem;color:#888;margin-top:2px;">Boka en städning för att se telefon och e-post</div>
        </div>
      </div>`;
  }

  function renderUnlocked(el, data) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#DCFCE7;border-radius:12px;border:1px solid #BBF7D0;">
        <span style="font-size:1.4rem;">🔓</span>
        <div>
          <div style="font-weight:600;font-size:.9rem;color:#166534;">${esc(data.name)}</div>
          ${data.phone ? `<a href="tel:${esc(data.phone)}" style="color:#0F6E56;font-size:.85rem;text-decoration:none;font-weight:500;">📞 ${esc(data.phone)}</a><br>` : ''}
          ${data.email ? `<a href="mailto:${esc(data.email)}" style="color:#0F6E56;font-size:.85rem;text-decoration:none;font-weight:500;">✉️ ${esc(data.email)}</a>` : ''}
        </div>
      </div>`;
  }

  function renderError(el, msg) {
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:#FEF2F2;border-radius:12px;border:1px solid #FECACA;">
        <span style="font-size:1.4rem;">⚠️</span>
        <div style="font-size:.85rem;color:#991B1B;">${esc(msg)}</div>
      </div>`;
  }

  async function init(el) {
    const cleanerId = el.dataset.cleanerId;
    const bookingId = el.dataset.bookingId;

    if (!cleanerId || !bookingId) {
      renderLocked(el);
      return;
    }

    renderLocked(el); // Show locked state immediately

    try {
      const res = await fetch(`${SUPA}/functions/v1/get-cleaner-contact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': KEY,
          'Authorization': 'Bearer ' + KEY
        },
        body: JSON.stringify({ cleaner_id: cleanerId, booking_id: bookingId })
      });

      const data = await res.json();

      if (res.ok && !data.locked) {
        renderUnlocked(el, data);
      } else {
        renderLocked(el);
      }
    } catch (e) {
      console.error('Contact guard error:', e);
      renderError(el, 'Kunde inte hämta kontaktuppgifter');
    }
  }

  // Auto-init all elements with data-contact-guard
  function bootstrap() {
    document.querySelectorAll('[data-contact-guard]').forEach(init);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // Expose for dynamic usage
  window.SpickContactGuard = { init: init };
})();

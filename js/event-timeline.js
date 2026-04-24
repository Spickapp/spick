/**
 * Event timeline component (Fas 6 §6.4-§6.6)
 *
 * Renderar booking_events som en timeline. Fetchar via get-booking-events
 * EF som applicerar role-filter (customer / cleaner / company_owner /
 * admin) — frontend kan inte komma åt booking_events direkt pga RLS.
 *
 * Användning:
 *   renderBookingTimeline(containerEl, bookingId, authHeaders)
 *
 * authHeaders: objekt med apikey + Authorization (admin-flöden använder
 * _adminHeadersLegacy, kund/städare använder sin JWT).
 *
 * Primärkälla: docs/architecture/event-schema.md §3 (event-types) +
 * §8 (frontend-exponering).
 */
(function(global) {
  'use strict';

  // Event-type → { icon, label, color }. Synkat mot BookingEventType i
  // supabase/functions/_shared/events.ts (Regel #28 SSOT).
  var EVENT_META = {
    booking_created:            { icon: '📝', label: 'Bokning skapad',            color: '#0F6E56' },
    cleaner_assigned:           { icon: '👤', label: 'Städare kopplad',           color: '#1D9E75' },
    cleaner_reassigned:         { icon: '🔄', label: 'Städare bytt',              color: '#F59E0B' },
    cleaner_invited:            { icon: '📬', label: 'Team-invite skickad',       color: '#8b5cf6' },
    cleaner_declined:           { icon: '❌', label: 'Städare tackade nej',       color: '#b91c1c' },
    checkin:                    { icon: '📍', label: 'Städare ankommit',          color: '#0F6E56' },
    checkout:                   { icon: '🚪', label: 'Städare klar',              color: '#0F6E56' },
    completed:                  { icon: '✅', label: 'Städning slutförd',         color: '#16a34a' },
    payment_received:           { icon: '💳', label: 'Betalning mottagen',        color: '#16a34a' },
    payment_captured:           { icon: '💰', label: 'Betalning låst',            color: '#16a34a' },
    escrow_held:                { icon: '🔒', label: 'Pengar i escrow',           color: '#0F6E56' },
    escrow_released:            { icon: '🔓', label: 'Pengar frisläppta',         color: '#16a34a' },
    refund_issued:              { icon: '↩️', label: 'Återbetalning gjord',      color: '#F59E0B' },
    cancelled_by_customer:      { icon: '⛔', label: 'Avbokat av kund',           color: '#b91c1c' },
    cancelled_by_cleaner:       { icon: '⛔', label: 'Avbokat av städare',        color: '#b91c1c' },
    cancelled_by_admin:         { icon: '⛔', label: 'Avbokat av admin',          color: '#b91c1c' },
    noshow_reported:            { icon: '🚫', label: 'No-show rapporterat',       color: '#b91c1c' },
    dispute_opened:             { icon: '⚠️', label: 'Klagomål öppnat',          color: '#b91c1c' },
    dispute_cleaner_responded:  { icon: '💬', label: 'Städarens svar',            color: '#F59E0B' },
    dispute_resolved:           { icon: '⚖️', label: 'Klagomål avgjort',         color: '#16a34a' },
    review_submitted:           { icon: '⭐', label: 'Betyg lämnat',              color: '#F59E0B' },
    recurring_generated:        { icon: '🔁', label: 'Återkommande bokning skapad', color: '#1D9E75' },
    recurring_skipped:          { icon: '⏭️', label: 'Tillfälle hoppat över',    color: '#6B6960' },
    recurring_paused:           { icon: '⏸️', label: 'Serie pausad',             color: '#F59E0B' },
    recurring_resumed:          { icon: '▶️', label: 'Serie återupptagen',       color: '#1D9E75' },
    recurring_cancelled:        { icon: '⏹️', label: 'Serie uppsagd',            color: '#b91c1c' },
    schedule_changed:           { icon: '📅', label: 'Tid ändrad',                color: '#F59E0B' }
  };

  var ACTOR_LABEL = {
    system: 'System',
    customer: 'Kund',
    cleaner: 'Städare',
    admin: 'Admin',
    company_owner: 'VD'
  };

  function safeEscape(s) {
    if (typeof global.escHtml === 'function') return global.escHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(m) {
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m];
    });
  }

  function formatTime(iso) {
    if (!iso) return '–';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' });
    } catch (e) { return iso; }
  }

  function prettyMetadata(obj) {
    if (!obj || typeof obj !== 'object') return '';
    var keys = Object.keys(obj);
    if (keys.length === 0) return '';
    try { return JSON.stringify(obj, null, 2); } catch (_) { return String(obj); }
  }

  async function renderBookingTimeline(containerEl, bookingId, authHeaders) {
    if (!containerEl || !bookingId) return;
    containerEl.innerHTML = '<div style="text-align:center;padding:1rem;color:#6B6960;font-size:.85rem">Laddar händelser…</div>';

    var supaUrl = (global.SPICK && global.SPICK.SUPA_URL) || 'https://urjeijcncsyuletprydy.supabase.co';
    var url = supaUrl + '/functions/v1/get-booking-events?booking_id=' + encodeURIComponent(bookingId);

    try {
      var res = await fetch(url, { headers: authHeaders || {} });
      if (!res.ok) {
        if (res.status === 401 || res.status === 400) {
          containerEl.innerHTML = '<div style="padding:.75rem;color:#b91c1c;font-size:.85rem">Din session har gått ut — ladda om sidan och logga in igen.</div>';
          return;
        }
        if (res.status === 403) {
          containerEl.innerHTML = '<div style="padding:.75rem;color:#6B6960;font-size:.85rem">Du har inte åtkomst till den här bokningens historik.</div>';
          return;
        }
        if (res.status === 404) {
          containerEl.innerHTML = '<div style="padding:.75rem;color:#6B6960;font-size:.85rem">Bokningen hittades inte.</div>';
          return;
        }
        containerEl.innerHTML = '<div style="padding:.75rem;color:#b91c1c;font-size:.85rem">Kunde inte ladda händelser (HTTP ' + res.status + ').</div>';
        return;
      }
      var data = await res.json();
      var events = Array.isArray(data && data.events) ? data.events : [];
      if (events.length === 0) {
        containerEl.innerHTML = '<div style="padding:.75rem;color:#6B6960;font-size:.85rem">Inga loggade händelser för den här bokningen ännu.</div>';
        return;
      }
      containerEl.innerHTML = '<div class="event-timeline" style="display:flex;flex-direction:column;gap:.25rem">' + events.map(function(ev) {
        var meta = EVENT_META[ev.event_type] || { icon: '•', label: ev.event_type || 'Okänd händelse', color: '#6B6960' };
        var actor = ACTOR_LABEL[ev.actor_type] || ev.actor_type || 'system';
        var time = formatTime(ev.created_at);
        var metaJson = prettyMetadata(ev.metadata);
        return '<div class="event-row" style="display:flex;gap:.75rem;padding:.625rem;border-left:3px solid ' + meta.color + ';background:#F7F7F5;border-radius:0 8px 8px 0">' +
          '<div style="font-size:1.1rem;line-height:1.3">' + meta.icon + '</div>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-weight:600;color:#0F6E56">' + safeEscape(meta.label) + '</div>' +
            '<div style="font-size:.78rem;color:#6B6960">' + safeEscape(time) + ' · ' + safeEscape(actor) + '</div>' +
            (metaJson
              ? '<details style="margin-top:.25rem"><summary style="font-size:.72rem;color:#6B6960;cursor:pointer">Detaljer</summary><pre style="background:#fff;padding:.5rem;border-radius:6px;margin-top:.25rem;font-size:.7rem;overflow-x:auto;white-space:pre-wrap;word-break:break-word;color:#111">' + safeEscape(metaJson) + '</pre></details>'
              : '') +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    } catch (e) {
      console.warn('[event-timeline] fetch failed:', e);
      containerEl.innerHTML = '<div style="padding:.75rem;color:#b91c1c;font-size:.85rem">Fel vid laddning: ' + safeEscape(e && e.message || 'okänt') + '</div>';
    }
  }

  global.renderBookingTimeline = renderBookingTimeline;
})(window);

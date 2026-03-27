// ═══════════════════════════════════════════════════════════════
// SPICK CRO – Social proof toast + urgency triggers
// Ladda: <script src="js/cro.js" defer></script>
// ═══════════════════════════════════════════════════════════════

(function() {
'use strict';
if (typeof SPICK === 'undefined') return;

// ── SOCIAL PROOF TOAST ──────────────────────────────────────
const TOASTS = [
  { name: 'Anna', city: 'Solna', service: 'hemstädning', min: 8 },
  { name: 'Marcus', city: 'Göteborg', service: 'storstädning', min: 23 },
  { name: 'Sara', city: 'Malmö', service: 'hemstädning', min: 45 },
  { name: 'Erik', city: 'Uppsala', service: 'flyttstädning', min: 12 },
  { name: 'Lisa', city: 'Stockholm', service: 'hemstädning', min: 3 },
  { name: 'Johan', city: 'Nacka', service: 'fönsterputs', min: 31 },
  { name: 'Maria', city: 'Bromma', service: 'hemstädning', min: 18 },
  { name: 'Ahmed', city: 'Hägersten', service: 'storstädning', min: 52 },
];

function showToast() {
  if (document.hidden) return;
  // Don't show on admin pages
  if (location.pathname.includes('admin') || location.pathname.includes('dashboard')) return;
  
  const t = TOASTS[Math.floor(Math.random() * TOASTS.length)];
  const el = document.createElement('div');
  el.className = 'spick-toast';
  el.style.cssText = 'position:fixed;bottom:24px;left:24px;background:#fff;border:1px solid #E8E8E4;border-radius:14px;padding:14px 20px;box-shadow:0 8px 30px rgba(0,0,0,.12);font-size:.85rem;z-index:9999;max-width:320px;transform:translateY(120%);transition:transform .4s cubic-bezier(.16,1,.3,1);font-family:DM Sans,system-ui,sans-serif';
  el.innerHTML = '<div style="display:flex;align-items:center;gap:10px">' +
    '<div style="width:36px;height:36px;border-radius:50%;background:#E8F5E9;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">✅</div>' +
    '<div><strong style="color:#1C1C1A">' + t.name + ' i ' + t.city + '</strong><br>' +
    '<span style="color:#6B6960;font-size:.78rem">bokade ' + t.service + ' för ' + t.min + ' min sedan</span></div>' +
    '<button onclick="this.closest(\'.spick-toast\').style.transform=\'translateY(120%)\';" style="border:none;background:none;color:#aaa;cursor:pointer;font-size:1.1rem;padding:0 0 0 8px;line-height:1">×</button></div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; });
  setTimeout(() => {
    if (el.parentNode) {
      el.style.transform = 'translateY(120%)';
      setTimeout(() => el.remove(), 500);
    }
  }, 5000);
}

// First toast after 8s, then every 35s
setTimeout(showToast, 8000);
setInterval(showToast, 35000);

// ── URGENCY BADGE ───────────────────────────────────────────
const ub = document.getElementById('urgency-text');
if (ub) {
  const dayBookings = [5, 8, 12, 7, 9, 6, 4];
  const today = new Date().getDay();
  const count = dayBookings[today === 0 ? 6 : today - 1] + Math.floor(Math.random() * 4);
  ub.textContent = count + ' bokningar gjorda idag';
}

// Dynamic trust bar stat
const tb = document.getElementById('tb-bookings');
if (tb) tb.textContent = (100 + Math.floor(Math.random() * 30)) + '+';

})();

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

// ── EXIT-INTENT POPUP ───────────────────────────────────────
// Shows when mouse leaves the viewport top (desktop only)
// One-time per session — stored in sessionStorage

const EXIT_KEY = 'spick_exit_shown';
if (!sessionStorage.getItem(EXIT_KEY) && window.innerWidth > 768) {
  let exitTimer = null;
  
  document.addEventListener('mouseout', function(e) {
    if (e.clientY > 10 || exitTimer) return;
    if (sessionStorage.getItem(EXIT_KEY)) return;
    
    exitTimer = setTimeout(function() {
      sessionStorage.setItem(EXIT_KEY, '1');
      
      const overlay = document.createElement('div');
      overlay.id = 'spick-exit';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadeIn .3s ease';
      overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:2.5rem;max-width:440px;width:90%;text-align:center;position:relative;box-shadow:0 25px 60px rgba(0,0,0,.25);animation:slideUp .4s ease">' +
        '<button onclick="document.getElementById(\'spick-exit\').remove()" style="position:absolute;top:12px;right:16px;border:none;background:none;font-size:1.5rem;cursor:pointer;color:#999;line-height:1">×</button>' +
        '<div style="font-size:2.5rem;margin-bottom:.75rem">🧹</div>' +
        '<h3 style="font-size:1.25rem;font-weight:800;color:#1C1C1A;margin:0 0 .5rem;font-family:Syne,DM Sans,sans-serif">Vänta! Få 10% rabatt</h3>' +
        '<p style="color:#6B6960;font-size:.88rem;margin:0 0 1.25rem;line-height:1.5">Ange din e-post så skickar vi en rabattkod för din första städning. Ingen spam — bara din kod.</p>' +
        '<form id="exit-form" style="display:flex;gap:.5rem" onsubmit="return spickExitSubmit(event)">' +
          '<input id="exit-email" type="email" required placeholder="din@email.se" style="flex:1;padding:.75rem 1rem;border:1.5px solid #E8E8E4;border-radius:10px;font-size:.9rem;font-family:inherit;outline:none">' +
          '<button type="submit" style="background:#0F6E56;color:#fff;border:none;padding:.75rem 1.25rem;border-radius:10px;font-weight:700;font-size:.88rem;cursor:pointer;white-space:nowrap;font-family:inherit">Skicka →</button>' +
        '</form>' +
        '<div id="exit-msg" style="display:none;color:#065F46;font-weight:600;font-size:.9rem;margin-top:.75rem">✓ Kolla din inkorg!</div>' +
        '<p style="font-size:.7rem;color:#aaa;margin:.75rem 0 0">Genom att ange din e-post godkänner du att vi skickar erbjudanden. Avsluta när som helst.</p>' +
      '</div>';
      
      // Add keyframe animations
      if (!document.getElementById('exit-animations')) {
        const style = document.createElement('style');
        style.id = 'exit-animations';
        style.textContent = '@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes slideUp{from{transform:translateY(30px);opacity:0}to{transform:translateY(0);opacity:1}}';
        document.head.appendChild(style);
      }
      
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
    }, 300);
  });
}

// Exit-intent form handler
window.spickExitSubmit = function(e) {
  e.preventDefault();
  const email = document.getElementById('exit-email').value;
  if (!email) return false;
  
  // Save to Supabase subscriptions table
  if (typeof SPICK !== 'undefined') {
    fetch(SPICK.SUPA_URL + '/rest/v1/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SPICK.SUPA_KEY, Authorization: 'Bearer ' + SPICK.SUPA_KEY, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ email: email, source: 'exit_intent', discount_code: 'VALKOMMEN10' })
    }).catch(function() {});
  }
  
  document.getElementById('exit-form').style.display = 'none';
  document.getElementById('exit-msg').style.display = 'block';
  
  setTimeout(function() {
    var el = document.getElementById('spick-exit');
    if (el) el.remove();
  }, 3000);
  
  return false;
};

})();

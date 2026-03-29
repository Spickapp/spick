// ═══════════════════════════════════════════════════════════════
// SPICK CRO – Social proof toast + urgency triggers
// Ladda: <script src="js/cro.js" defer></script>
// ═══════════════════════════════════════════════════════════════

(function() {
'use strict';
if (typeof SPICK === 'undefined') return;

// ── SOCIAL PROOF TOAST (riktig data) ────────────────────────
// Hämtar riktiga recensioner från Supabase (reviews-tabellen är public).
// Visar bara om det finns minst 3 recensioner (MFL-kompatibelt).
let _toastData = [];
let _toastIdx = 0;

async function loadToastData() {
  try {
    const res = await fetch(SPICK.SUPA_URL + '/rest/v1/reviews?select=cleaner_rating,created_at,cleaner_id,cleaners(city,full_name)&cleaner_rating=gte.4&order=created_at.desc&limit=10', {
      headers: { 'apikey': SPICK.SUPA_KEY }
    });
    if (!res.ok) return;
    const data = await res.json();
    _toastData = data.filter(r => r.cleaners?.city).map(r => {
      const mins = Math.max(5, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000));
      const timeLabel = mins < 60 ? mins + ' min sedan' : 
                        mins < 1440 ? Math.floor(mins/60) + 'h sedan' : 
                        Math.floor(mins/1440) + 'd sedan';
      return {
        name: (r.cleaners.full_name || '').split(' ')[0] || 'Kund',
        city: r.cleaners.city,
        rating: r.cleaner_rating,
        time: timeLabel
      };
    });
  } catch(e) { /* fail silently */ }
}

function showToast() {
  if (_toastData.length < 3) return; // Kräv minst 3 riktiga recensioner
  if (document.hidden) return;
  if (location.pathname.includes('admin') || location.pathname.includes('dashboard')) return;
  
  const t = _toastData[_toastIdx % _toastData.length];
  _toastIdx++;
  const stars = '⭐'.repeat(Math.min(5, t.rating || 5));
  const el = document.createElement('div');
  el.className = 'spick-toast';
  el.style.cssText = 'position:fixed;bottom:24px;left:24px;background:#fff;border:1px solid #E8E8E4;border-radius:14px;padding:14px 20px;box-shadow:0 8px 30px rgba(0,0,0,.12);font-size:.85rem;z-index:9999;max-width:320px;transform:translateY(120%);transition:transform .4s cubic-bezier(.16,1,.3,1);font-family:DM Sans,system-ui,sans-serif';
  el.innerHTML = '<div style="display:flex;align-items:center;gap:10px">' +
    '<div style="width:36px;height:36px;border-radius:50%;background:#E8F5E9;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0">' + stars.charAt(0) + stars.charAt(1) + '</div>' +
    '<div><strong style="color:#1C1C1A">' + escHtml(t.name) + ' i ' + escHtml(t.city) + '</strong><br>' +
    '<span style="color:#6B6960;font-size:.78rem">' + stars + ' · ' + escHtml(t.time) + '</span></div>' +
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

// escHtml fallback om config.js inte laddats ännu
function escHtml(s) { return typeof window.escHtml==='function' ? window.escHtml(s) : String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// Ladda data, sedan visa toasts
loadToastData().then(() => {
  if (_toastData.length >= 3) {
    setTimeout(showToast, 12000);
    setInterval(showToast, 40000);
  }
});

// ── URGENCY BADGE ───────────────────────────────────────────
// NOTE: When real booking data exists, replace with actual counts.
const ub = document.getElementById('urgency-text');
if (ub) ub.textContent = 'Boka idag — lediga tider denna vecka';

// Dynamic trust bar stat — use real data when available
const tb = document.getElementById('tb-bookings');
if (tb) tb.textContent = '100+';

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

// ═══════════════════════════════════════════════════════════════
// SPICK – Delade komponenter (nav, footer, mobilmeny)
// Ladda efter config.js: <script src="js/components.js" defer></script>
// Self-contained: injicerar sin egen CSS – inga externa beroenden
// ═══════════════════════════════════════════════════════════════
(function() {
'use strict';
// ── INJECT CSP (körs direkt, före allt annat) ──────────────────
if (!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
  const csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://js.stripe.com https://www.googletagmanager.com https://www.google-analytics.com https://connect.facebook.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co https://www.facebook.com https://www.google-analytics.com https://www.googletagmanager.com",
    "connect-src 'self' https://urjeijcncsyuletprydy.supabase.co https://js.stripe.com https://www.google-analytics.com https://www.facebook.com https://region1.google-analytics.com",
    "frame-src 'self' https://js.stripe.com",
    "object-src 'none'",
    "base-uri 'self'"
  ].join('; ');
  document.head.prepend(csp);
}

// ── INJECT CSS (körs direkt, innan DOM-beroende logik) ───────
// Injicera en gång per sida även om scriptet laddas flera gånger
if (!document.getElementById('spick-nav-css')) {
  const style = document.createElement('style');
  style.id = 'spick-nav-css';
  style.textContent = `
/* === SPICK GLOBAL NAV & FOOTER – injicerat av components.js === */
:root{
  --g:#0F6E56;--gm:#1D9E75;--gp:#E1F5EE;--gl:#9FE1CB;
  --b:#0E0E0E;--gr:#F7F7F5;--grd:#E8E8E4;--t:#1C1C1A;--m:#6B6960;--w:#fff;
}
/* NAV */
nav{background:#fff;padding:1.25rem 5rem;display:flex;align-items:center;
  justify-content:space-between;border-bottom:1px solid #E8E8E4;
  position:sticky;top:0;z-index:100;backdrop-filter:blur(8px);}
.logo{font-family:'Playfair Display',Georgia,serif;font-size:1.7rem;font-weight:700;
  color:#0F6E56;text-decoration:none;}
.nav-links{display:flex;align-items:center;gap:2rem;}
.nl{font-size:.9rem;color:#6B6960;text-decoration:none;transition:color .2s;}
.nl:hover{color:#0F6E56;}
.nl-btn{padding:.55rem 1.4rem;border-radius:100px;font-size:.875rem;font-weight:600;
  color:#fff;background:#0F6E56;text-decoration:none;transition:all .2s;}
.nl-btn:hover{background:#1D9E75;}
.nl-out{padding:.55rem 1.2rem;border-radius:100px;font-size:.875rem;font-weight:500;
  color:#0F6E56;border:1.5px solid #0F6E56;text-decoration:none;transition:all .2s;}
.nl-out:hover{background:#E1F5EE;}
.hamburger{display:none;flex-direction:column;gap:5px;cursor:pointer;
  padding:4px;border:none;background:none;}
.hamburger span{display:block;width:22px;height:2px;background:#1C1C1A;
  border-radius:2px;transition:all .3s;}
/* MOBILE MENU */
.mob-menu{display:none;position:fixed;top:0;left:0;right:0;bottom:0;
  background:rgba(0,0,0,.5);z-index:200;}
.mob-panel{background:#fff;width:280px;height:100%;margin-left:auto;
  padding:2rem 1.5rem;display:flex;flex-direction:column;gap:1.5rem;}
.mob-panel a{font-size:1.1rem;color:#1C1C1A;text-decoration:none;
  font-weight:500;padding:.75rem 0;border-bottom:1px solid #E8E8E4;}
.mob-panel a:last-child{border:none;}
@media(max-width:1024px){nav{padding:1rem 2rem;}}
@media(max-width:768px){.nav-links{display:none;}.hamburger{display:flex;}}
/* FOOTER */
footer{background:#080808;padding:4rem 5rem 2rem;}
.footer-top{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:3rem;margin-bottom:3rem;}
.footer-logo{font-family:'Playfair Display',Georgia,serif;font-size:2rem;font-weight:700;
  color:#1D9E75;margin-bottom:.75rem;}
.footer-desc{font-size:.875rem;color:#5A5A55;line-height:1.7;max-width:260px;}
.footer-contact{margin-top:1.25rem;display:flex;flex-direction:column;gap:.5rem;}
.footer-contact a{font-size:.875rem;color:#1D9E75;text-decoration:none;}
footer h4{font-size:.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.1em;color:#3A3A35;margin-bottom:1rem;}
footer ul{list-style:none;display:flex;flex-direction:column;gap:.625rem;}
footer a{font-size:.875rem;color:#6B6B65;text-decoration:none;transition:color .2s;}
footer a:hover{color:#1D9E75;}
.footer-bottom{border-top:1px solid #1A1A1A;padding-top:2rem;display:flex;
  justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;}
.footer-bottom p{font-size:.8rem;color:#3A3A35;}
.footer-bottom-links{display:flex;gap:1.5rem;}
.footer-bottom-links a{font-size:.8rem;color:#3A3A35;text-decoration:none;}
.footer-bottom-links a:hover{color:#1D9E75;}
@media(max-width:1024px){.footer-top{grid-template-columns:1fr 1fr;}
  .footer-top>:first-child{grid-column:1/-1;}}
@media(max-width:640px){footer{padding:3rem 1.5rem 2rem;}}
/* === END SPICK GLOBAL NAV & FOOTER === */
  `;
  // Försök sätta in CSS i <head>, annars direkt i <html>
  (document.head || document.documentElement).prepend(style);
}
// Beräkna sökvägsprefix baserat på sidans djup
const depth = (location.pathname.match(/\//g) || []).length - 1;
const P = depth > 0 ? '../'.repeat(depth) : '';
// ── NAVIGATION ──────────────────────────────────────────────
const NAV_HTML = `
<a href="${P}index.html" class="logo">Spick</a>
<div class="nav-links">
  <a href="${P}hur-det-funkar.html" class="nl">Hur det funkar</a>
  <a href="${P}blogg/" class="nl">Blogg</a>
  <a href="${P}priser.html" class="nl">Priser</a>
  <a href="${P}boka.html" class="nl-btn">Boka städning</a>
</div>
<button class="hamburger" onclick="document.getElementById('mobMenu').style.display='flex'" aria-label="Öppna meny">
  <span></span><span></span><span></span>
</button>`;
// ── MOBILMENY ───────────────────────────────────────────────
const MOB_HTML = `
<div class="mob-menu" id="mobMenu" style="display:none" onclick="this.style.display='none'">
  <div class="mob-panel" onclick="event.stopPropagation()">
    <a href="${P}boka.html">Boka städning</a>
    <a href="${P}hur-det-funkar.html">Hur det funkar</a>
    <a href="${P}priser.html">Priser</a>
    <a href="${P}tjanster.html">Tjänster</a>
    <a href="${P}bli-stadare.html">Bli städare</a>
    <a href="${P}boka.html" style="background:var(--g);color:#fff;border-radius:100px;text-align:center;padding:.75rem 1.5rem;border:none;">Boka nu →</a>
  </div>
</div>`;
// ── FOOTER ──────────────────────────────────────────────────
const FOOTER_HTML = `
<div class="footer-top">
  <div>
    <div class="footer-logo">Spick</div>
    <p class="footer-desc">Boka en städare du verkligen litar på. Verifierade städare, äkta betyg och RUT-avdrag.</p>
    <div class="footer-contact">
      <a href="mailto:hello@spick.se">hello@spick.se</a>
    </div>
  </div>
  <div>
    <h4>Kunder</h4>
    <ul>
      <li><a href="${P}boka.html">Boka städning</a></li>
      <li><a href="${P}hur-det-funkar.html">Hur det funkar</a></li>
      <li><a href="${P}faq.html">Vanliga frågor</a></li>
      <li><a href="${P}blogg/">Blogg & Guider</a></li>
      <li><a href="${P}kontakt.html">Kontakt</a></li>
      <li><a href="${P}mitt-konto.html">Mitt konto</a></li>
      <li><a href="${P}presentkort.html">Presentkort 🎁</a></li>
      <li><a href="${P}garanti.html">Nöjdhetsgaranti</a></li>
      <li><a href="${P}sakerhet.html">Säkerhet</a></li>
      <li><a href="${P}priser.html">Priser</a></li>
    </ul>
  </div>
  <div>
    <h4>Städare</h4>
    <ul>
      <li><a href="${P}bli-stadare.html">Bli städare</a></li>
      <li><a href="${P}utbildning-stadare.html">Spick Akademin</a></li>
      <li><a href="${P}kalkyl-stadare.html">Varför Spick?</a></li>
      <li><a href="${P}avtal.html">Partnersavtal</a></li>
    </ul>
    <h4 style="margin-top:1rem">Guider</h4>
    <ul>
      <li><a href="${P}blogg/rut-avdrag-guide.html">RUT-avdrag 2026</a></li>
      <li><a href="${P}blogg/flyttstadning-tips.html">Flyttstädning checklista</a></li>
      <li><a href="${P}blogg/storstadning-checklista.html">Storstädning guide</a></li>
    </ul>
  </div>
  <div>
    <h4>Populära städer</h4>
    <ul>
      <li><a href="${P}stockholm.html">Stockholm</a></li>
      <li><a href="${P}goteborg.html">Göteborg</a></li>
      <li><a href="${P}malmo.html">Malmö</a></li>
      <li><a href="${P}uppsala.html">Uppsala</a></li>
      <li><a href="${P}helsingborg.html">Helsingborg</a></li>
      <li><a href="${P}linkoping.html">Linköping</a></li>
      <li><a href="${P}orebro.html">Örebro</a></li>
      <li><a href="${P}lund.html">Lund</a></li>
    </ul>
  </div>
</div>
<div class="footer-bottom">
  <p>© ${new Date().getFullYear()} Spick AB · org.nr 559402-4522
  <div style="display:flex;gap:16px;margin-top:12px;justify-content:center">
    <a href="https://instagram.com/spick.se" target="_blank" rel="noopener" style="color:rgba(255,255,255,.5);font-size:.8rem;text-decoration:none" title="Instagram">📸 Instagram</a>
    <a href="https://facebook.com/spick.se" target="_blank" rel="noopener" style="color:rgba(255,255,255,.5);font-size:.8rem;text-decoration:none" title="Facebook">👍 Facebook</a>
  </div></p>
  <div class="footer-bottom-links">
    <a href="${P}integritetspolicy.html">Integritetspolicy</a>
    <a href="${P}avtal.html">Villkor</a>
  </div>
</div>`;
// ── INJICERA VID SIDLADDNING ────────────────────────────────
// Kör direkt om DOMContentLoaded redan har inträffat (t.ex. om defer
// innebar att scriptet laddades sent och eventet redan passerat)
function injectComponents() {
  // Uppdatera <nav> om den finns OCH inte har data-nav-keep
  const nav = document.querySelector('nav');
  if (nav && !nav.hasAttribute('data-nav-keep')) {
    nav.innerHTML = NAV_HTML;
  }
  // Injicera mobilmeny om den inte redan finns OCH nav inte har data-nav-keep
  const navForMob = document.querySelector('nav');
  const skipMob = navForMob && navForMob.hasAttribute('data-nav-keep');
  if (!skipMob && !document.getElementById('mobMenu')) {
    if (navForMob) {
      navForMob.insertAdjacentHTML('afterend', MOB_HTML);
    }
  } else if (!skipMob && document.getElementById('mobMenu')) {
    // Uppdatera befintlig mobilmeny
    document.getElementById('mobMenu').outerHTML = MOB_HTML;
  }
  // Uppdatera <footer> om den finns
  const footer = document.querySelector('footer');
  if (footer) {
    footer.innerHTML = FOOTER_HTML;
  }
  // Markera aktiv nav-länk (skippa .nl-btn — den har vit text på grön bg)
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav .nl, nav .nl-out').forEach(link => {
    const href = link.getAttribute('href')?.split('/').pop();
    if (href === current) {
      link.style.color = 'var(--g, #0F6E56)';
      link.style.fontWeight = '600';
    }
  });
}
// Race-condition-säker initiering:
// Om DOM redan är redo (kan hända med defer + snabb laddning), kör direkt.
// Annars vänta på DOMContentLoaded.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectComponents);
} else {
  injectComponents();
}
// Exponera för manuell användning
window.SPICK_COMPONENTS = { NAV_HTML, MOB_HTML, FOOTER_HTML };
})();

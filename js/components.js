// Google Analytics 4
(function(){
  var s=document.createElement('script');
  s.async=true;
  s.src='https://www.googletagmanager.com/gtag/js?id=G-HTKC1TS64C';
  document.head.appendChild(s);
  window.dataLayer=window.dataLayer||[];
  function gtag(){dataLayer.push(arguments);}
  window.gtag=gtag;
  gtag('js',new Date());
  gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied'});
  var c=localStorage.getItem('spick-cookie-consent');
  if(c==='all'){gtag('consent','update',{analytics_storage:'granted',ad_storage:'granted'});}
  gtag('config','G-HTKC1TS64C');
})();

// ═══════════════════════════════════════════════════════════════
// SPICK – Delade komponenter (nav, footer, mobilmeny)
// Ladda efter config.js: <script src="js/components.js" defer></script>
// Self-contained: injicerar sin egen CSS – inga externa beroenden
// ═══════════════════════════════════════════════════════════════
(function() {
'use strict';


// ── INJECT CSS (körs direkt, innan DOM-beroende logik) ───────
// Injicera en gång per sida även om scriptet laddas flera gånger
if (!document.getElementById('spick-nav-css')) {
  const style = document.createElement('style');
  style.id = 'spick-nav-css';
  style.textContent = `
/* === SPICK GLOBAL NAV & FOOTER – injicerat av components.js === */
html{font-size:17px}
:root{
  --g:#0F6E56;--gm:#1D9E75;--gp:#E1F5EE;--gl:#9FE1CB;
  --b:#0E0E0E;--gr:#F7F7F5;--grd:#E8E8E4;--t:#1C1C1A;--m:#6B6960;--w:#fff;
}
/* TOUCH-TARGETS (Fix #3, 2026-04-25) — WCAG 2.5.5 + Apple HIG ≥44px */
@media (max-width:768px){
  button:not(.tab-btn):not(.svc-btn):not(.icon-only),
  a.btn, a.cta, a.nl-btn, a.nl-out,
  input[type="button"], input[type="submit"]{
    min-height:44px;
  }
}
/* FOCUS-RINGS (Audit-fix P0 2026-04-26) — WCAG 2.4.7 keyboard navigation.
   Tidigare hade alla buttons :hover-state men ingen :focus-ring → tangentbords-
   users kunde inte navigera. Använder :focus-visible för att inte spamma ring
   vid mus-klick (modern browser-stöd ≥97%). Två varianter: solid ring för
   "default" elements + inset ring för buttons-on-dark (nav-buttons, cta-btns
   inuti gröna sektioner). */
*:focus-visible{
  outline:2px solid #0F6E56;
  outline-offset:2px;
  border-radius:4px;
}
.cta-btn:focus-visible, .btn-main:focus-visible, .nl-btn:focus-visible,
.cta-sec a:focus-visible, [class*="cta"]:focus-visible{
  outline:2px solid #fff;
  outline-offset:2px;
}
button:focus-visible, a:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible{
  outline-width:2px;
  outline-style:solid;
}
/* Skip outline för rena dekor-elements (klickbara cards utan tabbing-värde) */
[role="presentation"]:focus-visible, [aria-hidden="true"]:focus-visible{
  outline:none;
}
/* NAV */
nav{background:#fff;padding:1.25rem 5rem;display:flex;align-items:center;
  justify-content:space-between;border-bottom:1px solid #E8E8E4;
  position:sticky;top:0;z-index:100;backdrop-filter:blur(8px);}
.logo{font-family:'Plus Jakarta Sans',Georgia,serif;font-size:1.7rem;font-weight:700;
  color:#0F6E56;text-decoration:none;}
.nav-links{display:flex;align-items:center;gap:2rem;}
.nl{font-size:.9rem;color:#6B6960;text-decoration:none;transition:color .2s;}
.nl:hover{color:#0F6E56;}
/* Button-text WCAG-boost (Audit P0 2026-04-26): tidigare font-weight=600 på
   white-on-#0F6E56 gav 3.2:1 kontrast (failar AA 4.5:1). Bump till 700 +
   text-shadow ger upplevd kontrast utan att ändra varumärkesfärg.
   Permanent färg-fix kräver designer-beslut (planerad nästa sprint). */
.nl-btn{padding:.55rem 1.4rem;border-radius:100px;font-size:.875rem;font-weight:700;
  letter-spacing:.01em;color:#fff;background:#0F6E56;text-decoration:none;transition:all .2s;
  text-shadow:0 1px 2px rgba(0,0,0,.15);}
.nl-btn:hover{background:#0a4d3a;}
.nl-out{padding:.55rem 1.2rem;border-radius:100px;font-size:.875rem;font-weight:600;
  color:#0a4d3a;border:1.5px solid #0a4d3a;text-decoration:none;transition:all .2s;}
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
/* NAV LOGIN DROPDOWN */
.nav-login{position:relative}
.nav-login-toggle{display:inline-flex;align-items:center;gap:4px;font-size:.9rem;color:#6B6960;
  background:none;border:none;cursor:pointer;font-family:inherit;padding:0;transition:color .2s}
.nav-login-toggle:hover{color:#0F6E56}
.nav-login-toggle svg{width:14px;height:14px;transition:transform .2s}
.nav-login.open .nav-login-toggle svg{transform:rotate(180deg)}
.nav-login-menu{display:none;position:absolute;top:calc(100% + 10px);right:0;
  background:#fff;border:1px solid #E8E8E4;border-radius:12px;
  box-shadow:0 8px 32px rgba(0,0,0,.1);padding:6px;min-width:210px;z-index:300}
.nav-login.open .nav-login-menu{display:block}
.nav-login-menu a{display:flex;align-items:center;gap:10px;padding:10px 14px;
  font-size:.88rem;color:#1C1C1A;text-decoration:none;border-radius:8px;
  font-weight:500;transition:background .15s}
.nav-login-menu a:hover{background:#E1F5EE}
.nav-login-menu a svg{width:18px;height:18px;color:#0F6E56;flex-shrink:0}
/* FOOTER */
footer{background:#080808;padding:4rem 5rem 2rem;}
.footer-top{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:2rem;margin-bottom:3rem;max-width:1200px;margin-left:auto;margin-right:auto;}
.footer-logo{font-family:'Plus Jakarta Sans',Georgia,serif;font-size:2rem;font-weight:700;
  color:#1D9E75;margin-bottom:.75rem;}
.footer-desc{font-size:.875rem;color:#5A5A55;line-height:1.7;max-width:260px;}
.footer-contact{margin-top:1.25rem;display:flex;flex-direction:column;gap:.5rem;}
.footer-contact a{font-size:.875rem;color:#1D9E75;text-decoration:none;}
footer h3{font-size:.7rem;font-weight:600;text-transform:uppercase;
  letter-spacing:.1em;color:#3A3A35;margin-bottom:1rem;}
footer ul{list-style:none;display:flex;flex-direction:column;gap:.625rem;}
footer a{font-size:.875rem;color:#6B6B65;text-decoration:none;transition:color .2s;}
footer a:hover{color:#1D9E75;}
.footer-bottom{border-top:1px solid #1A1A1A;padding-top:2rem;display:flex;
  justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;max-width:1200px;margin:0 auto;}
.footer-bottom p{font-size:.8rem;color:#3A3A35;}
.footer-bottom-links{display:flex;gap:1.5rem;}
.footer-bottom-links a{font-size:.8rem;color:#3A3A35;text-decoration:none;}
.footer-bottom-links a:hover{color:#1D9E75;}
@media(max-width:1024px){.footer-top{grid-template-columns:1fr 1fr;}
  .footer-top>:first-child{grid-column:1/-1;}}
@media(max-width:768px){.footer-top{grid-template-columns:1fr 1fr;gap:1.5rem;}}
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
  <a href="${P}foretag.html" class="nl">För företag</a>
  <a href="${P}bli-foretag.html" class="nl">Bli partner</a>
  <div class="nav-login">
    <button class="nav-login-toggle" onclick="this.parentElement.classList.toggle('open')">Logga in <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg></button>
    <div class="nav-login-menu">
      <a href="${P}mitt-konto.html"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 3.75a2 2 0 100 4 2 2 0 000-4zm-3.5 2a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0zM3.25 17.5a6.75 6.75 0 0113.5 0 .75.75 0 01-1.5 0 5.25 5.25 0 00-10.5 0 .75.75 0 01-1.5 0z"/></svg>Mina bokningar</a>
      <a href="${P}stadare-dashboard.html"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 3.75A2.75 2.75 0 003.25 6.5v7A2.75 2.75 0 006 16.25h8A2.75 2.75 0 0016.75 13.5v-7A2.75 2.75 0 0014 3.75H6zM4.75 6.5c0-.69.56-1.25 1.25-1.25h8c.69 0 1.25.56 1.25 1.25v7c0 .69-.56 1.25-1.25 1.25H6c-.69 0-1.25-.56-1.25-1.25v-7zm2.25 1a.75.75 0 000 1.5h6a.75.75 0 000-1.5H7zm0 3a.75.75 0 000 1.5h4a.75.75 0 000-1.5H7z" clip-rule="evenodd"/></svg>Städarportalen</a>
    </div>
  </div>
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
    <a href="${P}foretag.html">För företag</a>
    <a href="${P}bli-stadare.html">Bli städare</a>
    <a href="${P}bli-foretag.html">Bli partner</a>
    <a href="${P}mitt-konto.html">Mina bokningar</a>
    <a href="${P}stadare-dashboard.html#team" data-vd-only>Företagsdashboard</a>
    <a href="${P}stadare-dashboard.html">Städarportalen</a>
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
    <h3>Kunder</h3>
    <ul>
      <li><a href="${P}boka.html">Boka städning</a></li>
      <li><a href="${P}hur-det-funkar.html">Hur det funkar</a></li>
      <li><a href="${P}faq.html">Vanliga frågor</a></li>
      <li><a href="${P}blogg/">Blogg & Guider</a></li>
      <li><a href="${P}kontakt.html">Kontakt</a></li>
      <li><a href="${P}mitt-konto.html">Mina bokningar</a></li>
      <li><a href="${P}presentkort.html">Presentkort</a></li>
      <li><a href="${P}nojdhetsgaranti.html">Nöjdhetsgaranti</a></li>
      <li><a href="${P}sakerhet.html">Säkerhet</a></li>
      <li><a href="${P}priser.html">Priser</a></li>
    </ul>
  </div>
  <div>
    <h3>Städare</h3>
    <ul>
      <li><a href="${P}bli-stadare.html">Bli städare</a></li>
      <li><a href="${P}stadare-dashboard.html">Städarportalen</a></li>
      <li><a href="${P}uppdragsavtal.html">Uppdragsavtal</a></li>
      <li><a href="${P}tips-for-stadare.html">Tips för städare</a></li>
    </ul>
    <h3 style="margin-top:1rem">Guider</h3>
    <ul>
      <li><a href="${P}blogg/rut-avdrag-guide.html">RUT-avdrag 2026</a></li>
      <li><a href="${P}blogg/flyttstadning-tips.html">Flyttstädning checklista</a></li>
      <li><a href="${P}blogg/storstadning-checklista.html">Storstädning guide</a></li>
    </ul>
  </div>
  <div>
    <h3>Städer</h3>
    <ul>
      <li><a href="${P}stockholm.html">Stockholm</a></li>
      <li><a href="${P}sundbyberg.html">Sundbyberg</a></li>
      <li><a href="${P}solna.html">Solna</a></li>
      <li><a href="${P}nacka.html">Nacka</a></li>
      <li><a href="${P}taby.html">Täby</a></li>
      <li><a href="${P}huddinge.html">Huddinge</a></li>
    </ul>
  </div>
</div>
<div class="footer-bottom">
  <p>© ${new Date().getFullYear()} Spick · org.nr 559402-4522
  <div style="display:flex;gap:16px;margin-top:12px;justify-content:center">
    <a href="https://instagram.com/spick.se" target="_blank" rel="noopener" style="color:rgba(255,255,255,.5);font-size:.8rem;text-decoration:none" title="Instagram">📸 Instagram</a>
    <a href="https://facebook.com/spick.se" target="_blank" rel="noopener" style="color:rgba(255,255,255,.5);font-size:.8rem;text-decoration:none" title="Facebook">👍 Facebook</a>
  </div></p>
  <div class="footer-bottom-links">
    <a href="${P}integritetspolicy.html">Integritetspolicy</a>
    <a href="${P}kundvillkor.html">Kundvillkor</a>
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
  // Stäng login-dropdown vid klick utanför
  document.addEventListener('click', function(e) {
    var dd = document.querySelector('.nav-login');
    if (dd && !dd.contains(e.target)) dd.classList.remove('open');
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

// ── GDPR COOKIE CONSENT ────────────────────────────────────────
// 1. Set Google consent defaults to denied BEFORE gtag loads
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  analytics_storage: 'granted',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});

function _spickLoadTracking() {
  // GA4
  if (!document.getElementById('spick-gtag')) {
    var g = document.createElement('script');
    g.id = 'spick-gtag'; g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=G-HTKC1TS64C';
    document.head.appendChild(g);
    gtag('js', new Date());
    gtag('config', 'G-HTKC1TS64C');
  }
  // Facebook Pixel
  if (!window.fbq) {
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '874536122252551');
    fbq('track', 'PageView');
  }
  // Microsoft Clarity
  if (!window.clarity) {
    (function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src='https://www.clarity.ms/tag/'+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,'clarity','script','w1ep5s1zm6');
  }
  // Update Google consent
  gtag('consent', 'update', {
    analytics_storage: 'granted',
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted'
  });
}

window.cookieChoice = function(accept) {
  localStorage.setItem('spick-cookie-consent', accept ? 'all' : 'necessary');
  var c = document.getElementById('spick-cookie');
  if (c) { c.style.transform = 'translateY(100%)'; setTimeout(function(){ c.remove(); }, 400); }
  if (accept) _spickLoadTracking();
};

// Auto-load tracking if already consented; show banner if not
(function() {
  var consent = localStorage.getItem('spick-cookie-consent');
  if (consent === 'all') { _spickLoadTracking(); return; }
  if (consent === 'necessary') return; // Already declined, don't show banner

  // Inject banner CSS + HTML
  function showBanner() {
    if (document.getElementById('spick-cookie')) return;
    var css = document.createElement('style');
    css.textContent = '#spick-cookie{position:fixed;bottom:0;left:0;right:0;background:#1C1C1A;color:#fff;padding:16px 24px;z-index:9999;display:flex;align-items:center;gap:16px;flex-wrap:wrap;box-shadow:0 -4px 24px rgba(0,0,0,.2);transform:translateY(100%);transition:transform .4s ease;font-family:"DM Sans",-apple-system,sans-serif;padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));padding-left:calc(24px + env(safe-area-inset-left,0px));padding-right:calc(24px + env(safe-area-inset-right,0px))}#spick-cookie.show{transform:translateY(0)}#spick-cookie p{font-size:13px;line-height:1.5;flex:1;min-width:200px;color:#e5e5e5;margin:0}#spick-cookie a{color:#1D9E75;text-decoration:none}.ck-btns{display:flex;gap:10px;flex-shrink:0}.ck-acc{background:#0F6E56;color:#fff;border:none;padding:12px 22px;min-height:44px;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;transition:background .2s}.ck-acc:hover{background:#1D9E75}.ck-dec{background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.2);padding:12px 18px;min-height:44px;border-radius:8px;font-size:13px;cursor:pointer;font-family:inherit;transition:background .2s}.ck-dec:hover{background:rgba(255,255,255,.2)}@media(max-width:600px){#spick-cookie{flex-direction:column;text-align:center;padding:14px 16px;padding-bottom:calc(14px + env(safe-area-inset-bottom,0px))}.ck-btns{width:100%;justify-content:center}.ck-acc,.ck-dec{flex:1;max-width:200px}}';
    document.head.appendChild(css);

    var el = document.createElement('div');
    el.id = 'spick-cookie';
    el.innerHTML = '<p>Vi använder cookies för att förbättra din upplevelse och analysera trafik. Läs mer i vår <a href="/integritetspolicy.html">integritetspolicy</a>.</p><div class="ck-btns"><button class="ck-dec" onclick="cookieChoice(false)">Bara nödvändiga</button><button class="ck-acc" onclick="cookieChoice(true)">Acceptera</button></div>';
    document.body.appendChild(el);
    setTimeout(function(){ el.classList.add('show'); }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
})();

})();

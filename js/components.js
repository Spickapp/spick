// ═══════════════════════════════════════════════════════════════
// SPICK – Delade komponenter (nav, footer, mobilmeny)
// Ladda efter config.js: <script src="js/components.js" defer></script>
// ═══════════════════════════════════════════════════════════════

(function() {
'use strict';

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
  <a href="${P}stadare.html" class="nl">Städare</a>
  <a href="${P}bli-stadare.html" class="nl-out">Bli städare</a>
  <a href="${P}stadare.html" class="nl-btn">Boka städning</a>
</div>
<button class="hamburger" onclick="document.getElementById('mobMenu').style.display='flex'" aria-label="Öppna meny">
  <span></span><span></span><span></span>
</button>`;

// ── MOBILMENY ───────────────────────────────────────────────
const MOB_HTML = `
<div class="mob-menu" id="mobMenu" style="display:none" onclick="this.style.display='none'">
  <div class="mob-panel" onclick="event.stopPropagation()">
    <a href="${P}stadare.html">Hitta städare</a>
    <a href="${P}boka.html">Boka städning</a>
    <a href="${P}hur-det-funkar.html">Hur det funkar</a>
    <a href="${P}priser.html">Priser</a>
    <a href="${P}tjanster.html">Tjänster</a>
    <a href="${P}bli-stadare-guide.html">Bli städare</a>
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
      <li><a href="${P}stadare.html">Hitta städare</a></li>
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
      <li><a href="${P}bli-stadare-guide.html">Bli städare</a></li>
      <li><a href="${P}rekrytera.html">Varför Spick?</a></li>
      <li><a href="${P}avtal.html">Partnersavtal</a></li>
    </ul>
    <h4 style="margin-top:1rem">Guider</h4>
    <ul>
      <li><a href="${P}blogg/rut-avdrag-guide.html">RUT-avdrag 2026</a></li>
      <li><a href="${P}blogg/flyttstadning-tips.html">Flyttstädning checklista</a></li>
      <li><a href="${P}blogg/storstadning-checklista.html">Storstädning guide</a></li>
      <li><a href="${P}blogg/valjt-ratt-stadare.html">Välj rätt städare</a></li>
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
document.addEventListener('DOMContentLoaded', function() {
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

  // Markera aktiv nav-länk
  const current = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav .nl, nav .nl-out, nav .nl-btn').forEach(link => {
    const href = link.getAttribute('href')?.split('/').pop();
    if (href === current) {
      link.style.color = 'var(--g, #0F6E56)';
      link.style.fontWeight = '600';
    }
  });
});

// Exponera för manuell användning
window.SPICK_COMPONENTS = { NAV_HTML, MOB_HTML, FOOTER_HTML };
})();

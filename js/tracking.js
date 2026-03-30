/**
 * tracking.js - Spick GDPR-korrekt tracking med Google Consent Mode v2
 * 
 * Laddar GA4 + Facebook Pixel med cookie-samtycke.
 * Drop-in: <script src="js/tracking.js"></script> (efter config.js)
 * 
 * GA4: G-CP115M45TT
 * Facebook Pixel: 874536122252551
 */
(function() {
  const GA_ID = 'G-CP115M45TT';
  const FB_PIXEL = '874536122252551';
  const CONSENT_KEY = 'spick_consent';

  // Google Consent Mode v2 — default: denied
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted',
    wait_for_update: 500,
  });

  gtag('js', new Date());
  gtag('config', GA_ID, { send_page_view: false });

  // Ladda GA4 script
  const gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(gaScript);

  // Kolla befintligt samtycke
  const stored = localStorage.getItem(CONSENT_KEY);
  if (stored === 'granted') {
    grantConsent();
  } else if (stored !== 'denied') {
    showBanner();
  }

  function grantConsent() {
    gtag('consent', 'update', {
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
    gtag('event', 'page_view');
    loadFacebookPixel();
    localStorage.setItem(CONSENT_KEY, 'granted');
  }

  function denyConsent() {
    localStorage.setItem(CONSENT_KEY, 'denied');
    gtag('event', 'page_view'); // anonym page view med consent denied
  }

  function loadFacebookPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', FB_PIXEL);
    fbq('track', 'PageView');
  }

  function showBanner() {
    const banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#fff;padding:14px 20px;box-shadow:0 -4px 24px rgba(0,0,0,.12);z-index:9999;font-family:"DM Sans",sans-serif;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:.85rem;border-top:1px solid #E8E8E4';
    banner.innerHTML = `
      <div style="flex:1;min-width:200px;color:#1C1C1A;line-height:1.5">
        Vi använder cookies för att förbättra din upplevelse. 
        <a href="integritetspolicy.html" style="color:#0F6E56;text-decoration:underline">Läs mer</a>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button id="cookie-deny" style="padding:8px 16px;border:1.5px solid #E8E8E4;border-radius:10px;background:#fff;font-family:inherit;font-size:.82rem;cursor:pointer;color:#6B6960">Neka</button>
        <button id="cookie-accept" style="padding:8px 16px;border:none;border-radius:10px;background:#0F6E56;color:#fff;font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer">Godkänn</button>
      </div>`;
    document.body.appendChild(banner);

    document.getElementById('cookie-accept').addEventListener('click', function() {
      grantConsent();
      banner.remove();
    });
    document.getElementById('cookie-deny').addEventListener('click', function() {
      denyConsent();
      banner.remove();
    });
  }

  // Expose for manual tracking
  window.spickTrack = function(eventName, params) {
    if (typeof gtag === 'function') gtag('event', eventName, params || {});
    if (typeof fbq === 'function') fbq('trackCustom', eventName, params || {});
  };
})();

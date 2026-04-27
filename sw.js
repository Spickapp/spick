// ═══════════════════════════════════════════════════════════════
// SPICK Service Worker v2026-04-27
// ═══════════════════════════════════════════════════════════════
//
// Strategi: stale-while-revalidate för statiska assets,
// network-only för API + admin (alltid fresh).
//
// CACHED:
//   - HTML (samma origin) — stale-while-revalidate, max 1d
//   - CSS, JS, ikoner, fonts — cache-first
//
// EJ CACHADE:
//   - /admin*, /stadare-dashboard*, /min-bokning* — alltid fresh
//   - Supabase REST + Edge Functions — alltid fresh (auth-bundna)
//   - /functions/v1/* — alltid fresh
//
// CRO-EXKLUDERINGAR:
//   - boka.html slot-availability — alltid fresh (stale = dubbelbokning)
//   - tack.html — alltid fresh (kan ha session-data)
//
// CACHE-INVALIDATION: bump CACHE_VERSION vid större deploys.
// ═══════════════════════════════════════════════════════════════

const CACHE_VERSION = 'spick-v2026-04-27';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const HTML_CACHE = `${CACHE_VERSION}-html`;

const CACHE_FIRST_EXTENSIONS = ['.css', '.js', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.svg', '.ico'];

const NEVER_CACHE_PATHS = [
  '/admin',
  '/stadare-dashboard',
  '/stadare-uppdrag',
  '/min-bokning',
  '/boka.html',
  '/tack.html',
  '/rate.html',
];

const NEVER_CACHE_HOSTS = [
  'urjeijcncsyuletprydy.supabase.co',
  'api.stripe.com',
  'checkout.stripe.com',
  'js.stripe.com',
];

self.addEventListener('install', (event) => {
  // Aktivera direkt — ingen waiting
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Rensa gamla cache-versioner
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function shouldNeverCache(url) {
  if (NEVER_CACHE_HOSTS.some(host => url.hostname === host)) return true;
  if (NEVER_CACHE_PATHS.some(path => url.pathname.startsWith(path))) return true;
  if (url.search) return true; // Query-strings = dynamic content
  return false;
}

function isCacheFirst(url) {
  return CACHE_FIRST_EXTENSIONS.some(ext => url.pathname.endsWith(ext));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip alla cross-origin POST + auth-bunden
  if (shouldNeverCache(url)) return;

  // Cache-first för statiska assets
  if (isCacheFirst(url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(req, res.clone());
        }
        return res;
      } catch {
        // Offline + ingen cache → fail
        return new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Stale-while-revalidate för HTML
  if (req.destination === 'document' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const networkPromise = fetch(req).then(res => {
        if (res.ok) {
          // Clone SYNKRONT innan res returneras (annars kan body vara konsumerad
          // när cache.put() kör i async-then-callback → "body already used").
          const resClone = res.clone();
          caches.open(HTML_CACHE).then(cache => cache.put(req, resClone));
        }
        return res;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || networkPromise;
    })());
  }
});

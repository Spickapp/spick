// SPICK SERVICE WORKER v3.0 — Production-grade
// Stale-While-Revalidate for pages, Cache-First for assets
const VERSION = '2026-03-28-v12';
const CACHE = `spick-${VERSION}`;

const PRECACHE = [
  '/', '/index.html', '/boka.html', '/stadare.html',
  '/priser.html', '/hur-det-funkar.html', '/faq.html',
  '/404.html', '/manifest.json',
  '/js/config.js', '/js/components.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE).catch(err => console.warn('Precache partial:', err)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('spick-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Never cache: APIs, analytics, third-party
  if (url.hostname.includes('supabase.co') || url.hostname.includes('google') ||
      url.hostname.includes('facebook') || url.hostname.includes('clarity') ||
      url.hostname.includes('stripe') || url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/functions/')) return;

  // HTML: Stale-While-Revalidate (max 24h cache age)
  if (e.request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/') {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(r => {
          if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
          return r;
        }).catch(() => cached || caches.match('/404.html'));
        // If cached version exists and is less than 24h old, serve it while revalidating
        // If older than 24h or no cache, wait for network
        if (cached) {
          const cachedDate = cached.headers.get('date');
          const age = cachedDate ? (Date.now() - new Date(cachedDate).getTime()) : Infinity;
          if (age < 86400000) return cached; // < 24h: serve stale, revalidate in background
        }
        return net; // No cache or stale > 24h: wait for network
      })
    );
    return;
  }

  // Static assets: Cache-first
  if (url.pathname.match(/\.(js|css|woff2?|png|jpg|jpeg|svg|ico|webp)$/)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || 
        fetch(e.request).then(r => {
          if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
          return r;
        }).catch(() => new Response('', { status: 503 }))
      )
    );
    return;
  }

  // Everything else: Network-first
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && r.type === 'basic') { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request))
  );
});

// Push notifications
self.addEventListener('push', e => {
  if (!e.data) return;
  let data;
  try { data = e.data.json(); } catch { data = { title: 'Spick', body: e.data.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Spick', {
    body: data.body || '', icon: '/assets/icon-192.png', badge: '/assets/icon-192.png',
    tag: 'spick-' + (data.tag || 'default'), data: { url: data.url || '/' }, vibrate: [200, 100, 200],
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const win = cs.find(c => c.url.includes(self.location.origin));
      return win ? win.focus().then(w => w.navigate(url)) : clients.openWindow(url);
    })
  );
});

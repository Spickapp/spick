// SPICK SERVICE WORKER v2.0
const CACHE = 'spick-v3';
const STATIC = [
  '/', '/index.html', '/stadare.html', '/boka.html',
  '/bli-stadare.html', '/hur-det-funkar.html', '/priser.html',
  '/faq.html', '/404.html', '/profil.html', '/tack.html', '/manifest.json'
];

// Installera och precacha
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Rensa gamla cacher
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: Network-first för API, Cache-first för statiska filer
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Skippa Supabase API och analytics
  if (url.hostname.includes('supabase.co') ||
      url.hostname.includes('google-analytics') ||
      url.hostname.includes('clarity.ms') ||
      url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/functions/')) return;

  // Network-first med cache fallback
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(cached => cached || caches.match('/404.html')))
  );
});

// Push-notiser
self.addEventListener('push', e => {
  let data = { title: 'Spick', body: 'Nytt meddelande', url: '/' };
  if (e.data) {
    try { data = { ...data, ...e.data.json() }; }
    catch { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      tag: 'spick',
      data: { url: data.url },
      vibrate: [100, 50, 100]
    })
  );
});

// Klick på notis
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then(cl => {
      for (const c of cl) {
        if (c.url.includes('spick.se') && 'focus' in c) {
          c.navigate(e.notification.data?.url || '/');
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(e.notification.data?.url || '/');
    })
  );
});

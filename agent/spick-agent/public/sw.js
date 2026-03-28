// sw.js – Service worker for Spick Agent PWA
const CACHE = "spick-agent-v1";
const PRECACHE = ["/dashboard", "/manifest.json", "/icon-192.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // API calls – network only
  if (
    url.pathname.startsWith("/run-task") ||
    url.pathname.startsWith("/status") ||
    url.pathname.startsWith("/tasks") ||
    url.pathname.startsWith("/health") ||
    url.pathname.startsWith("/api-docs") ||
    url.pathname.startsWith("/stop") ||
    url.pathname.startsWith("/task/") ||
    url.pathname.startsWith("/run-queue") ||
    url.pathname.startsWith("/ws")
  ) {
    return; // don't intercept API/WS calls
  }

  // Dashboard + assets – network first, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

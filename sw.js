/* Service worker: makes the viewer installable and usable offline.
 * Network-first, so visitors always get the latest deploy when online; the cache is only a fallback.
 * Chats are never cached here: they are read from local files and stay in memory. */
const CACHE = 'cev-v1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/theme.js',
  './js/analytics.js',
  './js/parser.js',
  './js/format.js',
  './js/demo.js',
  './js/app.js',
  './js/vendor/jszip.min.js',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});

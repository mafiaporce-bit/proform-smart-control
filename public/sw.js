// Service worker: keeps the app shell available offline.
// Bluetooth itself always needs the page open and the treadmill in range.
const CACHE = 'psc-__VERSION__';
// Large files fetched once and kept across app updates (the 3D person).
const ASSETS = 'pscassets-1';
const FILES = "__FILES__";

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('psc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 3D engine, voice model, CDN: straight to network
  if (req.mode === 'navigate') {
    // Pages (the app, and the 3D park inside it): network first, then the saved copy.
    event.respondWith(
      fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/'))),
    );
    return;
  }
  if (url.pathname.endsWith('.glb')) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok && res.status === 200) cache.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});

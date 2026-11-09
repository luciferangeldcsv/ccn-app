// CCN DEV paneli — çevrimdışı açılış ve ana ekrana ekleme. api.php kapsam dışında (hep ağdan gelir).
const CACHE = 'ccn-dev-1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest']).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE && k.startsWith('ccn-dev-')) await caches.delete(k); await self.clients.claim(); })()); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== location.origin || !url.pathname.includes('/livadmin')) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try { const r = await fetch(req, { cache: 'no-store' }); if (r.ok && r.type === 'basic') c.put(req.mode === 'navigate' ? './index.html' : req, r.clone()).catch(() => {}); return r; }
    catch (err) { const hit = req.mode === 'navigate' ? (await c.match('./index.html')) || (await c.match('./')) : await c.match(req); if (hit) return hit; throw err; }
  })());
});

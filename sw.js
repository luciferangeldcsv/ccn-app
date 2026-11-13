// Vardiya Listesi — çevrimdışı açılış ve "ana ekrana ekle" için hizmet çalışanı.
// Uygulama kabuğu (sayfa, kod, yazı tipleri, ikonlar) önce ağdan istenir; ağ yoksa son kopya kullanılır.
// api.php hiç önbelleğe alınmaz (oturuma özel veri): çevrimdışıyken son liste uygulamanın kendi kaydından gösterilir.
const CACHE = 'ccn-kabuk-0b5e3287eb';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png?v=3', './icon-512.png?v=3', './apple-touch-icon.png?v=3'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL).catch(() => {});
    // sayfanın kullandığı app.js?v=… sürümünü de önceden al
    try {
      const html = await (await fetch('./index.html', { cache: 'no-store' })).text();
      const extra = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|woff2)(?:\?[^"]*)?)"/g)].map((m) => m[1]).filter((u) => !/^https?:/.test(u) && !u.startsWith('vendor/'));
      await c.addAll(extra).catch(() => {});
    } catch (err) { /* çevrimdışı kurulum: kabuk yeter */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('ccn-kabuk-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // arayüz, DEV paneli, kurulum ve büyük okuma modelleri ağdan gelir, saklanmaz
  if (/\/(api|kurulum)\.php$/.test(url.pathname) || url.pathname.includes('/livadmin') || url.pathname.includes('/vendor/') || url.pathname.includes('/samples/')) return;
  const nav = req.mode === 'navigate';
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: 'no-store' });
      if (res.ok && res.type === 'basic') c.put(nav ? './index.html' : req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = nav ? (await c.match('./index.html')) || (await c.match('./')) : (await c.match(req)) || (await c.match(req, { ignoreSearch: true }));
      if (hit) return hit;
      throw err;
    }
  })());
});

// bildirimler: sunucudan gelen şifreli mesaj (başlık, metin, adres) gösterilir; dokununca uygulama açılır
self.addEventListener('push', (e) => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (err) { m = { metin: e.data ? e.data.text() : '' }; }
  if (m.rozet && self.navigator && self.navigator.setAppBadge) self.navigator.setAppBadge().catch(() => {});
  e.waitUntil(self.registration.showNotification(m.baslik || 'Vardiya Listesi', { body: m.metin || '', icon: './icon-192.png?v=3', badge: './icon-192.png?v=3', tag: m.etiket || undefined, data: { url: m.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { await c.focus(); try { await c.navigate(url); } catch (err) { /* yoksay */ } return; }
    await self.clients.openWindow(url);
  })());
});

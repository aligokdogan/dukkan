// Uygulama dosyalarını telefonda saklar: internet olmadan da açılır.
// Yeni sürüm yayınlanınca SURUM değiştirilir.
const SURUM = 'dukkan-v1';
const DOSYALAR = ['./', 'index.html', 'app.js', 'veri.js', 'style.css', 'manifest.json',
  'ikon/ikon-192.png', 'ikon/ikon-512.png', 'ikon/apple-touch-icon.png', 'ikon/ikon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SURUM).then(c => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(adlar => Promise.all(adlar.filter(a => a !== SURUM).map(a => caches.delete(a))))
    .then(() => self.clients.claim()));
});

// Önce ağ (güncelleme varsa gelsin), ağ yoksa telefondaki kopya.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(yanit => {
        if (yanit.ok) {
          const kopya = yanit.clone();
          caches.open(SURUM).then(c => c.put(e.request, kopya));
        }
        return yanit;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const hedef = new URL(e.notification.data.url || '#/', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(pencereler => {
    for (const p of pencereler) {
      if ('focus' in p) { p.navigate(hedef); return p.focus(); }
    }
    return self.clients.openWindow(hedef);
  }));
});

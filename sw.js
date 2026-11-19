/* Service Worker: push OneSignal + cache offline untuk app shell */
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');

const CACHE = 'lsc-v10'; // naikkan versi setiap kali Anda mengubah file frontend
const SHELL = ['./', 'index.html', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const SKIP = ['script.google.com', 'script.googleusercontent.com', 'drive.google.com', 'googleusercontent.com', 'onesignal.com', 'unpkg.com', 'zegocloud.com', 'zego.im'];

self.addEventListener('install', (e) => {
  // 'reload' = abaikan cache HTTP browser (GitHub Pages menyimpan file ~10 menit) agar file terbaru yang dipasang
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => (r.ok ? c.put(u, r) : null)).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'lsc-files').map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (SKIP.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put('index.html', cp)); return r; })
      .catch(() => caches.match('index.html')));
    return;
  }
  // file milik sendiri (app.js, manifest, ikon): utamakan versi terbaru dari jaringan, cache hanya untuk offline
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then((r) => {
        if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // pustaka pihak ketiga (mis. Tailwind CDN): stale-while-revalidate
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => {
        if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
        return r;
      }).catch(() => hit);
      return hit || net;
    })
  );
});

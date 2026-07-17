/* かんたんDAW Service Worker
   オフラインでも使えるようにファイルをキャッシュする */
const CACHE_NAME = 'kantan-daw-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/main.js',
  './js/config.js',
  './js/state.js',
  './js/audio/bus.js',
  './js/audio/scheduler.js',
  './js/audio/wav.js',
  './js/ui/grid.js',
  './js/ui/controls.js',
  './js/instruments/index.js',
  './js/instruments/basic-drums.js',
  './js/instruments/chords.js',
  './js/instruments/bass.js',
  './js/instruments/melody.js',
  './js/instruments/icepad.js',
  './js/instruments/icesynth.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先 + 裏でネットワーク更新(stale-while-revalidate)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res && res.ok && new URL(e.request.url).origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});

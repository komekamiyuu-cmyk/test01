// オフラインでも起動できるようにアプリ本体をキャッシュする Service Worker
// 配信内容を更新したらこの版数を上げる(古いキャッシュは activate 時に破棄される)
const CACHE = 'cassette-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './theme.css',
  './fonts.css',
  './js/main.js',
  './js/id3.js',
  './js/share.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// キャッシュ優先(なければネットワークから取得してキャッシュに追加)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((res) => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});

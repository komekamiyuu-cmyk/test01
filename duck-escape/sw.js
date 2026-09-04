/* アヒル逃走記 3D — オフラインでも遊べるようにファイルをキャッシュする */
const CACHE = 'duck-escape-v1';
const ASSETS = [
  './', './index.html', './style.css', './manifest.json', './icon.svg',
  './js/main.js', './js/config.js', './js/hud.js',
  './js/engine/math.js', './js/engine/gl.js', './js/engine/geometry.js', './js/engine/scene.js',
  './js/models/meshes.js', './js/models/parts.js', './js/models/items.js',
  './js/models/duck.js', './js/models/oni.js', './js/models/world.js',
  './js/game/input.js', './js/game/audio.js', './js/game/effects.js',
  './js/game/projectiles.js', './js/game/pickups.js', './js/game/player.js', './js/game/enemy.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});

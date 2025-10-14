// sw.js - Service Worker
self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('fetch', e => {
  // Estrategia: Network falling back to cache
  // Intenta obtener el recurso de la red primero. Si falla (offline),
  // intenta obtenerlo del caché.
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

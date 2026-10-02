/* Service worker: makes the app open instantly and work without internet.
 * The version and the file list below are filled in at build time (scripts/pwa-plugin.ts). */

const CACHE = 'cuanto-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // `reload` skips the HTTP cache so we store exactly what the server has now.
      await Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('cuanto-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Files are stored once per URL, so ignore `Vary` (some servers send `Vary: Origin`, and
      // module scripts carry an Origin header the stored copy doesn't, which would be a false miss).
      const lookup = { ignoreVary: true };
      // Every page load is the same single-page app, whatever the query string says.
      if (request.mode === 'navigate') {
        return (await cache.match('./index.html', lookup)) ?? (await cache.match('./', lookup)) ?? fetch(request);
      }
      const hit = await cache.match(request, lookup);
      if (hit) return hit;
      try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') cache.put(request, response.clone());
        return response;
      } catch {
        return Response.error();
      }
    })(),
  );
});

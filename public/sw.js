const CACHE_NAME = "monopoly-room-cache-v2";
const STATIC_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    (async () => {
      const isNavigationRequest = event.request.mode === "navigate";
      const isStaticRequest =
        requestUrl.pathname.startsWith("/_next/static/") ||
        STATIC_ASSETS.includes(requestUrl.pathname);

      try {
        const networkResponse = await fetch(event.request);
        if (isStaticRequest && networkResponse.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        if (isNavigationRequest) {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match("/offline.html")) ?? Response.error();
        }

        return Response.error();
      }
    })(),
  );
});

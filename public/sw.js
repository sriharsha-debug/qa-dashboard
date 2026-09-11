// Minimal service worker: makes the dashboard installable and caches the
// static app shell so it still opens (read-only, last-loaded state) with
// no signal. It never caches Supabase API calls — those always go to the
// network, so your data is always live when you have a connection.

const CACHE_NAME = "qa-dashboard-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/config.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch anything that isn't a same-origin GET (Supabase/API calls,
  // POST/PUT/DELETE, cross-origin CDN scripts, etc.) — straight to network.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      // Stale-while-revalidate: show cached shell instantly, refresh in background.
      return cached || network;
    })
  );
});

// Service worker — lets the app install to the home screen and work offline
// during a neighborhood walk (spotty signal). Scan logging (/api/*) always
// goes to the network and is never cached.
const CACHE = "lakeland-quest-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./data.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // never cache scans

  // Navigations: serve the app shell so any ?c=<code> URL opens instantly/offline.
  if (e.request.mode === "navigate") {
    e.respondWith(caches.match("./index.html").then((r) => r || fetch(e.request)));
    return;
  }
  // Static assets: cache-first, then network (and cache it for next time).
  e.respondWith(
    caches.match(e.request).then((cached) =>
      cached ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => cached)
    )
  );
});

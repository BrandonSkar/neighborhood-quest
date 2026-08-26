// Service worker — installable + offline, but NETWORK-FIRST so a new deploy shows
// up immediately when online (falls back to cache only when the network fails).
// Scan logging (/api/*) always goes straight to the network and is never cached.
const CACHE = "lakeland-quest-v8";
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
  "./badge-96.png",
  "./greenery.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/jsqr/jsQR.min.js",   // in-app sticker scanner (also works offline)
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Alerts for the grown-up: the server pushes { title, body, tag, url } when a child
// scans a sticker or reports one missing. Only phones that opted in from the
// setup pages are subscribed, so a kid's phone never buzzes.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch (err) { /* fall back to the defaults below */ }
  e.waitUntil(self.registration.showNotification(d.title || "Neighborhood Quest 🗺️", {
    body: d.body || "Something just happened in the quest!",
    icon: "./icon-192.png",
    // Android tints ONLY the alpha silhouette up in the status bar, so this must be
    // the white-on-transparent pin — a full-colour icon renders as a white square.
    badge: "./badge-96.png",
    tag: d.tag || "nq-alert",
    data: { url: d.url || "./stats.html" },
  }));
});

// Tapping it opens (or focuses) the quest.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // never cache scans

  // Network-first: try the network, cache a fresh copy for offline, and only fall
  // back to the cache (or the app shell) when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match("./index.html")))
  );
});

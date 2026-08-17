// Root-scoped service worker for the whole origin.
// Caches ONLY the hub shell; sub-apps (/scanning, /troubleshoot) pass through
// to the network, with a graceful offline page for uncached navigations.

const CACHE = "hub-v1";
const OFFLINE_URL = "/offline";

const HUB_ASSETS = [
  "/",
  "/offline",
  "/static/style.css",
  "/static/script.js",
  "/manifest.json",
  "/static/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(HUB_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isHubAsset = HUB_ASSETS.includes(url.pathname);

  // Cache-first for the hub shell.
  if (isHubAsset) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  // For page navigations (incl. sub-apps): try network, fall back to offline page.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    );
    return;
  }

  // Everything else (sub-app assets, APIs): network only, no caching.
  event.respondWith(fetch(request));
});

// ---- Local notifications ----
// The page pings us on a timer; we show a notification from the SW so it works
// even when the tab is backgrounded (required for installed-PWA notifications).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "NOTIFY") {
    self.registration.showNotification(event.data.title || "Incubator", {
      body: event.data.body || "You have a reminder.",
      icon: "/static/icons/icon-192.png",
      badge: "/static/icons/icon-192.png",
      tag: "incubator-reminder",
      renotify: true,
    });
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if ("focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});

// Root-scoped service worker for the whole origin.
// Caches ONLY the hub shell; sub-apps pass through with an offline fallback.
// Persists incoming pushes to IndexedDB for the in-app notification center.

importScripts("/static/notif-store.js");

const CACHE = "hub-v1";
const OFFLINE_URL = "/offline";

const HUB_ASSETS = [
  "/",
  "/offline",
  "/static/style.css",
  "/static/script.js",
  "/static/notif-store.js",
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

  if (isHubAsset) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  event.respondWith(fetch(request));
});

// ---- Web Push (server-driven, works when the app is closed) ----
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Incubator", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Incubator";
  const body = data.body || "You have a reminder.";
  const url = data.url || "/";

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body,
        icon: "/static/icons/icon-192.png",
        badge: "/static/icons/icon-192.png",
        tag: "incubator-push",
        renotify: true,
        data: { url },
      });

      // Persist for the in-app notification center.
      try {
        await self.NotifStore.add({ title, body, url, ts: Date.now() });
      } catch {}

      // Badge = unread count in our store (stays in sync as the user reads).
      if (self.navigator && "setAppBadge" in self.navigator) {
        let n = 0;
        try {
          n = await self.NotifStore.unreadCount();
        } catch {
          n = Number(data.badge_count || 0);
        }
        if (n > 0) await self.navigator.setAppBadge(n);
        else await self.navigator.clearAppBadge();
      }

      // Tell any open page to refresh its bell/list.
      const list = await self.clients.matchAll({ type: "window" });
      for (const c of list) c.postMessage({ type: "NOTIF_ADDED" });
    })()
  );
});

// ---- Local notification fallback (foreground, via postMessage) ----
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
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ type: "NOTIF_OPENED" });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

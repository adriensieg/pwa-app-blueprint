// Shared notification store on IndexedDB.
// Written by the service worker (on push, even when the app is closed) and
// read/updated by the hub page. The unread count drives the app badge.
//
// Loaded via importScripts() in the service worker and <script> in the page,
// so it attaches to the global (self/window) as `NotifStore`.

(function (global) {
  const DB_NAME = "incubator";
  const STORE = "notifications";
  const VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: "id" });
          os.createIndex("ts", "ts");
          os.createIndex("read", "read");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }

  async function add(notif) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const rec = {
        id: notif.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: notif.title || "Incubator",
        body: notif.body || "",
        url: notif.url || "/",
        ts: notif.ts || Date.now(),
        read: false,
      };
      const r = tx(db, "readwrite").add(rec);
      r.onsuccess = () => resolve(rec);
      r.onerror = () => reject(r.error);
    });
  }

  async function all() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, "readonly").getAll();
      r.onsuccess = () => resolve(r.result.sort((a, b) => b.ts - a.ts));
      r.onerror = () => reject(r.error);
    });
  }

  async function unreadCount() {
    const items = await all();
    return items.filter((n) => !n.read).length;
  }

  async function markRead(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const store = tx(db, "readwrite");
      const g = store.get(id);
      g.onsuccess = () => {
        const rec = g.result;
        if (rec) {
          rec.read = true;
          store.put(rec);
        }
        resolve();
      };
      g.onerror = () => reject(g.error);
    });
  }

  async function markAllRead() {
    const items = await all();
    const db = await openDB();
    const store = tx(db, "readwrite");
    for (const rec of items) {
      if (!rec.read) {
        rec.read = true;
        store.put(rec);
      }
    }
    return new Promise((resolve) => {
      store.transaction.oncomplete = () => resolve();
    });
  }

  async function remove(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, "readwrite").delete(id);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  async function clearAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const r = tx(db, "readwrite").clear();
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  }

  global.NotifStore = {
    add,
    all,
    unreadCount,
    markRead,
    markAllRead,
    remove,
    clearAll,
  };
})(typeof self !== "undefined" ? self : window);

// ---------- Service worker (root scope) ----------
let swReg = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      swReg = reg;
    })
    .catch(() => {});
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------- iOS "Add to Home Screen" prompt ----------
const DISMISS_KEY = "iosInstallDismissedUntil";
const DISMISS_DAYS = 7;

function isIos() {
  const ua = window.navigator.userAgent;
  const iDevice = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  return iDevice || iPadOs;
}

function isStandalone() {
  return (
    window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function dismissedRecently() {
  try {
    return Date.now() < Number(localStorage.getItem(DISMISS_KEY) || 0);
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    localStorage.setItem(
      DISMISS_KEY,
      String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000)
    );
  } catch {}
}

function maybeShowIosInstall() {
  if (!isIos() || isStandalone() || dismissedRecently()) return;
  const el = document.getElementById("ios-install");
  const close = document.getElementById("ios-install-close");
  if (!el) return;
  el.hidden = false;
  const hide = () => {
    el.hidden = true;
    rememberDismissal();
  };
  close.addEventListener("click", hide);
  el.addEventListener("click", (e) => {
    if (e.target === el) hide();
  });
}

maybeShowIosInstall();

// ---------- Web Push subscription ----------
const PUSH_BASE = "/push";
const notifBtn = document.getElementById("notif-btn");

function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function subscribeToPush() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = await (await fetch(`${PUSH_BASE}/vapid-public-key`)).text();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key.trim()),
    });
  }
  await fetch(`${PUSH_BASE}/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
}

function setupNotifications() {
  if (
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  ) {
    return;
  }
  if (Notification.permission === "granted") {
    subscribeToPush().catch(() => {});
    return;
  }
  if (Notification.permission === "denied") return;

  if (notifBtn) {
    notifBtn.classList.remove("d-none");
    notifBtn.addEventListener("click", async () => {
      const perm = await Notification.requestPermission();
      if (perm === "granted") {
        notifBtn.classList.add("d-none");
        subscribeToPush().catch(() => {});
      }
    });
  }
}

setupNotifications();

// ---------- Notification center (bell) ----------
const bellBtn = document.getElementById("bell-btn");
const bellCount = document.getElementById("bell-count");
const panel = document.getElementById("notif-panel");
const listEl = document.getElementById("notif-list");
const emptyEl = document.getElementById("notif-empty");
const closeBtn = document.getElementById("notif-close");
const clearBtn = document.getElementById("notif-clear");

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function refreshBadge() {
  if (!window.NotifStore) return;
  const n = await NotifStore.unreadCount();
  bellCount.textContent = n;
  bellCount.classList.toggle("d-none", n === 0);
  if ("setAppBadge" in navigator) {
    if (n > 0) navigator.setAppBadge(n).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }
}

async function renderList() {
  if (!window.NotifStore) return;
  const items = await NotifStore.all();
  listEl.innerHTML = "";
  emptyEl.classList.toggle("d-none", items.length > 0);
  for (const n of items) {
    const li = document.createElement("li");
    li.className = "notif-item" + (n.read ? " read" : "");
    li.innerHTML = `
      <span class="notif-dot"></span>
      <span class="notif-body">
        <span class="notif-item-title">${escapeHtml(n.title)}</span>
        <span class="notif-item-text">${escapeHtml(n.body)}</span>
        <span class="notif-item-time">${timeAgo(n.ts)}</span>
      </span>
      <button class="notif-dismiss" aria-label="Dismiss"><i class="bi bi-x"></i></button>`;
    li.querySelector(".notif-dismiss").onclick = async (e) => {
      e.stopPropagation();
      await NotifStore.remove(n.id);
      await renderList();
      await refreshBadge();
    };
    listEl.appendChild(li);
  }
}

async function openPanel() {
  await renderList();
  panel.hidden = false;
  await NotifStore.markAllRead(); // opening = viewing → badge clears
  await renderList();
  await refreshBadge();
}

function closePanel() {
  panel.hidden = true;
}

if (bellBtn) {
  bellBtn.addEventListener("click", openPanel);
  closeBtn.addEventListener("click", closePanel);
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closePanel();
  });
  clearBtn.addEventListener("click", async () => {
    await NotifStore.clearAll();
    await renderList();
    await refreshBadge();
  });

  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data && (e.data.type === "NOTIF_ADDED" || e.data.type === "NOTIF_OPENED")) {
      refreshBadge();
      if (!panel.hidden) renderList();
    }
  });

  refreshBadge();
}

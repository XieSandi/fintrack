// FinTrack Service Worker — offline app shell
// Naikin CACHE_VERSION setiap deploy perubahan file, biar user dapet versi baru.
const CACHE_VERSION = "fintrack-v9";
const RUNTIME_CACHE = "fintrack-runtime-v2";

const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/store.js",
  "./js/db.js",
  "./js/utils.js",
  "./js/kurs.js",
  "./js/prices.js",
  "./js/tx-sheet.js",
  "./js/views/home.js",
  "./js/views/transactions.js",
  "./js/views/budget.js",
  "./js/views/wealth.js",
  "./js/views/settings.js",
  "./js/views/accounts.js",
  "./js/views/categories.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  // Sengaja TIDAK skipWaiting() — SW baru nunggu di state "waiting" sampe semua tab
  // ke-close, atau user trigger manual lewat tombol Hard Refresh di Setting.
  // (skipWaiting otomatis + clients.claim() + auto-reload = riskan infinite-reload-loop.)
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Firestore / Auth / API kurs → langsung network, SDK yang handle offline-nya
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseapp.com") ||
    url.hostname.includes("frankfurter.app") ||
    url.hostname.includes("google.com")
  ) return;

  // SDK Firebase (gstatic) & Chart.js (jsdelivr) → cache-first runtime
  // (setelah load pertama, app bisa full offline termasuk chart)
  if (url.hostname === "www.gstatic.com" || url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  // App shell (same-origin) → cache-first, fallback network
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(e.request, clone));
          }
          return res;
        }).catch(() => caches.match("./index.html"))
      )
    );
  }
});

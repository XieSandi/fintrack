// FinTrack — entry point
import {
  auth, googleProvider, signInWithPopup, onAuthStateChanged,
} from "./firebase.js";
import { state, on, startListeners, stopListeners, setMonth } from "./store.js";
import { seedIfNeeded, upsertSnapshot, ensurePresetCategories } from "./db.js";
import { refreshKurs, loadCachedKurs } from "./kurs.js";
import { autoRefreshIfDue } from "./prices.js";
import { monthLabel, addMonths, currentMonth, closeSheet, toast, isBlurred, applyBlurred } from "./utils.js";
import { openTxSheet } from "./tx-sheet.js";
import { checkMonthlyRitual } from "./recurring-sheet.js";

import * as homeView from "./views/home.js";
import * as txView from "./views/transactions.js";
import * as budgetView from "./views/budget.js";
import * as wealthView from "./views/wealth.js";
import * as settingsView from "./views/settings.js";
import * as accountsView from "./views/accounts.js";
import * as categoriesView from "./views/categories.js";
import * as goalsView from "./views/goals.js";
import * as recurringView from "./views/recurring.js";
import * as dangerView from "./views/danger.js";

const $ = (s) => document.querySelector(s);

const ROUTES = {
  home:         { view: homeView,       title: "FinTrack",  month: false, nav: "home" },
  transactions: { view: txView,         title: "History",   month: true,  nav: "transactions" },
  wealth:       { view: wealthView,     title: "Assets",    month: false, nav: "wealth" },
  settings:     { view: settingsView,   title: "Setting",   month: false, nav: "settings" },
  accounts:     { view: accountsView,   title: "Akun",      month: false, nav: "settings", back: "#/settings" },
  categories:   { view: categoriesView, title: "Kategori",  month: false, nav: "settings", back: "#/settings" },
  budget:       { view: budgetView,     title: "Budget",    month: true,  nav: "settings", back: "#/settings" },
  goals:        { view: goalsView,      title: "Short Term Goals", month: false, nav: "settings", back: "#/settings" },
  recurring:    { view: recurringView,  title: "Transaksi Berulang", month: false, nav: "settings", back: "#/settings" },
  danger:       { view: dangerView,     title: "Reset Data", month: false, nav: "settings", back: "#/settings" },
};

let currentRoute = "home";
let snapshotDone = false;
let categoriesEnsured = false;
let ritualChecked = false;

// Terapkan preferensi blur (persist per device) sebelum render pertama
applyBlurred(isBlurred());

// ================= Router =================
function routeFromHash() {
  const r = (location.hash || "#/home").replace("#/", "").split("?")[0];
  return ROUTES[r] ? r : "home";
}

function renderRoute() {
  currentRoute = routeFromHash();
  const cfg = ROUTES[currentRoute];
  $("#header-title").textContent = cfg.title;
  $("#month-btn").classList.toggle("hidden", !cfg.month);
  $("#month-label").textContent = monthLabel(state.month);

  const backBtn = $("#back-btn");
  backBtn.classList.toggle("hidden", !cfg.back);
  backBtn.onclick = cfg.back ? () => { location.hash = cfg.back; } : null;

  document.querySelectorAll(".bottomnav a").forEach((a) => {
    a.classList.toggle("active", a.dataset.route === cfg.nav);
  });

  if (!state.ready) {
    $("#view").innerHTML = `<div class="empty">Memuat data...</div>`;
    return;
  }
  cfg.view.render($("#view"));
}

window.addEventListener("hashchange", () => { closeSheet(); renderRoute(); });

// Re-render saat data berubah (dari listener Firestore)
on(() => renderRoute());

// ================= Month picker =================
$("#month-btn").onclick = () => {
  // cycle sederhana: klik = mundur 1 bulan, long-press ide nanti; plus tombol reset
  const el = document.createElement("div");
  el.innerHTML = `
    <div class="sheet-head"><div class="sheet-title">Pilih Bulan</div>
    <button class="sheet-close" data-close>✕</button></div>
    <div style="display:flex; align-items:center; gap:12px; justify-content:center; padding:10px 0 4px">
      <button class="btn" id="m-prev">‹</button>
      <div id="m-label" style="font-weight:800; font-size:17px; min-width:110px; text-align:center">${monthLabel(state.month)}</div>
      <button class="btn" id="m-next">›</button>
    </div>
    <button class="btn btn-block" id="m-now" style="margin-top:12px">Bulan ini</button>`;
  const sheet = document.getElementById("sheet");
  sheet.innerHTML = "";
  sheet.appendChild(el);
  sheet.classList.remove("hidden");
  document.getElementById("sheet-backdrop").classList.remove("hidden");

  let m = state.month;
  const update = () => { el.querySelector("#m-label").textContent = monthLabel(m); setMonth(m); };
  el.querySelector("#m-prev").onclick = () => { m = addMonths(m, -1); update(); };
  el.querySelector("#m-next").onclick = () => { m = addMonths(m, 1); update(); };
  el.querySelector("#m-now").onclick = () => { m = currentMonth(); update(); closeSheet(); };
  el.querySelector("[data-close]").onclick = closeSheet;
};

// ================= Global UI =================
$("#fab").onclick = () => openTxSheet(null);
$("#sheet-backdrop").onclick = closeSheet;

const syncDot = $("#sync-dot");
const updateOnline = () => {
  syncDot.classList.toggle("offline", !navigator.onLine);
  syncDot.title = navigator.onLine ? "Online — data tersinkron" : "Offline — perubahan tersimpan lokal, sync otomatis nanti";
};
window.addEventListener("online", () => { updateOnline(); toast("Online — sync jalan ✓"); refreshKurs(); });
window.addEventListener("offline", () => { updateOnline(); toast("Offline — tenang, data tetap kesimpen"); });
updateOnline();

// ================= Auth =================
const loginScreen = $("#login-screen");
const appEl = $("#app");
const loading = $("#app-loading");

$("#btn-google-login").onclick = async () => {
  const errEl = $("#login-error");
  errEl.classList.add("hidden");
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (e) {
    console.error(e);
    errEl.textContent =
      e.code === "auth/unauthorized-domain"
        ? "Domain ini belum terdaftar di Firebase Auth → Authorized domains."
        : "Login gagal: " + (e.message || e.code);
    errEl.classList.remove("hidden");
  }
};

onAuthStateChanged(auth, async (user) => {
  loading.classList.add("hidden");
  if (user) {
    loginScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    startListeners(user.uid);
    loadCachedKurs();
    refreshKurs();
    try { await seedIfNeeded(); } catch (e) { console.warn("seed:", e); }
    renderRoute();
  } else {
    stopListeners();
    appEl.classList.add("hidden");
    loginScreen.classList.remove("hidden");
    snapshotDone = false;
    categoriesEnsured = false;
    ritualChecked = false;
  }
});

// Kategori preset Reconcile: sekali per sesi, ga perlu nunggu online (Firestore
// offline persistence yang antre write-nya kalau lagi offline)
on(() => {
  if (state.ready && !categoriesEnsured && state.uid) {
    categoriesEnsured = true;
    ensurePresetCategories().catch((e) => console.warn("ensureCategories:", e));
  }
});

// Sheet "Awal Bulan" (recurring due + copy budget): sekali per sesi juga, ga perlu
// online — posting-nya di-queue offline persistence kayak transaksi manual biasa.
on(() => {
  if (state.ready && !ritualChecked && state.uid) {
    ritualChecked = true;
    try { checkMonthlyRitual(); } catch (e) { console.warn("ritual:", e); }
  }
});

// Snapshot bulanan + auto price refresh: sekali per sesi, setelah data ready & online
on(() => {
  if (state.ready && !snapshotDone && navigator.onLine && state.uid) {
    snapshotDone = true;
    // Refresh harga dulu (kalau due), baru snapshot — biar snapshot pakai harga terbaru
    autoRefreshIfDue()
      .catch((e) => console.warn("autoprice:", e))
      .finally(() => upsertSnapshot().catch((e) => console.warn("snapshot:", e)));
  }
});

// ================= PWA =================
// Update SW: sw.js baru masuk state "waiting", dan app nampilin banner "Versi baru siap".
// Activate + reload CUMA jalan kalau USER nge-tap tombolnya — JANGAN pernah dibikin otomatis:
// auto-skipWaiting + auto-reload on controllerchange itu yang dulu bikin infinite-reload-loop
// (lihat DECISIONS.md). Kunci anti-loop-nya `userAccepted`: handler controllerchange di bawah
// diam aja kalau flag itu false, jadi reload MUSTAHIL kejadian tanpa tap.
//
// Kenapa banner ini perlu (bukan cukup ngandelin "nanti juga ke-activate sendiri"): PWA mobile
// praktis ga pernah nutup semua client-nya — di-resume dari app switcher, bukan reload — jadi SW
// lama bisa nyangkut selamanya dan user stuck di versi lama walau udah deploy. Di browser desktop
// ga kelihatan karena tab-nya beneran ke-close. Tombol Hard Refresh di Setting tetap ada sebagai
// palu darurat (unregister semua SW + hapus semua cache).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
      const bar = document.getElementById("update-bar");
      let userAccepted = false;

      const offerUpdate = (worker) => {
        // `controller` null = install PERTAMA (belum pernah ada versi lama) — itu bukan "update",
        // jangan tawarin reload buat sesuatu yang emang lagi kepasang pertama kali.
        if (!worker || !navigator.serviceWorker.controller) return;
        bar.classList.remove("hidden");
        document.getElementById("btn-update-now").onclick = () => {
          userAccepted = true;
          bar.classList.add("hidden");
          worker.postMessage({ type: "SKIP_WAITING" });
        };
      };

      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!userAccepted) return;
        userAccepted = false; // one-shot: tiap reload wajib didahului tap baru
        location.reload();
      });

      if (reg.waiting) offerUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed") offerUpdate(nw);
        });
      });

      reg.update();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update();
      });
    } catch (e) { console.warn("SW:", e); }
  });
}
// Minta persistent storage biar data offline ga di-evict browser
if (navigator.storage?.persist) navigator.storage.persist();

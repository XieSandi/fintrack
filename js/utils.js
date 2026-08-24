// ---------- Format ----------
// Plain (tanpa span.blur-num) — buat konteks non-DOM kayak generate .md/text, di mana
// blur mode ga relevan (dan HTML tag bakal ngerusak output). fmtIDR/fmtUSD/fmtMoney di
// bawah ini tetap wrapper HTML-nya buat semua pemakaian existing di view (biar blur mode
// ga regresi) — cuma reuse logic format dari sini.
export const fmtIDRPlain = (n) => `Rp ${Math.round(n || 0).toLocaleString("id-ID")}`;
export const fmtUSDPlain = (n) =>
  `$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtMoneyPlain = (n, cur = "IDR") => (cur === "USD" ? fmtUSDPlain(n) : fmtIDRPlain(n));

// Blur mode nge-mask pakai asterisk (bukan CSS filter:blur lagi) — `data-mask` diisi "*" sepanjang
// teks aslinya, CSS (body.blur-mode .blur-num::after, style.css) yang nampilinnya nutupin teks
// asli. Selalu lewat blurNum() biar mask-nya match panjang teks — JANGAN bikin span.blur-num
// manual tanpa data-mask (lihat js/views/accounts.js buat contoh pemakaian di luar fmtIDR/fmtUSD).
export const blurNum = (text) => `<span class="blur-num" data-mask="${"*".repeat(String(text).length)}">${text}</span>`;
export const fmtIDR = (n) => blurNum(fmtIDRPlain(n));
export const fmtUSD = (n) => blurNum(fmtUSDPlain(n));
export const fmtMoney = (n, cur = "IDR") => (cur === "USD" ? fmtUSD(n) : fmtIDR(n));

export const fmtNum = (n) => (n || 0).toLocaleString("id-ID");

// Angka ringkas ("2.1JT", "500rb") — dipakai tab summary Wealth + baris pace Main Milestone.
export const fmtShort = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "M";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "jt";
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + "rb";
  return String(Math.round(n));
};

// Baris pace di bawah progress bar Main Milestone (Home + Wealth, SATU tempat biar wording
// ga kepisah dua versi). Plain text (ga ada markup) — dipakai baik di DOM maupun laporan .md.
// Return null kalau ga ada apa-apa buat ditampilkan (targetDate kosong, lihat milestoneProgress()).
export function milestonePaceLine(mp) {
  if (mp.targetDatePassed) return "⚠️ Target date udah lewat, belum tercapai — pertimbangkan set ulang di Setting.";
  if (mp.neededPerMonth === undefined) return null;
  let line = `Sisa ${mp.monthsLeft} bulan · perlu ± Rp${fmtShort(mp.neededPerMonth)}/bln`;
  if (mp.avgSurplus3m !== undefined) {
    line += ` · surplus rata-rata lo Rp${fmtShort(mp.avgSurplus3m)}/bln`;
    line += mp.onTrack ? " → on track ✓" : ` → kurang ± Rp${fmtShort(mp.neededPerMonth - mp.avgSurplus3m)}/bln`;
  }
  return line;
}

// Parse "1.500.000" / "1500000" -> 1500000
export const parseAmount = (s) => {
  if (typeof s === "number") return s;
  const clean = String(s || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
};

// Live thousand-separator for inputs
export const attachThousands = (input) => {
  input.addEventListener("input", () => {
    const raw = input.value.replace(/[^\d]/g, "");
    input.value = raw ? Number(raw).toLocaleString("id-ID") : "";
  });
};

// ---------- Dates ----------
// Format Date object -> "YYYY-MM-DD" pakai komponen LOCAL device (getFullYear/getMonth/getDate),
// BUKAN toISOString() (itu UTC -- di WIB antara jam 00:00-07:00 bisa mundur satu hari kalender).
// toISOString() sendiri tetep OK buat timestamp MOMEN (createdAt, lastBackupAt, dll), cuma
// jangan dipakai buat representasi tanggal kalender.
export const toDateStr = (d) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const todayStr = () => toDateStr(new Date());
export const monthOf = (dateStr) => dateStr.slice(0, 7);
export const currentMonth = () => todayStr().slice(0, 7);

// Jam SEKARANG "HH:MM" (local time, pola sama todayStr/toDateStr — JANGAN toISOString()).
// Dipakai buat default field `time` transaksi BARU (TASK-5) — user bisa ubah manual.
export const nowTimeStr = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Fallback `time` buat transaksi yang belum punya field ini — data lama pra-fitur TASK-5, ATAU
// jalur tulis transaksi yang sengaja ga punya time picker sendiri (reconcile, dll). Dianggap
// paling awal hari itu (00:01), BUKAN "sekarang" — biar transaksi baru yang beneran dicatat hari
// yang sama SELALU muncul di atas data lama pas di-sort (lihat calc.js compareTxDateTime()).
export const DEFAULT_TX_TIME = "00:01";

// Jumlah hari di suatu bulan (month 1-indexed, kayak dayOfMonth di mana-mana).
// Dipakai buat clamp dayOfMonth template recurring (tgl 31 di bulan 30 hari, dst).
export const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

export const monthLabel = (m) => {
  const [y, mo] = m.split("-");
  const names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  return `${names[+mo - 1]} ${y}`;
};

export const addMonths = (m, delta) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const lastNMonths = (n, from = currentMonth()) => {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addMonths(from, -i));
  return out;
};

export const dateLabel = (dateStr) => {
  const d = new Date(dateStr + "T00:00:00");
  const today = todayStr();
  if (dateStr === today) return "Hari ini";
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (dateStr === toDateStr(yest)) return "Kemarin";
  return d.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
};

// ---------- Toast ----------
let toastTimer;
export const toast = (msg, ms = 2200) => {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), ms);
};

// ---------- Bottom sheet ----------
const sheetEl = () => document.getElementById("sheet");
const backdropEl = () => document.getElementById("sheet-backdrop");

export const openSheet = (html) => {
  sheetEl().innerHTML = html;
  sheetEl().classList.remove("hidden");
  backdropEl().classList.remove("hidden");
  document.body.style.overflow = "hidden";
  return sheetEl();
};

export const closeSheet = () => {
  sheetEl().classList.add("hidden");
  backdropEl().classList.add("hidden");
  sheetEl().innerHTML = "";
  document.body.style.overflow = "";
};

export const sheetHead = (title) => `
  <div class="sheet-head">
    <div class="sheet-title">${title}</div>
    <button class="sheet-close" data-close>✕</button>
  </div>`;

// ---------- Misc ----------
export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const confirmDialog = (msg) => window.confirm(msg);

// ---------- Blur mode (sembunyikan angka nominal) ----------
const BLUR_KEY = "fintrack_blur";
export const isBlurred = () => localStorage.getItem(BLUR_KEY) === "1";
export const applyBlurred = (on) => document.body.classList.toggle("blur-mode", on);
export const setBlurred = (on) => {
  localStorage.setItem(BLUR_KEY, on ? "1" : "0");
  applyBlurred(on);
};

// ---------- Hard refresh (user-triggered) ----------
// Unregister semua SW + hapus semua Cache Storage, baru reload — buat lepas dari
// versi app yang nyangkut (SW lama/cache basi) tanpa nunggu update otomatis.
export async function hardRefresh() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    console.warn("hardRefresh:", e);
  } finally {
    location.reload();
  }
}

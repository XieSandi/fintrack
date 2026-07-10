// ---------- Format ----------
export const fmtIDR = (n) =>
  `<span class="blur-num">Rp ${Math.round(n || 0).toLocaleString("id-ID")}</span>`;

export const fmtUSD = (n) =>
  `<span class="blur-num">$${(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;

export const fmtMoney = (n, cur = "IDR") => (cur === "USD" ? fmtUSD(n) : fmtIDR(n));

export const fmtNum = (n) => (n || 0).toLocaleString("id-ID");

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
export const todayStr = () => new Date().toISOString().slice(0, 10);
export const monthOf = (dateStr) => dateStr.slice(0, 7);
export const currentMonth = () => todayStr().slice(0, 7);

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
  if (dateStr === yest.toISOString().slice(0, 10)) return "Kemarin";
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

// "Awal Bulan" ritual — prompt konfirmasi buat post recurring transactions yang jatuh
// tempo, plus opsi salin budget bulan lalu. Dipanggil sekali per sesi dari app.js.
// JANGAN auto-post: semuanya nunggu klik "Catat Semua" dari user.
import { state, budgetsOfMonth } from "./store.js";
import { add, patch } from "./db.js";
import { copyBudgetFromLastMonth } from "./views/budget.js";
import {
  openSheet, closeSheet, sheetHead, toast, escapeHtml, fmtMoney,
  todayStr, currentMonth,
} from "./utils.js";

const DISMISS_KEY = "fintrack_recurring_dismissed_date"; // tanggal terakhir user klik "Nanti"/tutup

function lastDayOfCurrentMonth() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
}

// Tanggal transaksi = dayOfMonth template di bulan berjalan (bukan tanggal user
// konfirmasi) — recurring itu representasi kejadian riil (kost/transfer beneran
// jatuh tempo tgl segitu), jadi History-nya harus reflect tanggal aslinya, bukan
// kapan usernya sempet buka app & centang.
function dateForDay(dayOfMonth) {
  const today = new Date();
  const day = Math.min(Number(dayOfMonth) || 1, lastDayOfCurrentMonth());
  const pad = (n) => String(n).padStart(2, "0");
  return `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(day)}`;
}

function dueRecurring() {
  const today = new Date().getDate();
  const lastDay = lastDayOfCurrentMonth();
  const month = currentMonth();
  return state.recurring.filter((r) => {
    if (r.active === false) return false;
    if (r.lastPostedMonth === month) return false;
    const effectiveDay = Math.min(Number(r.dayOfMonth) || 1, lastDay);
    return effectiveDay <= today;
  });
}

export function checkMonthlyRitual() {
  const due = dueRecurring();
  if (due.length === 0) return;
  if (localStorage.getItem(DISMISS_KEY) === todayStr()) return; // udah di-"Nanti"-in hari ini
  openRitualSheet(due);
}

function openRitualSheet(due) {
  const month = currentMonth();
  const budgetEmpty = budgetsOfMonth(month).length === 0;

  const el = openSheet(`
    ${sheetHead("Awal Bulan 📅")}
    <div class="sub" style="margin-bottom:10px">${due.length} transaksi rutin udah jatuh tempo. Uncheck yang mau di-skip bulan ini.</div>
    <div id="ritual-list"></div>
    ${budgetEmpty ? `
    <label style="margin-top:14px; display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:13px; color:var(--text)">
      <input type="checkbox" id="ritual-copy-budget" style="width:auto" checked />
      Salin budget bulan lalu (budget bulan ini masih kosong)
    </label>` : ""}
    <div style="margin-top:18px; display:flex; gap:8px;">
      <button id="ritual-later" class="btn" style="flex:1">Nanti</button>
      <button id="ritual-post" class="btn btn-primary" style="flex:1">Catat Semua</button>
    </div>
  `);

  const list = el.querySelector("#ritual-list");
  due.forEach((r) => {
    const acct = state.accounts.find((a) => a.id === r.accountId);
    const label = document.createElement("label");
    label.style.cssText = "display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--border)";
    label.innerHTML = `
      <input type="checkbox" data-id="${r.id}" style="width:auto" checked />
      <div style="flex:1">
        <div style="font-size:13px; font-weight:600">${escapeHtml(r.name)}</div>
        <div class="sub">tgl ${r.dayOfMonth} · ${escapeHtml(acct?.name || "?")}</div>
      </div>
      <div style="font-size:13px; font-weight:700">${fmtMoney(r.amount, acct?.currency)}</div>`;
    list.appendChild(label);
  });

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, todayStr());
    closeSheet();
  };
  el.querySelector("[data-close]").onclick = dismiss;
  el.querySelector("#ritual-later").onclick = dismiss;

  el.querySelector("#ritual-post").onclick = async () => {
    const toPost = due.filter((r) => el.querySelector(`[data-id="${r.id}"]`).checked);
    const doCopyBudget = budgetEmpty && !!el.querySelector("#ritual-copy-budget")?.checked;
    closeSheet();

    for (const r of toPost) {
      const date = dateForDay(r.dayOfMonth);
      await add("transactions", {
        type: r.type, amount: r.amount, date, month: date.slice(0, 7),
        accountId: r.accountId,
        toAccountId: r.type === "transfer" ? r.toAccountId : null,
        categoryId: r.type === "transfer" ? null : r.categoryId,
        note: r.name,
      });
      await patch("recurring", r.id, { lastPostedMonth: month });
    }

    let msg = toPost.length > 0 ? `${toPost.length} transaksi tercatat ✓` : "Ga ada transaksi yang dicatat";
    if (doCopyBudget) {
      const { copied } = await copyBudgetFromLastMonth(month);
      if (copied > 0) msg += ` · ${copied} budget disalin`;
    }
    toast(msg);
  };
}

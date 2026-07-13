import { state, activeAccounts, goalSavedIDR, effectiveRate } from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtNum, fmtMoney, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, monthLabel, todayStr, monthOf,
} from "../utils.js";

const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

export function render(root) {
  const goals = state.goals.slice().sort((a, b) => (a.targetAmount || 0) - (b.targetAmount || 0));

  root.innerHTML = `
    <div class="card">
      <div class="card-title">🎯 Short Term Goals</div>
      <div class="sub" style="margin-bottom:4px">Target jangka pendek yang bisa lebih dari satu — beda dari Main Milestone (satu angka besar di Setting). Sistem topup: transfer saldo dari akun ke goal buat nabung. Uang yang udah ke-topup tetep dihitung sebagai bagian net worth lo (masuk kategori assets).</div>
      <div id="goal-list"></div>
      ${goals.length === 0 ? `<div class="empty">Belum ada goals.<br/>Tap tombol di bawah buat bikin target pertama.</div>` : ""}
    </div>
    <button id="btn-add-goal" class="btn btn-primary btn-block">＋ Tambah Goal</button>
  `;

  const list = root.querySelector("#goal-list");
  goals.forEach((g) => {
    const target = Number(g.targetAmount) || 0;
    const saved = goalSavedIDR(g.id);
    const hasHistory = state.transactions.some((t) => t.toGoalId === g.id || t.fromGoalId === g.id);
    const isDone = saved <= 0 && hasHistory;
    const pct = target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : 0;
    const cls = pct >= 100 ? "p-green" : pct >= 50 ? "p-yellow" : "p-red";
    const div = document.createElement("div");
    div.className = "budget-item";
    div.innerHTML = `
      <div class="budget-top">
        <span class="budget-name" style="color:${g.color || "#60a5fa"}">● ${escapeHtml(g.name)}</span>
        <span class="budget-nums">${isDone ? "Selesai 🎉" : `${pct.toFixed(0)}%`}</span>
      </div>
      <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      <div class="sub" style="display:flex; justify-content:space-between; align-items:center">
        <span>${fmtIDR(saved)} / ${fmtIDR(target)}${g.targetDate ? ` · target ${monthLabel(g.targetDate)}` : ""}</span>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="btn btn-sm" data-topup style="flex:1">💰 Topup</button>
        ${saved > 0 ? `<button class="btn btn-sm" data-withdraw style="flex:1">💸 Cairkan</button>` : ""}
        <button class="btn btn-sm" data-edit style="flex:1">✎ Edit</button>
      </div>`;
    div.querySelector("[data-topup]").onclick = () => openTopupSheet(g);
    div.querySelector("[data-withdraw]")?.addEventListener("click", () => openWithdrawSheet(g));
    div.querySelector("[data-edit]").onclick = () => openGoalSheet(g);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-goal").onclick = () => openGoalSheet(null);
}

function openGoalSheet(existing) {
  const g = existing || { name: "", targetAmount: "", targetDate: "", color: COLORS[state.goals.length % COLORS.length] };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Goal" : "Tambah Goal")}
    <label>Nama Goal</label>
    <input id="g-name" placeholder="cth: Dana Darurat, DP Rumah, Net Worth 2028" value="${escapeHtml(g.name)}" />
    <label>Target (Rp)</label>
    <input id="g-target" inputmode="numeric" placeholder="0" value="${g.targetAmount ? fmtNum(g.targetAmount) : ""}" />
    <label>Target bulan (opsional)</label>
    <input id="g-date" type="month" value="${g.targetDate || ""}" />
    <label>Warna</label>
    <div style="display:flex; gap:8px; margin-top:4px">
      ${COLORS.map((c) => `<span class="color-dot" data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === g.color ? "#fff" : "transparent"}"></span>`).join("")}
    </div>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="g-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="g-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  attachThousands(el.querySelector("#g-target"));
  el.querySelector("[data-close]").onclick = closeSheet;

  let color = g.color;
  el.querySelectorAll(".color-dot").forEach((dot) => {
    dot.onclick = () => {
      color = dot.dataset.color;
      el.querySelectorAll(".color-dot").forEach((d) => (d.style.border = "2px solid transparent"));
      dot.style.border = "2px solid #fff";
    };
  });

  el.querySelector("#g-save").onclick = async () => {
    const data = {
      name: el.querySelector("#g-name").value.trim(),
      targetAmount: parseAmount(el.querySelector("#g-target").value),
      targetDate: el.querySelector("#g-date").value || null,
      color,
    };
    if (!data.name) return toast("Isi nama goal");
    if (!data.targetAmount) return toast("Isi target nominal");
    closeSheet();
    if (existing) await patch("goals", existing.id, data);
    else await add("goals", data);
    toast("Goal disimpan ✓");
  };

  if (existing) {
    el.querySelector("#g-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.toGoalId === existing.id || t.fromGoalId === existing.id);
      if (used) return toast("Goal ini punya riwayat topup/pencairan — hapus dulu transaksinya di History, baru hapus goal-nya");
      if (!confirmDialog("Hapus goal ini?")) return;
      closeSheet();
      await remove("goals", existing.id);
      toast("Dihapus");
    };
  }
}

// ================= Topup =================
// Topup = transfer keluar dari akun ke goal (bukan expense). existingTx dipakai
// buat edit topup yang udah ada (dibuka dari klik item di History/Transaksi terakhir).
export function openTopupSheet(goal, existingTx = null) {
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const t = existingTx || { accountId: accounts[0].id, amount: "", date: todayStr(), note: "" };

  const el = openSheet(`
    ${sheetHead(existingTx ? "Edit Topup" : `Topup: ${escapeHtml(goal.name)}`)}
    <input id="tp-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${t.amount ? fmtNum(t.amount) : ""}" autocomplete="off" />
    <label>Dari Akun</label>
    <select id="tp-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <label>Tanggal</label>
    <input id="tp-date" type="date" value="${t.date || todayStr()}" />
    <label>Catatan (opsional)</label>
    <input id="tp-note" type="text" placeholder="cth: gajian bulan ini" value="${escapeHtml(t.note || "")}" />
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existingTx ? `<button id="tp-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="tp-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  const amountInput = el.querySelector("#tp-amount");
  attachThousands(amountInput);
  if (!existingTx) setTimeout(() => amountInput.focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#tp-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const date = el.querySelector("#tp-date").value;
    const accountId = el.querySelector("#tp-account").value;
    const note = el.querySelector("#tp-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal topup");
    if (!date) return toast("Tanggal belum diisi");

    const data = {
      type: "transfer", amount, date, month: monthOf(date),
      accountId, toAccountId: null, toGoalId: goal.id,
      categoryId: null, note: note || `Topup: ${goal.name}`,
    };
    closeSheet();
    if (existingTx) await patch("transactions", existingTx.id, data);
    else await add("transactions", data);
    toast("Topup tersimpan ✓");
  };

  if (existingTx) {
    el.querySelector("#tp-delete").onclick = async () => {
      if (!confirmDialog("Hapus topup ini? Saldo akun & goal bakal disesuaikan lagi.")) return;
      closeSheet();
      await remove("transactions", existingTx.id);
      toast("Dihapus");
    };
  }
}

// ================= Pencairan (withdraw) =================
// Kebalikan topup: transfer keluar dari goal ke akun (fromGoalId, bukan toGoalId).
// accountId di transaksi ini = akun TUJUAN (di-kredit) — beda peran dari topup, tapi
// field-nya sama biar accountBalances() & filter akun di History tetap kerja generik.
export function openWithdrawSheet(goal, existingTx = null) {
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const rate = effectiveRate();
  const savedIDR = goalSavedIDR(goal.id);
  // Kalau lagi edit pencairan existing, saldo yang "tersedia" buat divalidasi harus
  // nambahin balik nominal lama-nya (yang udah kepotong di savedIDR di atas).
  const oldAcct = existingTx ? state.accounts.find((a) => a.id === existingTx.accountId) : null;
  const oldAmountIDR = existingTx ? (oldAcct?.currency === "USD" ? existingTx.amount * rate : existingTx.amount) : 0;
  const availableIDR = savedIDR + oldAmountIDR;

  if (!existingTx && availableIDR <= 0) return toast("Goal ini belum punya saldo buat dicairkan");

  const t = existingTx || { accountId: accounts[0].id, amount: "", date: todayStr(), note: "" };

  const el = openSheet(`
    ${sheetHead(existingTx ? "Edit Pencairan" : `Cairkan: ${escapeHtml(goal.name)}`)}
    <input id="wd-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${t.amount ? fmtNum(t.amount) : ""}" autocomplete="off" />
    <div id="wd-max" class="sub" style="margin-top:4px"></div>
    <label>Ke Akun</label>
    <select id="wd-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <label>Tanggal</label>
    <input id="wd-date" type="date" value="${t.date || todayStr()}" />
    <label>Catatan (opsional)</label>
    <input id="wd-note" type="text" placeholder="cth: butuh dana darurat" value="${escapeHtml(t.note || "")}" />
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existingTx ? `<button id="wd-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="wd-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const amountInput = el.querySelector("#wd-amount");
  const acctSelect = el.querySelector("#wd-account");
  const maxHint = el.querySelector("#wd-max");
  attachThousands(amountInput);

  const maxInCurrency = () => {
    const acct = state.accounts.find((a) => a.id === acctSelect.value);
    return acct?.currency === "USD" ? availableIDR / rate : availableIDR;
  };
  const updateMaxHint = () => {
    const acct = state.accounts.find((a) => a.id === acctSelect.value);
    maxHint.innerHTML = `Maks bisa dicairkan: ${fmtMoney(Math.max(0, Math.round(maxInCurrency())), acct?.currency)}`;
  };
  acctSelect.onchange = () => {
    updateMaxHint();
    if (!existingTx) amountInput.value = fmtNum(Math.max(0, Math.round(maxInCurrency())));
  };
  updateMaxHint();
  if (!existingTx) amountInput.value = fmtNum(Math.max(0, Math.round(maxInCurrency())));
  if (!existingTx) setTimeout(() => amountInput.focus(), 250);

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#wd-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const date = el.querySelector("#wd-date").value;
    const accountId = acctSelect.value;
    const note = el.querySelector("#wd-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal pencairan");
    if (!date) return toast("Tanggal belum diisi");
    if (amount > maxInCurrency() + 0.5) return toast("Nominal ngelebihin saldo goal");

    const data = {
      type: "transfer", amount, date, month: monthOf(date),
      accountId, toAccountId: null, fromGoalId: goal.id,
      categoryId: null, note: note || `Pencairan: ${goal.name}`,
    };
    closeSheet();
    if (existingTx) await patch("transactions", existingTx.id, data);
    else await add("transactions", data);
    toast("Pencairan tersimpan ✓");
  };

  if (existingTx) {
    el.querySelector("#wd-delete").onclick = async () => {
      if (!confirmDialog("Hapus pencairan ini? Saldo akun & goal bakal disesuaikan lagi.")) return;
      closeSheet();
      await remove("transactions", existingTx.id);
      toast("Dihapus");
    };
  }
}

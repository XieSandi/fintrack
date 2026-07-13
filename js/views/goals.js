import { state, activeAccounts, goalSavedIDR } from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtNum, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, monthLabel, todayStr, monthOf,
} from "../utils.js";

const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

export function render(root) {
  const goals = state.goals.slice().sort((a, b) => (a.targetAmount || 0) - (b.targetAmount || 0));

  root.innerHTML = `
    <div class="card">
      <div class="card-title">Goals / Target</div>
      <div class="sub" style="margin-bottom:4px">Sistem topup: transfer saldo dari akun ke goal buat nabung. Uang yang udah ke-topup tetep dihitung sebagai bagian net worth lo (masuk kategori assets).</div>
      <div id="goal-list"></div>
      ${goals.length === 0 ? `<div class="empty">Belum ada goals.<br/>Tap tombol di bawah buat bikin target pertama.</div>` : ""}
    </div>
    <button id="btn-add-goal" class="btn btn-primary btn-block">＋ Tambah Goal</button>
  `;

  const list = root.querySelector("#goal-list");
  goals.forEach((g) => {
    const target = Number(g.targetAmount) || 0;
    const saved = goalSavedIDR(g.id);
    const pct = target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : 0;
    const cls = pct >= 100 ? "p-green" : pct >= 50 ? "p-yellow" : "p-red";
    const div = document.createElement("div");
    div.className = "budget-item";
    div.innerHTML = `
      <div class="budget-top">
        <span class="budget-name" style="color:${g.color || "#60a5fa"}">● ${escapeHtml(g.name)}</span>
        <span class="budget-nums">${pct.toFixed(0)}%</span>
      </div>
      <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      <div class="sub" style="display:flex; justify-content:space-between; align-items:center">
        <span>${fmtIDR(saved)} / ${fmtIDR(target)}${g.targetDate ? ` · target ${monthLabel(g.targetDate)}` : ""}</span>
      </div>
      <div style="margin-top:8px; display:flex; gap:8px;">
        <button class="btn btn-sm" data-topup style="flex:1">💰 Topup</button>
        <button class="btn btn-sm" data-edit style="flex:1">✎ Edit</button>
      </div>`;
    div.querySelector("[data-topup]").onclick = () => openTopupSheet(g);
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
      const used = state.transactions.some((t) => t.toGoalId === existing.id);
      if (used) return toast("Goal ini punya topup — hapus dulu topup-nya di History, baru hapus goal-nya");
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

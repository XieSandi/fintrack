import { state, activeAccounts } from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtNum, fmtMoney, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, daysInMonth,
} from "../utils.js";
import { brokenReason } from "../recurring-sheet.js";

export function render(root) {
  const items = state.recurring.slice().sort((a, b) => (a.dayOfMonth || 1) - (b.dayOfMonth || 1));
  root.innerHTML = `
    <div class="card">
      <div class="card-title">Transaksi Berulang</div>
      <div class="sub" style="margin-bottom:4px">Template kost, transfer bulanan, dll. Pas app dibuka dan tanggalnya udah lewat, muncul sheet konfirmasi "Awal Bulan" — ga bakal auto-post tanpa lo cek dulu.</div>
      <div id="rc-list"></div>
      ${items.length === 0 ? `<div class="empty">Belum ada template.<br/>Tap tombol di bawah buat bikin yang pertama.</div>` : ""}
    </div>
    <button id="btn-add-rc" class="btn btn-primary btn-block">＋ Tambah Recurring</button>
  `;

  const list = root.querySelector("#rc-list");
  const today = new Date();
  const lastDay = daysInMonth(today.getFullYear(), today.getMonth() + 1);
  items.forEach((r) => {
    const acct = state.accounts.find((a) => a.id === r.accountId);
    const div = document.createElement("div");
    div.className = "list-item";
    const typeLabel = r.type === "expense" ? "Expense" : r.type === "income" ? "Income" : "Transfer";
    const effectiveDay = Math.min(Number(r.dayOfMonth) || 1, lastDay);
    const dayLabel = effectiveDay !== Number(r.dayOfMonth) ? `tgl ${r.dayOfMonth} (bulan ini efektif tgl ${effectiveDay})` : `tgl ${r.dayOfMonth}`;
    const reason = brokenReason(r);
    div.innerHTML = `
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escapeHtml(r.name)} ${r.active === false ? '<span class="badge badge-yellow">nonaktif</span>' : ""} ${reason ? '<span class="badge badge-red">⚠️ akun/kategori invalid</span>' : ""}</div>
        <div class="set-sub">${dayLabel} · ${typeLabel} · ${fmtMoney(r.amount, acct?.currency)} · ${escapeHtml(acct?.name || "?")}</div>
        ${reason ? `<div class="stale-note" style="color:var(--yellow)">⚠️ ${reason}</div>` : ""}
      </div>
      <span style="color:var(--muted)">›</span>`;
    div.onclick = () => openRecurringSheet(r);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-rc").onclick = () => openRecurringSheet(null);
}

function openRecurringSheet(existing) {
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const r = existing || {
    name: "", type: "expense", amount: "", accountId: accounts[0].id,
    toAccountId: accounts[1]?.id || accounts[0].id, categoryId: "", debtId: "",
    dayOfMonth: 1, active: true,
  };
  let type = r.type;
  let categoryId = r.categoryId;

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Recurring" : "Tambah Recurring")}
    <label>Nama</label>
    <input id="rc-name" placeholder="cth: Kost, Transfer Ortu" value="${escapeHtml(r.name)}" />

    <div class="type-toggle">
      <button data-type="expense" class="t-expense">Expense</button>
      <button data-type="income" class="t-income">Income</button>
      <button data-type="transfer" class="t-transfer">Transfer</button>
    </div>

    <label>Nominal</label>
    <input id="rc-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${r.amount ? fmtNum(r.amount) : ""}" autocomplete="off" />

    <div id="cat-section">
      <label>Kategori</label>
      <div id="cat-grid" class="cat-grid"></div>
    </div>

    <div id="acct-section">
      <label id="acct-label">Akun</label>
      <select id="rc-account">
        ${accounts.map((a) => `<option value="${a.id}" ${a.id === r.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
      </select>
      <div id="to-acct-wrap" class="hidden">
        <label>Ke Akun</label>
        <select id="rc-to-account">
          ${accounts.map((a) => `<option value="${a.id}" ${a.id === r.toAccountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
        </select>
      </div>
    </div>

    ${state.debts.length > 0 ? `
    <div id="debt-section" class="hidden">
      <label>Potong hutang? (opsional)</label>
      <select id="rc-debt">
        <option value="">— Ga terkait hutang —</option>
        ${state.debts.map((d) => `<option value="${d.id}" ${d.id === (r.debtId || "") ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
      </select>
    </div>` : ""}

    <label>Tanggal tiap bulan</label>
    <input id="rc-day" type="number" inputmode="numeric" min="1" max="31" value="${r.dayOfMonth || 1}" />

    <label style="margin-top:14px; display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:14px; color:var(--text)">
      <input type="checkbox" id="rc-active" style="width:auto" ${r.active !== false ? "checked" : ""}/> Aktif
    </label>

    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="rc-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="rc-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  attachThousands(el.querySelector("#rc-amount"));
  el.querySelector("[data-close]").onclick = closeSheet;

  const renderTypeButtons = () => {
    el.querySelectorAll(".type-toggle button").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === type);
    });
    el.querySelector("#cat-section").classList.toggle("hidden", type === "transfer");
    el.querySelector("#to-acct-wrap").classList.toggle("hidden", type !== "transfer");
    el.querySelector("#debt-section")?.classList.toggle("hidden", type !== "expense");
    el.querySelector("#acct-label").textContent = type === "transfer" ? "Dari Akun" : "Akun";
    renderCatGrid();
  };
  const renderCatGrid = () => {
    const cats = state.categories.filter((c) => c.type === type);
    if (type !== "transfer" && !cats.find((c) => c.id === categoryId)) categoryId = cats[0]?.id || "";
    el.querySelector("#cat-grid").innerHTML = cats.map((c) => `
      <div class="cat-cell ${c.id === categoryId ? "active" : ""}" data-cat="${c.id}">
        <span class="em">${c.icon || "📦"}</span><span>${escapeHtml(c.name)}</span>
      </div>`).join("");
    el.querySelectorAll("[data-cat]").forEach((cell) => {
      cell.onclick = () => { categoryId = cell.dataset.cat; renderCatGrid(); };
    });
  };
  el.querySelectorAll(".type-toggle button").forEach((b) => {
    b.onclick = () => { type = b.dataset.type; renderTypeButtons(); };
  });
  renderTypeButtons();

  el.querySelector("#rc-save").onclick = async () => {
    const name = el.querySelector("#rc-name").value.trim();
    const amount = parseAmount(el.querySelector("#rc-amount").value);
    const accountId = el.querySelector("#rc-account").value;
    const toAccountId = el.querySelector("#rc-to-account").value;
    const dayOfMonth = Math.min(31, Math.max(1, Number(el.querySelector("#rc-day").value) || 1));
    const active = el.querySelector("#rc-active").checked;

    if (!name) return toast("Isi nama recurring");
    if (!amount || amount <= 0) return toast("Isi nominal");
    if (type !== "transfer" && !categoryId) return toast("Pilih kategori");
    if (type === "transfer" && accountId === toAccountId) return toast("Akun asal & tujuan sama");

    const data = {
      name, type, amount, accountId, dayOfMonth, active,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId,
      debtId: type === "expense" ? (el.querySelector("#rc-debt")?.value || null) : null,
    };
    // Pertahankan lastPostedMonth pas edit — kalau bulan ini udah pernah di-post,
    // ubah nama/nominal doang ga boleh bikin sheet Awal Bulan muncul lagi & dobel post.
    data.lastPostedMonth = existing ? (existing.lastPostedMonth || null) : null;

    closeSheet();
    if (existing) await patch("recurring", existing.id, data);
    else await add("recurring", data);
    toast("Recurring disimpan ✓");
  };

  if (existing) {
    el.querySelector("#rc-delete").onclick = async () => {
      if (!confirmDialog("Hapus template recurring ini? Transaksi yang udah pernah ke-post ga ikut kehapus.")) return;
      closeSheet();
      await remove("recurring", existing.id);
      toast("Dihapus");
    };
  }
}

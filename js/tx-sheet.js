// Bottom sheet tambah / edit transaksi — quick add flow.
import { state, activeAccounts } from "./store.js";
import { add, patch, remove } from "./db.js";
import {
  openSheet, closeSheet, sheetHead, toast, escapeHtml,
  parseAmount, attachThousands, todayStr, monthOf, confirmDialog, fmtNum,
} from "./utils.js";

const LAST_KEY = "fintrack_last_input"; // {accountId, categoryId}

export function openTxSheet(existing = null) {
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }

  const last = JSON.parse(localStorage.getItem(LAST_KEY) || "{}");
  const tx = existing || {
    type: "expense",
    amount: "",
    date: todayStr(),
    accountId: last.accountId || accounts[0].id,
    toAccountId: accounts[1]?.id || accounts[0].id,
    categoryId: last.categoryId || "",
    note: "",
  };
  let type = tx.type;
  let categoryId = tx.categoryId;

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Transaksi" : "Tambah Transaksi")}
    <input id="tx-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${tx.amount ? fmtNum(tx.amount) : ""}" autocomplete="off" />

    <div class="type-toggle">
      <button data-type="expense" class="t-expense">Expense</button>
      <button data-type="income" class="t-income">Income</button>
      <button data-type="transfer" class="t-transfer">Transfer</button>
    </div>

    <div id="cat-section">
      <label>Kategori</label>
      <div id="cat-grid" class="cat-grid"></div>
    </div>

    <div id="acct-section">
      <label id="acct-label">Akun</label>
      <select id="tx-account">
        ${accounts.map((a) => `<option value="${a.id}" ${a.id === tx.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
      </select>
      <div id="to-acct-wrap" class="hidden">
        <label>Ke Akun</label>
        <select id="tx-to-account">
          ${accounts.map((a) => `<option value="${a.id}" ${a.id === tx.toAccountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="row">
      <div>
        <label>Tanggal</label>
        <input id="tx-date" type="date" value="${tx.date}" />
      </div>
      <div>
        <label>Catatan (opsional)</label>
        <input id="tx-note" type="text" placeholder="cth: makan siang" value="${escapeHtml(tx.note || "")}" />
      </div>
    </div>

    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="tx-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="tx-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const amountInput = el.querySelector("#tx-amount");
  attachThousands(amountInput);
  if (!existing) setTimeout(() => amountInput.focus(), 250);

  const renderTypeButtons = () => {
    el.querySelectorAll(".type-toggle button").forEach((b) => {
      b.classList.toggle("active", b.dataset.type === type);
    });
    el.querySelector("#cat-section").classList.toggle("hidden", type === "transfer");
    el.querySelector("#to-acct-wrap").classList.toggle("hidden", type !== "transfer");
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

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#tx-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const date = el.querySelector("#tx-date").value;
    const accountId = el.querySelector("#tx-account").value;
    const toAccountId = el.querySelector("#tx-to-account").value;
    const note = el.querySelector("#tx-note").value.trim();

    if (!amount || amount <= 0) return toast("Isi nominalnya dulu");
    if (!date) return toast("Tanggal belum diisi");
    if (type !== "transfer" && !categoryId) return toast("Pilih kategori");
    if (type === "transfer" && accountId === toAccountId) return toast("Akun asal & tujuan sama");

    const data = {
      type, amount, date, month: monthOf(date),
      accountId, note,
      categoryId: type === "transfer" ? null : categoryId,
      toAccountId: type === "transfer" ? toAccountId : null,
    };

    // Simpan preferensi terakhir untuk quick-add berikutnya
    localStorage.setItem(LAST_KEY, JSON.stringify({ accountId, categoryId }));

    closeSheet();
    try {
      if (existing) { await patch("transactions", existing.id, data); toast("Transaksi diupdate ✓"); }
      else { await add("transactions", data); toast("Tersimpan ✓"); }
    } catch (e) { console.error(e); toast("Gagal menyimpan"); }
  };

  if (existing) {
    el.querySelector("#tx-delete").onclick = async () => {
      if (!confirmDialog("Hapus transaksi ini?")) return;
      closeSheet();
      await remove("transactions", existing.id);
      toast("Dihapus");
    };
  }
}

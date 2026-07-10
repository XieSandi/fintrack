import { state, activeAccounts } from "../store.js";
import { escapeHtml, dateLabel, fmtIDR } from "../utils.js";
import { txRow } from "./home.js";

// filter state persist selama sesi
const f = { account: "", category: "", type: "", search: "" };

export function render(root) {
  const month = state.month;
  const accounts = activeAccounts();
  const cats = state.categories;

  root.innerHTML = `
    <div class="filterbar">
      <select id="f-type">
        <option value="">Semua tipe</option>
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="transfer">Transfer</option>
      </select>
      <select id="f-account">
        <option value="">Semua akun</option>
        ${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join("")}
      </select>
      <select id="f-category">
        <option value="">Semua kategori</option>
        ${cats.map((c) => `<option value="${c.id}">${c.icon || ""} ${escapeHtml(c.name)}</option>`).join("")}
      </select>
    </div>
    <div class="filterbar">
      <input id="f-search" type="search" placeholder="🔍 Cari catatan..." value="${escapeHtml(f.search)}" />
    </div>
    <div id="tx-list"></div>
  `;

  root.querySelector("#f-type").value = f.type;
  root.querySelector("#f-account").value = f.account;
  root.querySelector("#f-category").value = f.category;

  const renderList = () => {
    const list = root.querySelector("#tx-list");
    list.innerHTML = "";
    const rows = state.transactions.filter((t) =>
      t.month === month &&
      (!f.type || t.type === f.type) &&
      (!f.account || t.accountId === f.account || t.toAccountId === f.account) &&
      (!f.category || t.categoryId === f.category) &&
      (!f.search || (t.note || "").toLowerCase().includes(f.search.toLowerCase()))
    );

    if (rows.length === 0) {
      list.innerHTML = `<div class="empty">Ga ada transaksi di filter/bulan ini.<br/>Ganti bulan lewat tombol di kanan atas.</div>`;
      return;
    }

    // total expense terlihat (info kecil)
    const totExp = rows.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount || 0), 0);
    const info = document.createElement("div");
    info.className = "sub";
    info.style.margin = "0 2px 4px";
    info.innerHTML = `${rows.length} transaksi · total expense ${fmtIDR(totExp)}`;
    list.appendChild(info);

    let lastDate = null;
    rows.forEach((t) => {
      if (t.date !== lastDate) {
        const h = document.createElement("div");
        h.className = "tx-group-date";
        h.textContent = dateLabel(t.date);
        list.appendChild(h);
        lastDate = t.date;
      }
      list.appendChild(txRow(t));
    });
  };

  ["f-type", "f-account", "f-category"].forEach((id) => {
    root.querySelector("#" + id).onchange = (e) => { f[id.slice(2)] = e.target.value; renderList(); };
  });
  root.querySelector("#f-search").oninput = (e) => { f.search = e.target.value; renderList(); };

  renderList();
}

import { state, accountBalances } from "../store.js";
import { add, patch, remove, upsertSnapshot } from "../db.js";
import {
  fmtNum, fmtMoney, escapeHtml, toast, openSheet, closeSheet, sheetHead, confirmDialog,
  attachThousands, parseAmount, todayStr, monthOf,
} from "../utils.js";

export const ACCT_TYPES = { bank: "Bank", ewallet: "E-Wallet", cash: "Cash", rdn: "RDN Sekuritas", broker: "Broker (Bibit/Pluang)" };
const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

export function render(root) {
  const accounts = state.accounts;
  root.innerHTML = `
    <div class="card">
      <div class="card-title">Akun / Kantong Uang</div>
      <div id="acct-list">
        ${accounts.length === 0 ? `<div class="empty">Belum ada akun.<br/>Akun = tempat uang lo (bank, e-wallet, cash, RDN, broker).</div>` : ""}
      </div>
    </div>
    <button id="btn-add-acct" class="btn btn-primary btn-block">＋ Tambah Akun</button>
  `;

  const list = root.querySelector("#acct-list");
  accounts.forEach((a) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${a.color || "#60a5fa"};flex-shrink:0"></span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escapeHtml(a.name)} ${a.isArchived ? '<span class="badge badge-yellow">arsip</span>' : ""}</div>
        <div class="set-sub">${ACCT_TYPES[a.type] || a.type} · ${a.currency} · saldo awal <span class="blur-num">${fmtNum(a.initialBalance || 0)}</span></div>
      </div>
      <span style="color:var(--muted)">›</span>`;
    div.onclick = () => openAcctSheet(a);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-acct").onclick = () => openAcctSheet(null);
}

function openAcctSheet(existing) {
  const a = existing || { name: "", type: "bank", currency: "IDR", initialBalance: "", color: COLORS[state.accounts.length % COLORS.length], isArchived: false };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Akun" : "Tambah Akun")}
    <label>Nama</label>
    <input id="ac-name" placeholder="cth: Bank Digital, BCA, Cash" value="${escapeHtml(a.name)}" />
    <div class="row">
      <div><label>Tipe</label>
        <select id="ac-type">${Object.entries(ACCT_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? "selected" : ""}>${v}</option>`).join("")}</select>
      </div>
      <div><label>Currency</label>
        <select id="ac-cur">
          <option value="IDR" ${a.currency === "IDR" ? "selected" : ""}>IDR</option>
          <option value="USD" ${a.currency === "USD" ? "selected" : ""}>USD</option>
        </select>
      </div>
    </div>
    <label>Saldo awal</label>
    <input id="ac-init" inputmode="decimal" value="${a.initialBalance !== "" ? a.initialBalance : ""}" placeholder="Saldo saat mulai pakai app" />
    <label>Warna</label>
    <div style="display:flex; gap:8px; margin-top:4px">
      ${COLORS.map((c) => `<span class="color-dot" data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === a.color ? "#fff" : "transparent"}"></span>`).join("")}
    </div>
    ${existing ? `<label style="margin-top:14px"><input type="checkbox" id="ac-arch" style="width:auto" ${a.isArchived ? "checked" : ""}/> Arsipkan akun (sembunyikan)</label>` : ""}
    ${existing ? `<button id="ac-reconcile" class="btn btn-block" style="margin-top:14px">⚖️ Sesuaikan Saldo</button>` : ""}
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="ac-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="ac-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  let color = a.color;
  el.querySelectorAll(".color-dot").forEach((dot) => {
    dot.onclick = () => {
      color = dot.dataset.color;
      el.querySelectorAll(".color-dot").forEach((d) => (d.style.border = "2px solid transparent"));
      dot.style.border = "2px solid #fff";
    };
  });
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#ac-save").onclick = async () => {
    const data = {
      name: el.querySelector("#ac-name").value.trim(),
      type: el.querySelector("#ac-type").value,
      currency: el.querySelector("#ac-cur").value,
      initialBalance: parseFloat(String(el.querySelector("#ac-init").value).replace(/\./g, "").replace(",", ".")) || 0,
      color,
      isArchived: existing ? el.querySelector("#ac-arch").checked : false,
    };
    if (!data.name) return toast("Isi nama akun");
    closeSheet();
    if (existing) await patch("accounts", existing.id, data);
    else await add("accounts", data);
    toast("Akun disimpan ✓");
  };

  if (existing) {
    el.querySelector("#ac-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.accountId === existing.id || t.toAccountId === existing.id);
      if (used) return toast("Akun punya transaksi — arsipkan aja, jangan dihapus");
      if (!confirmDialog("Hapus akun ini?")) return;
      closeSheet();
      await remove("accounts", existing.id);
      toast("Dihapus");
    };
    el.querySelector("#ac-reconcile").onclick = () => openReconcileSheet(existing);
  }
}

// ================= Reconcile saldo =================
// Saldo akun TIDAK PERNAH di-overwrite — penyesuaian dicatat sebagai 1 transaksi
// adjustment (expense/income) sebesar selisihnya, biar ada audit trail di History
// dan tetap konsisten sama accountBalances() yang selalu dihitung dari jurnal.
function openReconcileSheet(account) {
  const recorded = accountBalances()[account.id] || 0;
  const isUSD = account.currency === "USD";

  const el = openSheet(`
    ${sheetHead(`Sesuaikan Saldo`)}
    <div class="sub" style="margin-bottom:10px">${escapeHtml(account.name)} · saldo tercatat: <b>${fmtMoney(recorded, account.currency)}</b></div>
    <label>Saldo aktual sekarang</label>
    <input id="rc-actual" class="amount-input" inputmode="decimal" placeholder="0" autocomplete="off" />
    <div id="rc-diff" class="sub" style="margin-top:6px; min-height:14px"></div>
    <label>Tanggal</label>
    <input id="rc-date" type="date" value="${todayStr()}" />
    <label>Catatan (opsional)</label>
    <input id="rc-note" type="text" value="Reconcile saldo" />
    <button id="rc-save" class="btn btn-primary btn-block" style="margin-top:18px">Simpan Penyesuaian</button>
  `);

  const actualInput = el.querySelector("#rc-actual");
  if (!isUSD) attachThousands(actualInput);
  setTimeout(() => actualInput.focus(), 250);

  const parseActual = () => (isUSD
    ? parseFloat(String(actualInput.value).replace(",", ".")) || 0
    : parseAmount(actualInput.value));

  const diffEl = el.querySelector("#rc-diff");
  const updateDiff = () => {
    if (!actualInput.value) { diffEl.textContent = ""; return; }
    const diff = parseActual() - recorded;
    if (diff === 0) {
      diffEl.textContent = "Saldo udah sesuai ✓";
      diffEl.style.color = "var(--muted)";
    } else if (diff < 0) {
      diffEl.innerHTML = `− ${fmtMoney(Math.abs(diff), account.currency)} → dicatat sebagai expense Penyesuaian`;
      diffEl.style.color = "var(--red)";
    } else {
      diffEl.innerHTML = `+ ${fmtMoney(diff, account.currency)} → dicatat sebagai income Penyesuaian`;
      diffEl.style.color = "var(--green)";
    }
  };
  actualInput.addEventListener("input", updateDiff);

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#rc-save").onclick = async () => {
    if (!actualInput.value) return toast("Isi saldo aktual dulu");
    const date = el.querySelector("#rc-date").value;
    if (!date) return toast("Tanggal belum diisi");
    const note = el.querySelector("#rc-note").value.trim() || "Reconcile saldo";
    const diff = parseActual() - recorded;

    if (diff === 0) {
      closeSheet();
      return toast("Saldo udah sesuai ✓");
    }

    closeSheet();
    await add("transactions", {
      type: diff < 0 ? "expense" : "income",
      amount: Math.abs(diff),
      date, month: monthOf(date),
      accountId: account.id,
      categoryId: diff < 0 ? "cat_adjust_out" : "cat_adjust_in",
      note,
    });
    await upsertSnapshot();
    toast(`Saldo disesuaikan ✓ (${diff < 0 ? "−" : "+"}${fmtMoney(Math.abs(diff), account.currency).replace(/<[^>]+>/g, "")})`);
  };
}

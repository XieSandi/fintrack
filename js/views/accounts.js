import { state, accountBalances, activeAccounts, isCreditAccount, creditUsed, creditRemaining } from "../store.js";
import { add, patch, remove, upsertSnapshot } from "../db.js";
import {
  fmtNum, fmtMoney, blurNum, escapeHtml, toast, openSheet, closeSheet, sheetHead, confirmDialog,
  attachThousands, parseAmount, todayStr, monthOf, nowTimeStr, DEFAULT_TX_TIME,
} from "../utils.js";

export const ACCT_TYPES = { bank: "Bank", ewallet: "E-Wallet", cash: "Cash", rdn: "RDN Sekuritas", broker: "Broker (Bibit/Pluang)", credit: "Kartu Kredit" };
const COLORS = ["#8bacd0", "#8fbe9f", "#d9bc7f", "#d99494", "#b09ac9", "#d3a17f", "#7fbfba"];

export function render(root) {
  const accounts = state.accounts;
  root.innerHTML = `
    <div class="card">
      <div class="card-title">Akun / Kantong Uang</div>
      <div id="acct-list">
        ${accounts.length === 0 ? `<div class="empty">Belum ada akun.</div>` : ""}
      </div>
    </div>
    <button id="btn-add-acct" class="btn btn-primary btn-block">＋ Tambah Akun</button>
  `;

  const list = root.querySelector("#acct-list");
  const bal = accountBalances();
  accounts.forEach((a) => {
    if (isCreditAccount(a)) {
      list.appendChild(creditAcctRow(a, bal));
      return;
    }
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${a.color || "#8bacd0"};flex-shrink:0"></span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escapeHtml(a.name)} ${a.isArchived ? '<span class="badge badge-yellow">arsip</span>' : ""}</div>
        <div class="set-sub">${ACCT_TYPES[a.type] || a.type} · ${a.currency} · saldo awal ${blurNum(fmtNum(a.initialBalance || 0))}</div>
      </div>
      <span style="color:var(--muted)">›</span>`;
    div.onclick = () => openAcctSheet(a);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-acct").onclick = () => openAcctSheet(null);
}

// Kartu kredit TIDAK ditampilin sebagai saldo positif/negatif biasa (bisa disangka "punya uang"
// padahal itu limit/utang) — selalu "Terpakai / Limit / Sisa" + progress bar, pola sama budget
// (`pct >= 100 ? p-red : pct >= 90 ? p-yellow : p-green`, lihat budget.js). Tombol eksplisit
// (Bayar Tagihan / Edit) dipola sama goal-item (goals.js), bukan whole-row click ke edit.
function creditAcctRow(a, bal) {
  const used = creditUsed(a, bal);
  const limit = Number(a.creditLimit) || 0;
  const remaining = creditRemaining(a, bal); // null = tanpa limit
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const cls = pct >= 100 ? "p-red" : pct >= 90 ? "p-yellow" : "p-green";
  const div = document.createElement("div");
  div.className = "budget-item";
  div.innerHTML = `
    <div class="budget-top">
      <span class="budget-name" style="color:${a.color || "#8bacd0"}">💳 ${escapeHtml(a.name)} ${a.isArchived ? '<span class="badge badge-yellow">arsip</span>' : ""}</span>
      <span class="budget-nums">${limit > 0 ? `${pct.toFixed(0)}%` : ""}</span>
    </div>
    ${limit > 0 ? `<div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>` : ""}
    <div class="sub" style="margin-top:4px">
      Terpakai ${fmtMoney(used, a.currency)}${limit > 0
        ? ` / Limit ${fmtMoney(limit, a.currency)} · sisa ${fmtMoney(Math.max(0, remaining), a.currency)}`
        : " (tanpa limit)"}
    </div>
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button class="btn btn-sm" data-pay style="flex:1">💳 Bayar Tagihan</button>
      <button class="btn btn-sm" data-edit style="flex:1">✎ Edit</button>
    </div>`;
  div.querySelector("[data-pay]").onclick = () => openPayCreditSheet(a);
  div.querySelector("[data-edit]").onclick = () => openAcctSheet(a);
  return div;
}

export function openAcctSheet(existing) {
  const a = existing || { name: "", type: "bank", currency: "IDR", initialBalance: "", creditLimit: "", color: COLORS[state.accounts.length % COLORS.length], isArchived: false };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Akun" : "Tambah Akun")}
    <label>Nama</label>
    <input id="ac-name" placeholder="cth: BCA" value="${escapeHtml(a.name)}" />
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
    <label id="ac-init-label">Saldo awal</label>
    <input id="ac-init" inputmode="decimal" value="${a.initialBalance !== "" ? a.initialBalance : ""}" placeholder="0" />
    <div class="row hidden" id="ac-credit-wrap">
      <div><label>Limit Kartu (Rp)</label>
        <input id="ac-limit" inputmode="numeric" placeholder="0 = tanpa limit" value="${a.creditLimit ? fmtNum(a.creditLimit) : ""}" />
      </div>
    </div>
    <label>Warna</label>
    <div style="display:flex; gap:8px; margin-top:4px">
      ${COLORS.map((c) => `<span class="color-dot" data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === a.color ? "#fff" : "transparent"}"></span>`).join("")}
    </div>
    ${existing ? `<label style="margin-top:14px"><input type="checkbox" id="ac-arch" style="width:auto" ${a.isArchived ? "checked" : ""}/> Arsipkan akun</label>` : ""}
    ${existing ? `<button id="ac-reconcile" class="btn btn-block" style="margin-top:14px">⚖️ Sesuaikan Saldo</button>` : ""}
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="ac-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="ac-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const typeSel = el.querySelector("#ac-type");
  const syncType = () => {
    const isCredit = typeSel.value === "credit";
    el.querySelector("#ac-credit-wrap").classList.toggle("hidden", !isCredit);
    el.querySelector("#ac-init-label").textContent = isCredit ? "Saldo awal (utang berjalan)" : "Saldo awal";
  };
  typeSel.onchange = syncType;
  syncType();
  attachThousands(el.querySelector("#ac-limit"));

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
    const isCredit = typeSel.value === "credit";
    const data = {
      name: el.querySelector("#ac-name").value.trim(),
      type: typeSel.value,
      currency: el.querySelector("#ac-cur").value,
      initialBalance: parseFloat(String(el.querySelector("#ac-init").value).replace(/\./g, "").replace(",", ".")) || 0,
      creditLimit: isCredit ? (parseAmount(el.querySelector("#ac-limit").value) || 0) : 0,
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
    <div class="row">
      <div><label>Tanggal</label><input id="rc-date" type="date" value="${todayStr()}" /></div>
      <div><label>Jam</label><input id="rc-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
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
    const time = el.querySelector("#rc-time").value || DEFAULT_TX_TIME;
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
      date, time, month: monthOf(date),
      accountId: account.id,
      categoryId: diff < 0 ? "cat_adjust_out" : "cat_adjust_in",
      note,
    });
    await upsertSnapshot();
    toast(`Saldo disesuaikan ✓ (${diff < 0 ? "−" : "+"}${fmtMoney(Math.abs(diff), account.currency).replace(/<[^>]+>/g, "")})`);
  };
}

// ================= Bayar Tagihan CC (shortcut) =================
// Transfer BIASA (accountId = sumber/cash, toAccountId = kartu) — pola SAMA persis kayak transfer
// akun-ke-akun generik (bukan jalur khusus kayak topup goal/beli asset), cuma sheet-nya pre-filled
// biar cepet. type:"transfer" otomatis TIDAK masuk monthSummary().expense (lihat calc.js).
function openPayCreditSheet(ccAccount) {
  const sources = activeAccounts().filter((a) => a.id !== ccAccount.id && !isCreditAccount(a));
  if (sources.length === 0) {
    toast("Belum ada akun cash buat sumber bayar — buat dulu akun bank/e-wallet/cash");
    return;
  }
  const bal = accountBalances();
  const used = creditUsed(ccAccount, bal);

  const el = openSheet(`
    ${sheetHead(`Bayar Tagihan: ${escapeHtml(ccAccount.name)}`)}
    <input id="pc-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${used > 0 ? fmtNum(used) : ""}" autocomplete="off" />
    <div class="sub" style="margin-top:4px">Tagihan terpakai sekarang: <b>${fmtMoney(used, ccAccount.currency)}</b></div>
    <label>Dari Akun</label>
    <select id="pc-account">
      ${sources.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="pc-date" type="date" value="${todayStr()}" /></div>
      <div><label>Jam</label><input id="pc-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
    <div style="margin-top:18px; display:flex; gap:8px;">
      <button id="pc-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const amountInput = el.querySelector("#pc-amount");
  attachThousands(amountInput);
  setTimeout(() => amountInput.focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#pc-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const accountId = el.querySelector("#pc-account").value;
    const date = el.querySelector("#pc-date").value;
    const time = el.querySelector("#pc-time").value || DEFAULT_TX_TIME;
    if (!amount || amount <= 0) return toast("Isi nominal bayarnya dulu");
    if (!date) return toast("Tanggal belum diisi");

    // Overpay TETAP boleh (saldo kartu jadi plus) — warning non-blocking, bukan blokir keras.
    const overpay = amount > used + 0.5;

    closeSheet();
    await add("transactions", {
      type: "transfer", amount, date, time, month: monthOf(date),
      accountId, toAccountId: ccAccount.id,
      categoryId: null, note: `Bayar Tagihan: ${ccAccount.name}`,
    });
    toast(overpay ? "Tersimpan ✓ — bayar lebih dari tagihan, saldo kartu jadi plus" : "Tagihan dibayar ✓");
  };
}

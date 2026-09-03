// Bottom sheet tambah / edit transaksi — quick add flow.
import { state, activeAccounts, accountBalances, acctById, isCreditAccount, creditUsed } from "./store.js";
import { add, patch, remove } from "./db.js";
import {
  openSheet, closeSheet, sheetHead, toast, escapeHtml,
  parseAmount, attachThousands, todayStr, nowTimeStr, DEFAULT_TX_TIME, monthOf, confirmDialog, fmtNum, fmtMoneyPlain,
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
    debtId: "",
    note: "",
  };
  let type = tx.type;
  let categoryId = tx.categoryId;
  // Transaksi baru default jam SEKARANG (bisa diubah). Transaksi lama yang belum punya field
  // `time` (data pra-fitur ini) default 00:01 — BUKAN "sekarang" — biar entry lama ga
  // nyerobot ke atas transaksi baru hari itu pas di-sort (lihat calc.js compareTxDateTime()).
  const timeValue = existing ? (existing.time || DEFAULT_TX_TIME) : nowTimeStr();

  // Biaya tambahan (admin transfer, parkir, dll) = transaksi expense TERPISAH ber-`feeOfTxId`,
  // BUKAN field di transaksi ini (lihat CLAUDE.md bullet `transactions`). Sheet ini cuma
  // nyediain input-nya; yang nulis dua-duanya save handler di bawah.
  // Transaksi yang DIRINYA SENDIRI biaya (`feeOfTxId` keisi) GA BOLEH punya biaya lagi —
  // hindari nesting yang bikin cascade delete & tampilan History membingungkan.
  const isFeeTx = !!existing?.feeOfTxId;
  const existingFee = existing ? state.transactions.find((t) => t.feeOfTxId === existing.id) : null;
  const expenseCats = state.categories.filter((c) => c.type === "expense");
  const feeCatDefault = existingFee?.categoryId || (expenseCats.find((c) => c.id === "cat_fee") ? "cat_fee" : expenseCats[0]?.id || "");

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

    ${state.debts.length > 0 ? `
    <div id="debt-section" class="hidden">
      <label>Potong hutang? (opsional)</label>
      <select id="tx-debt">
        <option value="">— Ga terkait hutang —</option>
        ${state.debts.map((d) => `<option value="${d.id}" ${d.id === (tx.debtId || "") ? "selected" : ""}>${escapeHtml(d.name)}</option>`).join("")}
      </select>
    </div>` : ""}

    <div class="row">
      <div>
        <label>Tanggal</label>
        <input id="tx-date" type="date" value="${tx.date}" />
      </div>
      <div>
        <label>Jam</label>
        <input id="tx-time" type="time" value="${timeValue}" />
      </div>
    </div>
    <label>Catatan (opsional)</label>
    <input id="tx-note" type="text" placeholder="cth: makan siang" value="${escapeHtml(tx.note || "")}" />

    ${isFeeTx ? "" : `
    <div id="fee-section" class="hidden">
      <label style="display:flex; align-items:center; gap:8px; margin-top:16px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--muted2)">
        <input type="checkbox" id="tx-fee-on" style="width:auto" ${existingFee ? "checked" : ""}/>
        🧾 Ada biaya tambahan (admin, parkir, dll)
      </label>
      <div id="fee-fields" class="${existingFee ? "" : "hidden"}">
        <div class="row">
          <div>
            <label>Nominal Biaya</label>
            <input id="tx-fee-amount" inputmode="numeric" placeholder="0" autocomplete="off" value="${existingFee ? fmtNum(existingFee.amount) : ""}" />
          </div>
          <div>
            <label>Kategori Biaya</label>
            <select id="tx-fee-cat">
              ${expenseCats.map((c) => `<option value="${c.id}" ${c.id === feeCatDefault ? "selected" : ""}>${c.icon || "📦"} ${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div id="fee-hint" class="sub"></div>
      </div>
    </div>`}

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
    el.querySelector("#debt-section")?.classList.toggle("hidden", type !== "expense");
    el.querySelector("#acct-label").textContent = type === "transfer" ? "Dari Akun" : "Akun";
    // Biaya tambahan cuma relevan buat expense & transfer (income ga ada konsep "biaya" yang
    // motong akun yang sama — kalau income kepotong biaya, catat aja nominal bersihnya).
    el.querySelector("#fee-section")?.classList.toggle("hidden", type === "income");
    renderCatGrid();
    updateFeeHint();
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

  // ---- Biaya tambahan ----
  const feeOn = el.querySelector("#tx-fee-on");
  const feeAmountInput = el.querySelector("#tx-fee-amount");
  const feeHint = el.querySelector("#fee-hint");
  if (feeAmountInput) attachThousands(feeAmountInput);

  function updateFeeHint() {
    if (!feeHint) return;
    if (!feeOn?.checked) { feeHint.textContent = ""; return; }
    const acct = state.accounts.find((a) => a.id === el.querySelector("#tx-account").value);
    const main = parseAmount(amountInput.value);
    const fee = parseAmount(feeAmountInput.value);
    // Insight yang beneran kepake: TOTAL yang keluar dari akun sumber. Buat transfer ini penting
    // — yang nyampe ke akun tujuan cuma nominal utama, tapi yang kepotong = utama + biaya.
    feeHint.textContent = fee > 0
      ? `Total keluar dari ${acct?.name || "akun"}: ${fmtMoneyPlain(main + fee, acct?.currency)}`
      : "";
  }
  if (feeOn) {
    feeOn.onchange = () => {
      el.querySelector("#fee-fields").classList.toggle("hidden", !feeOn.checked);
      if (feeOn.checked) setTimeout(() => feeAmountInput.focus(), 60);
      updateFeeHint();
    };
    feeAmountInput.addEventListener("input", updateFeeHint);
    amountInput.addEventListener("input", updateFeeHint);
    el.querySelector("#tx-account").addEventListener("change", updateFeeHint);
  }

  el.querySelectorAll(".type-toggle button").forEach((b) => {
    b.onclick = () => { type = b.dataset.type; renderTypeButtons(); };
  });
  renderTypeButtons();

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#tx-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const date = el.querySelector("#tx-date").value;
    const time = el.querySelector("#tx-time").value || DEFAULT_TX_TIME;
    const accountId = el.querySelector("#tx-account").value;
    const toAccountId = el.querySelector("#tx-to-account").value;
    const note = el.querySelector("#tx-note").value.trim();

    // Biaya tambahan: aktif cuma kalau checkbox nyala DAN tipenya bukan income (section-nya
    // ke-hide pas income, tapi checkbox-nya bisa aja masih ke-check dari sebelum ganti tipe).
    const feeActive = !!feeOn?.checked && type !== "income";
    const feeAmount = feeActive ? parseAmount(feeAmountInput.value) : 0;
    const feeCategoryId = el.querySelector("#tx-fee-cat")?.value || null;

    if (!amount || amount <= 0) return toast("Isi nominalnya dulu");
    if (!date) return toast("Tanggal belum diisi");
    if (type !== "transfer" && !categoryId) return toast("Pilih kategori");
    if (type === "transfer" && accountId === toAccountId) return toast("Akun asal & tujuan sama");
    if (feeActive && feeAmount <= 0) return toast("Isi nominal biayanya, atau matiin biaya tambahan");
    if (feeActive && !feeCategoryId) return toast("Pilih kategori biaya");

    const data = {
      type, amount, date, time, month: monthOf(date),
      accountId, note,
      categoryId: type === "transfer" ? null : categoryId,
      toAccountId: type === "transfer" ? toAccountId : null,
      debtId: type === "expense" ? (el.querySelector("#tx-debt")?.value || null) : null,
    };

    // Warning over-limit kartu kredit: NON-BLOCKING (tetap disimpan kalau lanjut) — dicek
    // cuma buat expense (belanja pakai CC), bukan transfer/income. "sisa" di pesan = limit yang
    // masih ada SEBELUM transaksi ini (biar user ngerti seberapa jauh dia ngelewatinnya).
    let overLimitMsg = null;
    if (type === "expense") {
      const acct = state.accounts.find((x) => x.id === accountId);
      const limit = acct && isCreditAccount(acct) ? Number(acct.creditLimit) || 0 : 0;
      if (limit > 0) {
        const bal = accountBalances();
        let currentBal = bal[accountId] || 0;
        // Lagi edit transaksi expense ber-akun SAMA -> balikin dulu efek amount LAMA-nya,
        // biar "after" yang dihitung representasi state SETELAH edit ini (ga dobel ke-apply).
        if (existing && existing.type === "expense" && existing.accountId === accountId) {
          currentBal += Number(existing.amount) || 0;
        }
        // Biaya tambahan motong akun yang SAMA, jadi ikut dihitung di sini — kalau ngga,
        // warning limit bisa meleset persis sebesar biayanya.
        if (existingFee && existingFee.accountId === accountId) {
          currentBal += Number(existingFee.amount) || 0;
        }
        const usedBefore = currentBal < 0 ? -currentBal : 0;
        const afterBal = currentBal - amount - feeAmount;
        const usedAfter = afterBal < 0 ? -afterBal : 0;
        if (usedAfter > limit) {
          overLimitMsg = `Transaksi ini melewati limit kartu (sisa ${fmtMoneyPlain(Math.max(0, limit - usedBefore), acct.currency)})`;
        }
      }
    }

    // Simpan preferensi terakhir untuk quick-add berikutnya
    localStorage.setItem(LAST_KEY, JSON.stringify({ accountId, categoryId }));

    closeSheet();
    try {
      // Biaya tambahan = transaksi expense TERPISAH ber-`feeOfTxId` (bukan field di `data`) —
      // akun & tanggal/jam ikut induknya, nominalnya berdiri sendiri. Karena dia expense biasa,
      // saldo/cashflow/budget/report otomatis kehitung tanpa perubahan di kalkulasi manapun.
      const feeData = (parentId) => ({
        type: "expense", amount: feeAmount, date, time, month: monthOf(date),
        accountId, categoryId: feeCategoryId, toAccountId: null, debtId: null,
        feeOfTxId: parentId,
        note: note ? `Biaya: ${note}` : "Biaya tambahan",
      });

      if (existing) {
        await patch("transactions", existing.id, data);
        // Sinkronin transaksi biayanya: ada→update, baru→bikin, dimatiin→hapus.
        if (feeActive && existingFee) await patch("transactions", existingFee.id, feeData(existing.id));
        else if (feeActive) await add("transactions", feeData(existing.id));
        else if (existingFee) await remove("transactions", existingFee.id);
        toast(overLimitMsg ? `Diupdate ✓ ⚠️ ${overLimitMsg}` : "Transaksi diupdate ✓", overLimitMsg ? 4500 : 2200);
      } else {
        const ref = await add("transactions", data);
        if (feeActive) await add("transactions", feeData(ref.id));
        toast(overLimitMsg ? `Tersimpan ✓ ⚠️ ${overLimitMsg}` : "Tersimpan ✓", overLimitMsg ? 4500 : 2200);
      }
    } catch (e) { console.error(e); toast("Gagal menyimpan"); }
  };

  if (existing) {
    el.querySelector("#tx-delete").onclick = async () => {
      if (!confirmDialog(existingFee
        ? `Hapus transaksi ini? Biaya tambahannya (${fmtMoneyPlain(existingFee.amount, acctById(existing.accountId)?.currency)}) ikut kehapus.`
        : "Hapus transaksi ini?")) return;
      closeSheet();
      await remove("transactions", existing.id);
      toast("Dihapus");
    };
  }
}

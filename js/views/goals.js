import { state, activeAccounts, goalSavedIDR, goalLinkedAssetsValueIDR, goalProgressIDR, assetValueIDR, effectiveRate } from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtNum, fmtMoney, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, monthLabel, todayStr, monthOf,
  nowTimeStr, DEFAULT_TX_TIME,
} from "../utils.js";

const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

// Stats tampilan SATU goal — SATU tempat, dipakai bareng goals.js (list) DAN home.js (preview)
// biar dua UI ga divergen (pola sama copyBudgetFromLastMonth()). `progress` (dipakai buat
// progress bar/persentase/angka utama) = topup standalone + nilai asset ter-link
// (`goalProgressIDR()`).
// KEPUTUSAN (TASK-2, 2026-08, riwayat lengkap: DECISIONS.md): progress bar/pct/angka utama
// SENGAJA (tunai + aset) — bukan tunai doang — karena buat goal yang memang di-fund via asset
// (mis. Dana Pensiun via reksadana), (tunai+aset) itu representasi progress yang lebih masuk
// akal daripada tunai doang. TAPI ini WAJIB dibarengi breakdown eksplisit `saved` (tunai) vs
// `linkedValue` (aset) di tampilan — JANGAN pernah nampilin `progress` gabungan sendirian tanpa
// rincian, karena sebagian dari situ (linkedValue) BUKAN tunai yang bisa langsung dicairkan
// (naik-turun ngikutin harga pasar pula) — itu akar penyebab bug TASK-2 (Home/goals.js/report
// nampilin satu angka gabungan yang keliatan kontradiksi sama "Goal savings" net worth di section
// 1, yang SENGAJA cuma tunai). Field `saved`/`linkedValue` di return object di bawah ini itu
// SUMBER breakdown-nya — caller (goals.js render, home.js) WAJIB pakai keduanya, bukan cuma
// `progress`.
// SENGAJA GA ADA status "Selesai 🎉" lagi (sempat ada, dihapus) — sebelum ada linking, "pot
// topup abis" (`saved <= 0`) itu sinyal yang cukup jelas. Begitu goal bisa punya asset ter-link,
// sinyal "selesai" yang benar jadi ambigu (pot topup abis ≠ progress gabungan capai target,
// linkedValue bisa naik-turun ngikutin harga pasar kapan aja) dan sempat kejadian salah nunjukin
// "Selesai" padahal progress-nya jauh dari 100%. Daripada terus nambal kasus edge yang muncul,
// badge-nya dihapus — persentase polos (`pct`) udah cukup jelas nunjukin progress tanpa klaim
// "selesai" yang berisiko salah.
export function goalDisplayStats(g) {
  const target = Number(g.targetAmount) || 0;
  const saved = goalSavedIDR(g.id);
  const linkedValue = goalLinkedAssetsValueIDR(g.id);
  const progress = saved + linkedValue;
  const pct = target > 0 ? Math.max(0, Math.min(100, (progress / target) * 100)) : 0;
  const cls = pct >= 100 ? "p-green" : pct >= 50 ? "p-yellow" : "p-red";
  return { target, saved, linkedValue, progress, pct, cls };
}

// Goal diarsip TETAP nongol di halaman ini (pola sama accounts.js — flat list + badge, BUKAN
// disembunyiin/dipisah section) karena ini halaman kelola (`#/goals`), beda dari Home preview
// yang emang buat "declutter" (lihat `activeGoals()` di calc.js dipakai home.js). Diarsip ga
// berarti dihapus/uangnya ilang — cuma didorong ke bawah list + tombol Topup disembunyiin
// (nudge biar ga terus-terusan ditambahin kalau udah dianggap "beres").
export function render(root) {
  const goals = state.goals.slice().sort((a, b) =>
    (a.isArchived === true) - (b.isArchived === true) || (a.targetAmount || 0) - (b.targetAmount || 0)
  );

  root.innerHTML = `
    <div class="card">
      <div class="card-title">🎯 Short Term Goals</div>
      <div class="sub" style="margin-bottom:4px">Target jangka pendek yang bisa lebih dari satu — beda dari Main Milestone (satu angka besar di Setting). Sistem topup: transfer saldo dari akun ke goal buat nabung. Uang yang udah ke-topup tetep dihitung sebagai bagian net worth lo (masuk kategori assets). Bisa juga di-link ke asset yang udah ada (nilainya ikut ditampilin di progress, TANPA nambah net worth dua kali).</div>
      <div id="goal-list"></div>
      ${goals.length === 0 ? `<div class="empty">Belum ada goals.<br/>Tap tombol di bawah buat bikin target pertama.</div>` : ""}
    </div>
    <button id="btn-add-goal" class="btn btn-primary btn-block">＋ Tambah Goal</button>
  `;

  const list = root.querySelector("#goal-list");
  goals.forEach((g) => {
    const { target, saved, linkedValue, progress, pct, cls } = goalDisplayStats(g);
    const div = document.createElement("div");
    div.className = "budget-item";
    div.innerHTML = `
      <div class="budget-top">
        <span class="budget-name" style="color:${g.color || "#60a5fa"}">● ${escapeHtml(g.name)} ${g.isArchived ? '<span class="badge badge-yellow">arsip</span>' : ""}</span>
        <span class="budget-nums">${pct.toFixed(0)}%</span>
      </div>
      <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      <div class="sub" style="display:flex; justify-content:space-between; align-items:center">
        <span>${fmtIDR(progress)} / ${fmtIDR(target)}${g.targetDate ? ` · target ${monthLabel(g.targetDate)}` : ""}</span>
      </div>
      ${linkedValue > 0 ? `
      <div class="sub">💰 Ditabung (tunai): ${fmtIDR(saved)} · 📈 Dari ${(g.linkedAssetIds || []).length} asset ter-link: ${fmtIDR(linkedValue)}</div>
      <div class="sub" style="color:var(--muted2)">⚠️ Sebagian progress dari nilai aset (naik-turun ngikutin pasar) — bukan semuanya tunai yang bisa langsung dicairkan</div>` : ""}
      <div style="margin-top:8px; display:flex; gap:8px;">
        ${g.isArchived ? "" : `<button class="btn btn-sm" data-topup style="flex:1">💰 Topup</button>`}
        ${saved > 0 ? `<button class="btn btn-sm" data-withdraw style="flex:1">💸 Cairkan</button>` : ""}
        <button class="btn btn-sm" data-edit style="flex:1">✎ Edit</button>
      </div>`;
    div.querySelector("[data-topup]")?.addEventListener("click", () => openTopupSheet(g));
    div.querySelector("[data-withdraw]")?.addEventListener("click", () => openWithdrawSheet(g));
    div.querySelector("[data-edit]").onclick = () => openGoalSheet(g);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-goal").onclick = () => openGoalSheet(null);
}

export function openGoalSheet(existing) {
  const g = existing || { name: "", targetAmount: "", targetDate: "", color: COLORS[state.goals.length % COLORS.length], linkedAssetIds: [], isArchived: false };
  const linkedIds = new Set(g.linkedAssetIds || []);
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
    ${state.assets.length > 0 ? `
    <label style="margin-top:14px">Asset ter-link (opsional)</label>
    <div class="sub" style="margin-bottom:6px">Nilai asset yang dipilih ikut ditampilin sebagai progress goal ini — asset-nya TETAP kehitung normal di Assets/Net Worth (BUKAN ditambah dua kali), cuma direferensiin di sini buat tracking. Boleh pilih lebih dari satu, dan satu asset boleh di-link ke lebih dari satu goal.</div>
    <div id="g-asset-list" style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto">
      ${state.assets.map((a) => `
        <label style="display:flex; align-items:center; gap:8px; font-size:13px; text-transform:none; letter-spacing:0; font-weight:400; color:var(--text)">
          <input type="checkbox" data-asset-link value="${a.id}" style="width:auto" ${linkedIds.has(a.id) ? "checked" : ""}/>
          <span style="flex:1">${escapeHtml(a.symbol || a.name)}</span>
          <span class="sub">${fmtIDR(assetValueIDR(a))}</span>
        </label>`).join("")}
    </div>` : ""}
    ${existing ? `<label style="margin-top:14px"><input type="checkbox" id="g-arch" style="width:auto" ${g.isArchived ? "checked" : ""}/> Arsipkan goal (sembunyikan dari Home, ga bisa di-topup lagi)</label>
    <div class="sub" style="margin-top:2px">Uang yang udah ke-topup TETAP kehitung di net worth — arsip cuma nyembunyiin dari tampilan sehari-hari, bukan ngapus saldo. Bisa di-un-arsip lagi kapan aja.</div>` : ""}
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
      linkedAssetIds: Array.from(el.querySelectorAll("[data-asset-link]:checked")).map((cb) => cb.value),
      isArchived: existing ? el.querySelector("#g-arch").checked : false,
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
  // Baru -> default jam sekarang. Edit transaksi lama tanpa `time` (pra-TASK-5) -> 00:01, bukan
  // "sekarang" (lihat utils.js DEFAULT_TX_TIME).
  const timeValue = existingTx ? (existingTx.time || DEFAULT_TX_TIME) : nowTimeStr();

  const el = openSheet(`
    ${sheetHead(existingTx ? "Edit Topup" : `Topup: ${escapeHtml(goal.name)}`)}
    <input id="tp-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${t.amount ? fmtNum(t.amount) : ""}" autocomplete="off" />
    <label>Dari Akun</label>
    <select id="tp-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="tp-date" type="date" value="${t.date || todayStr()}" /></div>
      <div><label>Jam</label><input id="tp-time" type="time" value="${timeValue}" /></div>
    </div>
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
    const time = el.querySelector("#tp-time").value || DEFAULT_TX_TIME;
    const accountId = el.querySelector("#tp-account").value;
    const note = el.querySelector("#tp-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal topup");
    if (!date) return toast("Tanggal belum diisi");

    const data = {
      type: "transfer", amount, date, time, month: monthOf(date),
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
  const timeValue = existingTx ? (existingTx.time || DEFAULT_TX_TIME) : nowTimeStr();

  const el = openSheet(`
    ${sheetHead(existingTx ? "Edit Pencairan" : `Cairkan: ${escapeHtml(goal.name)}`)}
    <input id="wd-amount" class="amount-input" inputmode="numeric" placeholder="0"
      value="${t.amount ? fmtNum(t.amount) : ""}" autocomplete="off" />
    <div id="wd-max" class="sub" style="margin-top:4px"></div>
    <label>Ke Akun</label>
    <select id="wd-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === t.accountId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="wd-date" type="date" value="${t.date || todayStr()}" /></div>
      <div><label>Jam</label><input id="wd-time" type="time" value="${timeValue}" /></div>
    </div>
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
    const time = el.querySelector("#wd-time").value || DEFAULT_TX_TIME;
    const accountId = acctSelect.value;
    const note = el.querySelector("#wd-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal pencairan");
    if (!date) return toast("Tanggal belum diisi");
    if (amount > maxInCurrency() + 0.5) return toast("Nominal ngelebihin saldo goal");

    const data = {
      type: "transfer", amount, date, time, month: monthOf(date),
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

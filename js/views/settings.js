import { state, activeAccounts, effectiveRate } from "../store.js";
import { add, patch, remove, exportAll, importAll, updateSettings } from "../db.js";
import { auth, signOut } from "../firebase.js";
import {
  fmtIDR, fmtNum, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, todayStr,
} from "../utils.js";

const ACCT_TYPES = { bank: "Bank", ewallet: "E-Wallet", cash: "Cash", rdn: "RDN Sekuritas", broker: "Broker (Bibit/Pluang)" };
const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

export function render(root) {
  const accounts = state.accounts;
  const lastBackup = state.settings.lastBackupAt;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 30 * 864e5;

  root.innerHTML = `
    ${backupOld ? `<div class="card" style="border-color:#a16207; background:#1c1400">
      <div style="font-size:13px">⚠️ ${lastBackup ? "Backup terakhir > 30 hari" : "Belum pernah backup"}. Export data lo sekarang biar aman.</div>
    </div>` : ""}

    <div class="card">
      <div class="card-title">Akun / Kantong Uang</div>
      <div id="acct-list">
        ${accounts.length === 0 ? `<div class="empty">Belum ada akun</div>` : ""}
      </div>
      <button id="btn-add-acct" class="btn btn-sm" style="margin-top:10px">＋ Tambah Akun</button>
    </div>

    <div class="card">
      <div class="card-title">Kategori</div>
      <div id="cat-list"></div>
      <button id="btn-add-cat" class="btn btn-sm" style="margin-top:10px">＋ Tambah Kategori</button>
    </div>

    <div class="card">
      <div class="card-title">Target & Kurs</div>
      <label>Target Net Worth (Rp)</label>
      <input id="s-target" inputmode="numeric" value="${fmtNum(state.settings.targetNetWorth || 100000000)}" />
      <label>Kurs USD/IDR manual (kosongkan = auto)</label>
      <input id="s-kurs" inputmode="numeric" placeholder="auto: ${fmtNum(state.usdIdr?.rate || 0)} ${state.usdIdr ? `(per ${state.usdIdr.date})` : ""}" value="${state.settings.usdIdrManual ? fmtNum(state.settings.usdIdrManual) : ""}" />
      <div class="sub">Kurs efektif sekarang: ${fmtNum(effectiveRate())}</div>
      <button id="btn-save-settings" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan</button>
    </div>

    <div class="card">
      <div class="card-title">Backup & Restore</div>
      <div class="sub" style="margin-bottom:10px">${lastBackup ? `Backup terakhir: ${new Date(lastBackup).toLocaleDateString("id-ID")}` : "Belum pernah backup"}</div>
      <div class="row">
        <button id="btn-export" class="btn">⬇️ Export JSON</button>
        <button id="btn-import" class="btn">⬆️ Import</button>
      </div>
      <input type="file" id="import-file" accept=".json,application/json" class="hidden" />
    </div>

    <div class="card">
      <div class="set-item">
        <div>
          <div>${escapeHtml(auth.currentUser?.displayName || "")}</div>
          <div class="set-sub">${escapeHtml(auth.currentUser?.email || "")}</div>
        </div>
        <button id="btn-logout" class="btn btn-sm btn-danger">Keluar</button>
      </div>
    </div>
    <div class="sub" style="text-align:center; margin-top:4px">FinTrack v1.0 · data lo, milik lo</div>
  `;

  // ---- Accounts ----
  const acctList = root.querySelector("#acct-list");
  accounts.forEach((a) => {
    const div = document.createElement("div");
    div.className = "list-item";
    div.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${a.color || "#60a5fa"};flex-shrink:0"></span>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escapeHtml(a.name)} ${a.isArchived ? '<span class="badge badge-yellow">arsip</span>' : ""}</div>
        <div class="set-sub">${ACCT_TYPES[a.type] || a.type} · ${a.currency} · saldo awal ${fmtNum(a.initialBalance || 0)}</div>
      </div>
      <span style="color:var(--muted)">›</span>`;
    div.onclick = () => openAcctSheet(a);
    acctList.appendChild(div);
  });
  root.querySelector("#btn-add-acct").onclick = () => openAcctSheet(null);

  // ---- Categories ----
  const catList = root.querySelector("#cat-list");
  ["expense", "income"].forEach((type) => {
    const head = document.createElement("div");
    head.className = "set-sub";
    head.style.margin = "10px 0 4px";
    head.textContent = type === "expense" ? "EXPENSE" : "INCOME";
    catList.appendChild(head);
    state.categories.filter((c) => c.type === type).forEach((c) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `<span>${c.icon || "📦"}</span><div style="flex:1;font-size:13px">${escapeHtml(c.name)}</div><span style="color:var(--muted)">›</span>`;
      div.onclick = () => openCatSheet(c);
      catList.appendChild(div);
    });
  });
  root.querySelector("#btn-add-cat").onclick = () => openCatSheet(null);

  // ---- Settings save ----
  attachThousands(root.querySelector("#s-target"));
  attachThousands(root.querySelector("#s-kurs"));
  root.querySelector("#btn-save-settings").onclick = async () => {
    const target = parseAmount(root.querySelector("#s-target").value);
    const kursManual = parseAmount(root.querySelector("#s-kurs").value);
    await updateSettings({ targetNetWorth: target || 100000000, usdIdrManual: kursManual || null });
    toast("Settings disimpan ✓");
  };

  // ---- Backup / restore ----
  root.querySelector("#btn-export").onclick = async () => {
    toast("Menyiapkan backup...");
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `fintrack-backup-${todayStr()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      await updateSettings({ lastBackupAt: new Date().toISOString() });
      toast("Backup ter-download ✓");
    } catch (e) { console.error(e); toast("Gagal export"); }
  };

  const fileInput = root.querySelector("#import-file");
  root.querySelector("#btn-import").onclick = () => fileInput.click();
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      const replace = confirmDialog(
        "Mode import:\n\nOK = REPLACE ALL (hapus semua data sekarang, ganti dengan isi file)\nCancel = MERGE (gabungkan, data dengan id sama akan ditimpa dari file)"
      );
      if (replace && !confirmDialog("Yakin REPLACE ALL? Semua data di cloud akan dihapus dulu.")) return;
      toast("Importing... jangan tutup app");
      await importAll(backup, replace ? "replace" : "merge");
      toast("Import selesai ✓");
    } catch (e) {
      console.error(e);
      toast(e.message || "File tidak valid");
    } finally { fileInput.value = ""; }
  };

  root.querySelector("#btn-logout").onclick = async () => {
    if (!confirmDialog("Keluar dari akun?")) return;
    await signOut(auth);
  };
}

// ================= Sheets =================
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
  }
}

function openCatSheet(existing) {
  const c = existing || { name: "", icon: "", type: "expense" };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Kategori" : "Tambah Kategori")}
    <div class="row">
      <div style="flex:0 0 80px"><label>Emoji</label><input id="c-icon" maxlength="4" placeholder="🍜" value="${c.icon || ""}" /></div>
      <div><label>Nama</label><input id="c-name" placeholder="cth: Kopi" value="${escapeHtml(c.name)}" /></div>
    </div>
    <label>Tipe</label>
    <select id="c-type" ${existing ? "disabled" : ""}>
      <option value="expense" ${c.type === "expense" ? "selected" : ""}>Expense</option>
      <option value="income" ${c.type === "income" ? "selected" : ""}>Income</option>
    </select>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="c-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="c-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#c-save").onclick = async () => {
    const data = {
      name: el.querySelector("#c-name").value.trim(),
      icon: el.querySelector("#c-icon").value.trim() || "📦",
      type: el.querySelector("#c-type").value,
    };
    if (!data.name) return toast("Isi nama kategori");
    closeSheet();
    if (existing) await patch("categories", existing.id, data);
    else await add("categories", { ...data, isPreset: false });
    toast("Kategori disimpan ✓");
  };

  if (existing) {
    el.querySelector("#c-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.categoryId === existing.id);
      if (used) return toast("Kategori dipakai transaksi — ga bisa dihapus");
      if (!confirmDialog("Hapus kategori ini?")) return;
      closeSheet();
      await remove("categories", existing.id);
      toast("Dihapus");
    };
  }
}

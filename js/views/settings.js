import { state, effectiveRate } from "../store.js";
import { exportAll, importAll, updateSettings } from "../db.js";
import { auth, signOut } from "../firebase.js";
import {
  fmtNum, escapeHtml, toast, parseAmount, attachThousands,
  confirmDialog, todayStr,
} from "../utils.js";

export function render(root) {
  const lastBackup = state.settings.lastBackupAt;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 30 * 864e5;
  const nAcct = state.accounts.length;
  const nCat = state.categories.length;
  const nBudget = state.budgets.filter((b) => b.month === state.month).length;

  root.innerHTML = `
    ${backupOld ? `<div class="card" style="border-color:#a16207; background:#1c1400">
      <div style="font-size:13px">⚠️ ${lastBackup ? "Backup terakhir > 30 hari" : "Belum pernah backup"}. Export data lo di bawah biar aman.</div>
    </div>` : ""}

    <div class="card" style="padding: 4px 16px;">
      <a class="menu-item" href="#/accounts">
        <span class="mi-ic">💳</span>
        <span>Akun / Kantong Uang<div class="mi-sub">${nAcct} akun</div></span>
        <span class="mi-arrow">›</span>
      </a>
      <a class="menu-item" href="#/categories">
        <span class="mi-ic">🏷️</span>
        <span>Kategori Expense & Income<div class="mi-sub">${nCat} kategori</div></span>
        <span class="mi-arrow">›</span>
      </a>
      <a class="menu-item" href="#/budget">
        <span class="mi-ic">📊</span>
        <span>Budget Bulanan<div class="mi-sub">${nBudget} budget aktif bulan ini</div></span>
        <span class="mi-arrow">›</span>
      </a>
    </div>

    <div class="card">
      <div class="card-title">Integrasi Harga (API Keys)</div>
      <div class="sub" style="margin-bottom:4px">Auto-refresh harga asset. Crypto (CoinGecko) gratis tanpa key. Key disimpan di database lo sendiri (per akun, terproteksi rules).</div>
      <label>GoAPI key — saham IDX <a href="https://goapi.io" target="_blank" rel="noopener" style="color:var(--blue)">daftar gratis ↗</a></label>
      <input id="s-goapi" type="text" autocomplete="off" placeholder="belum diisi = saham IDX manual" value="${escapeHtml(state.settings.apiKeys?.goapi || "")}" />
      <label>Finnhub key — saham/ETF US <a href="https://finnhub.io" target="_blank" rel="noopener" style="color:var(--blue)">daftar gratis ↗</a></label>
      <input id="s-finnhub" type="text" autocomplete="off" placeholder="belum diisi = saham US manual" value="${escapeHtml(state.settings.apiKeys?.finnhub || "")}" />
      <button id="btn-save-keys" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan Keys</button>
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
    <div class="sub" style="text-align:center; margin-top:4px">FinTrack v1.1 · data lo, milik lo</div>
  `;

  attachThousands(root.querySelector("#s-target"));
  attachThousands(root.querySelector("#s-kurs"));

  root.querySelector("#btn-save-keys").onclick = async () => {
    await updateSettings({
      apiKeys: {
        goapi: root.querySelector("#s-goapi").value.trim() || null,
        finnhub: root.querySelector("#s-finnhub").value.trim() || null,
      },
    });
    toast("API keys disimpan ✓ — coba 🔄 Harga di tab Assets");
  };

  root.querySelector("#btn-save-settings").onclick = async () => {
    const target = parseAmount(root.querySelector("#s-target").value);
    const kursManual = parseAmount(root.querySelector("#s-kurs").value);
    await updateSettings({ targetNetWorth: target || 100000000, usdIdrManual: kursManual || null });
    toast("Settings disimpan ✓");
  };

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

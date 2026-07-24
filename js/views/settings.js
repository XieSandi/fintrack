import { state, effectiveRate } from "../store.js";
import { exportAll, importAll, updateSettings, put } from "../db.js";
import { auth, signOut } from "../firebase.js";
import {
  fmtNum, fmtIDR, escapeHtml, toast, parseAmount, attachThousands,
  confirmDialog, todayStr, hardRefresh, currentMonth, monthLabel, addMonths,
} from "../utils.js";
import { buildMonthlyReport, availableReportMonths } from "../report-md.js";

export function render(root) {
  const lastBackup = state.settings.lastBackupAt;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 30 * 864e5;
  const nAcct = state.accounts.length;
  const nCat = state.categories.length;
  const nBudget = state.budgets.filter((b) => b.month === state.month).length;
  const nGoals = state.goals.length;
  const nRecurring = state.recurring.filter((r) => r.active !== false).length;

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
      <a class="menu-item" href="#/goals">
        <span class="mi-ic">🎯</span>
        <span>Short Term Goals<div class="mi-sub">${nGoals} goal aktif</div></span>
        <span class="mi-arrow">›</span>
      </a>
      <a class="menu-item" href="#/recurring">
        <span class="mi-ic">🔁</span>
        <span>Transaksi Berulang<div class="mi-sub">${nRecurring} template aktif</div></span>
        <span class="mi-arrow">›</span>
      </a>
    </div>

    <div class="card">
      <div class="card-title">Integrasi Harga (API Keys)</div>
      <div class="sub" style="margin-bottom:4px">Auto-refresh harga asset. Crypto (CoinGecko) gratis tanpa key. Key disimpan di database lo sendiri (per akun, terproteksi rules).</div>
      <label>iTick key — saham IDX <a href="https://itick.org" target="_blank" rel="noopener" style="color:var(--blue)">daftar gratis ↗</a></label>
      <input id="s-itick" type="text" autocomplete="off" placeholder="belum diisi = saham IDX manual" value="${escapeHtml(state.settings.apiKeys?.itick || "")}" />
      <label>Finnhub key — saham/ETF US <a href="https://finnhub.io" target="_blank" rel="noopener" style="color:var(--blue)">daftar gratis ↗</a></label>
      <input id="s-finnhub" type="text" autocomplete="off" placeholder="belum diisi = saham US manual" value="${escapeHtml(state.settings.apiKeys?.finnhub || "")}" />
      <button id="btn-save-keys" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan Keys</button>
    </div>

    <div class="card">
      <div class="card-title">🏆 Main Milestone & Kurs</div>
      <div class="sub" style="margin-bottom:4px">Main Milestone = benchmark net worth jangka panjang lo, satu angka besar (beda dari Short Term Goals yang bisa banyak & topup-based). Progress-nya otomatis dari net worth keseluruhan — muncul di card Total Balance (Home) & banner Net Worth (Assets).</div>
      <label>Target Net Worth — Main Milestone (Rp)</label>
      <input id="s-target" inputmode="numeric" value="${fmtNum(state.settings.targetNetWorth || 100000000)}" />
      <label>Kurs USD/IDR manual (kosongkan = auto)</label>
      <input id="s-kurs" inputmode="numeric" placeholder="auto: ${fmtNum(state.usdIdr?.rate || 0)} ${state.usdIdr ? `(per ${state.usdIdr.date})` : ""}" value="${state.settings.usdIdrManual ? fmtNum(state.settings.usdIdrManual) : ""}" />
      <div class="sub">Kurs efektif sekarang: ${fmtNum(effectiveRate())}</div>
      <button id="btn-save-settings" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan</button>
    </div>

    <div class="card">
      <div class="card-title">Snapshot Historis</div>
      <div class="sub" style="margin-bottom:10px">Buat isi data net worth dari sebelum mulai pakai app (misal dari catatan manual lama), biar grafik tren di Assets lengkap. Cuma bisa buat bulan SEBELUM bulan berjalan — bulan berjalan otomatis ke-update sendiri tiap app dibuka.</div>
      <label>Bulan</label>
      <input id="snap-month" type="month" max="${addMonths(currentMonth(), -1)}" />
      <label>Net Worth (Rp)</label>
      <input id="snap-nw" inputmode="numeric" placeholder="cth: 15000000 atau -2000000" autocomplete="off" />
      <button id="btn-add-snapshot" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan Snapshot</button>
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
      <div class="card-title">📄 Export Laporan (.md)</div>
      <div class="sub" style="margin-bottom:10px">Laporan finansial satu bulan format Markdown — siap paste ke chat AI (ChatGPT/Claude/dll) buat dianalisis. Beda dari backup JSON di atas (itu buat restore data, ini buat dibaca).</div>
      <label>Bulan</label>
      <select id="rep-month">
        ${availableReportMonths().map((m) => `<option value="${m}" ${m === currentMonth() ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}
      </select>
      <div class="row" style="margin-top:12px">
        <button id="btn-download-report" class="btn">⬇️ Download .md</button>
        <button id="btn-copy-report" class="btn">📋 Salin ke Clipboard</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">App</div>
      <div class="sub" style="margin-bottom:10px">Tampilan aneh / kerasa nyangkut di versi lama? Hard refresh bersihin cache & service worker, terus reload dari awal. Data lo aman, ga kehapus (kesimpen di cloud).</div>
      <button id="btn-hard-refresh" class="btn btn-block">🔄 Hard Refresh</button>
    </div>

    <div class="card" style="border-color:#7f1d1d; background:#1c0a0a">
      <div class="card-title" style="color:var(--red)">⚠️ Zona Bahaya</div>
      <div class="sub" style="margin-bottom:10px">Hapus data dalam jumlah besar (per bulan/tahun/total). Ga bisa dibatalkan.</div>
      <a href="#/danger" class="btn btn-danger btn-block" style="text-decoration:none; display:flex; align-items:center; justify-content:center">🗑️ Reset Data</a>
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
        itick: root.querySelector("#s-itick").value.trim() || null,
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

  root.querySelector("#btn-add-snapshot").onclick = async () => {
    const month = root.querySelector("#snap-month").value;
    const nwInput = root.querySelector("#snap-nw").value.trim();
    if (!month) return toast("Pilih bulan dulu");
    if (month >= currentMonth()) return toast("Cuma bisa buat bulan sebelum bulan ini — bulan berjalan ke-update otomatis");
    if (!nwInput) return toast("Isi net worth-nya");
    const netWorth = parseAmount(nwInput);

    const existing = state.snapshots.find((s) => s.id === month);
    if (existing && !confirmDialog(`Snapshot ${monthLabel(month)} udah ada (Net Worth: ${fmtIDR(existing.netWorth).replace(/<[^>]+>/g, "")}). Timpa dengan nilai baru?`)) return;

    await put("snapshots", month, { month, netWorth, manual: true });
    root.querySelector("#snap-nw").value = "";
    toast(`Snapshot ${monthLabel(month)} disimpan ✓`);
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

  root.querySelector("#btn-download-report").onclick = () => {
    const month = root.querySelector("#rep-month").value;
    const md = buildMonthlyReport(month);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `fintrack-laporan-${month}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Laporan ter-download ✓");
  };

  root.querySelector("#btn-copy-report").onclick = async () => {
    const month = root.querySelector("#rep-month").value;
    const md = buildMonthlyReport(month);
    try {
      await navigator.clipboard.writeText(md);
      toast("Laporan ke-copy ✓ — paste ke chat AI");
    } catch (e) {
      console.error(e);
      toast("Gagal copy (izin clipboard?) — coba Download aja");
    }
  };

  root.querySelector("#btn-logout").onclick = async () => {
    if (!confirmDialog("Keluar dari akun?")) return;
    await signOut(auth);
  };

  root.querySelector("#btn-hard-refresh").onclick = async () => {
    if (!confirmDialog("Hard refresh app? Cache & service worker lama bakal dibersihin, app reload dari awal. Data lo aman (tersimpan di cloud).")) return;
    toast("Membersihkan cache...");
    await hardRefresh();
  };
}

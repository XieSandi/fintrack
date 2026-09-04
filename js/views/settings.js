import { state, effectiveRate, milestoneProgress } from "../store.js";
import { exportAll, importAll, updateSettings, put, previewCapexBackfill, backfillCapexToSnapshots } from "../db.js";
import { auth, signOut } from "../firebase.js";
import {
  fmtNum, fmtIDR, fmtIDRPlain, escapeHtml, toast, parseAmount, attachThousands,
  confirmDialog, todayStr, hardRefresh, currentMonth, monthLabel, addMonths,
  openSheet, closeSheet, sheetHead, copyText,
} from "../utils.js";
import { buildMonthlyReport, availableReportMonths } from "../report-md.js";
import { scanIntegrity } from "../integrity.js";
import { openTxDetail } from "./home.js";
import { openAssetSheet } from "./wealth.js";
import { openAcctSheet } from "./accounts.js";
import { openGoalSheet } from "./goals.js";

export function render(root) {
  const lastBackup = state.settings.lastBackupAt;
  const backupOld = !lastBackup || (Date.now() - new Date(lastBackup).getTime()) > 30 * 864e5;
  const nAcct = state.accounts.length;
  const nCat = state.categories.length;
  const nBudget = state.budgets.filter((b) => b.month === state.month).length;
  const nGoals = state.goals.length;
  const nRecurring = state.recurring.filter((r) => r.active !== false).length;
  const milestone = milestoneProgress();
  const capexBackfillRows = previewCapexBackfill();

  root.innerHTML = `
    ${backupOld ? `<div class="card" style="border-color:#6a5833; background:#211d16">
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
      <label>Finnhub key — saham/ETF US <a href="https://finnhub.io" target="_blank" rel="noopener" style="color:var(--blue)">↗</a></label>
      <input id="s-finnhub" type="text" autocomplete="off" placeholder="belum diisi = saham US manual" value="${escapeHtml(state.settings.apiKeys?.finnhub || "")}" />
      <button id="btn-save-keys" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan Keys</button>
    </div>

    <div class="card">
      <div class="card-title">🏆 Main Milestone & Kurs</div>
      ${milestone.achieved ? `<div class="sub" style="color:#d9bc7f; margin-bottom:8px">🏆 Tercapai! Set milestone berikutnya.</div>` : ""}
      <label>Target Net Worth (Rp)</label>
      <input id="s-target" inputmode="numeric" value="${fmtNum(state.settings.targetNetWorth || 100000000)}" />
      <label>Target Bulan (opsional)</label>
      <input id="s-target-date" type="month" value="${state.settings.targetDate || ""}" />
      <label>Kurs USD/IDR manual (kosong = auto)</label>
      <input id="s-kurs" inputmode="numeric" placeholder="auto: ${fmtNum(state.usdIdr?.rate || 0)} ${state.usdIdr ? `(per ${state.usdIdr.date})` : ""}" value="${state.settings.usdIdrManual ? fmtNum(state.settings.usdIdrManual) : ""}" />
      <div class="sub">Kurs efektif sekarang: ${fmtNum(effectiveRate())}</div>
      <div class="row">
        <div><label>Rate A (%/th)</label><input id="s-proj-rate-a" type="number" inputmode="decimal" step="0.5" min="0" max="100" value="${((Number(state.settings.projectionRateA ?? 0.05)) * 100).toFixed(1)}" /></div>
        <div><label>Rate B (%/th)</label><input id="s-proj-rate-b" type="number" inputmode="decimal" step="0.5" min="0" max="100" value="${((Number(state.settings.projectionRateB ?? 0.07)) * 100).toFixed(1)}" /></div>
      </div>
      <button id="btn-save-settings" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan</button>
    </div>

    <div class="card">
      <div class="card-title">Snapshot Historis</div>
      <label>Bulan</label>
      <input id="snap-month" type="month" max="${addMonths(currentMonth(), -1)}" />
      <label>Net Worth (Rp)</label>
      <input id="snap-nw" inputmode="numeric" placeholder="cth: 15000000 atau -2000000" autocomplete="off" />
      <button id="btn-add-snapshot" class="btn btn-primary btn-sm" style="margin-top:12px">Simpan Snapshot</button>
    </div>

    ${capexBackfillRows.length > 0 ? `
    <div class="card">
      <div class="card-title">🏗️ Backfill CAPEX ke Snapshot Lama</div>
      <div class="sub" style="margin-bottom:10px">${capexBackfillRows.length} snapshot lama belum misahin CAPEX dari Assets.</div>
      <div class="table-like">
        ${capexBackfillRows.map((r) => `
          <div style="display:flex; justify-content:space-between; padding:6px 0; font-size:12px">
            <span class="sub">${monthLabel(r.month)} (${escapeHtml(r.matchedSymbols.join(", "))})</span>
            <span>${fmtIDRPlain(r.totalCapex)}</span>
          </div>`).join("")}
      </div>
      <button id="btn-capex-backfill" class="btn btn-primary btn-sm" style="margin-top:12px">Backfill ${capexBackfillRows.length} Snapshot</button>
    </div>` : ""}

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
      <button id="btn-hard-refresh" class="btn btn-block">🔄 Hard Refresh</button>
      <div style="height:10px"></div>
      <button id="btn-integrity" class="btn btn-block">🩺 Cek Integritas Data</button>
    </div>

    <div class="card" style="border-color:#6a4444; background:#201a1a">
      <div class="card-title" style="color:var(--red)">⚠️ Zona Bahaya</div>
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
        finnhub: root.querySelector("#s-finnhub").value.trim() || null,
      },
    });
    toast("API keys disimpan ✓ — coba 🔄 Harga di tab Assets");
  };

  root.querySelector("#btn-save-settings").onclick = async () => {
    const target = parseAmount(root.querySelector("#s-target").value);
    const targetDate = root.querySelector("#s-target-date").value || null;
    const kursManual = parseAmount(root.querySelector("#s-kurs").value);
    const rateA = parseFloat(root.querySelector("#s-proj-rate-a").value);
    const rateB = parseFloat(root.querySelector("#s-proj-rate-b").value);
    await updateSettings({
      targetNetWorth: target || 100000000, targetDate, usdIdrManual: kursManual || null,
      projectionRateA: (isNaN(rateA) || rateA < 0 ? 5 : rateA) / 100,
      projectionRateB: (isNaN(rateB) || rateB < 0 ? 7 : rateB) / 100,
    });
    toast("Settings disimpan ✓");
  };

  root.querySelector("#btn-add-snapshot").onclick = async () => {
    const month = root.querySelector("#snap-month").value;
    const nwInput = root.querySelector("#snap-nw").value.trim();
    if (!month) return toast("Pilih bulan dulu");
    if (month >= currentMonth()) return toast("Cuma bisa buat bulan sebelum bulan ini");
    if (!nwInput) return toast("Isi net worth-nya");
    const netWorth = parseAmount(nwInput);

    const existing = state.snapshots.find((s) => s.id === month);
    if (existing && !confirmDialog(`Snapshot ${monthLabel(month)} udah ada (Net Worth: ${fmtIDR(existing.netWorth).replace(/<[^>]+>/g, "")}). Timpa dengan nilai baru?`)) return;

    await put("snapshots", month, { month, netWorth, manual: true });
    root.querySelector("#snap-nw").value = "";
    toast(`Snapshot ${monthLabel(month)} disimpan ✓`);
  };

  root.querySelector("#btn-capex-backfill")?.addEventListener("click", async () => {
    if (!navigator.onLine) return toast("Lagi offline — coba lagi kalau udah online");
    if (!confirmDialog(`Backfill totalCapex ke ${capexBackfillRows.length} snapshot lama?`)) return;
    const n = await backfillCapexToSnapshots();
    toast(`Backfill selesai — ${n} snapshot terupdate ✓`);
  });

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
    await copyText(md, "Laporan ke-copy ✓ — paste ke chat AI", "Gagal copy — coba Download aja");
  };

  root.querySelector("#btn-integrity").onclick = () => openIntegritySheet();

  root.querySelector("#btn-logout").onclick = async () => {
    if (!confirmDialog("Keluar dari akun?")) return;
    await signOut(auth);
  };

  root.querySelector("#btn-hard-refresh").onclick = async () => {
    if (!confirmDialog("Hard refresh? Cache & service worker dibersihin, app reload.")) return;
    toast("Membersihkan cache...");
    await hardRefresh();
  };
}

// ================= Cek Integritas Data (TASK-8) =================
// Read-only, JANGAN auto-fix — cuma laporan. "Buka" ke transaksi lewat openTxDetail()
// (home.js) biar ikut guard goal/asset yang sama kayak entry point lain, JANGAN openTxSheet()
// langsung. Buat finding di level budget (bukan transaksi), arahkan ke #/budget — ga ada
// transaksi spesifik yang bisa dibuka buat itu.
function openIntegritySheet() {
  const issues = scanIntegrity(state);
  const el = openSheet(`
    ${sheetHead("🩺 Integritas Data")}
    ${issues.length === 0
      ? `<div class="empty">Semua rapi ✓</div>`
      : `<div class="sub" style="margin-bottom:10px">${issues.length} item butuh perhatian</div><div id="ig-list"></div>`}
  `);
  el.querySelector("[data-close]").onclick = closeSheet;

  if (issues.length === 0) return;

  const list = el.querySelector("#ig-list");
  issues.forEach((issue) => {
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:10px; padding:9px 0; border-bottom:1px solid var(--border)";
    const label = issue.kind === "transaction"
      ? `Transaksi ${issue.ref.date || "?"} · ${fmtIDR(issue.ref.amount).replace(/<[^>]+>/g, "")}`
      : issue.kind === "asset"
      ? `Asset ${issue.ref.symbol || issue.ref.name || "?"}`
      : issue.kind === "account"
      ? `Akun ${issue.ref.name || "?"}`
      : issue.kind === "goal"
      ? `Goal ${issue.ref.name || "?"}`
      : `Budget ${issue.ref.month || "?"}`;
    row.innerHTML = `
      <div style="flex:1">
        <div style="font-size:13px; font-weight:600">${escapeHtml(label)}</div>
        <div class="sub" style="color:var(--yellow)">⚠️ ${escapeHtml(issue.problems.join(", "))}</div>
      </div>
      <button class="btn btn-sm" data-open>Buka</button>`;
    row.querySelector("[data-open]").onclick = () => {
      closeSheet();
      if (issue.kind === "transaction") openTxDetail(issue.ref);
      else if (issue.kind === "asset") openAssetSheet(issue.ref);
      else if (issue.kind === "account") openAcctSheet(issue.ref);
      else if (issue.kind === "goal") openGoalSheet(issue.ref);
      else location.hash = "#/budget";
    };
    list.appendChild(row);
  });
}

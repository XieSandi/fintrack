// Zona Bahaya — bulk delete / reset data (TASK-9). Subpage #/danger dari Setting.
// SEMUA penghapusan lewat db.js bulkDelete()/previewBulkDelete() — view ini cuma UI + guard.
import { state } from "../store.js";
import { bulkDelete, previewBulkDelete, exportAll, updateSettings } from "../db.js";
import { fmtIDR, escapeHtml, toast, currentMonth, monthLabel, todayStr } from "../utils.js";
import { availableReportMonths } from "../report-md.js";

let mode = "month"; // "month" | "year" | "total"
let selMonth = currentMonth();
let selYear = currentMonth().slice(0, 4);
let totalSub = "c1"; // "c1" (hapus histori) | "c2" (reset total)
let keepApiKeys = true;
let ackChecked = false;
let confirmInput = "";

function availableYears() {
  const set = new Set([currentMonth().slice(0, 4)]);
  state.transactions.forEach((t) => set.add(t.month.slice(0, 4)));
  state.snapshots.forEach((s) => set.add((s.month || s.id).slice(0, 4)));
  return [...set].sort().reverse();
}

function requiredConfirmText() {
  if (mode === "month") return selMonth;
  if (mode === "year") return selYear;
  return totalSub === "c2" ? "RESET TOTAL" : "HAPUS SEMUA";
}

function backupStale() {
  const last = state.settings.lastBackupAt;
  if (!last) return true;
  return Date.now() - new Date(last).getTime() > 24 * 3600 * 1000;
}

export function render(root) {
  const online = navigator.onLine;
  const includeMaster = mode === "total" && totalSub === "c2";
  const preview = mode === "month" ? previewBulkDelete({ mode: "month", month: selMonth })
    : mode === "year" ? previewBulkDelete({ mode: "year", year: selYear })
    : previewBulkDelete({ mode: "total" });

  const historyCount = preview.transactions + preview.budgets + preview.snapshots;
  const required = requiredConfirmText();
  const masterCounts = includeMaster
    ? `${state.accounts.length} akun, ${state.categories.length} kategori, ${state.assets.length} asset, ${state.debts.length} hutang, ${state.goals.length} goal, ${state.recurring.length} recurring`
    : null;

  const canDelete = online && (historyCount > 0 || includeMaster)
    && ackChecked && confirmInput.trim() === required;

  root.innerHTML = `
    <div class="card" style="border-color:#7f1d1d; background:#1c0a0a">
      <div class="card-title" style="color:var(--red)">⚠️ Zona Bahaya</div>
      <div class="sub">Hapus data dalam jumlah besar. Ga ada undo — pastikan lo udah backup dulu.</div>
    </div>

    ${!online ? `<div class="card" style="border-color:#a16207; background:#1c1400">
      <div style="font-size:13px">📡 Reset data butuh koneksi — biar ga ada operasi hapus yang ngegantung di antrian offline. Sambungin internet dulu.</div>
    </div>` : ""}

    <div class="card">
      <div class="card-title">Scope</div>
      <div class="type-toggle">
        <button data-mode="month" class="${mode === "month" ? "active" : ""}">Per Bulan</button>
        <button data-mode="year" class="${mode === "year" ? "active" : ""}">Per Tahun</button>
        <button data-mode="total" class="${mode === "total" ? "active" : ""}">Total</button>
      </div>

      ${mode === "month" ? `
        <label>Bulan</label>
        <select id="dg-month">
          ${availableReportMonths().map((m) => `<option value="${m}" ${m === selMonth ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}
        </select>` : ""}

      ${mode === "year" ? `
        <label>Tahun</label>
        <select id="dg-year">
          ${availableYears().map((y) => `<option value="${y}" ${y === selYear ? "selected" : ""}>${y}</option>`).join("")}
        </select>` : ""}

      ${mode === "total" ? `
        <div style="margin-top:10px; display:flex; flex-direction:column; gap:8px">
          <label style="display:flex; align-items:flex-start; gap:8px; text-transform:none; letter-spacing:0; font-size:13px; color:var(--text); border:1px solid var(--border); border-radius:8px; padding:10px; margin:0">
            <input type="radio" name="dg-totalsub" value="c1" style="width:auto; margin-top:3px" ${totalSub === "c1" ? "checked" : ""} />
            <span><b>Hapus Semua Histori</b><br/><span class="sub">Semua transaksi, budget, snapshot. Akun/kategori/asset/hutang/goal/recurring TETAP ada.</span></span>
          </label>
          <label style="display:flex; align-items:flex-start; gap:8px; text-transform:none; letter-spacing:0; font-size:13px; color:var(--red); border:1px solid #7f1d1d; border-radius:8px; padding:10px; margin:0">
            <input type="radio" name="dg-totalsub" value="c2" style="width:auto; margin-top:3px" ${totalSub === "c2" ? "checked" : ""} />
            <span><b>Reset Total</b><br/><span class="sub" style="color:var(--red)">SEMUA data termasuk akun/kategori/asset/hutang/goal/recurring — kembali ke kondisi baru install.</span></span>
          </label>
          ${totalSub === "c2" ? `
          <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:12px; color:var(--muted2); margin:0">
            <input type="checkbox" id="dg-keepkeys" style="width:auto" ${keepApiKeys ? "checked" : ""} /> Pertahankan API keys (iTick/Finnhub) — ga usah setup ulang
          </label>` : ""}
        </div>` : ""}
    </div>

    <div class="card">
      <div class="card-title">Preview</div>
      ${historyCount === 0 && !includeMaster ? `<div class="empty">Ga ada data di periode ini.</div>` : `
        <div class="sub" style="margin-bottom:6px">
          ${preview.transactions} transaksi · ${preview.budgets} budget · ${preview.snapshots} snapshot akan dihapus
          ${preview.dateFrom ? `<br/>Rentang tanggal: ${preview.dateFrom} s/d ${preview.dateTo}` : ""}
        </div>
        <div class="sub">Total expense: ${fmtIDR(preview.totalExpense)} · Total income: ${fmtIDR(preview.totalIncome)}</div>
        ${masterCounts ? `<div class="sub" style="color:var(--red); margin-top:6px">+ master data ikut kehapus: ${masterCounts}</div>` : ""}
      `}
    </div>

    ${backupStale() ? `
    <div class="card" style="border-color:#a16207; background:#1c1400">
      <div style="font-size:13px; margin-bottom:8px">⚠️ ${state.settings.lastBackupAt ? "Backup terakhir lebih dari 24 jam lalu" : "Lo belum pernah backup"}. Export dulu sebelum hapus data.</div>
      <button id="dg-backup-now" class="btn btn-block">⬇️ Export Backup Dulu</button>
    </div>` : ""}

    <div class="card">
      <label style="display:flex; align-items:center; gap:8px; text-transform:none; letter-spacing:0; font-size:13px; color:var(--text); margin:0">
        <input type="checkbox" id="dg-ack" style="width:auto" ${ackChecked ? "checked" : ""} />
        Gue udah backup / gue paham resikonya
      </label>
      <label style="margin-top:14px">Ketik "${escapeHtml(required)}" buat konfirmasi</label>
      <input id="dg-confirm" type="text" autocomplete="off" value="${escapeHtml(confirmInput)}" placeholder="${escapeHtml(required)}" />
      <button id="dg-delete" class="btn btn-danger btn-block" style="margin-top:14px" ${canDelete ? "" : "disabled"}>🗑️ Hapus Sekarang</button>
    </div>

    <div id="dg-progress" class="card hidden">
      <div class="card-title">Memproses...</div>
      <div id="dg-progress-text" class="sub">Menghapus...</div>
      <div class="progress" style="margin-top:8px"><div id="dg-progress-bar" class="p-red" style="width:0%"></div></div>
    </div>
  `;

  root.querySelectorAll("[data-mode]").forEach((b) => {
    b.onclick = () => { mode = b.dataset.mode; confirmInput = ""; render(root); };
  });
  root.querySelector("#dg-month")?.addEventListener("change", (e) => { selMonth = e.target.value; confirmInput = ""; render(root); });
  root.querySelector("#dg-year")?.addEventListener("change", (e) => { selYear = e.target.value; confirmInput = ""; render(root); });
  root.querySelectorAll('[name="dg-totalsub"]').forEach((r) => {
    r.onchange = () => { totalSub = r.value; confirmInput = ""; render(root); };
  });
  root.querySelector("#dg-keepkeys")?.addEventListener("change", (e) => { keepApiKeys = e.target.checked; });
  root.querySelector("#dg-ack")?.addEventListener("change", (e) => { ackChecked = e.target.checked; render(root); });
  root.querySelector("#dg-confirm")?.addEventListener("input", (e) => { confirmInput = e.target.value; render(root); });

  root.querySelector("#dg-backup-now")?.addEventListener("click", async () => {
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
  });

  root.querySelector("#dg-delete")?.addEventListener("click", async () => {
    if (!canDelete) return;
    const btn = root.querySelector("#dg-delete");
    btn.disabled = true;
    const progressCard = root.querySelector("#dg-progress");
    const progressText = root.querySelector("#dg-progress-text");
    const progressBar = root.querySelector("#dg-progress-bar");
    progressCard.classList.remove("hidden");

    // Jaga-jaga user nutup/refresh tab pas proses jalan (hashchange di app.js ga ke-block —
    // JS-nya tetep lanjut jalan di background walau pindah halaman, cuma progress UI-nya ga
    // keliatan lagi; yang beneran bahaya itu nutup TAB di tengah jalan, itu yang dicegah ini).
    const beforeUnload = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);

    try {
      const { deleted } = await bulkDelete({
        mode,
        month: mode === "month" ? selMonth : undefined,
        year: mode === "year" ? selYear : undefined,
        includeMaster,
        keepApiKeys,
        onProgress: (done, total) => {
          progressText.textContent = total > 0 ? `Menghapus ${done}/${total}...` : "Menghapus...";
          progressBar.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : "0%";
        },
      });
      toast(`Terhapus: ${deleted.transactions} transaksi, ${deleted.budgets} budget, ${deleted.snapshots} snapshot. Saldo akun ikut berubah (dihitung dari transaksi) — cek Setting → Akun → ⚖️ Sesuaikan Saldo kalau perlu.`, 6000);
      mode = "month"; selMonth = currentMonth(); confirmInput = ""; ackChecked = false;
      location.hash = "#/settings";
    } catch (e) {
      console.error(e);
      toast("Gagal menghapus: " + (e.message || "unknown error"));
      progressCard.classList.add("hidden");
      btn.disabled = false;
    } finally {
      window.removeEventListener("beforeunload", beforeUnload);
    }
  });
}

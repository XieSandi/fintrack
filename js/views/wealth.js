import {
  state, netWorthIDR, totalCashIDR, totalAssetsIDR, totalDebtIDR,
  assetValueIDR, assetCostIDR, effectiveRate, monthSummary,
} from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtMoney, fmtNum, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, lastNMonths, monthLabel, todayStr, confirmDialog,
} from "../utils.js";

let activeTab = "assets"; // assets | debts
let charts = [];

const ASSET_TYPES = {
  stock_id: "Saham IDX (lot)",
  stock_us: "Saham/ETF US (shares)",
  mutual_fund: "Reksa Dana",
  deposito: "Deposito",
  gold: "Emas",
  crypto: "Crypto",
  other: "Lainnya",
};

export function render(root) {
  charts.forEach((c) => c.destroy());
  charts = [];

  const nw = netWorthIDR();
  const cash = totalCashIDR();
  const assets = totalAssetsIDR();
  const debt = totalDebtIDR();
  const target = Number(state.settings.targetNetWorth) || 100_000_000;
  const rate = effectiveRate();

  root.innerHTML = `
    <div class="networth-banner">
      <div class="label">Net Worth</div>
      <div class="big-amount" style="color:#93c5fd">${fmtIDR(nw)}</div>
      <div class="sub" style="color:#7da3d8">
        Cash ${fmtIDR(cash)} + Assets ${fmtIDR(assets)} − Debt ${fmtIDR(debt)}
      </div>
      <div class="sub" style="color:#5a789f">Kurs USD ${fmtNum(rate)}${state.settings.usdIdrManual ? " (manual)" : state.usdIdr ? ` · auto per ${state.usdIdr.date}` : ""}</div>
    </div>

    <div class="card">
      <div class="card-title">Tren Net Worth</div>
      <canvas id="chart-nw" height="150"></canvas>
    </div>

    <div class="card">
      <div class="card-title">Income vs Expense (6 bulan)</div>
      <canvas id="chart-cashflow" height="150"></canvas>
    </div>

    <div class="tabs">
      <button data-tab="assets" class="${activeTab === "assets" ? "active" : ""}">📈 Assets</button>
      <button data-tab="debts" class="${activeTab === "debts" ? "active" : ""}">💳 Debt</button>
    </div>
    <div id="tab-content"></div>
  `;

  root.querySelectorAll("[data-tab]").forEach((b) => {
    b.onclick = () => { activeTab = b.dataset.tab; render(root); };
  });

  renderCharts(root, target);
  if (activeTab === "assets") renderAssets(root.querySelector("#tab-content"));
  else renderDebts(root.querySelector("#tab-content"));
}

// ================= Charts =================
function renderCharts(root, target) {
  if (!window.Chart) return; // CDN belum ke-load / offline first visit

  const gridColor = "#1e293b", tickColor = "#64748b";
  Chart.defaults.color = tickColor;
  Chart.defaults.font.size = 10;

  // Net worth trend dari snapshots
  const snaps = state.snapshots.slice(-12);
  if (snaps.length > 0) {
    charts.push(new Chart(root.querySelector("#chart-nw"), {
      type: "line",
      data: {
        labels: snaps.map((s) => monthLabel(s.month || s.id)),
        datasets: [
          { label: "Net Worth", data: snaps.map((s) => s.netWorth), borderColor: "#60a5fa",
            backgroundColor: "rgba(96,165,250,.12)", fill: true, tension: .3, pointRadius: 3 },
          { label: "Target", data: snaps.map(() => target), borderColor: "#4ade80",
            borderDash: [6, 5], pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: gridColor }, ticks: { callback: (v) => (v / 1e6).toFixed(0) + "JT" } },
          x: { grid: { display: false } },
        },
      },
    }));
  } else {
    root.querySelector("#chart-nw").closest(".card").querySelector(".card-title")
      .insertAdjacentHTML("afterend", `<div class="empty">Snapshot bulanan akan terisi otomatis tiap app dibuka.</div>`);
  }

  // Income vs expense 6 bulan
  const months = lastNMonths(6);
  const sums = months.map((m) => monthSummary(m));
  charts.push(new Chart(root.querySelector("#chart-cashflow"), {
    type: "bar",
    data: {
      labels: months.map(monthLabel),
      datasets: [
        { label: "Income", data: sums.map((s) => s.income), backgroundColor: "#4ade80", borderRadius: 4 },
        { label: "Expense", data: sums.map((s) => s.expense), backgroundColor: "#f87171", borderRadius: 4 },
      ],
    },
    options: {
      plugins: { legend: { labels: { boxWidth: 10 } } },
      scales: {
        y: { grid: { color: gridColor }, ticks: { callback: (v) => (v / 1e6).toFixed(1) + "JT" } },
        x: { grid: { display: false } },
      },
    },
  }));
}

// ================= Assets =================
function renderAssets(root) {
  const rows = state.assets.slice().sort((a, b) => assetValueIDR(b) - assetValueIDR(a));
  root.innerHTML = `
    <div class="card">
      <div id="asset-list">
        ${rows.length === 0 ? `<div class="empty">Belum ada asset.<br/>Tambahin saham, deposito, dll.</div>` : ""}
      </div>
    </div>
    <button id="btn-add-asset" class="btn btn-primary btn-block">＋ Tambah Asset</button>
  `;

  const list = root.querySelector("#asset-list");
  rows.forEach((a) => {
    const val = assetValueIDR(a);
    const cost = assetCostIDR(a);
    const pnl = val - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const qtyLabel = a.type === "stock_id" ? `${fmtNum(a.quantity)} lot` : `${a.quantity} ${a.type === "stock_us" ? "sh" : ""}`;
    const div = document.createElement("div");
    div.className = "asset-item";
    div.innerHTML = `
      <div>
        <div class="asset-sym">${escapeHtml(a.symbol || a.name)}</div>
        <div class="asset-meta">${ASSET_TYPES[a.type] || a.type} · ${qtyLabel} · avg ${fmtMoney(a.avgBuyPrice, a.currency)}</div>
        <div class="stale-note">harga ${fmtMoney(a.manualPrice, a.currency)} per ${a.manualPriceUpdatedAt || "?"}</div>
      </div>
      <div class="asset-right">
        <div class="asset-val">${fmtIDR(val)}</div>
        <div class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${pnl >= 0 ? "+" : ""}${fmtIDR(pnl)} (${pnlPct.toFixed(1)}%)</div>
      </div>`;
    div.onclick = () => openAssetSheet(a);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-asset").onclick = () => openAssetSheet(null);
}

function openAssetSheet(existing) {
  const a = existing || {
    type: "stock_id", symbol: "", name: "", quantity: "", avgBuyPrice: "",
    currency: "IDR", manualPrice: "",
  };

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Asset" : "Tambah Asset")}
    <label>Tipe</label>
    <select id="a-type">
      ${Object.entries(ASSET_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? "selected" : ""}>${v}</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Symbol / Kode</label><input id="a-symbol" placeholder="BBCA / VOO" value="${escapeHtml(a.symbol || "")}" /></div>
      <div><label>Nama (opsional)</label><input id="a-name" placeholder="Bank Central Asia" value="${escapeHtml(a.name || "")}" /></div>
    </div>
    <div class="row">
      <div><label id="a-qty-label">Jumlah</label><input id="a-qty" inputmode="decimal" placeholder="10" value="${a.quantity ?? ""}" /></div>
      <div><label>Currency</label>
        <select id="a-currency">
          <option value="IDR" ${a.currency === "IDR" ? "selected" : ""}>IDR</option>
          <option value="USD" ${a.currency === "USD" ? "selected" : ""}>USD</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div><label>Avg Buy / unit</label><input id="a-avg" inputmode="decimal" placeholder="6710" value="${a.avgBuyPrice ?? ""}" /></div>
      <div><label>Harga sekarang / unit</label><input id="a-price" inputmode="decimal" placeholder="6175" value="${a.manualPrice ?? ""}" /></div>
    </div>
    <div class="sub">💡 Saham IDX: jumlah dalam <b>lot</b> (1 lot = 100 lembar), harga per <b>lembar</b>. US: jumlah dalam shares (boleh desimal), harga per share USD. Harga diupdate manual — timestamp dicatat otomatis.</div>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="a-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="a-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const typeSel = el.querySelector("#a-type");
  const curSel = el.querySelector("#a-currency");
  const qtyLabel = el.querySelector("#a-qty-label");
  const syncType = () => {
    qtyLabel.textContent = typeSel.value === "stock_id" ? "Jumlah (lot)" : "Jumlah";
    if (typeSel.value === "stock_id") curSel.value = "IDR";
    if (typeSel.value === "stock_us") curSel.value = "USD";
  };
  typeSel.onchange = syncType;
  syncType();
  if (existing) curSel.value = a.currency; // jangan override saat edit

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#a-save").onclick = async () => {
    const parseDec = (v) => parseFloat(String(v).replace(",", ".")) || 0;
    const data = {
      type: typeSel.value,
      symbol: el.querySelector("#a-symbol").value.trim().toUpperCase(),
      name: el.querySelector("#a-name").value.trim(),
      quantity: parseDec(el.querySelector("#a-qty").value),
      avgBuyPrice: parseDec(el.querySelector("#a-avg").value),
      manualPrice: parseDec(el.querySelector("#a-price").value),
      currency: curSel.value,
      autoPriceEnabled: false,
    };
    if (!data.symbol && !data.name) return toast("Isi symbol atau nama");
    if (!data.quantity) return toast("Isi jumlah");
    if (String(data.manualPrice) !== String(existing?.manualPrice ?? "")) {
      data.manualPriceUpdatedAt = todayStr();
    } else if (existing) {
      data.manualPriceUpdatedAt = existing.manualPriceUpdatedAt || todayStr();
    } else {
      data.manualPriceUpdatedAt = todayStr();
    }
    closeSheet();
    if (existing) await patch("assets", existing.id, data);
    else await add("assets", data);
    toast("Asset disimpan ✓");
  };

  if (existing) {
    el.querySelector("#a-delete").onclick = async () => {
      if (!confirmDialog("Hapus asset ini?")) return;
      closeSheet();
      await remove("assets", existing.id);
      toast("Dihapus");
    };
  }
}

// ================= Debts =================
function renderDebts(root) {
  const rows = state.debts.slice().sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99));
  const totalInstalment = rows.reduce((s, d) => s + (Number(d.monthlyInstalment) || 0), 0);

  root.innerHTML = `
    <div class="card">
      ${rows.length > 0 ? `<div class="sub" style="margin-bottom:10px">Total cicilan / bulan: <b style="color:var(--red)">${fmtIDR(totalInstalment)}</b></div>` : ""}
      <div id="debt-list">
        ${rows.length === 0 ? `<div class="empty">Ga ada hutang aktif. 🎉</div>` : ""}
      </div>
    </div>
    <button id="btn-add-debt" class="btn btn-primary btn-block">＋ Tambah Hutang / Cicilan</button>
  `;

  const list = root.querySelector("#debt-list");
  const today = new Date().getDate();
  rows.forEach((d) => {
    const div = document.createElement("div");
    div.className = "asset-item";
    const dueSoon = d.dueDay && d.dueDay - today >= 0 && d.dueDay - today <= 3;
    div.innerHTML = `
      <div>
        <div class="asset-sym" style="font-size:13px">${escapeHtml(d.name)}</div>
        <div class="asset-meta">cicilan ${fmtIDR(d.monthlyInstalment)}/bln · sisa ${d.remainingMonths ?? "?"} bln</div>
        ${d.dueDay ? `<div class="stale-note">jatuh tempo tgl ${d.dueDay} ${dueSoon ? '<span class="badge badge-yellow">SEGERA</span>' : ""}</div>` : ""}
      </div>
      <div class="asset-right">
        <div class="asset-val" style="color:var(--red)">${fmtIDR(d.totalOutstanding)}</div>
        <div class="stale-note">outstanding</div>
      </div>`;
    div.onclick = () => openDebtSheet(d);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-debt").onclick = () => openDebtSheet(null);
}

function openDebtSheet(existing) {
  const d = existing || { name: "", totalOutstanding: "", monthlyInstalment: "", dueDay: "", remainingMonths: "" };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Hutang" : "Tambah Hutang")}
    <label>Nama</label>
    <input id="d-name" placeholder="cth: Tokopedia CC" value="${escapeHtml(d.name)}" />
    <div class="row">
      <div><label>Outstanding (Rp)</label><input id="d-out" inputmode="numeric" value="${d.totalOutstanding ? fmtNum(d.totalOutstanding) : ""}" /></div>
      <div><label>Cicilan / bulan (Rp)</label><input id="d-inst" inputmode="numeric" value="${d.monthlyInstalment ? fmtNum(d.monthlyInstalment) : ""}" /></div>
    </div>
    <div class="row">
      <div><label>Jatuh tempo (tgl)</label><input id="d-due" inputmode="numeric" placeholder="15" value="${d.dueDay ?? ""}" /></div>
      <div><label>Sisa bulan</label><input id="d-months" inputmode="numeric" placeholder="8" value="${d.remainingMonths ?? ""}" /></div>
    </div>
    <div class="sub">💡 Pembayaran cicilan tetap dicatat sebagai transaksi expense (kategori Cicilan/Debt). Update outstanding di sini secara manual setelah bayar.</div>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="d-delete" class="btn btn-danger">Lunas / Hapus</button>` : ""}
      <button id="d-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  attachThousands(el.querySelector("#d-out"));
  attachThousands(el.querySelector("#d-inst"));
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#d-save").onclick = async () => {
    const data = {
      name: el.querySelector("#d-name").value.trim(),
      totalOutstanding: parseAmount(el.querySelector("#d-out").value),
      monthlyInstalment: parseAmount(el.querySelector("#d-inst").value),
      dueDay: parseInt(el.querySelector("#d-due").value) || null,
      remainingMonths: parseInt(el.querySelector("#d-months").value) || null,
    };
    if (!data.name) return toast("Isi nama hutang");
    closeSheet();
    if (existing) await patch("debts", existing.id, data);
    else await add("debts", data);
    toast("Disimpan ✓");
  };

  if (existing) {
    el.querySelector("#d-delete").onclick = async () => {
      if (!confirmDialog("Hapus hutang ini? (misal karena sudah lunas)")) return;
      closeSheet();
      await remove("debts", existing.id);
      toast("Mantap, satu hutang hilang 🎉");
    };
  }
}

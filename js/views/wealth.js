import {
  state, activeAccounts, accountBalances, netWorthIDR, totalCashIDR,
  totalAssetsIDR, totalDebtIDR, totalGoalSavingsIDR, assetValueIDR, assetCostIDR,
  effectiveRate, monthSummary,
} from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtMoney, fmtNum, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, lastNMonths, monthLabel, todayStr, confirmDialog, monthOf,
} from "../utils.js";
import { refreshPrices, refreshableAssets } from "../prices.js";

let groupTab = "total";   // total | assets | liquid | debt
let chartTab = "nw";      // nw | cashflow
let assetFilter = "";     // "" = semua tipe
let charts = [];

export const ASSET_TYPES = {
  stock_id: "Saham IDX",
  stock_us: "Saham/ETF US",
  mutual_fund: "Reksa Dana",
  deposito: "Deposito",
  gold: "Emas",
  crypto: "Crypto",
  other: "Lainnya",
};

const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function render(root) {
  destroyCharts();

  const nw = netWorthIDR();
  const cash = totalCashIDR();
  const assets = totalAssetsIDR();
  const debt = totalDebtIDR();

  root.innerHTML = `
    <div class="sumtabs">
      ${sumBtn("total", "Total", fmtShort(nw), nw >= 0 ? "#93c5fd" : "var(--red)")}
      ${sumBtn("assets", "Assets", fmtShort(assets), "var(--green)")}
      ${sumBtn("liquid", "Liquid", fmtShort(cash), "#93c5fd")}
      ${sumBtn("debt", "Debt", fmtShort(debt), "var(--red)")}
    </div>
    <div id="group-content"></div>
  `;

  root.querySelectorAll(".sumtabs button").forEach((b) => {
    b.onclick = () => { groupTab = b.dataset.group; render(root); };
  });

  const content = root.querySelector("#group-content");
  if (groupTab === "total") renderTotal(content);
  else if (groupTab === "assets") renderAssets(content);
  else if (groupTab === "liquid") renderLiquid(content);
  else renderDebts(content);
}

const sumBtn = (key, label, val, color) => `
  <button data-group="${key}" class="${groupTab === key ? "active" : ""}">
    <span class="st-label">${label}</span>
    <span class="st-val" style="color:${color}">${val}</span>
  </button>`;

const fmtShort = (n) => {
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "M";
  if (abs >= 1e6) return (n / 1e6).toFixed(1) + "JT";
  if (abs >= 1e3) return (n / 1e3).toFixed(0) + "rb";
  return String(Math.round(n));
};

// ================= TOTAL =================
function renderTotal(root) {
  const nw = netWorthIDR();
  const cash = totalCashIDR();
  const assets = totalAssetsIDR();
  const goalSavings = totalGoalSavingsIDR();
  const debt = totalDebtIDR();
  const target = Number(state.settings.targetNetWorth) || 100_000_000;
  const pctTarget = Math.max(0, Math.min(100, (nw / target) * 100));
  const rate = effectiveRate();

  root.innerHTML = `
    <div class="networth-banner">
      <div class="label">Net Worth</div>
      <div class="big-amount" style="color:#93c5fd">${fmtIDR(nw)}</div>
      <div class="progress" style="margin-top:12px; height:8px;">
        <div style="width:${pctTarget}%; background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
      </div>
      <div class="sub" style="color:#7da3d8">🏆 Main Milestone: ${pctTarget.toFixed(1)}% menuju ${fmtIDR(target)}</div>
      <div class="sub" style="color:#5a789f">Kurs USD ${fmtNum(rate)}${state.settings.usdIdrManual ? " (manual)" : state.usdIdr ? ` · auto per ${state.usdIdr.date}` : ""}</div>
    </div>

    <div class="card">
      <div class="table-like">
        ${totalRow("💧 Liquid (cash semua akun)", cash, "#93c5fd")}
        ${totalRow("📈 Assets (investasi)", assets, "var(--green)")}
        ${goalSavings > 0 ? totalRow("🎯 Short Term Goals (topup tersimpan)", goalSavings, "#c084fc") : ""}
        ${totalRow("💳 Debt", -debt, "var(--red)")}
        <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:10px; display:flex; justify-content:space-between">
          <span style="font-weight:800; font-size:13px">NET WORTH</span>
          <span style="font-weight:800; font-size:13px; color:#93c5fd">${fmtIDR(nw)}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="chart-tabs">
        <button data-chart="nw" class="${chartTab === "nw" ? "active" : ""}">📈 Tren Net Worth</button>
        <button data-chart="cashflow" class="${chartTab === "cashflow" ? "active" : ""}">💸 Income vs Expense</button>
      </div>
      <div id="chart-wrap"><canvas id="chart-main" height="170"></canvas></div>
    </div>
  `;

  root.querySelectorAll("[data-chart]").forEach((b) => {
    b.onclick = () => { chartTab = b.dataset.chart; render(root.parentElement); };
  });

  renderChart(root, target);
}

const totalRow = (label, val, color) => `
  <div style="display:flex; justify-content:space-between; padding:7px 0; font-size:13px">
    <span style="color:var(--muted2)">${label}</span>
    <span style="font-weight:700; color:${color}">${val < 0 ? "−" : ""}${fmtIDR(Math.abs(val))}</span>
  </div>`;

function renderChart(root, target) {
  if (!window.Chart) {
    root.querySelector("#chart-wrap").innerHTML = `<div class="empty">Chart library belum ke-load (butuh online sekali).</div>`;
    return;
  }
  const gridColor = "#1e293b";
  Chart.defaults.color = "#64748b";
  Chart.defaults.font.size = 10;
  const canvas = root.querySelector("#chart-main");

  if (chartTab === "nw") {
    const snaps = state.snapshots.slice(-12);
    if (snaps.length === 0) {
      root.querySelector("#chart-wrap").innerHTML = `<div class="empty">Snapshot bulanan akan terisi otomatis tiap app dibuka.</div>`;
      return;
    }
    charts.push(new Chart(canvas, {
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
    const months = lastNMonths(6);
    const sums = months.map((m) => monthSummary(m));
    charts.push(new Chart(canvas, {
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
}

// ================= ASSETS =================
function renderAssets(root) {
  const all = state.assets.slice();
  const typesPresent = [...new Set(all.map((a) => a.type))];
  const rows = assetFilter ? all.filter((a) => a.type === assetFilter) : all;
  const filteredTotal = rows.reduce((s, a) => s + assetValueIDR(a), 0);
  const filteredCost = rows.reduce((s, a) => s + assetCostIDR(a), 0);
  const filteredPnl = filteredTotal - filteredCost;
  const filteredPnlPct = filteredCost > 0 ? (filteredPnl / filteredCost) * 100 : 0;
  const nRefreshable = refreshableAssets().length;

  root.innerHTML = `
    <div class="filterbar">
      <select id="asset-filter">
        <option value="">Semua tipe (${all.length})</option>
        ${typesPresent.map((t) => `<option value="${t}" ${t === assetFilter ? "selected" : ""}>${ASSET_TYPES[t] || t} (${all.filter((a) => a.type === t).length})</option>`).join("")}
      </select>
      <button id="btn-refresh-prices" class="btn" style="flex:0 0 auto" ${nRefreshable === 0 ? "disabled" : ""}>🔄 Harga</button>
    </div>
    <div class="card">
      ${rows.length > 0 ? `
      <div class="summary3" style="margin-bottom:12px">
        <div><div class="label">Nilai</div><div class="v" style="color:var(--green)">${fmtIDR(filteredTotal)}</div></div>
        <div><div class="label">Invested</div><div class="v">${fmtIDR(filteredCost)}</div></div>
        <div><div class="label">Unrealized P/L</div><div class="v" style="color:${filteredPnl >= 0 ? "var(--green)" : "var(--red)"}">${filteredPnl >= 0 ? "+" : ""}${fmtIDR(filteredPnl)}</div>
        <div class="sub">${filteredPnlPct >= 0 ? "+" : ""}${filteredPnlPct.toFixed(1)}%</div></div>
      </div>` : ""}
      <div id="asset-list">
        ${all.length === 0 ? `<div class="empty">Belum ada asset.<br/>Tambahin saham, deposito, dll.</div>` : ""}
        ${all.length > 0 && rows.length === 0 ? `<div class="empty">Ga ada asset di tipe ini.</div>` : ""}
      </div>
    </div>
    <button id="btn-add-asset" class="btn btn-primary btn-block">＋ Tambah Asset</button>
  `;

  root.querySelector("#asset-filter").onchange = (e) => {
    assetFilter = e.target.value;
    render(root.parentElement);
  };

  const refreshBtn = root.querySelector("#btn-refresh-prices");
  refreshBtn.onclick = async () => {
    if (!navigator.onLine) return toast("Lagi offline — harga ga bisa di-refresh");
    refreshBtn.disabled = true;
    refreshBtn.textContent = "⏳...";
    try {
      const r = await refreshPrices();
      let msg = r.updated > 0 ? `${r.updated} harga terupdate ✓` : "Ga ada harga yang terupdate";
      if (r.noKey.length) msg += ` · butuh API key: ${r.noKey.join(", ")} (Setting)`;
      if (r.failed.length) msg += ` · gagal: ${r.failed.join(", ")}`;
      toast(msg, 3500);
    } catch (e) { console.error(e); toast("Refresh gagal"); }
    // re-render otomatis via store emit setelah patch
  };

  const list = root.querySelector("#asset-list");

  // Grouping per tipe (urut sesuai ASSET_TYPES), dalam group sort by nilai
  const order = Object.keys(ASSET_TYPES);
  const groups = order
    .filter((t) => rows.some((a) => a.type === t))
    .map((t) => ({ type: t, items: rows.filter((a) => a.type === t).sort((x, y) => assetValueIDR(y) - assetValueIDR(x)) }));

  groups.forEach((g) => {
    const subtotal = g.items.reduce((s, a) => s + assetValueIDR(a), 0);
    if (!assetFilter) {
      const head = document.createElement("div");
      head.className = "group-head";
      head.innerHTML = `<span>${ASSET_TYPES[g.type]}</span><span class="gh-total">${fmtIDR(subtotal)}</span>`;
      list.appendChild(head);
    }
    g.items.forEach((a) => list.appendChild(assetRow(a)));
  });

  root.querySelector("#btn-add-asset").onclick = () => openAssetSheet(null, root);
}

function assetRow(a) {
  const val = assetValueIDR(a);
  const cost = assetCostIDR(a);
  const pnl = val - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const qtyLabel = a.type === "stock_id" ? `${fmtNum(a.quantity)} lot` : `${a.quantity}${a.type === "stock_us" ? " sh" : ""}`;
  const srcLabel = a.manualOnly === true ? "🔒 manual"
    : a.priceSource ? `⚡ ${a.priceSource}` : "manual";
  const div = document.createElement("div");
  div.className = "asset-item";
  div.innerHTML = `
    <div>
      <div class="asset-sym">${escapeHtml(a.symbol || a.name)}</div>
      <div class="asset-meta">${qtyLabel} · avg ${fmtMoney(a.avgBuyPrice, a.currency)}</div>
      <div class="stale-note">harga ${fmtMoney(a.manualPrice, a.currency)} per ${a.manualPriceUpdatedAt || "?"} · ${srcLabel}</div>
    </div>
    <div class="asset-right">
      <div class="asset-val">${fmtIDR(val)}</div>
      <div class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${pnl >= 0 ? "+" : ""}${fmtIDR(pnl)} (${pnlPct.toFixed(1)}%)</div>
    </div>`;
  div.onclick = () => openAssetSheet(a, div.closest("#group-content"));
  return div;
}

function openAssetSheet(existing, contentRoot) {
  const a = existing || {
    type: assetFilter || "stock_id", symbol: "", name: "", quantity: "", avgBuyPrice: "",
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
    <div class="sub">💡 Saham IDX: jumlah dalam <b>lot</b> (1 lot = 100 lembar), harga per <b>lembar</b>. US: jumlah dalam shares (boleh desimal), harga per share USD. Crypto: symbol umum (BTC, ETH, SOL...) atau CoinGecko ID.</div>
    <label id="a-manual-wrap" style="margin-top:12px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--muted2)">
      <input type="checkbox" id="a-manual-only" style="width:auto" ${a.manualOnly === true ? "checked" : ""}/>
      🔒 Harga manual saja (skip auto-refresh)
    </label>
    <div class="sub" id="a-auto-hint"></div>
    ${existing ? `
    <div style="margin-top:14px; display:flex; gap:8px;">
      <button id="a-buy" class="btn" style="flex:1">💰 Catat Pembelian</button>
      <button id="a-sell" class="btn" style="flex:1">💸 Catat Penjualan</button>
    </div>` : ""}
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="a-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="a-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const AUTO_HINTS = {
    stock_id: "⚡ Auto price via iTick — isi API key di Setting → Integrasi Harga.",
    stock_us: "⚡ Auto price via Finnhub — isi API key di Setting → Integrasi Harga.",
    crypto: "⚡ Auto price via CoinGecko — gratis, ga butuh API key.",
  };

  const typeSel = el.querySelector("#a-type");
  const curSel = el.querySelector("#a-currency");
  const qtyLabel = el.querySelector("#a-qty-label");
  const syncType = () => {
    qtyLabel.textContent = typeSel.value === "stock_id" ? "Jumlah (lot)" : "Jumlah";
    if (typeSel.value === "stock_id") curSel.value = "IDR";
    if (typeSel.value === "stock_us") curSel.value = "USD";
    const isAuto = !!AUTO_HINTS[typeSel.value];
    el.querySelector("#a-auto-hint").textContent = AUTO_HINTS[typeSel.value] || "";
    el.querySelector("#a-manual-wrap").classList.toggle("hidden", !isAuto);
  };
  typeSel.onchange = syncType;
  syncType();
  if (existing) curSel.value = a.currency;

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
      manualOnly: el.querySelector("#a-manual-only").checked,
    };
    if (!data.symbol && !data.name) return toast("Isi symbol atau nama");
    if (!data.quantity) return toast("Isi jumlah");
    if (String(data.manualPrice) !== String(existing?.manualPrice ?? "")) {
      data.manualPriceUpdatedAt = todayStr();
    } else {
      data.manualPriceUpdatedAt = existing?.manualPriceUpdatedAt || todayStr();
    }
    closeSheet();
    if (existing) await patch("assets", existing.id, data);
    else await add("assets", data);
    toast("Asset disimpan ✓");
  };

  if (existing) {
    el.querySelector("#a-buy").onclick = () => openAssetBuySheet(existing);
    el.querySelector("#a-sell").onclick = () => openAssetSellSheet(existing);
    el.querySelector("#a-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.assetId === existing.id);
      if (used) return toast("Asset ini punya riwayat pembelian/penjualan — beresin transaksinya di History dulu, baru hapus asset-nya");
      if (!confirmDialog("Hapus asset ini?")) return;
      closeSheet();
      await remove("assets", existing.id);
      toast("Dihapus");
    };
  }
}

// ================= Catat Pembelian / Penjualan (TASK-3) =================
// Beli = transfer keluar dari akun ke "asset" (pola persis topup goal toGoalId): accountId =
// SUMBER (didebit), ga ada akun yang kekredit. Jual = kebalikannya, accountId jadi akun TUJUAN
// (dikredit) — pola sama withdraw goal (lihat store.js accountBalances()). Field id-nya SATU
// (`assetId`, sama buat keduanya) + field arah eksplisit `assetDir` ("buy"|"sell") — beda dari
// goal yang pakai DUA field id (toGoalId/fromGoalId) buat encode arah; di sini eksplisit field
// arah dipilih karena paling sedikit ambiguitas (satu identitas asset, satu penanda arah jelas).
//
// Weighted average buy price otomatis (avgBaru = (qtyLama×avgLama + qtyBaru×hargaBaru) /
// (qtyLama+qtyBaru)) — TASK-4 digabung ke sini karena tanpa itu fitur "Catat Pembelian" bakal
// langsung ngerusak avgBuyPrice di pemakaian pertama (setengah-jadi). Jual: qty berkurang,
// avgBuyPrice TIDAK berubah (konvensi standar) — realized P&L ga dilacak di v1, cukup di note.
//
// Edit SENGAJA TIDAK didukung (beda dari topup/withdraw goal yang full CRUD) — weighted average
// ga bisa di-reverse dengan aman kalau transaksi lama diedit ulang (butuh replay history buat
// rekonstruksi avg sebelumnya). Klik dari History cuma buka detail read-only + Hapus (hapus
// me-reverse QUANTITY doang secara exact, avgBuyPrice ga ikut di-reverse — dikasih tau eksplisit
// ke user, arahkan ke Edit Asset kalau perlu koreksi manual). Salah catat → hapus + catat ulang.
export function openAssetBuySheet(asset, existingTx = null) { openAssetTradeSheet(asset, "buy", existingTx); }
export function openAssetSellSheet(asset, existingTx = null) { openAssetTradeSheet(asset, "sell", existingTx); }

function openAssetTradeSheet(asset, dir, existingTx) {
  const isBuy = dir === "buy";

  if (existingTx) {
    const acct = state.accounts.find((a) => a.id === existingTx.accountId);
    const el = openSheet(`
      ${sheetHead(isBuy ? "Detail Pembelian" : "Detail Penjualan")}
      <div class="sub" style="margin-bottom:10px">Transaksi ${isBuy ? "pembelian" : "penjualan"} asset ga bisa diedit langsung (biar avg buy price ga rusak) — hapus &amp; catat ulang kalau salah.</div>
      <div class="table-like">
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Asset</span><span>${escapeHtml(asset.symbol || asset.name)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Jumlah</span><span>${asset.type === "stock_id" ? `${fmtNum(existingTx.assetQty)} lot` : existingTx.assetQty}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Harga/unit</span><span>${fmtMoney(existingTx.assetPrice, asset.currency)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">${isBuy ? "Dari" : "Ke"} Akun</span><span>${escapeHtml(acct?.name || "?")}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Tanggal</span><span>${existingTx.date}</span></div>
      </div>
      <button id="at-delete" class="btn btn-danger btn-block" style="margin-top:18px">Hapus Transaksi</button>
    `);
    el.querySelector("[data-close]").onclick = closeSheet;
    el.querySelector("#at-delete").onclick = async () => {
      if (!confirmDialog(`Hapus transaksi ${isBuy ? "pembelian" : "penjualan"} ini? Qty asset bakal disesuaikan lagi, TAPI avg buy price GA ikut di-reverse (kompleks) — cek Edit Asset kalau perlu dikoreksi manual.`)) return;
      closeSheet();
      const qtyDelta = isBuy ? -(Number(existingTx.assetQty) || 0) : (Number(existingTx.assetQty) || 0);
      const newQty = Math.max(0, (Number(asset.quantity) || 0) + qtyDelta);
      await patch("assets", asset.id, { quantity: newQty });
      await remove("transactions", existingTx.id);
      toast("Transaksi dihapus, qty asset disesuaikan");
    };
    return;
  }

  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const curQty = Number(asset.quantity) || 0;
  const curAvg = Number(asset.avgBuyPrice) || 0;
  const qtyLabel = asset.type === "stock_id" ? "Jumlah (lot)" : "Jumlah";

  const el = openSheet(`
    ${sheetHead(isBuy ? `Catat Pembelian: ${escapeHtml(asset.symbol || asset.name)}` : `Catat Penjualan: ${escapeHtml(asset.symbol || asset.name)}`)}
    <label>${qtyLabel}</label>
    <input id="at-qty" inputmode="decimal" placeholder="0" autocomplete="off" />
    <label>Harga / unit (${asset.currency})</label>
    <input id="at-price" inputmode="decimal" placeholder="${curAvg || 0}" autocomplete="off" />
    <div id="at-hint" class="sub" style="margin-top:4px"></div>
    <label>${isBuy ? "Dari Akun" : "Ke Akun"}</label>
    <select id="at-account">
      ${accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <label>Tanggal</label>
    <input id="at-date" type="date" value="${todayStr()}" />
    <label>Catatan (opsional)</label>
    <input id="at-note" type="text" placeholder="${isBuy ? "cth: nambah posisi" : "cth: profit taking"}" />
    <button id="at-save" class="btn btn-primary btn-block" style="margin-top:18px">Simpan</button>
  `);

  const qtyInput = el.querySelector("#at-qty");
  const priceInput = el.querySelector("#at-price");
  const hint = el.querySelector("#at-hint");
  setTimeout(() => qtyInput.focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  const parseDec = (v) => parseFloat(String(v).replace(",", ".")) || 0;

  const updateHint = () => {
    const qty = parseDec(qtyInput.value);
    const price = parseDec(priceInput.value);
    if (isBuy) {
      if (qty > 0 && price > 0) {
        const newAvg = (curQty * curAvg + qty * price) / (curQty + qty);
        hint.textContent = `Avg buy: ${fmtNum(curAvg)} → ${fmtNum(Math.round(newAvg * 100) / 100)}`;
      } else {
        hint.textContent = curQty > 0 ? `Avg buy sekarang: ${fmtNum(curAvg)}` : "";
      }
    } else {
      hint.textContent = `Dimiliki sekarang: ${asset.type === "stock_id" ? `${fmtNum(curQty)} lot` : curQty}`;
    }
  };
  qtyInput.addEventListener("input", updateHint);
  priceInput.addEventListener("input", updateHint);
  updateHint();

  el.querySelector("#at-save").onclick = async () => {
    const qty = parseDec(qtyInput.value);
    const price = parseDec(priceInput.value);
    const accountId = el.querySelector("#at-account").value;
    const date = el.querySelector("#at-date").value;
    const note = el.querySelector("#at-note").value.trim();

    if (!qty || qty <= 0) return toast("Isi jumlah unit");
    if (!price || price <= 0) return toast("Isi harga per unit");
    if (!date) return toast("Tanggal belum diisi");
    if (!isBuy && qty > curQty) {
      return toast(`Ga bisa jual lebih dari yang dimiliki (${asset.type === "stock_id" ? fmtNum(curQty) + " lot" : curQty})`);
    }

    const shares = asset.type === "stock_id" ? qty * 100 : qty;
    const amount = shares * price;
    const newQty = isBuy ? curQty + qty : curQty - qty;
    const newAvg = isBuy && curQty + qty > 0 ? (curQty * curAvg + qty * price) / (curQty + qty) : curAvg;

    closeSheet();
    await patch("assets", asset.id, {
      quantity: newQty,
      avgBuyPrice: isBuy ? Math.round(newAvg * 100) / 100 : curAvg,
    });
    await add("transactions", {
      type: "transfer", amount, date, month: monthOf(date),
      accountId, toAccountId: null, categoryId: null,
      assetId: asset.id, assetDir: dir, assetQty: qty, assetPrice: price,
      note: note || `${isBuy ? "Beli" : "Jual"} ${asset.symbol || asset.name}`,
    });
    toast(isBuy ? "Pembelian tercatat ✓" : "Penjualan tercatat ✓");
  };
}

// ================= LIQUID =================
function renderLiquid(root) {
  const accounts = activeAccounts();
  const bal = accountBalances();
  const rate = effectiveRate();
  const total = totalCashIDR();

  root.innerHTML = `
    <div class="card">
      <div class="sub" style="margin-bottom:6px">Total liquid: <b style="color:#93c5fd">${fmtIDR(total)}</b></div>
      <div id="liq-list">
        ${accounts.length === 0 ? `<div class="empty">Belum ada akun. Buat di Setting → Akun.</div>` : ""}
      </div>
      <div class="sub" style="margin-top:10px">Saldo dihitung otomatis dari saldo awal + semua transaksi. Kelola akun di <a href="#/accounts" style="color:var(--blue)">Setting → Akun</a>.</div>
    </div>
  `;

  const list = root.querySelector("#liq-list");
  accounts
    .slice()
    .sort((a, b) => {
      const bv = (x) => (x.currency === "USD" ? (bal[x.id] || 0) * rate : bal[x.id] || 0);
      return bv(b) - bv(a);
    })
    .forEach((a) => {
      const b = bal[a.id] || 0;
      const idr = a.currency === "USD" ? b * rate : b;
      const div = document.createElement("div");
      div.className = "asset-item";
      div.style.cursor = "default";
      div.innerHTML = `
        <span style="width:10px;height:10px;border-radius:50%;background:${a.color || "#60a5fa"};flex-shrink:0"></span>
        <div>
          <div class="asset-sym" style="font-size:13px">${escapeHtml(a.name)}</div>
          <div class="asset-meta">${a.currency}</div>
        </div>
        <div class="asset-right">
          <div class="asset-val">${fmtMoney(b, a.currency)}</div>
          ${a.currency === "USD" ? `<div class="stale-note">≈ ${fmtIDR(idr)}</div>` : ""}
        </div>`;
      list.appendChild(div);
    });
}

// ================= DEBT =================
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
    const isPaidOff = (Number(d.totalOutstanding) || 0) <= 0;
    const dueSoon = !isPaidOff && d.dueDay && d.dueDay - today >= 0 && d.dueDay - today <= 3;
    div.innerHTML = `
      <div>
        <div class="asset-sym" style="font-size:13px">${escapeHtml(d.name)} ${isPaidOff ? '<span class="badge badge-green">Lunas 🎉</span>' : ""}</div>
        <div class="asset-meta">cicilan ${fmtIDR(d.monthlyInstalment)}/bln · sisa ${d.remainingMonths ?? "?"} bln</div>
        ${d.dueDay && !isPaidOff ? `<div class="stale-note">jatuh tempo tgl ${d.dueDay} ${dueSoon ? '<span class="badge badge-yellow">SEGERA</span>' : ""}</div>` : ""}
      </div>
      <div class="asset-right">
        <div class="asset-val" style="color:${isPaidOff ? "var(--green)" : "var(--red)"}">${fmtIDR(d.totalOutstanding)}</div>
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
    <div class="sub">💡 Pas catat expense cicilan, pilih hutang ini di "Potong hutang?" — outstanding & sisa bulan kepotong otomatis. Field di atas cuma buat setup awal / koreksi manual.</div>
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
      const used = state.transactions.some((t) => t.debtId === existing.id);
      if (used) return toast("Hutang ini punya riwayat pembayaran ber-link — lepas link-nya (edit transaksi, kosongin 'Potong hutang?') di History dulu, baru hapus");
      if (!confirmDialog("Hapus hutang ini? (misal karena sudah lunas)")) return;
      closeSheet();
      await remove("debts", existing.id);
      toast("Mantap, satu hutang hilang 🎉");
    };
  }
}

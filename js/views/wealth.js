import {
  state, activeAccounts, accountBalances, netWorthIDR, totalCashIDR,
  totalAssetsIDR, totalCapexIDR, totalDebtIDR, totalGoalSavingsIDR, assetValueIDR, assetCostIDR,
  capexLocalValue, bondLocalValue, bondNextCouponHint, effectiveRate, monthSummary, milestoneProgress, recentAvgSurplus,
  monthsBetween, projectSeries, snapshotNetWorth,
  isCreditAccount, creditUsed, creditRemaining, totalCreditDebtIDR,
} from "../store.js";
import { add, patch, remove, updateSettings } from "../db.js";
import {
  fmtIDR, fmtMoney, fmtNum, fmtIDRPlain, fmtMoneyPlain, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, lastNMonths, monthLabel, todayStr, confirmDialog, monthOf,
  fmtShort, milestonePaceLine, currentMonth, addMonths, isBlurred, blurNum,
  nowTimeStr, DEFAULT_TX_TIME,
} from "../utils.js";
import { refreshPrices, refreshableAssets } from "../prices.js";
import { openAcctSheet } from "./accounts.js";

let groupTab = "total";   // total | assets | liquid | debt
let chartTab = "nw";      // nw | cashflow | projection
let assetFilter = "";     // "" = semua tipe
let charts = [];

export const ASSET_TYPES = {
  stock_id: "Saham IDX",
  stock_us: "Saham/ETF US",
  mutual_fund: "Reksa Dana",
  deposito: "Deposito",
  gold: "Emas",
  crypto: "Crypto",
  bond: "Obligasi / SBN",
  capex: "CAPEX (Barang Susut)",
  other: "Lainnya",
};

// Tipe yang boleh diaktifin toggle "Jumlah N/A" (qtyless, lump-sum posisi tunggal) — cuma tipe
// manual yang belum punya model single-unit sendiri (CAPEX/Bond udah, qty selalu 1 dipaksa tanpa
// toggle). Saham/US/crypto DIKELUARIN — auto-refresh perlu qty×harga/unit.
const QTYLESS_TYPES = ["mutual_fund", "deposito", "gold", "other"];

const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };

export function render(root) {
  destroyCharts();

  const nw = netWorthIDR();
  const cash = totalCashIDR();
  const assets = totalAssetsIDR();
  const debt = totalDebtIDR();

  root.innerHTML = `
    <div class="sumtabs">
      ${sumBtn("total", "Total", blurNum(fmtShort(nw)), nw >= 0 ? "var(--blue)" : "var(--red)")}
      ${sumBtn("assets", "Assets", blurNum(fmtShort(assets)), "var(--green)")}
      ${sumBtn("liquid", "Liquid", blurNum(fmtShort(cash)), "var(--blue)")}
      ${sumBtn("debt", "Debt", blurNum(fmtShort(debt)), "var(--red)")}
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

// ================= TOTAL =================
function renderTotal(root) {
  const nw = netWorthIDR();
  const cash = totalCashIDR();
  const assetsRaw = totalAssetsIDR(); // termasuk CAPEX apa adanya
  const capex = totalCapexIDR();
  const includeCapex = state.settings.includeCapexInNetWorth === true;
  const investAssets = assetsRaw - capex; // baris "Assets" di breakdown SELALU exclude CAPEX,
  // CAPEX ditampilin baris terpisah (di bawah) supaya breakdown-nya tetap sum persis ke NET WORTH
  // baik toggle include-nya ON maupun OFF (lihat CLAUDE.md bullet CAPEX).
  const goalSavings = totalGoalSavingsIDR();
  const debt = totalDebtIDR();
  const milestone = milestoneProgress();
  const paceLine = milestonePaceLine(milestone);
  const rate = effectiveRate();
  const hasCapexAssets = state.assets.some((a) => a.type === "capex");
  // CC lewat DEBT PATH sekarang (`totalCashIDR()` udah EXCLUDE utang kartu, `totalDebtIDR()` udah
  // INCLUDE-nya — lihat calc.js & DECISIONS.md) — jadi `cash` di atas udah "bersih" (ga perlu
  // dikoreksi lagi kayak dulu), tinggal misahin `debt` jadi 2 baris tampilan (cicilan vs kartu)
  // pola SAMA kayak CAPEX misahin investAssets dari capex: debtsOnly + totalCreditDebt = debt,
  // invariant sum tetap kejaga ke NET WORTH.
  const hasCreditAccounts = state.accounts.some((a) => isCreditAccount(a) && !a.isArchived);
  const totalCreditDebt = totalCreditDebtIDR();
  const debtsOnly = debt - totalCreditDebt;

  root.innerHTML = `
    <div class="networth-banner">
      <div class="label">Net Worth</div>
      <div class="big-amount" style="color:var(--blue)">${fmtIDR(nw)}</div>
      ${milestone.hidden ? "" : `
      <div class="progress" style="margin-top:12px; height:8px;">
        <div style="width:${milestone.achieved ? 100 : milestone.pct}%; background:${milestone.achieved ? "linear-gradient(90deg,#b08f57,#d9bc7f)" : "linear-gradient(90deg,#5f7fa3,#8bacd0)"}"></div>
      </div>
      <div class="sub" style="color:${milestone.achieved ? "#d9bc7f" : "var(--muted2)"}">${milestone.achieved
        ? `🏆 Tercapai! Net worth ${fmtIDR(milestone.nw)} ≥ target ${fmtIDR(milestone.target)}`
        : `🏆 Main Milestone: ${milestone.pct.toFixed(1)}% menuju ${fmtIDR(milestone.target)}`}</div>
      ${paceLine ? `<div class="sub" style="margin-top:2px">${escapeHtml(paceLine)}</div>` : ""}`}
      <div class="sub" style="color:var(--muted)">Kurs USD ${fmtNum(rate)}${state.settings.usdIdrManual ? " (manual)" : state.usdIdr ? ` · auto per ${state.usdIdr.date}` : ""}</div>
    </div>

    <div class="card">
      <div class="table-like">
        ${totalRow("💧 Liquid", cash, "var(--blue)")}
        ${totalRow("📈 Assets", investAssets, "var(--green)")}
        ${capex > 0 && includeCapex ? totalRow("🏗️ CAPEX", capex, "#d9bc7f") : ""}
        ${goalSavings > 0 ? totalRow("🎯 Goals", goalSavings, "#b09ac9") : ""}
        ${hasCreditAccounts ? totalRow("🪪 Kartu Kredit", -totalCreditDebt, "var(--red)") : ""}
        ${totalRow(hasCreditAccounts ? "💳 Cicilan" : "💳 Debt", -debtsOnly, "var(--red)")}
        <div style="border-top:1px solid var(--border); margin-top:8px; padding-top:10px; display:flex; justify-content:space-between">
          <span style="font-weight:800; font-size:13px">NET WORTH</span>
          <span style="font-weight:800; font-size:13px; color:var(--blue)">${fmtIDR(nw)}</span>
        </div>
      </div>
      ${hasCapexAssets ? `
      <label style="display:flex; align-items:center; gap:8px; margin-top:12px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--muted2)">
        <input type="checkbox" id="capex-toggle" style="width:auto" ${includeCapex ? "checked" : ""}/>
        🏗️ Sertakan CAPEX (${fmtIDR(capex)}) di Net Worth
      </label>` : ""}
    </div>

    <div class="card">
      <div class="chart-tabs">
        <button data-chart="nw" class="${chartTab === "nw" ? "active" : ""}">📈 Tren Net Worth</button>
        <button data-chart="cashflow" class="${chartTab === "cashflow" ? "active" : ""}">💸 Income vs Expense</button>
        <button data-chart="projection" class="${chartTab === "projection" ? "active" : ""}">🚀 Proyeksi</button>
      </div>
      <div id="chart-wrap"><canvas id="chart-main" height="170"></canvas></div>
      <div id="chart-extra"></div>
    </div>
  `;

  root.querySelectorAll("[data-chart]").forEach((b) => {
    b.onclick = () => { chartTab = b.dataset.chart; render(root.parentElement); };
  });

  const capexToggle = root.querySelector("#capex-toggle");
  if (capexToggle) {
    capexToggle.onchange = async (e) => {
      await updateSettings({ includeCapexInNetWorth: e.target.checked });
      // re-render otomatis via store.on() setelah settings berubah — ga perlu manual di sini,
      // tapi toast biar user dapet konfirmasi instan (settings/main patch-nya async).
      toast(e.target.checked ? "CAPEX ikut dihitung di Net Worth ✓" : "CAPEX di luar Net Worth ✓");
    };
  }

  renderChart(root, milestone);
}

const totalRow = (label, val, color) => `
  <div style="display:flex; justify-content:space-between; padding:7px 0; font-size:13px">
    <span style="color:var(--muted2)">${label}</span>
    <span style="font-weight:700; color:${color}">${val < 0 ? "−" : ""}${fmtIDR(Math.abs(val))}</span>
  </div>`;

function renderChart(root, milestone) {
  const target = milestone.target;
  root.querySelector("#chart-extra").innerHTML = ""; // cuma dipake chartTab === "projection"
  if (!window.Chart) {
    root.querySelector("#chart-wrap").innerHTML = `<div class="empty">Chart library belum ke-load (butuh online sekali).</div>`;
    return;
  }
  const gridColor = "#272e3a";
  Chart.defaults.color = "#78828f";
  Chart.defaults.font.size = 10;
  const canvas = root.querySelector("#chart-main");

  if (chartTab === "projection") {
    renderProjectionChart(root, canvas, gridColor, milestone);
  } else if (chartTab === "nw") {
    const snaps = state.snapshots.slice(-12);
    if (snaps.length === 0) {
      root.querySelector("#chart-wrap").innerHTML = `<div class="empty">Belum ada snapshot.</div>`;
      return;
    }
    // Snapshot nyimpen total* MENTAH (totalCash/totalAssets/totalCapex/totalGoalSavings/
    // totalDebt) TERPISAH dari `netWorth` yang udah "jadi" (netWorth dihitung pakai toggle
    // settings.includeCapexInNetWorth SAAT snapshot itu dibuat — kalau user gonta-ganti toggle,
    // satu garis "Net Worth" doang bakal keliatan "lompat" padahal cuma definisi yang beda, bukan
    // net worth beneran berubah). Dua garis di bawah SELALU ditampilin (bukan cuma pas ada CAPEX)
    // biar user gampang bandingin, dihitung ULANG dari total* mentah lewat `snapshotNetWorth()`
    // (helper modul ini) jadi KONSISTEN pakai definisi yang SAMA di semua titik.
    charts.push(new Chart(canvas, {
      type: "line",
      data: {
        labels: snaps.map((s) => monthLabel(s.month || s.id)),
        datasets: [
          { label: "Net Worth (+ CAPEX)", data: snaps.map((s) => snapshotNetWorth(s, true)), borderColor: "#8bacd0",
            backgroundColor: "rgba(139,172,208,.12)", fill: true, tension: .3, pointRadius: 3 },
          { label: "Net Worth (tanpa CAPEX)", data: snaps.map((s) => snapshotNetWorth(s, false)), borderColor: "#d9bc7f",
            fill: false, tension: .3, pointRadius: 2 },
          { label: "Target", data: snaps.map(() => target), borderColor: "#8fbe9f",
            borderDash: [6, 5], pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 9 } } } },
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
          { label: "Income", data: sums.map((s) => s.income), backgroundColor: "#8fbe9f", borderRadius: 4 },
          { label: "Expense", data: sums.map((s) => s.expense), backgroundColor: "#d99494", borderRadius: 4 },
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

// ================= PROYEKSI (TASK-1) =================
// Nabung vs Aktual vs Return terkonfigurasi. Zona historis (solid, "Aktual") pakai data snapshot
// asli; zona proyeksi (dashed) SEMUANYA mulai dari titik net worth AKTUAL bulan ini — "Proyeksi
// (nabung)" = skenario "kalau MULAI SEKARANG stop dapet return, cuma nabung surplus doang".
// TIDAK ada garis historis "Nabung doang" terpisah (sempat ada, dihapus lagi) — dua garis
// "kumulatif nabung dari awal" vs "Proyeksi (nabung)" ke depan kelihatan kontradiktif/ganjil
// berdampingan (mirip nama, beda anchor & makna), jadi cuma satu konsep "nabung doang" yang
// ditampilin: yang forward-looking dari sekarang.
function renderProjectionChart(root, canvas, gridColor, milestone) {
  const wrap = root.querySelector("#chart-wrap");
  if (state.snapshots.length < 2) {
    wrap.innerHTML = `<div class="empty">Butuh min. 2 bulan data.<br/><a href="#/settings" style="color:var(--blue)">Isi Snapshot Historis →</a></div>`;
    return;
  }

  const nowMonth = currentMonth();
  const rateA = Number(state.settings.projectionRateA ?? 0.05);
  const rateB = Number(state.settings.projectionRateB ?? 0.07);
  const targetDate = state.settings.targetDate;
  const horizonMonths = targetDate ? Math.max(1, monthsBetween(nowMonth, targetDate)) : 60;

  // Garis "Aktual" historis dihitung ULANG pakai toggle CAPEX yang berlaku SEKARANG (bukan
  // `s.netWorth` mentah, yang bisa reflect toggle lama kalau user pernah gonta-ganti) — biar
  // konsisten sama `nw` (titik awal semua garis proyeksi di bawah, dari `netWorthIDR()` yang
  // juga toggle-aware). Beda dari chart Tren Net Worth yang sengaja nampilin DUA garis; di sini
  // cuma SATU (ngikut toggle) biar chart 5-garis ini ga makin padat.
  const includeCapexNow = state.settings.includeCapexInNetWorth === true;
  const firstSnapMonth = state.snapshots[0].month || state.snapshots[0].id;
  const actualHist = state.snapshots.map((s) => ({ month: s.month || s.id, value: snapshotNetWorth(s, includeCapexNow) }));

  const nw = netWorthIDR();
  const avgSurplus = recentAvgSurplus(nowMonth, 3) ?? 0;
  const projSavings = projectSeries({ startValue: nw, startMonth: nowMonth, months: horizonMonths, monthlyContribution: avgSurplus, annualRate: 0 });
  const projA = projectSeries({ startValue: nw, startMonth: nowMonth, months: horizonMonths, monthlyContribution: avgSurplus, annualRate: rateA });
  const projB = projectSeries({ startValue: nw, startMonth: nowMonth, months: horizonMonths, monthlyContribution: avgSurplus, annualRate: rateB });

  // Satu axis bulan gabungan (historis + proyeksi) — tiap dataset diisi `null` di luar rentangnya
  // sendiri, Chart.js otomatis bikin gap (bukan garis nyambung ke titik yang ga relevan).
  const lastMonth = addMonths(nowMonth, horizonMonths);
  const allMonths = [];
  for (let m = firstSnapMonth; m <= lastMonth; m = addMonths(m, 1)) allMonths.push(m);
  const mapOf = (series) => Object.fromEntries(series.map((p) => [p.month, p.value]));
  const dataFor = (map) => allMonths.map((m) => (m in map ? map[m] : null));

  const actualMap = mapOf(actualHist);
  const projSavingsMap = mapOf(projSavings);
  const projAMap = mapOf(projA);
  const projBMap = mapOf(projB);

  charts.push(new Chart(canvas, {
    type: "line",
    data: {
      labels: allMonths.map(monthLabel),
      datasets: [
        { label: "Aktual", data: dataFor(actualMap), borderColor: "#8bacd0",
          backgroundColor: "rgba(139,172,208,.12)", fill: true, tension: .3, pointRadius: 2, spanGaps: false },
        { label: "Proyeksi (nabung)", data: dataFor(projSavingsMap), borderColor: "#78828f",
          borderDash: [5, 4], pointRadius: 0, fill: false, spanGaps: false },
        { label: `Proyeksi ${(rateA * 100).toFixed(0)}%/th`, data: dataFor(projAMap), borderColor: "#a9d4b8",
          borderDash: [5, 4], pointRadius: 0, fill: false, spanGaps: false },
        { label: `Proyeksi ${(rateB * 100).toFixed(0)}%/th`, data: dataFor(projBMap), borderColor: "#5f9678",
          borderDash: [5, 4], pointRadius: 0, fill: false, spanGaps: false },
        ...(milestone.hidden ? [] : [{ label: "Target", data: allMonths.map(() => milestone.target),
          borderColor: "#d9bc7f", borderDash: [2, 4], pointRadius: 0, fill: false }]),
      ],
    },
    options: {
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 9 } } } },
      scales: {
        y: { grid: { color: gridColor }, ticks: { callback: (v) => isBlurred() ? "***" : fmtShort(v) } },
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
      },
    },
  }));

  // Ringkasan teks: bulan pertama tiap skenario proyeksi nyentuh target (null = di luar horizon).
  const extra = root.querySelector("#chart-extra");
  const summaryLine = milestone.hidden
    ? `Set 🏆 Main Milestone di Setting buat liat estimasi kapan tiap skenario capai target.`
    : (() => {
        const hitMonth = (series) => series.find((p) => p.value >= milestone.target)?.month || null;
        const fmtHit = (m) => m ? monthLabel(m) : "di luar horizon";
        return `Dengan surplus rata-rata ${fmtIDRPlain(avgSurplus)}/bln: nabung doang capai target ${fmtHit(hitMonth(projSavings))}; dengan ${(rateA * 100).toFixed(0)}% → ${fmtHit(hitMonth(projA))}; dengan ${(rateB * 100).toFixed(0)}% → ${fmtHit(hitMonth(projB))}.`;
      })();
  extra.innerHTML = `
    <div class="sub" style="margin-top:10px">${summaryLine}</div>
    <div class="row" style="margin-top:10px; gap:8px">
      <div><label style="font-size:11px">Rate A (%/th)</label><input id="proj-rate-a" type="number" inputmode="decimal" step="0.5" min="0" max="100" value="${(rateA * 100).toFixed(1)}" /></div>
      <div><label style="font-size:11px">Rate B (%/th)</label><input id="proj-rate-b" type="number" inputmode="decimal" step="0.5" min="0" max="100" value="${(rateB * 100).toFixed(1)}" /></div>
    </div>`;
  extra.querySelector("#proj-rate-a").onchange = async (e) => {
    const v = parseFloat(e.target.value);
    if (isNaN(v) || v < 0) return toast("Rate ga valid");
    await updateSettings({ projectionRateA: v / 100 });
  };
  extra.querySelector("#proj-rate-b").onchange = async (e) => {
    const v = parseFloat(e.target.value);
    if (isNaN(v) || v < 0) return toast("Rate ga valid");
    await updateSettings({ projectionRateB: v / 100 });
  };
}

// ================= ASSETS =================
function renderAssets(root) {
  // Bond yang udah redeemed (TASK-4) "hilang dari asset aktif" (pola diminta) — TETAP ada di
  // Firestore (jejak riwayat, lihat calc.js bullet Bond), cuma difilter dari list/filter-dropdown/
  // summary tab ini. Nilai net worth-nya sendiri udah 0 otomatis (bondValueIDR), jadi filter di
  // sini murni declutter tampilan, BUKAN yang bikin net worth benar.
  const all = state.assets.filter((a) => !(a.type === "bond" && a.redeemed === true));
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
        ${all.length === 0 ? `<div class="empty">Belum ada asset.</div>` : ""}
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
      // Error mentah (network/CORS/dll) ditampilin eksplisit — PWA mobile susah buka DevTools,
      // jadi ini satu-satunya cara user liat kenapa provider gagal tanpa laptop.
      if (r.errors?.idx) msg += ` · IDX: ${r.errors.idx}`;
      if (r.errors?.us) msg += ` · US: ${r.errors.us}`;
      if (r.errors?.crypto) msg += ` · Crypto: ${r.errors.crypto}`;
      toast(msg, 6000);
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
  const isCapex = a.type === "capex";
  const isBond = a.type === "bond";
  const isQtyless = a.qtyless === true;
  // Jumlah unit ikut blur mode juga (bukan cuma nilai Rp) — "berapa lot/lembar yang gue punya"
  // sama sensitifnya buat disembunyiin pas layar keliatan orang lain. blurNum() manual di sini
  // karena ini bukan lewat fmtIDR/fmtUSD (lihat CLAUDE.md bullet blur mode).
  const qtyNum = a.type === "stock_id" ? fmtNum(a.quantity) : String(a.quantity);
  const qtySuffix = a.type === "stock_id" ? " lot" : a.type === "stock_us" ? " sh" : "";
  const qtyLabel = `${blurNum(qtyNum)}${qtySuffix}`;
  const srcLabel = a.manualOnly === true ? "🔒 manual"
    : a.priceSource ? `⚡ ${a.priceSource}` : "manual";
  let metaLine, staleLine;
  if (isCapex) {
    metaLine = `Beli ${fmtMoney(a.avgBuyPrice, a.currency)} · susut ${(Number(a.depreciationPctMonth || 0) * 100).toFixed(1)}%/bln`;
    staleLine = `nilai sekarang ${fmtMoney(capexLocalValue(a), a.currency)} per ${todayStr()} · beli ${a.purchaseDate || "?"}`;
  } else if (isBond) {
    // Bond (TASK-4): meta = pokok + kupon% (info doang, ga dihitung otomatis). Stale line = hitung
    // mundur ke maturity — badge ⚠️ kalau udah lewat tapi belum di-redeem (redeemed bond sendiri
    // udah difilter dari list ini, lihat renderAssets()).
    const ratePct = (Number(a.couponRatePA) || 0) * 100;
    const period = Math.max(1, Number(a.couponPeriodMonths) || 1);
    metaLine = `Pokok ${fmtMoney(a.principal, a.currency)}${ratePct > 0 ? ` · kupon ${ratePct.toFixed(1)}%/th tiap ${period} bln` : ""}`;
    const isPastMaturity = a.maturityDate && a.maturityDate <= todayStr();
    const monthsLeft = a.maturityDate ? monthsBetween(currentMonth(), a.maturityDate.slice(0, 7)) : null;
    staleLine = isPastMaturity
      ? `⚠️ Jatuh tempo ${a.maturityDate} — cairkan pokok`
      : `jatuh tempo ${a.maturityDate || "?"}${monthsLeft !== null ? ` · ${monthsLeft} bln lagi` : ""}`;
  } else if (isQtyless) {
    // Qtyless (lump-sum, "Jumlah N/A") — quantity SELALU 1 di data, tapi ga ada artinya buat
    // ditampilin ke user (bukan "punya 1 unit", ini posisi tunggal yang dilacak via nilai
    // langsung) — makanya "N/A" polos, bukan angka 1 yang bisa disalahartikan sebagai qty asli.
    metaLine = `Jumlah: N/A · Modal ${fmtMoney(a.avgBuyPrice, a.currency)}`;
    staleLine = `nilai sekarang ${fmtMoney(a.manualPrice, a.currency)} per ${a.manualPriceUpdatedAt || "?"} · ${srcLabel}`;
  } else {
    metaLine = `${qtyLabel} · avg ${fmtMoney(a.avgBuyPrice, a.currency)}`;
    staleLine = `harga ${fmtMoney(a.manualPrice, a.currency)} per ${a.manualPriceUpdatedAt || "?"} · ${srcLabel}`;
  }
  const div = document.createElement("div");
  div.className = "asset-item";
  div.innerHTML = `
    <div>
      <div class="asset-sym">${escapeHtml(a.name || a.symbol)}</div>
      <div class="asset-meta">${metaLine}</div>
      <div class="stale-note">${staleLine}</div>
    </div>
    <div class="asset-right">
      <div class="asset-val">${fmtIDR(val)}</div>
      <div class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${pnl >= 0 ? "+" : ""}${fmtIDR(pnl)} (${pnlPct.toFixed(1)}%)</div>
    </div>`;
  div.onclick = () => openAssetSheet(a, div.closest("#group-content"));
  return div;
}

export function openAssetSheet(existing, contentRoot) {
  const a = existing || {
    type: assetFilter || "stock_id", symbol: "", name: "", quantity: "", avgBuyPrice: "",
    currency: "IDR", manualPrice: "", purchaseDate: todayStr(), depreciationPctMonth: "",
    principal: "", couponRatePA: "", couponPeriodMonths: 1, maturityDate: "",
    couponAccountId: "", maturityAccountId: "",
  };
  const accountsForBond = activeAccounts();

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Asset" : "Tambah Asset")}
    <label>Tipe</label>
    <select id="a-type">
      ${Object.entries(ASSET_TYPES).map(([k, v]) => `<option value="${k}" ${k === a.type ? "selected" : ""}>${v}</option>`).join("")}
    </select>
    <div class="row">
      <div id="a-symbol-wrap"><label id="a-symbol-label">Symbol / Kode</label><input id="a-symbol" placeholder="BBCA / VOO" value="${escapeHtml(a.symbol || "")}" /></div>
      <div><label id="a-name-label">Nama (opsional)</label><input id="a-name" placeholder="Bank Central Asia" value="${escapeHtml(a.name || "")}" /></div>
    </div>
    <div class="row" id="a-qty-row">
      <div id="a-qty-wrap"><label id="a-qty-label">Jumlah</label><input id="a-qty" inputmode="decimal" placeholder="10" value="${a.quantity ?? ""}" /></div>
      <div><label>Currency</label>
        <select id="a-currency">
          <option value="IDR" ${a.currency === "IDR" ? "selected" : ""}>IDR</option>
          <option value="USD" ${a.currency === "USD" ? "selected" : ""}>USD</option>
        </select>
      </div>
    </div>
    <label id="a-qtyless-wrap" class="hidden" style="margin-top:-6px; margin-bottom:12px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--muted2)">
      <input type="checkbox" id="a-qtyless" style="width:auto" ${a.qtyless === true ? "checked" : ""}/>
      🔢 Jumlah N/A (lump-sum)
    </label>
    <div class="row">
      <div id="a-avg-wrap"><label id="a-avg-label">Avg Buy / unit</label><input id="a-avg" inputmode="decimal" placeholder="6710" value="${a.avgBuyPrice ?? ""}" /></div>
      <div id="a-price-wrap"><label id="a-price-label">Harga sekarang / unit</label><input id="a-price" inputmode="decimal" placeholder="6175" value="${a.manualPrice ?? ""}" /></div>
    </div>
    <div class="row hidden" id="a-capex-row">
      <div><label>Tanggal Beli</label><input id="a-purchase-date" type="date" value="${a.purchaseDate || todayStr()}" /></div>
      <div><label>Susut / bulan (%)</label><input id="a-deprec-pct" type="number" inputmode="decimal" step="0.1" min="0" max="100" placeholder="2" value="${a.depreciationPctMonth ? (Number(a.depreciationPctMonth) * 100) : ""}" /></div>
    </div>
    <div class="row hidden" id="a-bond-row1">
      <div><label>Pokok (Rp)</label><input id="a-bond-principal" inputmode="numeric" placeholder="5.000.000" value="${a.principal ? fmtNum(a.principal) : ""}" /></div>
      <div><label>Jatuh Tempo</label><input id="a-bond-maturity" type="date" value="${a.maturityDate || ""}" /></div>
    </div>
    <div class="row hidden" id="a-bond-row2">
      <div><label>Kupon %/tahun</label><input id="a-bond-rate" type="number" inputmode="decimal" step="0.1" min="0" max="100" placeholder="6.9" value="${a.couponRatePA ? (Number(a.couponRatePA) * 100) : ""}" /></div>
      <div><label>Periode (bln)</label><input id="a-bond-period" type="number" inputmode="numeric" min="1" placeholder="1" value="${a.couponPeriodMonths || 1}" /></div>
    </div>
    <div class="row hidden" id="a-bond-row3">
      <div><label>Tgl Beli</label><input id="a-bond-issue" type="date" value="${a.purchaseDate || todayStr()}" /></div>
      <div><label>Akun Kupon</label>
        <select id="a-bond-coupon-acct">${accountsForBond.map((acc) => `<option value="${acc.id}" ${acc.id === a.couponAccountId ? "selected" : ""}>${escapeHtml(acc.name)}</option>`).join("")}</select>
      </div>
    </div>
    <div class="hidden" id="a-bond-row4" style="margin-top:12px">
      <label>Akun Jatuh Tempo</label>
      <select id="a-bond-maturity-acct">${accountsForBond.map((acc) => `<option value="${acc.id}" ${acc.id === a.maturityAccountId ? "selected" : ""}>${escapeHtml(acc.name)}</option>`).join("")}</select>
    </div>
    <label id="a-manual-wrap" style="margin-top:12px; font-size:12px; text-transform:none; letter-spacing:0; color:var(--muted2)">
      <input type="checkbox" id="a-manual-only" style="width:auto" ${a.manualOnly === true ? "checked" : ""}/>
      🔒 Harga manual (skip auto-refresh)
    </label>
    <div class="sub" id="a-auto-hint"></div>
    <div id="a-trade-buttons" style="margin-top:14px; display:${existing ? "flex" : "none"}; gap:8px;">
      <button id="a-buy" class="btn" style="flex:1">💰 Catat Pembelian</button>
      <button id="a-sell" class="btn" style="flex:1">💸 Catat Penjualan</button>
    </div>
    <div id="a-bond-buttons" style="margin-top:14px; display:none; gap:8px;">
      <button id="a-bond-coupon" class="btn" style="flex:1">💰 Catat Kupon Masuk</button>
      <button id="a-bond-redeem" class="btn" style="flex:1">🏁 Cairkan Pokok</button>
    </div>
    ${existing && existing.type === "bond" && existing.redeemed === true ? `<div class="sub" style="margin-top:10px">✅ Pokok udah dicairkan</div>` : ""}
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="a-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="a-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);

  const AUTO_HINTS = {
    stock_id: "⚡ Auto: TradingView",
    stock_us: "⚡ Auto: Finnhub (butuh API key)",
    crypto: "⚡ Auto: CoinGecko",
  };

  attachThousands(el.querySelector("#a-bond-principal"));

  const typeSel = el.querySelector("#a-type");
  const curSel = el.querySelector("#a-currency");
  const qtyLabel = el.querySelector("#a-qty-label");
  const qtylessCheckbox = el.querySelector("#a-qtyless");
  const syncType = () => {
    const t = typeSel.value;
    const isCapexType = t === "capex";
    const isBondType = t === "bond";
    // Toggle "Jumlah N/A" cuma masuk akal buat tipe manual yang ga punya model single-unit
    // sendiri kayak CAPEX/Bond — posisi lump-sum (1 rekening deposito, 1 batangan emas dilebur
    // jadi 1 posisi, 1 investasi bisnis) yang biasa ditambah/ditarik nominal langsung, bukan
    // qty×harga/unit. Saham/US/crypto DIKELUARIN karena auto-refresh butuh qty×harga/unit buat
    // ngitung nilai — kombinasi qtyless+auto-refresh ga make sense.
    const qtylessEligible = QTYLESS_TYPES.includes(t);
    const isQtyless = qtylessEligible && qtylessCheckbox.checked;
    qtyLabel.textContent = t === "stock_id" ? "Jumlah (lot)" : "Jumlah";
    if (t === "stock_id") curSel.value = "IDR";
    if (t === "stock_us") curSel.value = "USD";
    if (isBondType) curSel.value = "IDR"; // SBN Ritel selalu IDR
    const isAuto = !!AUTO_HINTS[t];
    el.querySelector("#a-auto-hint").textContent = AUTO_HINTS[t] || "";
    el.querySelector("#a-manual-wrap").classList.toggle("hidden", !isAuto);

    // Symbol field DIREUSE jadi "Series Name" buat bond (mis. "ORI030T3") — bukan field baru,
    // biar `a.symbol || a.name` yang udah dipakai di mana-mana (assetRow, goal-link list,
    // snapshot) otomatis jalan tanpa kode baru.
    el.querySelector("#a-symbol-wrap").classList.toggle("hidden", isCapexType);
    el.querySelector("#a-symbol-label").textContent = isBondType ? "Series Name" : "Symbol / Kode";
    el.querySelector("#a-symbol").placeholder = isBondType ? "ORI030T3" : "BBCA / VOO";
    el.querySelector("#a-name-label").textContent = isCapexType ? "Nama Barang" : "Nama (opsional)";
    el.querySelector("#a-qtyless-wrap").classList.toggle("hidden", !qtylessEligible);
    // Capex/Bond hide SELURUH row (qty+currency, currency-nya di-force lewat curSel.value di
    // atas) — qtyless CUMA nyembunyiin input qty-nya doang (`a-qty-wrap`), currency TETAP bisa
    // dipilih manual (beda dari bond yang forced IDR, qtyless ga punya currency default yang pasti).
    el.querySelector("#a-qty-row").classList.toggle("hidden", isCapexType || isBondType);
    el.querySelector("#a-qty-wrap").classList.toggle("hidden", isQtyless);
    el.querySelector("#a-avg-wrap").classList.toggle("hidden", isBondType);
    el.querySelector("#a-price-wrap").classList.toggle("hidden", isCapexType);
    el.querySelector("#a-price-label").textContent = isBondType ? "Harga pasar (opsional)" : isQtyless ? "Nilai Sekarang" : "Harga sekarang / unit";
    el.querySelector("#a-capex-row").classList.toggle("hidden", !isCapexType);
    ["a-bond-row1", "a-bond-row2", "a-bond-row3", "a-bond-row4"].forEach((id) =>
      el.querySelector(`#${id}`).classList.toggle("hidden", !isBondType));
    el.querySelector("#a-avg-label").textContent = isCapexType ? "Harga Beli" : isQtyless ? "Modal" : "Avg Buy / unit";
    el.querySelector("#a-trade-buttons").style.display = (existing && !isCapexType && !isBondType) ? "flex" : "none";
    el.querySelector("#a-bond-buttons").style.display = (existing && isBondType && existing.redeemed !== true) ? "flex" : "none";
  };
  typeSel.onchange = syncType;
  qtylessCheckbox.onchange = () => {
    // Toggle ON dari posisi yang sebelumnya beneran punya qty > 1 (mis. reksadana 500 unit @
    // Rp1.500) — konversi avg/harga per-unit jadi TOTAL otomatis (500 × 1.500 = Rp750.000),
    // biar ga kesalahartikan diam-diam jadi "modal Rp1.500 doang" pas field-nya di-reinterpretasi
    // sebagai total. Toggle OFF sengaja GA di-reverse (user emang harus isi ulang qty+harga per
    // unit manual kalau balik ke mode biasa, ga ada "1 unit" yang valid buat dibagi balik).
    if (qtylessCheckbox.checked) {
      const qtyVal = parseFloat(String(el.querySelector("#a-qty").value).replace(",", ".")) || 0;
      if (qtyVal > 1) {
        const avgEl = el.querySelector("#a-avg");
        const priceEl = el.querySelector("#a-price");
        const avgVal = parseFloat(String(avgEl.value).replace(",", ".")) || 0;
        const priceVal = parseFloat(String(priceEl.value).replace(",", ".")) || 0;
        if (avgVal) avgEl.value = String(Math.round(avgVal * qtyVal * 100) / 100);
        if (priceVal) priceEl.value = String(Math.round(priceVal * qtyVal * 100) / 100);
      }
    }
    syncType();
  };
  syncType();
  if (existing) curSel.value = a.currency;

  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#a-save").onclick = async () => {
    const parseDec = (v) => parseFloat(String(v).replace(",", ".")) || 0;
    const isCapexNow = typeSel.value === "capex";
    const isBondNow = typeSel.value === "bond";
    const isQtylessNow = QTYLESS_TYPES.includes(typeSel.value) && qtylessCheckbox.checked;
    const data = {
      type: typeSel.value,
      // Symbol DIPAKAI juga buat "Series Name" bond (relabeled di syncType) — cuma capex yang
      // ga punya symbol sama sekali.
      symbol: isCapexNow ? "" : el.querySelector("#a-symbol").value.trim().toUpperCase(),
      name: el.querySelector("#a-name").value.trim(),
      quantity: (isCapexNow || isBondNow || isQtylessNow) ? 1 : parseDec(el.querySelector("#a-qty").value),
      avgBuyPrice: isBondNow ? 0 : parseDec(el.querySelector("#a-avg").value),
      currency: curSel.value,
      qtyless: isQtylessNow,
    };
    if (isCapexNow) {
      data.purchaseDate = el.querySelector("#a-purchase-date").value || todayStr();
      const pct = parseDec(el.querySelector("#a-deprec-pct").value);
      data.depreciationPctMonth = Math.max(0, Math.min(100, pct)) / 100;
    } else if (isBondNow) {
      data.principal = parseAmount(el.querySelector("#a-bond-principal").value);
      data.maturityDate = el.querySelector("#a-bond-maturity").value || "";
      data.couponRatePA = Math.max(0, Math.min(100, parseDec(el.querySelector("#a-bond-rate").value))) / 100;
      data.couponPeriodMonths = Math.max(1, parseInt(el.querySelector("#a-bond-period").value) || 1);
      data.purchaseDate = el.querySelector("#a-bond-issue").value || todayStr();
      data.couponAccountId = el.querySelector("#a-bond-coupon-acct").value || null;
      data.maturityAccountId = el.querySelector("#a-bond-maturity-acct").value || null;
      data.manualPrice = parseDec(el.querySelector("#a-price").value); // opsional, harga pasar sekunder
      // `redeemed` SENGAJA GA disentuh di sini — cuma openBondRedeemSheet() (set true) & reversal
      // hapus transaksi redeem (db.js applyAssetQtyEffect, set false) yang boleh ubah field ini.
    } else {
      data.manualPrice = parseDec(el.querySelector("#a-price").value);
      data.manualOnly = el.querySelector("#a-manual-only").checked;
      if (String(data.manualPrice) !== String(existing?.manualPrice ?? "")) {
        data.manualPriceUpdatedAt = todayStr();
      } else {
        data.manualPriceUpdatedAt = existing?.manualPriceUpdatedAt || todayStr();
      }
    }
    if (!data.symbol && !data.name) return toast("Isi symbol atau nama");
    if (!isBondNow && !data.quantity) return toast("Isi jumlah");
    if (isCapexNow && !data.avgBuyPrice) return toast("Isi harga beli");
    if (isBondNow && !data.principal) return toast("Isi nilai pokok/principal");
    if (isBondNow && !data.maturityDate) return toast("Isi tanggal jatuh tempo");
    closeSheet();
    if (existing) await patch("assets", existing.id, data);
    else await add("assets", data);
    toast("Asset disimpan ✓");
  };

  if (existing) {
    el.querySelector("#a-buy").onclick = () => openAssetBuySheet(existing);
    el.querySelector("#a-sell").onclick = () => openAssetSellSheet(existing);
    el.querySelector("#a-bond-coupon").onclick = () => openBondCouponSheet(existing);
    el.querySelector("#a-bond-redeem").onclick = () => openBondRedeemSheet(existing);
    el.querySelector("#a-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.assetId === existing.id);
      if (used) return toast("Masih ada transaksi beli/jual — beresin di History dulu");
      const linkedGoals = state.goals.filter((g) => (g.linkedAssetIds || []).includes(existing.id));
      if (linkedGoals.length > 0) return toast(`Masih di-link ke goal "${linkedGoals[0].name}" — lepas dulu`);
      if (!confirmDialog("Hapus asset ini?")) return;
      closeSheet();
      await remove("assets", existing.id);
      toast("Dihapus");
    };
  }
}

// ================= Bond / SBN Ritel — Kupon & Pencairan Pokok (TASK-4) =================
// Dua aksi TERPISAH (dua peristiwa finansial beda, lihat calc.js bullet Bond):
// 1. "Catat Kupon Masuk" — transaksi income BIASA, TANPA assetId (beda dari beli/jual/redeem
//    yang emang perlu dilacak balik ke asset-nya — kupon TIDAK, "Ini transaksi income BIASA...
//    bukan mekanisme baru" per spec) — kupon TIDAK dihitung otomatis (keputusan owner, lihat
//    DECISIONS.md kenapa: pajak PPh final 10%, pembulatan, timing mutasi RDN beda-beda). Sheet
//    ini cuma PRE-FILL akun/kategori/tanggal + estimasi informatif (`bondNextCouponHint`), user
//    tetap input/koreksi manual nominal aktualnya.
// 2. "Cairkan Pokok" — transfer ber-`assetId`+`assetDir:"redeem"` (arah BARU, beda dari "sell":
//    ga nge-adjust `quantity`/qty-tracking — bond ga pakai itu — efeknya flag `redeemed`, di-set
//    manual DI SINI pas create (pola sama openAssetTradeSheet nulis quantity-nya sendiri, BUKAN
//    via hook), reversal-nya (hapus transaksi) lewat db.js `applyAssetQtyEffect()` yang di-extend
//    khusus buat arah "redeem" ini — balikin `redeemed:false`, bukan qty).
function openBondCouponSheet(asset) {
  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const defaultAcctId = asset.couponAccountId && accounts.some((a) => a.id === asset.couponAccountId)
    ? asset.couponAccountId : accounts[0].id;
  const hint = bondNextCouponHint(asset);

  const el = openSheet(`
    ${sheetHead(`Catat Kupon: ${escapeHtml(asset.symbol || asset.name)}`)}
    ${hint ? `<div class="sub" style="margin-bottom:10px">💡 Kupon berikutnya ${hint.nextDate}: ≈ ${fmtIDR(hint.estAmount)} (sebelum pajak)</div>` : ""}
    <input id="bc-amount" class="amount-input" inputmode="numeric" placeholder="0" autocomplete="off" />
    <label>Ke Akun</label>
    <select id="bc-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === defaultAcctId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="bc-date" type="date" value="${todayStr()}" /></div>
      <div><label>Jam</label><input id="bc-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
    <label>Catatan (opsional)</label>
    <input id="bc-note" type="text" value="Kupon ${escapeHtml(asset.symbol || asset.name)}" />
    <button id="bc-save" class="btn btn-primary btn-block" style="margin-top:18px">Simpan</button>
  `);
  const amountInput = el.querySelector("#bc-amount");
  attachThousands(amountInput);
  setTimeout(() => amountInput.focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#bc-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const accountId = el.querySelector("#bc-account").value;
    const date = el.querySelector("#bc-date").value;
    const time = el.querySelector("#bc-time").value || DEFAULT_TX_TIME;
    const note = el.querySelector("#bc-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal kupon");
    if (!date) return toast("Tanggal belum diisi");
    closeSheet();
    // categoryId "cat_bunga" ("Bunga & Dividen") — preset category, udah ada dari seedIfNeeded()
    // sejak awal, ga perlu ensurePresetCategories() baru.
    await add("transactions", {
      type: "income", amount, date, time, month: monthOf(date),
      accountId, categoryId: "cat_bunga",
      note: note || `Kupon ${asset.symbol || asset.name}`,
    });
    toast("Kupon tercatat ✓");
  };
}

// Export — dipakai home.js `openTxDetail()` buat routing transaksi ber-`assetDir:"redeem"`.
export function openBondRedeemSheet(asset, existingTx = null) {
  if (existingTx) {
    const acct = state.accounts.find((a) => a.id === existingTx.accountId);
    const el = openSheet(`
      ${sheetHead("Detail Pencairan Pokok")}
      <div class="sub" style="margin-bottom:10px">Ga bisa diedit — hapus &amp; catat ulang.</div>
      <div class="table-like">
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Bond</span><span>${escapeHtml(asset.symbol || asset.name)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Pokok Cair</span><span>${fmtMoney(existingTx.amount, acct?.currency)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Ke Akun</span><span>${escapeHtml(acct?.name || "?")}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Tanggal</span><span>${existingTx.date}</span></div>
      </div>
      <button id="br-delete" class="btn btn-danger btn-block" style="margin-top:18px">Hapus &amp; Batalkan Pencairan</button>
    `);
    el.querySelector("[data-close]").onclick = closeSheet;
    el.querySelector("#br-delete").onclick = async () => {
      if (!confirmDialog("Batalkan pencairan pokok ini? Bond bakal aktif lagi (status belum dicairkan).")) return;
      closeSheet();
      // Reversal flag `redeemed` DIPUSATKAN di db.js remove() (hook applyAssetQtyEffect, pola
      // sama reversal quantity buy/sell) — bukan manual di sini.
      await remove("transactions", existingTx.id);
      toast("Pencairan dibatalkan, bond aktif lagi");
    };
    return;
  }

  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const principal = Number(asset.principal) || 0;
  const defaultAcctId = asset.maturityAccountId && accounts.some((a) => a.id === asset.maturityAccountId)
    ? asset.maturityAccountId : accounts[0].id;
  const isPastMaturity = asset.maturityDate && asset.maturityDate <= todayStr();

  const el = openSheet(`
    ${sheetHead(`Cairkan Pokok: ${escapeHtml(asset.symbol || asset.name)}`)}
    ${!isPastMaturity ? `<div class="sub" style="margin-bottom:10px">⚠️ Belum jatuh tempo (${asset.maturityDate || "?"})</div>` : ""}
    <label>Nominal Pokok</label>
    <input id="br-amount" class="amount-input" inputmode="numeric" value="${fmtNum(principal)}" autocomplete="off" />
    <label>Ke Akun</label>
    <select id="br-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === defaultAcctId ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="br-date" type="date" value="${isPastMaturity ? todayStr() : (asset.maturityDate || todayStr())}" /></div>
      <div><label>Jam</label><input id="br-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
    <label>Catatan (opsional)</label>
    <input id="br-note" type="text" placeholder="cth: jatuh tempo" />
    <button id="br-save" class="btn btn-primary btn-block" style="margin-top:18px">Konfirmasi Cairkan Pokok</button>
  `);
  const amountInput = el.querySelector("#br-amount");
  attachThousands(amountInput);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#br-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const accountId = el.querySelector("#br-account").value;
    const date = el.querySelector("#br-date").value;
    const time = el.querySelector("#br-time").value || DEFAULT_TX_TIME;
    const note = el.querySelector("#br-note").value.trim();
    if (!amount || amount <= 0) return toast("Isi nominal pokok");
    if (!date) return toast("Tanggal belum diisi");
    if (!confirmDialog(`Cairkan pokok Rp ${fmtNum(amount)}? Bond ditandai selesai (redeemed).`)) return;
    closeSheet();
    await patch("assets", asset.id, { redeemed: true });
    await add("transactions", {
      type: "transfer", amount, date, time, month: monthOf(date),
      accountId, toAccountId: null, categoryId: null,
      assetId: asset.id, assetDir: "redeem",
      note: note || `Cairkan pokok ${asset.symbol || asset.name}`,
    });
    toast("Pokok obligasi dicairkan ✓");
  };
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
// `opts` (dipakai recurring-sheet.js buat reminder DCA, lihat bullet `recurring` di CLAUDE.md):
// {prefillAmount, prefillAccountId, prefillDate, onSaved}. Cuma relevan buat transaksi BARU
// (existingTx null) — nominal DCA di-render sebagai field terpisah yang bantu ngitung qty dari
// harga yang diisi manual (harga tetap ga di-prefill, beda tiap bulan), bukan meng-auto-post.
// `onSaved` dipanggil SETELAH transaksi beneran tersimpan, biar caller (recurring-sheet.js) bisa
// nge-set `lastPostedMonth` hanya kalau user benar-benar nyimpen, bukan pas tombol diklik.
// Asset qtyless (lump-sum, "Jumlah N/A") dispatch ke sheet KHUSUS (openQtylessTradeSheet, di
// bawah) — bukan openAssetTradeSheet biasa, field-nya beda total (nominal langsung, ga ada
// qty×harga/unit).
export function openAssetBuySheet(asset, existingTx = null, opts = {}) {
  if (asset.qtyless === true) return openQtylessTradeSheet(asset, "buy", existingTx, opts);
  openAssetTradeSheet(asset, "buy", existingTx, opts);
}
export function openAssetSellSheet(asset, existingTx = null, opts = {}) {
  if (asset.qtyless === true) return openQtylessTradeSheet(asset, "sell", existingTx, opts);
  openAssetTradeSheet(asset, "sell", existingTx, opts);
}

function openAssetTradeSheet(asset, dir, existingTx, opts = {}) {
  const isBuy = dir === "buy";

  if (existingTx) {
    const acct = state.accounts.find((a) => a.id === existingTx.accountId);
    const el = openSheet(`
      ${sheetHead(isBuy ? "Detail Pembelian" : "Detail Penjualan")}
      <div class="sub" style="margin-bottom:10px">Ga bisa diedit — hapus &amp; catat ulang.</div>
      <div class="table-like">
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Asset</span><span>${escapeHtml(asset.symbol || asset.name)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Jumlah</span><span>${blurNum(asset.type === "stock_id" ? `${fmtNum(existingTx.assetQty)} lot` : String(existingTx.assetQty))}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Harga/unit</span><span>${fmtMoney(existingTx.assetPrice, asset.currency)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">${isBuy ? "Dari" : "Ke"} Akun</span><span>${escapeHtml(acct?.name || "?")}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Tanggal</span><span>${existingTx.date}</span></div>
      </div>
      <button id="at-delete" class="btn btn-danger btn-block" style="margin-top:18px">Hapus Transaksi</button>
    `);
    el.querySelector("[data-close]").onclick = closeSheet;
    el.querySelector("#at-delete").onclick = async () => {
      if (!confirmDialog(`Hapus transaksi ini? Qty disesuaikan, avg buy price TIDAK di-reverse.`)) return;
      closeSheet();
      // Reversal quantity DIPUSATKAN di db.js remove() (hook, pola sama debt) — bukan manual
      // di sini, biar jalur hapus lain (mis. bulkDelete) bisa manggil logic yang sama.
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
    ${opts.prefillAmount ? `
    <div class="sub" style="margin-bottom:10px">📅 DCA rutin</div>
    <label>Nominal (Rp)</label>
    <input id="at-nominal" class="amount-input" inputmode="numeric" autocomplete="off" />
    <div class="sub" style="margin-top:2px">Jumlah keitung otomatis dari nominal ÷ harga.</div>` : ""}
    <label>${qtyLabel}</label>
    <input id="at-qty" inputmode="decimal" placeholder="0" autocomplete="off" />
    <label>Harga / unit (${asset.currency})</label>
    <input id="at-price" inputmode="decimal" placeholder="${curAvg || 0}" autocomplete="off" />
    <div id="at-hint" class="sub" style="margin-top:4px"></div>
    <label>${isBuy ? "Dari Akun" : "Ke Akun"}</label>
    <select id="at-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === (opts.prefillAccountId || accounts[0].id) ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="at-date" type="date" value="${opts.prefillDate || todayStr()}" /></div>
      <div><label>Jam</label><input id="at-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
    <label>Catatan (opsional)</label>
    <input id="at-note" type="text" placeholder="${isBuy ? "cth: nambah posisi" : "cth: profit taking"}" />
    <button id="at-save" class="btn btn-primary btn-block" style="margin-top:18px">Simpan</button>
  `);

  const qtyInput = el.querySelector("#at-qty");
  const priceInput = el.querySelector("#at-price");
  const nominalInput = el.querySelector("#at-nominal");
  const hint = el.querySelector("#at-hint");
  setTimeout(() => (nominalInput ? priceInput : qtyInput).focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  const parseDec = (v) => parseFloat(String(v).replace(",", ".")) || 0;

  const updateHint = () => {
    const qty = parseDec(qtyInput.value);
    const price = parseDec(priceInput.value);
    // innerHTML + blurNum() di sini (bukan textContent kayak sebelumnya) — hint ini nampilin avg
    // buy price & qty dimiliki, read-only info yang sama sensitifnya kayak yang lain, harus ikut
    // blur mode juga.
    if (isBuy) {
      if (qty > 0 && price > 0) {
        const newAvg = (curQty * curAvg + qty * price) / (curQty + qty);
        hint.innerHTML = `Avg buy: ${blurNum(fmtNum(curAvg))} → ${blurNum(fmtNum(Math.round(newAvg * 100) / 100))}`;
      } else {
        hint.innerHTML = curQty > 0 ? `Avg buy sekarang: ${blurNum(fmtNum(curAvg))}` : "";
      }
    } else {
      hint.innerHTML = `Dimiliki sekarang: ${blurNum(asset.type === "stock_id" ? `${fmtNum(curQty)} lot` : String(curQty))}`;
    }
  };
  qtyInput.addEventListener("input", updateHint);
  priceInput.addEventListener("input", updateHint);
  updateHint();

  if (nominalInput) {
    attachThousands(nominalInput);
    nominalInput.value = fmtNum(opts.prefillAmount);
    // Nominal DCA / harga = qty — dibulatkan ke lot penuh buat stock_id (ga bisa beli
    // pecahan lot), dibiarin desimal buat tipe lain. Tetep bisa diedit manual abis ke-isi.
    const recomputeQtyFromNominal = () => {
      const nominal = parseAmount(nominalInput.value);
      const price = parseDec(priceInput.value);
      if (nominal > 0 && price > 0) {
        const rawQty = nominal / (price * (asset.type === "stock_id" ? 100 : 1));
        const qty = asset.type === "stock_id" ? Math.floor(rawQty) : Math.round(rawQty * 10000) / 10000;
        qtyInput.value = qty > 0 ? String(qty) : "";
        updateHint();
      }
    };
    nominalInput.addEventListener("input", recomputeQtyFromNominal);
    priceInput.addEventListener("input", recomputeQtyFromNominal);
  }

  el.querySelector("#at-save").onclick = async () => {
    const qty = parseDec(qtyInput.value);
    const price = parseDec(priceInput.value);
    const accountId = el.querySelector("#at-account").value;
    const date = el.querySelector("#at-date").value;
    const time = el.querySelector("#at-time").value || DEFAULT_TX_TIME;
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
      type: "transfer", amount, date, time, month: monthOf(date),
      accountId, toAccountId: null, categoryId: null,
      assetId: asset.id, assetDir: dir, assetQty: qty, assetPrice: price,
      note: note || `${isBuy ? "Beli" : "Jual"} ${asset.symbol || asset.name}`,
    });
    opts.onSaved?.();
    toast(isBuy ? "Pembelian tercatat ✓" : "Penjualan tercatat ✓");
  };
}

// ================= Qtyless / "Jumlah N/A" trades (lump-sum posisi tunggal) =================
// Beda TOTAL dari openAssetTradeSheet di atas — ga ada qty×harga/unit sama sekali, cuma SATU
// nominal langsung. Beli: nominal nambah `manualPrice` (nilai sekarang) DAN `avgBuyPrice` (total
// modal/cost) — asumsi wajar abis nambah duit, nilai hari itu minimal segitu (user tetap bisa
// koreksi manual lewat form Edit Asset kalau nilai pasarnya beda). Jual/tarik: nominal ngurangin
// `manualPrice` doang, `avgBuyPrice` TETAP — pola SAMA kayak konvensi jual asset biasa (cost basis
// ga ikut di-reverse pas jual, lihat openAssetTradeSheet). `quantity` SELALU 1, ga pernah
// disentuh oleh sheet ini sama sekali (baik buy maupun sell).
function openQtylessTradeSheet(asset, dir, existingTx, opts = {}) {
  const isBuy = dir === "buy";

  if (existingTx) {
    const acct = state.accounts.find((a) => a.id === existingTx.accountId);
    const el = openSheet(`
      ${sheetHead(isBuy ? "Detail Pembelian" : "Detail Penjualan/Penarikan")}
      <div class="sub" style="margin-bottom:10px">Ga bisa diedit — hapus &amp; catat ulang.</div>
      <div class="table-like">
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Asset</span><span>${escapeHtml(asset.symbol || asset.name)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Nominal</span><span>${fmtMoney(existingTx.amount, asset.currency)}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">${isBuy ? "Dari" : "Ke"} Akun</span><span>${escapeHtml(acct?.name || "?")}</span></div>
        <div style="display:flex; justify-content:space-between; padding:6px 0"><span class="sub">Tanggal</span><span>${existingTx.date}</span></div>
      </div>
      <button id="qt-delete" class="btn btn-danger btn-block" style="margin-top:18px">Hapus Transaksi</button>
    `);
    el.querySelector("[data-close]").onclick = closeSheet;
    el.querySelector("#qt-delete").onclick = async () => {
      if (!confirmDialog(`Hapus transaksi ${isBuy ? "pembelian" : "penjualan/penarikan"} ini? Nilai${isBuy ? " & modal" : ""} asset bakal disesuaikan lagi.`)) return;
      closeSheet();
      // Reversal DIPUSATKAN di db.js remove() (hook applyAssetQtyEffect, cabang qtyless) — bukan
      // manual di sini, pola sama trade biasa/redeem.
      await remove("transactions", existingTx.id);
      toast("Transaksi dihapus, nilai asset disesuaikan");
    };
    return;
  }

  const accounts = activeAccounts();
  if (accounts.length === 0) {
    toast("Buat akun dulu di Settings ⚙️");
    location.hash = "#/settings";
    return;
  }
  const curValue = Number(asset.manualPrice) || 0;
  const curCost = Number(asset.avgBuyPrice) || 0;

  const el = openSheet(`
    ${sheetHead(isBuy ? `Catat Pembelian: ${escapeHtml(asset.symbol || asset.name)}` : `Catat Penjualan/Penarikan: ${escapeHtml(asset.symbol || asset.name)}`)}
    <label>Nominal ${isBuy ? "Pembelian" : "Penjualan/Penarikan"} (${asset.currency})</label>
    <input id="qt-amount" class="amount-input" inputmode="numeric" placeholder="0" autocomplete="off" />
    <div id="qt-hint" class="sub" style="margin-top:4px"></div>
    <label>${isBuy ? "Dari Akun" : "Ke Akun"}</label>
    <select id="qt-account">
      ${accounts.map((a) => `<option value="${a.id}" ${a.id === (opts.prefillAccountId || accounts[0].id) ? "selected" : ""}>${escapeHtml(a.name)} (${a.currency})</option>`).join("")}
    </select>
    <div class="row">
      <div><label>Tanggal</label><input id="qt-date" type="date" value="${opts.prefillDate || todayStr()}" /></div>
      <div><label>Jam</label><input id="qt-time" type="time" value="${nowTimeStr()}" /></div>
    </div>
    <label>Catatan (opsional)</label>
    <input id="qt-note" type="text" placeholder="${isBuy ? "cth: nambah setoran" : "cth: tarik sebagian"}" />
    <button id="qt-save" class="btn btn-primary btn-block" style="margin-top:18px">Simpan</button>
  `);

  const amountInput = el.querySelector("#qt-amount");
  const hint = el.querySelector("#qt-hint");
  attachThousands(amountInput);
  setTimeout(() => amountInput.focus(), 250);
  el.querySelector("[data-close]").onclick = closeSheet;

  const updateHint = () => {
    const amt = parseAmount(amountInput.value);
    if (!amt) {
      hint.innerHTML = `Nilai sekarang: ${blurNum(fmtMoneyPlain(curValue, asset.currency))} · Modal: ${blurNum(fmtMoneyPlain(curCost, asset.currency))}`;
      return;
    }
    if (isBuy) {
      hint.innerHTML = `Nilai: ${blurNum(fmtMoneyPlain(curValue, asset.currency))} → ${blurNum(fmtMoneyPlain(curValue + amt, asset.currency))} · Modal: ${blurNum(fmtMoneyPlain(curCost, asset.currency))} → ${blurNum(fmtMoneyPlain(curCost + amt, asset.currency))}`;
    } else {
      hint.innerHTML = `Nilai: ${blurNum(fmtMoneyPlain(curValue, asset.currency))} → ${blurNum(fmtMoneyPlain(Math.max(0, curValue - amt), asset.currency))} (modal tetep ${blurNum(fmtMoneyPlain(curCost, asset.currency))})`;
    }
  };
  amountInput.addEventListener("input", updateHint);
  updateHint();

  el.querySelector("#qt-save").onclick = async () => {
    const amount = parseAmount(amountInput.value);
    const accountId = el.querySelector("#qt-account").value;
    const date = el.querySelector("#qt-date").value;
    const time = el.querySelector("#qt-time").value || DEFAULT_TX_TIME;
    const note = el.querySelector("#qt-note").value.trim();

    if (!amount || amount <= 0) return toast("Isi nominalnya dulu");
    if (!date) return toast("Tanggal belum diisi");
    if (!isBuy && amount > curValue + 0.5) {
      return toast(`Ga bisa tarik lebih dari nilai sekarang (${fmtMoneyPlain(curValue, asset.currency)})`);
    }

    const newValue = isBuy ? curValue + amount : Math.max(0, curValue - amount);
    const newCost = isBuy ? curCost + amount : curCost; // jual/tarik TIDAK nyentuh modal (pola sama tipe lain)

    closeSheet();
    await patch("assets", asset.id, {
      manualPrice: newValue,
      avgBuyPrice: newCost,
      manualPriceUpdatedAt: todayStr(),
    });
    await add("transactions", {
      type: "transfer", amount, date, time, month: monthOf(date),
      accountId, toAccountId: null, categoryId: null,
      assetId: asset.id, assetDir: dir,
      note: note || `${isBuy ? "Setor" : "Tarik"} ${asset.symbol || asset.name}`,
    });
    opts.onSaved?.();
    toast(isBuy ? "Pembelian tercatat ✓" : "Penjualan/penarikan tercatat ✓");
  };
}

// ================= LIQUID =================
// Akun kartu kredit TIDAK muncul di tab ini sama sekali (bukan cuma dikelompokkan terpisah) —
// CC sekarang lewat DEBT PATH (lihat calc.js `totalCashIDR()`/`totalDebtIDR()` & DECISIONS.md),
// jadi "Liquid" murni cash beneran, pindahannya (pemakaian kartu) muncul di tab Debt.
function renderLiquid(root) {
  const accounts = activeAccounts().filter((a) => !isCreditAccount(a));
  const bal = accountBalances();
  const rate = effectiveRate();
  const total = totalCashIDR();

  root.innerHTML = `
    <div class="card">
      <div class="sub" style="margin-bottom:6px">Total liquid: <b style="color:var(--blue)">${fmtIDR(total)}</b></div>
      <div id="liq-list">
        ${accounts.length === 0 ? `<div class="empty">Belum ada akun cash.</div>` : ""}
      </div>
      <div class="sub" style="margin-top:10px"><a href="#/accounts" style="color:var(--blue)">Kelola akun →</a></div>
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
        <span style="width:10px;height:10px;border-radius:50%;background:${a.color || "#8bacd0"};flex-shrink:0"></span>
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
// Kartu kredit muncul di tab ini SEKARANG (lewat debt path, lihat calc.js & DECISIONS.md) —
// tapi TETAP dipisah jadi section-nya sendiri (bukan dicampur ke list `debts` collection), karena
// konsepnya beda: CC revolving (derived dari saldo akun, klik → openAcctSheet) vs cicilan TETAP
// (monthlyInstalment/dueDay/remainingMonths, klik → openDebtSheet). "Total debt" di atas SELALU
// `totalDebtIDR()` (cicilan + kartu) biar match badge "Debt" di sumtabs atas halaman.
function renderDebts(root) {
  const rows = state.debts.slice().sort((a, b) => (a.dueDay || 99) - (b.dueDay || 99));
  const totalInstalment = rows.reduce((s, d) => s + (Number(d.monthlyInstalment) || 0), 0);
  const creditAccounts = state.accounts.filter((a) => isCreditAccount(a) && !a.isArchived);
  const bal = accountBalances();
  const totalCreditDebt = totalCreditDebtIDR();
  const totalDebt = totalDebtIDR();

  root.innerHTML = `
    <div class="card">
      ${(rows.length > 0 || creditAccounts.length > 0) ? `<div class="sub" style="margin-bottom:4px">Total debt: <b style="color:var(--red)">${fmtIDR(totalDebt)}</b>${creditAccounts.length > 0 ? ` (cicilan ${fmtIDR(totalDebt - totalCreditDebt)} + kartu ${fmtIDR(totalCreditDebt)})` : ""}</div>` : ""}
      ${rows.length > 0 ? `<div class="sub" style="margin-bottom:10px">Total cicilan / bulan: <b style="color:var(--red)">${fmtIDR(totalInstalment)}</b></div>` : ""}
      <div id="debt-list">
        ${rows.length === 0 && creditAccounts.length === 0 ? `<div class="empty">Ga ada hutang aktif. 🎉</div>` : ""}
        ${rows.length === 0 && creditAccounts.length > 0 ? `<div class="empty">Ga ada cicilan aktif. 🎉</div>` : ""}
      </div>
      ${creditAccounts.length > 0 ? `<div class="group-head" style="margin-top:14px"><span>🪪 Kartu Kredit</span></div><div id="debt-credit-list"></div>` : ""}
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

  if (creditAccounts.length > 0) {
    const creditList = root.querySelector("#debt-credit-list");
    creditAccounts.forEach((a) => {
      const used = creditUsed(a, bal);
      const limit = Number(a.creditLimit) || 0;
      const remaining = creditRemaining(a, bal);
      const div = document.createElement("div");
      div.className = "asset-item";
      div.innerHTML = `
        <div>
          <div class="asset-sym" style="font-size:13px">${escapeHtml(a.name)}</div>
          <div class="asset-meta">${limit > 0 ? `limit ${fmtMoney(limit, a.currency)}` : "tanpa limit"}</div>
        </div>
        <div class="asset-right">
          <div class="asset-val" style="color:var(--red)">${fmtMoney(used, a.currency)}</div>
          <div class="stale-note">${limit > 0 ? `sisa ${fmtMoney(Math.max(0, remaining), a.currency)}` : "terpakai"}</div>
        </div>`;
      div.onclick = () => openAcctSheet(a);
      creditList.appendChild(div);
    });
  }

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
      if (used) return toast("Masih ada pembayaran ber-link — lepas di History dulu");
      if (!confirmDialog("Hapus hutang ini? (misal karena sudah lunas)")) return;
      closeSheet();
      await remove("debts", existing.id);
      toast("Mantap, satu hutang hilang 🎉");
    };
  }
}

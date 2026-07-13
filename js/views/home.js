import {
  state, activeAccounts, accountBalances, totalCashIDR, totalAssetsIDR, totalGoalSavingsIDR,
  goalSavedIDR, rangeSummary, catById, acctById, effectiveRate, budgetsOfMonth, spentByCategory,
} from "../store.js";
import {
  fmtIDR, fmtMoney, escapeHtml, dateLabel, currentMonth, todayStr, monthLabel,
  isBlurred, setBlurred, openSheet, closeSheet, sheetHead, toast,
} from "../utils.js";
import { openTxSheet } from "../tx-sheet.js";
import { openTopupSheet } from "./goals.js";

// Filter periode Home — persist selama sesi (module-level, bukan di store global)
const period = { mode: "month", from: null, to: null };

// Toggle "include assets" di card Total Balance — persist per device
const INCLUDE_ASSETS_KEY = "fintrack_home_include_assets";
let includeAssets = localStorage.getItem(INCLUDE_ASSETS_KEY) === "1";

const PERIOD_LABELS = { day: "Hari", week: "Minggu", month: "Bulan", year: "Tahun" };

function pad2(n) { return String(n).padStart(2, "0"); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function periodRange() {
  const today = new Date();
  if (period.mode === "day") { const s = isoDate(today); return { from: s, to: s }; }
  if (period.mode === "week") {
    const day = today.getDay(); // 0=Min..6=Sab
    const diffToMon = day === 0 ? -6 : 1 - day;
    const mon = new Date(today); mon.setDate(today.getDate() + diffToMon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: isoDate(mon), to: isoDate(sun) };
  }
  if (period.mode === "year") {
    return { from: `${today.getFullYear()}-01-01`, to: `${today.getFullYear()}-12-31` };
  }
  if (period.mode === "custom") {
    return { from: period.from || isoDate(today), to: period.to || isoDate(today) };
  }
  // month (default)
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { from: isoDate(first), to: isoDate(last) };
}

function periodRangeLabel(from, to) {
  if (period.mode === "day") return "Hari ini";
  if (period.mode === "month") return monthLabel(from.slice(0, 7));
  if (period.mode === "year") return from.slice(0, 4);
  return `${shortDate(from)} – ${shortDate(to)}`;
}

export function render(root) {
  const bal = accountBalances();
  const accounts = activeAccounts();
  const totalBalance = totalCashIDR() + (includeAssets ? totalAssetsIDR() + totalGoalSavingsIDR() : 0);
  const { from, to } = periodRange();
  const sum = rangeSummary(from, to);
  const savingRate = sum.income > 0 ? ((sum.surplus / sum.income) * 100).toFixed(0) : null;
  const recent = state.transactions.slice(0, 3);
  const goals = state.goals.slice().sort((a, b) => (a.targetAmount || 0) - (b.targetAmount || 0));

  root.innerHTML = `
    <div class="chart-tabs period-tabs">
      ${Object.entries(PERIOD_LABELS).map(([key, label]) => `
        <button data-period="${key}" class="${period.mode === key ? "active" : ""}">${label}</button>`).join("")}
      <button data-period="custom" class="${period.mode === "custom" ? "active" : ""}">📅 ${period.mode === "custom" ? periodRangeLabel(from, to) : "Custom"}</button>
    </div>

    <div class="networth-banner">
      <div class="nw-head">
        <div class="label">Total Balance</div>
        <div style="display:flex; gap:6px; align-items:center">
          <button class="asset-toggle ${includeAssets ? "active" : ""}" data-asset-toggle>+ Assets</button>
          <button class="blur-toggle" data-blur-toggle aria-label="${isBlurred() ? "Tampilkan" : "Sembunyikan"} saldo">${isBlurred() ? "🙈" : "👁️"}</button>
        </div>
      </div>
      <div class="big-amount" style="color:#93c5fd">${fmtIDR(totalBalance)}</div>
      <div class="sub" style="color:#7da3d8">${periodRangeLabel(from, to)}</div>
      <div class="summary3" style="margin-top:14px">
        <div><div class="label">Income</div><div class="v" style="color:var(--green)">${fmtIDR(sum.income)}</div></div>
        <div><div class="label">Expense</div><div class="v" style="color:var(--red)">${fmtIDR(sum.expense)}</div></div>
        <div><div class="label">Surplus</div><div class="v" style="color:${sum.surplus >= 0 ? "var(--green)" : "var(--red)"}">${fmtIDR(sum.surplus)}</div>
        ${savingRate !== null ? `<div class="sub">saving rate ${savingRate}%</div>` : ""}</div>
      </div>
    </div>

    <div class="card-title" style="margin:2px 2px 8px">Akun</div>
    <div class="acct-scroll">
      ${accounts.map((a) => `
        <div class="acct-card" style="border-top-color:${a.color || "#60a5fa"}">
          <div class="name">${escapeHtml(a.name)}</div>
          <div class="bal">${fmtMoney(bal[a.id] || 0, a.currency)}</div>
          <div class="cur">${a.currency}${a.currency === "USD" ? ` · ≈ ${fmtIDR((bal[a.id] || 0) * effectiveRate())}` : ""}</div>
        </div>`).join("")}
      ${accounts.length === 0 ? `<div class="empty" style="flex:1">Belum ada akun.<br/>Buat di <a href="#/settings" style="color:var(--blue)">Settings</a></div>` : ""}
    </div>

    <div style="display:flex; justify-content:space-between; align-items:baseline; margin:2px 2px 8px">
      <span class="card-title" style="margin:0">Goals</span>
      <a href="#/goals" class="gear-link" style="font-size:11px">Kelola →</a>
    </div>
    <div class="budget-scroll" id="goal-slider"></div>

    <div style="display:flex; justify-content:space-between; align-items:baseline; margin:2px 2px 8px">
      <span class="card-title" style="margin:0">Budget bulan ini</span>
      <a href="#/budget" class="gear-link" style="font-size:11px">Kelola →</a>
    </div>
    <div class="budget-scroll" id="budget-slider"></div>

    <div class="card">
      <div class="card-title">Transaksi terakhir</div>
      <div id="recent-list">
        ${recent.length === 0 ? `<div class="empty">Belum ada transaksi.<br/>Tap tombol ＋ untuk mulai catat.</div>` : ""}
      </div>
      ${recent.length > 0 ? `<a href="#/transactions" class="gear-link" style="display:block;text-align:center;margin-top:8px">Lihat semua →</a>` : ""}
    </div>
  `;

  root.querySelector("[data-blur-toggle]").onclick = (e) => {
    const next = !isBlurred();
    setBlurred(next);
    e.currentTarget.textContent = next ? "🙈" : "👁️";
    e.currentTarget.setAttribute("aria-label", next ? "Tampilkan saldo" : "Sembunyikan saldo");
  };

  root.querySelector("[data-asset-toggle]").onclick = () => {
    includeAssets = !includeAssets;
    localStorage.setItem(INCLUDE_ASSETS_KEY, includeAssets ? "1" : "0");
    render(root);
  };

  root.querySelectorAll("[data-period]").forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.period;
      if (key === "custom") return openCustomRangeSheet(root);
      period.mode = key;
      render(root);
    };
  });

  const list = root.querySelector("#recent-list");
  recent.forEach((t) => list.appendChild(txRow(t)));

  // Goals slider
  const goalSlider = root.querySelector("#goal-slider");
  if (goals.length === 0) {
    goalSlider.innerHTML = `<div class="budget-mini" style="flex:1" onclick="location.hash='#/goals'">
      <div class="bm-name">Belum ada goals</div>
      <div class="bm-nums">Tap buat bikin target →</div>
    </div>`;
  } else {
    goals.forEach((g) => {
      const target = Number(g.targetAmount) || 0;
      const saved = goalSavedIDR(g.id);
      const pct = target > 0 ? Math.max(0, Math.min(100, (saved / target) * 100)) : 0;
      const cls = pct >= 100 ? "p-green" : pct >= 50 ? "p-yellow" : "p-red";
      const div = document.createElement("div");
      div.className = "budget-mini";
      div.innerHTML = `
        <div class="bm-name">🎯 ${escapeHtml(g.name)}</div>
        <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
        <div class="bm-nums">${fmtIDR(saved)} / ${fmtIDR(target)} <span style="color:${pct >= 100 ? "var(--green)" : "var(--muted)"}">· ${pct.toFixed(0)}%</span></div>`;
      div.onclick = () => { location.hash = "#/goals"; };
      goalSlider.appendChild(div);
    });
  }

  // Budget slider
  const slider = root.querySelector("#budget-slider");
  const m = currentMonth();
  const budgets = budgetsOfMonth(m);
  const spent = spentByCategory(m);
  if (budgets.length === 0) {
    slider.innerHTML = `<div class="budget-mini" style="flex:1" onclick="location.hash='#/budget'">
      <div class="bm-name">Belum ada budget</div>
      <div class="bm-nums">Tap untuk set budget bulan ini →</div>
    </div>`;
  } else {
    budgets
      .slice()
      .sort((a, b) => (spent[b.categoryId] || 0) / (b.amount || 1) - (spent[a.categoryId] || 0) / (a.amount || 1))
      .forEach((b) => {
        const cat = catById(b.categoryId);
        const used = spent[b.categoryId] || 0;
        const pct = b.amount > 0 ? (used / b.amount) * 100 : 0;
        const cls = pct >= 100 ? "p-red" : pct >= 90 ? "p-yellow" : "p-green";
        const div = document.createElement("div");
        div.className = "budget-mini";
        div.innerHTML = `
          <div class="bm-name">${cat?.icon || "📦"} ${escapeHtml(cat?.name || "?")}</div>
          <div class="progress"><div class="${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
          <div class="bm-nums">${fmtIDR(used)} / ${fmtIDR(b.amount)}
            <span style="color:${pct >= 100 ? "var(--red)" : pct >= 90 ? "var(--yellow)" : "var(--muted)"}">· ${pct.toFixed(0)}%</span>
          </div>`;
        div.onclick = () => { location.hash = "#/budget"; };
        slider.appendChild(div);
      });
  }
}

function openCustomRangeSheet(root) {
  const today = todayStr();
  const el = openSheet(`
    ${sheetHead("Rentang Tanggal")}
    <label>Dari</label>
    <input id="p-from" type="date" value="${period.from || today}" max="${today}" />
    <label>Sampai</label>
    <input id="p-to" type="date" value="${period.to || today}" max="${today}" />
    <button id="p-apply" class="btn btn-primary btn-block" style="margin-top:18px">Terapkan</button>
  `);
  el.querySelector("[data-close]").onclick = closeSheet;
  el.querySelector("#p-apply").onclick = () => {
    const from = el.querySelector("#p-from").value;
    const to = el.querySelector("#p-to").value;
    if (!from || !to) return toast("Isi tanggal dari & sampai");
    if (from > to) return toast("Tanggal 'dari' harus sebelum 'sampai'");
    period.mode = "custom";
    period.from = from;
    period.to = to;
    closeSheet();
    render(root);
  };
}

export function txRow(t) {
  const goal = t.toGoalId ? state.goals.find((g) => g.id === t.toGoalId) : null;
  const cat = t.type === "transfer" ? null : catById(t.categoryId);
  const acct = acctById(t.accountId);
  const toAcct = t.toAccountId ? acctById(t.toAccountId) : null;
  const div = document.createElement("div");
  div.className = "tx-item";
  const sign = t.type === "expense" ? "−" : t.type === "income" ? "+" : "⇄";
  div.innerHTML = `
    <div class="tx-ic">${goal ? "🎯" : t.type === "transfer" ? "🔁" : (cat?.icon || "📦")}</div>
    <div class="tx-main">
      <div class="tx-cat">${goal
        ? `Topup: ${escapeHtml(goal.name)}`
        : t.type === "transfer" ? `Transfer` : escapeHtml(cat?.name || "—")}</div>
      <div class="tx-note">${escapeHtml(t.note || dateLabel(t.date))}</div>
    </div>
    <div>
      <div class="tx-amt ${t.type}">${sign} ${fmtMoney(t.amount, acct?.currency)}</div>
      <div class="tx-acct">${escapeHtml(acct?.name || "?")}${toAcct ? ` → ${escapeHtml(toAcct.name)}` : ""}${goal ? ` → 🎯 ${escapeHtml(goal.name)}` : ""}</div>
    </div>`;
  div.onclick = () => (goal ? openTopupSheet(goal, t) : openTxSheet(t));
  return div;
}

import {
  state, activeAccounts, accountBalances, netWorthIDR, monthSummary,
  catById, acctById, effectiveRate, budgetsOfMonth, spentByCategory,
} from "../store.js";
import { fmtIDR, fmtMoney, escapeHtml, dateLabel, currentMonth, isBlurred, setBlurred } from "../utils.js";
import { openTxSheet } from "../tx-sheet.js";

export function render(root) {
  const bal = accountBalances();
  const accounts = activeAccounts();
  const nw = netWorthIDR();
  const target = Number(state.settings.targetNetWorth) || 100_000_000;
  const pctTarget = Math.max(0, Math.min(100, (nw / target) * 100));
  const sum = monthSummary(currentMonth());
  const savingRate = sum.income > 0 ? ((sum.surplus / sum.income) * 100).toFixed(0) : null;
  const recent = state.transactions.slice(0, 3);

  root.innerHTML = `
    <div class="networth-banner">
      <div class="nw-head">
        <div class="label">Net Worth</div>
        <button class="blur-toggle" data-blur-toggle aria-label="${isBlurred() ? "Tampilkan" : "Sembunyikan"} saldo">${isBlurred() ? "🙈" : "👁️"}</button>
      </div>
      <div class="big-amount" style="color:#93c5fd">${fmtIDR(nw)}</div>
      <div class="progress" style="margin-top:12px; height:8px;">
        <div class="p-green" style="width:${pctTarget}%; background:linear-gradient(90deg,#3b82f6,#60a5fa)"></div>
      </div>
      <div class="sub" style="color:#7da3d8">${pctTarget.toFixed(1)}% menuju target ${fmtIDR(target)}</div>
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

    <div class="card">
      <div class="card-title">Bulan ini</div>
      <div class="summary3">
        <div><div class="label">Income</div><div class="v" style="color:var(--green)">${fmtIDR(sum.income)}</div></div>
        <div><div class="label">Expense</div><div class="v" style="color:var(--red)">${fmtIDR(sum.expense)}</div></div>
        <div><div class="label">Surplus</div><div class="v" style="color:${sum.surplus >= 0 ? "var(--green)" : "var(--red)"}">${fmtIDR(sum.surplus)}</div>
        ${savingRate !== null ? `<div class="sub">saving rate ${savingRate}%</div>` : ""}</div>
      </div>
    </div>

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

  const list = root.querySelector("#recent-list");
  recent.forEach((t) => list.appendChild(txRow(t)));

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

export function txRow(t) {
  const cat = t.type === "transfer" ? null : catById(t.categoryId);
  const acct = acctById(t.accountId);
  const toAcct = t.toAccountId ? acctById(t.toAccountId) : null;
  const div = document.createElement("div");
  div.className = "tx-item";
  const sign = t.type === "expense" ? "−" : t.type === "income" ? "+" : "⇄";
  div.innerHTML = `
    <div class="tx-ic">${t.type === "transfer" ? "🔁" : (cat?.icon || "📦")}</div>
    <div class="tx-main">
      <div class="tx-cat">${t.type === "transfer"
        ? `Transfer` : escapeHtml(cat?.name || "—")}</div>
      <div class="tx-note">${escapeHtml(t.note || dateLabel(t.date))}</div>
    </div>
    <div>
      <div class="tx-amt ${t.type}">${sign} ${fmtMoney(t.amount, acct?.currency)}</div>
      <div class="tx-acct">${escapeHtml(acct?.name || "?")}${toAcct ? ` → ${escapeHtml(toAcct.name)}` : ""}</div>
    </div>`;
  div.onclick = () => openTxSheet(t);
  return div;
}

// Generate laporan bulanan .md — snapshot finansial 1 bulan, siap paste ke chat AI.
// Beda dari exportAll() (db.js): itu backup JSON buat restore, ini human/AI-readable.
// Fungsi murni, ga nulis apa-apa ke Firestore, cuma baca dari store.
import {
  state, activeAccounts, accountBalances, totalCashIDR, totalAssetsIDR, totalDebtIDR,
  totalGoalSavingsIDR, netWorthIDR, assetValueIDR, assetCostIDR, goalSavedIDR,
  effectiveRate, monthSummary, spentByCategory, budgetsOfMonth, catById, acctById,
} from "./store.js";
import { fmtIDRPlain, fmtMoneyPlain, fmtNum, monthLabel, addMonths, todayStr, currentMonth } from "./utils.js";
import { ASSET_TYPES } from "./views/wealth.js";
import { ACCT_TYPES } from "./views/accounts.js";

const NA = "—";
const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function mdTable(headers, rows) {
  if (rows.length === 0) return "_— tidak ada —_\n";
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
  return `${head}\n${sep}\n${body}\n`;
}

function recurringTargetLabel(r) {
  if (r.type === "transfer") {
    const acct = acctById(r.toAccountId);
    return acct ? `→ ${acct.name}` : "→ ?";
  }
  const cat = catById(r.categoryId);
  let label = cat ? cat.name : "?";
  if (r.debtId) {
    const debt = state.debts.find((d) => d.id === r.debtId);
    if (debt) label += ` (potong hutang: ${debt.name})`;
  }
  return label;
}

// Bulan yang layak dipilih di dropdown: punya transaksi atau snapshot, + bulan berjalan
// selalu ada (default). Diekspor biar Setting ga perlu duplikasi logic query-nya.
export function availableReportMonths() {
  const set = new Set([currentMonth()]);
  state.transactions.forEach((t) => set.add(t.month));
  state.snapshots.forEach((s) => set.add(s.month || s.id));
  return [...set].sort().reverse();
}

export function buildMonthlyReport(month) {
  const today = todayStr();
  const isCurrentMonth = month === currentMonth();
  const rate = effectiveRate();
  const kursLabel = state.settings.usdIdrManual
    ? `Rp ${fmtNum(rate)} (manual)`
    : state.usdIdr ? `Rp ${fmtNum(rate)} (auto per ${state.usdIdr.date})` : `Rp ${fmtNum(rate)} (fallback)`;

  const lines = [];
  lines.push(`# Laporan Keuangan — ${monthLabel(month)}`);
  lines.push(`Digenerate: ${today} · Kurs USD/IDR: ${kursLabel}`);
  lines.push("");

  // ===== 1. Ringkasan =====
  // Posisi (cash/assets/goal/debt) SELALU live (app ga nyimpen histori posisi harian/bulanan
  // per akun/asset/debt/goal) — sama kayak section 5-8. Delta net worth khusus dari snapshots
  // (satu-satunya sumber histori net worth yang ada), dibandingkan ke bulan lalu dari SEKARANG,
  // bukan ke bulan sebelum bulan yang dipilih — karena section ini emang bukan potret historis.
  lines.push("## 1. Ringkasan");
  lines.push(`_Posisi per ${today}${!isCurrentMonth ? ` — BUKAN posisi akhir ${monthLabel(month)}, app cuma nyimpen posisi TERKINI (bukan histori per bulan) buat akun/asset/debt/goal.` : "."}_`);
  const cash = totalCashIDR();
  const assetsVal = totalAssetsIDR();
  const goalSav = totalGoalSavingsIDR();
  const debt = totalDebtIDR();
  const nw = netWorthIDR();
  const prevMonthKey = addMonths(currentMonth(), -1);
  const prevSnap = state.snapshots.find((s) => s.id === prevMonthKey);
  const nwDelta = prevSnap ? nw - prevSnap.netWorth : null;
  lines.push(`- **Net worth: ${fmtIDRPlain(nw)}**${nwDelta !== null ? ` (Δ ${nwDelta >= 0 ? "+" : "−"}${fmtIDRPlain(Math.abs(nwDelta))} vs snapshot ${monthLabel(prevMonthKey)})` : ""}`);
  lines.push(`- Cash: ${fmtIDRPlain(cash)} · Assets: ${fmtIDRPlain(assetsVal)} · Goal savings: ${fmtIDRPlain(goalSav)} · Debt: −${fmtIDRPlain(debt)}`);
  const target = Number(state.settings.targetNetWorth) || 0;
  if (target > 0) {
    const milestonePct = Math.max(0, (nw / target) * 100);
    lines.push(`- Progress 🏆 Main Milestone: ${fmtIDRPlain(nw)} dari ${fmtIDRPlain(target)} (${milestonePct.toFixed(1)}%)`);
  }
  lines.push("");

  // ===== 2. Cashflow =====
  lines.push(`## 2. Cashflow ${monthLabel(month)}`);
  const sum = monthSummary(month);
  const savingRate = sum.income > 0 ? (sum.surplus / sum.income) * 100 : null;
  const prevMonth = addMonths(month, -1);
  const prevSum = monthSummary(prevMonth);
  const expenseDeltaPct = prevSum.expense > 0 ? ((sum.expense - prevSum.expense) / prevSum.expense) * 100 : null;
  lines.push(`- Income: ${fmtIDRPlain(sum.income)} · Expense: ${fmtIDRPlain(sum.expense)} · Surplus: ${fmtIDRPlain(sum.surplus)}`);
  lines.push(`- Saving rate: ${savingRate !== null ? savingRate.toFixed(1) + "%" : NA}`);
  lines.push(`- Expense vs bulan lalu (${monthLabel(prevMonth)}): ${expenseDeltaPct !== null ? pct(expenseDeltaPct) : NA}`);
  lines.push("");

  // ===== 3. Expense per Kategori =====
  lines.push(`## 3. Expense per Kategori ${monthLabel(month)}`);
  const spent = spentByCategory(month);
  const budgets = budgetsOfMonth(month);
  const catRows = Object.entries(spent)
    .sort((a, b) => b[1] - a[1])
    .map(([catId, amt]) => {
      const cat = catById(catId);
      const budget = budgets.find((b) => b.categoryId === catId);
      const pctOfTotal = sum.expense > 0 ? (amt / sum.expense) * 100 : 0;
      const diff = budget ? budget.amount - amt : null;
      return [
        `${cat?.icon || "📦"} ${cat?.name || catId}`,
        fmtIDRPlain(amt),
        `${pctOfTotal.toFixed(1)}%`,
        budget ? fmtIDRPlain(budget.amount) : NA,
        diff !== null ? (diff >= 0 ? `sisa ${fmtIDRPlain(diff)}` : `over ${fmtIDRPlain(-diff)}`) : NA,
      ];
    });
  lines.push(mdTable(["Kategori", "Nominal", "% Expense", "Budget", "Selisih"], catRows));
  lines.push("");

  // ===== 4. Budget vs Aktual =====
  lines.push(`## 4. Budget vs Aktual ${monthLabel(month)}`);
  if (budgets.length === 0) {
    lines.push("_Belum ada budget di bulan ini._");
  } else {
    const totalBudget = budgets.reduce((s, b) => s + Number(b.amount || 0), 0);
    const totalSpentBudgeted = budgets.reduce((s, b) => s + (spent[b.categoryId] || 0), 0);
    lines.push(`- Total budget: ${fmtIDRPlain(totalBudget)} · Terpakai: ${fmtIDRPlain(totalSpentBudgeted)} · Sisa: ${fmtIDRPlain(totalBudget - totalSpentBudgeted)}`);
    const overBudget = budgets.filter((b) => (spent[b.categoryId] || 0) > Number(b.amount || 0));
    lines.push(`- ⚠️ Over budget: ${overBudget.length > 0 ? overBudget.map((b) => catById(b.categoryId)?.name || b.categoryId).join(", ") : "tidak ada"}`);
  }
  lines.push("");

  // ===== 5. Akun =====
  lines.push(`## 5. Akun (posisi per ${today})`);
  const bal = accountBalances();
  const acctRows = activeAccounts().map((a) => {
    const b = bal[a.id] || 0;
    const idr = a.currency === "USD" ? b * rate : b;
    return [a.name, ACCT_TYPES[a.type] || a.type, a.currency, fmtMoneyPlain(b, a.currency), fmtIDRPlain(idr)];
  });
  lines.push(mdTable(["Akun", "Tipe", "Currency", "Saldo", "Ekuivalen IDR"], acctRows));
  lines.push("");

  // ===== 6. Investasi =====
  lines.push(`## 6. Investasi (posisi per ${today})`);
  let invTotal = 0, invCost = 0;
  const assetRows = [];
  Object.keys(ASSET_TYPES).forEach((type) => {
    state.assets.filter((a) => a.type === type).forEach((a) => {
      const val = assetValueIDR(a);
      const cost = assetCostIDR(a);
      const p = val - cost;
      const pPct = cost > 0 ? (p / cost) * 100 : 0;
      invTotal += val; invCost += cost;
      assetRows.push([
        a.symbol || a.name, ASSET_TYPES[a.type] || a.type,
        a.type === "stock_id" ? `${fmtNum(a.quantity)} lot` : String(a.quantity),
        fmtMoneyPlain(a.avgBuyPrice, a.currency),
        `${fmtMoneyPlain(a.manualPrice, a.currency)} (${a.manualPriceUpdatedAt || "?"})`,
        fmtIDRPlain(val), `${p >= 0 ? "+" : ""}${fmtIDRPlain(p)}`, `${pPct >= 0 ? "+" : ""}${pPct.toFixed(1)}%`,
      ]);
    });
  });
  lines.push(mdTable(["Symbol", "Tipe", "Qty", "Avg Buy", "Harga Terakhir", "Nilai", "P&L", "P&L %"], assetRows));
  if (state.assets.length > 0) {
    const invPnl = invTotal - invCost;
    const invPnlPct = invCost > 0 ? (invPnl / invCost) * 100 : 0;
    lines.push(`**Total** — Nilai: ${fmtIDRPlain(invTotal)} · Invested: ${fmtIDRPlain(invCost)} · Unrealized P&L: ${invPnl >= 0 ? "+" : ""}${fmtIDRPlain(invPnl)} (${invPnl >= 0 ? "+" : ""}${invPnlPct.toFixed(1)}%)`);
  }
  lines.push("");

  // ===== 7. Hutang =====
  lines.push(`## 7. Hutang (posisi per ${today})`);
  const debtRows = state.debts.map((d) => [
    d.name, fmtIDRPlain(d.totalOutstanding), fmtIDRPlain(d.monthlyInstalment),
    d.dueDay ? `tgl ${d.dueDay}` : NA, d.remainingMonths ?? NA,
  ]);
  lines.push(mdTable(["Nama", "Outstanding", "Cicilan/bln", "Jatuh Tempo", "Sisa Bulan"], debtRows));
  if (state.debts.length > 0) {
    const totalOutstanding = state.debts.reduce((s, d) => s + (Number(d.totalOutstanding) || 0), 0);
    const totalInstalment = state.debts.reduce((s, d) => s + (Number(d.monthlyInstalment) || 0), 0);
    const dti = sum.income > 0 ? (totalInstalment / sum.income) * 100 : null;
    lines.push(`**Total** — Outstanding: ${fmtIDRPlain(totalOutstanding)} · Cicilan/bln: ${fmtIDRPlain(totalInstalment)} · DTI (vs income ${monthLabel(month)}): ${dti !== null ? dti.toFixed(1) + "%" : NA}`);
  }
  lines.push("");

  // ===== 8. Short Term Goals =====
  lines.push(`## 8. Short Term Goals (posisi per ${today})`);
  const goalRows = state.goals.map((g) => {
    const t = Number(g.targetAmount) || 0;
    const saved = goalSavedIDR(g.id);
    const p = t > 0 ? Math.max(0, Math.min(100, (saved / t) * 100)) : 0;
    const remaining = Math.max(0, t - saved);
    return [g.name, fmtIDRPlain(t), fmtIDRPlain(saved), `${p.toFixed(0)}%`, g.targetDate ? monthLabel(g.targetDate) : NA, fmtIDRPlain(remaining)];
  });
  lines.push(mdTable(["Goal", "Target", "Terkumpul", "%", "Target Date", "Sisa Perlu Ditabung"], goalRows));
  lines.push("");

  // ===== 9. Komitmen Rutin =====
  lines.push("## 9. Komitmen Rutin (recurring aktif)");
  const activeRecurring = state.recurring.filter((r) => r.active !== false);
  const rcRows = activeRecurring.map((r) => [
    r.name, r.type === "expense" ? "Expense" : r.type === "income" ? "Income" : "Transfer",
    fmtMoneyPlain(r.amount, acctById(r.accountId)?.currency), `tgl ${r.dayOfMonth}`,
    recurringTargetLabel(r),
  ]);
  lines.push(mdTable(["Nama", "Tipe", "Nominal", "Tanggal", "Tujuan"], rcRows));
  if (activeRecurring.length > 0) {
    const totalCommit = activeRecurring
      .filter((r) => r.type === "expense")
      .reduce((s, r) => {
        const acct = acctById(r.accountId);
        const amt = Number(r.amount) || 0;
        return s + (acct?.currency === "USD" ? amt * rate : amt);
      }, 0);
    lines.push(`**Total komitmen expense rutin/bulan:** ${fmtIDRPlain(totalCommit)}`);
  }
  lines.push("");

  // ===== 10. Tren Net Worth =====
  lines.push("## 10. Tren Net Worth");
  const snaps = state.snapshots.slice(-12);
  const trendRows = snaps.map((s, i) => {
    const prev = snaps[i - 1];
    const delta = prev ? s.netWorth - prev.netWorth : null;
    return [monthLabel(s.month || s.id), fmtIDRPlain(s.netWorth), delta !== null ? `${delta >= 0 ? "+" : "−"}${fmtIDRPlain(Math.abs(delta))}` : NA];
  });
  lines.push(mdTable(["Bulan", "Net Worth", "Delta"], trendRows));
  lines.push("");

  // ===== 11. Konteks untuk Analisis =====
  // Sengaja TIDAK hardcode profil owner (usia/gaji/nama bank) di sini — itu cuma ada di
  // CLAUDE.md (dev doc), bukan data Firestore. Nulis literal itu di source JS bakal ke-ship
  // ke browser siapapun yang buka situs (static site, bukan cuma yang login), beda kelas
  // exposure-nya dari data lain di app ini yang semua datang dari Firestore ber-auth.
  // Konteks di section ini murni diturunkan dari data yang memang udah ke-load di state.
  lines.push("## 11. Konteks untuk Analisis");
  if (target > 0) {
    lines.push(`- Target Main Milestone: ${fmtIDRPlain(target)} (progress lihat section 1).`);
  }
  if (state.assets.length > 0) {
    const manualCount = state.assets.filter((a) => a.manualOnly || !a.priceSource).length;
    lines.push(`- Harga asset: ${state.assets.length - manualCount} auto-refresh, ${manualCount} manual — cek kolom "Harga Terakhir" di section 6 buat tanggal update sebelum menilai P&L.`);
  }
  lines.push("- Data di atas cuma yang tercatat di FinTrack — kalau ada akun/aset di luar app ini, pertimbangkan itu juga.");
  lines.push("");
  lines.push("**Pertanyaan buat dianalisis:**");
  lines.push("1. Apakah saving rate bulan ini sehat, dan gimana trennya dibanding beberapa bulan terakhir?");
  lines.push("2. Prioritas cashflow bulan depan: percepat lunasi debt, atau naikkan investasi/goal?");
  lines.push("3. Apakah alokasi asset di section 6 terlalu terkonsentrasi di satu tipe/instrumen?");
  lines.push("4. Ada kategori expense yang konsisten over budget dan perlu direvisi target budgetnya?");
  lines.push("5. Dengan tren net worth di section 10, realistis ga nyampe Main Milestone-nya?");

  return lines.join("\n");
}

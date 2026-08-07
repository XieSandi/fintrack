// Generate laporan bulanan .md — snapshot finansial 1 bulan, siap paste ke chat AI.
// Beda dari exportAll() (db.js): itu backup JSON buat restore, ini human/AI-readable.
// Fungsi murni, ga nulis apa-apa ke Firestore, cuma baca dari store.
import {
  state, activeAccounts, activeGoals, accountBalances, totalCashIDR, totalAssetsIDR, totalCapexIDR, totalDebtIDR,
  totalGoalSavingsIDR, netWorthIDR, netWorthFromParts, snapshotNetWorth, netWorthComposition, assetValueIDR, assetCostIDR, capexLocalValue, goalSavedIDR,
  goalLinkedAssetsValueIDR, effectiveRate, monthSummary, spentByCategory, budgetsOfMonth, catById, acctById, milestoneProgress,
} from "./store.js";
import {
  fmtIDRPlain, fmtMoneyPlain, fmtNum, monthLabel, addMonths, todayStr, currentMonth, milestonePaceLine,
} from "./utils.js";
import { ASSET_TYPES } from "./views/wealth.js";
import { ACCT_TYPES } from "./views/accounts.js";

const NA = "—";
const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
const signed = (n) => `${n >= 0 ? "+" : "−"}${fmtIDRPlain(Math.abs(n))}`;

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

// Snapshot "lengkap" = punya breakdown per-item (bukan cuma total) — dibuat mulai upsertSnapshot()
// diperkaya. Snapshot lama/manual backfill ga punya ini, JANGAN dianggap lengkap (jangan mengarang).
function isSnapshotComplete(snap) {
  return !!snap?.breakdown
    && Array.isArray(snap.breakdown.accounts) && Array.isArray(snap.breakdown.assets)
    && Array.isArray(snap.breakdown.debts) && Array.isArray(snap.breakdown.goals)
    && typeof snap.breakdown.rate === "number";
}

// Sumber posisi (akun/asset/debt/goal) buat satu laporan — SATU tempat yang mutusin snapshot
// vs live, dipakai section 1/5/6/7/8 biar konsisten (bukan tiap section mutusin sendiri-sendiri).
// Bulan berjalan SELALU live (snapshot bulan itu masih "berjalan", belum final). Bulan lampau
// pakai snapshot HANYA kalau lengkap; kalau ga ada/minim (backfill lama), fallback ke live +
// disclaimer eksplisit — jangan pernah nyamar seolah itu posisi akhir bulan yang beneran.
function buildPosition(month, isCurrentMonth) {
  const snap = !isCurrentMonth ? state.snapshots.find((s) => s.id === month) : null;
  if (isSnapshotComplete(snap)) {
    return {
      fromSnapshot: true,
      label: `Posisi akhir ${monthLabel(month)}`,
      disclaimer: null,
      cash: snap.totalCash || 0,
      assetsTotal: snap.totalAssets || 0,
      capexTotal: snap.totalCapex || 0, // snapshot lama (pre-fitur CAPEX) ga punya field ini -> 0
      goalSavingsTotal: snap.totalGoalSavings || 0,
      debtTotal: snap.totalDebt || 0,
      nw: snap.netWorth || 0,
      rate: snap.breakdown.rate,
      accounts: snap.breakdown.accounts,
      assets: snap.breakdown.assets,
      debts: snap.breakdown.debts,
      goals: snap.breakdown.goals,
    };
  }

  const bal = accountBalances();
  const rate = effectiveRate();
  return {
    fromSnapshot: false,
    label: `Posisi per ${todayStr()}`,
    disclaimer: !isCurrentMonth
      ? `BUKAN posisi akhir ${monthLabel(month)}, app cuma nyimpen posisi TERKINI (bukan histori per bulan) buat akun/asset/debt/goal.`
      : null,
    cash: totalCashIDR(),
    assetsTotal: totalAssetsIDR(),
    capexTotal: totalCapexIDR(),
    goalSavingsTotal: totalGoalSavingsIDR(),
    debtTotal: totalDebtIDR(),
    nw: netWorthIDR(),
    rate,
    accounts: activeAccounts().map((a) => {
      const b = bal[a.id] || 0;
      return {
        name: a.name, currency: a.currency, type: a.type, balance: b,
        balanceIDR: a.currency === "USD" ? b * rate : b,
        creditLimit: a.type === "credit" ? (Number(a.creditLimit) || 0) : null,
      };
    }),
    assets: state.assets.map((a) => ({
      symbol: a.symbol || a.name, type: a.type, currency: a.currency,
      quantity: Number(a.quantity) || 0, avgBuyPrice: Number(a.avgBuyPrice) || 0,
      price: a.type === "capex" ? capexLocalValue(a) : Number(a.manualPrice) || 0,
      priceDate: a.type === "capex" ? todayStr() : (a.manualPriceUpdatedAt || null),
      valueIDR: assetValueIDR(a), costIDR: assetCostIDR(a),
    })),
    debts: state.debts.map((d) => ({
      name: d.name, outstanding: Number(d.totalOutstanding) || 0,
      monthlyInstalment: Number(d.monthlyInstalment) || 0,
      remainingMonths: d.remainingMonths ?? null, dueDay: d.dueDay ?? null,
    })),
    // activeGoals() — goal yang diarsipkan ga ikut ditabelin di section 8 (pola sama akun
    // pakai activeAccounts() di atas), goalSavingsTotal-nya sendiri (atas) TETAP dari
    // totalGoalSavingsIDR() yang ga difilter, jadi saldo goal arsip tetap kehitung di net worth.
    goals: activeGoals().map((g) => ({
      name: g.name, targetAmount: Number(g.targetAmount) || 0,
      saved: goalSavedIDR(g.id), linkedValue: goalLinkedAssetsValueIDR(g.id),
      targetDate: g.targetDate || null,
    })),
  };
}

export function buildMonthlyReport(month) {
  const today = todayStr();
  const isCurrentMonth = month === currentMonth();
  const position = buildPosition(month, isCurrentMonth);
  const liveRate = effectiveRate(); // buat section yang inherently "sekarang" (mis. recurring), beda dari position.rate yang bisa historis
  const liveMilestone = milestoneProgress(); // pace SELALU dari posisi TERKINI (forward-looking "dari sekarang", bukan konsep historis per bulan)
  const kursLabel = position.fromSnapshot
    ? `Rp ${fmtNum(position.rate)} (per akhir ${monthLabel(month)})`
    : state.settings.usdIdrManual
    ? `Rp ${fmtNum(position.rate)} (manual)`
    : state.usdIdr ? `Rp ${fmtNum(position.rate)} (auto per ${state.usdIdr.date})` : `Rp ${fmtNum(position.rate)} (fallback)`;

  const lines = [];
  lines.push(`# Laporan Keuangan — ${monthLabel(month)}`);
  lines.push(`Digenerate: ${today} · Kurs USD/IDR: ${kursLabel}`);
  lines.push("");

  // ===== 1. Ringkasan =====
  lines.push("## 1. Ringkasan");
  lines.push(`_${position.label}${position.disclaimer ? ` — ${position.disclaimer}` : "."}_`);
  // Net worth SELALU ditampilin DUA variant eksplisit (+ CAPEX / tanpa CAPEX) — bukan cuma satu
  // angka ambigu — biar AI yang analisis laporan ini bisa bandingin dua skenario itu sendiri,
  // bukan cuma nerima satu angka yang bisa maksudnya beda-beda tergantung toggle waktu itu.
  // Dua-duanya dihitung dari breakdown MENTAH position (cash/assetsTotal RAW/capexTotal/dst)
  // lewat SATU formula (`netWorthFromParts()`, calc.js) — biar konsisten sama chart Wealth.
  const partsNow = { cash: position.cash, assets: position.assetsTotal, capex: position.capexTotal, goalSavings: position.goalSavingsTotal, debt: position.debtTotal };
  const nwWithCapex = netWorthFromParts(partsNow, true);
  const nwWithoutCapex = netWorthFromParts(partsNow, false);
  const includeCapexNow = state.settings.includeCapexInNetWorth === true;
  const nwForToggle = includeCapexNow ? nwWithCapex : nwWithoutCapex;

  const prevMonthKey = addMonths(month, -1);
  const prevSnap = state.snapshots.find((s) => s.id === prevMonthKey);
  const nwDelta = prevSnap ? nwForToggle - snapshotNetWorth(prevSnap, includeCapexNow) : null;

  lines.push(`- **Net worth (+ CAPEX): ${fmtIDRPlain(nwWithCapex)}**`);
  lines.push(`- **Net worth (tanpa CAPEX): ${fmtIDRPlain(nwWithoutCapex)}**`);
  lines.push(`- Dipakai app sekarang (toggle CAPEX di Wealth → Total): **${includeCapexNow ? "+ CAPEX" : "tanpa CAPEX"}** → ${fmtIDRPlain(nwForToggle)}${nwDelta !== null ? ` (Δ ${signed(nwDelta)} vs ${monthLabel(prevMonthKey)})` : ""}`);
  // TASK-2 (2026-08, riwayat: DECISIONS.md): "Goal savings" di sini SENGAJA cuma topup tunai
  // (`goalSavingsTotal`, sumber `totalGoalSavingsIDR()` — TIDAK diubah, itu benar buat net worth,
  // nilai asset ter-link udah kehitung penuh di Assets, nambahin lagi ke sini bakal double count).
  // TAPI kalau ada goal ber-asset-link, angka ini SENDIRIAN ("Rp 0") kontradiktif sama section 8
  // yang nunjukin "Terkumpul" jauh lebih besar — jadi WAJIB dikasih catatan eksplisit di sini kalau
  // ada linkedValue, biar ga kebaca seolah goal savings-nya beneran 0.
  const totalLinkedValue = position.goals.reduce((s, g) => s + (g.linkedValue || 0), 0);
  const goalSavingsLabel = totalLinkedValue > 0
    ? `${fmtIDRPlain(position.goalSavingsTotal)} (tunai) + ${fmtIDRPlain(totalLinkedValue)} (dari asset ter-link, sudah termasuk di Assets — TIDAK ditambah lagi di net worth)`
    : fmtIDRPlain(position.goalSavingsTotal);
  lines.push(`- Cash: ${fmtIDRPlain(position.cash)} · Assets (termasuk CAPEX): ${fmtIDRPlain(position.assetsTotal)}${position.capexTotal > 0 ? ` (di dalamnya CAPEX: ${fmtIDRPlain(position.capexTotal)})` : ""} · Goal savings: ${goalSavingsLabel} · Debt: −${fmtIDRPlain(position.debtTotal)}`);
  // Utang kartu kredit lewat DEBT PATH sekarang (v2, 2026-08 — lihat DECISIONS.md; beda dari v1
  // yang lewat cash path) — udah "included" di angka Debt di atas, TIDAK lagi di Cash. Baris ini
  // cuma informasi tambahan, misahin dari cicilan (collection `debts`) biar ga ketuker — detail
  // per kartu ada di section 7.
  const totalCreditDebt = position.accounts
    .filter((a) => a.type === "credit")
    .reduce((s, a) => s + Math.max(0, -(a.balanceIDR || 0)), 0);
  if (totalCreditDebt > 0) {
    lines.push(`- 🪪 Kartu Kredit terpakai: ${fmtIDRPlain(totalCreditDebt)} (sudah termasuk di Debt di atas — lewat debt path, beda dari cicilan/Debt collection, lihat section 7)`);
  }
  const target = Number(state.settings.targetNetWorth) || 0;
  if (target > 0) {
    const milestonePct = Math.max(0, (nwForToggle / target) * 100);
    lines.push(`- Progress 🏆 Main Milestone: ${fmtIDRPlain(nwForToggle)} dari ${fmtIDRPlain(target)} (${milestonePct.toFixed(1)}%)`);
  }
  const paceLine = milestonePaceLine(liveMilestone);
  if (paceLine) {
    lines.push(`- ${paceLine}${!isCurrentMonth ? " _(dihitung dari posisi TERKINI, bukan posisi " + monthLabel(month) + " — pace itu konsep forward-looking dari sekarang)_" : ""}`);
  }
  lines.push("");

  // ===== 2. Cashflow ===== (selalu historis — monthSummary udah difilter per bulan by design)
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

  // ===== 3. Expense per Kategori ===== (selalu historis)
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

  // ===== 4. Budget vs Aktual ===== (selalu historis)
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
  // Akun kartu kredit SENGAJA ga ditampilin sebagai "Saldo" positif/negatif biasa (bisa
  // kesalahbaca kayak "punya uang") — kolom Saldo diisi ringkasan Terpakai/Limit/Sisa,
  // Ekuivalen IDR tetap angka negatif apa adanya (representasi utang, bukan "saldo penuh").
  lines.push(`## 5. Akun (${position.label})`);
  const acctRows = position.accounts.map((a) => {
    if (a.type === "credit") {
      const used = a.balance < 0 ? -a.balance : 0;
      const limit = Number(a.creditLimit) || 0;
      const remaining = limit > 0 ? Math.max(0, limit - used) : null;
      const saldoLabel = `Terpakai ${fmtMoneyPlain(used, a.currency)}${limit > 0 ? ` / Limit ${fmtMoneyPlain(limit, a.currency)} / Sisa ${fmtMoneyPlain(remaining, a.currency)}` : " (tanpa limit)"}`;
      return [a.name, ACCT_TYPES[a.type] || "Kartu Kredit", a.currency, saldoLabel, fmtIDRPlain(a.balanceIDR)];
    }
    return [a.name, ACCT_TYPES[a.type] || a.type || "?", a.currency, fmtMoneyPlain(a.balance, a.currency), fmtIDRPlain(a.balanceIDR)];
  });
  lines.push(mdTable(["Akun", "Tipe", "Currency", "Saldo", "Ekuivalen IDR"], acctRows));
  lines.push("");

  // ===== 6. Investasi =====
  lines.push(`## 6. Investasi (${position.label})`);
  let invTotal = 0, invCost = 0;
  const assetRows = [];
  Object.keys(ASSET_TYPES).forEach((type) => {
    position.assets.filter((a) => a.type === type).forEach((a) => {
      const val = a.valueIDR;
      const cost = a.costIDR;
      const p = val - cost;
      const pPct = cost > 0 ? (p / cost) * 100 : 0;
      invTotal += val; invCost += cost;
      assetRows.push([
        a.symbol, ASSET_TYPES[a.type] || a.type,
        a.type === "stock_id" ? `${fmtNum(a.quantity)} lot` : String(a.quantity),
        fmtMoneyPlain(a.avgBuyPrice, a.currency),
        `${fmtMoneyPlain(a.price, a.currency)} (${a.priceDate || "?"})`,
        fmtIDRPlain(val), `${p >= 0 ? "+" : ""}${fmtIDRPlain(p)}`, `${pPct >= 0 ? "+" : ""}${pPct.toFixed(1)}%`,
      ]);
    });
  });
  lines.push(mdTable(["Symbol", "Tipe", "Qty", "Avg Buy", "Harga Terakhir", "Nilai", "P&L", "P&L %"], assetRows));
  if (position.assets.length > 0) {
    const invPnl = invTotal - invCost;
    const invPnlPct = invCost > 0 ? (invPnl / invCost) * 100 : 0;
    lines.push(`**Total** — Nilai: ${fmtIDRPlain(invTotal)} · Invested: ${fmtIDRPlain(invCost)} · Unrealized P&L: ${invPnl >= 0 ? "+" : ""}${fmtIDRPlain(invPnl)} (${invPnl >= 0 ? "+" : ""}${invPnlPct.toFixed(1)}%)`);
  }
  lines.push("");

  // ===== 7. Hutang =====
  // Cicilan (collection `debts`) di tabel utama. Kartu kredit (revolving, lewat debt path
  // sekarang — lihat DECISIONS.md) SENGAJA di subsection terpisah di bawahnya, bukan dicampur ke
  // tabel yang sama — field-nya beda konsep (Terpakai/Limit, bukan Cicilan/bln atau Jatuh Tempo).
  lines.push(`## 7. Hutang (${position.label})`);
  const debtRows = position.debts.map((d) => [
    d.name, fmtIDRPlain(d.outstanding), fmtIDRPlain(d.monthlyInstalment),
    d.dueDay ? `tgl ${d.dueDay}` : NA, d.remainingMonths ?? NA,
  ]);
  lines.push(mdTable(["Nama", "Outstanding", "Cicilan/bln", "Jatuh Tempo", "Sisa Bulan"], debtRows));
  if (position.debts.length > 0) {
    const totalOutstanding = position.debts.reduce((s, d) => s + d.outstanding, 0);
    const totalInstalment = position.debts.reduce((s, d) => s + d.monthlyInstalment, 0);
    const dti = sum.income > 0 ? (totalInstalment / sum.income) * 100 : null;
    lines.push(`**Total cicilan** — Outstanding: ${fmtIDRPlain(totalOutstanding)} · Cicilan/bln: ${fmtIDRPlain(totalInstalment)} · DTI (vs income ${monthLabel(month)}): ${dti !== null ? dti.toFixed(1) + "%" : NA}`);
  }
  const creditAccts = position.accounts.filter((a) => a.type === "credit");
  if (creditAccts.length > 0) {
    const creditRows = creditAccts.map((a) => {
      const used = a.balance < 0 ? -a.balance : 0;
      const limit = Number(a.creditLimit) || 0;
      return [a.name, fmtMoneyPlain(used, a.currency), limit > 0 ? fmtMoneyPlain(limit, a.currency) : "tanpa limit"];
    });
    const totalCreditUsed = creditAccts.reduce((s, a) => s + Math.max(0, -(a.balanceIDR || 0)), 0);
    lines.push("");
    lines.push(`**🪪 Kartu Kredit** (revolving, TIDAK ada di collection \`debts\` — tetap ikut Debt total):`);
    lines.push(mdTable(["Kartu", "Terpakai", "Limit"], creditRows));
    lines.push(`**Total kartu kredit terpakai:** ${fmtIDRPlain(totalCreditUsed)}`);
  }
  lines.push("");

  // ===== 8. Short Term Goals =====
  // "Terkumpul (tunai+aset)" = topup standalone (tunai) + nilai asset ter-link (`linkedValue`) —
  // progress TAMPILAN doang (TASK-2, 2026-08: header kolom dibikin eksplisit "(tunai+aset)",
  // BUKAN "Terkumpul" polos — biar ga kebaca kontradiktif sama "Goal savings" section 1 yang
  // SENGAJA cuma tunai, riwayat lengkap: DECISIONS.md). Asset ter-link TETAP kehitung normal di
  // section 6 (Investasi)/net worth, kolom Breakdown di sini CUMA informasi, JANGAN disangka
  // nambah net worth (lihat section 1/CLAUDE.md bullet `goals` — goal savings yang masuk net
  // worth cuma dari topup, bukan linkedValue).
  lines.push(`## 8. Short Term Goals (${position.label})`);
  const goalRows = position.goals.map((g) => {
    const t = g.targetAmount;
    const linkedValue = g.linkedValue || 0;
    const progress = g.saved + linkedValue;
    const p = t > 0 ? Math.max(0, Math.min(100, (progress / t) * 100)) : 0;
    const remaining = Math.max(0, t - progress);
    return [
      g.name, fmtIDRPlain(t), fmtIDRPlain(progress),
      linkedValue > 0 ? `tunai ${fmtIDRPlain(g.saved)} + aset ${fmtIDRPlain(linkedValue)}` : NA,
      `${p.toFixed(0)}%`, g.targetDate ? monthLabel(g.targetDate) : NA, fmtIDRPlain(remaining),
    ];
  });
  lines.push(mdTable(["Goal", "Target", "Terkumpul (tunai+aset)", "Breakdown", "%", "Target Date", "Sisa Perlu Ditabung"], goalRows));
  if (position.goals.some((g) => (g.linkedValue || 0) > 0)) {
    lines.push(`_⚠️ Goal dengan breakdown "+ aset" progress-nya sebagian dari nilai aset ter-link (ngikut harga pasar, naik-turun), BUKAN semuanya tunai yang bisa langsung dicairkan — tombol "Cairkan" cuma narik dari pool tunai (kolom pertama breakdown)._`);
  }
  // Tabel di atas cuma nampilin goal AKTIF (goal diarsipkan ga ditabelin, pola sama akun
  // activeAccounts() di section 5) — TAPI goalSavingsTotal (section 1, ikut netWorthIDR) TETAP
  // include saldo goal arsip (uangnya real, cuma "declutter" tampilan). Kalau ada goal diarsipkan
  // yang masih punya saldo, itu bikin sum kolom Terkumpul ga match goalSavingsTotal — dikasih
  // catatan eksplisit di sini biar AI yang baca laporan ga bingung "kok ga sum", bukan didiemin.
  const untrackedGoalSavings = position.goalSavingsTotal - position.goals.reduce((s, g) => s + (g.saved || 0), 0);
  if (Math.abs(untrackedGoalSavings) >= 1) {
    lines.push(`_Catatan: ${fmtIDRPlain(untrackedGoalSavings)} dari Goal Savings (section 1) berasal dari goal yang diarsipkan (ga ditabelin di atas, tapi tetap kehitung di Net Worth)._`);
  }
  lines.push("");

  // ===== 9. Komitmen Rutin ===== (selalu live — recurring itu komitmen SEKARANG, bukan posisi historis)
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
        return s + (acct?.currency === "USD" ? amt * liveRate : amt);
      }, 0);
    lines.push(`**Total komitmen expense rutin/bulan:** ${fmtIDRPlain(totalCommit)}`);
  }
  lines.push("");

  // ===== 10. Tren Net Worth =====
  // DUA kolom net worth (+ CAPEX / tanpa CAPEX) — bukan `s.netWorth` mentah, biar konsisten sama
  // chart Tren Net Worth (Wealth) yang juga selalu nampilin dua garis, dan biar AI yang analisis
  // laporan ini bisa bandingin trennya sendiri (lihat section 1 buat penjelasan lebih lengkap).
  lines.push("## 10. Tren Net Worth");
  const snaps = state.snapshots.slice(-12);
  const trendRows = snaps.map((s) => [
    monthLabel(s.month || s.id),
    fmtIDRPlain(snapshotNetWorth(s, true)),
    fmtIDRPlain(snapshotNetWorth(s, false)),
  ]);
  lines.push(mdTable(["Bulan", "Net Worth (+ CAPEX)", "Net Worth (tanpa CAPEX)"], trendRows));
  // "Perubahan komposisi" pakai PASANGAN BULAN YANG SAMA kayak Δ net worth section 1 (`partsNow` +
  // `prevSnap`, BUKAN dua entri terakhir tabel trend 12-bulan di atas — bisa beda pasangan bulan
  // kalau report digenerate buat bulan lampau) + `netWorthComposition()` (calc.js) buat komponennya
  // — SATU sumber angka, dijamin `comp.total` === `nwDelta` section 1 persis (bukan cuma toleransi
  // Rp1 kayak sebelumnya), DAN dijamin Σ komponen === comp.total (TASK-1, riwayat bug: DECISIONS.md).
  if (prevSnap && typeof prevSnap.totalCash === "number" && typeof prevSnap.totalAssets === "number") {
    const prevParts = { cash: prevSnap.totalCash, assets: prevSnap.totalAssets, capex: prevSnap.totalCapex, goalSavings: prevSnap.totalGoalSavings, debt: prevSnap.totalDebt };
    const comp = netWorthComposition(prevParts, partsNow, includeCapexNow);
    // Field comp.* SEMUA udah representasi kontribusi ke net worth (assets exclude CAPEX, debt
    // udah dinegasi) — tinggal ditampilin apa adanya, JANGAN sign-flip/exclude manual lagi di sini
    // (itu persis pola yang bikin bug ganda TASK-1 kejadian: Δassets RAW+ΔCAPEX ke-double-count,
    // Δdebt RAW ke-jumlah tanpa negasi).
    const parts = [];
    if (comp.cash !== 0) parts.push(`Cash ${signed(comp.cash)}`);
    if (comp.assets !== 0) parts.push(`Assets ${signed(comp.assets)}`);
    if (includeCapexNow && comp.capex !== 0) parts.push(`CAPEX ${signed(comp.capex)}`);
    if (comp.goalSavings !== 0) parts.push(`Goal Savings ${signed(comp.goalSavings)}`);
    if (comp.debt !== 0) parts.push(`Debt ${signed(comp.debt)}`);
    if (parts.length > 0) {
      lines.push(`- Perubahan komposisi (${monthLabel(prevMonthKey)} → ${monthLabel(month)}, basis ${includeCapexNow ? "+ CAPEX" : "tanpa CAPEX"}, angka = kontribusi ke Δ net worth): ${parts.join(", ")} → **Total Δ ${signed(comp.total)}** (cocok Δ net worth di section 1)`);
    }
  }
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

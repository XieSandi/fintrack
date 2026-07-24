// Smoke test buat js/calc.js — fungsi kalkulasi murni (TIDAK butuh Firebase/browser).
// Jalankan manual: node tests/calc.test.mjs
// JANGAN masuk PRECACHE sw.js — file ini bukan dipakai runtime app, cuma dev tooling.
import * as calc from "../js/calc.js";

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    failed++;
    console.error(`✗ FAIL: ${msg}\n    expected: ${expected}\n    got:      ${actual}`);
  } else {
    passed++;
  }
}

// Fixture dasar: 2 akun IDR + 1 akun USD, kurs manual 15000 biar hasil predictable
// (ga bergantung network/fallback 16000).
function makeState() {
  return {
    accounts: [
      { id: "acc_idr", currency: "IDR", initialBalance: 1_000_000, isArchived: false },
      { id: "acc_idr2", currency: "IDR", initialBalance: 500_000, isArchived: false },
      { id: "acc_usd", currency: "USD", initialBalance: 100, isArchived: false },
    ],
    categories: [],
    transactions: [],
    budgets: [],
    assets: [],
    debts: [],
    goals: [],
    recurring: [],
    snapshots: [],
    settings: { usdIdrManual: 15000 },
    usdIdr: null,
  };
}

// ================= 1. Expense/income/transfer biasa =================
{
  const s = makeState();
  s.transactions = [
    { type: "expense", amount: 50_000, accountId: "acc_idr", month: "2026-01", date: "2026-01-05" },
    { type: "income", amount: 200_000, accountId: "acc_idr", month: "2026-01", date: "2026-01-10" },
    { type: "transfer", amount: 100_000, accountId: "acc_idr", toAccountId: "acc_idr2", month: "2026-01", date: "2026-01-15" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.acc_idr, 1_000_000 - 50_000 + 200_000 - 100_000, "regular expense/income/transfer: acc_idr (sumber)");
  assertEqual(bal.acc_idr2, 500_000 + 100_000, "regular transfer: acc_idr2 (tujuan) dikredit");
}

// ================= 2. Topup goal =================
{
  const s = makeState();
  s.goals = [{ id: "g1", targetAmount: 1_000_000 }];
  s.transactions = [
    { type: "transfer", amount: 300_000, accountId: "acc_idr", toGoalId: "g1", month: "2026-01", date: "2026-01-05" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.acc_idr, 1_000_000 - 300_000, "topup goal: akun sumber didebit");
  assertEqual(bal.acc_idr2, 500_000, "topup goal: ga ada akun lain yang kekredit");
  assertEqual(calc.goalSavedIDR(s, "g1"), 300_000, "topup goal: goalSavedIDR naik");
}

// ================= 3. Pencairan (withdraw) goal =================
{
  const s = makeState();
  s.goals = [{ id: "g1", targetAmount: 1_000_000 }];
  s.transactions = [
    { type: "transfer", amount: 300_000, accountId: "acc_idr", toGoalId: "g1", month: "2026-01", date: "2026-01-05" },
    { type: "transfer", amount: 100_000, accountId: "acc_idr2", fromGoalId: "g1", month: "2026-01", date: "2026-01-10" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.acc_idr, 1_000_000 - 300_000, "pencairan goal: akun topup asli ga kesentuh pencairan");
  assertEqual(bal.acc_idr2, 500_000 + 100_000, "pencairan goal: accountId di transaksi pencairan = akun TUJUAN, dikredit");
  assertEqual(calc.goalSavedIDR(s, "g1"), 300_000 - 100_000, "pencairan goal: goalSavedIDR turun");
}

// ================= 4. Beli/jual asset =================
{
  const s = makeState();
  s.accounts.push({ id: "acc_big", currency: "IDR", initialBalance: 10_000_000, isArchived: false });
  s.assets = [{ id: "a1", type: "stock_id", quantity: 10, avgBuyPrice: 6710, manualPrice: 6710, currency: "IDR" }];
  s.transactions = [
    // Beli 5 lot @ 6.000/lembar = 5*100*6000 = 3.000.000
    { type: "transfer", amount: 5 * 100 * 6000, accountId: "acc_big", assetId: "a1", assetDir: "buy", assetQty: 5, assetPrice: 6000, month: "2026-01", date: "2026-01-05" },
    // Jual 3 lot @ 6.500/lembar = 3*100*6500 = 1.950.000
    { type: "transfer", amount: 3 * 100 * 6500, accountId: "acc_big", assetId: "a1", assetDir: "sell", assetQty: 3, assetPrice: 6500, month: "2026-01", date: "2026-01-10" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.acc_big, 10_000_000 - 5 * 100 * 6000 + 3 * 100 * 6500, "beli+jual asset: saldo akun turun pas beli, naik pas jual (qty x100 buat stock_id)");
}

// ================= 5. Net worth = cash + assets + goals - debt =================
{
  const s = makeState();
  s.assets = [{ id: "a1", type: "stock_us", quantity: 10, avgBuyPrice: 100, manualPrice: 120, currency: "USD" }];
  s.debts = [{ id: "d1", totalOutstanding: 500_000 }];
  s.goals = [{ id: "g1", targetAmount: 1_000_000 }];
  s.transactions = [
    { type: "transfer", amount: 200_000, accountId: "acc_idr", toGoalId: "g1", month: "2026-01", date: "2026-01-05" },
  ];
  const cash = calc.totalCashIDR(s);
  const assets = calc.totalAssetsIDR(s);
  const goalSavings = calc.totalGoalSavingsIDR(s);
  const debt = calc.totalDebtIDR(s);
  const nw = calc.netWorthIDR(s);

  assertEqual(cash, (1_000_000 - 200_000) + 500_000 + 100 * 15000, "net worth: totalCashIDR (akun USD dikonversi)");
  assertEqual(assets, 10 * 120 * 15000, "net worth: totalAssetsIDR (stock_us, tanpa x100)");
  assertEqual(goalSavings, 200_000, "net worth: totalGoalSavingsIDR");
  assertEqual(debt, 500_000, "net worth: totalDebtIDR");
  assertEqual(nw, cash + assets + goalSavings - debt, "net worth: formula cash+assets+goals-debt");
  // cash 2.800.000 + assets 18.000.000 + goalSavings 200.000 - debt 500.000 = 20.500.000
  assertEqual(nw, 20_500_000, "net worth: angka absolut sesuai perhitungan manual");
}

// ================= 6. monthSummary exclude transfer =================
{
  const s = makeState();
  s.goals = [{ id: "g1" }];
  s.transactions = [
    { type: "expense", amount: 10_000, accountId: "acc_idr", month: "2026-02", date: "2026-02-01" },
    { type: "income", amount: 50_000, accountId: "acc_idr", month: "2026-02", date: "2026-02-02" },
    { type: "transfer", amount: 999_999, accountId: "acc_idr", toAccountId: "acc_idr2", month: "2026-02", date: "2026-02-03" },
    { type: "transfer", amount: 888_888, accountId: "acc_idr", toGoalId: "g1", month: "2026-02", date: "2026-02-04" },
  ];
  const sum = calc.monthSummary(s, "2026-02");
  assertEqual(sum.income, 50_000, "monthSummary: income exclude transfer (biasa & goal)");
  assertEqual(sum.expense, 10_000, "monthSummary: expense exclude transfer (biasa & goal)");
  assertEqual(sum.surplus, 40_000, "monthSummary: surplus = income - expense");
}

// ================= 7. Saham IDX lot x100 =================
{
  const s = makeState();
  const asset = { type: "stock_id", quantity: 10, manualPrice: 6710, currency: "IDR" };
  assertEqual(calc.assetValueIDR(s, asset), 10 * 100 * 6710, "stock_id: value pakai qty(lot) x100 lembar");
}

// ================= 8. Konversi USD x rate =================
{
  const s = makeState();
  const asset = { type: "stock_us", quantity: 10, manualPrice: 120, currency: "USD" };
  assertEqual(calc.assetValueIDR(s, asset), 10 * 120 * 15000, "stock_us: value dikonversi kurs efektif");
}

// ================= Bonus: milestoneProgress =================
{
  const s = makeState();
  s.settings.targetNetWorth = 0;
  assertEqual(calc.milestoneProgress(s).hidden, true, "milestoneProgress: target 0 -> hidden (bukan div-by-zero)");

  const s2 = makeState();
  s2.settings.targetNetWorth = 100; // target super rendah, net worth pasti udah lewat
  const mp = calc.milestoneProgress(s2);
  assertEqual(mp.hidden, false, "milestoneProgress: target > 0 -> ga hidden");
  assertEqual(mp.achieved, true, "milestoneProgress: nw >= target -> achieved");
  assertEqual(mp.pct, 100, "milestoneProgress: pct di-cap 100 walau nw jauh lewat target");
}

// ================= Bonus: effectiveRate fallback chain =================
{
  const s = makeState();
  assertEqual(calc.effectiveRate(s), 15000, "effectiveRate: manual override dipakai duluan");

  const s2 = makeState();
  s2.settings.usdIdrManual = null;
  s2.usdIdr = { rate: 15800, date: "2026-07-01" };
  assertEqual(calc.effectiveRate(s2), 15800, "effectiveRate: auto dipakai kalau manual kosong");

  const s3 = makeState();
  s3.settings.usdIdrManual = null;
  s3.usdIdr = null;
  assertEqual(calc.effectiveRate(s3), 16000, "effectiveRate: fallback 16000 kalau manual & auto kosong");
}

// ================= Bonus: spentByCategory & budgetsOfMonth =================
{
  const s = makeState();
  s.transactions = [
    { type: "expense", amount: 5_000, categoryId: "cat_a", month: "2026-03", date: "2026-03-01" },
    { type: "expense", amount: 3_000, categoryId: "cat_a", month: "2026-03", date: "2026-03-02" },
    { type: "expense", amount: 2_000, categoryId: "cat_b", month: "2026-03", date: "2026-03-03" },
    { type: "income", amount: 1_000, categoryId: "cat_a", month: "2026-03", date: "2026-03-04" },
  ];
  const spent = calc.spentByCategory(s, "2026-03");
  assertEqual(spent.cat_a, 8_000, "spentByCategory: sum per kategori, income ga ikut kehitung");
  assertEqual(spent.cat_b, 2_000, "spentByCategory: kategori lain independen");

  s.budgets = [
    { id: "b1", month: "2026-01", categoryId: "c1", amount: 100_000 },
    { id: "b2", month: "2026-02", categoryId: "c1", amount: 200_000 },
  ];
  assertEqual(calc.budgetsOfMonth(s, "2026-01").length, 1, "budgetsOfMonth: filter per bulan");
  assertEqual(calc.budgetsOfMonth(s, "2026-01")[0].amount, 100_000, "budgetsOfMonth: ambil budget yang benar");
}

// ================= Bonus: rangeSummary =================
{
  const s = makeState();
  s.transactions = [
    { type: "income", amount: 10_000, date: "2026-04-05" },
    { type: "expense", amount: 4_000, date: "2026-04-10" },
    { type: "income", amount: 999_999, date: "2026-04-20" }, // di luar range
  ];
  const sum = calc.rangeSummary(s, "2026-04-01", "2026-04-15");
  assertEqual(sum.income, 10_000, "rangeSummary: cuma hitung transaksi dalam rentang tanggal");
  assertEqual(sum.expense, 4_000, "rangeSummary: expense dalam rentang");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

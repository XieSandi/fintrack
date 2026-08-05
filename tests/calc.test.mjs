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

// Buat kasus compound interest (projectSeries) — hasil floating point ga selalu match exact,
// beda dari assertEqual yang dipakai fungsi lain di file ini (butuh toleransi kecil, lihat
// TASK-1 di CLAUDE.md).
function assertClose(actual, expected, tolerance, msg) {
  if (Math.abs(actual - expected) > tolerance) {
    failed++;
    console.error(`✗ FAIL: ${msg}\n    expected: ~${expected}\n    got:      ${actual}`);
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

// ============ 2. Topup goal (accountId = SUMBER, ga ada akun lain naik) ============
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

// ======= 3. Pencairan (withdraw) goal (accountId = TUJUAN, naik) =======
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

// ==== 4. Beli asset (accountId = SUMBER, net worth TIDAK berubah) ====
{
  // qty asset di sini di-set manual di fixture "after" buat simulasi state SETELAH app nulis
  // quantity baru — calc.js sendiri ga tau soal "beli asset menaikkan assets.quantity", itu
  // logic terpisah di wealth.js (patch ke assets + add ke transactions, dua write beda).
  // Yang mau dibuktikan di sini murni efek transaksinya ke accountBalances()/netWorthIDR().
  const before = makeState();
  before.accounts.push({ id: "acc_big", currency: "IDR", initialBalance: 10_000_000, isArchived: false });
  before.assets = [{ id: "a1", type: "stock_id", quantity: 10, avgBuyPrice: 6000, manualPrice: 6000, currency: "IDR" }];
  const nwBefore = calc.netWorthIDR(before);

  const after = makeState();
  after.accounts.push({ id: "acc_big", currency: "IDR", initialBalance: 10_000_000, isArchived: false });
  after.assets = [{ id: "a1", type: "stock_id", quantity: 15, avgBuyPrice: 6000, manualPrice: 6000, currency: "IDR" }];
  after.transactions = [
    // Beli 5 lot @ 6.000/lembar = 5*100*6000 = 3.000.000
    { type: "transfer", amount: 5 * 100 * 6000, accountId: "acc_big", assetId: "a1", assetDir: "buy", assetQty: 5, assetPrice: 6000, month: "2026-01", date: "2026-01-05" },
  ];
  const bal = calc.accountBalances(after);
  assertEqual(bal.acc_big, 10_000_000 - 5 * 100 * 6000, "beli asset: akun sumber didebit (qty x100 buat stock_id)");
  assertEqual(bal.acc_idr, 1_000_000, "beli asset: ga ada akun lain yang kekredit");
  assertEqual(calc.netWorthIDR(after), nwBefore, "beli asset: net worth TIDAK berubah (cash turun, asset value naik senilai sama)");
}

// ============ 5. Jual asset (accountId = TUJUAN, naik) ============
{
  const s = makeState();
  s.accounts.push({ id: "acc_big", currency: "IDR", initialBalance: 10_000_000, isArchived: false });
  s.assets = [{ id: "a1", type: "stock_id", quantity: 5, avgBuyPrice: 6710, manualPrice: 6500, currency: "IDR" }];
  s.transactions = [
    // Jual 3 lot @ 6.500/lembar = 3*100*6500 = 1.950.000
    { type: "transfer", amount: 3 * 100 * 6500, accountId: "acc_big", assetId: "a1", assetDir: "sell", assetQty: 3, assetPrice: 6500, month: "2026-01", date: "2026-01-10" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.acc_big, 10_000_000 + 3 * 100 * 6500, "jual asset: accountId = akun TUJUAN, dikredit");
  assertEqual(bal.acc_idr, 1_000_000, "jual asset: ga ada akun lain yang ke-debit");
}

// ================= 6. Net worth = cash + assets + goals - debt =================
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

// === 7. monthSummary exclude SEMUA jenis transfer (biasa, goal topup/pencairan, asset beli/jual) ===
{
  const s = makeState();
  s.goals = [{ id: "g1" }];
  s.assets = [{ id: "a1", type: "stock_id", quantity: 10, avgBuyPrice: 6000, manualPrice: 6000, currency: "IDR" }];
  s.transactions = [
    { type: "expense", amount: 10_000, accountId: "acc_idr", month: "2026-02", date: "2026-02-01" },
    { type: "income", amount: 50_000, accountId: "acc_idr", month: "2026-02", date: "2026-02-02" },
    { type: "transfer", amount: 999_999, accountId: "acc_idr", toAccountId: "acc_idr2", month: "2026-02", date: "2026-02-03" },
    { type: "transfer", amount: 888_888, accountId: "acc_idr", toGoalId: "g1", month: "2026-02", date: "2026-02-04" },
    { type: "transfer", amount: 777_777, accountId: "acc_idr2", fromGoalId: "g1", month: "2026-02", date: "2026-02-05" },
    { type: "transfer", amount: 5 * 100 * 6000, accountId: "acc_idr", assetId: "a1", assetDir: "buy", assetQty: 5, assetPrice: 6000, month: "2026-02", date: "2026-02-06" },
    { type: "transfer", amount: 2 * 100 * 6500, accountId: "acc_idr", assetId: "a1", assetDir: "sell", assetQty: 2, assetPrice: 6500, month: "2026-02", date: "2026-02-07" },
  ];
  const sum = calc.monthSummary(s, "2026-02");
  assertEqual(sum.income, 50_000, "monthSummary: income exclude SEMUA jenis transfer");
  assertEqual(sum.expense, 10_000, "monthSummary: expense exclude SEMUA jenis transfer");
  assertEqual(sum.surplus, 40_000, "monthSummary: surplus = income - expense");
}

// ================= 8. Saham IDX lot x100 =================
{
  const s = makeState();
  const asset = { type: "stock_id", quantity: 10, manualPrice: 6710, currency: "IDR" };
  assertEqual(calc.assetValueIDR(s, asset), 10 * 100 * 6710, "stock_id: value pakai qty(lot) x100 lembar");
}

// ================= 9. Konversi USD x rate =================
{
  const s = makeState();
  const asset = { type: "stock_us", quantity: 10, manualPrice: 120, currency: "USD" };
  assertEqual(calc.assetValueIDR(s, asset), 10 * 120 * 15000, "stock_us: value dikonversi kurs efektif");
}

// ================= Bonus: milestoneProgress (dasar) =================
{
  const s = makeState();
  s.settings.targetNetWorth = 0;
  assertEqual(calc.milestoneProgress(s, "2026-07").hidden, true, "milestoneProgress: target 0 -> hidden (bukan div-by-zero)");

  const s2 = makeState();
  s2.settings.targetNetWorth = 100; // target super rendah, net worth pasti udah lewat
  const mp = calc.milestoneProgress(s2, "2026-07");
  assertEqual(mp.hidden, false, "milestoneProgress: target > 0 -> ga hidden");
  assertEqual(mp.achieved, true, "milestoneProgress: nw >= target -> achieved");
  assertEqual(mp.pct, 100, "milestoneProgress: pct di-cap 100 walau nw jauh lewat target");
}

// ========= Bonus: milestoneProgress pace (targetDate, TASK-F) =========
// Base fixture (makeState, tanpa transaksi): totalCashIDR = 1.000.000 + 500.000 + 100*15000
// = 3.000.000, jadi nw = 3.000.000 (ga ada asset/goal/debt).
{
  // targetDate kosong -> field pace sama sekali ga ada, walau belum achieved
  const s = makeState();
  s.settings.targetNetWorth = 10_000_000;
  s.settings.targetDate = null;
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.monthsLeft, undefined, "milestoneProgress pace: targetDate kosong -> ga ada monthsLeft");
  assertEqual(mp.neededPerMonth, undefined, "milestoneProgress pace: targetDate kosong -> ga ada neededPerMonth");
}
{
  // targetDate valid, BELUM ada data surplus -> neededPerMonth ada, avgSurplus3m/onTrack ga ada
  const s = makeState();
  s.settings.targetNetWorth = 9_000_000; // nw 3.000.000, needed = (9jt-3jt)/6 = 1.000.000
  s.settings.targetDate = "2027-01"; // 6 bulan dari 2026-07
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.monthsLeft, 6, "milestoneProgress pace: monthsLeft dihitung bener dari nowMonth ke targetDate");
  assertEqual(mp.neededPerMonth, 1_000_000, "milestoneProgress pace: neededPerMonth = (target-nw)/monthsLeft");
  assertEqual(mp.avgSurplus3m, undefined, "milestoneProgress pace: belum ada data surplus -> avgSurplus3m ga ada");
  assertEqual(mp.onTrack, undefined, "milestoneProgress pace: belum ada data surplus -> onTrack ga ada (ga boleh ngarang klaim)");
}
{
  // targetDate valid, ADA data surplus 3 bulan, surplus rata2 (1.200.000) >= needed -> onTrack
  const s = makeState();
  s.settings.targetNetWorth = 9_000_000;
  s.settings.targetDate = "2027-01";
  s.transactions = [
    { type: "income", amount: 2_200_000, accountId: "acc_idr", month: "2026-04", date: "2026-04-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-04", date: "2026-04-10" }, // surplus 1.200.000
    { type: "income", amount: 2_300_000, accountId: "acc_idr", month: "2026-05", date: "2026-05-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-05", date: "2026-05-10" }, // surplus 1.300.000
    { type: "income", amount: 2_100_000, accountId: "acc_idr", month: "2026-06", date: "2026-06-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-06", date: "2026-06-10" }, // surplus 1.100.000
  ];
  // transaksi di atas juga nambah cash 3.600.000 -> nw jadi 3.000.000+3.600.000=6.600.000
  // needed = (9.000.000-6.600.000)/6 = 400.000
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.neededPerMonth, 400_000, "milestoneProgress pace: neededPerMonth ikut nw yang udah naik dari transaksi");
  assertEqual(mp.avgSurplus3m, 1_200_000, "milestoneProgress pace: avgSurplus3m rata-rata 3 bulan TERAKHIR YANG ADA DATA (exclude bulan berjalan)");
  assertEqual(mp.onTrack, true, "milestoneProgress pace: avgSurplus3m >= neededPerMonth -> onTrack");
}
{
  // Sama kayak di atas tapi target JAUH lebih tinggi -> neededPerMonth > avgSurplus3m -> NOT on track
  const s = makeState();
  s.settings.targetNetWorth = 50_000_000;
  s.settings.targetDate = "2027-01";
  s.transactions = [
    { type: "income", amount: 2_200_000, accountId: "acc_idr", month: "2026-04", date: "2026-04-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-04", date: "2026-04-10" },
    { type: "income", amount: 2_300_000, accountId: "acc_idr", month: "2026-05", date: "2026-05-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-05", date: "2026-05-10" },
    { type: "income", amount: 2_100_000, accountId: "acc_idr", month: "2026-06", date: "2026-06-05" },
    { type: "expense", amount: 1_000_000, accountId: "acc_idr", month: "2026-06", date: "2026-06-10" },
  ];
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.avgSurplus3m, 1_200_000, "milestoneProgress pace: avgSurplus3m sama, target beda");
  assertEqual(mp.onTrack, false, "milestoneProgress pace: neededPerMonth > avgSurplus3m -> NOT on track");
}
{
  // targetDate udah lewat, belum achieved -> targetDatePassed, TANPA neededPerMonth (hindari bagi 0/negatif)
  const s = makeState();
  s.settings.targetNetWorth = 9_000_000;
  s.settings.targetDate = "2026-01"; // sebelum nowMonth 2026-07
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.targetDatePassed, true, "milestoneProgress pace: targetDate di masa lalu -> targetDatePassed");
  assertEqual(mp.monthsLeft, 0, "milestoneProgress pace: monthsLeft di-floor 0 kalau targetDate lewat");
  assertEqual(mp.neededPerMonth, undefined, "milestoneProgress pace: targetDate lewat -> neededPerMonth GA dihitung");
}
{
  // Udah achieved (walau targetDate keisi) -> SEMUA field pace disembunyikan
  const s = makeState();
  s.settings.targetNetWorth = 100; // nw 3.000.000 >> target -> achieved
  s.settings.targetDate = "2027-01";
  const mp = calc.milestoneProgress(s, "2026-07");
  assertEqual(mp.achieved, true, "milestoneProgress pace: sanity check achieved");
  assertEqual(mp.monthsLeft, undefined, "milestoneProgress pace: udah tercapai -> pace disembunyikan walau targetDate keisi");
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

// ================= snapshotNetWorth =================
{
  // Snapshot lengkap (punya totalCash/totalAssets) -> recompute lewat netWorthFromParts, dua
  // variant BISA beda dari `netWorth` mentah yang tersimpan (angka itu cuma "sudah jadi" ngikut
  // toggle SAAT snapshot itu dibuat, bukan sumber kebenaran buat kedua variant).
  const s = { totalCash: 1_000_000, totalAssets: 5_000_000, totalCapex: 1_500_000, totalGoalSavings: 200_000, totalDebt: 100_000, netWorth: 999_999 };
  assertEqual(calc.snapshotNetWorth(s, true), 1_000_000 + 5_000_000 + 200_000 - 100_000, "snapshotNetWorth: includeCapex true -> assets penuh");
  assertEqual(calc.snapshotNetWorth(s, false), 1_000_000 + (5_000_000 - 1_500_000) + 200_000 - 100_000, "snapshotNetWorth: includeCapex false -> assets exclude capex");
}
{
  // Snapshot lama/manual backfill TANPA totalCash/totalAssets -> fallback ke netWorth mentah,
  // buat KEDUA variant (ga ada breakdown buat direkonstruksi, jangan ngarang).
  const s = { netWorth: 3_000_000, manual: true };
  assertEqual(calc.snapshotNetWorth(s, true), 3_000_000, "snapshotNetWorth: snapshot tanpa breakdown -> fallback netWorth mentah (includeCapex true)");
  assertEqual(calc.snapshotNetWorth(s, false), 3_000_000, "snapshotNetWorth: snapshot tanpa breakdown -> fallback netWorth mentah (includeCapex false)");
}

// ================= TASK-1: projectSeries =================
{
  // rate 0 -> linear, hasil = startValue + months x contribution (exact, ga ada floating drift)
  const series = calc.projectSeries({ startValue: 1_000_000, startMonth: "2026-01", months: 6, monthlyContribution: 100_000, annualRate: 0 });
  assertEqual(series.length, 7, "projectSeries: length = months+1 (titik awal + tiap bulan)");
  assertEqual(series[0].month, "2026-01", "projectSeries: titik pertama = startMonth");
  assertEqual(series[0].value, 1_000_000, "projectSeries: titik pertama = startValue");
  assertEqual(series[6].month, "2026-07", "projectSeries: titik terakhir = startMonth + months");
  assertEqual(series[6].value, 1_000_000 + 6 * 100_000, "projectSeries: rate 0 -> linear (garis nabung doang proyeksi, TANPA fungsi terpisah)");
}
{
  // rate 12%/tahun TANPA kontribusi, 12 bulan -> compound bulanan balik PERSIS ke rate tahunan
  const series = calc.projectSeries({ startValue: 1_000_000, startMonth: "2026-01", months: 12, monthlyContribution: 0, annualRate: 0.12 });
  assertClose(series[12].value, 1_000_000 * 1.12, 0.01, "projectSeries: rate 12% 1 tahun tanpa kontribusi -> value bulan ke-12 ~= startValue*1.12");
}
{
  // kontribusi + rate -> cocokkan hitung manual satu titik (bulan ke-2)
  const annualRate = 0.06;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  const v1 = 1_000_000 * (1 + monthlyRate) + 50_000;
  const v2 = v1 * (1 + monthlyRate) + 50_000;
  const series = calc.projectSeries({ startValue: 1_000_000, startMonth: "2026-01", months: 2, monthlyContribution: 50_000, annualRate });
  assertClose(series[2].value, v2, 0.0001, "projectSeries: kontribusi + rate -> nilai bulan ke-2 cocok hitung manual titik itu");
}

// ================= CAPEX: auto-depresiasi + toggle net worth =================
{
  // Declining balance 10%/bulan x 3 bulan sejak tanggal beli
  const s = makeState();
  s.assets = [{ id: "cx1", type: "capex", quantity: 1, avgBuyPrice: 10_000_000, currency: "IDR", purchaseDate: "2026-01-15", depreciationPctMonth: 0.1 }];
  const val = calc.assetValueIDR(s, s.assets[0], "2026-04");
  assertClose(val, 10_000_000 * Math.pow(0.9, 3), 1, "capex: value auto-susut declining balance 10%/bulan x 3 bulan");
}
{
  // Bulan yang sama dengan purchaseMonth -> elapsed 0 -> value = harga beli persis, belum susut
  const s = makeState();
  s.assets = [{ id: "cx1", type: "capex", quantity: 1, avgBuyPrice: 5_000_000, currency: "IDR", purchaseDate: "2026-03-01", depreciationPctMonth: 0.05 }];
  assertEqual(calc.assetValueIDR(s, s.assets[0], "2026-03"), 5_000_000, "capex: bulan beli sendiri -> belum susut sama sekali");
}
{
  // Default toggle (includeCapexInNetWorth ga di-set) -> CAPEX EXCLUDE dari net worth, TAPI
  // TETAP masuk totalAssetsIDR (tab Assets = semua yang dipunya, bukan cuma yang dihitung NW).
  const s = makeState();
  s.assets = [{ id: "cx1", type: "capex", quantity: 1, avgBuyPrice: 10_000_000, currency: "IDR", purchaseDate: "2026-01-01", depreciationPctMonth: 0 }];
  const assetsTotal = calc.totalAssetsIDR(s, "2026-01");
  const nwExcluded = calc.netWorthIDR(s, "2026-01");
  assertEqual(assetsTotal, 10_000_000, "capex: totalAssetsIDR SELALU termasuk CAPEX (tab Assets = semua yang dipunya)");
  assertEqual(nwExcluded, calc.totalCashIDR(s), "capex: default toggle OFF -> netWorthIDR EXCLUDE nilai CAPEX");

  s.settings.includeCapexInNetWorth = true;
  const nwIncluded = calc.netWorthIDR(s, "2026-01");
  assertEqual(nwIncluded, calc.totalCashIDR(s) + 10_000_000, "capex: toggle ON -> netWorthIDR INCLUDE nilai CAPEX");
}
{
  // netWorthFromParts: formula generik dari breakdown mentah, dipakai ulang buat recompute
  // net worth historis (chart Tren Net Worth/Proyeksi, report-md.js) — TIDAK butuh `state`.
  const parts = { cash: 1_000_000, assets: 5_000_000, capex: 2_000_000, goalSavings: 300_000, debt: 200_000 };
  assertEqual(calc.netWorthFromParts(parts, true), 1_000_000 + 5_000_000 + 300_000 - 200_000, "netWorthFromParts: includeCapex true -> assets apa adanya (udah termasuk capex)");
  assertEqual(calc.netWorthFromParts(parts, false), 1_000_000 + (5_000_000 - 2_000_000) + 300_000 - 200_000, "netWorthFromParts: includeCapex false -> assets dikurangi capex");
}

// ================= TASK-1: Akun tipe credit (kartu kredit) =================
{
  // Spec acceptance: net worth dengan 1 akun BCA +2jt dan 1 CC -500rb = +1,5jt (fixture terisolasi)
  const s = {
    accounts: [
      { id: "bca", currency: "IDR", initialBalance: 2_000_000, isArchived: false, type: "bank" },
      { id: "cc", currency: "IDR", initialBalance: -500_000, isArchived: false, type: "credit", creditLimit: 3_000_000 },
    ],
    categories: [], transactions: [], budgets: [], assets: [], debts: [], goals: [], recurring: [], snapshots: [],
    settings: {}, usdIdr: null,
  };
  assertEqual(calc.netWorthIDR(s), 1_500_000, "credit: net worth BCA+2jt & CC-500rb = +1,5jt (CC lewat cash path)");
  assertEqual(calc.totalDebtIDR(s), 0, "credit: totalDebtIDR() TETAP 0 -- CC BUKAN debt entity, ga di-double-count");
}
{
  // Belanja CC 50rb: balance CC -50rb, creditUsed=50rb, creditRemaining=limit-used, net worth turun 50rb
  const before = makeState();
  before.accounts.push({ id: "cc", currency: "IDR", initialBalance: 0, isArchived: false, type: "credit", creditLimit: 200_000 });
  const nwBefore = calc.netWorthIDR(before);

  const after = makeState();
  after.accounts.push({ id: "cc", currency: "IDR", initialBalance: 0, isArchived: false, type: "credit", creditLimit: 200_000 });
  after.transactions = [
    { type: "expense", amount: 50_000, accountId: "cc", month: "2026-01", date: "2026-01-05" },
  ];
  const bal = calc.accountBalances(after);
  const ccAcct = after.accounts.find((a) => a.id === "cc");
  assertEqual(bal.cc, -50_000, "credit: belanja 50rb pakai CC -> balance -50rb");
  assertEqual(calc.isCreditAccount(ccAcct), true, "credit: isCreditAccount true buat type credit");
  assertEqual(calc.creditUsed(ccAcct, bal), 50_000, "credit: creditUsed = -balance kalau negatif");
  assertEqual(calc.creditRemaining(ccAcct, bal), 200_000 - 50_000, "credit: creditRemaining = limit - used");
  assertEqual(calc.netWorthIDR(after), nwBefore - 50_000, "credit: net worth turun 50rb lewat cash path (bukan debt path)");
}
{
  // Bayar tagihan (transfer BCA->CC 50rb): balance CC balik 0, akun sumber turun 50rb, net worth TIDAK berubah
  const s = makeState();
  s.accounts.push({ id: "cc", currency: "IDR", initialBalance: -50_000, isArchived: false, type: "credit", creditLimit: 200_000 });
  const nwBefore = calc.netWorthIDR(s);
  s.transactions = [
    { type: "transfer", amount: 50_000, accountId: "acc_idr", toAccountId: "cc", month: "2026-01", date: "2026-01-10" },
  ];
  const bal = calc.accountBalances(s);
  assertEqual(bal.cc, 0, "credit: bayar tagihan penuh -> balance CC balik 0");
  assertEqual(bal.acc_idr, 1_000_000 - 50_000, "credit: bayar tagihan -> akun sumber turun 50rb");
  assertEqual(calc.netWorthIDR(s), nwBefore, "credit: bayar tagihan CC = transfer biasa, net worth TIDAK berubah (bukan expense)");
}
{
  // totalCreditDebtIDR: agregat SEMUA akun credit (USD dikonversi kurs) — buat tampilan breakdown doang
  const s = makeState();
  s.accounts.push({ id: "cc1", currency: "IDR", initialBalance: -300_000, isArchived: false, type: "credit", creditLimit: 1_000_000 });
  s.accounts.push({ id: "cc2", currency: "USD", initialBalance: -20, isArchived: false, type: "credit", creditLimit: 500 });
  assertEqual(calc.totalCreditDebtIDR(s), 300_000 + 20 * 15000, "totalCreditDebtIDR: sum creditUsed semua akun credit, USD dikonversi kurs");
}
{
  // creditRemaining null kalau limit 0/kosong (unlimited) -- BUKAN 0, biar UI bisa bedain dari over-limit
  const cc = { id: "cc", currency: "IDR", type: "credit", creditLimit: 0 };
  assertEqual(calc.creditRemaining(cc, { cc: -100_000 }), null, "creditRemaining: limit 0 -> null (unlimited), bukan 0");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

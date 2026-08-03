// Kalkulasi murni — SEMUA fungsi di sini cuma butuh `state` (+ parameter lain kayak `month`)
// sebagai input eksplisit, TIDAK ada import Firebase/DOM, TIDAK baca Date.now()/wall-clock
// langsung (bulan "sekarang" selalu masuk sebagai parameter dari caller) — ini jantung app
// (saldo akun, net worth, dll), diekstrak dari store.js biar bisa di-test lewat
// `node tests/calc.test.mjs` tanpa perlu Firebase SDK & tetap deterministik. store.js adalah
// wrapper tipis di atas modul ini yang manggil tiap fungsi dengan `state` global — perilaku
// runtime app TIDAK berubah, cuma lokasi kodenya yang pindah.
//
// Kalau nyentuh file ini, jalankan `node tests/calc.test.mjs` sebelum selesai (lihat CLAUDE.md
// ATURAN WAJIB). Boleh import dari `./utils.js` (murni, TIDAK ada Firebase juga) kalau butuh
// helper tanggal — JANGAN duplikasi ulang logic yang udah ada di sana.
import { addMonths } from "./utils.js";

export const activeAccounts = (state) => state.accounts.filter((a) => !a.isArchived);
export const catById = (state, id) => state.categories.find((c) => c.id === id);
export const acctById = (state, id) => state.accounts.find((a) => a.id === id);

// Kurs efektif: manual override di settings > auto > fallback
export const effectiveRate = (state) =>
  Number(state.settings.usdIdrManual) || state.usdIdr?.rate || 16000;

// Saldo per akun dihitung dari jurnal (auditable). accountId perannya kondisional buat
// TIGA jenis transaksi transfer (lihat CLAUDE.md Data Model): topup goal / beli asset →
// accountId = SUMBER (didebit); pencairan goal / jual asset → accountId = TUJUAN (dikredit);
// transfer akun-ke-akun biasa → accountId = sumber DAN toAccountId (kalau ada) = tujuan.
export function accountBalances(state) {
  const bal = {};
  state.accounts.forEach((a) => (bal[a.id] = Number(a.initialBalance) || 0));
  for (const t of state.transactions) {
    const amt = Number(t.amount) || 0;
    if (t.type === "expense") bal[t.accountId] = (bal[t.accountId] || 0) - amt;
    else if (t.type === "income") bal[t.accountId] = (bal[t.accountId] || 0) + amt;
    else if (t.type === "transfer") {
      if (t.fromGoalId || (t.assetId && t.assetDir === "sell")) {
        bal[t.accountId] = (bal[t.accountId] || 0) + amt;
      } else if (t.toGoalId || (t.assetId && t.assetDir === "buy")) {
        bal[t.accountId] = (bal[t.accountId] || 0) - amt;
      } else {
        bal[t.accountId] = (bal[t.accountId] || 0) - amt;
        if (t.toAccountId) bal[t.toAccountId] = (bal[t.toAccountId] || 0) + amt;
      }
    }
  }
  return bal;
}

// Total cash dalam IDR (akun USD dikonversi)
export function totalCashIDR(state) {
  const bal = accountBalances(state);
  const rate = effectiveRate(state);
  return activeAccounts(state).reduce((sum, a) => {
    const b = bal[a.id] || 0;
    return sum + (a.currency === "USD" ? b * rate : b);
  }, 0);
}

// Nilai asset (harga manual). Saham IDX: qty dalam LOT → ×100 lembar. CAPEX (lihat blok di
// bawah) dispatch ke capexValueIDR — nilainya auto-dihitung dari penyusutan, bukan harga manual.
// `nowMonth` cuma dipakai buat CAPEX (tipe lain abaikan parameter ini) — WAJIB dikirim eksplisit
// oleh caller (store.js → currentMonth()), calc.js ga boleh baca wall-clock sendiri.
export function assetValueIDR(state, a, nowMonth) {
  if (a.type === "capex") return capexValueIDR(state, a, nowMonth);
  const rate = effectiveRate(state);
  const qty = Number(a.quantity) || 0;
  const price = Number(a.manualPrice) || 0;
  const shares = a.type === "stock_id" ? qty * 100 : qty;
  const val = shares * price;
  return a.currency === "USD" ? val * rate : val;
}

export function assetCostIDR(state, a) {
  const rate = effectiveRate(state);
  const qty = Number(a.quantity) || 0;
  const avg = Number(a.avgBuyPrice) || 0;
  const shares = a.type === "stock_id" ? qty * 100 : qty;
  const val = shares * avg;
  return a.currency === "USD" ? val * rate : val;
}

// ============== CAPEX: asset fisik yang auto-susut nilainya tiap bulan ==============
// Barang habis pakai/susut (laptop, kendaraan, elektronik, dll) — beda dari investasi (saham/
// reksadana/dll) yang nilainya naik-turun ngikutin harga pasar, CAPEX SELALU turun predictable
// tiap bulan pakai reducing-balance (declining balance, kayak metode akuntansi): value = harga
// beli × (1 − pct)^bulan-berjalan-sejak-tanggal-beli. `quantity` SELALU 1 (dipaksa di form asset,
// ga ada konsep qty buat barang fisik satuan). `avgBuyPrice` DIREUSE sebagai harga beli awal
// (bukan field baru) — biar assetCostIDR() otomatis jalan tanpa perubahan, jadi P&L existing di
// assetRow()/report-md.js otomatis kebaca sebagai "kerugian" dari penyusutan tanpa kode baru.
export function capexLocalValue(state, a, nowMonth) {
  const price = Number(a.avgBuyPrice) || 0;
  const pct = Number(a.depreciationPctMonth) || 0;
  const purchaseMonth = (a.purchaseDate || "").slice(0, 7);
  if (!purchaseMonth || !nowMonth) return price;
  const elapsed = Math.max(0, monthsBetween(purchaseMonth, nowMonth));
  return price * Math.pow(1 - pct, elapsed);
}

export function capexValueIDR(state, a, nowMonth) {
  const rate = effectiveRate(state);
  const val = capexLocalValue(state, a, nowMonth);
  return a.currency === "USD" ? val * rate : val;
}

export const totalAssetsIDR = (state, nowMonth) =>
  state.assets.reduce((s, a) => s + assetValueIDR(state, a, nowMonth), 0);

// Total nilai CAPEX doang — dipakai netWorthIDR buat conditional include/exclude (toggle
// settings.includeCapexInNetWorth) TANPA filter ulang assetValueIDR di dua tempat beda.
export const totalCapexIDR = (state, nowMonth) =>
  state.assets.filter((a) => a.type === "capex").reduce((s, a) => s + assetValueIDR(state, a, nowMonth), 0);
export const totalDebtIDR = (state) => state.debts.reduce((s, d) => s + (Number(d.totalOutstanding) || 0), 0);

// Saldo goal = total topup (toGoalId) − total pencairan (fromGoalId).
// Dihitung IDR pakai currency akun lawan-nya, biar konsisten sama totalCashIDR().
export function goalSavedIDR(state, goalId) {
  const rate = effectiveRate(state);
  let sum = 0;
  for (const t of state.transactions) {
    if (t.type !== "transfer") continue;
    if (t.toGoalId !== goalId && t.fromGoalId !== goalId) continue;
    const acct = acctById(state, t.accountId);
    const amt = Number(t.amount) || 0;
    const amtIDR = acct?.currency === "USD" ? amt * rate : amt;
    sum += t.toGoalId === goalId ? amtIDR : -amtIDR;
  }
  return sum;
}
export const totalGoalSavingsIDR = (state) => state.goals.reduce((s, g) => s + goalSavedIDR(state, g.id), 0);

// Formula net worth dari breakdown MENTAH ({cash, assets, capex, goalSavings, debt}) + flag
// includeCapex — TIDAK butuh `state` (murni angka yang udah di-breakdown, bukan live state) biar
// bisa dipakai ulang buat recompute net worth HISTORIS (per snapshot lama, wealth.js chart Tren
// Net Worth & Proyeksi) dan buat report-md.js (section 1, breakdown `position`) — SATU formula,
// jangan diduplikasi manual di tempat-tempat itu (drift formula = angka with/without CAPEX ga
// konsisten antar fitur). `assets` di sini SELALU raw (termasuk CAPEX apa adanya).
export function netWorthFromParts({ cash, assets, capex, goalSavings, debt }, includeCapex) {
  const base = (cash || 0) + (assets || 0) + (goalSavings || 0) - (debt || 0);
  return includeCapex ? base : base - (capex || 0);
}

// Net worth SATU dokumen snapshot, toggle-aware — SATU tempat dipakai ulang di mana pun perlu
// "net worth bulan X ini, ngikut definisi toggle YANG BERLAKU SEKARANG" (chart Tren Net Worth,
// garis Aktual & Nabung doang di Proyeksi (wealth.js), section 1 & 10 report-md.js) — jangan
// diduplikasi manual, drift antar tempat itu justru masalah yang lagi dibenerin di sini.
// Snapshot lama yang cuma punya `netWorth` (manual backfill / sebelum fitur CAPEX ada, ga punya
// `totalCash`/`totalAssets` top-level) fallback ke `netWorth` apa adanya buat includeCapex
// manapun — ga ada breakdown buat direkonstruksi, jangan ngarang.
export function snapshotNetWorth(s, includeCapex) {
  const hasTotals = typeof s.totalCash === "number" && typeof s.totalAssets === "number";
  if (!hasTotals) return Number(s.netWorth) || 0;
  return netWorthFromParts(
    { cash: s.totalCash, assets: s.totalAssets, capex: s.totalCapex, goalSavings: s.totalGoalSavings, debt: s.totalDebt },
    includeCapex
  );
}

// Goal savings dihitung sebagai bagian net worth (uangnya ga hilang, cuma pindah "kantong").
// CAPEX (barang fisik susut, lihat blok di atas) di-exclude/include tergantung toggle
// `settings.includeCapexInNetWorth` — default FALSE (exclude) biar net worth existing user ga
// tiba-tiba berubah pas fitur ini nongol pertama kali; barang kayak laptop/kendaraan pribadi
// juga umumnya ga dianggap "investable net worth" di banyak filosofi personal finance.
// totalAssetsIDR() SENDIRI TETAP selalu termasuk CAPEX (dipakai tab Assets Wealth — itu emang
// "semua yang lo punya", bukan konsep net worth) — exclude-nya cuma di sini lewat SUBTRACT
// (bukan filter ulang assetValueIDR di tempat lain), `nowMonth` diteruskan biar CAPEX ke-hitung
// pakai bulan yang bener (lihat capexValueIDR).
export function netWorthIDR(state, nowMonth) {
  const includeCapex = state.settings.includeCapexInNetWorth === true;
  return netWorthFromParts({
    cash: totalCashIDR(state),
    assets: totalAssetsIDR(state, nowMonth),
    capex: totalCapexIDR(state, nowMonth),
    goalSavings: totalGoalSavingsIDR(state),
    debt: totalDebtIDR(state),
  }, includeCapex);
}

// ============== Dashboard Proyeksi (TASK-1): Nabung vs Aktual vs Return ==============
// Primitif murni di bawah ini dipakai js/views/wealth.js buat nyusun chart proyeksi — orkestrasi
// (nentuin startValue/horizon/dari snapshot mana) sengaja TETAP di view layer (bukan di sini),
// karena itu soal "gimana nampilinnya", bukan kalkulasi finansial murni; pola yang sama kayak
// chart cashflow existing yang juga assemble data-nya di wealth.js.
// (Sempat ada `savingsOnlySeries()` di sini buat garis "Nabung doang" HISTORIS terpisah dari
// "Proyeksi (nabung)" forward-looking — dihapus lagi karena dua garis itu kelihatan
// kontradiktif/ganjil berdampingan di chart yang sama, cuma satu konsep "nabung doang" yang
// dipertahankan sekarang: forward projection dari `projectSeries` di bawah.)

// Proyeksi maju generik: compound bulanan (`annualRate` dikonversi ke rate bulanan biar compound
// 12x balik persis ke `annualRate` per tahun) + kontribusi tetap tiap bulan. `annualRate: 0` →
// otomatis linear (dipakai buat skenario "nabung doang" proyeksi ke depan, TANPA fungsi terpisah).
// TIDAK butuh `state` — murni matematika dari input eksplisit — tapi tetap di-wrap tipis di
// store.js (lihat di sana) biar view tetap satu sumber import buat semua derived data.
export function projectSeries({ startValue, startMonth, months, monthlyContribution, annualRate }) {
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  let month = startMonth;
  let value = startValue;
  const out = [{ month, value }];
  for (let i = 0; i < months; i++) {
    month = addMonths(month, 1);
    value = value * (1 + monthlyRate) + monthlyContribution;
    out.push({ month, value });
  }
  return out;
}

// Selisih bulan dari fromYM ke toYM ("YYYY-MM"), bisa negatif kalau toYM di masa lalu.
// Exported (TASK-1) — dipakai juga di luar milestoneProgress buat nentuin horizon proyeksi.
export function monthsBetween(fromYM, toYM) {
  const [fy, fm] = fromYM.split("-").map(Number);
  const [ty, tm] = toYM.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

// Rata-rata surplus N bulan TERAKHIR YANG ADA DATANYA (bukan N bulan kalender terakhir mentah)
// — bulan kosong (belum pakai app / belum ada transaksi) di-skip, ga ikut narik rata-rata ke 0.
// Mundur dari nowMonth (EXCLUSIVE — bulan berjalan masih parsial, ga representatif buat pace).
// Exported (TASK-1) — dipakai juga sebagai `monthlyContribution` default di dashboard proyeksi
// (js/views/wealth.js), bukan cuma internal milestoneProgress.
export function recentAvgSurplus(state, nowMonth, count = 3, lookback = 24) {
  const surpluses = [];
  let m = nowMonth;
  for (let i = 0; i < lookback && surpluses.length < count; i++) {
    m = addMonths(m, -1);
    const s = monthSummary(state, m);
    if (s.income > 0 || s.expense > 0) surpluses.push(s.surplus);
  }
  if (surpluses.length === 0) return null;
  return surpluses.reduce((a, b) => a + b, 0) / surpluses.length;
}

// Progress 🏆 Main Milestone — target 0/kosong → hidden:true (bukan div-by-zero). `nowMonth`
// ("YYYY-MM") WAJIB dikirim eksplisit oleh caller (store.js → currentMonth() dari utils.js) —
// calc.js sendiri ga boleh baca wall-clock langsung, biar tetap deterministik buat di-test.
//
// Field pace (monthsLeft/neededPerMonth/avgSurplus3m/onTrack) CUMA muncul kalau
// settings.targetDate keisi DAN belum achieved — kalau kosong atau udah tercapai, field-field
// itu sengaja ga ada sama sekali (bukan null/0) biar UI gampang cek `"neededPerMonth" in mp`
// buat mutusin nampilin baris pace atau ngga. target date yang udah lewat (monthsBetween <= 0)
// dapet flag `targetDatePassed` doang, TANPA neededPerMonth — hindari bagi 0/negatif.
export function milestoneProgress(state, nowMonth) {
  const target = Number(state.settings.targetNetWorth) || 0;
  if (target <= 0) return { target: 0, nw: 0, pct: 0, achieved: false, hidden: true };
  const nw = netWorthIDR(state, nowMonth);
  const pct = Math.max(0, Math.min(100, (nw / target) * 100));
  const achieved = nw >= target;
  const result = { target, nw, pct, achieved, hidden: false };

  const targetDate = state.settings.targetDate;
  if (targetDate && !achieved) {
    const diff = monthsBetween(nowMonth, targetDate);
    if (diff <= 0) {
      result.targetDatePassed = true;
      result.monthsLeft = 0;
    } else {
      result.monthsLeft = diff;
      result.neededPerMonth = (target - nw) / diff;
      const avgSurplus3m = recentAvgSurplus(state, nowMonth, 3);
      if (avgSurplus3m !== null) {
        result.avgSurplus3m = avgSurplus3m;
        result.onTrack = avgSurplus3m >= result.neededPerMonth;
      }
    }
  }

  return result;
}

// Ringkasan cashflow satu bulan (transfer tidak dihitung)
export function monthSummary(state, month) {
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (t.month !== month) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === "income") income += amt;
    else if (t.type === "expense") expense += amt;
  }
  return { income, expense, surplus: income - expense };
}

// Actual expense per kategori pada satu bulan
export function spentByCategory(state, month) {
  const map = {};
  for (const t of state.transactions) {
    if (t.month !== month || t.type !== "expense") continue;
    map[t.categoryId] = (map[t.categoryId] || 0) + (Number(t.amount) || 0);
  }
  return map;
}

export const budgetsOfMonth = (state, month) => state.budgets.filter((b) => b.month === month);

// Ringkasan cashflow untuk rentang tanggal bebas (dipakai filter periode di Home)
export function rangeSummary(state, fromDate, toDate) {
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (t.date < fromDate || t.date > toDate) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === "income") income += amt;
    else if (t.type === "expense") expense += amt;
  }
  return { income, expense, surplus: income - expense };
}

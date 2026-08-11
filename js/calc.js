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
import { addMonths, toDateStr } from "./utils.js";

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

// ============== Akun tipe `credit` (kartu kredit) ==============
// Kartu kredit TETAP akun biasa (transaksi expense/transfer jalan generic lewat accountId-nya,
// accountBalances() TIDAK ada mekanisme khusus) — cuma KALKULASI/PRESENTASI-nya yang beda dari
// akun cash lain: utang CC (saldo negatif) dihitung lewat DEBT PATH (`totalDebtIDR()` di bawah),
// BUKAN cash path lagi (v1 dulu lewat cash path, dipindah — lihat DECISIONS.md kalau butuh
// alasan lengkap perubahannya). Definisi di sini sengaja diletakkan SEBELUM totalCashIDR()
// karena fungsi itu sekarang butuh `isCreditAccount()`.
export const isCreditAccount = (acct) => acct.type === "credit";

// `balances` = output accountBalances(state) — dioper biar caller ga perlu hitung ulang tiap
// panggil (dipakai bareng buat banyak akun di satu render).
export const creditUsed = (acct, balances) => {
  const b = balances[acct.id] || 0;
  return b < 0 ? -b : 0;
};

// null = ga ada limit (creditLimit 0/kosong) — BUKAN 0, biar UI bisa bedain "unlimited" dari
// "udah pas-pasan"/"over limit" (0 atau negatif).
export const creditRemaining = (acct, balances) => {
  const limit = Number(acct.creditLimit) || 0;
  if (limit <= 0) return null;
  return limit - creditUsed(acct, balances);
};

// Total utang CC semua akun credit, dalam IDR — dipakai LANGSUNG di formula `totalDebtIDR()`
// (CC lewat debt path sekarang) DAN buat breakdown tampilan (misah baris "🪪 Kartu Kredit" dari
// "💳 Debt" cicilan di Wealth/report, dua-duanya tetap sum ke `totalDebtIDR()` yang sama).
export function totalCreditDebtIDR(state) {
  const bal = accountBalances(state);
  const rate = effectiveRate(state);
  return activeAccounts(state)
    .filter(isCreditAccount)
    .reduce((sum, a) => sum + creditUsed(a, bal) * (a.currency === "USD" ? rate : 1), 0);
}

// Total cash dalam IDR (akun USD dikonversi). Akun tipe `credit` DIKECUALIKAN kalau balance-nya
// NEGATIF (utang — masuk `totalDebtIDR()` sekarang, bukan sini) — TAPI kalau kebetulan saldo CC
// POSITIF (overpay, edge case yang udah di-flag `integrity.js` sebagai kemungkinan salah), bagian
// positif itu TETAP keitung cash, biar nilainya ga "ilang" dari net worth (`totalCreditDebtIDR()`
// di atas cuma ngitung bagian NEGATIF/utang, jadi ga ada double-count maupun kehilangan value
// buat kombinasi sign manapun — lihat test "credit: saldo CC positif" di calc.test.mjs).
export function totalCashIDR(state) {
  const bal = accountBalances(state);
  const rate = effectiveRate(state);
  return activeAccounts(state).reduce((sum, a) => {
    let b = bal[a.id] || 0;
    if (isCreditAccount(a) && b < 0) b = 0;
    return sum + (a.currency === "USD" ? b * rate : b);
  }, 0);
}

// Nilai asset (harga manual). Saham IDX: qty dalam LOT → ×100 lembar. CAPEX (lihat blok di
// bawah) dispatch ke capexValueIDR — nilainya auto-dihitung dari penyusutan, bukan harga manual.
// Bond (lihat blok di bawah) dispatch ke bondValueIDR — nilai default par (`principal`), BUKAN
// qty×harga/unit kayak saham. `nowMonth` cuma dipakai buat CAPEX (tipe lain abaikan parameter
// ini) — WAJIB dikirim eksplisit oleh caller (store.js → currentMonth()), calc.js ga boleh baca
// wall-clock sendiri.
export function assetValueIDR(state, a, nowMonth) {
  if (a.type === "capex") return capexValueIDR(state, a, nowMonth);
  if (a.type === "bond") return bondValueIDR(state, a);
  const rate = effectiveRate(state);
  const qty = Number(a.quantity) || 0;
  const price = Number(a.manualPrice) || 0;
  const shares = a.type === "stock_id" ? qty * 100 : qty;
  const val = shares * price;
  return a.currency === "USD" ? val * rate : val;
}

export function assetCostIDR(state, a) {
  if (a.type === "bond") return bondCostIDR(state, a);
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

// ============== Bond / SBN Ritel (ORI, SR, SBR, ST) — TASK-4 ==============
// Beli senilai `principal` (kelipatan Rp1jt), dapet kupon periodik yang cair ke rekening —
// KUPON TIDAK DIHITUNG OTOMATIS di sini (keputusan owner: pajak PPh final 10%, pembulatan, &
// timing mutasi RDN beda-beda tiap kali cair, bikin angka app gampang meleset dari realita kalau
// diotomatisasi — lihat DECISIONS.md), user input manual transaksi income pas kupon beneran cair
// (`openBondCouponSheet`, wealth.js). Pokok balik 100% saat `maturityDate` — PERISTIWA TERPISAH
// dari kupon, dicatat lewat `openBondRedeemSheet()` (transfer transaction ber-`assetId`+
// `assetDir:"redeem"`, db.js `applyAssetQtyEffect()` di-extend buat nge-handle arah ini).
//
// Nilai TIDAK fluktuatif kayak saham (`bondLocalValue`): default = par (`principal` apa adanya).
// `manualPrice` (opsional) = nilai pasar sekunder ABSOLUT dalam currency bond ini (BUKAN qty×
// harga/unit — bond ga punya qty yang berarti, `principal` udah representasi "nilai Rp" langsung,
// beda dari saham yang qty×harga/lembar). `quantity` DIPAKSA 1 di form (pola sama CAPEX) — ga ada
// konsep qty buat instrumen lump-sum kayak gini.
//
// `redeemed:true` (di-set `openBondRedeemSheet()` saat pokok dicairkan) -> value & cost 0 (posisi
// udah ditutup, duitnya balik ke cash, ga ada lagi yang "dipegang") TAPI dokumen assets-nya TETAP
// ADA (ga dihapus, jejak riwayat kepertahankan) — filter dari list ASSET AKTIF ada di UI
// (wealth.js `renderAssets()`), BUKAN di sini (di sini cuma soal nilai, bukan visibility).
export function bondLocalValue(a) {
  if (a.redeemed === true) return 0;
  const market = Number(a.manualPrice) || 0;
  return market > 0 ? market : (Number(a.principal) || 0);
}

export function bondValueIDR(state, a) {
  const rate = effectiveRate(state);
  const val = bondLocalValue(a);
  return a.currency === "USD" ? val * rate : val;
}

// Cost basis bond SELALU `principal` (BUKAN avgBuyPrice — field itu ga dipakai buat bond sama
// sekali, beda dari CAPEX yang REUSE avgBuyPrice) — P&L bond = value − principal, otomatis 0
// kalau `manualPrice` kosong (BENAR, bond par ga punya gain/loss sampai ada harga pasar eksplisit
// yang beda). Redeemed -> 0 juga, biar P&L ga nyisain klaim "rugi" palsu buat posisi yang udah
// ditutup (uangnya balik 100% ke cash, bukan hilang).
export function bondCostIDR(state, a) {
  if (a.redeemed === true) return 0;
  const rate = effectiveRate(state);
  const principal = Number(a.principal) || 0;
  return a.currency === "USD" ? principal * rate : principal;
}

// Helper INFORMATIF doang (TIDAK pernah dipakai buat bikin transaksi/kalkulasi net worth) —
// estimasi tanggal kupon berikutnya + nominal kasar (SEBELUM pajak), buat teks bantu di UI
// (assetRow/openBondCouponSheet, wealth.js). Return null kalau ga cukup data buat diestimasi
// (belum redeemed-check dulu, butuh couponRatePA>0 + principal>0 + issueDate/purchaseDate) ATAU
// kalau estimasi tanggalnya udah lewat `maturityDate` (ga ada kupon lagi setelah jatuh tempo).
// `todayStr` WAJIB dikirim eksplisit oleh caller (bukan baca wall-clock sendiri di sini, pola
// sama fungsi calc.js lain yang butuh "hari ini").
export function bondNextCouponHint(a, todayStr) {
  if (a.type !== "bond" || a.redeemed === true) return null;
  const rate = Number(a.couponRatePA) || 0; // desimal 0-1, pola sama projectionRateA/B
  const period = Math.max(1, Number(a.couponPeriodMonths) || 1);
  const principal = Number(a.principal) || 0;
  const anchor = a.issueDate || a.purchaseDate;
  if (rate <= 0 || principal <= 0 || !anchor || !todayStr) return null;
  const d = new Date(`${anchor}T00:00:00`);
  const t = new Date(`${todayStr}T00:00:00`);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return null;
  while (d.getTime() <= t.getTime()) d.setMonth(d.getMonth() + period);
  const nextDate = toDateStr(d);
  if (a.maturityDate && nextDate > a.maturityDate) return null; // ga ada kupon lagi setelah jatuh tempo
  const estAmount = Math.round(principal * (rate / 12) * period);
  return { nextDate, estAmount };
}

export const totalAssetsIDR = (state, nowMonth) =>
  state.assets.reduce((s, a) => s + assetValueIDR(state, a, nowMonth), 0);

// Total nilai CAPEX doang — dipakai netWorthIDR buat conditional include/exclude (toggle
// settings.includeCapexInNetWorth) TANPA filter ulang assetValueIDR di dua tempat beda.
export const totalCapexIDR = (state, nowMonth) =>
  state.assets.filter((a) => a.type === "capex").reduce((s, a) => s + assetValueIDR(state, a, nowMonth), 0);

// Utang cicilan (collection `debts`) + utang kartu kredit (`totalCreditDebtIDR()`, saldo negatif
// akun tipe `credit`) — CC lewat DEBT PATH sekarang (bukan cash path lagi, lihat bullet
// `isCreditAccount` di atas & DECISIONS.md). Dua sumber ini TETAP konsep terpisah (cicilan TETAP
// vs kartu revolving) — cuma DIJUMLAHKAN di sini biar netWorthIDR() otomatis bener; breakdown
// tampilan (Wealth/report) misahin lagi jadi 2 baris via `totalCreditDebtIDR()` + (totalDebtIDR −
// totalCreditDebtIDR) buat cicilan doang.
export const totalDebtIDR = (state) =>
  state.debts.reduce((s, d) => s + (Number(d.totalOutstanding) || 0), 0) + totalCreditDebtIDR(state);

// Goal yang diarsipkan (`isArchived`, pola sama `activeAccounts()`) — TAPI beda konsekuensi:
// `activeAccounts()` dipakai LANGSUNG di totalCashIDR() (akun diarsip = ditutup, saldo-nya
// berhenti keitung). Goal diarsipin BUKAN berarti uangnya ilang — cuma "udah beres dilihat
// sehari-hari", uang yang udah ke-topup TETAP real net worth. Makanya `totalGoalSavingsIDR()`
// di bawah SENGAJA TETAP iterate `state.goals` mentah (TANPA filter activeGoals) — helper ini
// cuma buat filter TAMPILAN (Home preview, snapshot breakdown, laporan .md); halaman `#/goals`
// sendiri TETAP nampilin semua (aktif + arsip, badge doang buat bedain, pola sama accounts.js).
export const activeGoals = (state) => state.goals.filter((g) => !g.isArchived);

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

// ============== Goal ↔ Asset linking ==============
// Short Term Goal SEKARANG bisa di-link ke ≥1 asset (`goals.linkedAssetIds`, array of assetId,
// di-set dari sheet edit goal) — nilai asset yang di-link IKUT ditampilin sebagai bagian
// progress goal (`goalProgressIDR()` di bawah), TAPI SENGAJA TIDAK ikut `totalGoalSavingsIDR()`
// (dipakai `netWorthIDR()`) — asset yang di-link TETAP asset biasa, udah kehitung penuh di
// `totalAssetsIDR()`, nambahin lagi ke goalSavings bakal DOUBLE-COUNT net worth. `goalSavedIDR()`
// (topup/withdraw cash, di atas) TETAP satu-satunya sumber `totalGoalSavingsIDR()` — pemisahan
// ini SENGAJA, lihat CLAUDE.md bullet `goals` buat penjelasan lengkap.
export function goalLinkedAssetsValueIDR(state, goalId, nowMonth) {
  const goal = state.goals.find((g) => g.id === goalId);
  const linkedIds = goal?.linkedAssetIds || [];
  if (linkedIds.length === 0) return 0;
  return state.assets
    .filter((a) => linkedIds.includes(a.id))
    .reduce((sum, a) => sum + assetValueIDR(state, a, nowMonth), 0);
}

// Progress TAMPILAN satu goal = topup standalone (goalSavedIDR) + nilai asset ter-link
// (goalLinkedAssetsValueIDR) — dipakai buat progress bar/persentase di UI (goals.js/home.js),
// BUKAN buat net worth (lihat bullet di atas). `nowMonth` diteruskan ke assetValueIDR (CAPEX
// butuh ini, tipe lain abaikan).
export function goalProgressIDR(state, goalId, nowMonth) {
  return goalSavedIDR(state, goalId) + goalLinkedAssetsValueIDR(state, goalId, nowMonth);
}

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

// Dekomposisi Δ net worth antara 2 breakdown mentah (`prevParts`/`currParts`, SAMA shape kayak
// `netWorthFromParts()`: {cash, assets, capex, goalSavings, debt}) — dipakai report-md.js section
// 10 "Perubahan komposisi" (TASK-1, 2026-08 — riwayat lengkap bug-nya: lihat DECISIONS.md).
//
// BUG YANG DIBENERIN DI SINI: versi lama nge-jumlah Δassets RAW *dan* ΔCAPEX terpisah (double
// count — assets RAW UDAH TERMASUK CAPEX, lihat `netWorthFromParts()` di atas), PLUS nambahin
// Δdebt RAW ke sum tanpa negasi (padahal formula aslinya `-debt` — debt naik itu KONTRIBUSI
// NEGATIF ke net worth, bukan positif). Dua bug independen, sama-sama bikin Σ komponen ga match
// Δ net worth beneran.
//
// FIX: setiap field yang di-return SUDAH representasi KONTRIBUSI ke net worth (bukan raw delta
// apa adanya) — caller TINGGAL JUMLAH APA ADANYA (`cash + assets + (includeCapex ? capex : 0) +
// goalSavings + debt`), TANPA sign-flip/exclude tambahan lagi. Ini yang bikin bug kelas ini ga
// bisa kejadian lagi: `assets` di sini SELALU exclude CAPEX (pola sama `investAssets` di
// wealth.js `renderTotal()` — CAPEX baris terpisah, cuma ikut disum kalau `includeCapex` true),
// `debt` UDAH dinegasi. Dijamin ALGEBRAIC (bukan cuma "biasanya cocok"): `total` dihitung
// LANGSUNG dari `netWorthFromParts()` (sumber kebenaran yang sama dipakai section 1 report-md.js
// & chart Wealth), BUKAN dari nge-jumlah ulang field-field di bawah — jadi kalaupun caller lupa
// nge-exclude CAPEX pas nyusun UI, `total` tetap benar (di-test eksplisit di calc.test.mjs pakai
// angka asli dari laporan Agustus 2026 yang jadi bukti bug ini).
//
// TIDAK butuh `state` — murni angka breakdown yang udah dihitung caller (live totals ATAU field
// mentah snapshot Firestore, dua-duanya shape-nya sama).
export function netWorthComposition(prevParts, currParts, includeCapex) {
  const num = (parts, key) => Number(parts[key]) || 0;
  const cash = num(currParts, "cash") - num(prevParts, "cash");
  const capex = num(currParts, "capex") - num(prevParts, "capex");
  const assets = (num(currParts, "assets") - num(currParts, "capex"))
    - (num(prevParts, "assets") - num(prevParts, "capex"));
  const goalSavings = num(currParts, "goalSavings") - num(prevParts, "goalSavings");
  const debt = -(num(currParts, "debt") - num(prevParts, "debt"));
  const total = netWorthFromParts(currParts, includeCapex) - netWorthFromParts(prevParts, includeCapex);
  return { cash, assets, capex, goalSavings, debt, total, includeCapex };
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

// Kalkulasi murni — SEMUA fungsi di sini cuma butuh `state` sebagai parameter, TIDAK ada
// import Firebase/DOM apapun. Ini jantung app (saldo akun, net worth, dll), diekstrak dari
// store.js (TASK-7) biar bisa di-test lewat `node tests/calc.test.mjs` tanpa perlu Firebase SDK.
// store.js adalah wrapper tipis di atas modul ini yang manggil tiap fungsi dengan `state` global
// — perilaku runtime app TIDAK berubah, cuma lokasi kodenya yang pindah.
//
// Kalau nyentuh file ini, jalankan `node tests/calc.test.mjs` sebelum selesai (lihat CLAUDE.md
// ATURAN WAJIB).

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

// Nilai asset (harga manual). Saham IDX: qty dalam LOT → ×100 lembar.
export function assetValueIDR(state, a) {
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

export const totalAssetsIDR = (state) => state.assets.reduce((s, a) => s + assetValueIDR(state, a), 0);
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

// Goal savings dihitung sebagai bagian net worth (uangnya ga hilang, cuma pindah "kantong").
export const netWorthIDR = (state) =>
  totalCashIDR(state) + totalAssetsIDR(state) + totalGoalSavingsIDR(state) - totalDebtIDR(state);

// Progress 🏆 Main Milestone — target 0/kosong → hidden:true (bukan div-by-zero).
export function milestoneProgress(state) {
  const target = Number(state.settings.targetNetWorth) || 0;
  if (target <= 0) return { target: 0, nw: 0, pct: 0, achieved: false, hidden: true };
  const nw = netWorthIDR(state);
  const pct = Math.max(0, Math.min(100, (nw / target) * 100));
  return { target, nw, pct, achieved: nw >= target, hidden: false };
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

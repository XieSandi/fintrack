// Central state + realtime Firestore listeners.
// Views subscribe via store.on(fn) dan di-rerender saat data berubah.
import {
  db, collection, doc, onSnapshot, query, orderBy,
} from "./firebase.js";
import { currentMonth } from "./utils.js";

export const state = {
  uid: null,
  ready: false,          // semua listener pertama sudah emit
  month: currentMonth(), // bulan aktif untuk view Transaksi & Budget
  accounts: [],
  categories: [],
  transactions: [],      // SEMUA transaksi (single user → aman; cached lokal)
  budgets: [],           // semua budget docs
  assets: [],
  debts: [],
  goals: [],
  snapshots: [],
  settings: {},
  usdIdr: null,          // { rate, date, source }
};

const listeners = new Set();
export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => fn());

let unsubs = [];
const pending = new Set();

export function startListeners(uid) {
  stopListeners();
  state.uid = uid;
  state.ready = false;

  const col = (name) => collection(db, "users", uid, name);
  const track = (key, q, mapFn) => {
    pending.add(key);
    const unsub = onSnapshot(q, (snap) => {
      state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (mapFn) mapFn(snap);
      pending.delete(key);
      if (pending.size === 0) state.ready = true;
      emit();
    }, (err) => console.error(`[listener:${key}]`, err));
    unsubs.push(unsub);
  };

  track("accounts", query(col("accounts")));
  track("categories", query(col("categories")));
  track("transactions", query(col("transactions"), orderBy("date", "desc")));
  track("budgets", query(col("budgets")));
  track("assets", query(col("assets")));
  track("debts", query(col("debts")));
  track("goals", query(col("goals")));
  track("snapshots", query(col("snapshots"), orderBy("__name__")));

  pending.add("settings");
  const unsubSet = onSnapshot(doc(db, "users", uid, "settings", "main"), (snap) => {
    state.settings = snap.exists() ? snap.data() : {};
    pending.delete("settings");
    if (pending.size === 0) state.ready = true;
    emit();
  });
  unsubs.push(unsubSet);
}

export function stopListeners() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

export const setMonth = (m) => { state.month = m; emit(); };
export const setKurs = (k) => { state.usdIdr = k; emit(); };

// ================= Derived =================

export const activeAccounts = () => state.accounts.filter((a) => !a.isArchived);

export const catById = (id) => state.categories.find((c) => c.id === id);
export const acctById = (id) => state.accounts.find((a) => a.id === id);

// Kurs efektif: manual override di settings > auto > fallback
export const effectiveRate = () =>
  Number(state.settings.usdIdrManual) || state.usdIdr?.rate || 16000;

// Saldo per akun dihitung dari jurnal (auditable)
export function accountBalances() {
  const bal = {};
  state.accounts.forEach((a) => (bal[a.id] = Number(a.initialBalance) || 0));
  for (const t of state.transactions) {
    const amt = Number(t.amount) || 0;
    if (t.type === "expense") bal[t.accountId] = (bal[t.accountId] || 0) - amt;
    else if (t.type === "income") bal[t.accountId] = (bal[t.accountId] || 0) + amt;
    else if (t.type === "transfer") {
      bal[t.accountId] = (bal[t.accountId] || 0) - amt;
      bal[t.toAccountId] = (bal[t.toAccountId] || 0) + amt;
    }
  }
  return bal;
}

// Total cash dalam IDR (akun USD dikonversi)
export function totalCashIDR() {
  const bal = accountBalances();
  const rate = effectiveRate();
  return activeAccounts().reduce((sum, a) => {
    const b = bal[a.id] || 0;
    return sum + (a.currency === "USD" ? b * rate : b);
  }, 0);
}

// Nilai asset (harga manual). Saham IDX: qty dalam LOT → ×100 lembar.
export function assetValueIDR(a) {
  const rate = effectiveRate();
  const qty = Number(a.quantity) || 0;
  const price = Number(a.manualPrice) || 0;
  const shares = a.type === "stock_id" ? qty * 100 : qty;
  const val = shares * price;
  return a.currency === "USD" ? val * rate : val;
}

export function assetCostIDR(a) {
  const rate = effectiveRate();
  const qty = Number(a.quantity) || 0;
  const avg = Number(a.avgBuyPrice) || 0;
  const shares = a.type === "stock_id" ? qty * 100 : qty;
  const val = shares * avg;
  return a.currency === "USD" ? val * rate : val;
}

export const totalAssetsIDR = () => state.assets.reduce((s, a) => s + assetValueIDR(a), 0);
export const totalDebtIDR = () => state.debts.reduce((s, d) => s + (Number(d.totalOutstanding) || 0), 0);
export const netWorthIDR = () => totalCashIDR() + totalAssetsIDR() - totalDebtIDR();

// Ringkasan cashflow satu bulan (transfer tidak dihitung)
export function monthSummary(month) {
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
export function spentByCategory(month) {
  const map = {};
  for (const t of state.transactions) {
    if (t.month !== month || t.type !== "expense") continue;
    map[t.categoryId] = (map[t.categoryId] || 0) + (Number(t.amount) || 0);
  }
  return map;
}

export const budgetsOfMonth = (month) => state.budgets.filter((b) => b.month === month);

// Ringkasan cashflow untuk rentang tanggal bebas (dipakai filter periode di Home)
export function rangeSummary(fromDate, toDate) {
  let income = 0, expense = 0;
  for (const t of state.transactions) {
    if (t.date < fromDate || t.date > toDate) continue;
    const amt = Number(t.amount) || 0;
    if (t.type === "income") income += amt;
    else if (t.type === "expense") expense += amt;
  }
  return { income, expense, surplus: income - expense };
}

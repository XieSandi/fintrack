// Central state + realtime Firestore listeners.
// Views subscribe via store.on(fn) dan di-rerender saat data berubah.
// Kalkulasi murni (accountBalances, netWorthIDR, dll) diekstrak ke js/calc.js (TASK-7) —
// file ini cuma wrapper tipis yang manggil calc.js dengan `state` global. calc.js sendiri
// TIDAK import Firebase, jadi bisa di-test lewat `node tests/calc.test.mjs` tanpa app.
import {
  db, collection, doc, onSnapshot, query, orderBy,
} from "./firebase.js";
import { currentMonth } from "./utils.js";
import * as calc from "./calc.js";

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
  recurring: [],
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
  track("recurring", query(col("recurring")));
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

// ================= Derived (wrapper tipis ke js/calc.js, lihat file itu) =================

export const activeAccounts = () => calc.activeAccounts(state);
export const catById = (id) => calc.catById(state, id);
export const acctById = (id) => calc.acctById(state, id);
export const effectiveRate = () => calc.effectiveRate(state);
export const accountBalances = () => calc.accountBalances(state);
export const totalCashIDR = () => calc.totalCashIDR(state);
export const assetValueIDR = (a) => calc.assetValueIDR(state, a);
export const assetCostIDR = (a) => calc.assetCostIDR(state, a);
export const totalAssetsIDR = () => calc.totalAssetsIDR(state);
export const totalDebtIDR = () => calc.totalDebtIDR(state);
export const goalSavedIDR = (goalId) => calc.goalSavedIDR(state, goalId);
export const totalGoalSavingsIDR = () => calc.totalGoalSavingsIDR(state);
export const netWorthIDR = () => calc.netWorthIDR(state);
export const milestoneProgress = () => calc.milestoneProgress(state);
export const monthSummary = (month) => calc.monthSummary(state, month);
export const spentByCategory = (month) => calc.spentByCategory(state, month);
export const budgetsOfMonth = (month) => calc.budgetsOfMonth(state, month);
export const rangeSummary = (fromDate, toDate) => calc.rangeSummary(state, fromDate, toDate);

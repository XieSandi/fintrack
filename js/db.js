// Repository layer — semua tulis/baca Firestore lewat sini.
import {
  db, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, serverTimestamp, writeBatch,
} from "./firebase.js";
import {
  state, netWorthIDR, totalCashIDR, totalAssetsIDR, totalDebtIDR,
  accountBalances, assetValueIDR,
} from "./store.js";
import { currentMonth } from "./utils.js";

const col = (name) => collection(db, "users", state.uid, name);
const docRef = (name, id) => doc(db, "users", state.uid, name, id);

const stamp = (data, isNew) => ({
  ...data,
  updatedAt: serverTimestamp(),
  ...(isNew ? { createdAt: serverTimestamp() } : {}),
});

// Generic CRUD
export async function add(name, data) {
  const ref = await addDoc(col(name), stamp(data, true));
  if (name === "transactions" && data.debtId) {
    await applyDebtEffect(data.debtId, -(Number(data.amount) || 0), true, -1);
  }
  return ref;
}
export const put = (name, id, data) => setDoc(docRef(name, id), stamp(data, true), { merge: true });
export async function patch(name, id, data) {
  const before = name === "transactions" ? state.transactions.find((t) => t.id === id) : null;
  await updateDoc(docRef(name, id), stamp(data, false));
  if (name === "transactions" && (before?.debtId || data.debtId)) {
    await handleDebtPatch(before, data);
  }
}
export async function remove(name, id) {
  const before = name === "transactions" ? state.transactions.find((t) => t.id === id) : null;
  await deleteDoc(docRef(name, id));
  if (name === "transactions" && before?.debtId) {
    await applyDebtEffect(before.debtId, Number(before.amount) || 0, true, 1);
  }
}

// ================= Efek cicilan ke debt (TASK-4) =================
// Transaksi expense bisa opsional bawa `debtId` (tx-sheet.js / recurring). Efeknya ke
// debts.totalOutstanding/remainingMonths DIPUSATKAN di sini, dipanggil otomatis dari
// add/patch/remove di atas — sheet manapun yang bikin/edit/hapus transaksi ga perlu tau
// soal ini sama sekali, cukup isi field `debtId` kayak field lain.
async function applyDebtEffect(debtId, outstandingDelta, touchMonths, monthsDelta = 0) {
  const debt = state.debts.find((d) => d.id === debtId);
  if (!debt) return; // debt-nya udah kehapus duluan — ga ada yang bisa disesuaikan
  const data = { totalOutstanding: Math.max(0, (Number(debt.totalOutstanding) || 0) + outstandingDelta) };
  if (touchMonths && debt.remainingMonths != null) {
    data.remainingMonths = Math.max(0, (Number(debt.remainingMonths) || 0) + monthsDelta);
  }
  await patch("debts", debtId, data);
}

// Bandingin transaksi lama vs data baru pas PATCH — nentuin apply/reverse/adjust yang mana.
// debtId sama (termasuk sama-sama kosong) → cuma sesuaikan selisih nominal, remainingMonths
// ga ikut kesentuh (itu hitungan JUMLAH pembayaran, bukan nominal). debtId beda/baru/dilepas
// → reverse penuh ke debt lama (kalau ada) + apply penuh ke debt baru (kalau ada).
async function handleDebtPatch(before, data) {
  const oldDebtId = before?.debtId || null;
  const newDebtId = data.debtId || null;
  const oldAmount = Number(before?.amount) || 0;
  const newAmount = Number(data.amount) || 0;

  if (oldDebtId === newDebtId) {
    if (newDebtId && oldAmount !== newAmount) {
      await applyDebtEffect(newDebtId, -(newAmount - oldAmount), false);
    }
    return;
  }
  if (oldDebtId) await applyDebtEffect(oldDebtId, oldAmount, true, 1);
  if (newDebtId) await applyDebtEffect(newDebtId, -newAmount, true, -1);
}

// ================= Seeding (first run) =================
const PRESET_CATEGORIES = [
  { id: "cat_makan",     name: "Makanan & Minuman", icon: "🍜", type: "expense" },
  { id: "cat_transport", name: "Transport",          icon: "🚌", type: "expense" },
  { id: "cat_kost",      name: "Kost / Tempat Tinggal", icon: "🏠", type: "expense" },
  { id: "cat_tagihan",   name: "Tagihan & Utilitas", icon: "💡", type: "expense" },
  { id: "cat_belanja",   name: "Belanja & Kebutuhan", icon: "🛒", type: "expense" },
  { id: "cat_kesehatan", name: "Kesehatan",          icon: "🏥", type: "expense" },
  { id: "cat_hiburan",   name: "Hiburan",            icon: "🎮", type: "expense" },
  { id: "cat_keluarga",  name: "Keluarga",           icon: "👨‍👩‍👦", type: "expense" },
  { id: "cat_pendidikan",name: "Pendidikan",         icon: "📚", type: "expense" },
  { id: "cat_cicilan",   name: "Cicilan / Debt",     icon: "💳", type: "expense" },
  { id: "cat_lainnya",   name: "Lainnya",            icon: "📦", type: "expense" },
  { id: "cat_gaji",      name: "Gaji",               icon: "💼", type: "income" },
  { id: "cat_bonus",     name: "Bonus / THR",        icon: "🎁", type: "income" },
  { id: "cat_bunga",     name: "Bunga & Dividen",    icon: "📈", type: "income" },
  { id: "cat_in_lain",   name: "Lainnya",            icon: "📦", type: "income" },
];

export async function seedIfNeeded() {
  const setRef = docRef("settings", "main");
  const snap = await getDoc(setRef);
  if (snap.exists() && snap.data().seeded) return false;

  const batch = writeBatch(db);
  PRESET_CATEGORIES.forEach((c) => {
    batch.set(docRef("categories", c.id), {
      name: c.name, icon: c.icon, type: c.type, isPreset: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
  batch.set(setRef, {
    seeded: true,
    targetNetWorth: 100_000_000,
    targetDate: "2028-12",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
  return true;
}

// ================= Kategori preset tambahan (migrasi idempotent) =================
// Dipanggil tiap sesi (bukan cuma first-run kayak seedIfNeeded) — put() pakai id
// deterministik + merge, jadi aman dipanggil berkali-kali, ga bakal duplikat.
const RECONCILE_CATEGORIES = [
  { id: "cat_adjust_out", name: "Penyesuaian Saldo", icon: "⚖️", type: "expense", isPreset: true },
  { id: "cat_adjust_in",  name: "Penyesuaian Saldo", icon: "⚖️", type: "income",  isPreset: true },
];

export async function ensurePresetCategories() {
  await Promise.all(RECONCILE_CATEGORIES.map(({ id, ...data }) => put("categories", id, data)));
}

// ================= Snapshot bulanan =================
// Dipanggil saat app load (setelah data ready): upsert snapshot bulan berjalan.
export async function upsertSnapshot() {
  if (!state.ready || !state.uid) return;
  const m = currentMonth();
  const bal = accountBalances();
  const breakdown = {
    accounts: Object.fromEntries(state.accounts.map((a) => [a.name, Math.round(bal[a.id] || 0)])),
    assets: Object.fromEntries(state.assets.map((a) => [a.symbol || a.name, Math.round(assetValueIDR(a))])),
  };
  await setDoc(docRef("snapshots", m), {
    month: m,
    totalCash: Math.round(totalCashIDR()),
    totalAssets: Math.round(totalAssetsIDR()),
    totalDebt: Math.round(totalDebtIDR()),
    netWorth: Math.round(netWorthIDR()),
    breakdown,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ================= Backup / Restore =================
const COLLECTIONS = ["accounts", "categories", "transactions", "budgets", "assets", "debts", "goals", "recurring", "snapshots"];

export async function exportAll() {
  const out = { app: "fintrack", schemaVersion: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const name of COLLECTIONS) {
    const snap = await getDocs(col(name));
    out.data[name] = snap.docs.map((d) => {
      const raw = d.data();
      // Timestamp → ISO string biar JSON-safe
      for (const k of ["createdAt", "updatedAt"]) {
        if (raw[k]?.toDate) raw[k] = raw[k].toDate().toISOString();
      }
      return { id: d.id, ...raw };
    });
  }
  const setSnap = await getDoc(docRef("settings", "main"));
  if (setSnap.exists()) {
    const s = setSnap.data();
    for (const k of ["createdAt", "updatedAt"]) if (s[k]?.toDate) s[k] = s[k].toDate().toISOString();
    out.data.settings = [{ id: "main", ...s }];
  }
  return out;
}

export async function importAll(backup, mode /* "merge" | "replace" */) {
  if (backup?.app !== "fintrack" || !backup.data) throw new Error("File bukan backup FinTrack yang valid.");
  if (backup.schemaVersion > 1) throw new Error("Versi backup lebih baru dari app. Update app dulu.");

  if (mode === "replace") {
    for (const name of COLLECTIONS) {
      const snap = await getDocs(col(name));
      // batched delete (limit 500/batch)
      let batch = writeBatch(db), count = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        if (++count === 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
      }
      if (count) await batch.commit();
    }
  }

  const all = { ...backup.data };
  const settingsRows = all.settings || [];
  delete all.settings;

  for (const [name, rows] of Object.entries(all)) {
    let batch = writeBatch(db), count = 0;
    for (const row of rows || []) {
      const { id, ...data } = row;
      data.updatedAt = serverTimestamp();
      batch.set(docRef(name, id), data, { merge: mode === "merge" });
      if (++count === 450) { await batch.commit(); batch = writeBatch(db); count = 0; }
    }
    if (count) await batch.commit();
  }
  for (const row of settingsRows) {
    const { id, ...data } = row;
    await setDoc(docRef("settings", id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  }
}

export const updateSettings = (data) => put("settings", "main", data);

// ================= Bulk Delete / Reset (TASK-9) =================
// Scope bareng buat preview DAN delete beneran — biar preview ga pernah kebohongan
// (drift dari logic delete yang sebenarnya jalan).
function bulkDeleteScope(mode, month, year) {
  if (mode === "month") {
    return {
      transactions: state.transactions.filter((t) => t.month === month),
      budgets: state.budgets.filter((b) => b.month === month),
      snapshots: state.snapshots.filter((s) => (s.month || s.id) === month),
    };
  }
  if (mode === "year") {
    const prefix = `${year}-`;
    return {
      transactions: state.transactions.filter((t) => t.month?.startsWith(prefix)),
      budgets: state.budgets.filter((b) => b.month?.startsWith(prefix)),
      snapshots: state.snapshots.filter((s) => (s.month || s.id)?.startsWith(prefix)),
    };
  }
  // "total" (C1/C2) — semua histori
  return {
    transactions: state.transactions.slice(),
    budgets: state.budgets.slice(),
    snapshots: state.snapshots.slice(),
  };
}

// Pure, ga nyentuh Firestore — dipakai UI buat preview sebelum eksekusi.
export function previewBulkDelete({ mode, month, year }) {
  const scope = bulkDeleteScope(mode, month, year);
  const totalExpense = scope.transactions.filter((t) => t.type === "expense").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const totalIncome = scope.transactions.filter((t) => t.type === "income").reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const dates = scope.transactions.map((t) => t.date).sort();
  return {
    transactions: scope.transactions.length,
    budgets: scope.budgets.length,
    snapshots: scope.snapshots.length,
    totalExpense, totalIncome,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
  };
}

// mode: "month" | "year" | "total". includeMaster (cuma relevan buat "total") = C2 Reset Total
// (hapus akun/kategori/asset/hutang/goal/recurring juga + reseed). keepApiKeys = pertahankan
// apiKeys pas C2. onProgress(done, total) opsional buat progress bar UI.
//
// SENGAJA nulis lewat writeBatch/deleteDoc LANGSUNG (bukan remove() generik) — pola sama kayak
// importAll() (lihat Known Quirks CLAUDE.md). Efek debtId TETAP dikembalikan (konsisten sama
// hapus 1 transaksi via remove()), TAPI diagregasi per debt dulu (bukan 1 patch per transaksi)
// — ratusan patch berturut ke dokumen debt yang sama itu lambat & rawan race kalau lewat hook.
export async function bulkDelete({ mode, month, year, includeMaster, keepApiKeys, onProgress }) {
  if (!navigator.onLine) throw new Error("Butuh koneksi internet buat bulk delete.");

  const scope = bulkDeleteScope(mode, month, year);
  const masterScope = includeMaster ? {
    accounts: state.accounts.slice(),
    categories: state.categories.slice(),
    assets: state.assets.slice(),
    debts: state.debts.slice(),
    goals: state.goals.slice(),
    recurring: state.recurring.slice(),
  } : null;

  const totalOps = scope.transactions.length + scope.budgets.length + scope.snapshots.length
    + (masterScope ? Object.values(masterScope).reduce((s, a) => s + a.length, 0) : 0);
  let done = 0;
  const report = () => onProgress?.(done, totalOps);
  report();

  const deleteChunked = async (name, docs) => {
    let batch = writeBatch(db), count = 0;
    for (const d of docs) {
      batch.delete(docRef(name, d.id));
      if (++count === 450) { await batch.commit(); done += count; report(); batch = writeBatch(db); count = 0; }
    }
    if (count) { await batch.commit(); done += count; report(); }
    return docs.length;
  };

  // Efek debt (skip total kalau includeMaster — debts-nya sendiri toh ikut kehapus)
  if (!includeMaster) {
    const debtAgg = {}; // debtId -> {amount, count}
    for (const t of scope.transactions) {
      if (!t.debtId) continue;
      if (!debtAgg[t.debtId]) debtAgg[t.debtId] = { amount: 0, count: 0 };
      debtAgg[t.debtId].amount += Number(t.amount) || 0;
      debtAgg[t.debtId].count += 1;
    }
    for (const [debtId, agg] of Object.entries(debtAgg)) {
      const debt = state.debts.find((d) => d.id === debtId);
      if (!debt) continue; // debt-nya udah kehapus duluan
      const data = { totalOutstanding: Math.max(0, (Number(debt.totalOutstanding) || 0) + agg.amount) };
      if (debt.remainingMonths != null) data.remainingMonths = Math.max(0, (Number(debt.remainingMonths) || 0) + agg.count);
      await patch("debts", debtId, data);
    }
  }

  const deleted = {
    transactions: await deleteChunked("transactions", scope.transactions),
    budgets: await deleteChunked("budgets", scope.budgets),
    snapshots: await deleteChunked("snapshots", scope.snapshots),
  };

  // Recurring yang lastPostedMonth-nya masuk periode yang baru dihapus → reset, biar sheet
  // Awal Bulan nawarin lagi (bukan nganggep udah pernah post buat bulan yang datanya lenyap).
  // Skip kalau includeMaster — koleksi recurring-nya sendiri toh ikut kehapus di bawah.
  if (!includeMaster) {
    const inScope = (m) => {
      if (!m) return false;
      if (mode === "month") return m === month;
      if (mode === "year") return m.startsWith(`${year}-`);
      return true; // total (C1)
    };
    for (const r of state.recurring) {
      if (r.lastPostedMonth && inScope(r.lastPostedMonth)) {
        await patch("recurring", r.id, { lastPostedMonth: null });
      }
    }
  }

  if (masterScope) {
    for (const [name, docs] of Object.entries(masterScope)) {
      await deleteChunked(name, docs);
    }
    const setSnap = await getDoc(docRef("settings", "main"));
    const oldApiKeys = keepApiKeys && setSnap.exists() ? setSnap.data().apiKeys : null;
    await deleteDoc(docRef("settings", "main"));
    await seedIfNeeded();
    await ensurePresetCategories();
    if (oldApiKeys) await updateSettings({ apiKeys: oldApiKeys });
  } else {
    // Bukan C2 → net worth berubah, refresh snapshot bulan berjalan biar ga basi.
    await upsertSnapshot();
  }

  return { deleted };
}

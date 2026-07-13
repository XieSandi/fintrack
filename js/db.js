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
export const add = (name, data) => addDoc(col(name), stamp(data, true));
export const put = (name, id, data) => setDoc(docRef(name, id), stamp(data, true), { merge: true });
export const patch = (name, id, data) => updateDoc(docRef(name, id), stamp(data, false));
export const remove = (name, id) => deleteDoc(docRef(name, id));

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
const COLLECTIONS = ["accounts", "categories", "transactions", "budgets", "assets", "debts", "goals", "snapshots"];

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

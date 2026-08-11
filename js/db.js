// Repository layer — semua tulis/baca Firestore lewat sini.
import {
  db, collection, doc, setDoc, addDoc, updateDoc, deleteDoc,
  getDoc, getDocs, serverTimestamp, writeBatch,
} from "./firebase.js";
import {
  state, netWorthIDR, totalCashIDR, totalAssetsIDR, totalCapexIDR, totalDebtIDR, totalGoalSavingsIDR,
  accountBalances, assetValueIDR, assetCostIDR, capexLocalValue, effectiveRate, goalSavedIDR,
  goalLinkedAssetsValueIDR, activeAccounts, activeGoals,
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
  if (name === "transactions" && before?.assetId) {
    await applyAssetQtyEffect(before.assetId, before.assetDir, Number(before.assetQty) || 0);
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

// ================= Efek qty asset dari beli/jual =================
// DIPUSATKAN di sini (pola sama applyDebtEffect) — nge-hook ke remove() generik, biar semua
// jalur hapus transaksi ber-assetId otomatis konsisten. Sebelumnya reversal ini cuma hidup di
// handler tombol Hapus sheet detail (wealth.js) — dipindah ke sini supaya bulkDelete() (yang
// SENGAJA bypass remove() generik, raw batch write) juga bisa manggil logic yang sama secara
// eksplisit tanpa duplikasi. avgBuyPrice SENGAJA GA di-reverse (butuh replay history buat
// rekonstruksi avg sebelumnya) — cuma quantity yang exact-reversible.
//
// `dir === "redeem"` (TASK-4, bond/SBN — `openBondRedeemSheet()` wealth.js) BEDA POLA dari
// buy/sell: bond ga pakai qty-tracking sama sekali (`quantity` dipaksa 1, GA PERNAH berubah),
// efek "cairkan pokok" itu flag `redeemed`, BUKAN quantity — hapus transaksi redeem = un-redeem
// (bond aktif lagi, belum dicairkan), bukan nambah qty balik.
async function applyAssetQtyEffect(assetId, dir, qty) {
  const asset = state.assets.find((a) => a.id === assetId);
  if (!asset) return; // asset-nya udah kehapus duluan — ga ada yang bisa disesuaikan
  if (dir === "redeem") {
    await patch("assets", assetId, { redeemed: false });
    return;
  }
  const delta = dir === "buy" ? -qty : qty;
  const newQty = Math.max(0, (Number(asset.quantity) || 0) + delta);
  await patch("assets", assetId, { quantity: newQty });
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
// Dipanggil saat app load (setelah data ready): upsert snapshot bulan berjalan. `breakdown`
// nyimpen posisi PER ITEM (bukan cuma total) — dipakai report-md.js buat bikin laporan bulan
// lampau yang beneran historis, bukan "posisi terkini" kayak sebelumnya. Angka mentah (bukan
// string terformat) biar gampang dipakai ulang. Dokumennya tetap kecil (puluhan baris) karena
// data personal-finance-app satu user jumlahnya wajar, jauh di bawah limit 1 MiB Firestore.
// Snapshot manual backfill (Setting → "Snapshot Historis") TETAP minimal (ga ada breakdown sama
// sekali) — itu bukan error, cuma sinyal "data lama, ga ada posisi per-item buat direkonstruksi".
export async function upsertSnapshot() {
  if (!state.ready || !state.uid) return;
  const m = currentMonth();
  const bal = accountBalances();
  const rate = effectiveRate();

  const breakdown = {
    accounts: activeAccounts().map((a) => {
      const balance = bal[a.id] || 0;
      return {
        name: a.name, currency: a.currency, type: a.type,
        balance: Math.round(balance * 100) / 100,
        balanceIDR: Math.round(a.currency === "USD" ? balance * rate : balance),
        // Field additive/opsional (cuma relevan buat type "credit") -- snapshot lama fallback
        // aman (undefined), schemaVersion TIDAK naik.
        creditLimit: a.type === "credit" ? (Number(a.creditLimit) || 0) : null,
      };
    }),
    // Bond yang udah redeemed di-exclude dari breakdown (pola sama wealth.js renderAssets() &
    // report-md.js live branch) — "hilang dari asset aktif", nilainya udah 0 di net worth
    // (bondValueIDR), snapshot ga perlu nyimpen baris Rp0 yang ga informatif.
    assets: state.assets.filter((a) => !(a.type === "bond" && a.redeemed === true)).map((a) => ({
      symbol: a.symbol || a.name, type: a.type, currency: a.currency,
      quantity: Number(a.quantity) || 0,
      avgBuyPrice: Number(a.avgBuyPrice) || 0,
      // CAPEX ga punya "harga manual" — price-nya diturunkan dari penyusutan (lihat calc.js
      // capexLocalValue). priceDate diisi bulan snapshot ini (`m`) — bukan tanggal refresh manual
      // kayak tipe lain, tapi tetap ada timestamp-nya (ATURAN WAJIB #7), bukan "?" kosong.
      price: a.type === "capex" ? Math.round(capexLocalValue(a) * 100) / 100 : Number(a.manualPrice) || 0,
      priceDate: a.type === "capex" ? m : (a.manualPriceUpdatedAt || null),
      purchaseDate: a.type === "capex" ? (a.purchaseDate || null) : null,
      depreciationPctMonth: a.type === "capex" ? (Number(a.depreciationPctMonth) || 0) : null,
      // Field bond (TASK-4) — additive/opsional, `null` kecuali tipe "bond", pola SAMA persis
      // kayak purchaseDate/depreciationPctMonth di atas buat CAPEX. schemaVersion TIDAK naik.
      principal: a.type === "bond" ? (Number(a.principal) || 0) : null,
      maturityDate: a.type === "bond" ? (a.maturityDate || null) : null,
      couponRatePA: a.type === "bond" ? (Number(a.couponRatePA) || 0) : null,
      redeemed: a.type === "bond" ? (a.redeemed === true) : null,
      valueIDR: Math.round(assetValueIDR(a)),
      costIDR: Math.round(assetCostIDR(a)),
    })),
    debts: state.debts.map((d) => ({
      name: d.name,
      outstanding: Math.round(Number(d.totalOutstanding) || 0),
      monthlyInstalment: Math.round(Number(d.monthlyInstalment) || 0),
      remainingMonths: d.remainingMonths ?? null,
      dueDay: d.dueDay ?? null,
    })),
    // activeGoals() — goal yang diarsipkan ga ikut ke-listing breakdown snapshot (pola sama
    // accounts pakai activeAccounts() di atas), TAPI `totalGoalSavings` (di bawah, top-level)
    // TETAP dari totalGoalSavingsIDR() yang ga difilter — saldo goal arsip tetap real net worth,
    // cuma listing per-item-nya yang "declutter". Snapshot bulan sebelum goal diarsipkan ga
    // kena efek ini (upsertSnapshot cuma nulis bulan berjalan, historis ga direwrite).
    goals: activeGoals().map((g) => ({
      name: g.name,
      targetAmount: Math.round(Number(g.targetAmount) || 0),
      saved: Math.round(goalSavedIDR(g.id)),
      // Field additive/opsional — nilai asset ter-link DIPISAH dari `saved` (bukan
      // di-pre-combine) biar report-md.js bisa nunjukin breakdown-nya, konsisten sama pola
      // total* mentah di snapshot lain (CAPEX, kartu kredit). Snapshot lama fallback ke 0.
      linkedValue: Math.round(goalLinkedAssetsValueIDR(g.id)),
      targetDate: g.targetDate || null,
    })),
    rate,
  };

  await setDoc(docRef("snapshots", m), {
    month: m,
    totalCash: Math.round(totalCashIDR()),
    totalAssets: Math.round(totalAssetsIDR()),
    totalCapex: Math.round(totalCapexIDR()),
    totalGoalSavings: Math.round(totalGoalSavingsIDR()),
    totalDebt: Math.round(totalDebtIDR()),
    netWorth: Math.round(netWorthIDR()),
    breakdown,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ================= Backfill CAPEX ke Snapshot Lama =================
// Snapshot yang dibuat SEBELUM fitur CAPEX ada ga punya field `totalCapex` (undefined) — bikin
// chart Tren Net Worth/Proyeksi & report-md.js section 1/10 nampilin garis/angka "+ CAPEX" dan
// "tanpa CAPEX" IDENTIK buat bulan-bulan lama, padahal asset yang SEKARANG bertipe capex bisa aja
// udah ada waktu itu (cuma belum diklasifikasikan sebagai capex, jadi ke-hitung sebagai "assets"
// biasa). Dua fungsi ini nge-backfill `totalCapex` ke snapshot lama secara BEST-EFFORT: cocokin
// `breakdown.assets[i].symbol` snapshot itu vs symbol/name asset yang SEKARANG bertipe capex,
// jumlahin `valueIDR`-nya (angka yang BENERAN kesimpen di snapshot itu waktu itu, BUKAN dikarang)
// jadi `totalCapex` bulan tersebut. SENGAJA TIDAK mengubah `breakdown.assets[i].type` (biarin
// historisnya apa adanya, cuma tambah field top-level `totalCapex` yang dipakai buat split
// with/without CAPEX) — jadi section 6 "Investasi" report utk bulan lama TETAP ngelompokkin
// item itu ke tipe LAMA-nya (bukan pindah ke grup CAPEX), quirk kecil yang diterima demi ga
// nulis ulang breakdown historis. Snapshot TANPA breakdown (manual backfill
// `{month, netWorth, manual:true}`) DI-SKIP — ga ada data buat direkonstruksi, JANGAN ngarang.
// `previewCapexBackfill()` dipakai Setting buat preview sebelum eksekusi (pola sama
// `previewBulkDelete()`/`bulkDelete()`) — preview & eksekusi jalan LOGIC MATCHING yang sama biar
// ga drift.
function capexSymbolSet() {
  return new Set(
    state.assets.filter((a) => a.type === "capex").map((a) => (a.symbol || a.name || "").toUpperCase()).filter(Boolean)
  );
}

export function previewCapexBackfill() {
  const symbols = capexSymbolSet();
  if (symbols.size === 0) return [];
  return state.snapshots
    .filter((s) => typeof s.totalCapex !== "number" && Array.isArray(s.breakdown?.assets))
    .map((s) => {
      const matched = s.breakdown.assets.filter((a) => symbols.has((a.symbol || "").toUpperCase()));
      const totalCapex = matched.reduce((sum, a) => sum + (Number(a.valueIDR) || 0), 0);
      return { month: s.month || s.id, matchedSymbols: matched.map((a) => a.symbol), totalCapex };
    })
    .filter((r) => r.matchedSymbols.length > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function backfillCapexToSnapshots() {
  const rows = previewCapexBackfill();
  for (const r of rows) {
    await patch("snapshots", r.month, { totalCapex: r.totalCapex });
  }
  return rows.length;
}

// ================= Backup / Restore =================
const COLLECTIONS = ["accounts", "categories", "transactions", "budgets", "assets", "debts", "goals", "recurring", "snapshots"];

export async function exportAll() {
  const out = { app: "fintrack", schemaVersion: 2, exportedAt: new Date().toISOString(), data: {} };
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
  // Ga ada field schemaVersion di file (backup dari sebelum field ini ada) → anggap v1. v1 & v2
  // dua-duanya valid buat di-restore — field yang lebih baru (debtId/assetId/dll) di v1 memang
  // ga ada di row-nya, dan itu perilaku LAMA yang benar (bukan sesuatu yang perlu di-isi default).
  const schemaVersion = backup.schemaVersion || 1;
  if (schemaVersion > 2) {
    throw new Error("Backup dari versi app lebih baru. Update app dulu (Setting → Hard Refresh) baru import.");
  }

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
  const assetTxs = scope.transactions.filter((t) => t.assetId);
  const affectedAssetNames = [...new Set(assetTxs.map((t) => {
    const a = state.assets.find((x) => x.id === t.assetId);
    return a ? (a.symbol || a.name) : "?";
  }))];
  return {
    transactions: scope.transactions.length,
    budgets: scope.budgets.length,
    snapshots: scope.snapshots.length,
    totalExpense, totalIncome,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    assetTxCount: assetTxs.length,
    affectedAssetNames,
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

  // Efek qty asset dari transaksi beli/jual — pola sama debt: agregasi per
  // asset dulu (netQty = Σ beli − Σ jual), baru SATU patch() di akhir, bukan hook per transaksi.
  // avgBuyPrice SENGAJA GA di-reverse (sama seperti hapus 1 transaksi via remove(), lihat
  // applyAssetQtyEffect). Skip total kalau includeMaster — assets-nya sendiri toh ikut kehapus.
  if (!includeMaster) {
    const assetAgg = {}; // assetId -> netQty (Σ beli − Σ jual)
    for (const t of scope.transactions) {
      if (!t.assetId) continue;
      const qty = Number(t.assetQty) || 0;
      assetAgg[t.assetId] = (assetAgg[t.assetId] || 0) + (t.assetDir === "buy" ? qty : -qty);
    }
    for (const [assetId, netQty] of Object.entries(assetAgg)) {
      const asset = state.assets.find((a) => a.id === assetId);
      if (!asset) continue; // asset-nya udah kehapus duluan
      const newQty = Math.max(0, (Number(asset.quantity) || 0) - netQty);
      await patch("assets", assetId, { quantity: newQty });
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

// Health check integritas data (TASK-8) — scan READ-ONLY, JANGAN auto-fix. Fungsi murni
// (cuma butuh `state`, sama kayak js/calc.js), dipanggil dari sheet "🩺 Cek Integritas Data"
// di Setting. Referensi yatim baru bisa kejadian kalau entity dihapus lewat luar app (mis.
// Firestore console langsung) — guard normal di app (accounts.js, goals.js, dll) udah nyegah
// ini lewat UI biasa.
import { monthOf } from "./utils.js";
import { accountBalances, isCreditAccount, creditUsed } from "./calc.js";

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

export function scanIntegrity(state) {
  const issues = [];

  for (const t of state.transactions) {
    const problems = [];
    if (!state.accounts.find((a) => a.id === t.accountId)) problems.push("akun ga ketemu");

    if (t.type === "transfer") {
      if (t.toAccountId && t.toAccountId === t.accountId) problems.push("akun asal & tujuan sama");
      if (t.toAccountId && !state.accounts.find((a) => a.id === t.toAccountId)) problems.push("akun tujuan ga ketemu");
      if (t.toGoalId && !state.goals.find((g) => g.id === t.toGoalId)) problems.push("goal (topup) ga ketemu");
      if (t.fromGoalId && !state.goals.find((g) => g.id === t.fromGoalId)) problems.push("goal (pencairan) ga ketemu");
      if (t.assetId) {
        if (!state.assets.find((a) => a.id === t.assetId)) problems.push("asset ga ketemu");
        if (!(Number(t.assetQty) > 0) || !(Number(t.assetPrice) > 0) || (t.assetDir !== "buy" && t.assetDir !== "sell")) {
          problems.push("assetQty/assetPrice/assetDir kosong atau invalid");
        }
      }
    } else if (t.categoryId && !state.categories.find((c) => c.id === t.categoryId)) {
      problems.push("kategori ga ketemu");
    }

    if (t.debtId && !state.debts.find((d) => d.id === t.debtId)) problems.push("debt ga ketemu");
    if (!(Number(t.amount) > 0)) problems.push("nominal ≤ 0");

    if (t.date) {
      const txTime = new Date(t.date + "T00:00:00").getTime();
      if (!isNaN(txTime) && txTime - Date.now() > ONE_YEAR_MS) problems.push("tanggal > 1 tahun ke depan");
      if (t.month && monthOf(t.date) !== t.month) problems.push(`month ("${t.month}") ga cocok sama date ("${t.date}")`);
    }

    if (problems.length > 0) issues.push({ kind: "transaction", ref: t, problems });
  }

  for (const b of state.budgets) {
    if (!state.categories.find((c) => c.id === b.categoryId)) {
      issues.push({ kind: "budget", ref: b, problems: ["kategori ga ketemu"] });
    }
  }

  // Konsistensi assets.quantity vs jejak transaksi ber-assetId. Asset TANPA transaksi sama
  // sekali TIDAK di-flag — itu posisi lama pra-fitur beli/jual yang legit manual. Finding-nya
  // informatif, bukan tuduhan: selisih bisa sengaja (posisi lama + transaksi baru bercampur).
  for (const a of state.assets) {
    const assetTxs = state.transactions.filter((t) => t.type === "transfer" && t.assetId === a.id);
    if (assetTxs.length === 0) continue;
    const netQty = assetTxs.reduce((sum, t) => {
      const qty = Number(t.assetQty) || 0;
      return sum + (t.assetDir === "sell" ? -qty : qty);
    }, 0);
    const recorded = Number(a.quantity) || 0;
    const diff = recorded - netQty;
    if (Math.abs(diff) < 0.0001) continue; // toleransi floating point
    const unit = a.type === "stock_id" ? "lot" : a.type === "stock_us" ? "sh" : "unit";
    const fmt = (n) => Number(n.toFixed(4));
    issues.push({
      kind: "asset",
      ref: a,
      problems: [`tercatat ${fmt(recorded)} ${unit}, jejak transaksi ${fmt(netQty)} ${unit}, selisih ${fmt(Math.abs(diff))} ${unit} — perlu dicek`],
    });
  }

  // Kartu kredit: over-limit / saldo plus tak terduga. Read-only INFO, BUKAN error — over-limit
  // udah di-toast pas transaksi disimpan (tx-sheet.js), ini jalur lain buat ngecek belakangan
  // (mis. abis reconcile, hapus transaksi lama, atau limit diturunin manual).
  const bal = accountBalances(state);
  for (const a of state.accounts) {
    if (!isCreditAccount(a) || a.isArchived) continue;
    const used = creditUsed(a, bal);
    const limit = Number(a.creditLimit) || 0;
    const problems = [];
    if (limit > 0 && used > limit) {
      problems.push(`over limit — terpakai ${used.toLocaleString("id-ID")} dari limit ${limit.toLocaleString("id-ID")}`);
    }
    const balance = bal[a.id] || 0;
    if (balance > 0) problems.push("saldo kartu plus — mungkin kelebihan bayar / salah reconcile");
    if (problems.length > 0) issues.push({ kind: "account", ref: a, problems });
  }

  // Goal <-> Asset link: linkedAssetIds yang nunjuk ke asset yang udah ga ada (dihapus lewat
  // luar app). Read-only info — asset yang ilang otomatis ga kehitung lagi di
  // goalLinkedAssetsValueIDR() (filter by existing id, lihat calc.js), TAPI id-nya sendiri ga
  // di-auto-cleanup dari array, jadi ini exists biar user sadar ada referensi nyangkut.
  for (const g of state.goals) {
    const linkedIds = g.linkedAssetIds || [];
    const missing = linkedIds.filter((id) => !state.assets.find((a) => a.id === id));
    if (missing.length > 0) {
      issues.push({ kind: "goal", ref: g, problems: [`link ke ${missing.length} asset yang udah ga ada`] });
    }
  }

  return issues;
}

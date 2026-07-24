// Health check integritas data (TASK-8) — scan READ-ONLY, JANGAN auto-fix. Fungsi murni
// (cuma butuh `state`, sama kayak js/calc.js), dipanggil dari sheet "🩺 Cek Integritas Data"
// di Setting. Referensi yatim baru bisa kejadian kalau entity dihapus lewat luar app (mis.
// Firestore console langsung) — guard normal di app (accounts.js, goals.js, dll) udah nyegah
// ini lewat UI biasa.
import { monthOf } from "./utils.js";

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
      if (t.assetId && !state.assets.find((a) => a.id === t.assetId)) problems.push("asset ga ketemu");
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

  return issues;
}

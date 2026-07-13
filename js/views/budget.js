import { state, budgetsOfMonth, spentByCategory, catById } from "../store.js";
import { put, remove } from "../db.js";
import {
  fmtIDR, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, addMonths, monthLabel, fmtNum, confirmDialog,
} from "../utils.js";

export function render(root) {
  const month = state.month;
  const budgets = budgetsOfMonth(month);
  const spent = spentByCategory(month);

  const totalBudget = budgets.reduce((s, b) => s + Number(b.amount || 0), 0);
  const totalSpent = budgets.reduce((s, b) => s + (spent[b.categoryId] || 0), 0);
  // expense di kategori tanpa budget
  const unbudgeted = Object.entries(spent)
    .filter(([catId]) => !budgets.find((b) => b.categoryId === catId))
    .reduce((s, [, v]) => s + v, 0);

  root.innerHTML = `
    <div class="card">
      <div class="card-title">Budget ${monthLabel(month)}</div>
      ${budgets.length === 0 ? "" : summaryHtml(totalSpent, totalBudget)}
      <div id="budget-list"></div>
      ${budgets.length === 0 ? `<div class="empty">Belum ada budget bulan ini.</div>` : ""}
      ${unbudgeted > 0 ? `<div class="sub" style="margin-top:10px">⚠️ Ada expense ${fmtIDR(unbudgeted)} di kategori tanpa budget</div>` : ""}
    </div>
    <div class="row">
      <button id="btn-add-budget" class="btn btn-primary">＋ Set Budget</button>
      <button id="btn-copy-budget" class="btn">⧉ Salin bulan lalu</button>
    </div>
  `;

  const list = root.querySelector("#budget-list");
  budgets
    .slice()
    .sort((a, b) => (spent[b.categoryId] || 0) / (b.amount || 1) - (spent[a.categoryId] || 0) / (a.amount || 1))
    .forEach((b) => {
      const cat = catById(b.categoryId);
      const used = spent[b.categoryId] || 0;
      const pct = b.amount > 0 ? (used / b.amount) * 100 : 0;
      const cls = pct >= 100 ? "p-red" : pct >= 90 ? "p-yellow" : "p-green";
      const div = document.createElement("div");
      div.className = "budget-item";
      div.style.cursor = "pointer";
      div.innerHTML = `
        <div class="budget-top">
          <span class="budget-name">${cat?.icon || "📦"} ${escapeHtml(cat?.name || "?")}</span>
          <span class="budget-nums">${fmtIDR(used)} / ${fmtIDR(b.amount)}
            <span style="color:${pct >= 100 ? "var(--red)" : pct >= 90 ? "var(--yellow)" : "var(--muted2)"}">(${pct.toFixed(0)}%)</span>
          </span>
        </div>
        <div class="progress"><div class="${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
        <div class="sub">${b.amount - used >= 0 ? `sisa ${fmtIDR(b.amount - used)}` : `over ${fmtIDR(used - b.amount)}`}</div>`;
      div.onclick = () => openBudgetSheet(month, b);
      list.appendChild(div);
    });

  root.querySelector("#btn-add-budget").onclick = () => openBudgetSheet(month, null);
  root.querySelector("#btn-copy-budget").onclick = async () => {
    const { copied, hadPrev } = await copyBudgetFromLastMonth(month);
    if (!hadPrev) return toast("Bulan lalu belum ada budget");
    toast(copied ? `${copied} budget disalin ✓` : "Semua kategori sudah ada budgetnya");
  };
}

function summaryHtml(totalSpent, totalBudget) {
  const pct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
  const cls = pct >= 100 ? "p-red" : pct >= 90 ? "p-yellow" : "p-green";
  return `
    <div style="margin-bottom:18px">
      <div class="budget-top">
        <span class="budget-name" style="font-weight:800">TOTAL</span>
        <span class="budget-nums">${fmtIDR(totalSpent)} / ${fmtIDR(totalBudget)}</span>
      </div>
      <div class="progress" style="height:9px"><div class="${cls}" style="width:${Math.min(pct, 100)}%"></div></div>
    </div>`;
}

function openBudgetSheet(month, existing) {
  const expenseCats = state.categories.filter((c) => c.type === "expense");
  const taken = new Set(budgetsOfMonth(month).map((b) => b.categoryId));
  const options = existing
    ? expenseCats.filter((c) => c.id === existing.categoryId)
    : expenseCats.filter((c) => !taken.has(c.id));

  if (options.length === 0) return toast("Semua kategori sudah punya budget");

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Budget" : "Set Budget")}
    <label>Kategori</label>
    <select id="b-cat" ${existing ? "disabled" : ""}>
      ${options.map((c) => `<option value="${c.id}">${c.icon || ""} ${escapeHtml(c.name)}</option>`).join("")}
    </select>
    <label>Budget / bulan (Rp)</label>
    <input id="b-amount" inputmode="numeric" placeholder="0" value="${existing ? fmtNum(existing.amount) : ""}" />
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="b-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="b-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  attachThousands(el.querySelector("#b-amount"));
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#b-save").onclick = async () => {
    const categoryId = el.querySelector("#b-cat").value;
    const amount = parseAmount(el.querySelector("#b-amount").value);
    if (!amount) return toast("Isi nominal budget");
    closeSheet();
    await put("budgets", `${month}_${categoryId}`, { month, categoryId, amount });
    toast("Budget disimpan ✓");
  };

  if (existing) {
    el.querySelector("#b-delete").onclick = async () => {
      if (!confirmDialog("Hapus budget ini?")) return;
      closeSheet();
      await remove("budgets", existing.id);
      toast("Dihapus");
    };
  }
}

// Dipakai tombol "Salin bulan lalu" di atas, dan dipanggil ulang dari sheet
// "Awal Bulan" (recurring-sheet.js) — satu implementasi, jangan duplikasi.
export async function copyBudgetFromLastMonth(month) {
  const budgets = budgetsOfMonth(month);
  const prev = budgetsOfMonth(addMonths(month, -1));
  if (prev.length === 0) return { copied: 0, hadPrev: false };
  const existing = new Set(budgets.map((b) => b.categoryId));
  let copied = 0;
  for (const p of prev) {
    if (existing.has(p.categoryId)) continue;
    await put("budgets", `${month}_${p.categoryId}`, { month, categoryId: p.categoryId, amount: p.amount });
    copied++;
  }
  return { copied, hadPrev: true };
}

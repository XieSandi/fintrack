import { state, budgetsOfMonth, spentByCategory, catById, monthSummary } from "../store.js";
import { put, remove } from "../db.js";
import {
  fmtIDR, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, addMonths, monthLabel, fmtNum, confirmDialog,
} from "../utils.js";

let catChart = null;

// Palet kategorikal (urutan tetap, adjacent-pair validated buat dark surface).
// Cuma 7 slot dipakai (bukan 8) — slot ke-8 dokumentasi aslinya "red", sengaja
// di-drop karena var(--red) di app ini udah reserved buat makna "danger/over
// budget/expense" (badge, progress bar, tx amount) — kalau dipakai sebagai warna
// kategori acak bisa kebaca salah sebagai status, bukan identitas kategori.
const CAT_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9"];
const NEUTRAL_COLOR = "#64748b"; // Penyesuaian Saldo + bucket "Lainnya" — sengaja netral, bukan identitas
const MAX_CAT_SLICES = CAT_COLORS.length;

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
    <div class="card">
      <div class="card-title">🥧 Per Kategori</div>
      <div id="cat-chart-wrap"></div>
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

  renderCategoryChart(root, month);
}

// ================= Chart breakdown per kategori (TASK-6) =================
function renderCategoryChart(root, month) {
  if (catChart) { catChart.destroy(); catChart = null; }
  const wrap = root.querySelector("#cat-chart-wrap");

  const rows = Object.entries(spentByCategory(month))
    .filter(([, v]) => v > 0)
    .map(([categoryId, amount]) => ({ categoryId, amount, cat: catById(categoryId) }));

  if (rows.length === 0) {
    wrap.innerHTML = `<div class="empty">Belum ada expense bulan ini.</div>`;
    return;
  }

  const prevSpent = spentByCategory(addMonths(month, -1));

  // Penyesuaian Saldo TIDAK di-exclude — tetap tampil apa adanya (expense riil
  // yang lupa kecatat), tapi dikasih warna netral biar ga "berebut" slot warna
  // kategorikal sama kategori asli. Kategori di luar top-7 di-fold ke "Lainnya".
  const adjustment = rows.find((r) => r.categoryId === "cat_adjust_out");
  const rest = rows.filter((r) => r.categoryId !== "cat_adjust_out").sort((a, b) => b.amount - a.amount);
  const top = rest.slice(0, MAX_CAT_SLICES).map((r, i) => ({ ...r, color: CAT_COLORS[i] }));
  const overflow = rest.slice(MAX_CAT_SLICES);
  const otherAmount = overflow.reduce((s, r) => s + r.amount, 0);

  const slices = [...top];
  if (adjustment) slices.push({ ...adjustment, color: NEUTRAL_COLOR, isAdjustment: true });
  if (otherAmount > 0) {
    slices.push({
      categoryId: "__other__", amount: otherAmount, color: NEUTRAL_COLOR, isOther: true,
      cat: { icon: "📦", name: `Lainnya (${overflow.length} kategori)` },
    });
  }

  const total = slices.reduce((s, x) => s + x.amount, 0);
  const curTotal = monthSummary(month).expense;
  const prevTotal = monthSummary(addMonths(month, -1)).expense;
  const totalDeltaPct = prevTotal > 0 ? ((curTotal - prevTotal) / prevTotal) * 100 : null;

  wrap.innerHTML = `
    <div class="sub" style="margin-bottom:10px">
      Total expense: <b style="color:var(--text)">${fmtIDR(curTotal)}</b>
      ${totalDeltaPct !== null ? `<span style="color:${totalDeltaPct > 0 ? "var(--red)" : totalDeltaPct < 0 ? "var(--green)" : "var(--muted2)"}"> (${totalDeltaPct >= 0 ? "+" : ""}${totalDeltaPct.toFixed(0)}% vs bulan lalu)</span>` : ""}
    </div>
    <canvas id="chart-cat" height="200"></canvas>
    <div id="cat-legend" style="margin-top:14px"></div>
  `;

  if (!window.Chart) {
    wrap.querySelector("#cat-legend").innerHTML = `<div class="empty">Chart library belum ke-load (butuh online sekali).</div>`;
    return;
  }
  Chart.defaults.color = "#64748b";
  Chart.defaults.font.size = 10;

  catChart = new Chart(wrap.querySelector("#chart-cat"), {
    type: "doughnut",
    data: {
      labels: slices.map((s) => s.cat?.name || "?"),
      datasets: [{
        data: slices.map((s) => s.amount),
        backgroundColor: slices.map((s) => s.color),
        borderColor: "#111827",
        borderWidth: 2,
        borderRadius: 4,
      }],
    },
    options: {
      cutout: "62%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // Blur mode: angka Rupiah di canvas ga bisa di-blur via CSS (.blur-num
            // cuma jalan di DOM), jadi pas blur aktif tooltip cuma nampilin persentase.
            label: (ctx) => {
              const pct = ((ctx.parsed / total) * 100).toFixed(1);
              const blurred = document.body.classList.contains("blur-mode");
              return blurred ? ` ${pct}%` : ` Rp ${fmtNum(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  // Legend custom (bukan bawaan Chart.js) — angka lewat fmtIDR() jadi otomatis
  // ke-blur via .blur-num span, konsisten sama pola blur mode di seluruh app.
  const legend = wrap.querySelector("#cat-legend");
  slices.forEach((s) => {
    const pct = ((s.amount / total) * 100).toFixed(0);
    let deltaHtml = "";
    if (!s.isOther) {
      const prevAmt = prevSpent[s.categoryId] || 0;
      if (prevAmt > 0) {
        const d = ((s.amount - prevAmt) / prevAmt) * 100;
        deltaHtml = `<span style="color:${d > 0 ? "var(--red)" : d < 0 ? "var(--green)" : "var(--muted2)"}">${d >= 0 ? "+" : ""}${d.toFixed(0)}%</span>`;
      } else {
        deltaHtml = `<span style="color:var(--muted2)">baru</span>`;
      }
    }
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--border); font-size:12px";
    row.innerHTML = `
      <span style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
      <span style="flex:1; color:var(--muted2)">${s.cat?.icon || "📦"} ${escapeHtml(s.cat?.name || "?")}</span>
      <span style="color:var(--muted2); min-width:32px; text-align:right">${pct}%</span>
      <span style="font-weight:700; min-width:90px; text-align:right">${fmtIDR(s.amount)}</span>
      <span style="min-width:38px; text-align:right; font-size:11px">${deltaHtml}</span>`;
    legend.appendChild(row);
  });
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

  // Budget existing yang categoryId-nya udah orphan (kategori kehapus lewat luar app, lihat
  // integrity.js/TASK-8) TETAP harus bisa dibuka — kalau ngikutin `options.length === 0` biasa
  // kayak mode "tambah baru", sheet-nya ga akan kebuka sama sekali dan tombol Hapus jadi ga
  // ke-reach selamanya. Cuma mode TAMBAH (bukan existing) yang boleh diblok toast ini.
  if (!existing && options.length === 0) return toast("Semua kategori sudah punya budget");

  const el = openSheet(`
    ${sheetHead(existing ? "Edit Budget" : "Set Budget")}
    <label>Kategori</label>
    <select id="b-cat" ${existing ? "disabled" : ""}>
      ${existing && options.length === 0
        ? `<option value="${existing.categoryId}">⚠️ Kategori terhapus</option>`
        : options.map((c) => `<option value="${c.id}">${c.icon || ""} ${escapeHtml(c.name)}</option>`).join("")}
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

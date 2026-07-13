import { state, netWorthIDR } from "../store.js";
import { add, patch, remove } from "../db.js";
import {
  fmtIDR, fmtNum, escapeHtml, toast, openSheet, closeSheet, sheetHead,
  parseAmount, attachThousands, confirmDialog, monthLabel,
} from "../utils.js";

const COLORS = ["#60a5fa", "#4ade80", "#facc15", "#f87171", "#c084fc", "#fb923c", "#2dd4bf"];

export function render(root) {
  const goals = state.goals.slice().sort((a, b) => (a.targetAmount || 0) - (b.targetAmount || 0));
  const nw = netWorthIDR();

  root.innerHTML = `
    <div class="card">
      <div class="card-title">Goals / Target</div>
      <div class="sub" style="margin-bottom:4px">Progress dihitung otomatis dari Net Worth lo sekarang (${fmtIDR(nw)}). Bikin beberapa target sekaligus — misal dana darurat, DP rumah, atau target akhir tahun.</div>
      <div id="goal-list"></div>
      ${goals.length === 0 ? `<div class="empty">Belum ada goals.<br/>Tap tombol di bawah buat bikin target pertama.</div>` : ""}
    </div>
    <button id="btn-add-goal" class="btn btn-primary btn-block">＋ Tambah Goal</button>
  `;

  const list = root.querySelector("#goal-list");
  goals.forEach((g) => {
    const target = Number(g.targetAmount) || 0;
    const pct = target > 0 ? Math.max(0, Math.min(100, (nw / target) * 100)) : 0;
    const cls = pct >= 100 ? "p-green" : pct >= 50 ? "p-yellow" : "p-red";
    const div = document.createElement("div");
    div.className = "budget-item";
    div.style.cursor = "pointer";
    div.innerHTML = `
      <div class="budget-top">
        <span class="budget-name" style="color:${g.color || "#60a5fa"}">● ${escapeHtml(g.name)}</span>
        <span class="budget-nums">${pct.toFixed(0)}%</span>
      </div>
      <div class="progress"><div class="${cls}" style="width:${pct}%"></div></div>
      <div class="sub">${fmtIDR(Math.min(nw, target))} / ${fmtIDR(target)}${g.targetDate ? ` · target ${monthLabel(g.targetDate)}` : ""}</div>`;
    div.onclick = () => openGoalSheet(g);
    list.appendChild(div);
  });

  root.querySelector("#btn-add-goal").onclick = () => openGoalSheet(null);
}

function openGoalSheet(existing) {
  const g = existing || { name: "", targetAmount: "", targetDate: "", color: COLORS[state.goals.length % COLORS.length] };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Goal" : "Tambah Goal")}
    <label>Nama Goal</label>
    <input id="g-name" placeholder="cth: Dana Darurat, DP Rumah, Net Worth 2028" value="${escapeHtml(g.name)}" />
    <label>Target (Rp)</label>
    <input id="g-target" inputmode="numeric" placeholder="0" value="${g.targetAmount ? fmtNum(g.targetAmount) : ""}" />
    <label>Target bulan (opsional)</label>
    <input id="g-date" type="month" value="${g.targetDate || ""}" />
    <label>Warna</label>
    <div style="display:flex; gap:8px; margin-top:4px">
      ${COLORS.map((c) => `<span class="color-dot" data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${c === g.color ? "#fff" : "transparent"}"></span>`).join("")}
    </div>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="g-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="g-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  attachThousands(el.querySelector("#g-target"));
  el.querySelector("[data-close]").onclick = closeSheet;

  let color = g.color;
  el.querySelectorAll(".color-dot").forEach((dot) => {
    dot.onclick = () => {
      color = dot.dataset.color;
      el.querySelectorAll(".color-dot").forEach((d) => (d.style.border = "2px solid transparent"));
      dot.style.border = "2px solid #fff";
    };
  });

  el.querySelector("#g-save").onclick = async () => {
    const data = {
      name: el.querySelector("#g-name").value.trim(),
      targetAmount: parseAmount(el.querySelector("#g-target").value),
      targetDate: el.querySelector("#g-date").value || null,
      color,
    };
    if (!data.name) return toast("Isi nama goal");
    if (!data.targetAmount) return toast("Isi target nominal");
    closeSheet();
    if (existing) await patch("goals", existing.id, data);
    else await add("goals", data);
    toast("Goal disimpan ✓");
  };

  if (existing) {
    el.querySelector("#g-delete").onclick = async () => {
      if (!confirmDialog("Hapus goal ini?")) return;
      closeSheet();
      await remove("goals", existing.id);
      toast("Dihapus");
    };
  }
}

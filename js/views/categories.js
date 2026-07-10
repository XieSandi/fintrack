import { state } from "../store.js";
import { add, patch, remove } from "../db.js";
import { escapeHtml, toast, openSheet, closeSheet, sheetHead, confirmDialog } from "../utils.js";

export function render(root) {
  root.innerHTML = `
    <div class="card">
      <div class="card-title">Kategori Expense</div>
      <div id="cat-expense"></div>
    </div>
    <div class="card">
      <div class="card-title">Kategori Income</div>
      <div id="cat-income"></div>
    </div>
    <button id="btn-add-cat" class="btn btn-primary btn-block">＋ Tambah Kategori</button>
  `;

  ["expense", "income"].forEach((type) => {
    const list = root.querySelector(`#cat-${type}`);
    const cats = state.categories.filter((c) => c.type === type);
    if (cats.length === 0) list.innerHTML = `<div class="empty">Belum ada kategori</div>`;
    cats.forEach((c) => {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `<span>${c.icon || "📦"}</span><div style="flex:1;font-size:13px">${escapeHtml(c.name)}</div><span style="color:var(--muted)">›</span>`;
      div.onclick = () => openCatSheet(c);
      list.appendChild(div);
    });
  });

  root.querySelector("#btn-add-cat").onclick = () => openCatSheet(null);
}

function openCatSheet(existing) {
  const c = existing || { name: "", icon: "", type: "expense" };
  const el = openSheet(`
    ${sheetHead(existing ? "Edit Kategori" : "Tambah Kategori")}
    <div class="row">
      <div style="flex:0 0 80px"><label>Emoji</label><input id="c-icon" maxlength="4" placeholder="🍜" value="${c.icon || ""}" /></div>
      <div><label>Nama</label><input id="c-name" placeholder="cth: Kopi" value="${escapeHtml(c.name)}" /></div>
    </div>
    <label>Tipe</label>
    <select id="c-type" ${existing ? "disabled" : ""}>
      <option value="expense" ${c.type === "expense" ? "selected" : ""}>Expense</option>
      <option value="income" ${c.type === "income" ? "selected" : ""}>Income</option>
    </select>
    <div style="margin-top:18px; display:flex; gap:8px;">
      ${existing ? `<button id="c-delete" class="btn btn-danger">Hapus</button>` : ""}
      <button id="c-save" class="btn btn-primary" style="flex:1">Simpan</button>
    </div>
  `);
  el.querySelector("[data-close]").onclick = closeSheet;

  el.querySelector("#c-save").onclick = async () => {
    const data = {
      name: el.querySelector("#c-name").value.trim(),
      icon: el.querySelector("#c-icon").value.trim() || "📦",
      type: el.querySelector("#c-type").value,
    };
    if (!data.name) return toast("Isi nama kategori");
    closeSheet();
    if (existing) await patch("categories", existing.id, data);
    else await add("categories", { ...data, isPreset: false });
    toast("Kategori disimpan ✓");
  };

  if (existing) {
    el.querySelector("#c-delete").onclick = async () => {
      const used = state.transactions.some((t) => t.categoryId === existing.id);
      if (used) return toast("Kategori dipakai transaksi — ga bisa dihapus");
      if (!confirmDialog("Hapus kategori ini?")) return;
      closeSheet();
      await remove("categories", existing.id);
      toast("Dihapus");
    };
  }
}

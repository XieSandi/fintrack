# TASKS.md — Backlog Instruksi untuk Claude Code (v3)

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-1 di TASKS.md".
Kerjakan **satu task per session/branch**, urut prioritas. Baca CLAUDE.md dulu — semua
ATURAN WAJIB berlaku untuk setiap task, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Guard transaksi goal (`toGoalId`/`fromGoalId` → sheet di goals.js, bukan openTxSheet).
- Tanggal kalender pakai `toDateStr()`/`todayStr()`, JANGAN `toISOString().slice(0,10)`.
- Setelah task selesai: update CLAUDE.md (section terkait), hapus task dari TASKS.md,
  kasih ringkasan perubahan + file yang disentuh.

Di-exclude sengaja (jangan dikerjain): banner update SW (Hard Refresh cukup, single user);
arsip transaksi lama (evaluasi nanti kalau >3.000 docs).

---

## TASK-7 (P2, disarankan) — Ekstrak `js/calc.js` + smoke test

**Scope:** kalkulasi di store.js makin jadi jantung app (saldo dengan `accountId` yang perannya
flip di transaksi goal — dan nanti asset di TASK-3, goal savings, net worth yang pernah
kelupaan subtract debt). Butuh safety net minimal TANPA framework/dependency.

**Implementasi:**
- Ekstrak fungsi kalkulasi murni (`accountBalances`, `goalSavedIDR`, `totalGoalSavingsIDR`,
  `totalCashIDR`, `totalAssetsIDR`, `assetValueIDR`, `assetCostIDR`, aritmetika net worth,
  `monthSummary`, `spentByCategory`) ke modul baru `js/calc.js` yang TIDAK import firebase —
  terima `state` sebagai parameter. store.js jadi wrapper tipis yang memanggil calc.js dengan
  state global. Perilaku runtime TIDAK berubah. Masukkan `calc.js` ke `PRECACHE`.
- File `tests/calc.test.mjs`, dijalankan manual `node tests/calc.test.mjs`. JANGAN masuk
  PRECACHE (bukan runtime).
- Test cases minimum: expense/income/transfer biasa; topup goal (akun sumber turun, tidak ada
  akun naik, goal naik); pencairan goal (`accountId` = TUJUAN naik, goal turun); beli/jual asset
  kalau TASK-3 sudah jalan; net worth = cash + assets + goals − debt; `monthSummary` exclude
  transfer; saham IDX lot ×100; konversi USD × rate. Assert sederhana (throw + exit code ≠ 0).
- Tambah 1 baris di ATURAN WAJIB CLAUDE.md: "kalau menyentuh js/calc.js, jalankan
  `node tests/calc.test.mjs` sebelum selesai".

**Acceptance:** test hijau; app berjalan identik (cek manual Home/Wealth angkanya sama
persis sebelum-sesudah refactor).

---

## TASK-8 (P2, opsional) — Health check integritas data

**Scope:** referensi yatim makin mungkin terjadi seiring bertambahnya relasi (`categoryId`,
`accountId`, `toAccountId`, `toGoalId`, `fromGoalId`, `debtId`, nanti `assetId`). Recurring
sudah punya `brokenReason()`, transaksi belum.

**Implementasi:** di Setting, tombol "🩺 Cek Integritas Data" → scan semua transaksi &
budget, laporkan (read-only, JANGAN auto-fix):
- transaksi menunjuk akun/kategori/goal/debt yang tidak ada
- transaksi transfer dengan `toAccountId` = `accountId`
- budget menunjuk kategori yang tidak ada
- nominal ≤ 0 atau tanggal di masa depan yang jauh (> 1 tahun)
- `month` tidak konsisten dengan `date` (sisa bug timezone lama, kalau ada)
Tampilkan hasil sebagai list dengan tombol "Buka" ke transaksi terkait. Kalau bersih:
"Semua rapi ✓".

**Acceptance:** hapus kategori lewat Firestore console (bypass guard), jalankan cek →
transaksi terkait terlaporkan.

---

## Roadmap (belum jadi task, urutan prioritas)

1. Import CSV mutasi bank
2. Laporan tahunan (agregat 12 bulan; bisa reuse `report-md.js` dari TASK-2)
3. Enkripsi backup (Web Crypto)
4. Harga emas & NAV reksa dana: belum ada API gratis+CORS yang stabil → tetap manual


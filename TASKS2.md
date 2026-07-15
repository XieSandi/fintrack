# TASKS.md — Backlog Instruksi untuk Claude Code (v2)

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-5 di TASKS.md".
Kerjakan **satu task per session/branch**, urut prioritas. Baca CLAUDE.md dulu — semua
ATURAN WAJIB berlaku untuk setiap task, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Perhatikan guard transaksi goal (`toGoalId`/`fromGoalId` → sheet di goals.js, bukan openTxSheet).
- Setelah task selesai: update CLAUDE.md (section terkait), hapus task dari TASKS.md,
  kasih ringkasan perubahan + file yang disentuh.

Di-exclude sengaja (jangan dikerjain): banner update SW (Hard Refresh cukup, single user);
arsip transaksi lama (evaluasi nanti kalau >3.000 docs).

---

## TASK-5 (P1) — Recurring topup goal

**Scope:** template recurring untuk nabung rutin ke Short Term Goal (pola owner: structured
investing tiap gajian tgl 28).

**Implementasi:**
- Tambah pilihan tujuan "🎯 Goal" di form template recurring: type transfer dengan `toGoalId`
  (menggantikan `toAccountId`; `accountId` = akun sumber). Simpan `toGoalId` di template.
- Posting dari sheet Awal Bulan menghasilkan transaksi topup yang IDENTIK dengan hasil
  `openTopupSheet()` (field lengkap: type transfer, accountId sumber, toGoalId, tanpa
  toAccountId) — supaya guard entry point & semua kalkulasi (`goalSavedIDR`,
  `accountBalances`) bekerja tanpa perubahan.
- txRow() sudah mengarahkan transaksi ber-toGoalId ke sheet goals — verifikasi hasil posting
  recurring ikut kejaring guard itu.
- Validasi form: goal yang dipilih harus masih ada; ikutkan pengecekan referensi invalid
  dari TASK-3B (goal terhapus = template broken).

**Acceptance:**
- Template "Nabung emergency fund, tgl 28, 500rb, dari Bank Digital → Goal X" → pas
  dikonfirmasi di Awal Bulan: saldo Bank Digital turun, progress Goal X naik, TIDAK tercatat
  sebagai expense, klik transaksinya di History membuka sheet topup (bukan openTxSheet).

---

## TASK-6 (P2) — Chart breakdown expense per kategori

**Scope:** menjawab "bulan ini duit lari ke mana" — data sudah ada (`spentByCategory()`),
belum pernah divisualkan (F7 konsep awal).

**Implementasi:**
- Chart doughnut/bar horizontal per kategori untuk bulan berjalan + pembanding ringkas vs
  bulan lalu (mis. "+12%" per kategori atau total). Chart.js sudah tersedia (pola & fallback
  offline ikuti chart existing di wealth.js).
- Penempatan: tambah tab ketiga di chart-tabs card Total (Wealth) — "🥧 Per Kategori" —
  ATAU section di halaman Budget; pilih satu, jangan dua-duanya, jelaskan alasan di ringkasan.
- Exclude kategori Penyesuaian Saldo dari chart? JANGAN — tampilkan apa adanya (itu expense
  riil yang lupa kecatat), tapi boleh beri warna netral.
- Ikuti blur mode: blur-num tidak bekerja di canvas — pastikan angka besar tidak dirender
  sebagai teks HTML di luar canvas, atau sembunyikan legend values saat `body.blur-mode`.

**Acceptance:** buka tab → proporsi kategori bulan berjalan terlihat, ganti bulan via month
picker ikut berubah, offline setelah cache tetap render.

---

## TASK-7 (P2, kecil) — State "Milestone tercapai"

Saat `netWorthIDR() >= settings.targetNetWorth`: progress bar Main Milestone (card Total
Balance Home + banner Wealth — dua-duanya, satu sumber data) menampilkan state "🏆 Tercapai!"
(bar penuh, warna emas/hijau) + di Setting card Main Milestone muncul ajakan "Set milestone
berikutnya". Jangan auto-mengubah target. Handle juga target 0/kosong (jangan div-by-zero,
sembunyikan bar).

**Acceptance:** set target di bawah net worth sekarang → kedua tempat menampilkan state
tercapai; naikkan target → kembali normal.

---

## TASK-8 (P2, opsional tapi disarankan) — Smoke test kalkulasi store.js

**Scope:** fungsi kalkulasi di store.js adalah jantung app (saldo dengan accountId yang flip
peran di transaksi goal, goal savings, net worth yang pernah kelupaan subtract debt) dan
disentuh hampir tiap task di atas. Buat safety net minimal TANPA framework/dependency.

**Implementasi:**
- File `tests/calc.test.mjs`, dijalankan manual `node tests/calc.test.mjs` (JANGAN masuk
  PRECACHE sw.js / tidak dipakai runtime app).
- Karena store.js import firebase.js (SDK CDN, gagal di node), refactor ringan dulu:
  ekstrak fungsi kalkulasi murni (accountBalances, goalSavedIDR, totalGoalSavingsIDR,
  netWorth arithmetic, monthSummary, spentByCategory) ke modul baru `js/calc.js` yang
  TIDAK import firebase — terima `state` sebagai parameter. store.js jadi wrapper tipis
  yang memanggil calc.js dengan state global. Perilaku runtime TIDAK berubah.
- Test cases minimum: expense/income/transfer biasa; topup goal (akun sumber turun, tidak
  ada akun naik, goal naik); withdrawal goal (accountId = TUJUAN naik, goal turun);
  net worth = cash + assets + goals − debt; monthSummary exclude transfer; saham IDX lot ×100;
  USD × rate. Assert pakai `console.assert`/throw sederhana, exit code ≠ 0 kalau gagal.
- Tambah 1 baris di CLAUDE.md ATURAN WAJIB: "kalau menyentuh js/calc.js, jalankan
  `node tests/calc.test.mjs` sebelum selesai".

**Acceptance:** `node tests/calc.test.mjs` hijau; app berjalan identik (calc.js masuk
PRECACHE karena dipakai runtime; tests/ tidak).

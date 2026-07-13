# TASKS.md — Backlog Instruksi untuk Claude Code (v2)

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-3 di TASKS.md".
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

## TASK-3 (P1, BUG) — Recurring edge cases: tanggal 29–31 + referensi invalid

**Masalah A:** kondisi jatuh tempo `dayOfMonth ≤ hari ini` bikin template tgl 31 (atau 29/30
di Februari) TIDAK PERNAH prompt di bulan yang lebih pendek — kelewat diam-diam.

**Fix A:** saat evaluasi jatuh tempo DAN saat menentukan tanggal transaksi yang di-post,
clamp `dayOfMonth` ke hari terakhir bulan berjalan
(`effectiveDay = min(dayOfMonth, daysInMonth(bulanBerjalan))`). Buat helper `daysInMonth()`
di utils.js kalau belum ada. Terapkan konsisten di app.js (trigger), recurring-sheet.js
(posting), dan tampilan "jatuh tempo tgl X" di views/recurring.js (tampilkan tanggal efektif).

**Masalah B:** template recurring bisa menunjuk akun yang sudah DIARSIP (arsip tidak kena
guard hapus) atau kategori yang terhapus — transaksi bakal ke-post ke referensi mati
tanpa peringatan.

**Fix B:**
- Sheet Awal Bulan: item dengan `accountId`/`toAccountId` yang arsip/tidak ada, atau
  `categoryId` yang tidak ada → tampilkan ⚠️ + alasan singkat, DEFAULT TIDAK TERCENTANG,
  dan tidak bisa dicentang sampai template dibenerin.
- Halaman `#/recurring`: template broken ditandai badge merah "⚠️ akun/kategori invalid".
- Jangan blokir item lain yang sehat — tetap bisa di-post.

**Acceptance:**
- Template dayOfMonth=31, bulan berjalan 30 hari, buka app tgl 30 → item muncul di sheet,
  transaksi ke-post tanggal 30.
- Februari + template tgl 30 → ke-post tgl 28/29.
- Arsipkan akun yang dipakai template → sheet Awal Bulan menandai ⚠️ dan tidak memposting item itu.

---

## TASK-4 (P1) — Link pembayaran cicilan ke debt outstanding

**Masalah:** expense cicilan dan `debts.totalOutstanding`/`remainingMonths` adalah dua dunia
terpisah — harus update manual dua kali, gampang desync. Makin relevan karena recurring
bakal memposting expense cicilan tiap bulan sementara outstanding beku.

**Implementasi:**
- Field opsional `debtId` di transaksi expense. UI: di `openTxSheet()` (tx-sheet.js),
  KALAU type=expense DAN ada minimal 1 debt aktif → tampilkan select opsional
  "Potong hutang? (opsional)" berisi daftar debts + pilihan "—". Jangan ganggu flow
  quick-add kalau tidak dipakai.
- Field `debtId` juga di template `recurring` (form di views/recurring.js) → transaksi
  hasil posting Awal Bulan membawa `debtId`.
- Saat transaksi expense ber-`debtId` DIBUAT: `patch` debt → `totalOutstanding -= amount`
  (floor 0), `remainingMonths -= 1` (floor 0, hanya jika sebelumnya > 0).
- Saat transaksi ber-`debtId` DIHAPUS: kembalikan efeknya (outstanding += amount,
  remainingMonths += 1). Saat DIEDIT nominalnya: sesuaikan selisihnya. Kalau `debtId`
  diganti/dihapus saat edit: kembalikan ke debt lama, terapkan ke debt baru.
  Semua logic mutasi debt ini dipusatkan di satu helper di db.js (mis. `applyDebtEffect()`),
  JANGAN tersebar di tiap sheet.
- Outstanding mencapai 0 → badge "Lunas 🎉" di tab Debt (Wealth). Jangan auto-delete.
- Debt yang punya transaksi ber-`debtId` tidak bisa dihapus langsung (pola guard akun/goal) —
  atau minimal konfirmasi eksplisit bahwa link riwayatnya jadi yatim.

**Acceptance:**
- Catat expense 286.032 dengan debtId Tokopedia CC → outstanding turun 286.032,
  remainingMonths turun 1, muncul normal di History & laporan expense.
- Hapus transaksi itu → outstanding & remainingMonths balik.
- Posting recurring ber-debtId → efek sama dengan manual.
- Net worth naik-turunnya konsisten (expense mengurangi cash, outstanding berkurang —
  keduanya sudah otomatis lewat derived calc, verifikasi saja tidak dobel hitung).

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

---

## Catatan untuk CLAUDE.md (kerjakan bareng task pertama yang disentuh)

Tambahkan ke section Data Model → transactions, warning untuk fitur masa depan:
"Fitur apapun yang mengagregasi arus kas PER AKUN (laporan per akun, export CSV, dsb.)
WAJIB memeriksa `toGoalId`/`fromGoalId` untuk menentukan arah — `accountId` pada transaksi
goal bisa berarti sumber (topup) ATAU tujuan (withdrawal)."

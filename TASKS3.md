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

## TASK-3 (P1) — Link pembelian/penjualan asset ke arus kas akun

**Masalah:** `assets` dan `accounts` adalah dua dunia terpisah. Beli BBCA 10 lot dari RDN →
asset bertambah, saldo RDN TIDAK berkurang kecuali user ingat reconcile manual → net worth
ter-inflate diam-diam. Sekarang makin terasa karena "Invested" sudah dipajang di UI tapi
tidak pernah bertemu dengan arus kas manapun. Ini kelas masalah yang sama dengan link debt
(`debtId`) yang sudah selesai.

**Implementasi:**
- Flow baru "💰 Catat Pembelian" di sheet asset (dan "Catat Penjualan"): input jumlah unit +
  harga per unit + akun sumber/tujuan + tanggal.
- Efeknya: (a) update posisi asset (lihat TASK-4 untuk weighted average), (b) buat transaksi
  `type: "transfer"` dengan field baru `assetId` — akun sumber ke-debit, TIDAK ada akun tujuan
  (pola persis topup goal `toGoalId`). Penjualan = kebalikannya (`accountId` jadi akun TUJUAN).
- **JANGAN** dihitung sebagai expense/income — ini perpindahan bentuk aset, sama seperti topup
  goal. Verifikasi `monthSummary()` tidak menghitungnya.
- Update `accountBalances()` supaya paham arah `assetId` (beli vs jual — bedakan dengan field
  arah eksplisit atau dua nilai tipe, pilih yang paling sedikit ambiguitas dan dokumentasikan).
- Guard entry point (pola sama goal): transaksi ber-`assetId` HARUS dibuka lewat sheet asset,
  bukan `openTxSheet()`. Update pengecekan di `txRow()` — sekarang jadi
  `t.toGoalId || t.fromGoalId || t.assetId`.
- Asset yang punya transaksi ber-`assetId` tidak bisa dihapus langsung (pola guard existing).
- Tetap izinkan edit posisi asset manual (untuk posisi lama yang sudah ada sebelum fitur ini) —
  jangan memaksa semua asset punya jejak transaksi.
- Tambahkan peringatan di CLAUDE.md: sekarang ADA TIGA jenis transaksi dengan `accountId` yang
  perannya kondisional (`toGoalId`, `fromGoalId`, `assetId`) — agregasi arus kas per akun wajib
  cek ketiganya.

**Acceptance:**
- Catat beli 5 lot @6.000 dari RDN → saldo RDN turun Rp 3.000.000, qty asset naik 5 lot,
  net worth TIDAK berubah (cash turun, asset naik senilai sama), income/expense bulan itu
  tidak berubah.
- Catat jual → kebalikannya.
- Klik transaksi tersebut di History membuka sheet asset, bukan openTxSheet.

---

## TASK-4 (P1, kecil) — Weighted average buy otomatis

**Masalah:** `avgBuyPrice` diinput manual. Nambah lot berarti user hitung weighted average
sendiri di kalkulator — rawan salah, dan salahnya langsung merusak angka Invested + P&L yang
sekarang dipajang di tab Assets.

**Implementasi:**
- Di flow "Catat Pembelian" (TASK-3, kerjakan setelahnya atau digabung kalau agent menilai
  lebih rapi): setelah input qty + harga beli baru, hitung otomatis
  `avgBaru = (qtyLama × avgLama + qtyBaru × hargaBaru) / (qtyLama + qtyBaru)`, tampilkan
  preview "Avg buy: 6.710 → 6.520" sebelum simpan.
- Penjualan: qty berkurang, `avgBuyPrice` TIDAK berubah (konvensi standar), realized P&L
  tidak dilacak di v1 — cukup catat di note transaksi. Dokumentasikan keputusan ini.
- Konsisten dengan konvensi lot: untuk `stock_id`, qty dalam LOT (×100 saat hitung nilai) —
  pastikan perhitungan average pakai satuan yang sama, jangan campur lot dan lembar.

**Acceptance:** punya 10 lot avg 6.710, beli 5 lot @6.000 → qty 15, avg jadi 6.473,33
(verifikasi manual), Invested & P&L ikut menyesuaikan.

---

## TASK-5 (P1) — Recurring topup goal

**Scope:** template recurring untuk nabung rutin ke Short Term Goal (pola owner: nabung tiap
gajian tgl 28). Saat ini `recurring` hanya punya `toAccountId`, belum bisa ke goal.

**Implementasi:**
- Tambah pilihan tujuan "🎯 Goal" di form template recurring: type transfer dengan `toGoalId`
  (menggantikan `toAccountId`; `accountId` = akun sumber). Simpan `toGoalId` di template.
- Posting dari sheet Awal Bulan menghasilkan transaksi topup yang IDENTIK dengan hasil
  `openTopupSheet()` (type transfer, accountId sumber, toGoalId, tanpa toAccountId) — supaya
  guard entry point & semua kalkulasi (`goalSavedIDR`, `accountBalances`) bekerja tanpa perubahan.
- Ikutkan goal ke pengecekan `brokenReason()` (goal terhapus = template broken, checkbox
  disabled + badge merah), konsisten dengan penanganan akun/kategori/debt yang sudah ada.
- Verifikasi hasil posting ikut kejaring guard di `txRow()`.

**Acceptance:**
- Template "Nabung dana darurat, tgl 28, 500rb, dari Bank Digital → Goal X" → dikonfirmasi di
  Awal Bulan: saldo Bank Digital turun, progress Goal X naik, TIDAK tercatat sebagai expense,
  klik transaksinya di History membuka sheet topup.
- Hapus Goal X → template ditandai broken, tidak bisa di-post.

---

## TASK-6 (P2, kecil) — State "Milestone tercapai"

Saat `netWorthIDR() >= settings.targetNetWorth`: progress bar Main Milestone (card Total
Balance Home + banner Wealth — dua-duanya, satu sumber data) menampilkan state "🏆 Tercapai!"
(bar penuh, warna emas/hijau) + di Setting card Main Milestone muncul ajakan "Set milestone
berikutnya". Jangan auto-mengubah target. Handle target 0/kosong (jangan div-by-zero,
sembunyikan bar).

**Acceptance:** set target di bawah net worth sekarang → kedua tempat menampilkan state
tercapai; naikkan target → kembali normal.

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

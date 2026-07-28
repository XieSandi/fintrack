# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-G di TASKS.md".
Kerjakan **satu task per session/branch**, urut prioritas. Baca CLAUDE.md dulu — semua
ATURAN WAJIB berlaku untuk setiap task, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Tanggal kalender pakai `toDateStr()`/`todayStr()`, JANGAN `toISOString().slice(0,10)`.
- Kalkulasi murni taruh di `js/calc.js` + test case; kalau nyentuh calc.js jalankan
  `node tests/calc.test.mjs` (harus hijau).
- Guard transaksi khusus (`assetId` → sheet asset; `toGoalId`/`fromGoalId` → sheet goal;
  bukan `openTxSheet()` generik).
- Setelah task selesai: update CLAUDE.md (section terkait), hapus task dari TASKS.md,
  kasih ringkasan perubahan + file yang disentuh.

**Di-exclude sengaja (jangan dikerjain):** banner update SW (Hard Refresh cukup, single user);
arsip transaksi lama (evaluasi nanti kalau >3.000 docs).

---

## TASK-G (P2) — Recurring DCA beli asset (pola reminder, bukan auto-post)

**Masalah:** recurring belum bisa DCA beli asset — padahal pola nabung rutin owner (SPY/VOO
tiap bulan).

**Keputusan desain WAJIB diikuti:** item ini **tidak boleh auto-post** seperti item lain — harga
beli beda tiap bulan, `quantity` turunan dari harga aktual. Auto-post akan mengarang qty. Bentuk
benar: **reminder yang membuka sheet beli asset dengan nominal ter-prefill.**

**Implementasi:**
- Field baru template `recurring`: `assetId` (+ `amount` = nominal rupiah biasa). Toggle tujuan
  jadi tiga: Akun / 🎯 Goal / 📈 Asset.
- Sheet Awal Bulan: item tipe asset **tidak punya checkbox "catat"**. Tampilkan sebagai baris
  terpisah dengan tombol "Catat pembelian →" → `openAssetBuySheet(asset, {prefillAmount,
  prefillAccountId, prefillDate})`. Label kecil: "harga beli beda tiap bulan, jadi diisi manual".
- `lastPostedMonth` di-set **hanya kalau transaksi beli benar-benar tersimpan** (callback sukses
  dari sheet), bukan saat tombol diklik. User batal → item tetap belum di-post, muncul lagi nanti.
- Kalau item asset adalah SATU-SATUNYA yang jatuh tempo, sheet tetap muncul; sesuaikan copy
  tombol/empty state supaya "Catat Semua" (hanya untuk item bercentang) tak membingungkan.
- Masukkan `assetId` ke `brokenReason()` (asset terhapus = broken, badge merah, tak bisa diklik).
- Jangan buat jalur penulisan transaksi asset baru — penulis tetap `openAssetBuySheet()` (weighted
  average + guard txRow tak terduplikasi).

**Acceptance:**
- Template "DCA VOO, tgl 28, Rp 1jt, dari Bank Digital" → di sheet Awal Bulan jadi baris
  ber-tombol; klik → sheet beli asset terbuka, nominal & akun ter-prefill, tanggal = effective day.
- Simpan pembelian → qty & avg buy ter-update, saldo akun turun, `lastPostedMonth` ter-set, item
  hilang bulan itu.
- Batal sheet → `lastPostedMonth` TIDAK berubah, item muncul lagi.
- Hapus asset → template ditandai broken.

---

## Urutan eksekusi yang disarankan

1. ~~TASK-A~~, ~~TASK-B~~, ~~TASK-C~~, ~~TASK-D~~, ~~TASK-E~~, ~~TASK-F~~ — udah beres (lihat git
   history / CLAUDE.md bullet "Efek samping transaksi ber-`debtId`/`assetId`", "Cek Integritas
   Data", ATURAN WAJIB #9, section Arsitektur, bullet `snapshots`, "Export Laporan (.md)", dan
   bullet `settings/main` buat pace Main Milestone).
2. **TASK-G** — enhancement, tidak mendesak, satu-satunya yang tersisa.

## Roadmap (belum jadi task aktif)

1. Arsip transaksi lama (evaluasi kalau > 3.000 docs / load lambat).
2. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
3. Harga emas & NAV reksa dana: belum ada API gratis+CORS stabil → tetap manual.
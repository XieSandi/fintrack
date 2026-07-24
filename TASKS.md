# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-N di TASKS.md"
(ganti N dengan nomor task yang mau dikerjain). Kerjakan **satu task per session/branch**,
urut prioritas. Baca CLAUDE.md dulu — semua ATURAN WAJIB di sana berlaku buat setiap task,
terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk array `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Guard transaksi goal/asset (`toGoalId`/`fromGoalId`/`assetId` → sheet khususnya di
  goals.js/wealth.js, BUKAN `openTxSheet()` generik).
- Tanggal kalender pakai `toDateStr()`/`todayStr()` (utils.js), JANGAN `toISOString().slice(0,10)`.
- Kalau nyentuh `js/calc.js`, jalankan `node tests/calc.test.mjs` sebelum selesai — harus hijau.
- Setelah task selesai: update CLAUDE.md (section terkait), hapus task ini dari file ini,
  kasih ringkasan perubahan + file yang disentuh.

Di-exclude sengaja (jangan dikerjain sebagai task): banner notifikasi update SW — single user,
tombol Hard Refresh di Setting udah cukup.

---

Ga ada task aktif per 2026-07-24 — semua yang pernah ditulis di sini (dan di TASKS2.md/TASKS3.md,
sekarang udah dihapus karena isinya sudah dikerjakan semua & ke-join ke sini) udah kelar.
Riwayat task lama masih ada di git history kalau butuh detail spec-nya lagi.

## Roadmap (belum jadi task, urutan prioritas)

1. **Arsip transaksi lama** — `store.js` (lewat `startListeners()`) listen SEMUA transaksi
   selamanya via `onSnapshot`. Aman sampai ±3–5rb docs; setelah itu initial load di HP mulai
   berat. Kandidat solusi: arsip transaksi > 2 tahun ke collection `transactions_archive` +
   export file, baru query transaksi aktif dibatasi rentang waktu. **Jangan dikerjain
   sekarang** — evaluasi kalau jumlah transaksi udah > 3.000 docs atau load mulai kerasa lambat.
2. Import CSV mutasi bank.
3. Laporan tahunan (agregat 12 bulan; bisa reuse `js/report-md.js`).
4. Enkripsi backup (Web Crypto).
5. Harga emas & NAV reksa dana — belum ada API gratis+CORS yang stabil → tetap manual.

# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-N di TASKS.md"
(ganti N dengan nomor task yang mau dikerjain).
Kerjakan **satu task per session/branch**. Baca CLAUDE.md dulu — semua ATURAN WAJIB di sana
berlaku untuk setiap task di sini, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk array `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Setelah task selesai: update CLAUDE.md (section terkait + hapus task ini dari TASKS.md),
  lalu kasih ringkasan perubahan + file yang disentuh.

Yang SENGAJA di-exclude dari backlog (jangan dikerjain): banner notifikasi update SW —
single user, tombol Hard Refresh di Setting udah cukup.

---

## TASK-7 (P2, catatan arsitektur — belum eksekusi)

`store.js` listen SEMUA transaksi selamanya. Aman sampai ±3–5rb docs; setelah itu initial load
di HP mulai berat. Kandidat solusi saat dibutuhkan: arsip transaksi > 2 tahun ke collection
`transactions_archive` + export file. Jangan dikerjakan sekarang — evaluasi kalau jumlah
transaksi sudah > 3.000 atau load terasa lambat.

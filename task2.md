# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu jelasin task barunya kalau ada. Baca
CLAUDE.md dulu — semua ATURAN WAJIB berlaku untuk setiap task, terutama:

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

Ga ada task aktif per 2026-07-31 — TASK-A s/d TASK-G semua udah beres (lihat git history /
CLAUDE.md bullet-bullet terkait: "Efek samping transaksi ber-`debtId`/`assetId`", "Cek
Integritas Data", ATURAN WAJIB #9, section Arsitektur, bullet `snapshots`, "Export Laporan
(.md)", bullet `settings/main` buat pace Main Milestone, dan bullet `recurring` buat DCA beli
asset).

## Roadmap (belum jadi task aktif)

1. Arsip transaksi lama (evaluasi kalau > 3.000 docs / load lambat).
2. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
3. Harga emas & NAV reksa dana: belum ada API gratis+CORS stabil → tetap manual.

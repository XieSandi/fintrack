# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-N di TASKS.md".
Kerjakan **satu task per session/branch**, urut prioritas. Baca CLAUDE.md dulu — semua
ATURAN WAJIB berlaku, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk user input yang masuk innerHTML.
- Tanggal kalender pakai `toDateStr()`/`todayStr()`, JANGAN `toISOString().slice(0,10)`.
- Kalkulasi murni di `js/calc.js` (terima `state`/param eksplisit termasuk `nowMonth`/tanggal,
  JANGAN baca wall-clock di dalam calc) + test case; kalau nyentuh calc.js jalankan
  `node tests/calc.test.mjs` (harus hijau).
- Angka di file/teks (report) pakai `fmtIDRPlain()`, BUKAN `fmtIDR()` (yang bungkus blur-num).
- Guard transaksi khusus (`assetId`/`toGoalId`/`fromGoalId` → sheet masing-masing, bukan
  `openTxSheet()`).
- Setelah selesai: update CLAUDE.md (+ DECISIONS.md kalau ada keputusan arsitektur), lalu
  **HAPUS** task-nya dari TASKS.md (bukan dicoret/diarsipin — riwayatnya udah ada di dua file
  itu), kasih ringkasan perubahan + file yang disentuh.

Ga ada task aktif di backlog sekarang.

Task yang udah selesai SENGAJA ga diarsipin di sini — biar file ini murni backlog. Riwayat
"kenapa"-nya ada di `DECISIONS.md`, aturan operasional yang berlaku sekarang ada di `CLAUDE.md`.
Lihat Roadmap di bawah buat kandidat berikutnya (belum jadi task resmi).

## Roadmap (kandidat, belum task)

1. Realized P&L saat jual asset (termasuk capital gain bond pasar sekunder).
2. `avgSurplus3m` tahan outlier (median / exclude bonus-THR) — relevan buat pace & proyeksi.
3. `milestonePaceLine()` blur-mode leak (pisah angka mentah dari string) — pas nyentuh area itu.
4. CAPEX integrity (purchaseDate masa depan, depreciationPctMonth di luar 0–1).
5. Chart **Tren Net Worth** & **Income vs Expense** belum ikut blur mode (baru chart Proyeksi yang
   ikut, lewat tick callback `isBlurred()`) — canvas ga kena CSS `.blur-num`, jadi harus per-chart.
6. Import CSV mutasi; laporan tahunan; enkripsi backup.
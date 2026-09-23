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
   **Gabung sama #9** (bias surplus) jadi SATU task — dua-duanya ngerombak `recentAvgSurplus()`,
   jangan dikerjain terpisah biar fungsinya ga dibongkar dua kali.
3. `milestonePaceLine()` blur-mode leak (pisah angka mentah dari string) — pas nyentuh area itu.
4. CAPEX integrity (purchaseDate masa depan, depreciationPctMonth di luar 0–1).
5. Import CSV mutasi; laporan tahunan; enkripsi backup.
6. Claim/Hutang: pembayaran Claim masuk cashflow (opsional, sekarang sengaja transfer — lihat
   `DECISIONS.md` "Piutang v2"); foto bukti buat semua transaksi (butuh evaluasi Storage).
7. Arsip transaksi lama — `store.js` listen SEMUA transaksi selamanya via `onSnapshot`, aman
   sampai ±3–5rb docs. Transaksi biaya (`feeOfTxId`) nambah dokumen ~2x buat transaksi ber-biaya,
   jadi evaluasi lebih cepat: kalau > 3.000 docs atau load mulai lambat.
8. Harga emas & NAV reksa dana: BELUM ada API gratis+CORS yang stabil → tetap manual.
9. **Bias surplus (dari review 2026-09):** `recentAvgSurplus()` = income − expense, dan cicilan
   hutang dicatat expense → bayar pokok cicilan nurunin surplus padahal net worth tetap. Pace
   milestone & proyeksi ngeremehin laju net worth sebesar pokok cicilan/bln. Kandidat fix: pakai
   Δ net worth antar-snapshot sebagai kontribusi bulanan, atau tambahin balik pembayaran ber-
   `debtId` ke surplus. Kerjain SEBELUM nyentuh fitur pace/proyeksi lagi, BARENG #2.
10. Hook `db.js` (applyDebtEffect/applyAssetQtyEffect/agregasi bulkDelete) belum ke-test —
    pindahin keputusan "efek apa buat transaksi X" + agregasi per-entity ke `calc.js` (pure),
    hook tinggal eksekusi hasilnya.
11. Snapshot bulan yang kelewat bisa direkonstruksi SEBAGIAN dari jurnal (cash per akun, outstanding
    hutang, goal savings — semua derivable buat tanggal manapun; cuma harga asset yang ga bisa).
    Backfill "Snapshot Historis" bisa diisi breakdown beneran, bukan cuma satu angka manual.
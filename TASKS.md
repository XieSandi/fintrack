# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-1 di TASKS.md".
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
- Setelah selesai: update CLAUDE.md (+ DECISIONS.md kalau ada keputusan arsitektur),
  hapus task dari TASKS.md, kasih ringkasan perubahan + file yang disentuh.

Ga ada task aktif di backlog sekarang — semua (TASK-1 s/d TASK-4) udah dikerjain, ringkasan di
bawah. Lihat Roadmap di bagian bawah buat kandidat berikutnya (belum jadi task resmi).

---

~~TASK-4~~ — udah dikerjain: asset type baru `bond` (Obligasi/SBN Ritel — ORI/SR/SBR/ST). Nilai
default par (`principal`, field baru, BUKAN reuse `avgBuyPrice`), `manualPrice` opsional buat
harga pasar sekunder ABSOLUT (bukan qty×harga/unit). `quantity` dipaksa 1, `currency` dipaksa
IDR, `symbol` direuse jadi "Series Name". Kupon (`couponRatePA`/`couponPeriodMonths`/
`couponAccountId`) SENGAJA TIDAK dihitung/auto-post otomatis (pajak PPh final 10%, pembulatan,
timing mutasi RDN — riwayat lengkap: DECISIONS.md) — cuma `bondNextCouponHint()` informatif buat
bantu UI, tombol "💰 Catat Kupon Masuk" = income transaksi biasa TANPA assetId. "🏁 Cairkan
Pokok" = transfer ber-assetId+`assetDir:"redeem"` (arah BARU, extend db.js
`applyAssetQtyEffect()` buat reversal-nya + fix false-positive di integrity.js yang ketangkep
pas nulis ini) + flag `redeemed:true` (bond ilang dari list aktif, dokumennya tetap ada).
Integrasi recurring SENGAJA DI-SKIP (diputuskan, bukan kelupaan — alasan: CLAUDE.md bullet
`recurring`). report-md.js section 6 dapet kolom bond-specific + ringkasan pokok/kupon/maturity.
integrity.js dapet 3 check baru (overdue redeem, principal/rate invalid, tanggal salah). Field
semua additive — schemaVersion TIDAK naik. Riwayat lengkap: `DECISIONS.md`. Aturan sekarang:
CLAUDE.md bullet `assets` tipe `bond`.

~~TASK-1~~ — udah dikerjain: "Perubahan komposisi" report ga sum ke Δ net worth ternyata 2 bug
independen (CAPEX double count + sign Debt kebalik). Fix: `netWorthComposition()` (calc.js, pure,
di-test pakai angka asli laporan Agustus 2026 sebagai regression test) — return semua komponen
SEBAGAI KONTRIBUSI siap-jumlah (assets exclude CAPEX, debt udah dinegasi), `total` dihitung
LANGSUNG dari `netWorthFromParts()`. Section 10 report-md.js sekarang pakai pasangan bulan yang
SAMA kayak Δ net worth section 1, jadi dua angka itu sekarang identik (dulu beda ±Rp1). Riwayat
lengkap & angka pembuktian bug: `DECISIONS.md`. Aturan sekarang: CLAUDE.md bullet
`report-md.js`.

~~TASK-3~~ — udah diinvestigasi, **BUKAN bug, kode ga diubah**: utang CC Rp 3.210.581 (Tokopedia
2.675.246 + Nex 535.335) vs expense Agustus cuma Rp 560.950 — dicek pakai export Agt 2026 asli.
Pembuktian: expense Agustus (SEMUA akun digabung, section 2 report) cuma Rp 560.950, jadi
walaupun 100% expense itu ke CC, MINIMAL Rp 2.649.631 (82,5% dari total utang CC) ga mungkin
dari transaksi Agustus — harus dari `initialBalance` pas akun Tokopedia/Nex Card dibuat (utang
CC beneran yang udah ada sebelum mulai pakai app 1 Agustus, sesuai konfirmasi owner). Audit kode
(`accountBalances()` calc.js + grep `patch("accounts", ...)` across `js/`): saldo akun 100% derived
dari jurnal (`initialBalance ± transaksi`), **CUMA SATU** jalur nulis `initialBalance` (form Edit
Akun, `accounts.js` save handler) — TIDAK ADA jalur lain yang bisa ubah balance CC tanpa bikin
transaksi. Reconcile (`openReconcileSheet`) & "💳 Bayar Tagihan" (`openPayCreditSheet`) dua-duanya
bikin transaksi biasa (expense/income `cat_adjust_out`/`cat_adjust_in`, atau transfer) lewat
`add("transactions",...)` generik — dikonfirmasi juga dari data asli (section 3 report nunjukin
baris real "⚖️ Penyesuaian Saldo Rp 17.000" Agustus, bukti mekanisme reconcile emang lewat
transaksi normal). Kesimpulan: TIDAK ADA jalur yang mengubah balance CC tanpa transaksi — akun
credit sehat. Riwayat lengkap & perhitungan: `DECISIONS.md`.

~~TASK-2~~ — udah dikerjain: goal savings "Rp 0" (section 1) vs "Terkumpul Rp 512.542" (section
8) itu BUKAN bug kalkulasi (goal savings net worth SENGAJA cuma tunai, biar ga double-count sama
Assets) — murni gap tampilan, angka gabungan (tunai+aset) ditampilin tanpa breakdown yang cukup
jelas di tempat yang butuh. Fix: breakdown eksplisit tunai vs aset di SEMUA tempat goal
ditampilkan — `goals.js` list (2 baris: breakdown + catatan likuiditas), `home.js` preview (baris
kecil), `report-md.js` section 1 (baris Goal savings nambah keterangan asset-linked) & section 8
(header kolom "Terkumpul (tunai+aset)" + catatan kaki). Keputusan progress bar (tunai+aset)
DIPERTAHANKAN (bukan diubah ke tunai-doang) tapi sekarang didokumentasikan eksplisit. Net
worth/`calc.js` SAMA SEKALI ga disentuh (murni tampilan, verifikasi: cuma 3 file view/report yang
diedit). Riwayat lengkap: `DECISIONS.md`. Aturan sekarang: CLAUDE.md bullet `goals` (paragraf
"Progress bar/pct/`progress` SENGAJA...") + bullet `report-md.js` (Section 8/section 1).

## Roadmap (kandidat, belum task)

1. Realized P&L saat jual asset (termasuk capital gain bond pasar sekunder).
2. `avgSurplus3m` tahan outlier (median / exclude bonus-THR) — relevan buat pace & proyeksi.
3. `milestonePaceLine()` blur-mode leak (pisah angka mentah dari string) — pas nyentuh area itu.
4. CAPEX integrity (purchaseDate masa depan, depreciationPctMonth di luar 0–1).
5. Import CSV mutasi; laporan tahunan; enkripsi backup.
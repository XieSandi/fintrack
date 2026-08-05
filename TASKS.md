# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-N di TASKS.md"
(ganti N dengan nomor task). Kerjakan **satu task per session/branch**, urut prioritas. Baca CLAUDE.md dulu — semua
ATURAN WAJIB berlaku untuk setiap task, terutama:

- Naikin `CACHE_VERSION` di `sw.js` setiap ada perubahan file; file baru masuk `PRECACHE`.
- Semua akses Firestore lewat `js/db.js`. View re-render via `store.on()`, jangan manual DOM.
- `escapeHtml()` untuk semua user input yang masuk innerHTML.
- Tanggal kalender pakai `toDateStr()`/`todayStr()`, JANGAN `toISOString().slice(0,10)`.
- Kalkulasi murni taruh di `js/calc.js` (terima `state`/param eksplisit, JANGAN baca wall-clock
  di dalam calc — kirim `nowMonth`/tanggal dari caller) + test case; kalau nyentuh calc.js
  jalankan `node tests/calc.test.mjs` (harus hijau).
- Guard transaksi khusus (`assetId` → sheet asset; `toGoalId`/`fromGoalId` → sheet goal;
  bukan `openTxSheet()` generik).
- Angka di file/teks (bukan DOM) pakai `fmtIDRPlain()`/`fmtMoneyPlain()`, BUKAN `fmtIDR()`
  (yang terakhir bungkus `<span class="blur-num">`).
- Setelah task selesai: update CLAUDE.md (section terkait), hapus task dari TASKS.md,
  kasih ringkasan perubahan + file yang disentuh.

**Di-exclude sengaja (jangan dikerjain):** banner update SW (Hard Refresh cukup, single user);
arsip transaksi lama (masih aman < 3.000 docs).

**Task bertanda [VERIFIKASI]:** cek dulu kondisi kode. Kalau ternyata sudah benar, JANGAN ubah
kode — cukup betulkan CLAUDE.md biar akurat + catat "sudah benar" di ringkasan.

---

Ga ada task aktif per 2026-08-04 — TASK 1 (Akun tipe Kartu Kredit) udah beres: type `credit` +
`creditLimit` di accounts, helper murni di calc.js (`isCreditAccount`/`creditUsed`/
`creditRemaining`/`totalCreditDebtIDR`, semua di-test), tampilan Terpakai/Limit/Sisa (bukan
saldo signed) di accounts.js + breakdown Total & tab Liquid Wealth, shortcut "💳 Bayar Tagihan"
(transfer generic pre-filled), warning over-limit non-blocking di tx-sheet.js, section Akun +
baris ringkasan CC di report-md.js, `creditLimit` ikut ke-snapshot, dan 2 check baru (over-limit
/ saldo plus) di Cek Integritas Data. Info silang CC di tab Debt SENGAJA di-skip (keputusan &
alasannya ada di CLAUDE.md bullet `accounts` tipe `credit`). CC net worth-nya lewat cash path
(`totalCashIDR()`), BUKAN debt path — `totalDebtIDR()` ga disentuh sama sekali.

## Roadmap (belum jadi task aktif — kandidat, butuh keputusan/kebutuhan nyata dulu)

1. **Realized P&L tracking.** Jual asset sekarang cuma turunin qty, avg buy tetap, gain/loss
   aktual tidak dilacak. Cukup untuk DCA buy-and-hold. Kerjakan hanya kalau mulai sering jual /
   rebalancing dan butuh tahu total profit realisasi.
2. **`avgSurplus3m` tahan outlier.** Bulan THR/bonus/pindahan bisa bikin proyeksi & status
   on-track meleset. Suatu saat: median, atau exclude outlier, atau rata-rata 6 bulan.
   (Relevan juga buat `monthlyContribution` di dashboard 🚀 Proyeksi Wealth, lihat CLAUDE.md.)
3. Arsip transaksi lama (evaluasi kalau > 3.000 docs / load lambat).
4. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
5. Harga emas & NAV reksa dana: belum ada API gratis+CORS stabil → tetap manual.

~~Split CLAUDE.md~~ — udah dikerjain: narasi historis "kenapa" (insiden TradingView/FCS,
infinite-reload-loop, timezone, double-count hook) dipindah ke `DECISIONS.md`, CLAUDE.md
nyimpen aturan "apa sekarang" + pointer.

---

## Catatan strategis (dari owner, bukan task)

App sudah lebih lengkap dari kebanyakan expense tracker komersial. Dashboard Proyeksi (TASK-1)
udah kelar — pertimbangkan **rem fitur** dan pakai app sehari-hari sebulan penuh dulu — gap paling
berharga biasanya muncul dari pemakaian nyata, bukan dari audit. Task hasil "kejadian pas dipakai"
biasanya lebih tepat sasaran daripada task hasil brainstorm.
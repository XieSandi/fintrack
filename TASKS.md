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

Task 1
add feature to connect short time goals with assets

concept :
1. short time Goals has 2 type of balance. Standalone topup balance based like existing feature, and balance that connected with assets
2. UI to connect will placed in edit of the short time goals. i select assets that connected into it (multiple)
3. The assest that connected into goals will not calculate twice, only standalone topedup balance that calculate separately

~~Task 2~~ — udah dikerjain: kartu kredit pindah dari cash path ke debt path.
`totalCashIDR()` sekarang EXCLUDE utang CC, `totalDebtIDR()` sekarang INCLUDE-nya
(`= Σdebts.totalOutstanding + totalCreditDebtIDR()`) — net worth VALUE-nya sendiri ga berubah
(cuma direkategorisasi), model data & mekanisme transaksi CC TETAP akun biasa (ga dipindah ke
collection `debts`). Tab Liquid (Wealth) ga nampilin akun credit lagi; tab Debt (Wealth)
sekarang nampilin akun credit di section terpisah dari cicilan; breakdown Total tab Wealth
misahin baris "💳 Debt (cicilan)" dari "🪪 Kartu Kredit"; report-md.js section 1 & 7 diupdate
match. Detail lengkap & alasan pivot dari v1: `DECISIONS.md` bullet "Kartu kredit: dari cash
path (v1) ke debt path (v2)". Aturan sekarang: CLAUDE.md bullet `accounts` tipe `credit`.

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
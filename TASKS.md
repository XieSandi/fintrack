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

## TASK-2 (P1, [VERIFIKASI] kecil) — Bersihkan sisa UI API key IDX (GoAPI/iTick)

**Konteks:** provider harga IDX sudah pindah ke TradingView yang TIDAK butuh API key
(CLAUDE.md: `settings.apiKeys` sekarang cuma `{finnhub}`). Tapi Setting mungkin masih punya
input field API key IDX lama (GoAPI/iTick) yang sekarang jadi field mati.

**Implementasi:**
- Cek `js/views/settings.js`: kalau masih ada input `s-goapi`/`s-itick` (atau sejenis) untuk
  IDX, hapus field + handler simpannya. Sisakan hanya Finnhub (US).
- Cek `js/prices.js` & tempat lain: pastikan tidak ada lagi baca `apiKeys.goapi`/`apiKeys.itick`
  yang nyangkut. Kalau ada data `apiKeys.goapi`/`itick` lama di Firestore user, biarkan
  (harmless), jangan bikin migrasi hapus — cuma pastikan tidak dibaca/ditampilkan.
- Tambah keterangan kecil di area harga Setting: "Harga saham IDX otomatis, tanpa API key
  (via TradingView)." biar jelas kenapa cuma ada field Finnhub.

**Acceptance:** Setting tidak lagi menampilkan input API key untuk IDX; refresh harga IDX tetap
jalan; tidak ada referensi `apiKeys.goapi`/`itick` yang masih dibaca di kode. Kalau ternyata
sudah bersih: catat "sudah bersih" + betulkan CLAUDE.md kalau ada yang belum akurat.

---

## TASK-3 (P2, kecil) — Rapikan kalimat terpotong di `report-md.js` / CLAUDE.md

Di CLAUDE.md bullet Export Laporan ada kalimat kepotong janggal ("Section 11 masih murni
diturunkan dari / state yang udah ke-load"). Cek section 11 di `report-md.js` benar & lengkap,
lalu rapikan kalimatnya di CLAUDE.md. Murni kosmetik + verifikasi, jangan ubah logika.

**Acceptance:** section 11 report tergenerate benar; kalimat CLAUDE.md utuh.

---

## TASK-4 (P2, dokumentasi) — Catat keterbatasan snapshot on-open di Known Quirks

`upsertSnapshot()` cuma jalan saat app dibuka. Kalau user tidak membuka app di penghujung/awal
bulan, snapshot bulan itu tidak pernah ter-capture → section historis laporan .md jatuh ke
fallback "posisi terkini". Ini KONSEKUENSI DESAIN (PWA statis tidak punya scheduler), bukan bug.

**Implementasi:** tambah 1 bullet di Known Quirks CLAUDE.md yang menjelaskan ini, supaya ke
depannya tidak dikira bug dan tidak ada yang mencoba bikin "auto-snapshot" via mekanisme aneh.
Sebut mitigasi yang ADA: backfill manual Snapshot Historis (kalau user sadar kelewat) — tapi itu
minimal (tanpa breakdown), jadi laporan bulan itu tetap fallback. Tidak ada perubahan kode.

**Acceptance:** bullet baru ada di Known Quirks.

---

## Roadmap (belum jadi task aktif — kandidat, butuh keputusan/kebutuhan nyata dulu)

1. **Realized P&L tracking.** Jual asset sekarang cuma turunin qty, avg buy tetap, gain/loss
   aktual tidak dilacak. Cukup untuk DCA buy-and-hold. Kerjakan hanya kalau mulai sering jual /
   rebalancing dan butuh tahu total profit realisasi.
2. **`avgSurplus3m` tahan outlier.** Bulan THR/bonus/pindahan bisa bikin proyeksi & status
   on-track meleset. Suatu saat: median, atau exclude outlier, atau rata-rata 6 bulan.
   (Relevan juga buat `monthlyContribution` di dashboard 🚀 Proyeksi Wealth, lihat CLAUDE.md.)
3. **Split CLAUDE.md.** Sudah ~450 baris dan tiap fitur menambah. Kalau perawatannya mulai berat
   atau context window kerasa: pisahkan narasi historis "kenapa" (insiden TradingView/FCS,
   infinite-reload-loop, timezone, double-count hook) ke `DECISIONS.md`; CLAUDE.md simpan aturan
   "apa sekarang" + pointer. Belum genting.
4. Arsip transaksi lama (evaluasi kalau > 3.000 docs / load lambat).
5. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
6. Harga emas & NAV reksa dana: belum ada API gratis+CORS stabil → tetap manual.

---

## Catatan strategis (dari owner, bukan task)

App sudah lebih lengkap dari kebanyakan expense tracker komersial. Dashboard Proyeksi (TASK-1)
udah kelar — pertimbangkan **rem fitur** dan pakai app sehari-hari sebulan penuh dulu — gap paling
berharga biasanya muncul dari pemakaian nyata, bukan dari audit. Task hasil "kejadian pas dipakai"
biasanya lebih tepat sasaran daripada task hasil brainstorm.
# TASKS.md — Backlog Instruksi untuk Claude Code

Cara pakai: buka session (`claude` di root repo), lalu bilang "kerjain TASK-B di TASKS.md".
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

**CATATAN PENTING soal task verifikasi (TASK-D):** ada kemungkinan sebagian sudah
dikerjakan di session lampau tapi belum ke-dokumentasi. Untuk task bertanda **[VERIFIKASI]**:
CEK DULU kondisi kode saat ini. Kalau ternyata sudah benar, JANGAN ubah kode — cukup betulkan
CLAUDE.md biar akurat, dan tulis di ringkasan "sudah ada, dokumentasi diperbaiki". Kalau belum
ada / setengah jalan, baru implementasikan.

---

## TASK-B (P1) — Integrity check: konsistensi `assets.quantity`

**Scope:** pelengkap TASK-A. `scanIntegrity()` belum mendeteksi kalau `quantity` asset melenceng
dari jejak transaksinya (akibat bug, hapus lewat Firestore console, atau edit manual setelah ada
transaksi).

**Implementasi (`js/integrity.js`):**
- Untuk setiap asset yang **punya ≥1 transaksi ber-`assetId`**: hitung
  `netQty = Σ buy − Σ sell`, bandingkan dengan `assets.quantity`.
- **JANGAN flag** asset tanpa transaksi sama sekali — itu posisi lama pra-fitur yang legit manual.
- Toleransi floating point (selisih < 0.0001 dianggap sama), jangan `!==` mentah.
- Finding read-only, informatif, TIDAK menuduh: "tercatat 15 lot, jejak transaksi 10 lot,
  selisih 5 lot — perlu dicek" (selisih bisa sengaja: posisi lama + transaksi baru bercampur).
  Tombol "Buka" → sheet edit asset.
- Tambah juga: transaksi ber-`assetId` yang `assetQty`/`assetPrice`/`assetDir`-nya kosong/invalid.

**Acceptance:** ubah `quantity` asset lewat form manual padahal ada transaksinya → cek integritas
melaporkan selisih dengan angka benar; asset tanpa transaksi tak pernah jadi finding.

---

## TASK-C (P1, kecil) — Naikkan `schemaVersion` backup ke 2 + audit test

**Masalah:** `schemaVersion` masih 1 sejak rilis awal, padahal model berubah banyak (`goals`,
`recurring`, `debtId`, `assetId`/`assetDir`/`assetQty`/`assetPrice`, `toGoalId`/`fromGoalId`).

**Implementasi:**
- `exportAll()` → `schemaVersion: 2`.
- `importAll()`: terima versi 1 DAN 2. Versi 1 = valid, field baru dianggap tidak ada (jangan isi
  default mengarang — entity tanpa `debtId`/`assetId` memang perilaku lama yang benar). Versi > 2
  → tolak: "Backup dari versi app lebih baru. Update app dulu (Setting → Hard Refresh) baru
  import." Tidak ada `schemaVersion` → perlakukan sebagai 1.
- Tambah 1 baris aturan di CLAUDE.md: naikkan `schemaVersion` tiap ada perubahan struktur data
  yang tidak backward-compatible.

**Audit `tests/calc.test.mjs`** — pastikan 4 kasus `accountId` kondisional punya test masing-masing
(paling gampang regresi):
1. topup goal (`toGoalId`) — akun sumber turun, tak ada akun naik
2. pencairan goal (`fromGoalId`) — `accountId` = tujuan, naik
3. jual asset (`assetId`+`assetDir:"sell"`) — `accountId` = tujuan, naik
4. beli asset (`assetDir:"buy"`) — akun sumber turun, net worth TIDAK berubah (cash turun, asset
   naik senilai sama)
Plus 1 case `monthSummary()` membuktikan keempatnya bukan income/expense. Tambahkan yang belum ada.

**Acceptance:** export → `schemaVersion:2`; import file v1 sukses; file v3 palsu ditolak dengan
pesan benar; `node tests/calc.test.mjs` hijau dengan case baru.

---

## TASK-D (P1, [VERIFIKASI] dokumentasi + konsistensi) — Rapikan CLAUDE.md & lokasi `milestoneProgress()`

Dua inkonsistensi di CLAUDE.md yang harus dicek terhadap kode nyata:

**D1. Section Arsitektur — daftar file tidak lengkap.**
- Baris `js/views/` cuma menyebut sampai `recurring`. Verifikasi file yang benar-benar ada di
  `js/views/` dan lengkapi: minimal `danger.js` (dirujuk di 3 tempat lain tapi tak terdaftar),
  dan cek juga `settings`, `accounts`, `categories`, `goals` sudah tercantum.
- Blok arsitektur belum menyebut `tests/calc.test.mjs` — tambahkan (dengan catatan: bukan runtime,
  tidak masuk PRECACHE).
- Ini murni edit dokumentasi; jangan ubah kode.

**D2. `milestoneProgress()` — store.js atau calc.js?**
- CLAUDE.md (section settings) menulis "`milestoneProgress()` (store.js)", tapi ATURAN WAJIB #8 +
  deskripsi calc.js menyatakan semua kalkulasi murni ada di calc.js. `milestoneProgress` itu
  kalkulasi murni.
- CEK kode: kalau fungsinya **di store.js** → pindahkan ke `js/calc.js` (pola wrapper tipis
  seperti fungsi calc lain), tambah test case-nya, jalankan test. Kalau **sudah di calc.js** →
  cukup betulkan CLAUDE.md yang salah tulis.

**Acceptance:** daftar file di Arsitektur cocok dengan isi `js/views/` sebenarnya; `tests/`
tercantum; `milestoneProgress()` berada di calc.js dengan test, dan CLAUDE.md menyebut lokasi
yang benar.

---

## TASK-E (P1, value tertinggi untuk analisis AI) — Snapshot kaya + laporan .md historis beneran

**Masalah:** `report-md.js` untuk bulan lampau menampilkan posisi **terkini** (dengan disclaimer),
karena app tak menyimpan histori posisi. `snapshots` sudah ada, tinggal diperkaya → langsung
menaikkan kualitas analisis AI (alasan fitur .md dibuat).

**A. Perkaya `upsertSnapshot()`** — tambahkan ke `breakdown` (angka mentah, bukan string
terformat):
- `accounts`: [{name, currency, balance, balanceIDR}]
- `assets`: [{symbol, type, quantity, avgBuyPrice, price, priceDate, valueIDR, costIDR}]
- `debts`: [{name, outstanding, monthlyInstalment, remainingMonths}]
- `goals`: [{name, targetAmount, saved}]
- `rate`: kurs USD saat snapshot dibuat
Ukuran dokumen tetap wajar (puluhan baris, jauh di bawah 1 MiB). Snapshot manual backfill
(`manual:true`) tetap boleh minimal — breakdown kosong bukan error.

**B. `buildMonthlyReport(month)` pilih sumber:**
- Bulan **berjalan** → live state (sekarang).
- Bulan **lampau punya snapshot lengkap** → pakai breakdown snapshot, label "Posisi akhir
  {bulan}", HAPUS disclaimer posisi-terkini.
- Bulan **lampau tanpa snapshot lengkap** (data lama/backfill) → fallback perilaku sekarang +
  disclaimer. Jangan mengarang.
- Section Tren Net Worth: selain delta yang sudah ada, kalau data tersedia tambah baris ringkas
  perubahan komposisi (mis. "Assets +Rp 1,2jt, Debt −Rp 500rb").

**C. Migrasi lembut:** snapshot lampau yang terlanjur minimal tidak bisa diisi ulang (datanya
memang tak ada) — jangan bikin mekanisme menebak. Cukup pastikan mulai bulan ini snapshot kaya.

**Acceptance:**
- Buka app → `snapshots/{bulan ini}` berisi breakdown lengkap.
- Export .md bulan berjalan → seperti sekarang.
- Export .md bulan lampau ber-snapshot kaya → section posisi pakai angka snapshot, label "Posisi
  akhir {bulan}", tanpa disclaimer.
- Export .md bulan lampau tanpa snapshot → fallback + disclaimer, tidak error.

---

## TASK-F (P2) — Main Milestone punya dimensi waktu (pakai `targetDate` yang vestigial)

**Masalah:** `settings.targetDate` ada ("2028-12") tapi tanpa UI, tak dipakai. Milestone tanpa
waktu = setengah informasi, tak bisa jawab "on-track atau enggak".

**Implementasi:**
- Card "Main Milestone & Kurs" (Setting): tambah `<input type="month">` untuk target date, simpan
  ke `settings.targetDate`. Boleh dikosongkan.
- Perluas `milestoneProgress()` (di **calc.js** — lihat TASK-D; tambah test case) supaya juga
  return, HANYA kalau `targetDate` terisi & belum tercapai:
  - `monthsLeft` (bulan berjalan → targetDate, min 0)
  - `neededPerMonth` = (target − nw) / monthsLeft
  - `avgSurplus3m` = rata-rata surplus 3 bulan terakhir ber-data (pakai `monthSummary()`)
  - `onTrack` = avgSurplus3m ≥ neededPerMonth
- Tampilkan di bawah progress bar (Home + Wealth, satu sumber): "Sisa 29 bulan · perlu ± Rp
  2,1jt/bln · surplus rata-rata lo Rp 2,4jt → **on track** ✓" atau "kurang ± Rp 300rb/bln".
- Edge cases WAJIB: targetDate kosong → bar seperti sekarang tanpa baris pace. targetDate sudah
  lewat tapi belum tercapai → "target date terlewat" (jangan bagi nol/negatif). Sudah tercapai →
  tetap state "🏆 Tercapai!", pace disembunyikan. Belum ada data surplus → tampilkan
  `neededPerMonth` saja tanpa klaim on-track.
- Ganti label "vestigial" `targetDate` di CLAUDE.md dengan deskripsi peran barunya.
- Sertakan info pace di laporan .md (section Ringkasan) — berguna buat AI.

**Acceptance:** isi target date → baris pace muncul di Home & Wealth dengan angka terverifikasi;
kosongkan → hilang tanpa error; target date lampau → pesan benar, tak crash.

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

1. ~~TASK-A~~ — udah beres (lihat git history / CLAUDE.md bullet "Efek samping transaksi
   ber-`debtId`/`assetId`" buat detailnya).
2. **TASK-B + TASK-C** boleh satu session (dua-duanya kecil, area integritas/backup).
3. **TASK-D** (dokumentasi + pindah milestoneProgress) — cepat, bersihin fondasi sebelum TASK-E/F
   yang menyentuh milestone & snapshot.
4. **TASK-E** — value tertinggi buat tujuan awal export .md; taruh setelah fondasi beres karena
   nulis ke `snapshots`.
5. **TASK-F**, lalu **TASK-G** — enhancement, tidak mendesak.

## Roadmap (belum jadi task aktif)

1. Arsip transaksi lama (evaluasi kalau > 3.000 docs / load lambat).
2. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
3. Harga emas & NAV reksa dana: belum ada API gratis+CORS stabil → tetap manual.
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

Temuan di TASK-2 berasal dari audit data pemakaian nyata (export .md Agt 2026).

---

## TASK-2 (P1, BUG tampilan) — Goal savings: dua angka beda cerita (section 1 vs section 8)

**Bukti (report Agt 2026):**
- Section 1: "Goal savings: **Rp 0**"
- Section 8: Dana Pensiun "Terkumpul **Rp 512.542** = topup Rp 0 + asset Rp 512.542"

Dua angka ini bikin bingung: net worth bilang goal savings 0, goal view bilang terkumpul 512rb.
Akarnya: goal punya dua sumber "terkumpul" yang beda sifat — **topup** (uang tunai yang benar-benar
dipindahkan ke goal, mengurangi akun cash) vs **asset-linked** (asset yang di-assign ke goal, TAPI
nilainya sudah masuk `totalAssetsIDR`). Kalau "goal savings" di net worth cuma menghitung topup
(supaya tidak double-count dengan Assets — itu BENAR), maka menampilkan "Terkumpul 512rb" tanpa
konteks di tempat lain jadi menyesatkan (user bisa ngira punya 512rb tunai di goal yang bisa
dicairkan).

**Ini kemungkinan BUKAN bug kalkulasi net worth** (memisahkan topup dari asset-linked untuk
menghindari double-count itu benar). Yang salah adalah **konsistensi & kejelasan tampilan**.

**Implementasi (tampilan, hati-hati jangan ubah rumus net worth):**
- Di SEMUA tempat goal ditampilkan (goals.js, report section 8, home/wealth kalau ada), pisahkan
  dengan label eksplisit: "Ditabung (tunai): Rp X" vs "Dari aset ter-link: Rp Y" vs
  "Total nilai goal: Rp X+Y". Jangan tampilkan satu angka "Terkumpul" gabungan tanpa rincian.
- Progress bar goal: tentukan dan dokumentasikan apakah progress dihitung dari (tunai saja) atau
  (tunai + aset). Untuk goal seperti Dana Pensiun yang memang di-fund via aset, (tunai + aset)
  lebih masuk akal — tapi harus KONSISTEN dengan angka yang dipakai, dan diberi catatan kaki
  "sebagian dari nilai aset, bukan tunai yang bisa langsung dicairkan".
- Section 1 report: kalau goal punya asset-linked, "Goal savings: Rp 0 (tunai) + Rp 512.542 (aset,
  sudah termasuk di Assets)" — jangan cuma "Rp 0" yang seolah kontradiktif.
- Pastikan asset-linked yang di-assign ke goal TIDAK menghilang dari perhitungan Assets (verifikasi
  BIBIT tetap terhitung di `totalAssetsIDR`) — dan tidak double-count di net worth.

**Acceptance:**
- Goal Dana Pensiun menampilkan rincian tunai vs aset di goals.js dan report, tidak ada satu angka
  "terkumpul" telanjang yang kontradiksi dengan section 1.
- Net worth TIDAK berubah nilainya karena task ini (murni tampilan) — verifikasi angka net worth
  sebelum-sesudah identik.
- Asset ter-link tetap terhitung di Assets.

---

## TASK-3 (P0/investigasi, [VERIFIKASI] — mungkin bukan bug) — Utang CC 3,2jt vs expense Agt 560rb

**Konteks dari data:** CC terpakai total Rp 3.210.581 (Tokopedia 2,67jt + Nex 535rb), tapi expense
Agustus cuma Rp 560.950. Perlu dipastikan tidak ada belanja CC yang LOLOS dari pencatatan expense
(bug guard), vs skenario normal (utang CC dari data lama / diinput via reconcile saldo awal).

**Langkah investigasi (JANGAN ubah kode sebelum tahu):**
- Cek History: filter akun Tokopedia Card & Nex Card. Untuk tiap transaksi yang membentuk saldo
  −3,2jt, klasifikasikan: (a) expense normal (benar, mengurangi balance & masuk laporan bulan-nya),
  (b) reconcile "Penyesuaian Saldo" / initialBalance saat akun dibuat (benar, saldo awal utang),
  (c) sesuatu yang lain (potensi bug).
- Verifikasi mekanis: untuk akun credit, `balance == initialBalance + Σ(income) − Σ(expense) ±
  transfer`. Pastikan tidak ada jalur yang mengubah balance CC tanpa membuat transaksi
  (mis. tombol/aksi yang nge-`patch` balance langsung — seharusnya TIDAK ADA, balance derived).

**Kalau ditemukan bug** (ada belanja CC yang tidak jadi expense, atau balance CC diubah tanpa
transaksi): perbaiki sesuai temuan + tambah ke integrity check: "akun credit yang balance-nya tidak
sama dengan hasil hitung dari jurnal" (kalau memungkinkan dideteksi).

**Kalau normal** (semua −3,2jt terjelaskan oleh expense historis + saldo awal): cukup catat
kesimpulan di ringkasan, TIDAK usah ubah kode. Owner sudah konfirmasi app efektif dipakai 1 Agustus,
jadi saldo awal CC via reconcile itu wajar.

**Acceptance:** laporan investigasi jelas menyatakan setiap komponen utang CC berasal dari mana;
kalau ada jalur yang mengubah balance CC tanpa transaksi, dihilangkan.

---

## TASK-4 (P1, fitur besar) — Jenis asset baru: Obligasi / SBN Ritel (ORI, SR, SBR, ST)

**Konsep instrumen (sudah diverifikasi ke mekanisme SBN ritel Indonesia):** investor beli obligasi
senilai pokok tertentu (kelipatan Rp1jt). Dapat **kupon/return periodik** (bulanan untuk ORI/SR,
bisa juga tenor lain) yang cair ke rekening (RDN). Saat **jatuh tempo (maturity)**, **pokok kembali
100%** ke rekening. Kupon dan pengembalian pokok adalah dua peristiwa berbeda.

**Keputusan owner yang WAJIB diikuti:**
1. Return/kupon **TIDAK dihitung otomatis** — user input manual sebagai transaksi income saat kupon
   cair ke RDN. App hanya menyimpan metadata (rate, periode) sebagai pengingat/informasi, bukan
   generator angka.
2. Periode kupon **bisa di-set, tidak fix** (bulanan / 6-bulanan / bebas) — jangan hardcode bulanan.
3. Nilai pokok obligasi **tidak fluktuatif seperti saham** — default = par (100% pokok). (Pasar
   sekunder bisa naik/turun, tapi itu opsional/manual, bukan default.)
4. Ada **tanggal maturity**; saat itu pokok cair ke akun (berbeda dari kupon).

**Data model — extend `assets` (JANGAN bikin collection baru):**
- Tambah `type: "bond"` ke enum tipe asset.
- Field khusus bond (semua opsional kecuali yang ditandai):
  - `principal` (WAJIB) — nilai pokok yang diinvestasikan (Rp). Ini basis nilai asset.
  - `couponRatePA` — kupon % per annum (bisa di-edit; untuk SBR/floating bisa diubah kapan saja).
  - `couponPeriodMonths` — 1 (bulanan) / 6 / dst. Default 1. Untuk pengingat, bukan kalkulasi.
  - `couponAccountId` — akun tujuan kupon (biasanya RDN) — dipakai untuk PRE-FILL transaksi income
    kupon, bukan auto-post.
  - `maturityDate` (WAJIB) — tanggal jatuh tempo.
  - `issueDate` / `purchaseDate` — tanggal beli (untuk info & urutan).
  - `maturityAccountId` — akun tujuan pengembalian pokok saat maturity (biasanya RDN).
  - `seriesName` — mis. "ORI030T3" (opsional, buat label).
- **Nilai asset bond** (`assetValueIDR` untuk bond): default = `principal` (par). Kalau user
  mengisi `manualPrice`/harga pasar (opsional, pasar sekunder), pakai itu. JANGAN paksa fluktuasi.
  `assetCostIDR` = `principal`. P&L bond default 0 (kecuali user set harga pasar) — ini BENAR,
  beda dari saham; jangan tampilkan P&L merah/hijau menyesatkan untuk bond yang dipegang sampai
  jatuh tempo.

**Kalkulasi (`js/calc.js` + test):**
- `bondValueIDR(asset)` → `manualPrice > 0 ? (logika pasar) : principal`. Masuk ke `totalAssetsIDR`
  seperti asset lain (bond adalah asset, menambah net worth via Assets).
- Tidak ada kalkulasi kupon (sesuai keputusan owner). Boleh ada helper INFORMATIF
  `bondNextCouponHint(asset, today)` → estimasi tanggal kupon berikutnya + estimasi nominal
  (`principal × couponRatePA/12 × couponPeriodMonths`) HANYA sebagai teks bantu di UI ("≈ Rp X,
  perkiraan sebelum pajak") — dengan disclaimer jelas bahwa ini estimasi & user tetap input manual.
  Jangan pernah membuat transaksi dari angka ini.

**UI — form asset (wealth.js):**
- Tipe "Obligasi / SBN" → tampilkan field khusus bond (principal, couponRatePA, couponPeriodMonths,
  couponAccountId, maturityDate, maturityAccountId, seriesName). Sembunyikan field yang tidak
  relevan (qty/lot/avg buy ala saham — untuk bond, "qty" = principal, tidak perlu lot).
- Tampilan bond di list asset: tampilkan principal, kupon % PA, periode, dan **hitung mundur ke
  maturity** ("jatuh tempo 15 Nov 2028 · 27 bln lagi"). Kalau sudah lewat maturity tapi belum
  di-redeem → badge "⚠️ Jatuh tempo, cairkan pokok".

**UI — dua aksi khusus bond:**
1. **"Catat Kupon Masuk"** (bisa dari detail bond, atau reminder — lihat integrasi recurring di
   bawah): buka sheet transaksi **income** pre-filled: akun = `couponAccountId`, kategori = income
   "Bunga & Dividen" (atau kategori income yang sesuai — pastikan ada), nominal = kosong atau
   estimasi (user isi/koreksi manual), catatan = "Kupon {seriesName}". Ini transaksi income BIASA
   (masuk cashflow) — bukan mekanisme baru. Verifikasi masuk `monthSummary().income`.
2. **"Cairkan Pokok (Jatuh Tempo)"**: saat maturity. Ini memindahkan `principal` dari bond ke akun
   `maturityAccountId`. Model sebagai **penjualan asset** (pola `assetId` sell yang sudah ada):
   transaksi transfer masuk ke akun tujuan senilai principal, asset bond ditandai selesai
   (quantity/principal → 0 atau flag `redeemed:true` supaya hilang dari asset aktif tapi jejak
   tetap ada). BUKAN income (pokok kembali bukan penghasilan — itu uang lo sendiri balik).
   Verifikasi: net worth TIDAK berubah saat pencairan pokok (asset turun, cash naik senilai sama);
   income/expense tidak tersentuh.

**Integrasi recurring (opsional, kalau tidak menambah banyak kompleksitas):**
- Karena kupon periodik, bond cocok jadi **reminder** di sheet Awal Bulan (pola DCA asset di
  TASK recurring: reminder yang membuka "Catat Kupon Masuk" pre-filled, BUKAN auto-post — karena
  nominal aktual kena pajak & pembulatan). Kalau mengerjakan ini, ikuti pola reminder asset yang
  sudah ada; kalau menambah kompleksitas berlebih, SKIP dan cukup andalkan hitung-mundur di list
  bond + badge maturity. Putuskan dan catat alasannya.

**Report .md (report-md.js):**
- Bond muncul di section Investasi dengan kolom yang sesuai (principal, kupon %, maturity) — jangan
  paksa ke kolom "avg buy / harga / P&L" ala saham kalau tidak relevan; boleh baris dengan format
  sedikit beda atau kolom P&L "—" untuk bond par.
- Tambah baris informatif di section konteks/investasi: total pokok obligasi + estimasi kupon
  tahunan (informatif) + daftar maturity terdekat. Berguna buat analisis AI (arus kas pasif masa
  depan).

**Snapshot & backup:**
- Field additive/opsional → snapshot & backup lama tetap valid → **schemaVersion TIDAK naik**
  (konfirmasi di ringkasan). breakdown snapshot bond simpan principal + maturityDate.

**Integrity check:**
- Bond dengan `maturityDate` < hari ini tapi belum `redeemed` → info "jatuh tempo, belum dicairkan".
- Bond `couponRatePA` di luar 0–100 atau `principal` ≤ 0 → info.
- `maturityDate` sebelum `purchaseDate` → info (salah input).

**Acceptance:**
- Bikin bond "ORI030T3", principal Rp 5jt, kupon 6,9% PA, periode 1 bln, RDN sebagai
  coupon+maturity account, maturity 15 Jul 2029. → muncul di Assets dengan nilai Rp 5jt (par,
  P&L 0/—), hitung mundur maturity benar, net worth naik Rp 5jt via Assets.
- "Catat Kupon Masuk" → sheet income pre-filled (akun RDN, kategori Bunga & Dividen), user isi
  nominal → tercatat sebagai income, masuk cashflow bulan itu, saldo RDN naik.
- "Cairkan Pokok" di/after maturity → RDN naik Rp 5jt, bond hilang dari asset aktif (jejak tetap),
  net worth TIDAK berubah, income/expense tidak tersentuh.
- `node tests/calc.test.mjs` hijau dengan case bond (nilai = principal; par; masuk totalAssets).
- Backup lama tetap restore (schemaVersion tidak naik).

**Setelah selesai:** update CLAUDE.md (Data Model → assets: tambah `type:bond` + field-nya + aturan
"nilai = principal/par, bukan fluktuatif; kupon & pokok manual, dua peristiwa beda"); dokumentasikan
di DECISIONS.md kenapa return TIDAK diotomatisasi (pajak 10%, pembulatan, timing mutasi RDN — biar
angka app cocok dengan realita).

---

## Urutan eksekusi disarankan

1. **TASK-3** (investigasi CC — cepat, mungkin no-op; lakukan sebelum nambah fitur biar yakin
   fondasi CC sehat).
2. **TASK-2** (tampilan goal — kecil, murni klaritas).
3. **TASK-4** (obligasi — fitur besar, taruh terakhir; sentuh calc/report/snapshot yang idealnya
   sudah bersih).

~~TASK-1~~ — udah dikerjain: "Perubahan komposisi" report ga sum ke Δ net worth ternyata 2 bug
independen (CAPEX double count + sign Debt kebalik). Fix: `netWorthComposition()` (calc.js, pure,
di-test pakai angka asli laporan Agustus 2026 sebagai regression test) — return semua komponen
SEBAGAI KONTRIBUSI siap-jumlah (assets exclude CAPEX, debt udah dinegasi), `total` dihitung
LANGSUNG dari `netWorthFromParts()`. Section 10 report-md.js sekarang pakai pasangan bulan yang
SAMA kayak Δ net worth section 1, jadi dua angka itu sekarang identik (dulu beda ±Rp1). Riwayat
lengkap & angka pembuktian bug: `DECISIONS.md`. Aturan sekarang: CLAUDE.md bullet
`report-md.js`.

## Roadmap (kandidat, belum task)

1. Realized P&L saat jual asset (termasuk capital gain bond pasar sekunder).
2. `avgSurplus3m` tahan outlier (median / exclude bonus-THR) — relevan buat pace & proyeksi.
3. `milestonePaceLine()` blur-mode leak (pisah angka mentah dari string) — pas nyentuh area itu.
4. CAPEX integrity (purchaseDate masa depan, depreciationPctMonth di luar 0–1).
5. Import CSV mutasi; laporan tahunan; enkripsi backup.
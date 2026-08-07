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

1. **TASK-4** (obligasi — satu-satunya task aktif yang tersisa; fitur besar, sentuh calc/report/
   snapshot yang idealnya sudah bersih dari TASK-1/2/3).

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
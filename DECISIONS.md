# FinTrack — Decisions & Incident History

Narasi "kenapa" di balik keputusan desain & insiden yang pernah kejadian selama development.
CLAUDE.md nyimpen aturan **"apa yang berlaku sekarang"** (ringkas, buat referensi cepat
sehari-hari) + pointer ke sini kalau butuh cerita lengkapnya. File ini nyimpen narasi historis
biar CLAUDE.md ga makin panjang tiap ada insiden baru (lihat Roadmap #3 di `TASKS.md`).

**Kalau nambah insiden baru ke sini:** tetap bikin/update bullet ringkas di CLAUDE.md Known
Quirks yang isinya aturan operasional WAJIB (apa yang harus/jangan dilakuin sekarang), lalu
pointer dari situ ke section baru di file ini buat ceritanya. Jangan taruh aturan yang WAJIB
diikuti CUMA di sini — dev/AI yang kerja sehari-hari baca CLAUDE.md, bukan file ini.

---

## Provider harga saham IDX: iTick → FCS API → TradingView (2026-07)

**Konteks:** app butuh harga saham IDX (Bursa Efek Indonesia) otomatis, gratis, dan
CORS-friendly (bisa dipanggil langsung dari browser client-side — app ini zero-backend, zero
build step, jadi ga ada server buat proxy request).

**iTick** (provider awal, terverifikasi jalan waktu pertama diintegrasikan) — berhenti bisa
dipakai gratis pertengahan 2026 (tier personal/free-nya di-discontinue oleh provider-nya
sendiri, di luar kendali app ini).

**Dicoba FCS API sebagai pengganti pertama.** Marketing page & dokumentasi publik FCS API
eksplisit menyebut free tier mereka cover data stock/index. Begitu diintegrasikan dan dites
pakai API key ASLI (bukan cuma baca dokumentasi), ternyata SALAH — API-nya konsisten balikin
`{code:403, msg:"You are trying to access stock/index data without an active subscription. In
Free Plan you can't access this market."}` buat SEMUA request stock, regardless simbol yang
diminta. Cek pricing page-nya: paket termurah yang beneran include akses stock adalah "Stock
Starter" $20/bulan.

**Pelajaran dari insiden ini:** jangan pernah percaya klaim "gratis"/"free tier" provider data
finansial manapun cuma dari marketing page atau dokumentasi publik — WAJIB test request
sungguhan pakai API key ASLI (bukan demo key) sebelum diintegrasikan penuh ke kode. Dokumentasi
publik bisa nyebut sesuatu "included" di level kategori produk padahal sebenernya di-gate di
belakang paket berbayar.

**Akhirnya pindah ke TradingView public scanner** (`scanner.tradingview.com/global/scan`) —
endpoint backend publik yang sama dipakai buat nge-power widget ticker embed TradingView di
banyak situs pihak ketiga. Ga resmi didokumentasikan buat dipakai eksternal (bukan API produk
yang dijual TradingView), tapi CORS-nya kebukti terbuka (reflect Origin header apa pun yang
diminta) dan TANPA butuh API key/registrasi sama sekali — dites langsung dari origin production
app ini (`xiesandi.cyou`) dan beberapa symbol portfolio asli (BBCA/BBRI/ADRO/WBSA), semua balik
harga valid.

**Bug CORS preflight yang sempet kejadian saat integrasi TradingView:** verifikasi awal endpoint
ini dilakuin pakai `curl` dari terminal, dan kelihatan sukses (200 OK, data valid balik). Begitu
kode yang sama dipanggil dari browser beneran (di app production), request-nya gagal total tanpa
error message yang jelas — cuma toast generik "gagal", ga ada detail. Penyebabnya: kode awal set
header `Content-Type: application/json` secara eksplisit di opsi `fetch()`. Header ini BUKAN
termasuk CORS-safelisted headers (yang CORS-safelisted cuma `Accept`, `Accept-Language`,
`Content-Language`, dan `Content-Type` KHUSUS buat 3 value: `text/plain`,
`application/x-www-form-urlencoded`, `multipart/form-data`) — begitu ada header non-safelisted,
browser WAJIB ngirim preflight request `OPTIONS` duluan sebelum request asli. Preflight
TradingView cuma nge-`Access-Control-Allow-Headers: Referer,Accept` — ga include `content-type`
— jadi browser correctly BLOCK request aslinya karena preflight bilang header itu ga diizinkan.
`curl` ga pernah kena masalah ini sama sekali karena `curl` ga ngejalanin mekanisme preflight
CORS (itu murni behavior browser, bukan bagian dari HTTP request itu sendiri) — makanya
verifikasi via `curl` "kelihatan sukses" padahal beneran dipanggil dari browser gagal total.
**Fix:** hapus header `Content-Type: application/json` itu dari opsi `fetch()`. Default `fetch()`
buat body berupa string (`text/plain;charset=UTF-8`) itu CORS-safelisted — otomatis skip
preflight sama sekali — dan server TradingView tetap parse body request-nya sebagai JSON
regardless apa yang di-declare di `Content-Type`, jadi ga ada downside fungsional dari
ngilangin header itu.

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet
`js/prices.js` / TradingView scanner di Known Quirks.

---

## Infinite-reload-loop dari kombinasi auto-update Service Worker

**Apa yang kejadian:** versi awal registrasi Service Worker (`sw.js`) pakai TIGA hal sekaligus:
(1) query-string cache-buster (`?v=${Date.now()}`) di URL registrasi SW, (2) pemanggilan
`self.skipWaiting()` otomatis di event `install` SW, dan (3) auto-`location.reload()` di event
`controllerchange` pada sisi client. Kombinasi ketiganya bikin app kejebak infinite-reload-loop
di HP user: SW versi baru langsung `skipWaiting()` (skip fase "waiting", langsung aktif) →
`clients.claim()` ambil alih kontrol tab yang lagi kebuka → itu men-trigger event
`controllerchange` di client → handler client auto-reload halaman → reload itu sendiri
me-register ulang SW dengan URL cache-buster yang NILAINYA BEDA tiap kali (karena `Date.now()`
selalu berubah) → browser nganggep ini SW "versi baru" LAGI (URL beda = registrasi beda) →
siklus di atas ulang dari awal, tanpa henti, bikin app ga bisa dipakai (reload terus-menerus).

**Fix:** hapus ketiga elemen penyebabnya. Registrasi SW sekarang TANPA cache-buster (URL
registrasi stabil, ga pernah berubah antar reload), `install` handler TIDAK manggil
`skipWaiting()` (SW baru nunggu pasif di state "waiting", ga langsung ambil alih), dan TIDAK ada
lagi auto-reload apapun di event `controllerchange`. Update SW sekarang PENUH manual/eksplisit:
user yang trigger sendiri lewat tombol **Hard Refresh** di Setting (`hardRefresh()` di
`utils.js`: unregister semua SW terdaftar + `caches.delete()` semua cache + reload — satu kali,
dipicu tindakan sadar user, bukan otomatis).

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet GitHub
Pages/Service Worker di Known Quirks — JANGAN tambahin balik cache-buster, `skipWaiting()`
otomatis, atau auto-reload tanpa mikir ulang risiko loop ini.

---

## Bug timezone: `toISOString()` vs `toDateStr()` buat tanggal kalender

**Apa yang kejadian:** beberapa tempat di kode awal pakai pola
`new Date().toISOString().slice(0, 10)` buat dapetin representasi string "tanggal hari ini"
(format `YYYY-MM-DD`), termasuk buat default tanggal transaksi baru dan buat nentuin
`currentMonth()`. Pola ini SALAH kalau dipakai buat representasi tanggal KALENDER (bukan
timestamp momen), karena `toISOString()` SELALU dalam UTC — sementara app ini dipakai dari WIB
(UTC+7). Akibatnya, antara jam 00:00–07:00 WAKTU LOKAL (WIB), komponen UTC-nya MASIH tanggal
HARI SEBELUMNYA (belum lewat tengah malam UTC). Dampak nyata yang kejadian: transaksi baru yang
defaultnya "hari ini" malah kecatat tanggal KEMARIN kalau dicatat pagi-pagi sebelum jam 7 WIB;
`currentMonth()` (dipakai buat nentuin snapshot bulan berjalan & filter budget) bisa salah
nunjuk ke bulan LALU di jam-jam awal tanggal 1 tiap bulan (snapshot bulan baru berisiko nimpa
data bulan lalu); sheet konfirmasi "Awal Bulan" (cek recurring yang jatuh tempo) jadi ga
ke-trigger tepat waktu karena perbandingan tanggalnya salah.

**Fix:** konsolidasi SEMUA representasi tanggal KALENDER lewat dua fungsi di `utils.js`:
`toDateStr(d)` dan `todayStr()` — keduanya pakai komponen LOCAL time device
(`getFullYear()/getMonth()/getDate()`), BUKAN `toISOString()`. Sebelum konsolidasi ini, logic
pad-angka-manual + `getFullYear()` buat format tanggal lokal ini sempet ke-duplikasi terpisah di
3 file berbeda (`utils.js`, `home.js`, `recurring-sheet.js`) — masing-masing nulis versi
sendiri-sendiri, salah satu tempat lupa di-update pas bug ini ditemuin & fix awal cuma nge-patch
sebagian. `toISOString()` sendiri TETAP benar/valid dipakai buat timestamp MOMEN absolut
(`createdAt`, `lastBackupAt`, `exportedAt`) — itu emang representasi waktu UTC/absolut yang
presisi, bukan representasi tanggal kalender, jadi TIDAK perlu (dan TIDAK boleh) diganti ke
`toDateStr()`.

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet tanggal
kalender di Known Quirks — ini salah satu aturan paling gampang kelewat kalau nulis kode baru
yang berurusan sama tanggal, cek dulu sebelum nulis `new Date()...` manual.

---

## Kenapa efek debt/asset dipusatkan sebagai hook di `db.js` (pencegahan double-count)

**Konteks:** transaksi yang bawa `debtId` (motong cicilan hutang) atau `assetId` (beli/jual
asset) punya efek SAMPING di luar dirinya sendiri sebagai satu dokumen — nulis/hapus transaksi
kayak gini juga harus nyesuain field di entity terkait (`debts.totalOutstanding`/
`debts.remainingMonths`, atau `assets.quantity`). Kalau logic penyesuaian ini ditulis manual,
terpisah, di TIAP sheet yang bisa nulis/hapus transaksi (tx-sheet.js buat expense biasa,
wealth.js buat beli/jual asset, recurring-sheet.js buat posting recurring, dst) — risikonya
besar: gampang lupa nulis efeknya di salah satu sheet baru yang ditambahin belakangan, atau
malah nulis efeknya DUA KALI di dua tempat beda kalau ga sadar udah ada logic serupa di tempat
lain. Dua-duanya bikin data `debts`/`assets` ga konsisten sama jejak transaksi aslinya.

**Keputusan desain:** pusatkan efek samping ini sebagai HOOK yang nempel di fungsi CRUD GENERIK
`add()`/`patch()`/`remove()` (db.js) — `applyDebtEffect()` (+ `handleDebtPatch()` buat kasus
edit) dan `applyAssetQtyEffect()` (reverse quantity, khusus di `remove()` karena create/edit
asset transaction sengaja cuma lewat sheet khusus yang udah nulis quantity-nya sendiri). Dengan
begini, sheet manapun yang nulis/hapus transaksi OTOMATIS kena efeknya lewat fungsi generik yang
udah pasti dipanggil — ga perlu tau soal mekanismenya sama sekali, apalagi reimplement manual.

**Risiko double-count yang harus tetap diwaspadai:** ada DUA jalur tulis transaksi yang SENGAJA
bypass fungsi generik `add()`/`patch()`/`remove()` sama sekali (nulis langsung ke Firestore via
`writeBatch`/`deleteDoc`) — `importAll()` (restore dari file backup JSON) dan `bulkDelete()`
(reset data massal, Zona Bahaya). Alasannya: `importAll()` restore nilai `debts.totalOutstanding`
/`assets.quantity` yang UDAH FINAL dari file backup — kalau hook di atas ikut ke-trigger buat
tiap transaksi ber-`debtId`/`assetId` yang lagi di-restore, efeknya bakal keitung/kepotong DUA
KALI (sekali dari angka final di file backup, sekali lagi dari hook yang jalan otomatis).
`bulkDelete()` alasannya beda: efeknya TETAP mau dijalanin (biar konsisten sama hapus 1
transaksi via `remove()` biasa), tapi diagregasi dulu manual per debt/asset lalu SATU `patch()`
per entity di akhir — bukan ratusan hook-triggered patch berturut-turut ke dokumen yang sama
(yang bakal lambat & rawan race condition kalau dieksekusi generik apa adanya).

**State operasional sekarang & aturan yang WAJIB dipatuhi (termasuk kalau nambah jalur tulis
transaksi massal baru ke depannya):** lihat CLAUDE.md bullet "Efek samping transaksi
ber-`debtId`/`assetId`" di Known Quirks.

---

## Fitur CAPEX: toggle default OFF, dua chart beda pola, dan garis "Nabung doang" yang dihapus lagi (2026-08)

**Konteks:** owner punya barang fisik yang nilainya susut predictable tiap bulan (laptop,
elektronik, kendaraan) — sebelum fitur ini, barang kayak gitu kepaksa dicatat sebagai asset tipe
`other`/`deposito`/dll dengan harga manual yang ga pernah di-update, jadi net worth jadi
overstate (barangnya tetep keitung di harga beli awal padahal nilai riilnya udah turun) ATAU
user harus rajin update manual tiap bulan (ga realistis). Solusinya: tipe asset baru `capex`
yang nilainya AUTO-DIHITUNG pakai declining balance (`harga beli × (1−pct)^bulan`), plus
keputusan konsep yang lebih besar: apakah barang kayak gitu HARUS dihitung sebagai "net worth"
sama sekali (beda filosofi personal finance ada yang bilang net worth cuma investable assets,
ada yang bilang semua yang dipunya).

**Kenapa toggle include/exclude, bukan salah satu dipaksa:** daripada app yang mutusin sepihak,
dikasih toggle (`settings.includeCapexInNetWorth`) biar owner sendiri yang milih. **Default-nya
sengaja FALSE (exclude)** — alasan utamanya BUKAN soal filosofi personal finance mana yang
"bener", tapi soal SAFETY: pas fitur ini pertama kali di-deploy, owner punya user existing
(dirinya sendiri) dengan net worth yang UDAH kehitung tanpa konsep CAPEX sama sekali. Kalau
default-nya TRUE (include) dan user langsung convert satu asset lama jadi tipe `capex`, angka
net worth di Home/Wealth bisa TIBA-TIBA berubah (turun, karena sekarang kena declining balance)
tanpa user sadar itu efek toggle, bukan transaksi/harga pasar beneran. Default FALSE bikin net
worth STABIL begitu fitur baru nongol — user harus SENGAJA nyalain toggle-nya buat ngerasain
efeknya, bukan efek samping yang ga disadari.

**Kenapa toggle-nya dipindah dari Setting ke Wealth (card breakdown Total tab):** awalnya
ditaruh di Setting (pola yang sama kayak setting lain — target milestone, kurs, dll). User
minta dipindah karena checkbox itu jauh dari angka yang dipengaruhinya — mesti pindah halaman
buat toggle terus balik lagi ke Wealth buat liat efeknya. Sekarang toggle-nya nempel LANGSUNG
di card breakdown Wealth → Total, deket baris "🏗️ CAPEX" & "NET WORTH" yang berubah pas
di-toggle — feedback loop-nya instan (checkbox → `updateSettings()` → Firestore round-trip →
`store.on()` re-render → angka di card yang SAMA berubah), ga perlu pindah halaman sama sekali.

**Kenapa chart 📈 Tren Net Worth (historis) SELALU nampilin DUA garis, tapi chart 🚀 Proyeksi
cuma SATU yang ngikut toggle:** dua chart ini punya tujuan beda. Tren Net Worth itu buat
BANDINGIN — "seberapa beda net worth gue kalau CAPEX dihitung vs ngga" — jadi dua garis
eksplisit itu justru POIN-nya, sengaja ga di-gate di belakang kondisi apapun (bukan cuma
muncul pas ada CAPEX) biar user selalu bisa liat perbandingannya kapan aja. Proyeksi itu chart
yang beda tujuan — udah ada 5 garis (Aktual, Proyeksi nabung, Proyeksi A%, Proyeksi B%,
Target), nambah 1-2 garis lagi (with/without CAPEX × forward projection) bakal bikin chart-nya
ga kebaca. Jadi Proyeksi cukup ngikutin SATU definisi yang konsisten sama toggle SEKARANG —
prioritasnya "chart ini kebaca & internally consistent", bukan "chart ini nunjukin semua
kombinasi yang mungkin".

**Kenapa report .md (`report-md.js`) juga nunjukin DUA angka eksplisit, bukan cuma satu +
catatan toggle:** awalnya section 1 cuma nunjukin SATU angka net worth (ngikut toggle) plus
kalimat catatan "CAPEX Rp X — ikut/ga ikut dihitung". User eksplisit minta laporan ini
"separate data with capex and without capex so the agent will be able to analyze the 2 datas"
— maksudnya: kalau laporan ini dipaste ke AI lain buat dianalisis, AI itu ga perlu balik nanya
"toggle-nya gimana?" atau nebak-nebak dari catatan teks — dua angka eksplisit (`Net worth (+
CAPEX)` dan `Net worth (tanpa CAPEX)`) langsung siap dibandingin. Baris ketiga ("Dipakai app
sekarang...") tetap ada buat nunjukin mana yang match tampilan live di Home/Wealth, tapi bukan
satu-satunya angka yang dikasih.

**Gap data historis & fitur backfill:** snapshot yang dibuat SEBELUM fitur CAPEX ada ga punya
field `totalCapex` sama sekali (field-nya baru ada mulai commit ini) — padahal barang yang
SEKARANG diklasifikasikan `capex` bisa aja udah ada di portfolio waktu itu juga (cuma dicatat
sebagai tipe lain). User nyadar ini ("previous data are already included assets data, so the
export data has gap") dan minta dibenerin. Daripada mengarang angka historis yang ga pernah
ada, dibikin fitur backfill BEST-EFFORT (`previewCapexBackfill()`/`backfillCapexToSnapshots()`,
db.js): cocokin symbol/name asset CAPEX SEKARANG ke breakdown snapshot lama, pakai `valueIDR`
yang UDAH KESIMPEN di situ (bukan diestimasi ulang) sebagai `totalCapex` bulan itu. User-facing
lewat card di Setting yang preview dulu sebelum eksekusi (pola sama `bulkDelete()`/
`previewBulkDelete()`) — dan otomatis ilang begitu ga ada lagi yang perlu di-backfill.

**Kenapa garis historis "Nabung doang" (terpisah dari "Proyeksi (nabung)") sempat ditambahin
LALU dihapus lagi:** dalam proses bikin chart Proyeksi konsisten sama toggle CAPEX, sempat
ditambahin parameter `includeCapex` ke `savingsOnlySeries()` (anchor-nya jadi toggle-aware,
bukan `snaps[0].netWorth` mentah lagi) — perbaikan yang genuinely benar buat masalah
konsistensi toggle. TAPI user kasih feedback lanjutan: garis "Nabung doang" (historis, dari
titik snapshot pertama) yang tampil berdampingan sama "Proyeksi (nabung)" (forward, dari net
worth SEKARANG) itu KELIHATAN kontradiktif — dua garis abu-abu mirip nama, beda anchor & beda
makna, ketemu di titik "bulan ini" dengan "lompatan" visual kecil (yang sebenernya bukan bug,
tapi tetep kelihatan aneh buat orang yang liat chart-nya). User simpelin: hapus aja garis
historisnya, pertahankan cuma versi forward-looking. Ini nunjukin toggle-consistency FIX yang
"secara teknis benar" tetep bisa jadi keputusan yang salah kalau hasilnya bikin UI lebih
membingungkan — `savingsOnlySeries()` akhirnya dihapus total dari `calc.js` (jadi dead code
begitu satu-satunya caller-nya ilang), bukan cuma di-nonaktifkan di UI.

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet `assets`
tipe `capex` (Data Model), "Chart 📈 Tren Net Worth", "Dashboard Proyeksi", dan "Backfill CAPEX
ke Snapshot Lama" di Known Quirks.

---

## Kartu kredit: dari cash path (v1) ke debt path (v2) (2026-08)

**v1 (spec awal owner):** kartu kredit dimodelkan sebagai akun biasa (`type: "credit"`), utang-
nya derived dari saldo negatif — TAPI keputusan eksplisit waktu itu adalah CC lewat **cash
path**: `totalCashIDR()` include saldo negatifnya apa adanya (net worth turun lewat cash
berkurang), `totalDebtIDR()` TETAP murni collection `debts`, CC ga pernah nyentuh angka itu sama
sekali. Alasannya waktu itu (dari spec asli): CC secara mekanis emang lebih mirip akun (transaksi
generic, saldo jurnal) daripada `debts` (cicilan tetap dengan `monthlyInstalment`/`dueDay`), jadi
kalkulasinya ngikutin "bentuk"-nya. Tab Debt (Wealth) sengaja TIDAK nampilin CC sama sekali di
v1 — breakdown Total tab Wealth (baris "🪪 Kartu Kredit" terpisah dari "💧 Liquid") dianggap udah
cukup buat visibility.

**v2 (owner minta diubah, task terpisah tak lama setelah v1 selesai):** owner eksplisit minta
CC "dipindahkan" ke debt — 3 poin: (1) kalkulasinya jadi debt, (2) dipisah dari akun liquid biar
ga tercampur, (3) TAPI tetap treat sebagai akun (bisa transaksi normal) — cuma presentasi/
kalkulasinya yang beda. Poin (3) ini penting: v2 BUKAN migrasi CC ke collection `debts` (itu
bakal jadi perubahan model data besar, breaking, dan ngilangin kemudahan "belanja pakai CC =
expense biasa" yang justru jadi keunggulan v1) — v2 cuma mindahin CC dari SISI KALKULASI
`totalCashIDR()`/`totalDebtIDR()`, model data (`accounts` doc, `type: "credit"`, transaksi lewat
`accountId`) TIDAK disentuh sama sekali.

**Kenapa owner minta ini diubah** (dari konteks task, bukan dijelasin eksplisit panjang lebar,
tapi bisa disimpulkan dari framing-nya): kemungkinan besar soal MENTAL MODEL — utang kartu
kredit, meskipun mekanismenya "akun", secara EKONOMI ya tetep utang (uang yang harus dibayar
balik, bukan uang yang "dimiliki" kayak saldo bank beneran). Nampilinnya di "Liquid" (bareng
saldo bank/e-wallet asli) — walaupun angkanya udah dikurangin dengan bener secara matematis —
bisa bikin salah baca cepat ("liquid gue segini") padahal sebagian dari pengurangan itu
sebenernya representasi UTANG, bukan cash yang beneran berkurang. Mindahin ke kategori "Debt"
bikin framing-nya lebih jujur: "berapa uang cash gue" (Liquid, sekarang bersih dari CC) vs
"berapa total utang gue" (Debt, sekarang termasuk CC) jadi dua pertanyaan yang jawabannya
langsung kebaca tanpa perlu mikir ulang soal darimana angka itu asalnya.

**Implementasi teknis:** formula `totalCashIDR()` & `totalDebtIDR()` (calc.js) yang diubah,
BUKAN `netWorthIDR()` — net worth VALUE-nya identik antara v1 dan v2 (cuma direkategorisasi),
karena CC's balance negatif SEBELUMNYA nyumbang ke `cash` (ngurangin net worth lewat situ),
SEKARANG nyumbang ke `debt` (ngurangin net worth lewat situ juga) — total pengurangannya sama.
Satu detail yang butuh perhatian ekstra: edge case saldo CC POSITIF (overpay, jarang tapi bisa
terjadi, `integrity.js` udah nge-flag ini sebagai kemungkinan salah reconcile). Kalau
`totalCashIDR()` FULL exclude semua akun credit (regardless of sign) dan `totalDebtIDR()` cuma
nambahin bagian negatif (`creditUsed`, by definition ga pernah negatif), maka saldo POSITIF itu
ga akan kehitung di MANAPUN — net worth diam-diam kehilangan value. Ini persis kelas bug yang
CLAUDE.md udah pernah warning soal ("Jangan lupa subtract debt lagi kalau ada yang refactor
bagian ini, pernah kelewat sebelumnya" — soal toggle Home Total Balance). Fix-nya:
`totalCashIDR()` cuma exclude bagian NEGATIF akun credit (nge-nolin `b` kalau `b < 0` DAN
`isCreditAccount`), bagian POSITIF (kalau ada) tetep keitung normal — jadi kombinasi
`totalCashIDR()` + `totalCreditDebtIDR()` (yang cuma ngitung bagian negatif) SELALU nutup semua
kemungkinan sign tanpa double-count ATAU kehilangan value, di-verifikasi eksplisit lewat test
case di `calc.test.mjs`.

**Yang ikut berubah di UI/report:** tab Liquid (Wealth) sekarang ga nampilin akun credit SAMA
SEKALI (v1 masih nampilin, dikelompokkan terpisah); tab Debt (Wealth) sekarang nampilin akun
credit di section sendiri (v1 sama sekali ga ada — itu keputusan eksplisit v1 yang sekarang
dibalik); breakdown Total tab Wealth misahin baris "💳 Debt (cicilan)" dari "🪪 Kartu Kredit"
(v1 baris "💳 Debt" itu murni cicilan aja secara implisit karena CC ga pernah nyumbang ke situ,
sekarang butuh subtraction eksplisit `debtsOnly = totalDebtIDR() − totalCreditDebtIDR()` biar
ga double-count kalau ditampilin sebagai baris terpisah); `report-md.js` section 1 & 7 diupdate
buat match (section 1: baris ringkasan CC sekarang bilang "sudah termasuk di Debt" bukan "sudah
termasuk di Cash"; section 7 nambah subsection kartu kredit).

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet `accounts`
tipe `credit` (Data Model) — itu udah di-update penuh buat v2, JANGAN rujuk versi lama manapun
dari dokumen/percakapan sebelumnya yang masih bilang CC lewat cash path.

---

## Status "Selesai 🎉" goal: ditambahin, dicoba dibenerin, akhirnya dihapus total (2026-08)

**Konteks:** dari awal (sebelum fitur goal↔asset linking ada), goal punya badge "Selesai 🎉"
kalau `saved <= 0` (pot topup abis) SETELAH pernah ada riwayat topup/pencairan — sinyal yang
valid waktu itu karena topup adalah SATU-SATUNYA sumber value sebuah goal, jadi "pot-nya kosong"
= "episode nabung ini beres" (dipakai buat, misal, dana darurat yang abis kepake, bukan berarti
goal-nya harus dihapus, tinggal di-topup lagi kalau perlu).

**Masalah muncul setelah fitur goal↔asset linking ditambahin** (progress goal sekarang bisa
juga dari nilai asset yang di-link, bukan cuma topup) — `saved <= 0` UDAH GA CUKUP jadi sinyal
"selesai": user bisa topup dikit, cairkan lagi (saved balik 0), sementara linkedValue-nya masih
gede dan goal itu jauh dari target — badge "Selesai" salah nongol.

**Percobaan fix pertama:** tambahin syarat `linkedValue <= 0` juga (`isDone = saved <= 0 &&
linkedValue <= 0 && hasHistory`) — secara matematis bener buat kasus yang udah diidentifikasi.
TAPI user report bug-nya MASIH kejadian juga setelah fix ini (root cause pasti kemungkinan
belum sepenuhnya ke-cover — misal `linkedValue` yang naik-turun ngikutin harga pasar bikin state
"selesai" itu sendiri jadi ga stabil/gampang salah lagi di kondisi lain yang belum kepikiran,
atau ada kombinasi kasus lain yang belum tercover).

**Keputusan akhir:** daripada terus nambal kasus edge yang berpotensi terus muncul (karena
`linkedValue` itu inherently DINAMIS — nilai pasar yang naik-turun setiap saat, beda dari
`saved` yang murni transaksional/statis sampai ada transaksi baru — bikin "goal ini selesai"
jadi klaim yang riskan buat terus dijaga akurat), badge "Selesai 🎉" DIHAPUS TOTAL dari kedua
tempat yang nampilinnya (`goals.js` list, `home.js` preview). Progress goal sekarang SELALU
ditampilin sebagai persentase polos (`pct`, dibulatkan) — ga ada klaim biner "selesai/belum"
yang bisa salah, cuma angka progress yang langsung bisa diverifikasi user sendiri dari
saved+linkedValue vs target. `hasHistory` (helper yang cuma dipakai buat `isDone`) ikut dihapus
karena jadi dead code.

**Pelajaran:** status "selesai"/badge biner itu kelihatan sepele tapi computed value-nya HARUS
stabil & ga trivial buat balik ke false lagi (mis. transaksional doang, bukan nilai pasar) —
begitu satu komponen kalkulasinya bisa NAIK TURUN kapan aja (harga asset), klaim "final
state" kayak "selesai" jadi rapuh dan gampang salah di kombinasi kasus yang ga kepikiran waktu
nulis kondisinya pertama kali. Kalau nanti mau nambahin balik konsep "goal tercapai", pikirin
ulang dari nol dengan expected state yang JELAS (misal murni `pct >= 100`, bukan campuran
`saved`+`linkedValue` dengan aneka syarat "jangan sampai <= 0"), dan pertimbangkan apakah displaynya
perlu badge biner sama sekali atau persentase polos udah cukup (kayak sekarang).

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet `goals`
(Data Model) — GA ADA status "Selesai" lagi, JANGAN tambahin balik tanpa mikir ulang soal
kerapuhan yang dijelasin di atas.

---

## TASK-1: "Perubahan komposisi" report ga sum ke Δ net worth — 2 bug independen (2026-08)

**Ketemu dari:** audit data pemakaian nyata (owner baca laporan .md Agustus 2026, section 10)
— bukan dari brainstorm/spec baru. Owner nemu Σ baris "Perubahan komposisi" (−Rp 1.271.649) ga
match Δ net worth section 10 yang beneran (−Rp 1.122.979), selisih Rp 148.670.

**Kode lama (report-md.js, sebelum fix):**
```js
const addCompDelta = (key, label) => {
  const d = last[key] - prevSnapForComp[key];
  if (d !== 0) parts.push(`${label} ${signed(d)}`);
};
addCompDelta("totalCash", "Cash");
addCompDelta("totalAssets", "Assets");
addCompDelta("totalCapex", "CAPEX");
addCompDelta("totalGoalSavings", "Goal Savings");
addCompDelta("totalDebt", "Debt");
```
Nge-jumlah 5 raw field delta apa adanya, seolah `netWorth = cash + assets + capex + goalSavings
+ debt` (semua PLUS). Formula ASLINYA (`netWorthFromParts()`, calc.js): `base = cash + assets +
goalSavings - debt`, lalu `includeCapex ? base : base - capex` — `assets` di situ RAW, UDAH
TERMASUK CAPEX (bukan field terpisah yang ditambahkan).

**Bug #1 — CAPEX double count:** karena `totalAssets` snapshot itu RAW (udah termasuk CAPEX),
nambahin `totalCapex` sebagai baris TERPISAH ke sum berarti CAPEX kehitung DUA KALI. Ini persis
kelas bug yang sama kayak yang udah diantisipasi di tempat lain (`wealth.js` breakdown Total
motong CAPEX dari baris Assets biar ga double count, lihat CLAUDE.md bullet `assets` tipe
`capex`) — tapi component report-md.js ini kelewat pas ditulis, ga ngikutin pola yang sama.

**Bug #2 — Debt sign ga dinegasi:** `addCompDelta("totalDebt", "Debt")` nambahin raw
`Δdebt` (debt NAIK → angka POSITIF) ke sum, padahal formula net worth-nya `-debt` — debt naik
seharusnya KONTRIBUSI NEGATIF ke net worth. Efeknya: laporan Agustus nunjukin "Debt +1.008" yang
kebaca seolah debt naik itu NAMBAH net worth, dan ke-jumlah sebagai +1.008 alih-alih -1.008.

**Verifikasi dua bug itu SEKALIGUS jelasin selisihnya:** dari data laporan (Cash −560.950,
Assets(RAW) −61.021, CAPEX −150.686, Goal Savings −500.000, Debt(RAW) +1.008) — formula BENAR
(exclude baris CAPEX terpisah karena udah nempel di Assets, negasi Debt) ngasih
`-560.950 + -61.021 + -500.000 - (+1.008) = -1.122.979`, PERSIS match Δ net worth beneran. Kode
lama nambahin `-150.686` (CAPEX, double count) DAN pakai `+1.008` (bukan `-1.008`, sign kebalik)
→ `-1.271.649`. Dua bug itu ga saling menutupi, keduanya nyumbang ke selisih Rp 148.670 yang
diketemuin owner (150.686 − 1.008 × 2 ≈ 148.670, dua kesalahan sign/exclude nubruk kebetulan
deket, TAPI keduanya harus dibenerin terpisah — bukan satu fix nutupin dua-duanya).

**Root cause lebih dalam:** perhitungan ditulis LANGSUNG di string builder report-md.js (bukan
fungsi murni ter-test di calc.js), jadi ga ada test yang bisa nangkep dua bug sign/double-count
ini sebelum ke-ship. Pola ini (kalkulasi finansial nangkring di view/report layer, bukan
calc.js) udah berkali-kali jadi sumber bug kelas ini di app ini.

**Fix:** `netWorthComposition(prevParts, currParts, includeCapex)` (calc.js, PURE, di-test
eksplisit pakai angka ASLI dari laporan Agustus 2026 sebagai regression test) — return semua
field SEBAGAI KONTRIBUSI siap-jumlah (assets exclude CAPEX, debt udah dinegasi), `total` dihitung
LANGSUNG dari `netWorthFromParts()` (bukan re-sum manual) biar bug klasnya ga bisa kejadian lagi
walau caller lupa exclude/negasi sesuatu. report-md.js section 10 sekarang manggil fungsi ini,
plus dipaksa pakai PASANGAN BULAN YANG SAMA kayak Δ net worth section 1 (`partsNow`/`prevSnap`,
bukan 2 entri terakhir tabel trend 12-bulan section 10 sendiri, yang bisa beda pasangan bulan
kalau report digenerate buat bulan lampau) — efek sampingnya, angka Δ section 1 & "Total Δ" di
section 10 sekarang identik persis (dulu bisa beda ±Rp1 karena sumbernya beda jalur kalkulasi).

**Pelajaran:** (1) kalkulasi finansial apapun yang "kelihatan simpel" (jumlahin beberapa delta)
tetap WAJIB lewat calc.js + test, JANGAN ditulis manual di report/view layer — kelas bug ini
(double count, sign kebalik) gampang lolos review manual tapi gampang ketangkep test sekali
ditulis sebagai fungsi murni. (2) Kalau ada breakdown yang splitting satu total jadi beberapa
baris tampilan (assets vs CAPEX, dst), pola invariant "Σ baris === total" WAJIB dijamin
ALGEBRAIC (baris dihitung dari definisi yang sama-sama konsisten), bukan diasumsikan bakal cocok
karena "kelihatannya masuk akal". (3) Bug produksi paling berharga sering ketemu dari OWNER
BACA OUTPUT BENERAN (laporan .md dipakai buat analisis AI), bukan dari audit kode preventif —
worth dicatat sebagai pola buat roadmap ke depan (lihat catatan strategis di TASKS.md).

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet
`report-md.js` (bagian "Export Laporan (.md)") — `netWorthComposition()` SATU-SATUNYA cara
generate baris "Perubahan komposisi", JANGAN hitung manual lagi di string builder manapun.

---

## TASK-3: Utang CC 3,2jt vs expense Agustus 560rb — diinvestigasi, BUKAN bug (2026-08)

**Kecurigaan awal (dari audit data, export Agt 2026):** akun kartu kredit nunjukin utang total
Rp 3.210.581 (Tokopedia Card Rp 2.675.246 + Nex Card Rp 535.335), tapi total expense tercatat
BULAN AGUSTUS (semua akun digabung, section 2 report) cuma Rp 560.950. Kecurigaannya: ada belanja
CC yang "lolos" — entah ke-catat lewat jalur yang bukan `expense` biasa, atau ada bug di mekanisme
saldo akun credit yang bikin angka gede muncul tanpa jejak transaksi.

**Investigasi (pakai `Export_Aug_2026.md` asli, bukan data karangan):**
1. **Argumen konservasi uang.** Total expense Agustus (SEMUA kategori, SEMUA akun — bukan cuma
   CC) cuma Rp 560.950. Bahkan kalau 100% expense itu SEMUANYA ke CC (skenario paling ekstrem),
   itu cuma bisa jelasin maksimal Rp 560.950 dari Rp 3.210.581 total utang CC. Sisanya, MINIMAL
   Rp 2.649.631 (≈82,5% dari total utang), SECARA MATEMATIS TIDAK MUNGKIN berasal dari transaksi
   Agustus — harus dari `initialBalance` akun Tokopedia/Nex Card saat dibuat. Owner sendiri udah
   konfirmasi app efektif dipakai mulai 1 Agustus, jadi `initialBalance` negatif di kedua akun CC
   itu = utang CC RIIL yang emang udah ada sebelum mulai pakai app (diisi manual saat setup akun,
   sesuai pola yang didokumentasikan di CLAUDE.md bullet `accounts` — "Saldo awal 0 = belum ada
   tagihan berjalan... isi negatif kalau udah ada tagihan saat mulai pakai app").
2. **Audit kode — jalur yang bisa ubah saldo akun.** `accountBalances()` (calc.js) 100% derived
   dari jurnal: `bal[id] = initialBalance`, lalu di-+/− tiap transaksi (expense/income/transfer)
   — TIDAK ADA state saldo yang disimpan terpisah buat di-drift. Grep `patch("accounts", ...)` di
   SELURUH `js/` — CUMA SATU pemanggil, di `#ac-save` (form Edit Akun, `accounts.js`), user-
   initiated & eksplisit. Reconcile (`openReconcileSheet`) — sempat dicurigai sebagai kandidat
   "jalur diam-diam" — TERNYATA bikin TRANSAKSI biasa (`add("transactions", {type: diff<0
   ?"expense":"income", categoryId:"cat_adjust_out"/"cat_adjust_in", ...})`), BUKAN nge-patch
   saldo/initialBalance langsung. "💳 Bayar Tagihan" (`openPayCreditSheet`) juga transaksi
   `transfer` biasa. Ga ketemu jalur manapun yang bisa ngubah saldo CC TANPA bikin transaksi.
3. **Bukti pendukung dari data asli.** Section 3 report (Expense per Kategori Agt 2026) beneran
   nunjukin baris "⚖️ Penyesuaian Saldo Rp 17.000" — bukti LANGSUNG bahwa mekanisme reconcile di
   app ini emang lewat transaksi normal (nongol di laporan expense), bukan patch tersembunyi.

**Kesimpulan: BUKAN bug.** Utang CC Rp 3.210.581 legit — mayoritas (≥82,5%, kemungkinan besar
seluruhnya) berasal dari `initialBalance` yang diisi saat akun Tokopedia Card/Nex Card dibuat,
merepresentasikan utang CC riil yang udah ada sebelum owner mulai pakai app 1 Agustus 2026. Ga
ada jalur kode yang bisa mengubah saldo akun (credit maupun tipe lain) tanpa membuat transaksi —
prinsip "saldo TIDAK PERNAH disimpan, selalu derived dari jurnal" (CLAUDE.md) TETAP terjaga
konsisten di semua jalur (reconcile, bayar tagihan, form edit akun). **Kode TIDAK diubah** — sesuai
instruksi TASK-3 kalau ternyata normal.

**Keterbatasan investigasi:** ga ada akses ke `initialBalance` PERSIS kedua akun CC ini atau
riwayat transaksi History mentah (di luar apa yang ke-summary di `Export_Aug_2026.md`) — jadi
argumen di atas itu BOUND matematis (≥82,5% pasti dari initialBalance), bukan rekonsiliasi 100%
sampai ke rupiah terakhir. Kalau owner mau verifikasi exact, tinggal cek `initialBalance` di
Setting → Akun → Edit Tokopedia/Nex Card, atau share backup JSON lengkap.

**Pelajaran:** kecurigaan "angka gede tanpa jejak yang cukup" itu valid buat diinvestigasi, TAPI
jangan langsung asumsikan bug — cross-check dulu SATU angka (total expense bulan itu) terhadap
timeline pemakaian app (app baru dipakai N hari) sering udah cukup buat nge-bound seberapa
mungkin sumbernya dari transaksi tercatat vs data awal/setup. Kombinasi argumen matematis (bound
dari data agregat) + audit kode (pastikan ga ada jalur mutasi tersembunyi) bisa nutup investigasi
tanpa butuh akses ke setiap baris transaksi mentah.

---

## TASK-2: Goal savings — "Rp 0" vs "Terkumpul Rp 512.542" kontradiktif (2026-08)

**Ketemu dari:** audit data pemakaian nyata (export .md Agustus 2026, sama kayak TASK-1/TASK-3)
— owner liat goal "Dana Pensiun" (di-fund via reksadana BIBIT yang di-link, `linkedAssetIds`)
nunjukin dua cerita beda: section 1 bilang "Goal savings: Rp 0", section 8 bilang "Terkumpul
Rp 512.542 = topup Rp 0 + asset Rp 512.542". Kelihatan kontradiktif walau dua-duanya SECARA
TEKNIS benar.

**Kenapa ini BUKAN bug kalkulasi (dari awal udah didesain gini, sengaja):** `totalGoalSavingsIDR()`
(dipakai `netWorthIDR()`) SENGAJA cuma topup tunai — nilai asset ter-link (`linkedValue`) udah
kehitung PENUH di `totalAssetsIDR()` lewat jalur normal, nambahin lagi ke goal savings bakal
DOUBLE-COUNT net worth (lihat CLAUDE.md bullet `goals`, fitur goal↔asset-linking). Jadi "Goal
savings: Rp 0" itu ANGKA YANG BENAR buat konteks net worth. Masalahnya murni **tampilan**: angka
itu ditampilin SENDIRIAN tanpa konteks di section 1, sementara section 8 nampilin angka gabungan
(`progress` = tunai + aset) yang jauh lebih besar TANPA breakdown eksplisit yang cukup jelas di
section 1 buat ngejelasin kenapa dua angka itu beda cerita.

**Root cause di UI:** progress bar/pct/angka utama goal (`goalDisplayStats().progress`, dipakai
`goals.js` list + `home.js` preview + `report-md.js` section 8) dari awal MEMANG udah gabungan
(tunai+aset, keputusan yang masuk akal buat goal yang di-fund via asset kayak Dana Pensiun) —
tapi beberapa tempat cuma nampilin angka gabungan itu doang tanpa breakdown yang cukup eksplisit,
dan section 1 report (baris "Goal savings", represents net worth) ga dikasih tau sama sekali
kalau ada goal ber-asset-link yang bikin angka tunainya "kelihatan kecil".

**Fix (murni tampilan, formula net worth TIDAK disentuh):**
- **Keputusan resmi (didokumentasikan, bukan cuma default implisit lagi):** progress
  bar/pct/`progress` TETAP (tunai + aset) — dipertahankan, bukan diubah ke tunai-doang, karena
  buat goal ber-asset-link itu representasi progress yang lebih masuk akal. TAPI sekarang WAJIB
  dibarengi breakdown eksplisit di SEMUA tempat: `goals.js` list (baris "💰 Ditabung (tunai): X ·
  📈 Dari N asset ter-link: Y" + catatan kaki likuiditas), `home.js` preview (baris kecil "tunai X
  + aset Y"), `report-md.js` section 1 (baris Goal savings nambah "(tunai) + Rp Y (dari asset
  ter-link, sudah termasuk di Assets)" kalau totalnya > 0), section 8 (header kolom eksplisit
  "Terkumpul (tunai+aset)" + breakdown "tunai X + aset Y" + catatan kaki).
- Net worth, `totalGoalSavingsIDR()`, `goalSavedIDR()`, `goalLinkedAssetsValueIDR()`,
  `goalProgressIDR()` — **TIDAK ada satupun yang diubah**. Verifikasi: task ini cuma nyentuh
  `js/views/goals.js`, `js/views/home.js`, `js/report-md.js` (string/HTML doang), `js/calc.js`
  SAMA SEKALI ga disentuh, jadi net worth dijamin identik sebelum/sesudah by construction (ga
  perlu re-test calc.js buat task ini).

**Pelajaran:** angka yang "secara teknis benar" bisa tetap MENYESATKAN kalau ditampilin tanpa
konteks di tempat yang beda definisi — kombinasi (tunai-only) vs (tunai+aset) yang keduanya valid
untuk PURPOSE beda (net worth vs progress tracking) itu WAJIB selalu tampil BERDAMPINGAN dengan
label eksplisit di mana pun kombinasi itu bisa kelihatan, bukan diasumsikan user bakal nyambungin
sendiri dari section yang beda. Pola serupa kayak TASK-1 (Σ komposisi vs Δ net worth) — audit
data pemakaian nyata lagi-lagi lebih efektif nemuin gap presentasi kayak gini dibanding review
kode preventif.

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet `goals`
(Data Model, paragraf "Progress bar/pct/`progress` SENGAJA...") — breakdown tunai vs aset WAJIB
ada di setiap tempat goal progress ditampilin, JANGAN balik ke satu angka gabungan polos.

---

## Blur mode bolong: sumtabs Wealth & jumlah unit asset ga ke-mask (2026-08)

**Konteks:** blur mode (toggle 👁️ di card Total Balance) dirancang biar SEMUA angka finansial
ke-mask jadi asterisk pas layar keliatan orang lain. Mekanismenya `blurNum()` (`utils.js`)
bikin `<span class="blur-num" data-mask="...">`, dan `fmtIDR()`/`fmtUSD()` udah otomatis lewat
situ — jadi kebanyakan tempat "otomatis aman" asal pakai formatter itu.

**Bug yang ketemu:** owner report angka masih keliatan pas blur mode nyala di beberapa tempat:
chip ringkasan "Total/Assets/Liquid/Debt" di atas halaman Wealth (`sumtabs`), dan jumlah unit
asset (qty lot/lembar/share) di list Assets. Root cause beda-beda tapi pola sama — dua tempat
ini SENGAJA (atau ga sadar) ga lewat `fmtIDR`/`fmtUSD`:
1. Sumtabs pakai `fmtShort()` (formatter angka ringkas "2.1jt", bukan `fmtIDR`) supaya muat di
   chip kecil — dan `fmtShort()` MEMANG sengaja ga auto-blur, karena dia juga dipakai di
   `milestonePaceLine()` yang outputnya ikut ke laporan .md (plain text, HTML span bakal
   ngerusak markdown-nya). Konsekuensinya: SETIAP pemakaian `fmtShort()` di DOM baru wajib
   inget bungkus manual, ga otomatis kayak fmtIDR — poin ini kelewat pas sumtabs awalnya ditulis.
2. Jumlah unit asset (`5 lot`, `10.5 sh`) itu bukan nilai Rp sama sekali, jadi ga pernah lewat
   `fmtIDR`/`fmtUSD` — dari awal emang ga ada mekanisme yang otomatis nge-mask-nya, harus
   `blurNum()` manual eksplisit tiap tempat qty itu dirender (mirip kasus "saldo awal akun" di
   `accounts.js` yang jadi contoh asli kenapa `blurNum()` manual itu perlu ada).

**Fix:** `js/views/wealth.js` — sumtabs (`fmtShort(n)` → `blurNum(fmtShort(n))`), qty di
`assetRow()` (list Assets), qty di detail transaksi beli/jual, dan hint live "Avg buy"/"Dimiliki
sekarang" di sheet Catat Pembelian/Penjualan (yang terakhir ini butuh ganti `textContent` →
`innerHTML` dulu, soalnya `blurNum()` ngehasilin HTML span, bukan plain text). Ga nyentuh
`calc.js` — murni bug tampilan, jumlah/nilai yang dihitung ga berubah.

**Sengaja BELUM dibenerin (di luar scope waktu itu):** baris pace Main Milestone ("Sisa 5
bulan · perlu ± RpXjt/bln · surplus rata-rata lo RpYjt/bln...", `milestonePaceLine()`,
muncul di Home & Wealth) MASIH bocor pas blur mode nyala — dia satu fungsi yang sama dipakai
buat teks DOM (harusnya blur) DAN isi laporan .md (harus tetap plain text, HTML span bakal
ngerusak markdown). Butuh mikirin ulang API-nya (misal return angka mentah + template terpisah
per konteks, bukan satu string jadi) sebelum dibenerin — bukan sekadar tempel `blurNum()`.

**Pelajaran:** formatter yang **kelihatan** kayak "formatter angka biasa" (`fmtShort`) tapi
dipakai LINTAS KONTEKS (DOM ber-blur DAN teks plain non-DOM) itu jebakan — gampang lupa yang
satu butuh treatment beda dari yang lain. Kalau nambah formatter baru yang bakal dipakai di DOM,
default-nya harus JELAS: auto-blur (kayak `fmtIDR`) atau eksplisit "caller wajib bungkus sendiri"
(kayak `fmtShort` sekarang, sekarang didokumentasikan eksplisit di CLAUDE.md) — jangan biarin
ambigu.

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bagian blur mode
(section Home page) — `fmtShort()` butuh `blurNum()` manual tiap dipakai di DOM, qty asset juga
WAJIB `blurNum()` manual di tampilan read-only manapun.

---

## TASK-4: Bond/SBN Ritel — kenapa kupon TIDAK dihitung otomatis (2026-08)

**Konteks:** nambah tipe asset baru `bond` (Obligasi/SBN Ritel — ORI, SR, SBR, ST) buat nge-track
posisi investasi obligasi ritel Indonesia. Mekanismenya: beli senilai `principal`, dapet kupon
periodik yang cair ke rekening, pokok balik 100% saat jatuh tempo. Ini keputusan owner yang
EKSPLISIT ditulis di spec (TASKS.md), bukan hasil investigasi/debat — dicatat di sini biar
alasannya ga ilang kalau nanti ada yang kepikiran "kenapa ga diotomatisasi aja sekalian".

**Kenapa kupon ga dihitung/di-auto-post otomatis** (padahal secara teknis gampang: `principal ×
couponRatePA/12 × couponPeriodMonths` per bulan, mirip pola declining-balance CAPEX yang emang
auto):
1. **Pajak.** Kupon SBN kena PPh final 10% dipotong LANGSUNG oleh penerbit/kustodian sebelum
   duitnya nyampe ke RDN — nominal yang BENERAN cair ≠ hasil kali rate mentah. Auto-post bakal
   selalu salah (kelebihan) kecuali app ikut ngitung pajak, yang nambah kompleksitas & rawan
   meleset dari aturan pajak yang bisa berubah.
2. **Pembulatan & mekanisme kustodian.** Nominal kupon aktual dibulatkan/disesuaikan oleh sistem
   kustodian (BI-SSSS dkk), bukan hasil kali matematis bersih dari rate — auto-post bakal
   nunjukin angka yang KELIHATAN presisi tapi sebenarnya cuma estimasi, menyesatkan.
3. **Timing mutasi RDN ga presisi ke tanggal kalender.** Kupon dijadwalkan tanggal tertentu tapi
   mutasi RDN riil bisa maju/mundur beberapa hari kerja (weekend, hari libur, proses bank) — auto-
   post berbasis tanggal bakal nyatet transaksi di hari yang belum tentu match saldo RDN aktual,
   ngerusak reconcile.
   
   Beda dari CAPEX (yang MEMANG auto — depresiasi itu murni definisi matematis, ga ada pajak/
   timing pihak ketiga yang bikin angka riilnya beda dari hasil formula) — kupon SBN punya TIGA
   sumber ketidakpastian sekaligus yang cuma bisa diselesaikan dengan user konfirmasi manual tiap
   kali kupon beneran cair.

**Keputusan:** `bondNextCouponHint()` (calc.js) cuma kasih ESTIMASI (SEBELUM pajak, badge jelas
"perkiraan") buat bantu user inget & isi form lebih cepat — TIDAK PERNAH dipakai buat bikin
transaksi otomatis. User WAJIB buka "💰 Catat Kupon Masuk" dan isi/koreksi nominal aktual manual
tiap kupon cair.

**Keputusan arsitektur terkait: `assetDir` diperluas jadi 3 arah ("buy"/"sell"/"redeem").**
Pencairan pokok (`openBondRedeemSheet()`) SENGAJA dimodelkan lewat jalur `assetId`+`assetDir`
yang UDAH ADA (bukan bikin field baru) — arah `"redeem"` ditambahkan, TAPI beda pola dari buy/
sell: ga pakai `assetQty`/`assetPrice` (bond ga punya qty-tracking), efeknya `redeemed:true`/
`false` (bukan mutasi `quantity`). Ini butuh 3 tempat nge-tau soal arah baru ini: (1)
`db.js` `applyAssetQtyEffect()` — reversal hapus transaksi, (2) `integrity.js` — validasi
assetId+assetDir (kalau lupa, transaksi redeem ke-flag false-positive "invalid" karena
assetQty/assetPrice kosong — ini KETANGKEP & DIBENERIN pas nulis fitur ini, bukan lolos ke
production), (3) `home.js` `openTxDetail()`/`txRow()` — routing & label tampilan. Kupon TIDAK
lewat jalur `assetId` sama sekali (transaksi income biasa, tanpa referensi balik ke bond) —
SENGAJA beda dari redeem, karena kupon emang ga perlu dilacak balik (bukan trade/perubahan
kepemilikan asset), sementara redeem itu literally "penjualan"/penutupan posisi asset yang
butuh jejak balik.

**Pelajaran:** nambah "arah" baru ke pola `assetId`+`assetDir` yang udah establish (buy/sell)
itu GAMPANG kelupaan satu tempat, karena polanya ke-assumsi "semua assetDir sama" di beberapa
tempat (integrity.js validation yang kejadian di sini). Kalau nambah arah baru lagi ke depan,
audit SEMUA tempat yang baca `t.assetDir` (bukan cuma grep `"sell"`/`"buy"` literal, itu bisa
kelewat arah baru yang belum ada literal-nya).

**State operasional sekarang & aturan yang WAJIB dipatuhi:** lihat CLAUDE.md bullet `assets`
tipe `bond` — dua aksi terpisah (Catat Kupon Masuk = income biasa TANPA assetId; Cairkan Pokok =
transfer ber-assetId+assetDir:"redeem"), kupon TIDAK PERNAH auto-post.

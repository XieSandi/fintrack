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

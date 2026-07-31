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

# FinTrack — Project Context

Personal finance tracker PWA milik satu user (owner repo). Live di https://xiesandi.cyou/fintrack
(GitHub Pages, custom domain, subpath). Track expense harian, budget bulanan, assets, debt,
net worth menuju target Rp 100 juta akhir 2028.

File ini isinya aturan "apa yang berlaku SEKARANG" buat kerja sehari-hari. Narasi historis
"kenapa" di balik insiden/keputusan desain besar (provider harga IDX, infinite-reload-loop,
bug timezone, dll) ada di `DECISIONS.md` — baca itu kalau butuh konteks lengkap, bukan cuma
aturan ringkasnya.

**Konsep target — sengaja 2 sistem terpisah (keputusan owner):**
- **🏆 Main Milestone** — SATU angka besar (`settings.targetNetWorth`), benchmark net worth
  jangka panjang, pasif (progress otomatis dari `netWorthIDR()`, ga ada topup). Setup di
  Setting → "Main Milestone & Kurs". Ditampilkan di card Total Balance (Home) + banner Net
  Worth (Assets/Wealth).
- **🎯 Short Term Goals** — BISA BANYAK, topup/pencairan aktif (collection `goals`). Setup +
  kelola di `#/goals` (menu di Setting). Ditampilkan preview-nya di Home.
Jangan gabungin dua konsep ini atau rename salah satunya tanpa sadar bedanya — Milestone itu
"North Star" tunggal, Goals itu daftar target aktif yang bisa nabung/cair beneran.

## Stack & Prinsip (JANGAN diubah tanpa diskusi)

- **Vanilla JS (ES modules) + plain CSS. ZERO build step.** No framework, no bundler, no npm.
  Push ke `main` = deploy. Jangan introduce React/Vite/Tailwind/tooling apapun.
- **Firebase**: Auth (Google Sign-In) + **Firestore** dengan `persistentLocalCache` = offline-first.
  Data path: `users/{uid}/...`, dikunci Security Rules per-uid. Config di `js/firebase.js`
  sengaja hardcoded (client-side, bukan secret; proteksi = rules + authorized domains + API key
  HTTP-referrer restriction).
- **Semua path relative (`./`)** karena hosting di subpath `/fintrack/`. Jangan pakai absolute path.
- Bahasa UI: Indonesia santai (lo/gue). Format uang: `Intl id-ID` → "Rp 1.500.000".
- **Copy UI sengaja MINIM.** App satu user (owner) yang udah hafal semua fitur — JANGAN nambah
  teks tutorial/penjelasan cara kerja fitur ("nilai dihitung otomatis tiap bulan pakai...", "pilih
  X di dropdown Y biar Z"). Yang BOLEH panjang cuma teks yang isinya KONDISI/INSIGHT data
  finansial: angka + konteksnya (pace milestone, estimasi kupon, sisa limit, preview sebelum
  aksi destruktif, hasil cek integritas, peringatan state kayak "⚠️ Belum jatuh tempo").
- **Tema: calm dark.** Base slate desaturated (`--bg #101318`, bukan hitam pekat), aksen diredam
  (`--green #8fbe9f`, `--red #d99494`, `--blue #8bacd0`, `--yellow #d9bc7f`) — JANGAN balikin ke
  warna neon/saturated. Pola var: `--x` (teks/garis aksen), `--x-dim` (background state aktif &
  badge), `--x-edge` (border state aktif). Warna di inline style JS pakai `var(--x)`; warna buat
  Chart.js WAJIB literal hex (canvas ga bisa resolve CSS var) — kalau ganti palet, dua-duanya
  harus diupdate bareng biar chart ga beda sendiri.
- **Layout: mobile-first + satu breakpoint desktop `@media (min-width: 860px)`** (`css/style.css`,
  blok paling bawah). Di desktop: kolom `.view` melebar ke `--maxw` (940px), header pakai wrapper
  `.header-inner` biar konten sejajar sama kolom (background tetap full-width), bottom nav jadi
  pill mengambang (bukan bar full-width yang ke-stretch di monitor lebar), bottom sheet jadi
  modal tengah (`popin`, bukan `slideup`), dan slider horizontal (akun/budget/goals) wrap jadi
  grid. Hover state dikurung `@media (hover:hover) and (pointer:fine)` biar di HP ga ada state
  nyangkut sehabis tap.

## Arsitektur

```
index.html            shell: header, #view, FAB, bottom nav, sheet, toast
css/style.css         dark theme (calm/desaturated), mobile-first + breakpoint desktop 860px
js/app.js             entry: auth flow, hash router (ROUTES), month picker, SW register + auto-update
js/firebase.js        init SDK via CDN gstatic + offline persistence
js/store.js           state global + onSnapshot listeners; wrapper tipis ke js/calc.js buat
                       derived calc (bind ke `state` global) — lihat js/calc.js
js/calc.js            fungsi kalkulasi MURNI (saldo, net worth, dll) — TIDAK import Firebase,
                       terima `state` sebagai parameter, ditest lewat tests/calc.test.mjs
js/db.js              repository: CRUD generik, seeding kategori, snapshot bulanan, export/import
                       backup, bulkDelete()/previewBulkDelete() (reset data, js/views/danger.js)
js/prices.js          auto price: TradingView (IDX, tanpa key), Finnhub (US), CoinGecko (crypto)
js/kurs.js            kurs USD/IDR auto via frankfurter.app, cache localStorage
js/tx-sheet.js        bottom sheet tambah/edit transaksi (quick-add)
js/recurring-sheet.js sheet "Awal Bulan": konfirmasi post recurring + opsi salin budget
js/report-md.js       buildMonthlyReport(month) → laporan finansial .md siap paste ke AI
js/integrity.js       scanIntegrity(state) → cek referensi yatim, read-only (Setting → "🩺")
js/utils.js           format, tanggal, toast, openSheet/closeSheet, escapeHtml, blur mode, copyText,
                       hardRefresh
js/views/             home, transactions, budget, wealth, settings, accounts, categories, goals,
                       recurring, danger
tests/calc.test.mjs   smoke test manual buat js/calc.js — BUKAN runtime app, sengaja GA masuk
                       PRECACHE sw.js (lihat ATURAN WAJIB #8)
sw.js                 service worker: precache shell, runtime cache gstatic+jsdelivr
```

Routing: hash (`#/home`). Nav: Home · History (transactions) · Assets (wealth) · Setting.
Budget/Akun/Kategori/Goals/Recurring/Danger (`#/danger`, "🗑️ Reset Data") = subpage di dalam
Setting (punya `back` di ROUTES).

### Home page (`js/views/home.js`)

Urutan section (top→bottom): **Filter periode** (tabs Hari/Minggu/Bulan/Tahun + Custom range
via sheet date picker, state module-level `period`, ga persist ke Firestore) → **Card Total
Balance** (cash-only by default (`totalCashIDR()`); toggle "+ Assets" ganti ke `netWorthIDR()`
penuh — cash + assets + goal savings **− debt**, BUKAN cuma nambahin assets doang. Jangan lupa
subtract debt lagi kalau ada yang refactor bagian ini, pernah kelewat sebelumnya — plus
Income/Expense/Surplus yang ke-filter sesuai periode di atas, plus progress bar
**🏆 Main Milestone** di bagian bawah card — vs `netWorthIDR()`, target-nya sama dengan yang di
banner Wealth) → **Akun** (horizontal scroll saldo per akun) → **🎯 Short Term Goals** (preview
horizontal scroll, "Kelola →" ke `#/goals`) → **Budget bulan ini** (preview, "Kelola →" ke
`#/budget`) → **Transaksi terakhir** (di luar `.card`, sama pola header row-nya kayak
Akun/Goals/Budget — bukan section terpisah yang punya card sendiri; 3 terbaru, txRow()
di-share ke `transactions.js`).

Blur mode (toggle 👁️ di card Total Balance) nge-mask semua `<span class="blur-num">` jadi asterisk
(BUKAN CSS `filter:blur()` lagi). **Mask-nya PANJANG TETAP buat SEMUA nominal** (`content:"******"`
di-hardcode di `body.blur-mode .blur-num::after`, `css/style.css`) — dulu panjangnya ngikutin teks
asli lewat `attr(data-mask)`, dan itu BOCOR: jumlah asterisk-nya sendiri udah ngasih tau ordo
angkanya (Rp 50.000 vs Rp 1.500.000 beda lebar = ketebak). Mask di CSS, BUKAN di-generate JS,
supaya mustahil ada span yang panjangnya beda. Teks aslinya dibungkus `<span class="bn-real">`
(dibikin otomatis sama `blurNum()`) dan pas blur di-**`display:none`** — BUKAN `visibility:hidden`
kayak dulu — biar lebar box-nya ikut collapse ke lebar mask; kalau box-nya masih selebar angka
asli, ordo-nya tetep ketebak dari lebar/posisi asterisk (paling kelihatan di kolom rata-kanan
`.tx-amt`/`.asset-right`). Warna semantik (hijau/merah/dll) tetep kebawa ke asterisk karena
`color` cuma inherit, ga di-override. `fmtIDR`/`fmtUSD` udah lewat `blurNum()` otomatis; kalau ada
view yang mau nge-blur teks lain (bukan lewat `fmtIDR`/`fmtUSD`, kayak saldo awal akun di
`accounts.js`) WAJIB bungkus pakai `blurNum(text)` juga — JANGAN nulis `<span class="blur-num">`
manual, karena yang bikin lebarnya collapse itu `.bn-real` di dalamnya.
`fmtShort()` (angka ringkas "2.1jt") KHUSUSNYA **TIDAK** auto-blur kayak `fmtIDR`/`fmtUSD` — dia
juga dipakai buat teks non-DOM (`milestonePaceLine()`, ikut ke laporan .md), jadi caller yang
nampilin hasilnya di DOM (mis. sumtabs Total/Assets/Liquid/Debt di `wealth.js`) WAJIB bungkus
manual `blurNum(fmtShort(n))` — kelewat sebelumnya (sumtabs sempet ga ke-blur sama sekali padahal
breakdown card di bawahnya udah kena). Jumlah unit asset (qty lot/lembar/share, BUKAN cuma nilai
Rp-nya) juga WAJIB kena blur di tampilan read-only (`assetRow()`/detail transaksi asset/hint
Catat Pembelian-Penjualan di `wealth.js`) — "berapa banyak yang lo punya" sama sensitifnya kayak
nilainya. Chart.js (canvas, ga bisa kena CSS) pakai jalur terpisah: cek `isBlurred()` langsung di
tick callback (`wealth.js`, balikin `BLUR_MASK` dari utils.js — konstanta yang SAMA dipakai CSS,
biar mask di chart & di teks DOM ga beda panjang). State toggle di localStorage — bukan re-render.

## Data Model (Firestore `users/{uid}/`)

- `accounts` — kantong uang (bank/ewallet/cash/rdn/broker/**credit**), currency IDR/USD,
  initialBalance, `accountNumber?`.
  **`accountNumber`** (string opsional, no. rekening / no. kartu) — **SENGAJA cuma hidup di
  dokumen `accounts` + tampilan `#/accounts`**. DILARANG masuk ke: `breakdown.accounts` snapshot
  (`upsertSnapshot()`, db.js) dan `buildPosition()` (report-md.js) — dua-duanya nyuapin section 5
  laporan .md yang emang dibikin buat DI-PASTE KE CHAT AI, jadi nomor rekening ga boleh ikut
  keluar (keputusan owner eksplisit). Dua mapping itu ambil field satu-satu (bukan spread `...a`)
  — pertahankan begitu, dan ada komentar guard di dua-duanya. Backup JSON (`exportAll()`) BEDA
  URUSAN: itu nge-spread dokumen apa adanya jadi `accountNumber` IKUT ke-backup — itu BENAR &
  perlu (kalau ngga, restore bakal ngilangin nomornya); backup file lokal, bukan buat dikirim ke
  AI. Disimpan apa adanya sebagai STRING (jangan `Number()`/`parseAmount()` — angka depan 0 bisa
  ilang, dan formatnya bisa ada spasi/strip). Ditampilin di row akun biasa DAN row kartu kredit
  lewat SATU helper `acctNumberRow()` (accounts.js) + tombol 📋 copy (`copyText()` utils.js).
  Nomornya ikut **blur mode** (`blurNum()`) — sama sensitifnya kayak nominal — tapi yang di-copy
  SELALU nilai asli dari data, bukan teks DOM yang lagi ke-mask. Tombol copy-nya
  `e.stopPropagation()` (row akun biasa itu clickable → buka sheet edit). **Saldo TIDAK disimpan** — dihitung dari jurnal: initialBalance ± transaksi
  (lihat `accountBalances()`). Reconcile ("⚖️ Sesuaikan Saldo" di sheet edit akun, `accounts.js`)
  TIDAK overwrite saldo — bikin 1 transaksi adjustment (expense/income, kategori
  `cat_adjust_out`/`cat_adjust_in`) sebesar selisih aktual vs tercatat, biar tetap auditable di
  History. Berlaku juga buat akun tipe `credit`, ga perlu kode khusus (generic).
  **Tipe `credit`** (kartu kredit) — field tambahan `creditLimit` (angka, 0/kosong = tanpa
  limit). **Utang CC = saldo negatif akun-nya, DERIVED, BUKAN debt entity terpisah** — konsisten
  sama prinsip "saldo ga pernah disimpan" di atas. Belanja pakai CC = expense BIASA (accountId =
  akun credit) — TIDAK ada field/mekanisme baru di `accountBalances()`, expense generic udah
  nurunin balance dan karena CC mulai dari 0 balance negatif OTOMATIS = utang.
  **Kalkulasi/presentasi lewat DEBT PATH** (v2, 2026-08 — v1 dulu lewat cash path, dipindah atas
  permintaan owner, lihat `DECISIONS.md` buat alasan lengkapnya): `totalCashIDR()` SEKARANG
  EXCLUDE utang CC (balance negatif akun credit dianggap 0 di situ), `totalDebtIDR()` SEKARANG
  INCLUDE-nya (`= Σdebts.totalOutstanding + totalCreditDebtIDR()`). **Model data & mekanisme
  transaksi TIDAK berubah** — CC tetap akun biasa (bukan dipindah ke collection `debts`), belanja
  & transfer tetap generic lewat `accountId`; yang berubah CUMA kalkulasi mana yang nge-consume
  saldo CC. Edge case saldo CC POSITIF (overpay) TETAP keitung di `totalCashIDR()` (bagian
  positif doang, bukan di-exclude) — `totalCreditDebtIDR()` cuma ngitung bagian negatif/utang,
  jadi ga ada value yang "ilang" dari net worth buat sign manapun (di-test eksplisit,
  `calc.test.mjs`). Net worth VALUE-nya sendiri TIDAK berubah dari v1 ke v2, cuma direkategorisasi
  — `netWorthIDR()` formula-nya tetap `cash + assets + goalSavings − debt`, ga disentuh. Helper
  murni (`calc.js`, semua di-test): `isCreditAccount(acct)`, `creditUsed(acct, balances)`
  (`balance < 0 ? -balance : 0`), `creditRemaining(acct, balances)` (`limit − used`, **`null`**
  kalau limit 0/kosong — bukan `0`, biar UI bisa bedain "unlimited" dari "abis/over"),
  `totalCreditDebtIDR(state)` (agregat SEMUA akun credit, IDR — dipakai LANGSUNG di
  `totalDebtIDR()` DAN buat breakdown tampilan). `isCreditAccount`/`creditUsed`/`creditRemaining`
  DIDEFINISIKAN SEBELUM `totalCashIDR()` di calc.js sekarang (fungsi itu butuh
  `isCreditAccount()`) — jangan taruh definisi baru yang butuh helper ini sebelum bloknya.
  UI (`accounts.js`) TIDAK pernah nampilin saldo CC sebagai angka signed polos (`-Rp 50.000`
  bisa disangka "ada uang") — selalu "Terpakai / Limit / Sisa" + progress bar (pola sama budget:
  `pct≥100 p-red, pct≥90 p-yellow, else p-green`). Shortcut **"💳 Bayar Tagihan"**
  (`openPayCreditSheet()`, accounts.js) = transfer BIASA (accountId = akun cash sumber,
  toAccountId = akun CC) lewat jalur transfer generic yang udah ada (SAMA persis kayak transfer
  akun-ke-akun manual) — BUKAN jalur khusus kayak topup goal/beli asset, jadi `type:"transfer"`
  otomatis TIDAK masuk `monthSummary().expense`. Nominal default = `creditUsed` sekarang, boleh
  overpay (saldo CC jadi positif) — non-blocking warning, bukan diblokir. Warning **over-limit**
  (limit > 0 DAN creditUsed sesudah expense > limit) di-cek di `openTxSheet()` (tx-sheet.js)
  SETELAH transaksi tersimpan (toast, bukan `confirm()` yang blocking — transaksi TETAP kesimpen).
  Breakdown Total tab Wealth: "💧 Liquid" = `totalCashIDR()` apa adanya (udah bersih dari CC,
  ga perlu koreksi lagi), "💳 Cicilan" dipisah dari "🪪 Kartu Kredit" —
  `debtsOnly = totalDebtIDR() − totalCreditDebtIDR()`, dua-duanya sum PERSIS ke net worth (pola
  SAMA kayak CAPEX misahin `investAssets` dari baris CAPEX). Tab **Liquid** (Wealth) SEKARANG
  TIDAK nampilin akun credit SAMA SEKALI (bukan cuma dikelompokkan terpisah — pindah total ke
  tab Debt). Tab **Debt** (Wealth) SEKARANG nampilin akun credit di section "🪪 Kartu Kredit"
  terpisah dari list `debts` collection (field beda: Terpakai/Limit, bukan
  Cicilan/JatuhTempo/SisaBulan), klik → `openAcctSheet()` (accounts.js, di-export khusus buat
  ini, dipakai wealth.js) — BUKAN `openDebtSheet()`. **Beda CC vs `debts` (collection):** CC =
  revolving/akun, utang derived dari saldo, TANPA `debtId`; `debts` = cicilan TETAP
  (monthlyInstalment/dueDay/remainingMonths), attached ke transaksi via `debtId`. Dua konsep
  TERPISAH secara MODEL DATA (CC tetap bukan `debts` doc) meskipun sekarang SAMA-SAMA masuk
  `totalDebtIDR()` — `report-md.js` section 7 (Hutang) nunjukin dua-duanya di section yang sama
  tapi subsection terpisah, section 1 nambah baris ringkasan "🪪 Kartu Kredit terpakai (sudah
  termasuk di Debt di atas)". Kalau nanti mau nambah installment/cicilan 0% buat CC, itu tetap
  konsep terpisah dari `debtId` yang udah ada — JANGAN dicampur.
- `categories` — {name, icon, type: expense|income, isPreset}. Preset awal via `seedIfNeeded()`
  (sekali doang, first-run); preset baru buat user lama via `ensurePresetCategories()` (tiap
  sesi, idempotent) — lihat Known Quirks. Ga bisa dihapus kalau masih dipakai transaksi
  (guard di `categories.js`).
- `transactions` — {date, time?, month:"YYYY-MM", amount, type: expense|income|transfer, accountId,
  toAccountId?, toGoalId?, fromGoalId?, categoryId, debtId?, assetId?, assetDir?, assetQty?,
  assetPrice?, feeOfTxId?, note}. Transfer = 1 record, BUKAN expense.
  **Biaya tambahan** (`feeOfTxId`, biaya admin transfer / parkir / dll) — biaya dimodelkan
  sebagai **transaksi `expense` TERPISAH** yang nunjuk ke transaksi induknya lewat `feeOfTxId`,
  **BUKAN field `fee` di transaksi induk**. Ini KEPUTUSAN SADAR: kalau biaya cuma jadi field,
  SEMUA yang ngagregasi uang (`accountBalances()`, `monthSummary()`, `spentByCategory()`, budget,
  report-md, integrity) harus diajarin satu-satu soal field itu — persis jebakan yang
  diperingatkan di bullet "Peringatan buat fitur masa depan" di bawah. Sebagai expense beneran,
  semuanya jalan TANPA perubahan kalkulasi apapun: saldo akun kepotong, masuk cashflow bulan itu,
  kehitung di budget kategorinya. **JANGAN refactor jadi field.** Aturannya: `accountId`/`date`/
  `time` biaya SELALU ngikut induknya (di-sync tiap induknya di-edit lewat `openTxSheet()`),
  nominal & kategori berdiri sendiri (default kategori `cat_fee` "Biaya & Admin", preset baru
  lewat `ensurePresetCategories()` — user boleh milih kategori expense lain). UI-nya checkbox
  "🧾 Ada biaya tambahan" di `openTxSheet()`, **cuma buat tipe expense & transfer** (income ga
  ada konsep biaya yang motong akun yang sama — catat nominal bersihnya aja). Transaksi yang
  DIRINYA biaya ga bisa punya biaya lagi (nesting diblok: section-nya ga dirender kalau
  `existing.feeOfTxId` keisi) — ini yang bikin cascade delete-nya dijamin cuma 1 level.
  **Hapus induk → biaya ikut kehapus**, di-hook di `remove()` generik (db.js, pola sama
  `applyDebtEffect()`/`applyAssetQtyEffect()`) biar jalur hapus manapun konsisten; `bulkDelete()`
  SENGAJA ga butuh handling khusus karena biaya selalu se-tanggal sama induknya → pasti masuk
  scope periode yang sama. Warning over-limit CC di `openTxSheet()` ikut ngitung biaya (motong
  akun yang sama — kalau ngga, warningnya meleset persis sebesar biayanya). `txRow()` (home.js)
  ngasih badge "biaya" di baris ini, TANPA lookup induk per-baris (O(n) per row = O(n²) buat list
  panjang) — induknya toh persis di sebelahnya karena tanggal+jam-nya sama. `integrity.js`
  nge-flag biaya yang induknya ilang (normalnya mustahil lewat app, cuma bisa dari hapus manual
  di Firestore console). Field additive — **schemaVersion TIDAK naik**.
  **`time`** ("HH:MM", TASK-5) — opsional/additive, field baru buat break-tie urutan transaksi
  dalam tanggal yang sama (sebelumnya cuma `date`, transaksi hari yang sama urutannya ga
  predictable). Entry BARU lewat sheet manapun (`tx-sheet.js`, `openTopupSheet()`/
  `openWithdrawSheet()`, `openAssetBuySheet()`/`openAssetSellSheet()`, bond coupon/redeem,
  reconcile, bayar tagihan CC) default **jam sekarang** (`nowTimeStr()`, utils.js) tapi BISA
  diubah manual — input `<input type="time">` di samping field Tanggal. Transaksi LAMA yang
  ga punya field ini (data pra-fitur) ATAU jalur tulis yang sengaja ga expose time picker
  (**recurring** "Catat Semua", lihat bullet `recurring` di bawah) fallback ke
  **`DEFAULT_TX_TIME` = "00:01"** (utils.js) — dianggap paling awal hari itu, BUKAN "sekarang",
  biar transaksi baru yang beneran dicatat hari yang sama selalu keurut di ATAS data lama/auto-
  post pas di-sort. Comparator-nya `compareTxDateTime(a, b)` (calc.js, pure, ditest) — desc by
  `date` dulu, `time || DEFAULT_TX_TIME` jadi tie-breaker. **Firestore query TETAP cuma
  `orderBy("date","desc")`** (store.js) — SENGAJA TIDAK ditambah `orderBy("time")` juga, karena
  Firestore nge-EXCLUDE dokumen yang ga punya field yang di-`orderBy` dari hasil query (bukan
  treat sebagai "kosong"/paling awal) — nambah `time` ke `orderBy` bakal bikin SEMUA transaksi
  lama (belum punya `time`) HILANG dari `state.transactions`. Sort final-nya jadi CLIENT-SIDE:
  `track()` transactions (store.js) pakai parameter `mapFn` buat `state.transactions.sort(calc.
  compareTxDateTime)` abis snapshot ke-assign — pola ini (bukan Firestore composite orderBy)
  WAJIB dipakai lagi kalau nambah secondary sort key baru ke depan yang ga dijamin ada di semua
  dokumen lama. `home.js` `txRow()` nampilin `t.time` di baris note (`· HH:MM`) KALAU field-nya
  ada — legacy tanpa `time` ga nampilin apa-apa di situ (bukan "00:01" yang bisa disangka data
  asli).
  **Topup goal** = transfer, `toGoalId` diisi (bukan `toAccountId`) — `accountId` = akun SUMBER
  (ke-debit), ga ada akun yang ke-kredit. **Pencairan goal** = kebalikannya, `fromGoalId` diisi
  — `accountId` di sini malah jadi akun TUJUAN (ke-kredit), ga ada akun yang ke-debit (lihat
  `accountBalances()`). Jadi peran `accountId` kebalik tergantung arahnya — sengaja, biar field
  akun tetap satu & generic di seluruh app (filter History, txRow, dll) ga perlu tau bedanya.
  Dibuat/diedit lewat `openTopupSheet()`/`openWithdrawSheet()` di `goals.js`, BUKAN
  `openTxSheet()` generik di `tx-sheet.js` (yang itu ga ngerti `toGoalId`/`fromGoalId`).
  **Beli/jual asset** = transfer juga, pola SAMA persis (`accountId` = sumber pas beli/kredit
  pas jual) — TAPI bedanya pakai SATU field id (`assetId`, bukan dua field kayak goal) + field
  arah eksplisit `assetDir` ("buy"|"sell"), karena itu opsi paling sedikit ambiguitas buat kasus
  ini (lihat wealth.js). `assetQty`/`assetPrice` disimpan juga di
  transaksinya (native unit — LOT buat `stock_id`, bukan ×100 lembar) buat detail view & reversal
  saat hapus, ga perlu di-derive balik dari `amount`. Dibuat lewat `openAssetBuySheet()`/
  `openAssetSellSheet()` (`wealth.js`), BUKAN `openTxSheet()`. **Edit SENGAJA TIDAK didukung**
  buat transaksi ber-`assetId` (beda dari topup/withdraw goal yang full CRUD) — weighted average
  `avgBuyPrice` ga bisa di-reverse dengan aman kalau transaksi lama diedit ulang (butuh replay
  history). Klik dari History cuma buka detail read-only + Hapus (hapus me-reverse `quantity`
  asset secara exact, TAPI `avgBuyPrice` GA ikut di-reverse — dikasih tau eksplisit ke user).
  Salah catat → hapus + catat ulang, bukan edit. Reversal `quantity` DIPUSATKAN sebagai hook di
  `remove()` generik (db.js, pola persis `applyDebtEffect()`) — BUKAN logic manual di sheet, biar
  jalur hapus manapun (detail sheet, `bulkDelete()`) otomatis konsisten; lihat bullet
  `bulkDelete()` di bawah.
  **Peringatan buat fitur masa depan:** apapun yang mengagregasi arus kas PER AKUN (laporan
  per akun, export CSV, dsb.) WAJIB memeriksa `toGoalId`/`fromGoalId`/`assetId`+`assetDir` dulu
  buat nentuin arah `accountId` — SEKARANG ADA TIGA jenis transaksi yang bikin perannya
  kondisional (dulu cuma goal). Kalau diasumsikan selalu "sumber" (kayak transfer akun-ke-akun
  biasa), transaksi pencairan goal ATAU jual asset bakal ke-hitung kebalik (debit dianggap kredit).
- `budgets` — id deterministik `{month}_{categoryId}`. Halaman `#/budget` (satu-satunya route
  yang punya month picker selain History, `month:true` di ROUTES) juga nampilin card "🥧 Per
  Kategori" — doughnut breakdown expense bulan berjalan dari `spentByCategory()`, ikut ganti
  pas month picker diganti. Sengaja ditaruh di sini bukan di tab Total Wealth, karena Wealth
  (`month:false`) chart-nya trend lintas-bulan, bukan snapshot satu bulan. Kategori `cat_adjust_out`
  (Penyesuaian Saldo) TETAP tampil di chart (bukan di-exclude), cuma dikasih warna netral abu-abu
  (bareng bucket "Lainnya" buat kategori di luar top-7) — biar ga rebutan slot warna kategorikal.
  Slot warna kategorikal cuma pakai 7 (bukan 8) karena warna ke-8 di palet referensi adalah
  merah, yang di app ini udah reserved buat makna "danger/over budget" (`var(--red)`).
- `assets` — saham IDX (quantity dalam **LOT**, ×100 lembar saat hitung nilai), US fractional shares,
  dll. `manualPrice` + `manualPriceUpdatedAt` + `priceSource`. `manualOnly:true` = skip auto-refresh.
  Tab Assets (Wealth) nampilin ringkasan **Nilai / Invested / Unrealized P&L** (`assetCostIDR()`
  dari `avgBuyPrice`, P&L = nilai − invested) di atas list, ngikutin filter tipe aktif — sign
  convention SAMA kayak per-asset P&L di `assetRow()` (val − cost), jangan dibalik biar ga
  selisih warna sama baris individual-nya. **Catat Pembelian/Penjualan** (tombol "💰"/"💸" di
  sheet edit asset, `openAssetBuySheet()`/`openAssetSellSheet()` wealth.js) —
  link ke arus kas akun (transaksi transfer ber-`assetId`, lihat bullet `transactions`) +
  `quantity`/`avgBuyPrice` di-update OTOMATIS. Beli: `avgBuyPrice` baru = weighted average
  `(qtyLama×avgLama + qtyBaru×hargaBaru)/(qtyLama+qtyBaru)` (dibulatkan 2 desimal), preview
  ditampilin live sebelum simpan. Jual: `quantity` berkurang, `avgBuyPrice` TIDAK berubah
  (konvensi standar) — realized P&L ga dilacak v1, cukup kecatat di note transaksi. Posisi lama
  (pre-fitur ini) tetap bisa diedit manual lewat form biasa — ga dipaksa punya jejak transaksi.
  Asset yang punya transaksi ber-`assetId` ga bisa dihapus langsung — pola sama proteksi hapus
  akun/goal/debt.
  **Tipe `capex`** (CAPEX / Barang Susut — laptop, kendaraan, elektronik, dll) BEDA POLA total
  dari tipe lain: nilainya BUKAN harga manual yang di-refresh, tapi AUTO-DIHITUNG tiap saat pakai
  declining balance — `capexValueIDR()`/`capexLocalValue()` (calc.js): `value = avgBuyPrice ×
  (1 − depreciationPctMonth)^bulan-sejak-purchaseDate`. `quantity` DIPAKSA 1 (form sheet hide
  field ini buat tipe capex — ga ada konsep qty buat barang fisik satuan), `avgBuyPrice` DIREUSE
  sebagai harga beli awal (bukan field baru) biar `assetCostIDR()` otomatis jalan tanpa kode
  baru → P&L existing di `assetRow()`/report-md.js otomatis kebaca sebagai "kerugian" dari
  penyusutan. Field baru: `purchaseDate` ("YYYY-MM-DD"), `depreciationPctMonth` (desimal 0–1,
  input form-nya persen mis. "2" = 0.02, pola sama `projectionRateA/B`). **TIDAK auto-refresh**
  (bukan bagian `AUTO_TYPES` di `prices.js`) dan **TIDAK punya Catat Pembelian/Penjualan**
  (tombol itu di-hide di `openAssetSheet()` kalau tipe capex) — barang fisik dicatat sekali,
  harga & tanggal beli diedit manual kalau salah, ga ada konsep "harga pasar per unit" yang
  ditransaksikan kayak saham/crypto. `nowMonth` WAJIB dikirim eksplisit ke
  `assetValueIDR()`/`totalAssetsIDR()`/`netWorthIDR()` (calc.js) sekarang — semua caller lewat
  `store.js` yang otomatis nyuntik `currentMonth()`, JANGAN panggil versi calc.js langsung dari
  view tanpa parameter itu.
  **Toggle Net Worth** (`settings.includeCapexInNetWorth`, checkbox di **Wealth → tab Total**,
  card breakdown — BUKAN di Setting lagi, dipindah biar toggle-nya deket sama angka yang
  dipengaruhi, cuma muncul kalau user punya ≥1 asset tipe `capex`, default **FALSE/exclude**;
  kenapa default-nya begini & kenapa chart Tren Net Worth vs Proyeksi beda pola soal ini: lihat
  `DECISIONS.md`) — nentuin CAPEX ikut `netWorthIDR()` atau ngga. Formula-nya `netWorthFromParts({cash, assets,
  capex, goalSavings, debt}, includeCapex)` (calc.js, pure, TIDAK butuh `state` — beda dari
  fungsi calc.js lain — biar bisa dipake ulang buat recompute net worth HISTORIS dari breakdown
  snapshot lama, bukan cuma live state) — `netWorthIDR()` sendiri cuma wrapper tipis yang manggil
  ini pakai live totals. `totalAssetsIDR()` SENDIRI TETAP SELALU termasuk CAPEX apa adanya
  (dipakai tab Assets Wealth — itu "semua yang lo punya", bukan konsep net worth); exclude-nya
  CUMA lewat `netWorthFromParts()`, BUKAN filter ulang di tempat lain. Efeknya: breakdown Total
  tab Wealth ("📈 Assets") SELALU nampilin nilai EXCLUDE CAPEX (biar rows-nya tetap
  sum persis ke NET WORTH baik toggle ON/OFF) + baris "🏗️ CAPEX" terpisah CUMA muncul di situ
  kalau toggle ON; kalau OFF, nilainya tetep kelihatan tapi sebagai catatan `.sub` di luar
  tabel breakdown (bukan salah satu row yang di-sum). `report-md.js` section 1 & 10 nunjukin
  **DUA angka eksplisit** (+ CAPEX / tanpa CAPEX, dari `netWorthFromParts()` yang sama) — bukan
  cuma satu angka + catatan toggle kayak sebelumnya — biar AI yang baca laporan bisa bandingin
  dua skenario itu sendiri. Snapshot bulanan (`upsertSnapshot()`) nyimpen `totalCapex` + per-asset
  `purchaseDate`/`depreciationPctMonth` di breakdown — field opsional/additive, snapshot lama
  (pre-fitur) `undefined` → fallback 0, JADI **schemaVersion TIDAK dinaikkan** buat perubahan ini
  (backup lama tetap valid di-restore).
  **Tipe `bond`** (Obligasi / SBN Ritel — ORI, SR, SBR, ST) BEDA POLA dari saham/reksadana:
  nilainya **TIDAK fluktuatif** kayak instrumen lain — default = **par** (`principal` apa
  adanya), bukan qty×harga/unit. Field baru (semua di `assets` doc, TIDAK ada collection baru):
  `principal` (WAJIB, nilai pokok Rp — basis nilai asset ini, BUKAN `avgBuyPrice`, field itu
  SAMA SEKALI ga dipakai buat bond, dipaksa 0 di form), `couponRatePA` (desimal 0–1, pola sama
  `projectionRateA/B`/`depreciationPctMonth` — input form-nya persen), `couponPeriodMonths`
  (integer ≥1, default 1 — buat pengingat doang, BUKAN kalkulasi), `couponAccountId`/
  `maturityAccountId` (akun tujuan kupon/pokok, buat pre-fill sheet), `maturityDate` (WAJIB,
  "YYYY-MM-DD"), `purchaseDate`/`issueDate` (tanggal terbit/beli — field yang KEPAKE cuma
  `purchaseDate`, sama kayak CAPEX, `issueDate` cuma fallback di `bondNextCouponHint()` kalau
  ada data lama yang pakai nama itu), `redeemed` (bool, default false — `true` = pokok udah
  dicairkan). `quantity` DIPAKSA 1 & `currency` DIPAKSA IDR di form (SBN Ritel selalu IDR) — ga
  ada konsep qty buat instrumen lump-sum. Field `symbol` DIREUSE jadi "Series Name" (mis.
  "ORI030T3", relabel di form) — BUKAN field baru, biar `a.symbol || a.name` yang udah dipakai
  di mana-mana (assetRow, goal-link checklist, snapshot breakdown) otomatis jalan tanpa kode baru.
  **Nilai** (`bondValueIDR()`/`bondLocalValue()`, calc.js): `manualPrice > 0 ? manualPrice :
  principal` — `manualPrice` di sini (opsional) itu nilai pasar sekunder ABSOLUT dalam currency
  bond (Rp langsung, BUKAN harga-per-unit dikali qty kayak saham). **Cost** (`bondCostIDR()`)
  SELALU `principal` apa adanya (ga kepengaruh `manualPrice`) — P&L bond = value − principal,
  otomatis 0 di par (BENAR, bukan bug, bond ga punya gain/loss sampai ada harga pasar sekunder
  eksplisit yang beda). `redeemed:true` → value & cost 0 (posisi ditutup, uangnya balik 100% ke
  cash) TAPI dokumen assets-nya **TETAP ADA** (ga dihapus — jejak riwayat kepertahankan), cuma
  di-filter dari tampilan "asset aktif" (`renderAssets()` wealth.js, `buildPosition()` &
  `upsertSnapshot()` live branch — snapshot LAMA yang udah kesimpen ga direwrite). **Kupon TIDAK
  dihitung otomatis** (keputusan owner — pajak PPh final 10%, pembulatan, timing mutasi RDN beda
  tiap kali cair, riwayat lengkap kenapa: `DECISIONS.md`) — `bondNextCouponHint(asset, todayStr)`
  (calc.js, pure) cuma estimasi INFORMATIF (tanggal kupon berikutnya + `principal ×
  couponRatePA/12 × couponPeriodMonths`, SEBELUM pajak) buat teks bantu UI, **TIDAK PERNAH**
  dipakai bikin transaksi — return `null` kalau `redeemed`/data ga cukup/estimasi udah lewat
  `maturityDate`. **Dua aksi khusus** (tombol di sheet Edit Asset tipe bond, `wealth.js`,
  MENGGANTIKAN Catat Pembelian/Penjualan yang di-hide buat tipe ini — pola sama CAPEX): (1)
  **"💰 Catat Kupon Masuk"** (`openBondCouponSheet()`) — transaksi `income` BIASA, akun =
  `couponAccountId`, kategori `cat_bunga` ("Bunga & Dividen", preset udah ada dari awal), **TANPA
  `assetId`** (beda dari beli/jual/redeem — kupon ga perlu dilacak balik ke bond-nya, "transaksi
  income biasa" per spec), nominal WAJIB diisi/dikoreksi manual user (estimasi cuma hint). (2)
  **"🏁 Cairkan Pokok"** (`openBondRedeemSheet()`, di-export — dipakai juga `home.js`
  `openTxDetail()` buat routing detail transaksi) — transfer ber-`assetId`+**`assetDir:"redeem"`**
  (arah BARU, beda dari `"buy"`/`"sell"` — bond ga pakai qty-tracking sama sekali, `assetQty`/
  `assetPrice` SENGAJA ga diisi), `patch(assets, {redeemed:true})` ditulis MANUAL di sheet (pola
  sama openAssetBuySheet/Sell nulis quantity sendiri, BUKAN via hook) SEBELUM `add()` transaksinya.
  Reversal (hapus transaksi redeem) DIPUSATKAN di db.js `applyAssetQtyEffect()` (di-extend
  khusus arah `"redeem"` — balikin `redeemed:false`, BUKAN nyentuh `quantity` kayak buy/sell).
  `integrity.js` validasi assetId+assetDir SEKARANG punya cabang terpisah buat `"redeem"` (ga
  butuh assetQty/assetPrice, beda dari buy/sell) — kalau lupa update ini pas nambah arah baru
  lagi ke depan, transaksi bakal ke-flag false-positive "invalid". `assetRow()`/list Assets
  nampilin pokok + kupon%/periode (meta) + hitung mundur `maturityDate` atau badge "⚠️ Jatuh
  tempo, cairkan pokok" kalau udah lewat & belum redeemed (stale line) — TIDAK auto-refresh
  (bukan bagian `AUTO_TYPES` prices.js). `report-md.js` section 6: kolom Qty/Avg Buy/P&L
  di-repurpose (Qty "—", Avg Buy = cost basis/principal, P&L "—" kalau par murni) + baris
  informatif terpisah (total pokok + estimasi kupon tahunan sebelum pajak + maturity terdekat).
  `integrity.js` info-check (bukan error): `maturityDate` lewat tapi belum `redeemed`,
  `principal` ≤ 0, `couponRatePA` di luar 0–100%, `maturityDate` sebelum `purchaseDate`. Field
  semuanya additive/opsional (`null` kecuali tipe bond, pola sama CAPEX) — **schemaVersion TIDAK
  naik**, backup lama tetap valid restore.
  **`qtyless`** (bool, "Jumlah N/A" — TASK-6) BEDA dari CAPEX/Bond di atas: BUKAN tipe baru,
  melainkan TOGGLE lintas-tipe (checkbox di form Edit Asset, cuma muncul buat tipe
  `mutual_fund`/`deposito`/`gold`/`other` — saham/US/crypto DIKELUARIN karena auto-refresh butuh
  qty×harga/unit, ga cocok sama konsep lump-sum) buat posisi TUNGGAL yang dilacak lewat NILAI
  langsung, bukan qty×harga/unit (mis. 1 rekening deposito, 1 investasi bisnis, emas dilebur jadi
  1 posisi). `quantity` DIPAKSA 1 SELAMANYA (hidden di form, GA PERNAH berubah lewat jalur
  manapun — beda dari tipe qty-based yang `quantity`-nya emang berubah tiap beli/jual) —
  `assetValueIDR()`/`assetCostIDR()` (calc.js) **TIDAK PUNYA cabang khusus buat ini** (beda dari
  capex/bond yang punya fungsi `*LocalValue`/`*ValueIDR` sendiri) karena formula generik `qty ×
  manualPrice`/`qty × avgBuyPrice` OTOMATIS jadi `= manualPrice`/`= avgBuyPrice` pas `qty` selalu
  1 — `manualPrice` jadi NILAI TOTAL (bukan per-unit) dan `avgBuyPrice` jadi MODAL TOTAL, tanpa
  kode kalkulasi baru sama sekali. **Catat Pembelian/Penjualan** TETAP ada (beda dari capex/bond
  yang di-hide) tapi routing ke sheet KHUSUS (`openQtylessTradeSheet()`, wealth.js — dispatch
  otomatis dari `openAssetBuySheet()`/`openAssetSellSheet()` berdasar `asset.qtyless`, BUKAN
  `openAssetTradeSheet()` biasa) — form-nya cuma SATU nominal (bukan qty+harga/unit terpisah).
  Beli: nominal nambah `manualPrice` (nilai) DAN `avgBuyPrice` (modal) sekaligus — asumsi wajar
  "abis nambah duit, nilai hari itu minimal segitu" (user tetap bisa koreksi manual lewat form
  Edit Asset kalau nilai pasarnya beda, mis. harga emas naik/turun). Jual/tarik: nominal
  ngurangin `manualPrice` DOANG, `avgBuyPrice` TETAP — pola SAMA persis kayak konvensi jual asset
  qty-based (cost basis ga di-reverse pas jual). Transaksinya **TANPA** `assetQty`/`assetPrice`
  (field itu ga ada artinya buat lump-sum, sama kayak `assetDir:"redeem"` bond) — `integrity.js`
  validasi assetId+assetDir punya cabang KHUSUS buat qtyless (skip syarat assetQty/assetPrice,
  pola sama redeem) DAN skip total dari check konsistensi qty-vs-jejak-transaksi (yang itu emang
  cuma valid buat tipe qty-based) + check baru: qtyless tapi `quantity !== 1` → info corruption.
  **Reversal** (hapus transaksi) DIPUSATKAN di db.js `applyAssetQtyEffect()` — signature-nya
  SEKARANG nerima transaksi utuh (bukan `assetId, dir, qty` terpisah lagi) karena cabang qtyless
  butuh `t.amount`, bukan `t.assetQty`; cabang qtyless-nya ngurangin `manualPrice`+`avgBuyPrice`
  (buy) atau nambahin `manualPrice` doang (sell) — BUKAN nyentuh `quantity` sama sekali.
  `bulkDelete()` (Zona Bahaya) punya agregasi TERPISAH buat qtyless (`netValueAmount`/
  `buyAmount` per asset, bukan `netQty`) di loop yang sama — sekalian NGEBENERIN gap lama:
  transaksi `assetDir:"redeem"` (bond) yang ikut kehapus lewat bulk delete SEBELUMNYA ga
  ngebalikin flag `redeemed`, sekarang di-track (`hasRedeem`) dan di-reverse juga. Toggle ON
  dari asset yang sebelumnya beneran punya `quantity > 1` (form Edit Asset) AUTO-KONVERSI
  avg/harga per-unit jadi TOTAL (dikali qty lama) sebelum field-nya disembunyikan — jaga2 biar
  angka ga kesalahartikan diam-diam jadi "per unit doang" pas direinterpretasi sebagai total;
  toggle OFF SENGAJA GA di-reverse (user emang harus isi ulang qty+harga manual, ga ada "1 unit"
  yang valid buat dibagi balik). `assetRow()`/list Assets nampilin "Jumlah: N/A" (bukan angka 1
  yang bisa disalahartikan sebagai qty asli) + "Modal Rp X" (bukan "avg Rp X/unit").
  `report-md.js` section 6 kolom Qty juga "N/A" buat baris ini (konstanta `NA` yang sama kayak
  bond). Field `qtyless` additive (`false` default, bukan `null` — ini boolean lintas-tipe, beda
  dari field bond/capex yang emang cuma relevan buat satu tipe) — **schemaVersion TIDAK naik**.
- `debts` — outstanding, monthlyInstalment, dueDay, remainingMonths. Mengurangi net worth.
  Transaksi expense bisa opsional bawa `debtId` (dropdown "Potong hutang?" di `openTxSheet()`
  kalau ada ≥1 debt, dan di form `recurring`) — CREATE/EDIT/DELETE transaksi ber-`debtId`
  otomatis nyesuain `totalOutstanding`/`remainingMonths` (floor 0). Logic-nya DIPUSATKAN di
  `applyDebtEffect()`/`handleDebtPatch()` (db.js), nge-hook langsung ke `add()`/`patch()`/
  `remove()` generik buat collection `"transactions"` — sheet manapun yang nulis transaksi
  otomatis kena efeknya tanpa perlu tau, JANGAN reimplement mutasi debt manual di sheet.
  `totalOutstanding` ≤ 0 → badge "Lunas 🎉" (tab Debt Wealth), bukan auto-delete. Debt yang
  punya transaksi ber-`debtId` ga bisa dihapus langsung — pola sama proteksi hapus akun/goal.
- `goals` — Short Term Goals. {name, targetAmount, targetDate? ("YYYY-MM"), color,
  linkedAssetIds?, isArchived?}. Bisa lebih dari satu (dikelola di `#/goals`, menu di Setting). **Sistem
  topup + pencairan**, bukan target pasif: saldo goal = topup − pencairan asli
  (`goalSavedIDR()`), bukan net worth. Goal yang punya riwayat topup ATAU pencairan ga bisa
  dihapus langsung (harus beresin transaksinya dulu di History) — pola sama kayak proteksi hapus
  akun. Beda konsep dari Main Milestone (`settings.targetNetWorth`) — lihat catatan di atas.
  **GA ADA status "Selesai 🎉" lagi** (sempat ada, dihapus lagi — riwayat lengkap: lihat
  `DECISIONS.md`) — progress ditampilin persentase polos aja (`pct`), ga ada klaim "goal ini
  udah kelar" yang bisa salah.
  **Link ke Asset** (`linkedAssetIds`, array of assetId, opsional) — goal bisa di-link ke ≥1
  asset yang UDAH ADA (multiple), di-set dari checkbox list di sheet Edit Goal (`goals.js`,
  BUKAN dari sisi asset). Nilai asset ter-link ikut ditampilin sebagai bagian **progress goal**
  (`goalProgressIDR()` = `goalSavedIDR()` topup standalone + `goalLinkedAssetsValueIDR()` sum
  nilai asset ter-link, calc.js) — TAPI **SENGAJA TIDAK** ikut `totalGoalSavingsIDR()` (yang
  dipakai `netWorthIDR()`): asset ter-link TETAP asset biasa, udah kehitung penuh di
  `totalAssetsIDR()`, nambahin lagi ke goal savings bakal DOUBLE-COUNT net worth.
  `totalGoalSavingsIDR()` TETAP murni `goalSavedIDR()` — JANGAN diubah buat include
  linkedAssetIds, itu satu-satunya sumber "goal savings" yang boleh nyumbang ke net worth.
  Tombol **"💸 Cairkan"** pakai `saved > 0` (bukan `progress`) — pencairan cuma narik dari pool
  cash topup, bukan "menjual" asset ter-link (itu tetap lewat `openAssetSellSheet()`
  terpisah kalau mau dilikuidasi). Stats tampilan (`saved`/`linkedValue`/`progress`/`pct`/`cls`)
  DIPUSATKAN di `goalDisplayStats(g)` (goals.js, di-export) — dipakai BARENG sama `home.js`
  (preview Goals) biar dua UI ga divergen, pola sama `copyBudgetFromLastMonth()`.
  **Progress bar/pct/`progress` SENGAJA (tunai + aset)** — bukan tunai doang (TASK-2, 2026-08,
  riwayat: `DECISIONS.md`) — keputusan final buat goal yang di-fund via asset (mis. Dana Pensiun).
  TAPI karena itu beda dari `totalGoalSavingsIDR()`/net worth (yang cuma tunai), `progress`
  gabungan **DILARANG ditampilin sendirian tanpa breakdown** `saved` (tunai) vs `linkedValue`
  (aset) di SEMUA tempat goal ditampilin — `goals.js` list (2 baris: breakdown tunai/aset +
  catatan "bukan semuanya tunai yang bisa dicairkan" saat `linkedValue > 0`), `home.js` preview
  (baris kecil "tunai X + aset Y" saat `linkedValue > 0`), `report-md.js` section 1 (baris "Goal
  savings" nambah "(tunai) + Rp Y (dari asset ter-link, sudah termasuk di Assets)" saat ada
  goal ber-link — sebelumnya cuma nampilin total tunai polos yang kontradiksi sama section 8) dan
  section 8 (header kolom eksplisit "Terkumpul (tunai+aset)", kolom Breakdown "tunai X + aset Y",
  plus catatan kaki soal likuiditas). Kalau nambah entry point baru buat nampilin goal progress,
  WAJIB ikutin pola breakdown ini — JANGAN balik ke satu angka `progress` polos. Satu
  asset BOLEH di-link ke lebih dari satu goal sekaligus (masing-masing goal nampilin nilai
  PENUH-nya, bukan dibagi) — sengaja simpel, ga ada mekanisme alokasi/split. Asset yang lagi
  di-link ke goal manapun **ga bisa dihapus langsung** (guard di `openAssetSheet()`, wealth.js —
  pola sama proteksi hapus akun/goal/debt yang lain) — harus dilepas link-nya dulu di Edit Goal.
  Snapshot (`upsertSnapshot()`) nyimpen `linkedValue` per goal TERPISAH dari `saved` (field
  opsional/additive, snapshot lama fallback 0) — biar `report-md.js` bisa nunjukin breakdown-nya,
  bukan angka yang udah di-pre-combine.
  **Arsip** (`isArchived`, opsional, pola field sama `accounts.isArchived`) — checkbox di sheet
  Edit Goal (cuma muncul buat goal existing, sama kayak "Arsipkan akun" di `accounts.js`).
  **BEDA KONSEKUENSI dari akun**: `activeAccounts()` dipakai LANGSUNG di `totalCashIDR()` (akun
  diarsip = saldo-nya BERHENTI keitung net worth, dianggap ditutup) — tapi goal diarsipin BUKAN
  berarti uangnya ilang, jadi `totalGoalSavingsIDR()`/`goalSavedIDR()`/`netWorthIDR()` SENGAJA
  TIDAK difilter `isArchived` sama sekali, tetap iterate semua goal apa adanya. `activeGoals(state)`
  (calc.js, baru, di-export via store.js) HANYA dipakai buat filter TAMPILAN: preview Goals di
  Home (goal arsip ga nongol di situ, dengan pesan beda "Semua goals diarsipkan" kalau semuanya
  ke-arsip — bukan disamain sama "Belum ada goals" yang berarti belum pernah bikin), listing
  section 8 laporan .md (`report-md.js`, TAPI total Goal Savings section 1 tetap termasuk goal
  arsip — kalau ada saldo goal arsip yang bikin sum tabel section 8 ga match total section 1,
  dikasih baris catatan eksplisit di bawah tabelnya), dan `breakdown.goals` snapshot bulanan
  (`upsertSnapshot()`, db.js — snapshot BULAN INI aja yang kefilter, snapshot lama/historis ga
  direwrite). Halaman `#/goals` sendiri **TIDAK** pakai `activeGoals()` — nampilin SEMUA (aktif +
  arsip) dalam satu list flat (pola sama `accounts.js`), badge "arsip" + didorong ke bawah lewat
  sort, TANPA section terpisah. Goal diarsip: tombol **"💰 Topup" disembunyikan** (nudge biar ga
  terus ditambahin kalau udah dianggap beres — bukan hard block, un-archive dulu kalau mau topup
  lagi), tombol **"💸 Cairkan" TETAP ada** kalau `saved > 0` (uang yang udah ke-topup harus tetap
  bisa ditarik walau goal-nya diarsip), delete guard TIDAK berubah (masih dicek riwayat
  topup/pencairan, terlepas status arsip).
- `recurring` — {name, type, amount, accountId, toAccountId?, toGoalId?, assetId?, categoryId?,
  debtId?, dayOfMonth (1–31), active, lastPostedMonth? ("YYYY-MM")}. Template transfer bisa
  nabung rutin ke **Short Term Goal** (`toGoalId`, menggantikan `toAccountId` — toggle
  "Akun"/"🎯 Goal"/"📈 Asset" di form, tiap opsi cuma muncul kalau ada ≥1 goal/asset) —
  posting-nya (lihat bawah) menghasilkan transaksi topup yang IDENTIK dengan
  `openTopupSheet()` (type transfer, accountId sumber, toGoalId, TANPA toAccountId), jadi
  otomatis kejaring guard `txRow()` & kalkulasi goal (`goalSavedIDR()`, `accountBalances()`)
  tanpa perubahan di situ. **DCA beli asset** (`assetId`, dest ketiga) SENGAJA BEDA POLA dari
  goal/akun — assetnya TIDAK auto-post: harga beli beda tiap bulan dan `quantity` harus
  diturunkan dari harga aktual, auto-post bakal mengarang qty. Item ber-`assetId` di sheet Awal
  Bulan (lihat bawah) muncul sebagai baris TANPA checkbox, dengan tombol "Catat pembelian →"
  yang buka `openAssetBuySheet(asset, null, {prefillAmount, prefillAccountId, prefillDate,
  onSaved})` (wealth.js) — `amount` templatenya jadi field "Nominal (Rp)" ekstra di sheet itu
  yang otomatis ngitung `qty` dari nominal ÷ harga yang diisi manual (floor ke lot penuh buat
  `stock_id`, desimal buat tipe lain; tetap bisa dioverride manual). `lastPostedMonth` template
  itu CUMA di-`patch()` lewat callback `onSaved` (dipanggil sheet SETELAH transaksi beneran
  tersimpan) — bukan pas tombol diklik, biar user batal ga somehow ke-anggap udah post. Jalur
  penulisan transaksinya TETAP `openAssetBuySheet()` yang sama dipakai fitur "Catat Pembelian"
  manual (lihat bullet `assets` di atas) — sengaja TIDAK ada jalur tulis transaksi asset baru,
  biar weighted average & guard `txRow()` ga terduplikasi. Dikelola di `#/recurring`. Tiap app
  dibuka, item aktif yang `dayOfMonth` ≤ hari ini DAN `lastPostedMonth` ≠ bulan berjalan
  dianggap "jatuh tempo" → muncul sheet **Awal Bulan** (`recurring-sheet.js`) buat konfirmasi
  (checklist buat item non-asset, default semua tercentang; baris tombol terpisah buat item
  DCA asset) + opsi salin budget bulan lalu kalau budget bulan ini kosong. Tombol "Catat Semua"
  disembunyikan total kalau SEMUA item due adalah DCA asset (ga ada apa-apa buat di-checklist,
  daripada nampilin tombol yang bakal bilang "ga ada transaksi yang dicatat"). **JANGAN
  AUTO-POST** — transaksi non-asset baru dibuat pas user klik "Catat Semua". Tanggal transaksi
  yang di-post (baik lewat "Catat Semua" maupun DCA asset) pakai `dayOfMonth` template di bulan
  berjalan (bukan tanggal user konfirmasi) — representasi kejadian riil, bukan kapan usernya
  buka app. `time`-nya (TASK-5) ikut prinsip yang SAMA — `DEFAULT_TX_TIME` ("00:01"), BUKAN
  `nowTimeStr()`, karena jam asli kejadiannya ga diketahui dan "Catat Semua" bisa diklik kapan
  aja (pagi/malam) — beda dari sheet lain yang punya time picker sendiri (lihat bullet
  `transactions`). Edit template TIDAK reset `lastPostedMonth` (biar ga dobel post bulan yang sama).
  Sheet muncul maks 1x/hari kalau di-"Nanti"-in (flag tanggal di localStorage, key
  `fintrack_recurring_dismissed_date`), dipanggil sekali per sesi dari app.js. `dayOfMonth`
  di-clamp ke hari terakhir bulan berjalan (`daysInMonth()` di utils.js) — template tgl 31 tetep
  kepost di bulan 30 hari, cek jatuh tempo maupun tanggal transaksinya pakai effective day yang
  sama. Referensi akun/kategori/debt/goal/asset yang udah diarsip/kehapus di-deteksi via
  `brokenReason()` (recurring-sheet.js, dipakai bareng views/recurring.js) — item broken ga bisa
  dicentang/diklik di sheet Awal Bulan (checkbox disabled / tombol disembunyikan) dan dapet
  badge merah di `#/recurring`, TAPI ga ngeblok item lain yang sehat buat tetep di-post.
  `lastPostedMonth` juga di-reset (null) otomatis oleh `bulkDelete()` (Zona Bahaya, lihat bawah)
  buat template yang `lastPostedMonth`-nya masuk periode yang baru dihapus — biar sheet Awal
  Bulan nawarin lagi, bukan nganggep udah pernah post buat bulan yang datanya udah lenyap.
  **Bond (TASK-4) SENGAJA TIDAK diintegrasikan ke recurring sama sekali** (opsional di spec,
  diputuskan SKIP) — `dayOfMonth` recurring itu "tiap bulan di tanggal X", sedangkan periode
  kupon bond bisa multi-bulan (`couponPeriodMonths` > 1), jadi butuh field interval BARU + logic
  "udah due belum berdasar N bulan sejak terakhir" yang recurring belum punya sama sekali —
  jauh lebih kompleks dari sekadar nambah destination baru (beda dari DCA asset di atas yang
  reuse `dayOfMonth` apa adanya, tiap bulan emang wajar). Reminder-nya CUKUP diandalkan dari
  hitung mundur maturity + badge overdue di list Assets (Wealth) — user buka Wealth, langsung
  keliatan kalau ada bond yang perlu di-follow-up, ga butuh mekanisme jadwal terpisah.
- `snapshots/{YYYY-MM}` — net worth bulanan, di-upsert otomatis saat app dibuka (`upsertSnapshot`,
  db.js). Selain total (`totalCash`/`totalAssets`/`totalCapex`/`totalGoalSavings`/`totalDebt`/
  `netWorth` — `totalCapex` field baru sejak fitur CAPEX, snapshot lama ga punya ini, lihat
  bullet `assets` tipe `capex` & "Backfill CAPEX ke Snapshot Lama" di Known Quirks), nyimpen
  `breakdown` PER ITEM (angka mentah, bukan string terformat): `accounts` ({name, currency, type,
  balance, balanceIDR, PLUS `creditLimit` — `null` kecuali tipe `credit`}), `assets` ({symbol, type, currency, quantity, avgBuyPrice, price,
  priceDate, valueIDR, costIDR, PLUS `purchaseDate`/`depreciationPctMonth` — `null` kecuali tipe
  `capex`}), `debts` ({name, outstanding, monthlyInstalment, remainingMonths, dueDay}), `goals`
  ({name, targetAmount, saved, targetDate}), `rate` (kurs USD saat itu) — dipakai `report-md.js`
  buat laporan bulan lampau yang beneran historis (lihat Known Quirks). Bisa juga di-backfill
  manual buat bulan pra-app lewat card "Snapshot Historis" di Setting (`{month, netWorth,
  manual:true}`, SENGAJA minimal — TANPA `breakdown` sama sekali, bukan error, cuma ga ada data
  buat direkonstruksi; chart Tren Net Worth cuma butuh `netWorth` + `month`/id, tetep jalan).
  Cuma boleh untuk bulan < bulan berjalan (bulan berjalan wilayah `upsertSnapshot`).
- `settings/main` — targetNetWorth (= **Main Milestone**, dipakai card Total Balance Home DAN
  banner Wealth — SATU sumber, jangan bikin duplikat field), usdIdrManual,
  apiKeys:{finnhub}, lastBackupAt (saham IDX ga butuh key lagi, lihat bullet `js/prices.js`
  di Known Quirks), `projectionRateA`/`projectionRateB` (desimal 0–1, default 0.05/0.07 — dua
  rate tahunan pembanding buat tab 🚀 Proyeksi di Wealth, lihat bullet Known Quirks "Dashboard
  Proyeksi"; bisa diubah dari Setting ATAU kontrol cepat di tab Proyeksi sendiri, dua-duanya
  `patch` ke field yang SAMA). Field `targetDate` ("YYYY-MM", opsional) SEKARANG
  PUNYA UI (input `type="month"` di card Main Milestone & Kurs, Setting.js) dan dipakai buat
  pace ("on-track atau enggak") — TIDAK LAGI vestigial (beda dari `goals.targetDate` per-goal
  yang punya UI/peran terpisah di goals.js).
  Progress bar-nya (Home + Wealth) dihitung SATU tempat: `milestoneProgress(state, nowMonth)`
  (calc.js, `nowMonth` WAJIB dikirim eksplisit oleh caller — calc.js sendiri ga boleh baca
  wall-clock biar tetap deterministik buat di-test) → `{target, nw, pct, achieved, hidden}` —
  `hidden:true` kalau `targetNetWorth` 0/kosong (bar disembunyikan, bukan div-by-zero atau
  diam-diam fallback ke 100jt); `achieved:true` kalau `nw >= target` → bar penuh warna emas
  (`#eab308→#facc15`, beda dari biru "in progress") + label "🏆 Tercapai!" di Home/Wealth, plus
  ajakan "Set milestone berikutnya" di card Main Milestone Setting — target TIDAK di-auto-ubah,
  murni nudge visual buat user set manual. Kalau `targetDate` keisi DAN belum `achieved`, return
  JUGA field pace: `monthsLeft` (min 0), `neededPerMonth` = (target−nw)/monthsLeft,
  `avgSurplus3m` (rata-rata surplus 3 bulan TERAKHIR YANG ADA DATA — bulan kosong di-skip biar
  ga narik rata-rata ke 0, bulan berjalan di-exclude karena masih parsial), `onTrack` =
  avgSurplus3m ≥ neededPerMonth. Field-field ini SENGAJA ga ada sama sekali (bukan null/0) kalau
  ga relevan — `targetDate` kosong → ga ada field pace apapun; udah `achieved` → pace
  disembunyikan walau `targetDate` keisi; `targetDate` di masa lalu tapi belum achieved → cuma
  `targetDatePassed:true` + `monthsLeft:0`, TANPA `neededPerMonth` (hindari bagi 0/negatif);
  belum ada data surplus sama sekali → `neededPerMonth` doang, TANPA `avgSurplus3m`/`onTrack`
  (jangan ngarang klaim on-track tanpa data). UI-nya `milestonePaceLine(mp)` (utils.js, plain
  text tanpa markup) — SATU formatter dipakai Home, Wealth, DAN section Ringkasan laporan .md
  (`report-md.js`, pace-nya SELALU dari posisi TERKINI walau lagi liat laporan bulan lampau —
  pace itu konsep forward-looking "dari sekarang", bukan potret historis per bulan).

Net worth = totalCashIDR + totalAssetsIDR (− totalCapexIDR kalau toggle exclude, lihat bullet
`assets` tipe `capex`) + totalGoalSavingsIDR − totalDebtIDR (USD dikonversi `effectiveRate()`).
Goal savings dihitung terpisah dari `totalAssetsIDR()` (bukan di-fold ke situ) biar tab Assets di
Wealth (isinya cuma investasi) ga ikut kebawa angka goal — tapi tetep ditambah sebagai baris
terpisah "🎯 Goals" di breakdown Total tab Wealth biar rows-nya sum ke net worth.
`totalGoalSavingsIDR` di formula ini TETAP murni `goalSavedIDR()` (topup standalone) — nilai
asset yang di-link ke goal (`goals.linkedAssetIds`, lihat bullet `goals`) SENGAJA TIDAK nyumbang
ke sini (udah kehitung penuh lewat `totalAssetsIDR()`), cuma muncul di `goalProgressIDR()` buat
tampilan progress goal.

## ATURAN WAJIB saat mengubah kode

1. **Setiap deploy perubahan file apapun: naikin `CACHE_VERSION` di `sw.js`** (v4 → v5 dst).
   Kalau lupa, user PWA ga dapet update. File baru juga wajib ditambah ke array `PRECACHE`.
2. Semua akses Firestore lewat `js/db.js` (add/put/patch/remove) — jangan tulis setDoc langsung di view.
3. View re-render otomatis via `store.on()` setelah data berubah — jangan manual manipulasi DOM
   setelah save; cukup tutup sheet + toast.
4. User input selalu lewat `escapeHtml()` sebelum masuk innerHTML (XSS).
5. Semua fitur inti harus tetap jalan **offline** (Firestore persistence yang handle sync).
6. Jangan tambah dependency eksternal kecuali via CDN dan di-cache di sw.js runtime cache.
7. Angka harga asset selalu tampil dengan timestamp "per {tanggal}" — jangan pernah tampilkan
   harga tanpa keterangan kapan.
8. Kalau nyentuh `js/calc.js`, jalankan `node tests/calc.test.mjs` sebelum selesai — harus hijau.
9. Naikkan `schemaVersion` di `exportAll()`/`importAll()` (db.js) tiap ada perubahan struktur
   data yang TIDAK backward-compatible (field baru yang opsional/nullable ga perlu — cuma kalau
   backup lama jadi ga valid/nyasar kalau di-restore apa adanya).

## Known Quirks

- **Dashboard Proyeksi** (tab "🚀 Proyeksi" di Wealth → Total, `js/views/wealth.js`
  `renderProjectionChart()`) — line chart Aktual (historis, solid) vs Proyeksi (nabung) vs 2
  skenario return terkonfigurasi (`settings.projectionRateA`/`projectionRateB`), menuju 🏆 Main
  Milestone. Primitif kalkulasinya murni & di-test (`calc.js`): `projectSeries({startValue,
  startMonth, months, monthlyContribution, annualRate})` (compound bulanan generik,
  `annualRate:0` otomatis jadi proyeksi linear — dipakai ulang buat skenario "nabung doang ke
  depan", TANPA fungsi terpisah). Orkestrasi (nentuin startValue/horizon/snapshot mana) sengaja
  di view layer, bukan calc.js — itu soal "gimana nampilinnya", bukan kalkulasi finansial murni.
  **SENGAJA GA ADA garis historis "Nabung doang" terpisah** (sempat ada — `savingsOnlySeries()`
  di calc.js — dihapus lagi karena kontradiktif/ganjil berdampingan sama "Proyeksi (nabung)",
  riwayat lengkapnya: lihat `DECISIONS.md`). Sekarang cuma SATU konsep "nabung doang" yang
  dipertahankan: yang forward-looking, mulai dari net worth AKTUAL LIVE bulan ini
  (`netWorthIDR()`). Horizon
  proyeksi = `settings.targetDate` kalau keisi (di-clamp minimal 1 bulan biar ga degenerate kalau
  targetDate udah lewat), fallback 60 bulan (5 tahun) kalau kosong. `monthlyContribution`
  proyeksi pakai `recentAvgSurplus()` (fungsi yang sama dipakai `milestoneProgress()` buat pace,
  di-export biar reusable) — kalau belum ada data surplus sama sekali, fallback 0 (proyeksi jadi
  murni compound growth tanpa kontribusi baru, bukan crash/ngarang angka). Chart pakai `null`
  buat titik di luar rentang tiap dataset (biar Chart.js bikin gap, bukan garis nyambung ke titik
  ga relevan) — SEMUA dataset share SATU axis bulan gabungan (historis + horizon proyeksi). Garis
  Target di-skip total kalau `milestoneProgress().hidden` (ga ada target di-set) — beda dari
  chart Tren Net Worth existing yang masih gambar garis Target di y=0 kalau hidden (quirk lama,
  ga ikut dibenerin di sini, di luar scope). Y-axis chart ini SENGAJA dibikin ikut blur mode
  (`isBlurred()` dari utils.js, ganti tick jadi `"***"`, lihat bullet blur mode di atas) — ini
  PERTAMA KALINYA ada chart di app yang blur, chart lain (Tren Net Worth, Income vs Expense)
  BELUM ikut blur mode sama sekali (canvas Chart.js ga kena CSS `.blur-num` yang dipakai teks
  DOM) — kalau nambah chart baru ke depannya dan mau ikut blur, pola tick callback di sini bisa
  dicontek, TAPI jangan asumsikan chart LAMA udah otomatis ke-cover. Ga ada anotasi garis
  vertikal "bulan ini" (disebut opsional di spec) — bikin itu butuh `chartjs-plugin-annotation`
  (dependency baru, belum ada di CDN list app ini), sengaja di-skip biar ga nambah dependency
  buat fitur yang ditandai opsional; transisi solid→dashed sendiri udah cukup jadi penanda visual.
- **Chart 📈 Tren Net Worth** (tab "Total" di Wealth, `renderChart()` cabang `chartTab === "nw"`)
  — SELALU dua garis "Net Worth (+ CAPEX)" vs "Net Worth (tanpa CAPEX)" (bukan cuma pas ada
  CAPEX — sengaja ga di-gate, biar user selalu bisa bandingin) + garis Target, legend selalu
  tampil. Dua garis itu dihitung ULANG per snapshot lewat `snapshotNetWorth(s, includeCapex)`
  (calc.js, pure — wrapping `netWorthFromParts()`, di-export lewat `store.js` biar satu sumber
  dipakai wealth.js DAN report-md.js, lihat di bawah) dari field total* MENTAH (`totalCash`/
  `totalAssets`/`totalCapex`/`totalGoalSavings`/`totalDebt`, semua top-level di doc snapshot,
  lihat bullet `snapshots`) — BUKAN dari `s.netWorth` yang tersimpan, karena `netWorth` itu udah
  "jadi" pakai toggle `settings.includeCapexInNetWorth` SAAT snapshot itu dibuat. Kalau
  toggle-nya pernah diganti, satu garis `netWorth` doang bakal keliatan "lompat" padahal cuma
  definisi yang beda, bukan net worth beneran berubah — makanya dua garis di sini SELALU dihitung
  pakai definisi yang SAMA di semua titik, terlepas toggle waktu itu apa. Snapshot lama yang cuma
  punya `netWorth` (manual backfill `{month, netWorth, manual:true}`, atau snapshot dari sebelum
  fitur CAPEX ada — ga punya `totalCash`/`totalAssets` top-level) fallback ke `netWorth` apa
  adanya buat SEMUA variant `includeCapex` — ga ada cukup data buat dipisah, jangan ngarang
  breakdown yang ga ada (bisa dibenerin per-snapshot lewat card "🏗️ Backfill CAPEX ke Snapshot
  Lama" di Setting kalau breakdown-nya masih ada, lihat bullet itu di bawah). Chart 🚀 Proyeksi
  (`renderProjectionChart()`) BEDA POLA — garis "Aktual" historis di situ CUMA SATU (chart-nya
  udah padat, 5 garis — lihat bullet Dashboard Proyeksi soal kenapa GA ADA garis historis
  "Nabung doang" terpisah di situ), ngikutin toggle SEKARANG (`state.settings.includeCapexInNetWorth`,
  live — bukan toggle yang berlaku waktu snapshot itu dibuat) lewat `snapshotNetWorth()` yang
  sama, biar konsisten sama titik awal semua garis proyeksi (`nw` dari `netWorthIDR()`, yang
  juga toggle-aware).
- **Backfill CAPEX ke Snapshot Lama** (Setting, card "🏗️ Backfill CAPEX ke Snapshot Lama" —
  CUMA muncul kalau `previewCapexBackfill()` nemu sesuatu buat di-backfill, `js/db.js`
  `previewCapexBackfill()`/`backfillCapexToSnapshots()`) — snapshot yang dibuat SEBELUM fitur
  CAPEX ada ga punya field `totalCapex` sama sekali (undefined), padahal asset yang SEKARANG
  bertipe `capex` bisa aja udah ada waktu itu (cuma belum diklasifikasikan sebagai capex, ke-
  hitung sebagai "assets" biasa) — bikin chart Tren Net Worth/Proyeksi & report-md.js section
  1/10 nunjukin garis/angka "+ CAPEX" dan "tanpa CAPEX" IDENTIK buat bulan-bulan itu (BUKAN
  karena beneran ga ada CAPEX waktu itu, tapi karena datanya emang belum misah). Backfill ini
  BEST-EFFORT: cocokin `breakdown.assets[i].symbol` tiap snapshot lama vs symbol/name asset yang
  SEKARANG bertipe capex (case-insensitive), jumlahin `valueIDR` yang match jadi `totalCapex`
  bulan itu — angka ASLI yang udah kesimpen di snapshot itu waktu itu, BUKAN dikarang/diestimasi.
  SENGAJA TIDAK mengubah `breakdown.assets[i].type` (biarin historisnya apa adanya) — jadi
  section 6 "Investasi" report utk bulan lama TETAP ngelompokkin item itu ke tipe LAMA-nya
  (bukan pindah ke grup CAPEX), quirk kecil yang diterima demi ga nulis ulang breakdown historis
  (cuma nambah 1 field top-level baru). Snapshot TANPA `breakdown.assets` (manual backfill
  `{month, netWorth, manual:true}`) DI-SKIP total — ga ada data buat direkonstruksi, JANGAN
  ngarang. Preview & eksekusi jalan SATU fungsi matching yang sama (`previewCapexBackfill()`,
  dipanggil juga dari dalam `backfillCapexToSnapshots()`) — pola sama `previewBulkDelete()`/
  `bulkDelete()`, preview ga boleh drift dari yang beneran ke-apply. One-shot per snapshot yang
  belum ke-backfill — card otomatis ilang begitu semua snapshot yang match udah punya
  `totalCapex` (re-render lewat `store.on()` biasa setelah `patch()` masing-masing snapshot).
- `tests/calc.test.mjs` — smoke test manual buat `js/calc.js`, jalankan
  `node tests/calc.test.mjs` (bukan bagian runtime app, sengaja GA masuk `PRECACHE` sw.js).
  `js/calc.js` sendiri WAJIB masuk `PRECACHE` (dipakai runtime lewat wrapper `store.js`).
  Nambah fungsi kalkulasi baru → taruh di `calc.js` (bukan langsung di `store.js`) + tambah
  test case-nya, biar tetap bisa ditest tanpa Firebase/browser.
- TradingView scanner (`js/prices.js`, `fetchIDX`) — provider saham IDX SEKARANG. `POST
  https://scanner.tradingview.com/global/scan` dengan body `{symbols:{tickers:["IDX:BBCA",...],
  query:{types:[]}}, columns:["close"]}`, response `{data:[{s:"IDX:BBCA", d:[<close>]}, ...]}`
  (index array `d` ngikutin urutan `columns`, ticker di-strip prefix bursa buat dicocokin balik
  ke symbol asset). **TANPA API key sama sekali** — CORS-nya reflect Origin header apa pun,
  udah dites langsung dari origin production app ini. **JANGAN set header
  `Content-Type: application/json`** di `fetch()`-nya — itu bukan CORS-safelisted header, bikin
  browser preflight `OPTIONS` yang bakal ke-block (TradingView cuma allow `Referer,Accept` di
  `Access-Control-Allow-Headers` preflight-nya, bukan `content-type`) → request asli gagal diam-diam.
  Biarkan `fetch()` pakai default Content-Type buat body string (`text/plain`, CORS-safelisted,
  skip preflight) — server tetap parse body-nya sebagai JSON regardless declared type (riwayat
  lengkap kenapa provider ini yang dipilih + bug CORS preflight yang sempet kejadian: lihat
  `DECISIONS.md`). Delay ~10 menit (`update_mode: delayed_streaming_600`).
  **RISIKO YANG SENGAJA DITERIMA:** endpoint backend publik TradingView, ga resmi
  didokumentasikan buat dipakai eksternal — TIDAK ada jaminan SLA/stabilitas. Kalau harga IDX
  berhenti ke-update, ini kandidat pertama yang dicek — cek dulu pakai API key ASLI (bukan cuma
  baca marketing page) sebelum percaya klaim "free tier" provider pengganti manapun (lihat
  `DECISIONS.md`). `refreshPrices()` (dipanggil dari tombol "🔄 Harga" di Wealth) return field
  `errors: {idx?, us?, crypto?}` — error mentah per-provider di-surface ke toast langsung, BUKAN
  cuma `console.warn` — PWA di HP ga punya akses gampang ke DevTools, jadi ini satu-satunya cara
  diagnosis kenapa refresh gagal. Kalau nambah provider baru, pertahankan pola ini.
- Dua mekanisme seeding kategori di `db.js`, sengaja beda: `seedIfNeeded()` = sekali doang
  (guard `settings.seeded`), buat kategori awal saat akun baru pertama kali dipakai.
  `ensurePresetCategories()` = jalan tiap sesi (`put()` id deterministik + merge, idempotent),
  buat nambahin kategori sistem baru (mis. Penyesuaian Saldo) ke user LAMA yang udah lewat
  seedIfNeeded. Kalau nambah kategori sistem baru lagi ke depannya, tambahin ke
  `ensurePresetCategories()`, jangan ke `PRESET_CATEGORIES`/`seedIfNeeded` (user lama ga bakal
  ke-migrasi).
- Chart.js dari jsdelivr CDN; kalau belum ke-cache dan offline, chart area menampilkan pesan fallback.
- iOS Safari bisa evict storage PWA — data master di cloud, jadi worst case re-sync saat login.
- `attachThousands()` memformat input ribuan live; parse balik pakai `parseAmount()`.
- **Tanggal kalender WAJIB pakai `toDateStr()`/`todayStr()` di `utils.js`** (local time, dari
  `getFullYear()/getMonth()/getDate()`) — **JANGAN** `new Date().toISOString().slice(0,10)` buat
  representasi "hari ini"/tanggal kalender. Di WIB (UTC+7) jam 00:00–07:00, `toISOString()`
  mundur satu hari (masih UTC kemarin) — bisa bikin transaksi default kecatat tanggal salah,
  `currentMonth()` salah bulan awal bulan (snapshot bisa nimpa bulan lalu), sheet Awal Bulan ga
  ke-trigger (dampak nyata & kronologi kejadiannya: lihat `DECISIONS.md`). `toISOString()`
  sendiri tetep valid buat timestamp MOMEN (`createdAt`, `lastBackupAt`, `exportedAt` di
  db.js/settings.js) — itu memang harus UTC/absolute, bukan tanggal kalender, jangan diubah.
  Kalau nambah kode baru yang butuh format Date → string tanggal, pakai `toDateStr(d)`, jangan
  bikin ulang pad/getFullYear manual.
- GitHub Pages (Fastly, di belakang custom domain xiesandi.cyou) nge-serve `sw.js` dengan
  `Cache-Control: max-age=14400` (4 jam), ga bisa dioverride header-nya. Update SW jadi bisa
  ke-detect telat. Register pakai `{ updateViaCache: "none" }` biar `reg.update()` minimal
  ga kena HTTP cache browser sendiri.
  **JANGAN** pasang query string cache-buster (`?v=${Date.now()}`) di URL registrasi SW dan
  **JANGAN** panggil `self.skipWaiting()` otomatis di `install` — kombinasi itu + `clients.claim()`
  + auto-`location.reload()` on `controllerchange` pernah bikin app kejebak infinite-reload-loop
  di HP (mekanisme lengkap kenapa loop-nya kejadian: lihat `DECISIONS.md`).
  **Update flow sekarang: banner "Versi baru siap" + tap user** (`#update-bar` di index.html,
  logic di `js/app.js` blok PWA). SW baru tetap nunggu di "waiting"; app deteksi `reg.waiting`/
  `updatefound`→`installed`, munculin banner, dan BARU pas user nge-tap tombolnya app
  `postMessage({type:"SKIP_WAITING"})` ke worker itu (sw.js punya listener `message` buat ini —
  satu-satunya jalan `skipWaiting()` kepanggil, TETAP ga ada di `install`). Reload-nya di handler
  `controllerchange`, DIKUNCI flag `userAccepted` yang cuma true sepersekian detik setelah tap
  (di-reset lagi jadi false abis reload di-trigger) — jadi reload MUSTAHIL kejadian tanpa tap
  user, dan itu yang bikin pola ini beda dari yang dulu bikin loop. Banner SENGAJA ga muncul
  kalau `navigator.serviceWorker.controller` null (install PERTAMA, bukan update).
  **Kenapa pasif doang ga cukup** (dan kenapa ini ketauan telat): PWA mobile praktis ga pernah
  nutup semua client-nya — dibuka lagi dari app switcher itu RESUME, bukan reload — jadi SW
  waiting bisa nyangkut selamanya dan user stuck di versi lama walau udah deploy, sementara di
  browser desktop keliatan normal karena tab-nya beneran ke-close (persis gejalanya pas fitur
  mask asterisk: jalan di desktop, di PWA HP masih perilaku lama). Tombol **Hard Refresh** di
  Setting (`hardRefresh()` di `utils.js`: unregister semua SW + `caches.delete()` semua + reload)
  TETAP dipertahankan sebagai palu darurat kalau SW-nya sendiri yang korup/nyangkut — dan itu
  satu-satunya jalan keluar buat user yang udah terlanjur stuck di versi SEBELUM banner ini ada
  (SW lama ga punya listener `SKIP_WAITING`, jadi ga bisa disuruh nyalip).
  Jangan tambahin balik auto-activate/auto-reload tanpa tap — loop risk-nya balik lagi.
- Transaksi dengan `toGoalId` (topup), `fromGoalId` (pencairan), atau `assetId` (beli/jual asset)
  HARUS selalu dibuka lewat sheet khususnya (`openTopupSheet()`/`openWithdrawSheet()` di
  goals.js, `openAssetBuySheet()`/`openAssetSellSheet()` di wealth.js) — jangan lewat
  `openTxSheet()` generik (tx-sheet.js), yang itu cuma tau `toAccountId`, field-field itu bakal
  hilang (data ke-corrupt) kalau ke-save ulang lewat situ. Titik masuknya udah dijaga di
  `txRow()` (`home.js`, dipakai bareng `transactions.js`) — cek `t.assetId` dulu, baru
  `t.toGoalId || t.fromGoalId`, sebelum decide sheet mana yang dibuka. Kalau nambah entry point
  baru buat klik transaksi (search, dll), inget guard ini juga.
- Logic salin budget bulan lalu cuma ada SATU implementasi: `copyBudgetFromLastMonth()`,
  exported dari `views/budget.js`, dipakai tombol "⧉ Salin bulan lalu" DAN sheet Awal Bulan
  (`recurring-sheet.js`). Jangan re-implement inline lagi di tempat lain.
- **Export Laporan (.md)** (Setting → "📄 Export Laporan (.md)", `js/report-md.js`,
  `buildMonthlyReport(month)`) — beda dari backup JSON (`exportAll()`, buat restore data): ini
  laporan human/AI-readable, siap paste ke chat AI. Section cashflow/budget/expense-per-kategori
  SELALU pakai data HISTORIS bulan yang dipilih (`monthSummary`/`spentByCategory`/`budgetsOfMonth`
  — data ini emang udah per-bulan dari awal). Section posisi (akun/asset/debt/goal, section 1/5/
  6/7/8) pakai `buildPosition()` — SATU tempat yang mutusin sumbernya, bukan tiap section
  mutusin sendiri: bulan **berjalan** SELALU live (snapshot bulan itu masih "berjalan", belum
  final); bulan **lampau ber-snapshot lengkap** (`isSnapshotComplete()` — breakdown-nya berupa
  array per-item, bukan object map lama) pakai angka dari `snapshots/{bulan}.breakdown`, label
  "Posisi akhir {bulan}", TANPA disclaimer — ini genuinely historis, bukan approximasi; bulan
  lampau TANPA snapshot lengkap (data lama/manual backfill) fallback ke posisi TERKINI + label
  "Posisi per {tanggal export}" + disclaimer eksplisit (jangan pernah mengarang data yang ga
  ada). Section 1 (Ringkasan) SELALU nunjukin DUA angka net worth eksplisit — "+ CAPEX" dan
  "tanpa CAPEX" (`netWorthFromParts()`, calc.js, lihat bullet `assets` tipe `capex`) — plus baris
  ketiga yang bilang mana yang "dipakai app sekarang" (ngikut toggle di Wealth). Progress 🏆 Main
  Milestone di section itu pakai net worth yang SESUAI toggle (bukan salah satu variant secara
  hardcoded), biar konsisten sama yang ditampilin live di Home/Wealth. Section "Tren Net Worth"
  (10) juga DUA kolom yang sama (bukan satu kolom "Net Worth" + "Delta" kayak dulu) — tujuannya
  biar AI yang baca laporan ini bisa analisis/bandingin dua skenario itu sendiri tanpa perlu
  ngitung manual. Baris "Perubahan komposisi" (TASK-1, 2026-08 — dulu ada bug ganda, riwayat
  lengkap: `DECISIONS.md`) di-generate lewat `netWorthComposition(prevParts, currParts,
  includeCapex)` (calc.js, PURE, ga butuh `state`) — **JANGAN hitung manual di string builder
  lagi** (itu akar penyebab bug-nya). Field balikannya SEMUA udah representasi KONTRIBUSI ke net
  worth (bukan raw delta apa adanya): `assets` SELALU exclude CAPEX (pola sama `investAssets` di
  wealth.js `renderTotal()` — assets RAW udah termasuk CAPEX, jadi CAPEX WAJIB baris terpisah,
  JANGAN dijumlah bareng `assets` atau bakal double count lagi), `debt` UDAH DINEGASI (debt naik
  = kontribusi NEGATIF ke net worth, sesuai formula `netWorthFromParts` yang `-debt`). Caller
  (report-md.js) TINGGAL JUMLAH APA ADANYA field-field itu (`cash + assets + (includeCapex ?
  capex : 0) + goalSavings + debt`) buat dapet total — dijamin ALGEBRAIC sama persis `total`
  (yang dihitung LANGSUNG dari `netWorthFromParts()`, bukan dari nge-jumlah ulang komponennya) —
  kalau nanti nambah komponen baru ke breakdown net worth, pastikan tetap pola ini (return
  kontribusi siap-jumlah, bukan raw delta yang butuh sign-flip manual di caller). Pasangan bulan
  yang dipakai (`prevParts`/`currParts`) SAMA PERSIS kayak yang dipakai Δ net worth section 1
  (`partsNow` + `prevSnap`, BUKAN dua entri terakhir tabel trend 12-bulan di section 10 sendiri —
  bisa beda pasangan bulan kalau report digenerate buat bulan lampau) — jadi angka Δ section 1 &
  "Total Δ" di baris komposisi section 10 SELALU identik (bukan cuma toleransi Rp1 kayak
  sebelumnya). Basis (`includeCapex`) ngikut toggle `settings.includeCapexInNetWorth` yang
  berlaku SEKARANG (`includeCapexNow`, sama kayak section 1), dan baris CAPEX di tampilan CUMA
  muncul (+ ikut disum) kalau basisnya `includeCapex`. Skip total kalau `prevSnap` ga punya
  breakdown lengkap (`totalCash`/`totalAssets` bukan number — snapshot lama/manual backfill) —
  jangan ngarang komposisi dari data yang ga ada. Section 5 (Akun) — akun tipe `credit`
  ditampilin sebagai ringkasan "Terpakai / Limit / Sisa" di kolom Saldo (BUKAN saldo signed
  polos), kolom Ekuivalen IDR tetap angka negatif apa adanya. Section 1 nambah baris "🪪 Kartu
  Kredit terpakai" (dari `position.accounts`, cocok dipakai buat live MAUPUN snapshot-based
  position — dua-duanya udah punya field `type`/`balanceIDR`) kalau ada CC dipakai, eksplisit
  disebut "sudah termasuk di Debt di atas" (CC lewat debt path — v2, lihat bullet `accounts`
  tipe `credit` & `DECISIONS.md`) biar ga disangka double-hitung. Section 7 (Hutang) nambah
  subsection "🪪 Kartu Kredit" terpisah dari tabel cicilan (`debts` collection) — field beda
  konsep (Terpakai/Limit, bukan Cicilan/JatuhTempo), TAPI tetap masuk Debt total yang sama.
  Section 8 (Short Term Goals) — header kolom eksplisit **"Terkumpul (tunai+aset)"** (TASK-2,
  2026-08, riwayat: `DECISIONS.md` — dulu cuma "Terkumpul" polos, kebaca kontradiksi sama "Goal
  savings" section 1 yang cuma tunai) = topup (tunai) + nilai asset ter-link (`goalProgressIDR()`,
  lihat bullet `goals`), kolom "Breakdown" misahin dua-duanya ("tunai X + aset Y") biar jelas —
  asset ter-link TETAP dihitung normal di section 6 (Investasi)/net worth, kolom ini murni
  informasi, BUKAN nambah net worth lagi. Catatan kaki muncul di bawah tabel kalau ADA goal
  ber-`linkedValue` (ngingetin progress-nya sebagian bukan tunai siap cair). Section 1 baris
  "Goal savings" juga nambah "(tunai) + Rp Y (dari asset ter-link, sudah termasuk di Assets)"
  kalau totalnya > 0 (SATU baris ringkasan lintas-goal, beda dari breakdown per-goal section 8)
  — sebelumnya cuma nampilin `Rp 0` polos yang keliatan kontradiktif kalau ada goal ber-asset-link
  yang progressnya jauh di atas 0. Section 6 (Investasi) — bond (tipe `bond`) dapet kolom
  Qty/Avg Buy/P&L yang di-repurpose (bukan format saham biasa) + baris informatif terpisah
  (total pokok + estimasi kupon tahunan + maturity terdekat) — detail lengkap: CLAUDE.md bullet
  `assets` tipe `bond`, section itu yang jadi sumber kebenaran field-nya, bukan di sini. **Pakai
  `fmtIDRPlain()`/`fmtMoneyPlain()` (utils.js), BUKAN `fmtIDR()`/`fmtMoney()`** — yang terakhir
  itu wrapper `<span class="blur-num">` buat blur mode DOM, bakal ngerusak output markdown kalau
  kepake di teks/file. Section 9 (Komitmen Rutin, recurring aktif) SENGAJA SELALU live regardless
  bulan yang dipilih — recurring itu komitmen SEKARANG, bukan konsep "posisi per bulan". Konteks
  profil owner (usia/gaji/nama bank) SENGAJA TIDAK di-hardcode di file ini — itu cuma boleh ada
  di CLAUDE.md (dev doc, ga ke-ship ke browser); nulis literal di source JS bakal ke-expose ke
  siapapun yang buka situs (static site, semua JS ke-download terlepas dari status login), beda
  kelas exposure-nya dari data lain di app yang selalu datang dari Firestore ber-auth. Section 11
  ("Konteks untuk Analisis") ngikutin batasan yang sama — isinya murni diturunkan dari state yang
  udah ke-load (target milestone, ringkasan jumlah asset auto-refresh vs manual, disclaimer
  "data cuma yang tercatat di FinTrack") plus 5 pertanyaan pemandu analisis yang statis (ga
  bergantung data), BUKAN konteks personal owner.
- **Snapshot cuma ke-capture kalau app dibuka SAAT ONLINE bulan itu — ini KONSEKUENSI DESAIN,
  BUKAN bug.** `upsertSnapshot()` (db.js) jalan sekali per sesi, dipicu listener di app.js dengan
  guard `state.ready && !snapshotDone && navigator.onLine && state.uid` — jadi butuh ONLINE juga,
  ga cukup cuma "app kebuka" (PWA ini offline-first, tapi snapshot-nya sendiri butuh koneksi).
  Yang ditulis SELALU `currentMonth()` (bulan wall-clock SAAT itu) — TIDAK ada backfill
  retroaktif buat bulan yang kelewat. Konsekuensinya: kalau user ga pernah buka app secara online
  sepanjang suatu bulan, snapshot bulan itu PERMANEN kosong (ga ada mekanisme apapun yang
  "menyusul" ngisi belakangan) → `isSnapshotComplete()` gagal buat bulan itu → laporan .md
  (`report-md.js`, lihat bullet "Export Laporan (.md)" di atas) jatuh ke fallback "Posisi per
  {tanggal export}" (posisi TERKINI + disclaimer), BUKAN posisi asli akhir bulan yang kelewat
  itu. Wajar terjadi di app statis tanpa scheduler/cron server-side — **JANGAN** coba "nutupin"
  ini dengan mekanisme aneh (background sync Service Worker, dsb.), itu di luar scope PWA statis
  ini. Mitigasi yang ADA: backfill manual "Snapshot Historis" di Setting kalau user sadar
  kelewat — TAPI itu SENGAJA minimal (`{month, netWorth, manual:true}`, TANPA `breakdown`), jadi
  `isSnapshotComplete()` tetap `false` buat bulan itu walau udah di-backfill — laporan .md bulan
  itu TETAP fallback ke posisi terkini, bukan otomatis "lengkap" cuma gara-gara ada angka manual.
- **Zona Bahaya / Reset Data** (Setting → "🗑️ Reset Data", `#/danger`, `js/views/danger.js`,
  `bulkDelete()`/`previewBulkDelete()` di db.js) — 3 mode: per bulan, per tahun, atau total
  (dengan 2 sub-opsi yang beda drastis: **C1 "Hapus Semua Histori"** cuma nge-wipe
  transactions/budgets/snapshots, master data — accounts/categories/assets/debts/goals/recurring
  — TETAP ADA; **C2 "Reset Total"** ngewipe SEMUA collection termasuk master data, balik ke
  kondisi first-run, `seedIfNeeded()`+`ensurePresetCategories()` dijalanin ulang, `apiKeys` bisa
  dipertahankan lewat checkbox). Safeguard berlapis: preview jumlah persis sebelum eksekusi,
  peringatan backup basi (>24 jam), checkbox "gue paham resiko" wajib dicentang, type-to-confirm
  (bukan `confirmDialog()` biasa — teks yang harus diketik beda-beda tergantung mode), wajib
  online (`navigator.onLine`, dicek juga di dalam `bulkDelete()` sendiri sebagai defense-in-depth
  bukan cuma di view). Preview dan eksekusi SATU sumber scope (`bulkDeleteScope()` internal di
  db.js) — jangan biarkan itu drift jadi dua logic beda, preview harus selalu match apa yang
  beneran kehapus. Habis bulk delete: saldo akun BERUBAH (dihitung dari jurnal transaksi, bukan
  `initialBalance`) — user diarahkan ke Reconcile ("⚖️ Sesuaikan Saldo") kalau perlu. Kalau scope
  mengandung transaksi ber-`assetId`, preview nampilin peringatan terpisah (nama asset + jumlah
  transaksi terdampak) — `assets.quantity` ikut disesuaikan otomatis (lihat bullet bypass hook di
  bawah), tapi `avgBuyPrice` GA ikut di-reverse, sama kayak hapus 1 transaksi asset manual.
- **Cek Integritas Data** (Setting → "🩺 Cek Integritas Data", `js/integrity.js`,
  `scanIntegrity(state)`) — scan READ-ONLY (JANGAN auto-fix) buat referensi yatim: transaksi
  yang nunjuk akun/kategori/goal/debt/asset yang udah ga ada, transfer dengan `toAccountId` =
  `accountId`, nominal ≤ 0, tanggal > 1 tahun ke depan, `month` yang ga cocok sama `date`
  (sisa bug timezone lama kalau ada, lihat Known Quirks `toDateStr()`); plus budget yang
  categoryId-nya ga ketemu. Referensi yatim ini cuma bisa kejadian kalau entity dihapus lewat
  LUAR app (mis. Firestore console langsung) — guard normal (accounts.js/goals.js/dll) udah
  nyegah ini lewat UI biasa. Tombol "Buka" di tiap finding transaksi manggil `openTxDetail()`
  (diekstrak dari `txRow()` di home.js) — BUKAN `openTxSheet()` langsung, biar tetap
  ikut guard goal/asset yang sama; kalau referensinya sendiri yang orphan, `openTxDetail()`
  otomatis fallback ke `openTxSheet()` generik (sheet khusus butuh objek goal/asset yang
  beneran ada buat dirender, jadi generik emang satu-satunya jalan). Finding level BUDGET
  (bukan transaksi) diarahkan ke `#/budget`, bukan buka sheet spesifik. Fix kecil terkait:
  `openBudgetSheet()` sekarang tetap bisa dibuka (buat akses tombol Hapus) walau
  `categoryId`-nya udah orphan — sebelumnya diam-diam nolak buka sama sekali dengan toast yang
  salah ("Semua kategori sudah punya budget"). Finding level ASSET (kind: "asset") cek konsistensi
  `assets.quantity` vs jejak transaksi ber-`assetId` (`netQty = Σbeli − Σjual`, toleransi floating
  point < 0.0001, bukan `!==` mentah) — SENGAJA cuma dicek buat asset yang PUNYA ≥1 transaksi;
  asset tanpa transaksi sama sekali (posisi lama pra-fitur beli/jual) ga pernah di-flag, itu legit
  manual. Wording-nya informatif bukan tuduhan ("selisih X — perlu dicek") karena selisih bisa
  sengaja (posisi lama + transaksi baru bercampur). Tombol "Buka" manggil `openAssetSheet()`
  (di-export dari `wealth.js` khusus buat ini). Transaksi ber-`assetId` yang `assetQty`/
  `assetPrice`/`assetDir`-nya kosong/invalid juga di-flag di level transaksi (bukan asset).
  Finding level ACCOUNT (kind: "account") — khusus akun tipe `credit`: over-limit (`creditUsed >
  creditLimit`, limit > 0) atau saldo POSITIF (kemungkinan kelebihan bayar/salah reconcile).
  Import `accountBalances`/`isCreditAccount`/`creditUsed` langsung dari `calc.js` (bukan cuma
  `utils.js` kayak sebelumnya) — pertama kalinya `integrity.js` gantungan ke `calc.js`, biar
  ga duplikasi logic saldo yang udah ada di sana. Tombol "Buka" manggil `openAcctSheet()`
  (di-export dari `accounts.js` khusus buat ini, sebelumnya lokal-only). Finding level GOAL
  (kind: "goal") — `linkedAssetIds` yang nunjuk ke asset yang udah ga ada (dihapus lewat luar
  app); nilai asset yang ilang otomatis ga kehitung lagi di `goalLinkedAssetsValueIDR()` (filter
  by existing id), tapi id-nya sendiri ga di-auto-cleanup dari array, jadi finding ini exists
  biar user sadar. Tombol "Buka" manggil `openGoalSheet()` (di-export dari `goals.js` khusus
  buat ini, sebelumnya lokal-only).
- **Efek samping transaksi ber-`debtId`/`assetId` DIPUSATKAN sebagai hook di `remove()` generik**
  (kenapa dipusatkan sebagai hook, bukan ditulis manual di tiap sheet: lihat `DECISIONS.md`)
  (db.js): `applyDebtEffect()` (efek debt, dipanggil juga dari `add()`/`patch()` lewat
  `handleDebtPatch()`) dan `applyAssetQtyEffect()` (reverse `assets.quantity` — HANYA di `remove()`,
  karena create asset selalu lewat `openAssetBuySheet()`/`openAssetSellSheet()` yang udah nulis
  quantity-nya sendiri, dan edit transaksi ber-`assetId` sengaja ga didukung, lihat bullet
  `assets`). Sheet manapun yang hapus transaksi ga perlu tau soal ini — cukup pastikan transaksi
  yang di-`remove()` punya field `debtId`/`assetId` apa adanya.
  **Dua jalur tulis transaksi yang SENGAJA bypass hook ini** (nulis langsung via
  `writeBatch`/`deleteDoc`, ga pernah manggil `add()`/`patch()`/`remove()` generik):
  1. `importAll()` (backup restore) — nilai `debts.totalOutstanding`/`assets.quantity` di file
     backup udah final; kalau hook ikut jalan pas restore transaksi ber-`debtId`/`assetId`, angkanya
     kepotong/ketambah DUA KALI.
  2. `bulkDelete()` (reset data, `js/views/danger.js`) — efek debt DAN asset TETAP dikembalikan
     (konsisten sama hapus 1 transaksi via `remove()`), TAPI diagregasi dulu per debt/asset (debt:
     total amount + count; asset: `netQty = Σbeli − Σjual`), baru SATU `patch()` per entity di
     akhir — bukan satu hook-triggered patch per transaksi (ratusan patch berturut ke dokumen yang
     sama = lambat & rawan race). Di-skip total kalau mode Reset Total (C2) — debts/assets-nya
     sendiri toh ikut kehapus.
  Kalau ke depannya `importAll()`/`bulkDelete()` di-refactor buat pakai `add()`/`patch()`/
  `remove()` generik (misal biar dapet `stamp()` otomatis), WAJIB tambah bypass eksplisit (flag
  semacam `skipSideEffects`) — jangan sampe efek debt/asset ke-double-count. Kalau nambah jalur
  tulis transaksi massal baru ke depannya, ikutin pola yang sama (raw batch write + agregasi
  manual), jangan bikin jalur keempat yang beda pattern.

## Roadmap (belum jadi task aktif — detail lengkap + urutan di `TASKS.md`)

1. Arsip transaksi lama — `store.js` listen SEMUA transaksi selamanya via `onSnapshot`, aman
   sampai ±3–5rb docs. Evaluasi kalau transaksi udah > 3.000 docs atau load mulai lambat.
2. Import CSV mutasi bank; laporan tahunan (reuse `report-md.js`); enkripsi backup (Web Crypto).
3. Harga emas & NAV reksa dana: BELUM ada API gratis+CORS yang stabil → tetap manual.

## Konteks Owner (untuk fitur/copy)

Usia 26, fase asset accumulation. Gaji ~9jt/bln (gajian tgl 28). Akun: BCA (payroll),
bank digital (operational, bunga 6% pa), RDN, Bibit (RDPU), Pluang (US stocks).
Portfolio: BBCA/BBRI/ADRO/WBSA (IDX), VOO/SCHD (US). Debt aktif: Tokopedia CC (tgl 15),
Shopee BNPL (tgl 11, lunas Agt 2026). Target: 100jt aset akhir 2028, debt-free Jan 2027.

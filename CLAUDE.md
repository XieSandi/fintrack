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

## Arsitektur

```
index.html            shell: header, #view, FAB, bottom nav, sheet, toast
css/style.css         dark theme, mobile-first, CSS vars di :root
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
js/utils.js           format, tanggal, toast, openSheet/closeSheet, escapeHtml, blur mode, hardRefresh
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

Blur mode (toggle 👁️ di card Total Balance) nge-blur semua `<span class="blur-num">` (dihasilkan
`fmtIDR`/`fmtUSD` di `utils.js`) lewat CSS `body.blur-mode`, state di localStorage — bukan re-render.

## Data Model (Firestore `users/{uid}/`)

- `accounts` — kantong uang (bank/ewallet/cash/rdn/broker), currency IDR/USD, initialBalance.
  **Saldo TIDAK disimpan** — dihitung dari jurnal: initialBalance ± transaksi (lihat `accountBalances()`).
  Reconcile ("⚖️ Sesuaikan Saldo" di sheet edit akun, `accounts.js`) TIDAK overwrite saldo —
  bikin 1 transaksi adjustment (expense/income, kategori `cat_adjust_out`/`cat_adjust_in`)
  sebesar selisih aktual vs tercatat, biar tetap auditable di History.
- `categories` — {name, icon, type: expense|income, isPreset}. Preset awal via `seedIfNeeded()`
  (sekali doang, first-run); preset baru buat user lama via `ensurePresetCategories()` (tiap
  sesi, idempotent) — lihat Known Quirks. Ga bisa dihapus kalau masih dipakai transaksi
  (guard di `categories.js`).
- `transactions` — {date, month:"YYYY-MM", amount, type: expense|income|transfer, accountId,
  toAccountId?, toGoalId?, fromGoalId?, categoryId, debtId?, assetId?, assetDir?, assetQty?,
  assetPrice?, note}. Transfer = 1 record, BUKAN expense.
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
  **Toggle Net Worth** (`settings.includeCapexInNetWorth`, checkbox di Setting → "🏆 Main
  Milestone & Kurs", default **FALSE/exclude**) — nentuin CAPEX ikut `netWorthIDR()` atau ngga.
  `totalAssetsIDR()` SENDIRI TETAP SELALU termasuk CAPEX apa adanya (dipakai tab Assets Wealth —
  itu "semua yang lo punya", bukan konsep net worth); `netWorthIDR()` yang conditional-subtract
  lewat `totalCapexIDR()` (calc.js) BUKAN filter ulang di tempat lain. Efeknya: breakdown Total
  tab Wealth ("📈 Assets (investasi)") SELALU nampilin nilai EXCLUDE CAPEX (biar rows-nya tetap
  sum persis ke NET WORTH baik toggle ON/OFF) + baris "🏗️ CAPEX" terpisah CUMA muncul di situ
  kalau toggle ON; kalau OFF, nilainya tetep kelihatan tapi sebagai catatan `.sub` di luar
  tabel breakdown (bukan salah satu row yang di-sum). `report-md.js` section 1 nunjukin nilai
  CAPEX + status include/exclude-nya secara eksplisit (jangan asumsikan Assets di laporan =
  Net worth − Cash − Goals + Debt kalau CAPEX ada, dua-duanya sengaja BISA beda). Snapshot bulanan
  (`upsertSnapshot()`) nyimpen `totalCapex` + per-asset `purchaseDate`/`depreciationPctMonth` di
  breakdown — field opsional/additive, snapshot lama (pre-fitur) `undefined` → fallback 0, JADI
  **schemaVersion TIDAK dinaikkan** buat perubahan ini (backup lama tetap valid di-restore).
- `debts` — outstanding, monthlyInstalment, dueDay, remainingMonths. Mengurangi net worth.
  Transaksi expense bisa opsional bawa `debtId` (dropdown "Potong hutang?" di `openTxSheet()`
  kalau ada ≥1 debt, dan di form `recurring`) — CREATE/EDIT/DELETE transaksi ber-`debtId`
  otomatis nyesuain `totalOutstanding`/`remainingMonths` (floor 0). Logic-nya DIPUSATKAN di
  `applyDebtEffect()`/`handleDebtPatch()` (db.js), nge-hook langsung ke `add()`/`patch()`/
  `remove()` generik buat collection `"transactions"` — sheet manapun yang nulis transaksi
  otomatis kena efeknya tanpa perlu tau, JANGAN reimplement mutasi debt manual di sheet.
  `totalOutstanding` ≤ 0 → badge "Lunas 🎉" (tab Debt Wealth), bukan auto-delete. Debt yang
  punya transaksi ber-`debtId` ga bisa dihapus langsung — pola sama proteksi hapus akun/goal.
- `goals` — Short Term Goals. {name, targetAmount, targetDate? ("YYYY-MM"), color}. Bisa lebih
  dari satu (dikelola di `#/goals`, menu di Setting). **Sistem topup + pencairan**, bukan target
  pasif: saldo goal = topup − pencairan asli (`goalSavedIDR()`), bukan net worth. Goal saldo 0
  SETELAH pernah ada topup/pencairan → badge "Selesai 🎉" (bukan auto-delete, tetep bisa
  di-topup lagi). Goal yang punya riwayat topup ATAU pencairan ga bisa dihapus langsung (harus
  beresin transaksinya dulu di History) — pola sama kayak proteksi hapus akun. Beda konsep dari
  Main Milestone (`settings.targetNetWorth`) — lihat catatan di atas.
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
  buka app. Edit template TIDAK reset `lastPostedMonth` (biar ga dobel post bulan yang sama).
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
- `snapshots/{YYYY-MM}` — net worth bulanan, di-upsert otomatis saat app dibuka (`upsertSnapshot`,
  db.js). Selain total (`totalCash`/`totalAssets`/`totalGoalSavings`/`totalDebt`/`netWorth`),
  nyimpen `breakdown` PER ITEM (angka mentah, bukan string terformat): `accounts` ({name,
  currency, type, balance, balanceIDR}), `assets` ({symbol, type, currency, quantity,
  avgBuyPrice, price, priceDate, valueIDR, costIDR}), `debts` ({name, outstanding,
  monthlyInstalment, remainingMonths, dueDay}), `goals` ({name, targetAmount, saved,
  targetDate}), `rate` (kurs USD saat itu) — dipakai `report-md.js` buat laporan bulan lampau
  yang beneran historis (lihat Known Quirks). Bisa juga di-backfill manual buat bulan pra-app
  lewat card "Snapshot Historis" di Setting (`{month, netWorth, manual:true}`, SENGAJA minimal
  — TANPA `breakdown` sama sekali, bukan error, cuma ga ada data buat direkonstruksi; chart Tren
  Net Worth cuma butuh `netWorth` + `month`/id, tetep jalan). Cuma boleh untuk bulan < bulan
  berjalan (bulan berjalan wilayah `upsertSnapshot`).
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
  `renderProjectionChart()`) — line chart Aktual vs Nabung-doang vs 2 skenario return
  terkonfigurasi (`settings.projectionRateA`/`projectionRateB`), menuju 🏆 Main Milestone.
  Primitif kalkulasinya murni & di-test (`calc.js`): `savingsOnlySeries(state, fromMonth,
  toMonth)` (kumulatif net worth kalau cuma nabung surplus bulanan, di-anchor ke snapshot
  pertama) dan `projectSeries({startValue, startMonth, months, monthlyContribution,
  annualRate})` (compound bulanan generik, `annualRate:0` otomatis jadi proyeksi linear —
  dipakai ulang buat skenario "nabung doang ke depan", TANPA fungsi terpisah). Orkestrasi
  (nentuin startValue/horizon/snapshot mana) sengaja di view layer, bukan calc.js — itu soal
  "gimana nampilinnya", bukan kalkulasi finansial murni.
  **Keputusan desain penting:** SEMUA garis proyeksi (nabung-doang-ke-depan, Return A, Return B)
  mulai dari net worth AKTUAL LIVE bulan ini (`netWorthIDR()`), BUKAN dari titik akhir garis
  "Nabung doang" historis — dua pertanyaan yang beda ("kalau MULAI SEKARANG stop dapet return"
  vs "kalau dari AWAL ga pernah dapet return", yang kedua udah dijawab lewat gap Aktual-vs-Nabung
  di zona historis). Akibatnya boleh ada "lompatan" visual kecil pas garis abu solid (historis)
  ketemu garis abu dashed (proyeksi) di titik bulan ini — bukan bug, itu representasi selisih
  antara dua konsep tadi. Horizon proyeksi = `settings.targetDate` kalau keisi (di-clamp minimal
  1 bulan biar ga degenerate kalau targetDate udah lewat), fallback 60 bulan (5 tahun) kalau
  kosong. `monthlyContribution` proyeksi pakai `recentAvgSurplus()` (fungsi yang sama dipakai
  `milestoneProgress()` buat pace, sekarang di-export biar reusable) — kalau belum ada data
  surplus sama sekali, fallback 0 (proyeksi jadi murni compound growth tanpa kontribusi baru,
  bukan crash/ngarang angka). Chart pakai `null` buat titik di luar rentang tiap dataset (biar
  Chart.js bikin gap, bukan garis nyambung ke titik ga relevan) — SEMUA dataset share SATU axis
  bulan gabungan (historis + horizon proyeksi). Garis Target di-skip total kalau
  `milestoneProgress().hidden` (ga ada target di-set) — beda dari chart Tren Net Worth existing
  yang masih gambar garis Target di y=0 kalau hidden (quirk lama, ga ikut dibenerin di sini,
  di luar scope). Y-axis chart ini SENGAJA dibikin ikut blur mode (`isBlurred()` dari utils.js,
  ganti tick jadi "•••") — ini PERTAMA KALINYA ada chart di app yang blur, chart lain (Tren Net
  Worth, Income vs Expense) BELUM ikut blur mode sama sekali (canvas Chart.js ga kena CSS
  `.blur-num`/`filter:blur()` yang dipakai teks DOM) — kalau nambah chart baru ke depannya dan
  mau ikut blur, pola tick callback di sini bisa dicontek, TAPI jangan asumsikan chart LAMA udah
  otomatis ke-cover. Ga ada anotasi garis vertikal "bulan ini" (disebut opsional di spec) — bikin
  itu butuh `chartjs-plugin-annotation` (dependency baru, belum ada di CDN list app ini), sengaja
  di-skip biar ga nambah dependency buat fitur yang ditandai opsional; transisi solid→dashed
  sendiri udah cukup jadi penanda visual.
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
  di HP (mekanisme lengkap kenapa loop-nya kejadian: lihat `DECISIONS.md`). Sekarang SW baru
  sengaja nunggu pasif ("waiting") sampe user trigger sendiri lewat tombol **Hard Refresh** di
  Setting (`hardRefresh()` di `utils.js`: unregister semua SW + `caches.delete()` semua + reload)
  — jangan tambahin balik auto-activate/auto-reload tanpa mikir ulang soal loop risk ini.
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
  ada). Section "Tren Net Worth" nambah baris "Perubahan komposisi" (Cash/Assets/Goal Savings/
  Debt delta) antara 2 snapshot TERAKHIR kalau datanya ada — ga butuh breakdown baru, field
  total (`totalCash`/`totalAssets`/dst) di snapshot udah ada dari awal. **Pakai
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
